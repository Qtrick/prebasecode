/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';
import {
	computeEntryPointDepthGroups,
	isUnreachableDepth,
	UNREACHABLE_DEPTH,
} from '../../core/analysis/dependencyDepth.js';

suite('PreBase dependencyDepth', () => {
	function node(id: string, kind: GraphNode['kind'] = 'file'): GraphNode {
		return { id, kind, label: id };
	}

	function importEdge(source: string, target: string): GraphEdge {
		return { id: `import:${source}->${target}`, source, target, kind: 'import' };
	}

	test('uses undirected shortest import paths while excluding folders, non-imports, and dangling edges', () => {
		const result = computeEntryPointDepthGroups(
			[
				node('entry'),
				node('direct'),
				node('transitive'),
				node('leaf'),
				node('isolated'),
				node('folder', 'folder'),
			],
			[
				importEdge('entry', 'direct'),
				importEdge('direct', 'transitive'),
				importEdge('entry', 'transitive'),
				importEdge('transitive', 'leaf'),
				importEdge('missing', 'leaf'),
				{ id: 'dependency:entry->isolated', source: 'entry', target: 'isolated', kind: 'dependency' },
				importEdge('folder', 'entry'),
			],
			'entry',
		);

		assert.deepStrictEqual(
			Object.fromEntries(result.depth),
			{
				entry: 0,
				direct: 1,
				transitive: 1,
				leaf: 2,
				isolated: UNREACHABLE_DEPTH,
			},
		);
		assert.deepStrictEqual(
			Object.fromEntries(result.layers),
			{
				0: ['entry'],
				1: ['direct', 'transitive'],
				2: ['leaf'],
				[UNREACHABLE_DEPTH]: ['isolated'],
			},
		);
		assert.strictEqual(result.maxReachableDepth, 2);
		assert.strictEqual(isUnreachableDepth(result.depth.get('isolated')!), true);
	});

	test('returns every layout node as unreachable when the requested entry is absent', () => {
		const result = computeEntryPointDepthGroups(
			[node('one'), node('two'), node('folder', 'folder')],
			[importEdge('one', 'two')],
			'not-a-node',
		);

		assert.deepStrictEqual(Object.fromEntries(result.depth), {
			one: UNREACHABLE_DEPTH,
			two: UNREACHABLE_DEPTH,
		});
		assert.deepStrictEqual(Object.fromEntries(result.layers), {
			[UNREACHABLE_DEPTH]: ['one', 'two'],
		});
		assert.strictEqual(result.maxReachableDepth, 0);
	});

	test('visits a wide cyclic import topology once and preserves its breadth-first depths', () => {
		const width = 6_000;
		const nodes = [node('entry'), ...Array.from({ length: width }, (_, index) => node(`leaf-${index}`))];
		const edges: GraphEdge[] = [];
		for (let index = 0; index < width; index++) {
			edges.push(importEdge('entry', `leaf-${index}`));
			edges.push(importEdge(`leaf-${index}`, `leaf-${(index + 1) % width}`));
		}

		const result = computeEntryPointDepthGroups(nodes, edges, 'entry');

		assert.strictEqual(result.depth.size, width + 1);
		assert.strictEqual(result.maxReachableDepth, 1);
		assert.deepStrictEqual(result.layers.get(0), ['entry']);
		assert.strictEqual(result.layers.get(1)?.length, width);
		assert.strictEqual(result.depth.get(`leaf-${width - 1}`), 1);
	});
});

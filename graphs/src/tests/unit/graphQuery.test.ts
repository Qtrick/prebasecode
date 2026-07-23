/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { affectedNodes, searchNodes, shortestPath } from '../../core/query/graphQuery.js';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';

function node(id: string, path?: string): GraphNode {
	return { id, kind: 'file', label: id.split('/').pop() || id, path: path ?? id };
}

function edge(source: string, target: string, confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' = 'EXTRACTED'): GraphEdge {
	return {
		id: `import:${source}->${target}`,
		source,
		target,
		kind: 'import',
		meta: { confidence, sourceFile: `${source}`, sourceLine: 1, reason: 'test' },
	};
}

suite('PreBase graphQuery', () => {
	test('shortestPath is deterministic with sorted neighbor expansion', () => {
		const nodes = [node('a'), node('b'), node('c'), node('d')];
		// Two equal-length paths a→b→d and a→c→d; BFS with sorted neighbors picks b before c.
		const edges = [edge('a', 'c'), edge('a', 'b'), edge('b', 'd'), edge('c', 'd')];
		const first = shortestPath(nodes, edges, 'a', 'd');
		const second = shortestPath(nodes, edges, 'a', 'd');
		assert.deepStrictEqual(first, second);
		assert.strictEqual(first.found, true);
		assert.deepStrictEqual(first.nodeIds, ['a', 'b', 'd']);
		assert.deepStrictEqual(first.edges.map((e) => e.kind), ['import', 'import']);
		assert.deepStrictEqual(first.edges.map((e) => e.confidence), ['EXTRACTED', 'EXTRACTED']);
		assert.strictEqual(first.edges[0]?.sourceFile, 'a');
		assert.strictEqual(first.edges[0]?.sourceLine, 1);
	});

	test('affectedNodes walks reverse dependencies', () => {
		const edges = [edge('a', 'core'), edge('b', 'core'), edge('c', 'a')];
		const result = affectedNodes(edges, 'core', 10);
		assert.deepStrictEqual(result.nodeIds, ['a', 'b', 'c']);
		assert.strictEqual(result.truncated, false);
	});

	test('searchNodes seed-first for exact id/path', () => {
		const nodes = [
			node('file:src/util.ts', 'src/util.ts'),
			node('file:src/utils.ts', 'src/utils.ts'),
			node('file:src/helpers/util.ts', 'src/helpers/util.ts'),
		];
		const result = searchNodes(nodes, 'src/util.ts', 10);
		assert.strictEqual(result.seedMatch, true);
		assert.strictEqual(result.nodes[0]?.path, 'src/util.ts');
	});

	test('searchNodes reports truncation', () => {
		const nodes = Array.from({ length: 8 }, (_, i) => node(`file:mod${i}.ts`, `mod${i}.ts`));
		const result = searchNodes(nodes, 'mod', 3);
		assert.strictEqual(result.nodes.length, 3);
		assert.strictEqual(result.truncated, true);
	});

	test('shortestPath respects visit budget without claiming a path', () => {
		const nodes = [node('a'), node('b'), node('c')];
		const edges = [edge('a', 'b'), edge('b', 'c')];
		const result = shortestPath(nodes, edges, 'a', 'c', 2);
		assert.strictEqual(result.found, false);
		assert.strictEqual(result.budgetExceeded, true);
	});
});

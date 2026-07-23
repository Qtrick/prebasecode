/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { explainNode } from '../../core/analysis/explainNode.js';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';

function node(id: string, extras: Partial<GraphNode> = {}): GraphNode {
	return { id, kind: 'file', label: id.split('/').pop() || id, path: id, ...extras };
}

function edge(
	source: string,
	target: string,
	kind: GraphEdge['kind'] = 'import',
	confidence?: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'
): GraphEdge {
	return {
		id: `${kind}:${source}->${target}`,
		source,
		target,
		kind,
		meta: confidence ? { confidence } : undefined,
	};
}

suite('PreBase explainNode', () => {
	test('returns structured local explanation without AI fields', () => {
		const nodes: GraphNode[] = [
			node('hub.ts', {
				meta: {
					communityId: 1,
					communityLabel: 'core',
					degree: 2,
					inDegree: 1,
					outDegree: 1,
				},
			}),
			node('a.ts'),
			node('b.ts'),
			{ id: 'src', kind: 'folder', label: 'src', path: 'src' },
		];
		const edges = [
			edge('a.ts', 'hub.ts', 'import', 'EXTRACTED'),
			edge('hub.ts', 'b.ts', 'import', 'INFERRED'),
			edge('src', 'hub.ts', 'contains', 'AMBIGUOUS'),
		];

		const result = explainNode(nodes, edges, 'hub.ts');
		assert.strictEqual(result.found, true);
		if (!result.found) return;
		assert.strictEqual(result.label, 'hub.ts');
		assert.strictEqual(result.communityId, 1);
		assert.strictEqual(result.communityLabel, 'core');
		assert.strictEqual(result.degrees.degree, 2);
		assert.ok(result.inbound['import']?.some((n) => n.id === 'a.ts'));
		assert.ok(result.inbound['contains']?.some((n) => n.id === 'src'));
		assert.ok(result.outbound['import']?.some((n) => n.id === 'b.ts'));
		assert.strictEqual(result.confidence.EXTRACTED, 1);
		assert.strictEqual(result.confidence.INFERRED, 1);
		assert.strictEqual(result.confidence.AMBIGUOUS, 1);
		assert.strictEqual(result.truncated, false);
		assert.strictEqual(result.notice, undefined);
	});

	test('marks important hub when ranked', () => {
		const nodes = [node('hub'), node('leaf1'), node('leaf2'), node('leaf3')];
		const edges = [
			edge('hub', 'leaf1'),
			edge('hub', 'leaf2'),
			edge('hub', 'leaf3'),
		];
		const result = explainNode(nodes, edges, 'hub');
		assert.strictEqual(result.found, true);
		if (!result.found) return;
		assert.ok(result.important);
		assert.strictEqual(result.important!.rank, 1);
	});

	test('missing node returns found:false', () => {
		const result = explainNode([node('a')], [], 'missing');
		assert.deepStrictEqual(result, { found: false, nodeId: 'missing' });
	});

	test('computes degrees from edges when meta is absent; confidence covers all incident', () => {
		const nodes = [node('hub'), node('a'), node('b')];
		const edges = [
			edge('a', 'hub', 'import', 'EXTRACTED'),
			edge('hub', 'b', 'import', 'INFERRED'),
			edge('hub', 'b', 'contains', 'AMBIGUOUS'),
		];
		const result = explainNode(nodes, edges, 'hub');
		assert.strictEqual(result.found, true);
		if (!result.found) return;
		assert.strictEqual(result.degrees.degree, 2);
		assert.strictEqual(result.degrees.inDegree, 1);
		assert.strictEqual(result.degrees.outDegree, 1);
		const total =
			result.confidence.EXTRACTED +
			result.confidence.INFERRED +
			result.confidence.AMBIGUOUS +
			result.confidence.unknown;
		assert.strictEqual(total, 3);
	});

	test('truncates neighbor lists per edge kind with notice', () => {
		const nodes = [node('hub'), ...Array.from({ length: 14 }, (_, i) => node(`leaf${i}`))];
		const edges = Array.from({ length: 14 }, (_, i) => edge('hub', `leaf${i}`, 'import', 'EXTRACTED'));
		const result = explainNode(nodes, edges, 'hub');
		assert.strictEqual(result.found, true);
		if (!result.found) return;
		assert.strictEqual(result.outbound['import']?.length, 12);
		assert.strictEqual(result.truncated, true);
		assert.ok(result.notice?.includes('truncated'));
		assert.strictEqual(result.confidence.EXTRACTED, 14);
	});
});

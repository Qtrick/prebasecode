/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { findSurprisingConnections } from '../../core/analysis/surprisingConnections.js';
import type { EdgeConfidence, GraphEdge, GraphNode } from '../../common/types/graphTypes.js';

function edge(
	source: string,
	target: string,
	kind: GraphEdge['kind'] = 'import',
	confidence?: EdgeConfidence
): GraphEdge {
	return {
		id: `${kind}:${source}->${target}`,
		source,
		target,
		kind,
		meta: confidence ? { confidence } : undefined,
	};
}

suite('PreBase surprisingConnections', () => {
	test('ranks cross-community import edges by surprise', () => {
		const nodes: GraphNode[] = [
			{ id: 'a', kind: 'file', label: 'a', meta: { communityId: 0 } },
			{ id: 'b', kind: 'file', label: 'b', meta: { communityId: 0 } },
			{ id: 'c', kind: 'file', label: 'c', meta: { communityId: 1 } },
			{ id: 'd', kind: 'file', label: 'd', meta: { communityId: 1 } },
			{ id: 'e', kind: 'file', label: 'e', meta: { communityId: 2 } },
		];
		const edges = [
			edge('a', 'b'),
			edge('c', 'd'),
			edge('a', 'c'), // 0↔1
			edge('a', 'e', 'import', 'AMBIGUOUS'), // 0↔2 — higher confidence bonus
		];
		const hits = findSurprisingConnections(nodes, edges, 10);
		assert.ok(hits.length >= 2);
		assert.strictEqual(hits[0]?.sourceId, 'a');
		assert.strictEqual(hits[0]?.targetId, 'e');
		assert.ok((hits[0]?.surprise ?? 0) > (hits[1]?.surprise ?? 0));
		assert.ok(hits.every((h) => h.sourceCommunity !== h.targetCommunity));
	});

	test('ignores same-community and contains edges', () => {
		const nodes: GraphNode[] = [
			{ id: 'a', kind: 'file', label: 'a', meta: { communityId: 0 } },
			{ id: 'b', kind: 'file', label: 'b', meta: { communityId: 0 } },
			{ id: 'c', kind: 'file', label: 'c', meta: { communityId: 1 } },
			{ id: 'folder', kind: 'folder', label: 'src', meta: { communityId: 0 } },
		];
		const edges = [
			edge('a', 'b'),
			edge('folder', 'c', 'contains'),
		];
		assert.deepStrictEqual(findSurprisingConnections(nodes, edges, 10), []);
	});

	test('dedupes to one edge per community pair', () => {
		const nodes: GraphNode[] = [
			{ id: 'a1', kind: 'file', label: 'a1', meta: { communityId: 0 } },
			{ id: 'a2', kind: 'file', label: 'a2', meta: { communityId: 0 } },
			{ id: 'b1', kind: 'file', label: 'b1', meta: { communityId: 1 } },
			{ id: 'b2', kind: 'file', label: 'b2', meta: { communityId: 1 } },
		];
		const edges = [
			edge('a1', 'b1'),
			edge('a2', 'b2'),
			edge('a1', 'b2'),
		];
		const hits = findSurprisingConnections(nodes, edges, 10);
		assert.strictEqual(hits.length, 1);
		assert.deepStrictEqual(
			[hits[0]!.sourceCommunity, hits[0]!.targetCommunity].sort((x, y) => x - y),
			[0, 1]
		);
	});

	test('respects top N and is deterministic', () => {
		const nodes: GraphNode[] = [
			{ id: 'n0', kind: 'file', label: 'n0', meta: { communityId: 0 } },
			{ id: 'n1', kind: 'file', label: 'n1', meta: { communityId: 1 } },
			{ id: 'n2', kind: 'file', label: 'n2', meta: { communityId: 2 } },
			{ id: 'n3', kind: 'file', label: 'n3', meta: { communityId: 3 } },
		];
		const edges = [
			edge('n0', 'n1'),
			edge('n0', 'n2'),
			edge('n0', 'n3'),
		];
		const a = findSurprisingConnections(nodes, edges, 2);
		const b = findSurprisingConnections(nodes, edges, 2);
		assert.strictEqual(a.length, 2);
		assert.deepStrictEqual(a, b);
	});

	test('rarer community-pair edges outrank dense pairs at same confidence', () => {
		const nodes: GraphNode[] = [
			{ id: 'a', kind: 'file', label: 'a', meta: { communityId: 0 } },
			{ id: 'b', kind: 'file', label: 'b', meta: { communityId: 1 } },
			{ id: 'c', kind: 'file', label: 'c', meta: { communityId: 1 } },
			{ id: 'd', kind: 'file', label: 'd', meta: { communityId: 2 } },
		];
		const edges = [
			edge('a', 'b'),
			edge('a', 'c'), // dense 0↔1 (2 edges)
			edge('a', 'd'), // rare 0↔2 (1 edge)
		];
		const hits = findSurprisingConnections(nodes, edges, 10);
		assert.strictEqual(hits[0]?.targetCommunity, 2);
		assert.ok((hits[0]?.surprise ?? 0) >= (hits[1]?.surprise ?? 0));
	});
});

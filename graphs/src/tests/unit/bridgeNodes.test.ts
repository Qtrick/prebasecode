/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { findBridgeNodes } from '../../core/analysis/bridgeNodes.js';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';

function edge(source: string, target: string, kind: GraphEdge['kind'] = 'import'): GraphEdge {
	return { id: `${kind}:${source}->${target}`, source, target, kind };
}

suite('PreBase bridgeNodes', () => {
	test('finds nodes spanning 2+ communities via import edges', () => {
		const nodes: GraphNode[] = [
			{ id: 'a', kind: 'file', label: 'a', meta: { communityId: 0 } },
			{ id: 'b', kind: 'file', label: 'b', meta: { communityId: 0 } },
			{ id: 'c', kind: 'file', label: 'c', meta: { communityId: 0 } },
			{ id: 'd', kind: 'file', label: 'd', meta: { communityId: 1 } },
			{ id: 'e', kind: 'file', label: 'e', meta: { communityId: 1 } },
			{ id: 'f', kind: 'file', label: 'f', meta: { communityId: 1 } },
			{ id: 'hub', kind: 'file', label: 'hub', meta: { communityId: 0 } },
		];
		const edges = [
			edge('a', 'b'), edge('b', 'c'), edge('c', 'a'),
			edge('d', 'e'), edge('e', 'f'), edge('f', 'd'),
			edge('hub', 'a'),
			edge('hub', 'd'),
		];
		const bridges = findBridgeNodes(nodes, edges, 10);
		assert.ok(bridges.some((b) => b.id === 'hub'));
		const hub = bridges.find((b) => b.id === 'hub')!;
		assert.deepStrictEqual(hub.communities, [0, 1]);
		assert.strictEqual(hub.crossEdgeCount, 1);
		assert.ok(bridges.some((b) => b.id === 'd'));
	});

	test('sorts by crossEdgeCount desc then id', () => {
		const nodes = [
			{ id: 'bridge-a', kind: 'file' as const, label: 'a', meta: { communityId: 0 } },
			{ id: 'bridge-b', kind: 'file' as const, label: 'b', meta: { communityId: 0 } },
			{ id: 'c1', kind: 'file' as const, label: 'c1', meta: { communityId: 1 } },
			{ id: 'c2', kind: 'file' as const, label: 'c2', meta: { communityId: 2 } },
			{ id: 'c3', kind: 'file' as const, label: 'c3', meta: { communityId: 3 } },
		];
		const edges = [
			edge('bridge-a', 'c1'),
			edge('bridge-a', 'c2'),
			edge('bridge-b', 'c1'),
			edge('bridge-b', 'c2'),
			edge('bridge-b', 'c3'),
		];
		const bridges = findBridgeNodes(nodes, edges, 10);
		assert.strictEqual(bridges[0]?.id, 'bridge-b');
		assert.strictEqual(bridges[0]?.crossEdgeCount, 3);
		assert.strictEqual(bridges[1]?.id, 'bridge-a');
		assert.strictEqual(bridges[1]?.crossEdgeCount, 2);
	});

	test('ignores contains edges for bridging', () => {
		const nodes = [
			{ id: 'folder', kind: 'folder' as const, label: 'src', meta: { communityId: 0 } },
			{ id: 'a', kind: 'file' as const, label: 'a', meta: { communityId: 1 } },
			{ id: 'b', kind: 'file' as const, label: 'b', meta: { communityId: 2 } },
		];
		const edges = [
			edge('folder', 'a', 'contains'),
			edge('folder', 'b', 'contains'),
		];
		const bridges = findBridgeNodes(nodes, edges, 10);
		assert.deepStrictEqual(bridges, []);
	});

	test('deterministic across two runs', () => {
		const nodes = [
			{ id: 'x', kind: 'file' as const, label: 'x', meta: { communityId: 0 } },
			{ id: 'y', kind: 'file' as const, label: 'y', meta: { communityId: 1 } },
			{ id: 'z', kind: 'file' as const, label: 'z', meta: { communityId: 2 } },
		];
		const edges = [edge('x', 'y'), edge('x', 'z')];
		assert.deepStrictEqual(findBridgeNodes(nodes, edges, 5), findBridgeNodes(nodes, edges, 5));
	});

	test('partial community meta keeps labeled ids (no full remap)', () => {
		const nodes: GraphNode[] = [
			{ id: 'a', kind: 'file', label: 'a', meta: { communityId: 7 } },
			{ id: 'b', kind: 'file', label: 'b', meta: { communityId: 9 } },
			{ id: 'c', kind: 'file', label: 'c' }, // unlabeled — ignored for community map
		];
		const edges = [edge('a', 'b'), edge('a', 'c')];
		const bridges = findBridgeNodes(nodes, edges, 10);
		const hit = bridges.find((b) => b.id === 'a');
		assert.ok(hit);
		assert.deepStrictEqual(hit!.communities, [7, 9]);
	});
});

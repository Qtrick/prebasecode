/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { applyCommunitiesToNodes, detectCommunities, isNodeCommunityHidden, listCommunitySummaries, normalizeHiddenCommunityIds } from '../../core/analysis/communities.js';
import { rankImportantNodes } from '../../core/analysis/importantNodes.js';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';

function node(id: string, label = id, kind: GraphNode['kind'] = 'file'): GraphNode {
	return { id, kind, label, path: id };
}

function edge(source: string, target: string, kind: GraphEdge['kind'] = 'import'): GraphEdge {
	return { id: `${kind}:${source}->${target}`, source, target, kind };
}

suite('PreBase communities', () => {
	test('stable community ids across two runs', () => {
		const nodes = [node('a'), node('b'), node('c'), node('d'), node('e')];
		const edges = [
			edge('a', 'b'),
			edge('b', 'c'),
			edge('c', 'a'),
			edge('d', 'e'),
		];
		const first = detectCommunities(nodes, edges);
		const second = detectCommunities(nodes, edges);
		assert.deepStrictEqual([...first.byNode.entries()].sort(), [...second.byNode.entries()].sort());
		const applied1 = applyCommunitiesToNodes(nodes.map((n) => ({ ...n, meta: {} })), edges);
		const applied2 = applyCommunitiesToNodes(nodes.map((n) => ({ ...n, meta: {} })), edges);
		assert.deepStrictEqual(
			applied1.map((n) => ({ id: n.id, c: n.meta?.communityId, l: n.meta?.communityLabel })).sort((a, b) => a.id.localeCompare(b.id)),
			applied2.map((n) => ({ id: n.id, c: n.meta?.communityId, l: n.meta?.communityLabel })).sort((a, b) => a.id.localeCompare(b.id)),
		);
	});

	test('disconnected graph gets separate communities with stable remapping', () => {
		const nodes = [node('x'), node('y'), node('z')];
		const edges: GraphEdge[] = [];
		const result = detectCommunities(nodes, edges);
		assert.strictEqual(result.members.size, 3);
		assert.strictEqual(result.byNode.get('x'), 0);
		assert.strictEqual(result.byNode.get('y'), 1);
		assert.strictEqual(result.byNode.get('z'), 2);
		const again = detectCommunities(nodes, edges);
		assert.deepStrictEqual([...result.byNode.entries()], [...again.byNode.entries()]);
	});

	test('listCommunitySummaries sorts by count desc then id', () => {
		const nodes: GraphNode[] = [
			{ id: 'a', kind: 'file', label: 'a', meta: { communityId: 1, communityLabel: 'hub-b' } },
			{ id: 'b', kind: 'file', label: 'b', meta: { communityId: 1, communityLabel: 'hub-b' } },
			{ id: 'c', kind: 'file', label: 'c', meta: { communityId: 0, communityLabel: 'hub-a' } },
			{ id: 'd', kind: 'file', label: 'd', meta: { communityId: 2, communityLabel: 'hub-d' } },
			{ id: 'e', kind: 'file', label: 'e', meta: { communityId: 2, communityLabel: 'hub-d' } },
			{ id: 'f', kind: 'file', label: 'f', meta: { communityId: 2, communityLabel: 'hub-d' } },
			{ id: 'g', kind: 'file', label: 'g' },
		];
		assert.deepStrictEqual(listCommunitySummaries(nodes), [
			{ id: 2, label: 'hub-d', count: 3 },
			{ id: 1, label: 'hub-b', count: 2 },
			{ id: 0, label: 'hub-a', count: 1 },
		]);
	});

	test('important nodes exclude folders and ignore contains-only degree', () => {
		const nodes = [
			node('folder:src', 'src', 'folder'),
			node('file:hub.ts', 'hub.ts'),
			node('file:leaf.ts', 'leaf.ts'),
			{ id: 'file:gen.ts', kind: 'file' as const, label: 'gen.ts', path: 'src/__generated__/gen.ts' },
		];
		const edges = [
			edge('folder:src', 'file:hub.ts', 'contains'),
			edge('folder:src', 'file:leaf.ts', 'contains'),
			edge('folder:src', 'file:gen.ts', 'contains'),
			edge('file:hub.ts', 'file:leaf.ts', 'import'),
		];
		const ranked = rankImportantNodes(nodes, edges, 10);
		assert.ok(!ranked.some((h) => h.id === 'folder:src'));
		assert.ok(!ranked.some((h) => h.id === 'file:gen.ts'));
		assert.strictEqual(ranked[0]?.id, 'file:hub.ts');
		assert.strictEqual(ranked[0]?.degree, 1);
	});

	test('contains edges do not glue disconnected import components', () => {
		const nodes = [
			node('folder:src', 'src', 'folder'),
			node('file:a.ts', 'a.ts'),
			node('file:b.ts', 'b.ts'),
		];
		const edges = [
			edge('folder:src', 'file:a.ts', 'contains'),
			edge('folder:src', 'file:b.ts', 'contains'),
		];
		const result = detectCommunities(nodes, edges);
		// No import/dependency links → each node stays its own community (folder glue rejected).
		assert.strictEqual(result.members.size, 3);
		assert.notStrictEqual(result.byNode.get('file:a.ts'), result.byNode.get('file:b.ts'));
	});

	test('hidden community helpers normalize and match', () => {
		assert.deepStrictEqual(normalizeHiddenCommunityIds([2, 1, 2, Number.NaN]), [1, 2]);
		assert.strictEqual(isNodeCommunityHidden(1, [1, 2]), true);
		assert.strictEqual(isNodeCommunityHidden(3, [1, 2]), false);
		assert.strictEqual(isNodeCommunityHidden(undefined, [1]), false);
		assert.strictEqual(isNodeCommunityHidden(1, new Set([1])), true);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { projectTemporalVisibleSet, resolveTemporalProjectionTier } from '../../view/temporal/temporalProjection.js';
import type { TemporalCommunityGuide, TemporalRenderNode } from '../../temporal/view/temporalViewTypes.js';

function leaf(id: string, x: number, y: number, changeKind: TemporalRenderNode['changeKind'] = 'unchanged'): TemporalRenderNode {
	return {
		entityId: id,
		canonicalNodeId: id,
		path: `src/${id}.ts`,
		label: id,
		kind: 'file',
		x,
		y,
		changeKind,
	};
}

function guide(id: string, memberIds: string[], x: number, y: number): TemporalCommunityGuide {
	return {
		id,
		label: id,
		layerId: 'other',
		color: '#6366f1',
		x,
		y,
		radius: 40,
		bounds: { minX: x - 40, minY: y - 40, maxX: x + 40, maxY: y + 40, width: 80, height: 80 },
		nodeIds: memberIds,
		nodeCount: memberIds.length,
	};
}

function makeLargeGraph(communityCount: number, perCommunity: number) {
	const nodes: TemporalRenderNode[] = [];
	const guides: TemporalCommunityGuide[] = [];
	for (let c = 0; c < communityCount; c++) {
		const ids: string[] = [];
		for (let i = 0; i < perCommunity; i++) {
			const id = `c${c}_${i}`;
			ids.push(id);
			nodes.push(leaf(id, c * 120 + i, c * 80, i === 0 && c % 3 === 0 ? 'modified' : 'unchanged'));
		}
		guides.push(guide(`comm${c}`, ids, c * 120, c * 80));
	}
	return { nodes, guides };
}

suite('Temporal node-level LOD projection', () => {
	test('small Full Map stays leaf-visible at Fit zoom', () => {
		const nodes = [leaf('a', -40, 0), leaf('b', 0, 0, 'added'), leaf('c', 40, 0, 'modified')];
		const projection = projectTemporalVisibleSet(nodes, [], { zoom: 1, displayMode: 'state' });
		assert.strictEqual(projection.tier, 'detail');
		assert.strictEqual(projection.leafNodesDrawn, 3);
		assert.strictEqual(projection.aggregateNodesDrawn, 0);
	});

	test('10k-class overview draws community aggregates, not every leaf', () => {
		const { nodes, guides } = makeLargeGraph(40, 250);
		assert.ok(nodes.length >= 9000);
		const t0 = Date.now();
		const projection = projectTemporalVisibleSet(nodes, guides, { zoom: 0.21, displayMode: 'state' });
		const elapsed = Date.now() - t0;
		assert.ok(elapsed < 1000, `10k projection took ${elapsed}ms — likely an O(N²) hot path`);
		assert.strictEqual(projection.tier, 'overview');
		assert.strictEqual(projection.receivedLeafNodeCount, nodes.length);
		assert.ok(projection.aggregateNodesDrawn >= 30, `aggregates ${projection.aggregateNodesDrawn}`);
		assert.ok(projection.leafNodesDrawn < nodes.length * 0.08, `leaves drawn ${projection.leafNodesDrawn} of ${nodes.length}`);
		assert.ok(projection.leafNodesDrawn + projection.aggregateNodesDrawn < nodes.length * 0.1, 'must not draw the 9679-dot blob');
		assert.ok(projection.visibleChangedNodeCount > 0);
		assert.ok(projection.visibleChangedAggregateCount > 0);
		const firstAgg = projection.items.find(item => item.kind === 'aggregate');
		assert.ok(firstAgg && firstAgg.kind === 'aggregate');
		assert.deepStrictEqual([...firstAgg.memberIds], [...guides[0].nodeIds]);
		const nodeIds = new Set(nodes.map(n => n.entityId));
		for (const item of projection.items) {
			if (item.kind !== 'aggregate') continue;
			for (const id of item.memberIds) {
				assert.ok(nodeIds.has(id), `aggregate ${item.guideId} member ${id} must be a real entity`);
			}
		}
	});

	test('changed, selected, hovered, search, and current-file nodes pierce overview aggregates', () => {
		const { nodes: baseNodes, guides } = makeLargeGraph(8, 80);
		const nodes = baseNodes.map((node, index) => {
			if (index === 3) {
				return { ...node, changeKind: 'added' as const };
			}
			if (index === 7) {
				return { ...node, canonicalNodeId: 'canonical-selected' };
			}
			return node;
		});
		const projection = projectTemporalVisibleSet(nodes, guides, {
			zoom: 0.2,
			displayMode: 'state',
			selectedEntityId: 'canonical-selected',
			hoveredEntityId: nodes[11].entityId,
			searchQuery: 'c2_5',
			currentFileEntityId: nodes[20].entityId,
		});
		const leafIds = projection.items.filter(item => item.kind === 'leaf').map(item => item.entityId);
		assert.ok(leafIds.includes(nodes[3].entityId), 'changed node must pierce');
		assert.ok(leafIds.includes(nodes[7].entityId), 'selected canonical id must pierce');
		assert.ok(leafIds.includes(nodes[11].entityId), 'hovered node must pierce');
		assert.ok(leafIds.includes(nodes[20].entityId), 'current-file node must pierce');
		assert.ok(leafIds.includes('c2_5'), 'search hit must pierce');
		const unchangedBuried = nodes.find(n => n.changeKind === 'unchanged' && n.entityId === 'c1_10');
		assert.ok(unchangedBuried);
		assert.ok(!leafIds.includes(unchangedBuried.entityId), 'ordinary unchanged leaves stay aggregated');
	});

	test('expanding a community reveals its real member entity IDs, and a selected leaf stays visible', () => {
		const { nodes, guides } = makeLargeGraph(6, 60);
		const closed = projectTemporalVisibleSet(nodes, guides, { zoom: 0.2, displayMode: 'state' });
		const selectedId = guides[2].nodeIds[4];
		const opened = projectTemporalVisibleSet(nodes, guides, {
			zoom: 0.2,
			displayMode: 'state',
			expandedGuideId: guides[0].id,
			selectedEntityId: selectedId,
		});
		assert.ok(opened.leafNodesDrawn > closed.leafNodesDrawn);
		const openedLeaves = new Set(opened.items.filter(item => item.kind === 'leaf').map(item => item.entityId));
		for (const id of guides[0].nodeIds) {
			assert.ok(openedLeaves.has(id), `member ${id} must appear after drill-down`);
			assert.ok(!id.startsWith('agg:'), 'drill-down members must be real entity IDs');
		}
		assert.ok(openedLeaves.has(selectedId), 'selected node in another community must remain a leaf');
		const selectedAgg = opened.items.find(item => item.kind === 'aggregate' && item.guideId === guides[2].id);
		assert.ok(selectedAgg && selectedAgg.kind === 'aggregate');
		assert.ok(selectedAgg.memberIds.includes(selectedId));
	});

	test('viewport culling drops off-screen detail leaves', () => {
		const nodes = [
			leaf('on', 0, 0),
			leaf('off', 4000, 0),
		];
		const projection = projectTemporalVisibleSet(nodes, [], {
			zoom: 1.2,
			displayMode: 'state',
			viewport: { minX: -40, minY: -40, maxX: 40, maxY: 40 },
		});
		assert.strictEqual(projection.tier, 'detail');
		assert.strictEqual(projection.leafNodesDrawn, 1);
		assert.strictEqual(projection.culledLeafCount, 1);
	});

	test('projection is deterministic for the same inputs', () => {
		const { nodes, guides } = makeLargeGraph(12, 40);
		const a = projectTemporalVisibleSet(nodes, guides, { zoom: 0.22, displayMode: 'state' });
		const b = projectTemporalVisibleSet(nodes, guides, { zoom: 0.22, displayMode: 'state' });
		assert.deepStrictEqual(a.items.map(item => item.entityId), b.items.map(item => item.entityId));
		assert.strictEqual(a.tier, b.tier);
	});

	test('tier boundaries stay stable', () => {
		assert.strictEqual(resolveTemporalProjectionTier(0.21, 9679, 40, 'state'), 'overview');
		assert.strictEqual(resolveTemporalProjectionTier(0.49, 401, 10, 'state'), 'overview');
		assert.strictEqual(resolveTemporalProjectionTier(0.5, 401, 10, 'state'), 'medium');
		assert.strictEqual(resolveTemporalProjectionTier(0.84, 200, 8, 'state'), 'medium');
		assert.strictEqual(resolveTemporalProjectionTier(0.85, 200, 8, 'state'), 'detail');
		assert.strictEqual(resolveTemporalProjectionTier(1.2, 9679, 40, 'state'), 'detail');
		assert.strictEqual(resolveTemporalProjectionTier(0.2, 20, 4, 'state'), 'medium');
		assert.strictEqual(resolveTemporalProjectionTier(0.3, 300, 12, 'changes'), 'medium');
		assert.strictEqual(resolveTemporalProjectionTier(0.4, 300, 12, 'changes'), 'detail');
		assert.strictEqual(resolveTemporalProjectionTier(0.2, 300, 12, 'focus'), 'medium');
	});

	test('hovered, search, and current-file piercing survive a second identical projection', () => {
		const { nodes, guides } = makeLargeGraph(10, 50);
		const options = {
			zoom: 0.2,
			displayMode: 'state' as const,
			selectedEntityId: nodes[8].entityId,
			hoveredEntityId: nodes[9].entityId,
			searchQuery: 'c4_2',
			currentFileEntityId: nodes[12].entityId,
		};
		const first = projectTemporalVisibleSet(nodes, guides, options);
		const second = projectTemporalVisibleSet(nodes, guides, options);
		const firstLeaves = first.items.filter(item => item.kind === 'leaf').map(item => item.entityId);
		const secondLeaves = second.items.filter(item => item.kind === 'leaf').map(item => item.entityId);
		assert.deepStrictEqual(firstLeaves, secondLeaves);
		for (const id of [nodes[8].entityId, nodes[9].entityId, 'c4_2', nodes[12].entityId]) {
			assert.ok(secondLeaves.includes(id), `${id} must persist as a piercing leaf`);
		}
	});

	test('overview aggregates skip empty guides and map every member id onto a real leaf', () => {
		const { nodes, guides } = makeLargeGraph(5, 40);
		const ghost = guide('ghost', ['missing-a', 'missing-b'], 900, 0);
		const projection = projectTemporalVisibleSet(nodes, [...guides, ghost], { zoom: 0.2, displayMode: 'state' });
		const nodeIds = new Set(nodes.map(n => n.entityId));
		const aggregates = projection.items.filter(item => item.kind === 'aggregate');
		assert.strictEqual(projection.aggregateNodesDrawn, guides.length);
		assert.ok(!aggregates.some(item => item.kind === 'aggregate' && item.guideId === 'ghost'));
		for (const item of aggregates) {
			if (item.kind !== 'aggregate') continue;
			assert.ok(item.memberIds.length > 0);
			for (const id of item.memberIds) {
				assert.ok(nodeIds.has(id), `aggregate ${item.guideId} member ${id} must be a real entity`);
			}
			assert.deepStrictEqual([...item.memberIds], [...projection.memberIdsByAggregateId.get(item.guideId)!]);
		}
	});

	test('empty or undefined inputs yield an empty projection without throwing', () => {
		const empty = projectTemporalVisibleSet(undefined, undefined, { zoom: 0.2 });
		assert.strictEqual(empty.receivedLeafNodeCount, 0);
		assert.strictEqual(empty.leafNodesDrawn, 0);
		assert.strictEqual(empty.aggregateNodesDrawn, 0);
		assert.strictEqual(empty.items.length, 0);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	computeCommunityAggregateEdges,
	computeEdgeLodStyle,
	computeAggregateEdgeRoute,
} from '../../temporal/view/temporalEdgeLod.js';
import { projectTemporalVisibleSet } from '../../view/temporal/temporalProjection.js';
import type {
	TemporalRenderEdge,
	TemporalCommunityGuide,
} from '../../temporal/view/temporalViewTypes.js';

suite('TemporalEdgeLod (Unit - Aggregation & Level of Detail Tiers)', () => {
	function makeGuide(id: string, nodeIds: string[]): TemporalCommunityGuide {
		return {
			id,
			label: id,
			layerId: 'services',
			color: '#6366f1',
			x: 0,
			y: 0,
			radius: 80,
			bounds: { minX: -80, minY: -80, maxX: 80, maxY: 80, width: 160, height: 160 },
			nodeIds,
			nodeCount: nodeIds.length,
		};
	}

	function makeEdge(id: string, src: string, tgt: string, changeKind: any = 'unchanged'): TemporalRenderEdge {
		return {
			edgeId: id,
			sourceEntityId: src,
			targetEntityId: tgt,
			sourcePath: `src/${src}.ts`,
			targetPath: `src/${tgt}.ts`,
			kind: 'imports',
			changeKind,
		};
	}

	test('1. Community Aggregation: Cross-community edges are aggregated with count and change summary', () => {
		const guides = [
			makeGuide('commA', ['a1', 'a2']),
			makeGuide('commB', ['b1', 'b2']),
		];

		const edges = [
			makeEdge('e1', 'a1', 'b1', 'unchanged'),
			makeEdge('e2', 'a2', 'b1', 'modified'),
			makeEdge('e3', 'a1', 'a2', 'unchanged'), // Intra-community (should NOT create cross-community aggregate)
		];

		const agg = computeCommunityAggregateEdges(edges, guides);
		assert.equal(agg.length, 1);
		assert.equal(agg[0].sourceCommunityId, 'commA');
		assert.equal(agg[0].targetCommunityId, 'commB');
		assert.equal(agg[0].edgeCount, 2);
		assert.equal(agg[0].changedEdgeCount, 1);
		assert.equal(agg[0].isHighlighted, true);
	});

	test('2. Edge LOD Tiers: Overview zoom suppresses unchanged background edges, preserves changed and active', () => {
		const unchangedEdge = makeEdge('e1', 'u1', 'u2', 'unchanged');
		const changedEdge = makeEdge('e2', 'c1', 'c2', 'modified');
		const activeEdge = makeEdge('e3', 'a1', 'a2', 'unchanged');

		// Far zoom (k = 0.40)
		const styleUnchangedFar = computeEdgeLodStyle(unchangedEdge, 0.40);
		assert.equal(styleUnchangedFar.shouldRender, false, 'Unchanged edge must be suppressed at far zoom to avoid hairball');

		const styleChangedFar = computeEdgeLodStyle(changedEdge, 0.40);
		assert.equal(styleChangedFar.shouldRender, true, 'Changed edge must ALWAYS render at any zoom');

		const styleActiveFar = computeEdgeLodStyle(activeEdge, 0.40, { isConnectedToActive: true });
		assert.equal(styleActiveFar.shouldRender, true, 'Active selected/hovered edge must ALWAYS render at any zoom');
		assert.equal(styleActiveFar.isHighlighted, true);
	});

	test('3. Edge LOD Tiers: Detail zoom renders individual dependency edges with full opacity', () => {
		const unchangedEdge = makeEdge('e1', 'u1', 'u2', 'unchanged');

		// Detail zoom (k = 1.30)
		const styleDetail = computeEdgeLodStyle(unchangedEdge, 1.30);
		assert.equal(styleDetail.shouldRender, true);
		assert.ok(styleDetail.opacity >= 0.5);
	});

	test('4. Active drag/pan interaction drops low-priority unchanged edges for 60fps fluidity', () => {
		const unchangedEdge = makeEdge('e1', 'u1', 'u2', 'unchanged');
		const changedEdge = makeEdge('e2', 'c1', 'c2', 'added');

		const styleDragUnchanged = computeEdgeLodStyle(unchangedEdge, 1.0, { isInteracting: true });
		assert.equal(styleDragUnchanged.shouldRender, false, 'Drag interaction must drop low-priority unchanged edges');

		const styleDragChanged = computeEdgeLodStyle(changedEdge, 1.0, { isInteracting: true });
		assert.equal(styleDragChanged.shouldRender, true, 'Drag interaction must retain changed focus edges');
	});

	test('5. Aggregate routes: lane index and community hash keep parallel corridors from collapsing into one spear', () => {
		const lanes = [0, 1, 2, 3, 4].map(i =>
			computeAggregateEdgeRoute(0, 0, 0, 400, 40, 40, i, 5, 'commSrc', 'commTgt'),
		);
		for (let i = 1; i < lanes.length; i++) {
			const sep = Math.hypot(lanes[i].cpX - lanes[i - 1].cpX, lanes[i].cpY - lanes[i - 1].cpY);
			assert.ok(sep >= 10, `lane step separation must be visible (got ${sep})`);
		}

		const corridorPairs = [
			['alpha', 'beta'],
			['gamma', 'delta'],
			['epsilon', 'zeta'],
			['eta', 'theta'],
			['iota', 'kappa'],
			['lambda', 'mu'],
		] as const;
		const cps = corridorPairs.map(([a, b], i) =>
			computeAggregateEdgeRoute(50, 0, 50, 450, 28, 28, i % 3, 3, a, b),
		);
		const unique = new Set(cps.map(p => `${p.cpX.toFixed(1)},${p.cpY.toFixed(1)}`));
		assert.ok(unique.size >= 4, `hash+lane diversification must yield multiple control points (got ${unique.size})`);
		assert.notEqual(cps[0].cpX, 50, 'control point must leave the shared vertical mid-line');
	});

	test('6. Overview node aggregates reuse community guide IDs from temporalEdgeLod, not a second system', () => {
		const guides = [
			makeGuide('commA', Array.from({ length: 80 }, (_, i) => `a${i}`)),
			makeGuide('commB', Array.from({ length: 80 }, (_, i) => `b${i}`)),
		];
		const nodes = [...guides[0].nodeIds, ...guides[1].nodeIds].map((id, i) => ({
			entityId: id,
			canonicalNodeId: id,
			path: `src/${id}.ts`,
			label: id,
			kind: 'file' as const,
			x: i * 10,
			y: 0,
			changeKind: 'unchanged' as const,
		}));
		const edges = [
			makeEdge('e1', 'a1', 'b1', 'unchanged'),
			makeEdge('e2', 'a2', 'b2', 'modified'),
		];
		const projection = projectTemporalVisibleSet(nodes as any, guides, { zoom: 0.2, displayMode: 'state' });
		const aggEdges = computeCommunityAggregateEdges(edges, guides);
		const guideIds = new Set(projection.items.filter(item => item.kind === 'aggregate').map(item => item.guideId));
		assert.ok(guideIds.has('commA') && guideIds.has('commB'));
		assert.equal(aggEdges.length, 1);
		assert.ok(guideIds.has(aggEdges[0].sourceCommunityId));
		assert.ok(guideIds.has(aggEdges[0].targetCommunityId));
		assert.equal(aggEdges[0].edgeCount, 2);
		assert.equal(aggEdges[0].changedEdgeCount, 1);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	computeCommunityAggregateEdges,
	computeEdgeLodStyle,
} from '../../temporal/view/temporalEdgeLod.js';
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
});

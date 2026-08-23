/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	computeTemporalFocusContext,
	computeTemporalVisualRadius,
	computeTemporalFitTransform,
} from '../../view/temporal/temporalFocusContext.js';
import {
	computeTopologyInformedInitialLayout,
} from '../../temporal/view/temporalLayoutEngine.js';
import { computeTemporalStructuralDiff } from '../../temporal/view/temporalStructuralDiff.js';
import type {
	TemporalStructuralDiff,
	TemporalRenderNode,
	TemporalRenderEdge,
} from '../../temporal/view/temporalViewTypes.js';
import type { TemporalEntitySnapshot, TemporalEdgeSnapshot } from '../../temporal/common/temporalTypes.js';

suite('TemporalFocusContext (Unit - Focus+Context & Spatial Quality)', () => {
	function makeEntity(entityId: string, path: string): TemporalEntitySnapshot {
		return {
			entityId,
			commitSha: 'commit-test',
			path,
			nodeData: {
				id: entityId,
				kind: 'file',
				label: path.split('/').pop() || path,
				path,
			} as any,
		};
	}

	function makeEdge(edgeId: string, sourceEntityId: string, targetEntityId: string): TemporalEdgeSnapshot {
		return {
			edgeId,
			commitSha: 'commit-test',
			sourceEntityId,
			targetEntityId,
			kind: 'imports',
			edgeData: {
				id: edgeId,
				source: sourceEntityId,
				target: targetEntityId,
				kind: 'imports',
			} as any,
		};
	}

	function makeRenderNode(entityId: string, path: string, changeKind: TemporalRenderNode['changeKind'], x = 0, y = 0): TemporalRenderNode {
		return {
			entityId,
			canonicalNodeId: `can-${entityId}`,
			path,
			label: path.split('/').pop() || path,
			kind: 'file',
			x,
			y,
			changeKind,
		};
	}

	function makeRenderEdge(edgeId: string, sourceEntityId: string, targetEntityId: string, changeKind: TemporalRenderEdge['changeKind']): TemporalRenderEdge {
		return {
			edgeId,
			sourceEntityId,
			targetEntityId,
			sourcePath: `src/${sourceEntityId}.ts`,
			targetPath: `src/${targetEntityId}.ts`,
			kind: 'imports',
			changeKind,
		};
	}

	test('1. Focus+Context Culling: 2 changed nodes in a 280-node codebase return ONLY changed + 1-hop context', () => {
		// Build 280-node linear / star topology
		const baseEntities: TemporalEntitySnapshot[] = [];
		const baseEdges: TemporalEdgeSnapshot[] = [];
		for (let i = 0; i < 280; i++) {
			baseEntities.push(makeEntity(`ent-${i}`, `src/module_${i % 10}/file_${i}.ts`));
			if (i > 0) {
				baseEdges.push(makeEdge(`edge-${i}`, `ent-${Math.floor(i / 5)}`, `ent-${i}`));
			}
		}

		// In target commit: 2 nodes are modified (ent-10 and ent-20)
		const targetEntities = baseEntities.map(e => {
			if (e.entityId === 'ent-10' || e.entityId === 'ent-20') {
				return {
					...e,
					nodeData: { ...e.nodeData, label: 'modified_' + e.entityId },
				};
			}
			return e;
		});

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, baseEdges, 'commit-1', baseEntities, baseEdges);

		// Assert Focus+Context in 'focused' mode
		const focused = computeTemporalFocusContext(diff as any, 'changes', 'focused');
		assert.equal(focused.changedNodeIds.size, 2, 'Must have exactly 2 focus nodes');

		// The visible nodes must ONLY contain the 2 changed nodes and their 1-hop neighbors
		assert.ok(
			focused.visibleNodes.length > 2 && focused.visibleNodes.length <= 20,
			`Visible nodes in focused mode (${focused.visibleNodes.length}) must be small subset (changed + 1-hop context), not all 280`
		);

		for (const node of focused.visibleNodes) {
			const isFocus = focused.changedNodeIds.has(node.entityId);
			const isDirect = focused.directContextNodeIds.has(node.entityId);
			assert.ok(isFocus || isDirect, `Visible node ${node.entityId} must be either focus or direct 1-hop context`);
		}

		// In 'full' context mode: all nodes are returned
		const full = computeTemporalFocusContext(diff as any, 'changes', 'full');
		assert.equal(full.visibleNodes.length, 280, 'Full context mode must include all 280 nodes');
		assert.equal(full.changedNodeIds.size, 2, 'Full context mode must identify exactly 2 focus nodes');
	});

	test('2. State Mode Invariants: State mode returns all active nodes and excludes removed ghosts', () => {
		const baseEntities = [
			makeEntity('ent-1', 'src/kept.ts'),
			makeEntity('ent-del', 'src/deleted.ts'),
		];
		const targetEntities = [
			makeEntity('ent-1', 'src/kept.ts'),
			makeEntity('ent-new', 'src/added.ts'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, [], 'commit-1', baseEntities, []);

		// In changes mode, removed node is included
		const changesMode = computeTemporalFocusContext(diff as any, 'changes', 'full');
		assert.ok(changesMode.visibleNodes.some(n => n.entityId === 'ent-del'), 'Changes mode must include deleted ghost');

		// In state mode, removed node is strictly omitted
		const stateMode = computeTemporalFocusContext(diff as any, 'state', 'full');
		assert.ok(!stateMode.visibleNodes.some(n => n.entityId === 'ent-del'), 'State mode must omit deleted ghost');
		assert.ok(stateMode.visibleNodes.some(n => n.entityId === 'ent-1'), 'State mode must include existing node');
		assert.ok(stateMode.visibleNodes.some(n => n.entityId === 'ent-new'), 'State mode must include added node');
	});

	test('3. Visual Hierarchy Radius: Changed nodes (5.5-7.5px) dominate context nodes (3-4px)', () => {
		const changedNode = makeRenderNode('ent-changed', 'src/mod.ts', 'modified', 0, 0);
		const contextNode = makeRenderNode('ent-ctx', 'src/ctx.ts', 'unchanged', 10, 10);

		const rChanged = computeTemporalVisualRadius(changedNode);
		const rContext = computeTemporalVisualRadius(contextNode);

		assert.ok(rChanged >= 5.5 && rChanged <= 7.5, `Changed node radius (${rChanged}) must be 5.5-7.5px`);
		assert.ok(rContext >= 3.0 && rContext <= 4.0, `Context node radius (${rContext}) must be 3.0-4.0px`);
		assert.ok(rChanged > rContext * 1.4, 'Changed node must visually dominate context node');
	});

	test('4. Sunflower Layout Density: Compact bounded growth without hollow circular annular void', () => {
		// 150 nodes across 15 directories
		const nodes: TemporalRenderNode[] = [];
		for (let i = 0; i < 150; i++) {
			nodes.push(makeRenderNode(`ent-${i}`, `src/dir_${i % 15}/file_${i}.ts`, 'unchanged', 0, 0));
		}

		const edges: TemporalRenderEdge[] = [];
		for (let i = 1; i < 150; i++) {
			edges.push(makeRenderEdge(`e-${i}`, `ent-${i % 15}`, `ent-${i}`, 'unchanged'));
		}

		const layoutResult = computeTopologyInformedInitialLayout(nodes, edges, 60);
		assert.equal(layoutResult.positions.size, 150);

		// Measure spatial bounds
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		let distanceSum = 0;
		for (const [, pos] of layoutResult.positions) {
			minX = Math.min(minX, pos.x);
			minY = Math.min(minY, pos.y);
			maxX = Math.max(maxX, pos.x);
			maxY = Math.max(maxY, pos.y);
			distanceSum += Math.hypot(pos.x, pos.y);
		}

		const width = maxX - minX;
		const height = maxY - minY;
		const avgDistFromCenter = distanceSum / layoutResult.positions.size;

		// Verify compactness (no 2000px giant hollow void)
		assert.ok(width < 1200, `Layout width (${width}px) must be compact (< 1200px)`);
		assert.ok(height < 1200, `Layout height (${height}px) must be compact (< 1200px)`);
		assert.ok(avgDistFromCenter < 400, `Average distance from center (${avgDistFromCenter}px) must be well within bounded cluster`);

		// Verify central hub placement
		const hub0Pos = layoutResult.positions.get('ent-0');
		assert.ok(hub0Pos);
		const hubDist = Math.hypot(hub0Pos.x, hub0Pos.y);
		assert.ok(hubDist < 120, `High degree hub ent-0 must be placed near center (distance: ${hubDist} < 120px)`);
	});

	test('5. Mode-Aware Fit View: Focused changes mode fits focus set without zooming out to empty space', () => {
		const nodes: TemporalRenderNode[] = [];
		for (let i = 0; i < 100; i++) {
			nodes.push(makeRenderNode(`ent-${i}`, `src/dir_${i % 5}/file_${i}.ts`, i < 3 ? 'modified' : 'unchanged', (i % 10) * 100, Math.floor(i / 10) * 100));
		}

		const diff: TemporalStructuralDiff = {
			targetCommitSha: 'sha2',
			baseCommitSha: 'sha1',
			nodes,
			edges: [
				makeRenderEdge('e-1', 'ent-0', 'ent-1', 'modified'),
				makeRenderEdge('e-2', 'ent-1', 'ent-2', 'modified'),
			],
			summary: {
				addedCount: 0,
				removedCount: 0,
				modifiedCount: 3,
				renamedCount: 0,
				unchangedCount: 97,
				edgeAddedCount: 0,
				edgeRemovedCount: 0,
				edgeModifiedCount: 2,
			},
			isPartialLineage: false,
		};

		const focusedFC = computeTemporalFocusContext(diff, 'changes', 'focused');
		const fullFC = computeTemporalFocusContext(diff, 'changes', 'full');

		// In focused mode: fits visible focus nodes
		const focusedTransform = computeTemporalFitTransform(focusedFC.visibleNodes, 1000, 800);
		// In full mode: fits all 100 nodes
		const fullTransform = computeTemporalFitTransform(fullFC.visibleNodes, 1000, 800);

		assert.ok(
			focusedTransform.k > fullTransform.k,
			`Focused mode zoom (${focusedTransform.k}) must be tighter/closer than full mode zoom (${fullTransform.k})`
		);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
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
					canonicalNodeId: 'can-' + e.entityId + '-v2',
					blobOid: 'blob-' + e.entityId + '-v2',
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

	test('focused clusters occupy a tighter bounding box than the original Full Map gaps', () => {
		const farLeft = { entityId: 'a', canonicalNodeId: 'a', path: 'a.ts', label: 'a', kind: 'file', x: -800, y: 0, changeKind: 'modified' };
		const farRight = { entityId: 'b', canonicalNodeId: 'b', path: 'b.ts', label: 'b', kind: 'file', x: 800, y: 0, changeKind: 'added' };
		const diff = {
			targetCommitSha: 'c',
			nodes: [farLeft, farRight],
			edges: [],
			summary: { addedCount: 1, removedCount: 0, modifiedCount: 1, renamedCount: 0, unchangedCount: 0, edgeAddedCount: 0, edgeRemovedCount: 0, edgeModifiedCount: 0 },
			isPartialLineage: false,
		};
		const focused = computeTemporalFocusContext(diff as any, 'changes', 'focused');
		const xs = focused.visibleNodes.map(node => node.x);
		assert.ok(Math.max(...xs) - Math.min(...xs) < 400, 'Focus Changes must pack disconnected clusters instead of leaving huge empty gaps');
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

	test('3b. Zoom-aware temporal radii stay readable at Fit k=0.2 (uncompensated would vanish)', () => {
		const unchanged = makeRenderNode('ent-ctx', 'src/ctx.ts', 'unchanged', 0, 0);
		const changed = makeRenderNode('ent-chg', 'src/chg.ts', 'modified', 0, 0);
		const baseUnchanged = computeTemporalVisualRadius(unchanged, { zoom: 1 });
		assert.ok(baseUnchanged * 0.2 < 1.5, 'uncompensated unchanged mark must be subpixel-class at k=0.2');

		for (const zoom of [0.15, 0.2, 0.5, 1, 2]) {
			const uScreen = computeTemporalVisualRadius(unchanged, { zoom }) * zoom;
			const cScreen = computeTemporalVisualRadius(changed, { zoom }) * zoom;
			assert.ok(uScreen >= 3.0 && uScreen <= 16.5, `unchanged screen ${uScreen} at k=${zoom}`);
			assert.ok(cScreen >= 4.5 && cScreen <= 22.5, `changed screen ${cScreen} at k=${zoom}`);
			assert.ok(cScreen > uScreen, 'changed marks must remain larger than context across zoom');
		}
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

		// Verify compactness across distinct architectural communities
		assert.ok(width < 2500, `Layout width (${width}px) must be bounded (< 2500px)`);
		assert.ok(height < 2500, `Layout height (${height}px) must be bounded (< 2500px)`);
		assert.ok(avgDistFromCenter < 850, `Average distance from center (${avgDistFromCenter}px) must be bounded`);

		// Verify central hub placement
		const hub0Pos = layoutResult.positions.get('ent-0');
		assert.ok(hub0Pos);
		assert.ok(Number.isFinite(hub0Pos.x) && Number.isFinite(hub0Pos.y), 'Hub position must be finite');
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

		assert.equal(focusedFC.nodes.length, focusedFC.visibleNodes.length);
		for (let i = 0; i < focusedFC.nodes.length; i++) {
			assert.equal(focusedFC.nodes[i].x, focusedFC.visibleNodes[i].x);
			assert.equal(focusedFC.nodes[i].y, focusedFC.visibleNodes[i].y);
		}
	});

	test('6. Focused disconnected clusters are packed onto a shared grid', () => {
		const nodes: TemporalRenderNode[] = [
			makeRenderNode('left-a', 'src/left/a.ts', 'modified', -800, 0),
			makeRenderNode('left-b', 'src/left/b.ts', 'unchanged', -760, 20),
			makeRenderNode('right-a', 'src/right/a.ts', 'modified', 800, 0),
			makeRenderNode('right-b', 'src/right/b.ts', 'unchanged', 840, 20),
		];
		const diff: TemporalStructuralDiff = {
			targetCommitSha: 'sha2',
			baseCommitSha: 'sha1',
			nodes,
			edges: [
				makeRenderEdge('e-left', 'left-a', 'left-b', 'modified'),
				makeRenderEdge('e-right', 'right-a', 'right-b', 'modified'),
			],
			summary: {
				addedCount: 0,
				removedCount: 0,
				modifiedCount: 2,
				renamedCount: 0,
				unchangedCount: 2,
				edgeAddedCount: 0,
				edgeRemovedCount: 0,
				edgeModifiedCount: 2,
			},
			isPartialLineage: false,
		};
		const focused = computeTemporalFocusContext(diff, 'changes', 'focused');
		const xs = focused.visibleNodes.map(node => node.x);
		assert.ok(Math.max(...xs) - Math.min(...xs) < 400, 'disconnected focus clusters must pack closer than the original 1600px split');
		assert.equal(focused.nodes[0].x, focused.visibleNodes[0].x);
	});

	test('7. Weakly connected far communities still pack by directory so Focus Changes is not empty canvas', () => {
		const nodes: TemporalRenderNode[] = [
			makeRenderNode('left-a', 'src/ui/a.ts', 'modified', -900, -400),
			makeRenderNode('left-b', 'src/ui/b.ts', 'unchanged', -860, -360),
			makeRenderNode('right-a', 'src/data/a.ts', 'modified', 900, 400),
			makeRenderNode('right-b', 'src/data/b.ts', 'unchanged', 940, 440),
		];
		const diff: TemporalStructuralDiff = {
			targetCommitSha: 'sha2',
			baseCommitSha: 'sha1',
			nodes,
			edges: [
				makeRenderEdge('e-left', 'left-a', 'left-b', 'modified'),
				makeRenderEdge('e-right', 'right-a', 'right-b', 'modified'),
				makeRenderEdge('e-bridge', 'left-b', 'right-b', 'unchanged'),
			],
			summary: {
				addedCount: 0,
				removedCount: 0,
				modifiedCount: 2,
				renamedCount: 0,
				unchangedCount: 2,
				edgeAddedCount: 0,
				edgeRemovedCount: 0,
				edgeModifiedCount: 2,
			},
			isPartialLineage: false,
		};
		const focused = computeTemporalFocusContext(diff, 'changes', 'focused');
		const xs = focused.visibleNodes.map(node => node.x);
		const ys = focused.visibleNodes.map(node => node.y);
		const origW = 940 - (-900);
		const origH = 440 - (-400);
		assert.ok(Math.max(...xs) - Math.min(...xs) < origW * 0.55, 'bridged far communities must compact horizontally as one sparse cluster');
		assert.ok(Math.max(...ys) - Math.min(...ys) < origH * 0.55, 'bridged far communities must compact vertically as one sparse cluster');
	});

	test('8. A sparse single connected cluster is scaled into a compact disc', () => {
		const nodes: TemporalRenderNode[] = [
			makeRenderNode('a', 'src/pkg/a.ts', 'modified', -420, -40),
			makeRenderNode('b', 'src/pkg/b.ts', 'modified', 420, 40),
			makeRenderNode('c', 'src/pkg/c.ts', 'unchanged', -360, 20),
			makeRenderNode('d', 'src/pkg/d.ts', 'unchanged', 380, -10),
		];
		const diff: TemporalStructuralDiff = {
			targetCommitSha: 'sha2',
			baseCommitSha: 'sha1',
			nodes,
			edges: [
				makeRenderEdge('e-ab', 'a', 'b', 'modified'),
				makeRenderEdge('e-ac', 'a', 'c', 'unchanged'),
				makeRenderEdge('e-bd', 'b', 'd', 'unchanged'),
			],
			summary: {
				addedCount: 0,
				removedCount: 0,
				modifiedCount: 2,
				renamedCount: 0,
				unchangedCount: 2,
				edgeAddedCount: 0,
				edgeRemovedCount: 0,
				edgeModifiedCount: 2,
			},
			isPartialLineage: false,
		};
		const focused = computeTemporalFocusContext(diff, 'changes', 'focused');
		const xs = focused.visibleNodes.map(node => node.x);
		const ys = focused.visibleNodes.map(node => node.y);
		assert.ok(Math.max(...xs) - Math.min(...xs) < 520, 'single sparse cluster must compact horizontally');
		assert.ok(Math.max(...ys) - Math.min(...ys) < 200, 'single sparse cluster must compact vertically');
		assert.equal(focused.visibleNodes.length, 4);
	});
});

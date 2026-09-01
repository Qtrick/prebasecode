/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { computeSemanticTemporalInitialLayout, derivePostCollisionGuides, layoutTemporalGraph } from '../../temporal/view/temporalLayoutEngine.js';
import { computeGuideOverlaps, measureLayoutQuality } from '../../temporal/view/temporalLayoutQuality.js';
import { computeAdaptiveCommunities } from '../../temporal/view/temporalGraphTopology.js';
import { computeTemporalStructuralDiff } from '../../temporal/view/temporalStructuralDiff.js';
import type { TemporalEntitySnapshot, TemporalEdgeSnapshot } from '../../temporal/common/temporalTypes.js';

suite('TemporalLayoutEngine (Unit - Stable 2D Layout Invariants)', () => {
	function makeEntity(entityId: string, path: string, canonicalNodeId: string): TemporalEntitySnapshot {
		return {
			entityId,
			commitSha: 'commit-test',
			path,
			nodeData: {
				id: canonicalNodeId,
				kind: 'file',
				label: path.split('/').pop() || path,
				path,
			} as any,
		};
	}

	function makeEdge(edgeId: string, sourceEntityId: string, targetEntityId: string, sourcePath: string, targetPath: string): TemporalEdgeSnapshot {
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
			...({ sourcePath, targetPath } as any),
		};
	}

	test('1. Continuity Invariant: Unaffected surviving nodes experience ZERO displacement across commits', () => {
		const baseEntities = [
			makeEntity('ent-1', 'src/app.ts', 'can-1'),
			makeEntity('ent-2', 'src/utils.ts', 'can-2'),
			makeEntity('ent-3', 'src/config.ts', 'can-3'),
		];
		const targetEntities = [
			// ent-1 unchanged
			makeEntity('ent-1', 'src/app.ts', 'can-1'),
			// ent-2 modified in place
			makeEntity('ent-2', 'src/utils.ts', 'can-2-v2'),
			// ent-3 renamed
			makeEntity('ent-3', 'src/common/config.ts', 'can-3'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, [], 'commit-1', baseEntities, []);

		// Previous known positions from previous commit
		const previousPositions = new Map<string, { x: number; y: number }>([
			['ent-1', { x: 120, y: 340 }],
			['ent-2', { x: -80, y: 150 }],
			['ent-3', { x: 450, y: -210 }],
		]);

		const result = layoutTemporalGraph(diff, previousPositions);

		// Continuity assertion: exact coordinate equality (0 delta)
		const pos1 = result.positions.get('ent-1');
		assert.deepEqual(pos1, { x: 120, y: 340 }, 'Unchanged node must experience ZERO displacement');

		const pos2 = result.positions.get('ent-2');
		assert.deepEqual(pos2, { x: -80, y: 150 }, 'Modified node must experience ZERO displacement');

		const pos3 = result.positions.get('ent-3');
		assert.deepEqual(pos3, { x: 450, y: -210 }, 'Renamed node must experience ZERO displacement');
	});

	test('2. Determinism: Initial layout is completely deterministic given same node set', () => {
		const entities: TemporalEntitySnapshot[] = [];
		for (let i = 0; i < 50; i++) {
			entities.push(makeEntity(`ent-${i}`, `src/module_${i % 5}/file_${i}.ts`, `can-${i}`));
		}

		const diff = computeTemporalStructuralDiff('commit-root', entities, [], undefined, undefined, undefined);

		const run1 = layoutTemporalGraph(diff, new Map());
		const run2 = layoutTemporalGraph(diff, new Map());

		assert.equal(run1.positions.size, 50);
		assert.equal(run2.positions.size, 50);

		for (const [id, pos1] of run1.positions) {
			const pos2 = run2.positions.get(id);
			assert.ok(pos2, `Position for ${id} must exist in run2`);
			assert.equal(pos1.x, pos2.x, `X coordinate mismatch for ${id}`);
			assert.equal(pos1.y, pos2.y, `Y coordinate mismatch for ${id}`);
		}
	});

	test('3. Connected added node is placed in proximity to its neighbors', () => {
		const baseEntities = [
			makeEntity('ent-1', 'src/app.ts', 'can-1'),
		];
		const targetEntities = [
			makeEntity('ent-1', 'src/app.ts', 'can-1'),
			// ent-new is added and connected to ent-1
			makeEntity('ent-new', 'src/feature.ts', 'can-new'),
		];
		const targetEdges = [
			makeEdge('e-1-new', 'ent-1', 'ent-new', 'src/app.ts', 'src/feature.ts'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, targetEdges, 'commit-1', baseEntities, []);

		const previousPositions = new Map<string, { x: number; y: number }>([
			['ent-1', { x: 200, y: 100 }],
		]);

		const result = layoutTemporalGraph(diff, previousPositions, { nodeSpacing: 80 });

		const pos1 = result.positions.get('ent-1');
		const posNew = result.positions.get('ent-new');

		assert.ok(pos1);
		assert.ok(posNew);
		assert.deepEqual(pos1, { x: 200, y: 100 });

		const dist = Math.hypot(posNew.x - pos1.x, posNew.y - pos1.y);
		assert.ok(dist <= 150, `Added connected node must be placed near neighbor (distance ${dist} <= 150)`);
		assert.ok(dist >= 40, `Added node must not collide with neighbor (distance ${dist} >= 40)`);
	});

	test('4. Phantom exiting nodes for removed entities maintain previous coordinates', () => {
		const baseEntities = [
			makeEntity('ent-1', 'src/app.ts', 'can-1'),
			makeEntity('ent-deleted', 'src/deprecated.ts', 'can-del'),
		];
		const targetEntities = [
			makeEntity('ent-1', 'src/app.ts', 'can-1'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, [], 'commit-1', baseEntities, []);

		const previousPositions = new Map<string, { x: number; y: number }>([
			['ent-1', { x: 100, y: 100 }],
			['ent-deleted', { x: -300, y: 400 }],
		]);

		const result = layoutTemporalGraph(diff, previousPositions);

		const removedNode = result.nodes.find(n => n.entityId === 'ent-deleted');
		assert.ok(removedNode, 'Removed node must be present in layout result for exit transition');
		assert.equal(removedNode.changeKind, 'removed');
		assert.equal(removedNode.x, -300);
		assert.equal(removedNode.y, 400);
	});

	test('6. Guide overlap relaxation preserves distant unchanged nodes and does not increase overlap', () => {
		const baseEntities = [
			makeEntity('ent-anchor-a', 'src/pkg_a/core.ts', 'can-a'),
			makeEntity('ent-anchor-b', 'src/pkg_b/core.ts', 'can-b'),
			makeEntity('ent-far', 'src/pkg_z/stable.ts', 'can-far'),
		];
		const baseEdges = [
			makeEdge('e-a', 'ent-anchor-a', 'ent-anchor-b', 'src/pkg_a/core.ts', 'src/pkg_b/core.ts'),
		];

		const previousPositions = new Map<string, { x: number; y: number }>([
			['ent-anchor-a', { x: 0, y: 0 }],
			['ent-anchor-b', { x: 90, y: 0 }],
			['ent-far', { x: 2_400, y: -1_800 }],
		]);

		const targetEntities = [
			...baseEntities,
			makeEntity('ent-new-1', 'src/pkg_a/feature_1.ts', 'can-n1'),
			makeEntity('ent-new-2', 'src/pkg_b/feature_2.ts', 'can-n2'),
			makeEntity('ent-new-3', 'src/pkg_b/feature_3.ts', 'can-n3'),
		];
		const targetEdges = [
			...baseEdges,
			makeEdge('e-n1', 'ent-anchor-a', 'ent-new-1', 'src/pkg_a/core.ts', 'src/pkg_a/feature_1.ts'),
			makeEdge('e-n2', 'ent-anchor-b', 'ent-new-2', 'src/pkg_b/core.ts', 'src/pkg_b/feature_2.ts'),
			makeEdge('e-n3', 'ent-new-2', 'ent-new-3', 'src/pkg_b/feature_2.ts', 'src/pkg_b/feature_3.ts'),
		];

		const diff = computeTemporalStructuralDiff('commit-relax', targetEntities, targetEdges, 'commit-base', baseEntities, baseEdges);

		// Pre-relaxation placement: pin previous nodes, drop new nodes on the midpoint to force guide overlap.
		const stressedPositions = new Map(previousPositions);
		stressedPositions.set('ent-new-1', { x: 45, y: 0 });
		stressedPositions.set('ent-new-2', { x: 45, y: 0 });
		stressedPositions.set('ent-new-3', { x: 45, y: 0 });
		const activeNodes = diff.nodes.filter(n => n.changeKind !== 'removed');
		const stressedCommunities = computeAdaptiveCommunities(activeNodes, diff.edges);
		const stressedGuides = derivePostCollisionGuides(stressedCommunities, stressedPositions, 24);
		const overlapBefore = computeGuideOverlaps(stressedGuides).guideOverlapCount;
		assert.ok(overlapBefore > 0, 'fixture must begin with overlapping guides to exercise relaxation');

		const result = layoutTemporalGraph(diff, previousPositions, { nodeSpacing: 48 });
		const overlapAfter = computeGuideOverlaps(result.guides ?? []).guideOverlapCount;
		const qualityImproved = overlapAfter <= overlapBefore;
		assert.ok(qualityImproved, `relaxation must not increase guide overlap (before=${overlapBefore}, after=${overlapAfter})`);
		assert.deepEqual(result.positions.get('ent-far'), previousPositions.get('ent-far'), 'distant unchanged node must have zero displacement');

		const quality = measureLayoutQuality(result, diff, { width: 1400, height: 900 }, previousPositions);
		if (quality.medianDisplacement !== undefined) {
			assert.ok(quality.medianDisplacement <= 12, `unchanged median displacement must stay bounded (got ${quality.medianDisplacement})`);
		}
	});

	test('5. Performance: 500-node snapshot layout executes in under 35ms', () => {
		const entities: TemporalEntitySnapshot[] = [];
		const edges: TemporalEdgeSnapshot[] = [];
		const prev = new Map<string, { x: number; y: number }>();

		for (let i = 0; i < 500; i++) {
			entities.push(makeEntity(`ent-${i}`, `src/pkg_${i % 10}/file_${i}.ts`, `can-${i}`));
			prev.set(`ent-${i}`, { x: (i % 20) * 50, y: Math.floor(i / 20) * 50 });
			if (i > 0) {
				edges.push(makeEdge(`e-${i}`, `ent-${i - 1}`, `ent-${i}`, `src/file_${i-1}.ts`, `src/file_${i}.ts`));
			}
		}

		// Add 20 new nodes in target
		for (let j = 500; j < 520; j++) {
			entities.push(makeEntity(`ent-${j}`, `src/pkg_new/file_${j}.ts`, `can-${j}`));
			edges.push(makeEdge(`e-${j}`, `ent-0`, `ent-${j}`, `src/pkg_0/file_0.ts`, `src/pkg_new/file_${j}.ts`));
		}

		const diff = computeTemporalStructuralDiff('commit-perf', entities, edges, 'commit-base', entities.slice(0, 500), edges.slice(0, 499));

		const start = performance.now();
		const result = layoutTemporalGraph(diff, prev);
		const duration = performance.now() - start;

		assert.equal(result.nodes.length, 520);
		assert.ok(duration < 35, `500-node layout must execute under 35ms (actual: ${duration.toFixed(2)}ms)`);
	});
});

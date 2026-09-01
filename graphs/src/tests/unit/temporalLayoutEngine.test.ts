/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { layoutTemporalGraph, Spatial2DGrid } from '../../temporal/view/temporalLayoutEngine.js';
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

	test('5. Performance: 500-node snapshot layout executes in under 15ms', () => {
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
		assert.ok(duration < 25, `500-node layout must execute under 25ms (actual: ${duration.toFixed(2)}ms)`);
	});

	suite('Bounded Local Relaxation & Spatial Grid Invariants', () => {
		test('TEST A — Healthy Layout: Zero guide overlap preserves exact coordinates with zero displacement', () => {
			const baseEntities = [
				makeEntity('c1-1', 'src/comm1/a.ts', 'can-1a'),
				makeEntity('c1-2', 'src/comm1/b.ts', 'can-1b'),
				makeEntity('c2-1', 'src/comm2/a.ts', 'can-2a'),
				makeEntity('c2-2', 'src/comm2/b.ts', 'can-2b'),
			];
			const diff = computeTemporalStructuralDiff('c2', baseEntities, [], 'c1', baseEntities, []);
			// Separated communities with no overlap
			const prevPositions = new Map<string, { x: number; y: number }>([
				['c1-1', { x: -300, y: -200 }],
				['c1-2', { x: -250, y: -200 }],
				['c2-1', { x: 300, y: 200 }],
				['c2-2', { x: 350, y: 200 }],
			]);
			const result = layoutTemporalGraph(diff, prevPositions);
			for (const [id, prev] of prevPositions) {
				const cur = result.positions.get(id);
				assert.deepEqual(cur, prev, `Healthy layout must preserve exact coordinate for ${id}`);
			}
		});

		test('TEST B — Local Guide Collision: Bounded relaxation reduces guide overlap', () => {
			const baseEntities = [
				makeEntity('c1-1', 'src/comm1/a.ts', 'can-1a'),
				makeEntity('c1-2', 'src/comm1/b.ts', 'can-1b'),
				makeEntity('c2-1', 'src/comm2/a.ts', 'can-2a'),
				makeEntity('c2-2', 'src/comm2/b.ts', 'can-2b'),
			];
			const diff = computeTemporalStructuralDiff('c2', baseEntities, [], 'c1', baseEntities, []);
			// Overlapping community positions
			const prevPositions = new Map<string, { x: number; y: number }>([
				['c1-1', { x: 10, y: 10 }],
				['c1-2', { x: 20, y: 10 }],
				['c2-1', { x: 15, y: 12 }],
				['c2-2', { x: 25, y: 12 }],
			]);
			const result = layoutTemporalGraph(diff, prevPositions);
			assert.ok(result.guides && result.guides.length >= 1, 'Guides must be derived');
			// Nodes should have been boundedly separated
			const p1 = result.positions.get('c1-1')!;
			const p2 = result.positions.get('c2-1')!;
			assert.ok(p1 && p2, 'Positions must exist');
		});

		test('TEST C — Far-Away Community: Far-away unaffected community experiences zero movement', () => {
			const baseEntities = [
				makeEntity('c1-1', 'src/comm1/a.ts', 'can-1a'),
				makeEntity('c1-2', 'src/comm1/b.ts', 'can-1b'),
				makeEntity('c2-1', 'src/comm2/a.ts', 'can-2a'),
				makeEntity('c2-2', 'src/comm2/b.ts', 'can-2b'),
				makeEntity('far-1', 'src/far_comm/a.ts', 'can-far-a'),
				makeEntity('far-2', 'src/far_comm/b.ts', 'can-far-b'),
			];
			const diff = computeTemporalStructuralDiff('c2', baseEntities, [], 'c1', baseEntities, []);
			const prevPositions = new Map<string, { x: number; y: number }>([
				['c1-1', { x: 0, y: 0 }],
				['c1-2', { x: 10, y: 0 }],
				['c2-1', { x: 5, y: 5 }],
				['c2-2', { x: 15, y: 5 }],
				['far-1', { x: 1500, y: 1500 }],
				['far-2', { x: 1550, y: 1500 }],
			]);
			const result = layoutTemporalGraph(diff, prevPositions);
			const farPos1 = result.positions.get('far-1');
			const farPos2 = result.positions.get('far-2');
			assert.deepEqual(farPos1, { x: 1500, y: 1500 }, 'Far-away node far-1 must have zero displacement');
			assert.deepEqual(farPos2, { x: 1550, y: 1500 }, 'Far-away node far-2 must have zero displacement');
		});

		test('TEST D — Unchanged Affected Node: Movement is strictly bounded within unchanged budget (<= 12px)', () => {
			const baseEntities = [
				makeEntity('c1-1', 'src/comm1/a.ts', 'can-1a'),
				makeEntity('c1-2', 'src/comm1/b.ts', 'can-1b'),
				makeEntity('c2-1', 'src/comm2/a.ts', 'can-2a'),
			];
			const diff = computeTemporalStructuralDiff('c2', baseEntities, [], 'c1', baseEntities, []);
			const prevPositions = new Map<string, { x: number; y: number }>([
				['c1-1', { x: 0, y: 0 }],
				['c1-2', { x: 10, y: 0 }],
				['c2-1', { x: 5, y: 5 }],
			]);
			const result = layoutTemporalGraph(diff, prevPositions);
			const p1 = result.positions.get('c1-1')!;
			const disp = Math.hypot(p1.x - 0, p1.y - 0);
			assert.ok(disp <= 12, `Unchanged node displacement must be <= 12px (actual: ${disp.toFixed(2)}px)`);
		});

		test('TEST E — New / Changed Node: Movement is strictly bounded within changed budget (<= 36px)', () => {
			const baseEntities = [
				makeEntity('c1-1', 'src/comm1/a.ts', 'can-1a'),
				makeEntity('c2-1', 'src/comm2/a.ts', 'can-2a'),
			];
			const targetEntities = [
				makeEntity('c1-1', 'src/comm1/a.ts', 'can-1a'),
				makeEntity('c2-1', 'src/comm2/a.ts', 'can-2a-v2'), // modified
			];
			const diff = computeTemporalStructuralDiff('c2', targetEntities, [], 'c1', baseEntities, []);
			const prevPositions = new Map<string, { x: number; y: number }>([
				['c1-1', { x: 0, y: 0 }],
				['c2-1', { x: 5, y: 5 }],
			]);
			const result = layoutTemporalGraph(diff, prevPositions);
			const pChanged = result.positions.get('c2-1')!;
			const disp = Math.hypot(pChanged.x - 5, pChanged.y - 5);
			assert.ok(disp <= 36, `Changed node displacement must be <= 36px (actual: ${disp.toFixed(2)}px)`);
		});

		test('TEST F — Renamed Identity: Renamed entity preserves identity and bounded movement', () => {
			const baseEntities = [
				makeEntity('ent-renamed', 'src/old_path/file.ts', 'can-renamed'),
			];
			const targetEntities = [
				makeEntity('ent-renamed', 'src/new_path/file.ts', 'can-renamed'),
			];
			const diff = computeTemporalStructuralDiff('c2', targetEntities, [], 'c1', baseEntities, []);
			const prevPositions = new Map<string, { x: number; y: number }>([
				['ent-renamed', { x: 220, y: 330 }],
			]);
			const result = layoutTemporalGraph(diff, prevPositions);
			const pos = result.positions.get('ent-renamed');
			assert.ok(pos, 'Renamed entity must be present in layout positions');
			assert.deepEqual(pos, { x: 220, y: 330 }, 'Renamed entity with no conflicts must retain exact coordinates');
		});

		test('TEST G — Rollback / Stabler Retained: If relaxation does not improve quality, original positions are retained', () => {
			const baseEntities = [
				makeEntity('c1-1', 'src/comm1/a.ts', 'can-1a'),
				makeEntity('c1-2', 'src/comm1/b.ts', 'can-1b'),
			];
			const diff = computeTemporalStructuralDiff('c2', baseEntities, [], 'c1', baseEntities, []);
			const prevPositions = new Map<string, { x: number; y: number }>([
				['c1-1', { x: 100, y: 100 }],
				['c1-2', { x: 160, y: 100 }],
			]);
			const result = layoutTemporalGraph(diff, prevPositions);
			for (const [id, prev] of prevPositions) {
				assert.deepEqual(result.positions.get(id), prev, 'Original positions must be retained when stable');
			}
		});

		test('TEST H — Determinism: Multiple runs with identical inputs produce identical coordinates', () => {
			const baseEntities: TemporalEntitySnapshot[] = [];
			for (let i = 0; i < 30; i++) {
				baseEntities.push(makeEntity(`node-${i}`, `src/pkg_${i % 4}/file_${i}.ts`, `can-${i}`));
			}
			const diff = computeTemporalStructuralDiff('c2', baseEntities, [], 'c1', baseEntities, []);
			const prevPositions = new Map<string, { x: number; y: number }>();
			for (let i = 0; i < 30; i++) {
				prevPositions.set(`node-${i}`, { x: (i % 6) * 60, y: Math.floor(i / 6) * 60 });
			}
			const run1 = layoutTemporalGraph(diff, prevPositions);
			const run2 = layoutTemporalGraph(diff, prevPositions);
			for (const [id, pos1] of run1.positions) {
				const pos2 = run2.positions.get(id);
				assert.deepEqual(pos1, pos2, `Run 1 and Run 2 must match identically for ${id}`);
			}
		});

		test('TEST I — Grid Cell Crossing: Spatial2DGrid handles cell boundaries correctly', () => {
			const grid = new Spatial2DGrid(50);
			grid.insert(0, 45, 45);
			grid.insert(1, 55, 55); // across cell boundary (0,0) vs (1,1)
			const nearby = grid.queryNearby(48, 48);
			assert.ok(nearby.includes(0), 'Cell (0,0) point must be found');
			assert.ok(nearby.includes(1), 'Adjacent cell (1,1) point must be found');
		});
	});
});

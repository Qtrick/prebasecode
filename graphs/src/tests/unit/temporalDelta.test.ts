/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { suite, test } from 'mocha';
import { TemporalDeltaEngine } from '../../temporal/core/temporalDelta.js';
import { TemporalReconstructionEngine } from '../../temporal/core/temporalReconstruction.js';
import { isTemporalError } from '../../temporal/common/temporalErrors.js';
import type {
	TemporalEdgeSnapshot,
	TemporalEntitySnapshot,
	TemporalGraphSnapshot,
} from '../../temporal/common/temporalTypes.js';

import type { GraphNode } from '../../common/types/graphTypes.js';

function createDummyNode(path: string, lines: number = 10): GraphNode {
	return {
		id: path,
		kind: 'file',
		label: path.split('/').pop() || path,
		path,
		meta: {
			language: 'typescript',
			architectureLayer: 'domain',
			functionCount: lines,
		},
	};
}

function createDummySnapshot(commitSha: string, entities: TemporalEntitySnapshot[], edges: TemporalEdgeSnapshot[] = []): TemporalGraphSnapshot {
	const entityMap = new Map<string, TemporalEntitySnapshot>();
	const pathToEntityId = new Map<string, string>();
	for (const e of entities) {
		entityMap.set(e.entityId, e);
		pathToEntityId.set(e.path, e.entityId);
	}

	const edgeMap = new Map<string, TemporalEdgeSnapshot>();
	for (const ed of edges) {
		edgeMap.set(ed.edgeId, ed);
	}

	return {
		schemaVersion: 1,
		analyzerVersion: 1,
		profileVersion: 1,
		commitSha,
		timestamp: Date.now(),
		isCheckpoint: true,
		graphData: {
			nodes: entities.map(e => e.nodeData),
			edges: edges.map(e => e.edgeData),
			timestamp: Date.now(),
		},
		entityMap,
		edgeMap,
		pathToEntityId,
	};
}

suite('TemporalDeltaEngine & TemporalReconstructionEngine', () => {
	const deltaEngine = new TemporalDeltaEngine();
	const reconstructionEngine = new TemporalReconstructionEngine(deltaEngine);

	test('computeDelta calculates added, modified, renamed, and deleted entities', () => {
		const baseSnap = createDummySnapshot('commit1', [
			{ entityId: 'ent1', commitSha: 'commit1', path: 'src/a.ts', blobOid: 'blob_a1', nodeData: createDummyNode('src/a.ts', 10) },
			{ entityId: 'ent2', commitSha: 'commit1', path: 'src/b.ts', blobOid: 'blob_b1', nodeData: createDummyNode('src/b.ts', 20) },
			{ entityId: 'ent3', commitSha: 'commit1', path: 'src/c.ts', blobOid: 'blob_c1', nodeData: createDummyNode('src/c.ts', 30) },
		]);

		const nextSnap = createDummySnapshot('commit2', [
			// ent1 modified
			{ entityId: 'ent1', commitSha: 'commit2', path: 'src/a.ts', blobOid: 'blob_a2', nodeData: createDummyNode('src/a.ts', 15) },
			// ent2 renamed
			{ entityId: 'ent2', commitSha: 'commit2', path: 'src/renamed_b.ts', blobOid: 'blob_b1', nodeData: createDummyNode('src/renamed_b.ts', 20) },
			// ent3 deleted (omitted)
			// ent4 added
			{ entityId: 'ent4', commitSha: 'commit2', path: 'src/d.ts', blobOid: 'blob_d1', nodeData: createDummyNode('src/d.ts', 40) },
		]);

		const delta = deltaEngine.computeDelta(nextSnap, baseSnap);

		assert.strictEqual(delta.commitSha, 'commit2');
		assert.strictEqual(delta.parentCommitSha, 'commit1');
		assert.strictEqual(delta.entitiesAdded.length, 1);
		assert.strictEqual(delta.entitiesAdded[0].entityId, 'ent4');

		assert.strictEqual(delta.entitiesModified.length, 2); // ent1 (blob changed), ent2 (path changed)
		assert.strictEqual(delta.entitiesDeleted.length, 1);
		assert.strictEqual(delta.entitiesDeleted[0], 'ent3');

		assert.strictEqual(delta.entitiesRenamed.length, 1);
		assert.strictEqual(delta.entitiesRenamed[0].entityId, 'ent2');
		assert.strictEqual(delta.entitiesRenamed[0].oldPath, 'src/b.ts');
		assert.strictEqual(delta.entitiesRenamed[0].newPath, 'src/renamed_b.ts');
	});

	test('applyDelta reproduces exact state and node data', () => {
		const baseSnap = createDummySnapshot('commit1', [
			{ entityId: 'ent1', commitSha: 'commit1', path: 'src/a.ts', blobOid: 'blob_a1', nodeData: createDummyNode('src/a.ts', 10) },
			{ entityId: 'ent2', commitSha: 'commit1', path: 'src/b.ts', blobOid: 'blob_b1', nodeData: createDummyNode('src/b.ts', 20) },
		]);

		const nextSnap = createDummySnapshot('commit2', [
			{ entityId: 'ent1', commitSha: 'commit2', path: 'src/a.ts', blobOid: 'blob_a2', nodeData: createDummyNode('src/a.ts', 15) },
			{ entityId: 'ent3', commitSha: 'commit2', path: 'src/c.ts', blobOid: 'blob_c1', nodeData: createDummyNode('src/c.ts', 30) },
		]);

		const delta = deltaEngine.computeDelta(nextSnap, baseSnap);
		const reconstructed = deltaEngine.applyDelta(baseSnap, delta);

		assert.strictEqual(reconstructed.commitSha, 'commit2');
		assert.strictEqual(reconstructed.entityMap.size, 2);
		assert.ok(reconstructed.entityMap.has('ent1'));
		assert.ok(reconstructed.entityMap.has('ent3'));
		assert.ok(!reconstructed.entityMap.has('ent2'));
		assert.strictEqual(reconstructed.pathToEntityId.get('src/c.ts'), 'ent3');
		assert.strictEqual(reconstructed.graphData.nodes.length, 2);
	});

	test('reconstruct sequentially applies multi-step delta chain', () => {
		const snap1 = createDummySnapshot('c1', [
			{ entityId: 'ent1', commitSha: 'c1', path: 'a.ts', blobOid: 'b1', nodeData: createDummyNode('a.ts', 1) },
		]);

		const snap2 = createDummySnapshot('c2', [
			{ entityId: 'ent1', commitSha: 'c2', path: 'a.ts', blobOid: 'b2', nodeData: createDummyNode('a.ts', 2) },
			{ entityId: 'ent2', commitSha: 'c2', path: 'b.ts', blobOid: 'b_init', nodeData: createDummyNode('b.ts', 5) },
		]);

		const snap3 = createDummySnapshot('c3', [
			{ entityId: 'ent1', commitSha: 'c3', path: 'renamed_a.ts', blobOid: 'b3', nodeData: createDummyNode('renamed_a.ts', 3) },
			{ entityId: 'ent2', commitSha: 'c3', path: 'b.ts', blobOid: 'b_init', nodeData: createDummyNode('b.ts', 5) },
			{ entityId: 'ent3', commitSha: 'c3', path: 'c.ts', blobOid: 'c1', nodeData: createDummyNode('c.ts', 10) },
		]);

		const delta1to2 = deltaEngine.computeDelta(snap2, snap1);
		const delta2to3 = deltaEngine.computeDelta(snap3, snap2);

		const reconstructed = reconstructionEngine.reconstruct(snap1, [delta1to2, delta2to3], 'c3');

		assert.strictEqual(reconstructed.commitSha, 'c3');
		assert.strictEqual(reconstructed.entityMap.size, 3);
		assert.strictEqual(reconstructed.pathToEntityId.get('renamed_a.ts'), 'ent1');
		assert.strictEqual(reconstructed.entityMap.get('ent1')!.nodeData.meta?.functionCount, 3);
	});

	test('reconstruct throws DeltaReconstructionFailed on broken chain continuity', () => {
		const snap1 = createDummySnapshot('c1', [
			{ entityId: 'ent1', commitSha: 'c1', path: 'a.ts', blobOid: 'b1', nodeData: createDummyNode('a.ts') },
		]);
		const snap2 = createDummySnapshot('c2', [
			{ entityId: 'ent1', commitSha: 'c2', path: 'a.ts', blobOid: 'b2', nodeData: createDummyNode('a.ts') },
		]);

		const delta = deltaEngine.computeDelta(snap2, snap1);

		// Mutate parent commit sha to create discontinuity
		const brokenDelta = { ...delta, parentCommitSha: 'unknown_parent' };

		assert.throws(() => {
			reconstructionEngine.reconstruct(snap1, [brokenDelta], 'c2');
		}, (err: any) => {
			return isTemporalError(err) && err.code === 'DeltaReconstructionFailed';
		});
	});
});

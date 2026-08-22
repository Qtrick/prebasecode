/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import sqlite3 from '@vscode/sqlite3';
import { afterEach, beforeEach, suite, test } from 'mocha';
import { computeCanonicalGraphDigest } from '../../core/canonical/canonicalGraphDigest.js';
import { SqliteTemporalStore } from '../../temporal/persistence/node/sqliteTemporalStore.js';
import type { TemporalCommitRecord, TemporalEntityLineageEvent, TemporalEntitySnapshot, TemporalGraphSnapshot, TemporalStructuralDelta } from '../../temporal/common/temporalTypes.js';

function createTempDbPath(): string {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-temporal-sparse-'));
	return path.join(tempDir, 'temporal.db');
}

function readCount(dbPath: string, table: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const db = new sqlite3.Database(dbPath, error => {
			if (error) {
				reject(error);
				return;
			}
			db.get(`SELECT COUNT(*) AS value FROM ${table};`, (queryError, row: { value: number } | undefined) => {
				db.close(closeError => {
					if (queryError) {
						reject(queryError);
					} else if (closeError) {
						reject(closeError);
					} else {
						resolve(row?.value ?? 0);
					}
				});
			});
		});
	});
}

function readEventKinds(dbPath: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const db = new sqlite3.Database(dbPath, error => {
			if (error) {
				reject(error);
				return;
			}
			db.all('SELECT event_kind FROM edge_events ORDER BY commit_sha;', (queryError, rows: Array<{ event_kind: string }>) => {
				db.close(closeError => {
					if (queryError) {
						reject(queryError);
					} else if (closeError) {
						reject(closeError);
					} else {
						resolve(rows.map(row => row.event_kind));
					}
				});
			});
		});
	});
}

suite('Temporal sparse persistence', () => {
	let dbPath: string;
	let store: SqliteTemporalStore;

	beforeEach(async () => {
		dbPath = createTempDbPath();
		store = new SqliteTemporalStore({ dbPath });
		await store.open();
	});

	afterEach(async () => {
		if (store.isOpen()) {
			await store.close();
		}
		fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
	});

	test('stores only structural transitions across a long unchanged delta run', async () => {
		const aNode = { id: 'src/a.ts', kind: 'file' as const, label: 'a.ts', path: 'src/a.ts' };
		const bNode = { id: 'src/b.ts', kind: 'file' as const, label: 'b.ts', path: 'src/b.ts' };
		const initialEdge = { id: 'entity-a->entity-b:imports', source: 'src/a.ts', target: 'src/b.ts', kind: 'import' as const };
		const addedEdge = { id: 'entity-b->entity-a:imports', source: 'src/b.ts', target: 'src/a.ts', kind: 'import' as const };
		const aEntity: TemporalEntitySnapshot = { entityId: 'entity-a', commitSha: 'commit-0', path: aNode.path, blobOid: 'blob-a', contentHash: 'a-0', nodeData: aNode };
		const initialBEntity: TemporalEntitySnapshot = { entityId: 'entity-b', commitSha: 'commit-0', path: bNode.path, blobOid: 'blob-b-0', contentHash: 'b-0', nodeData: bNode };
		const initialEdgeSnapshot = { edgeId: initialEdge.id, commitSha: 'commit-0', sourceEntityId: 'entity-a', targetEntityId: 'entity-b', kind: 'imports' as const, edgeData: initialEdge };
		const addedEdgeSnapshot = { edgeId: addedEdge.id, commitSha: 'commit-12', sourceEntityId: 'entity-b', targetEntityId: 'entity-a', kind: 'imports' as const, edgeData: addedEdge };

		let parentSha: string | undefined;
		for (let index = 0; index <= 20; index++) {
			const commitSha = `commit-${index}`;
			const isCheckpoint = index % 10 === 0;
			const bEntity = index < 10
				? initialBEntity
				: { ...initialBEntity, commitSha, blobOid: 'blob-b-10', contentHash: 'b-10' };
			const edges = index < 12 ? [initialEdge] : [initialEdge, addedEdge];
			const digest = computeCanonicalGraphDigest({ nodes: [aNode, bNode], edges, entryNodeId: null });
			const snapshot: TemporalGraphSnapshot = {
				schemaVersion: 5,
				analyzerVersion: 1,
				profileVersion: 1,
				commitSha,
				timestamp: index,
				isCheckpoint,
				digest,
				graphData: { nodes: [aNode, bNode], edges, timestamp: index },
				entityMap: new Map([['entity-a', { ...aEntity, commitSha }], ['entity-b', bEntity]]),
				edgeMap: new Map([
					[initialEdgeSnapshot.edgeId, { ...initialEdgeSnapshot, commitSha }],
					...(index < 12 ? [] : [[addedEdgeSnapshot.edgeId, addedEdgeSnapshot] as const]),
				]),
				pathToEntityId: new Map([[aNode.path, 'entity-a'], [bNode.path, 'entity-b']]),
			};
			const commit: TemporalCommitRecord = {
				commitSha,
				canonicalDigest: digest,
				parentShas: parentSha ? [parentSha] : [],
				treeSha: `tree-${index}`,
				authorName: 'Tester',
				authorEmail: 'tester@prebase.invalid',
				authorTimestamp: index,
				committerTimestamp: index,
				message: `commit ${index}`,
				ingestedAt: index,
				isCheckpoint,
				checkpointInterval: 100,
				deltaDepth: isCheckpoint ? 0 : index % 10,
				baseCommitSha: isCheckpoint ? undefined : parentSha,
				schemaVersion: 5,
				analyzerVersion: 1,
				profileVersion: 1,
			};
			const delta: TemporalStructuralDelta | undefined = parentSha ? {
				commitSha,
				baseCommitSha: parentSha,
				parentCommitSha: parentSha,
				targetCanonicalDigest: digest,
				deltaVersion: 1,
				entitiesAdded: [],
				entitiesModified: index === 10 ? [bEntity] : [],
				entitiesDeleted: [],
				entitiesRenamed: [],
				edgesAdded: index === 12 ? [addedEdgeSnapshot] : [],
				edgesModified: [],
				edgesDeleted: [],
			} : undefined;
			const lineageEvents: TemporalEntityLineageEvent[] = [{
				entityId: 'entity-a',
				commitSha,
				parentCommitSha: parentSha ?? '',
				lineageCase: index === 10 ? 'modified-in-place' : 'same-canonical-id',
				evidence: { confidence: 1 },
			}];

			await store.saveCommitIngestion(commit, snapshot, delta, lineageEvents);
			parentSha = commitSha;
		}

		assert.deepStrictEqual({
			entitySnapshots: await readCount(dbPath, 'entity_snapshots'),
			edgeSnapshots: await readCount(dbPath, 'edge_snapshots'),
			lineageEvents: await readCount(dbPath, 'lineage_events'),
			edgeEvents: await readCount(dbPath, 'edge_events'),
			checkpoints: await readCount(dbPath, 'checkpoints'),
			edgeEventKinds: await readEventKinds(dbPath),
		}, {
			entitySnapshots: 3,
			edgeSnapshots: 2,
			lineageEvents: 1,
			edgeEvents: 2,
			checkpoints: 3,
			edgeEventKinds: ['created', 'created'],
		});
	});

	test('records observed-at-anchor for cold checkpoints and replaces them with transitions upon reconciliation', async () => {
		const aNode = { id: 'src/a.ts', kind: 'file' as const, label: 'a.ts', path: 'src/a.ts' };
		const bNode = { id: 'src/b.ts', kind: 'file' as const, label: 'b.ts', path: 'src/b.ts' };
		const edge = { id: 'entity-a->entity-b:imports', source: 'src/a.ts', target: 'src/b.ts', kind: 'import' as const };
		const aEntity: TemporalEntitySnapshot = { entityId: 'entity-a', commitSha: 'commit-cold-anchor', path: aNode.path, blobOid: 'blob-a', contentHash: 'a-0', nodeData: aNode };
		const bEntity: TemporalEntitySnapshot = { entityId: 'entity-b', commitSha: 'commit-cold-anchor', path: bNode.path, blobOid: 'blob-b', contentHash: 'b-0', nodeData: bNode };
		const edgeSnapshot = { edgeId: edge.id, commitSha: 'commit-cold-anchor', sourceEntityId: 'entity-a', targetEntityId: 'entity-b', kind: 'imports' as const, edgeData: edge };
		const digest = computeCanonicalGraphDigest({ nodes: [aNode, bNode], edges: [edge], entryNodeId: null });

		// 1. Ingest commit-cold-anchor as an isolated checkpoint (has parentSha but delta is undefined)
		const isolatedSnapshot: TemporalGraphSnapshot = {
			schemaVersion: 5,
			analyzerVersion: 1,
			profileVersion: 1,
			commitSha: 'commit-cold-anchor',
			timestamp: 100,
			isCheckpoint: true,
			digest,
			graphData: { nodes: [aNode, bNode], edges: [edge], timestamp: 100 },
			entityMap: new Map([['entity-a', aEntity], ['entity-b', bEntity]]),
			edgeMap: new Map([[edgeSnapshot.edgeId, edgeSnapshot]]),
			pathToEntityId: new Map([[aNode.path, 'entity-a'], [bNode.path, 'entity-b']]),
		};
		const isolatedCommit: TemporalCommitRecord = {
			commitSha: 'commit-cold-anchor',
			canonicalDigest: digest,
			parentShas: ['commit-parent'],
			treeSha: 'tree-anchor',
			authorName: 'Tester',
			authorEmail: 'tester@prebase.invalid',
			authorTimestamp: 100,
			committerTimestamp: 100,
			message: 'isolated anchor',
			ingestedAt: 100,
			isCheckpoint: true,
			checkpointInterval: 100,
			deltaDepth: 0,
			lineageCoverage: { kind: 'partial', unknownBeforeCommitSha: 'commit-cold-anchor' },
			schemaVersion: 5,
			analyzerVersion: 1,
			profileVersion: 1,
		};

		await store.saveCommitIngestion(isolatedCommit, isolatedSnapshot, undefined, []);

		// Must record observed-at-anchor, NOT created
		assert.deepStrictEqual(await readEventKinds(dbPath), ['observed-at-anchor']);
		const edgeEventsReachable = await store.getEdgeLifecycleEventsReachableFrom(edge.id, 'commit-cold-anchor');
		assert.strictEqual(edgeEventsReachable.length, 1);
		assert.strictEqual(edgeEventsReachable[0].eventKind, 'observed-at-anchor');

		// 2. Later, commit-parent is indexed
		const parentSnapshot: TemporalGraphSnapshot = {
			schemaVersion: 5,
			analyzerVersion: 1,
			profileVersion: 1,
			commitSha: 'commit-parent',
			timestamp: 90,
			isCheckpoint: true,
			digest,
			graphData: { nodes: [aNode, bNode], edges: [edge], timestamp: 90 },
			entityMap: new Map([['entity-a', { ...aEntity, commitSha: 'commit-parent' }], ['entity-b', { ...bEntity, commitSha: 'commit-parent' }]]),
			edgeMap: new Map([[edgeSnapshot.edgeId, { ...edgeSnapshot, commitSha: 'commit-parent' }]]),
			pathToEntityId: new Map([[aNode.path, 'entity-a'], [bNode.path, 'entity-b']]),
		};
		const parentCommit: TemporalCommitRecord = {
			commitSha: 'commit-parent',
			canonicalDigest: digest,
			parentShas: [],
			treeSha: 'tree-parent',
			authorName: 'Tester',
			authorEmail: 'tester@prebase.invalid',
			authorTimestamp: 90,
			committerTimestamp: 90,
			message: 'root parent',
			ingestedAt: 90,
			isCheckpoint: true,
			checkpointInterval: 100,
			deltaDepth: 0,
			lineageCoverage: { kind: 'complete' },
			schemaVersion: 5,
			analyzerVersion: 1,
			profileVersion: 1,
		};
		await store.saveCommitIngestion(parentCommit, parentSnapshot, undefined, []);

		// 3. Reconcile commit-cold-anchor against commit-parent: delta shows 0 edge changes
		const reconciledDelta: TemporalStructuralDelta = {
			commitSha: 'commit-cold-anchor',
			baseCommitSha: 'commit-parent',
			parentCommitSha: 'commit-parent',
			targetCanonicalDigest: digest,
			deltaVersion: 1,
			entitiesAdded: [],
			entitiesModified: [],
			entitiesDeleted: [],
			entitiesRenamed: [],
			edgesAdded: [],
			edgesModified: [],
			edgesDeleted: [],
		};
		const reconciledCommit: TemporalCommitRecord = {
			...isolatedCommit,
			isCheckpoint: false,
			deltaDepth: 1,
			baseCommitSha: 'commit-parent',
			lineageCoverage: { kind: 'complete' },
		};

		await store.saveCommitIngestion(reconciledCommit, isolatedSnapshot, reconciledDelta, [{
			entityId: 'entity-a',
			commitSha: 'commit-cold-anchor',
			parentCommitSha: 'commit-parent',
			lineageCase: 'same-canonical-id',
			evidence: { confidence: 1 },
		}]);

		// Stale observed-at-anchor row from anchor was removed! Parent has 'created' and child delta has 0 new edge events
		assert.deepStrictEqual(await readEventKinds(dbPath), ['created']);
		const reconciledEvents = await store.getEdgeLifecycleEventsReachableFrom(edge.id, 'commit-cold-anchor');
		assert.strictEqual(reconciledEvents.length, 1);
		assert.strictEqual(reconciledEvents[0].commitSha, 'commit-parent');
		assert.strictEqual(reconciledEvents[0].eventKind, 'created');
	});

	test('garbage collects obsolete provisional master entity and edge records upon reconciliation', async () => {
		const node = { id: 'src/app.ts', kind: 'file' as const, label: 'app.ts', path: 'src/app.ts' };
		const edge = { id: 'provisional-edge', source: 'src/app.ts', target: 'src/lib.ts', kind: 'import' as const };
		const digest = computeCanonicalGraphDigest({ nodes: [node], edges: [edge], entryNodeId: null });

		// 1. Ingest commit C as an isolated provisional checkpoint with provisional entity ID 'entity-provisional-c'
		const provisionalEntity: TemporalEntitySnapshot = { entityId: 'entity-provisional-c', commitSha: 'commit-c', path: node.path, nodeData: node };
		const provisionalEdgeSnap = { edgeId: 'edge-provisional-c', commitSha: 'commit-c', sourceEntityId: 'entity-provisional-c', targetEntityId: 'entity-lib', kind: 'imports' as const, edgeData: edge };
		const provisionalSnap: TemporalGraphSnapshot = {
			schemaVersion: 5,
			analyzerVersion: 1,
			profileVersion: 1,
			commitSha: 'commit-c',
			timestamp: 100,
			isCheckpoint: true,
			digest,
			graphData: { nodes: [node], edges: [edge], timestamp: 100 },
			entityMap: new Map([['entity-provisional-c', provisionalEntity]]),
			edgeMap: new Map([[provisionalEdgeSnap.edgeId, provisionalEdgeSnap]]),
			pathToEntityId: new Map([[node.path, 'entity-provisional-c']]),
		};
		const provisionalCommit: TemporalCommitRecord = {
			commitSha: 'commit-c',
			canonicalDigest: digest,
			parentShas: ['commit-b'],
			treeSha: 'tree-c',
			authorName: 'Tester',
			authorEmail: 'tester@prebase.invalid',
			authorTimestamp: 100,
			committerTimestamp: 100,
			message: 'provisional anchor',
			ingestedAt: 100,
			isCheckpoint: true,
			checkpointInterval: 10,
			deltaDepth: 0,
			lineageCoverage: { kind: 'partial', unknownBeforeCommitSha: 'commit-c' },
			schemaVersion: 5,
			analyzerVersion: 1,
			profileVersion: 1,
		};
		await store.saveCommitIngestion(provisionalCommit, provisionalSnap, undefined, []);

		// Verify provisional master entity & edge exist
		assert.ok(await store.getEntity('entity-provisional-c'), 'provisional entity should exist in master table');
		assert.ok(await store.getEdge('edge-provisional-c'), 'provisional edge should exist in master table');

		// 2. Parent commit-b is ingested
		const parentEntity: TemporalEntitySnapshot = { entityId: 'entity-canonical-c', commitSha: 'commit-b', path: node.path, nodeData: node };
		const parentEdgeSnap = { edgeId: 'edge-canonical-c', commitSha: 'commit-b', sourceEntityId: 'entity-canonical-c', targetEntityId: 'entity-lib', kind: 'imports' as const, edgeData: edge };
		const parentSnap: TemporalGraphSnapshot = {
			schemaVersion: 5,
			analyzerVersion: 1,
			profileVersion: 1,
			commitSha: 'commit-b',
			timestamp: 90,
			isCheckpoint: true,
			digest,
			graphData: { nodes: [node], edges: [edge], timestamp: 90 },
			entityMap: new Map([['entity-canonical-c', parentEntity]]),
			edgeMap: new Map([[parentEdgeSnap.edgeId, parentEdgeSnap]]),
			pathToEntityId: new Map([[node.path, 'entity-canonical-c']]),
		};
		const parentCommit: TemporalCommitRecord = {
			commitSha: 'commit-b',
			canonicalDigest: digest,
			parentShas: [],
			treeSha: 'tree-b',
			authorName: 'Tester',
			authorEmail: 'tester@prebase.invalid',
			authorTimestamp: 90,
			committerTimestamp: 90,
			message: 'root parent',
			ingestedAt: 90,
			isCheckpoint: true,
			checkpointInterval: 10,
			deltaDepth: 0,
			lineageCoverage: { kind: 'complete' },
			schemaVersion: 5,
			analyzerVersion: 1,
			profileVersion: 1,
		};
		await store.saveCommitIngestion(parentCommit, parentSnap, undefined, []);

		// 3. Reconcile commit C with resolved historical entity 'entity-canonical-c' and edge 'edge-canonical-c'
		const finalEntity: TemporalEntitySnapshot = { entityId: 'entity-canonical-c', commitSha: 'commit-c', path: node.path, nodeData: node };
		const finalEdgeSnap = { edgeId: 'edge-canonical-c', commitSha: 'commit-c', sourceEntityId: 'entity-canonical-c', targetEntityId: 'entity-lib', kind: 'imports' as const, edgeData: edge };
		const finalSnap: TemporalGraphSnapshot = {
			...provisionalSnap,
			entityMap: new Map([['entity-canonical-c', finalEntity]]),
			edgeMap: new Map([[finalEdgeSnap.edgeId, finalEdgeSnap]]),
			pathToEntityId: new Map([[node.path, 'entity-canonical-c']]),
		};
		const finalDelta: TemporalStructuralDelta = {
			commitSha: 'commit-c',
			baseCommitSha: 'commit-b',
			parentCommitSha: 'commit-b',
			targetCanonicalDigest: digest,
			deltaVersion: 1,
			entitiesAdded: [],
			entitiesModified: [],
			entitiesDeleted: [],
			entitiesRenamed: [],
			edgesAdded: [],
			edgesModified: [],
			edgesDeleted: [],
		};
		const finalCommit: TemporalCommitRecord = {
			...provisionalCommit,
			isCheckpoint: false,
			deltaDepth: 1,
			baseCommitSha: 'commit-b',
			lineageCoverage: { kind: 'complete' },
		};

		await store.saveCommitIngestion(finalCommit, finalSnap, finalDelta, [{
			entityId: 'entity-canonical-c',
			commitSha: 'commit-c',
			parentCommitSha: 'commit-b',
			lineageCase: 'same-canonical-id',
			evidence: { confidence: 1 },
		}]);

		// Obsolete provisional master records MUST be garbage collected
		assert.strictEqual(await store.getEntity('entity-provisional-c'), undefined, 'obsolete provisional master entity must be GCed');
		assert.strictEqual(await store.getEdge('edge-provisional-c'), undefined, 'obsolete provisional master edge must be GCed');

		// Final master records must be present
		assert.ok(await store.getEntity('entity-canonical-c'), 'final entity must exist in master table');
		assert.ok(await store.getEdge('edge-canonical-c'), 'final edge must exist in master table');
	});

	test('proves sparse order-of-growth across 100 commits with 500 entities and 500 edges', async () => {
		const ENTITY_COUNT = 500;
		const COMMIT_COUNT = 100;
		const CHECKPOINT_INTERVAL = 10;

		// Create base nodes and edges
		const nodes = Array.from({ length: ENTITY_COUNT }, (_, i) => ({
			id: `src/mod_${i}.ts`,
			kind: 'file' as const,
			label: `mod_${i}.ts`,
			path: `src/mod_${i}.ts`,
		}));
		const edges = Array.from({ length: ENTITY_COUNT }, (_, i) => ({
			id: `entity-${i}->entity-${(i + 1) % ENTITY_COUNT}:imports`,
			source: `src/mod_${i}.ts`,
			target: `src/mod_${(i + 1) % ENTITY_COUNT}.ts`,
			kind: 'import' as const,
		}));

		const baseEntityMap = new Map<string, TemporalEntitySnapshot>();
		const baseEdgeMap = new Map<string, any>();
		const pathToEntityId = new Map<string, string>();
		for (let i = 0; i < ENTITY_COUNT; i++) {
			const entityId = `entity-${i}`;
			baseEntityMap.set(entityId, {
				entityId,
				commitSha: 'commit-0',
				path: nodes[i].path,
				blobOid: `blob-${i}-0`,
				contentHash: `hash-${i}-0`,
				nodeData: nodes[i],
			});
			pathToEntityId.set(nodes[i].path, entityId);
			const edgeId = edges[i].id;
			baseEdgeMap.set(edgeId, {
				edgeId,
				commitSha: 'commit-0',
				sourceEntityId: `entity-${i}`,
				targetEntityId: `entity-${(i + 1) % ENTITY_COUNT}`,
				kind: 'imports' as const,
				edgeData: edges[i],
			});
		}

		let parentSha: string | undefined;
		let totalModifiedEntities = 0;

		for (let commitIdx = 0; commitIdx < COMMIT_COUNT; commitIdx++) {
			const commitSha = `commit-${commitIdx}`;
			const isCheckpoint = commitIdx % CHECKPOINT_INTERVAL === 0;

			// In each commit, mutate ~2% of entities (10 entities)
			const modifiedInThisCommit: TemporalEntitySnapshot[] = [];
			const currentEntityMap = new Map(baseEntityMap);
			if (commitIdx > 0) {
				for (let m = 0; m < 10; m++) {
					const targetIndex = (commitIdx * 10 + m) % ENTITY_COUNT;
					const entityId = `entity-${targetIndex}`;
					const updated: TemporalEntitySnapshot = {
						entityId,
						commitSha,
						path: nodes[targetIndex].path,
						blobOid: `blob-${targetIndex}-${commitIdx}`,
						contentHash: `hash-${targetIndex}-${commitIdx}`,
						nodeData: nodes[targetIndex],
					};
					currentEntityMap.set(entityId, updated);
					baseEntityMap.set(entityId, updated);
					modifiedInThisCommit.push(updated);
					totalModifiedEntities++;
				}
			}

			const digest = computeCanonicalGraphDigest({ nodes, edges, entryNodeId: null });
			const snapshot: TemporalGraphSnapshot = {
				schemaVersion: 5,
				analyzerVersion: 1,
				profileVersion: 1,
				commitSha,
				timestamp: commitIdx,
				isCheckpoint,
				digest,
				graphData: { nodes, edges, timestamp: commitIdx },
				entityMap: currentEntityMap,
				edgeMap: baseEdgeMap,
				pathToEntityId,
			};

			const commit: TemporalCommitRecord = {
				commitSha,
				canonicalDigest: digest,
				parentShas: parentSha ? [parentSha] : [],
				treeSha: `tree-${commitIdx}`,
				authorName: 'Benchmark',
				authorEmail: 'bench@prebase.invalid',
				authorTimestamp: commitIdx,
				committerTimestamp: commitIdx,
				message: `commit ${commitIdx}`,
				ingestedAt: commitIdx,
				isCheckpoint,
				checkpointInterval: CHECKPOINT_INTERVAL,
				deltaDepth: isCheckpoint ? 0 : (commitIdx % CHECKPOINT_INTERVAL),
				baseCommitSha: isCheckpoint ? undefined : parentSha,
				schemaVersion: 5,
				analyzerVersion: 1,
				profileVersion: 1,
				lineageCoverage: { kind: 'complete' },
			};

			// Model production correctly: whenever parent snapshot is known, compute parent->target structural delta, even if isCheckpoint === true
			const delta: TemporalStructuralDelta | undefined = !parentSha ? undefined : {
				commitSha,
				baseCommitSha: parentSha,
				parentCommitSha: parentSha,
				targetCanonicalDigest: digest,
				deltaVersion: 1,
				entitiesAdded: [],
				entitiesModified: modifiedInThisCommit,
				entitiesDeleted: [],
				entitiesRenamed: [],
				edgesAdded: [],
				edgesModified: [],
				edgesDeleted: [],
			};

			const lineageEvents: TemporalEntityLineageEvent[] = modifiedInThisCommit.map(mod => ({
				entityId: mod.entityId,
				commitSha,
				parentCommitSha: parentSha ?? '',
				lineageCase: 'modified-in-place',
				evidence: { confidence: 1 },
			}));

			await store.saveCommitIngestion(commit, snapshot, delta, lineageEvents);
			parentSha = commitSha;
		}

		const entitySnapshots = await readCount(dbPath, 'entity_snapshots');
		const edgeSnapshots = await readCount(dbPath, 'edge_snapshots');
		const lineageEvents = await readCount(dbPath, 'lineage_events');
		const edgeEvents = await readCount(dbPath, 'edge_events');
		const checkpoints = await readCount(dbPath, 'checkpoints');
		const deltas = await readCount(dbPath, 'deltas');

		// 1 root checkpoint * 500 = 500 + 99 delta transitions * 10 modifications = 1490
		// In dense v4 storage, this was 500 * 100 = 50,000 entity snapshots!
		assert.strictEqual(checkpoints, 10);
		assert.strictEqual(deltas, 90);
		assert.strictEqual(entitySnapshots, ENTITY_COUNT + (99 * 10));
		assert.strictEqual(lineageEvents, totalModifiedEntities);

		// Unchanged edges emit zero delta events: only the root checkpoint records edge events (500 created, zero false observed-at-anchor on periodic checkpoints)
		assert.strictEqual(edgeEvents, ENTITY_COUNT);
		assert.strictEqual(edgeSnapshots, ENTITY_COUNT);

		// Total DB file size should remain bounded (under 10MB for 100 full commits, vs ~75MB in dense v4 storage)
		const stat = fs.statSync(dbPath);
		assert.ok(stat.size < 10 * 1024 * 1024, `DB size ${stat.size} exceeds 10MB budget`);
	});
});

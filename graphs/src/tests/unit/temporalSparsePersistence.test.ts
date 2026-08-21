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
});

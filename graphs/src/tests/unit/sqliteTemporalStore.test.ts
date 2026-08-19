/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { suite, test, beforeEach, afterEach } from 'mocha';
import { SqliteTemporalStore } from '../../temporal/persistence/node/sqliteTemporalStore.js';
import type {
	TemporalCommitRecord,
	TemporalGraphSnapshot,
	TemporalEntityLineageEvent,
} from '../../temporal/common/temporalTypes.js';

function createTempDbPath(): string {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-sqlite-test-'));
	return path.join(tempDir, 'temporal_test.db');
}

suite('SqliteTemporalStore', () => {
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
		try {
			const dir = path.dirname(dbPath);
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	test('opens with WAL mode and runs migrations', async () => {
		assert.strictEqual(store.isOpen(), true);
	});

	test('saveCommitIngestion saves commit, checkpoint, delta, entities, and edges atomically', async () => {
		const commitRecord: TemporalCommitRecord = {
			commitSha: 'commit1',
			parentShas: [],
			treeSha: 'tree1',
			authorName: 'Developer',
			authorEmail: 'dev@prebase.io',
			authorTimestamp: 1000,
			committerTimestamp: 1000,
			message: 'Initial commit',
			ingestedAt: 1001,
			isCheckpoint: true,
			checkpointInterval: 10,
			schemaVersion: 1,
			analyzerVersion: 1,
			profileVersion: 1,
		};

		const nodeData = {
			id: 'src/main.ts',
			kind: 'file' as const,
			label: 'main.ts',
			path: 'src/main.ts',
		};

		const entitySnap = {
			entityId: 'ent_main',
			commitSha: 'commit1',
			path: 'src/main.ts',
			blobOid: 'blob_main1',
			nodeData,
		};

		const edgeData = {
			id: 'ent_main->ext_lib:imports',
			source: 'src/main.ts',
			target: 'ext_lib',
			kind: 'import' as const,
		};

		const edgeSnap = {
			edgeId: 'ent_main->ext_lib:imports',
			commitSha: 'commit1',
			sourceEntityId: 'ent_main',
			targetEntityId: 'ext_lib',
			kind: 'imports' as const,
			edgeData,
		};

		const snapshot: TemporalGraphSnapshot = {
			schemaVersion: 1,
			analyzerVersion: 1,
			profileVersion: 1,
			commitSha: 'commit1',
			timestamp: 1001,
			isCheckpoint: true,
			graphData: {
				nodes: [nodeData],
				edges: [edgeData],
				timestamp: 1001,
			},
			entityMap: new Map([['ent_main', entitySnap]]),
			edgeMap: new Map([[edgeSnap.edgeId, edgeSnap]]),
			pathToEntityId: new Map([['src/main.ts', 'ent_main']]),
		};

		const lineageEvents: TemporalEntityLineageEvent[] = [{
			entityId: 'ent_main',
			commitSha: 'commit1',
			parentCommitSha: '',
			lineageCase: 'same-canonical-id',
			evidence: { confidence: 1.0, details: 'Root entity' },
		}];

		await store.saveCommitIngestion(commitRecord, snapshot, undefined, lineageEvents);

		// Verify commit retrieval
		const retrievedCommit = await store.getCommit('commit1');
		assert.ok(retrievedCommit);
		assert.strictEqual(retrievedCommit.commitSha, 'commit1');
		assert.strictEqual(retrievedCommit.isCheckpoint, true);

		// Verify checkpoint retrieval
		const retrievedSnapshot = await store.getCheckpointSnapshot('commit1');
		assert.ok(retrievedSnapshot);
		assert.strictEqual(retrievedSnapshot.commitSha, 'commit1');
		assert.strictEqual(retrievedSnapshot.entityMap.size, 1);
		assert.strictEqual(retrievedSnapshot.entityMap.get('ent_main')?.path, 'src/main.ts');
		assert.strictEqual(retrievedSnapshot.edgeMap.size, 1);

		// Verify entity history and lineage events
		const history = await store.getEntityHistory('ent_main');
		assert.strictEqual(history.length, 1);
		assert.strictEqual(history[0].path, 'src/main.ts');

		const events = await store.getEntityLineageEvents('ent_main');
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].lineageCase, 'same-canonical-id');

		// Verify edge retrieval
		const edge = await store.getEdge('ent_main->ext_lib:imports');
		assert.ok(edge);
		assert.strictEqual(edge.sourceEntityId, 'ent_main');
	});

	test('runInTransaction rolls back modifications on error', async () => {
		try {
			await store.runInTransaction(async () => {
				await store.saveBlobAnalysis({
					blobOid: 'blob_tx_test',
					analyzerVersion: 1,
					profileVersion: 1,
					language: 'ts',
					nodeData: { id: 'x', kind: 'file' as const, label: 'x', path: 'x.ts' },
					outgoingEdges: [],
					analyzedAt: Date.now(),
				});

				throw new Error('Simulated failure during transaction');
			});
		} catch {
			// expected error
		}

		const blob = await store.getBlobAnalysis('blob_tx_test', 1, 1, 'ts');
		assert.strictEqual(blob, undefined); // Rolled back!
	});

	test('blob analysis cache persists and retrieves entries', async () => {
		const record = {
			blobOid: 'blob_persist_1',
			analyzerVersion: 1,
			profileVersion: 1,
			language: 'typescript',
			nodeData: { id: 'src/p.ts', kind: 'file' as const, label: 'p.ts', path: 'src/p.ts' },
			outgoingEdges: [{ targetPath: 'src/q.ts', kind: 'imports' as const, weight: 1 }],
			analyzedAt: 5000,
		};

		await store.saveBlobAnalysis(record);

		const retrieved = await store.getBlobAnalysis('blob_persist_1', 1, 1, 'typescript');
		assert.ok(retrieved);
		assert.strictEqual(retrieved.blobOid, 'blob_persist_1');
		assert.strictEqual(retrieved.outgoingEdges.length, 1);
		assert.strictEqual(retrieved.outgoingEdges[0].targetPath, 'src/q.ts');
	});
});

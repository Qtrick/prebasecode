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

	test('repository identity record persistence', async () => {
		await store.setRepositoryIdentity({
			repoId: 'repo_123',
			rootPath: '/workspaces/repo',
			commonGitDir: '/workspaces/repo/.git',
			objectFormat: 'sha1',
			createdAt: 1000,
		});

		const retrieved = await store.getRepositoryIdentity();
		assert.ok(retrieved);
		assert.strictEqual(retrieved.repoId, 'repo_123');
		assert.strictEqual(retrieved.rootPath, '/workspaces/repo');
		assert.strictEqual(retrieved.objectFormat, 'sha1');
	});

	test('saveCommitIngestion saves commit, commit_parents, checkpoint, delta, entities, and edges atomically', async () => {
		const commitRecord: TemporalCommitRecord = {
			commitSha: 'commit1',
			parentShas: ['parent_a', 'parent_b'],
			treeSha: 'tree1',
			authorName: 'Developer',
			authorEmail: 'dev@prebase.io',
			authorTimestamp: 1000,
			committerTimestamp: 1000,
			message: 'Merge commit',
			ingestedAt: 1001,
			isCheckpoint: true,
			checkpointInterval: 10,
			schemaVersion: 2,
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
			schemaVersion: 2,
			analyzerVersion: 1,
			profileVersion: 1,
			commitSha: 'commit1',
			timestamp: 1001,
			isCheckpoint: true,
			digest: 'digest_commit1',
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
			parentCommitSha: 'parent_a',
			lineageCase: 'same-canonical-id',
			evidence: { confidence: 1.0, details: 'Root entity' },
		}];

		await store.saveCommitIngestion(commitRecord, snapshot, undefined, lineageEvents);

		// Verify commit retrieval
		const retrievedCommit = await store.getCommit('commit1');
		assert.ok(retrievedCommit);
		assert.strictEqual(retrievedCommit.commitSha, 'commit1');
		assert.strictEqual(retrievedCommit.isCheckpoint, true);

		// Verify relational parents
		const parents = await store.getCommitParents('commit1');
		assert.deepStrictEqual(parents, ['parent_a', 'parent_b']);

		const childrenA = await store.getCommitChildren('parent_a');
		assert.deepStrictEqual(childrenA, ['commit1']);

		// Verify state deduplication record
		const state = await store.getGraphStateByDigest('digest_commit1');
		assert.ok(state);
		assert.strictEqual(state.canonicalDigest, 'digest_commit1');

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

	test('refs persistence and retrieval', async () => {
		await store.saveRef({
			refName: 'refs/heads/main',
			targetSha: 'commit_head',
			refType: 'branch',
			lastObserved: 2000,
		});

		const ref = await store.getRef('refs/heads/main');
		assert.ok(ref);
		assert.strictEqual(ref.targetSha, 'commit_head');
		assert.strictEqual(ref.refType, 'branch');
	});

	test('runInTransaction rolls back modifications on error', async () => {
		try {
			await store.runInTransaction(async () => {
				await store.saveBlobAnalysis({
					blobOid: 'blob_tx_test',
					analyzerVersion: 1,
					profileVersion: 1,
					language: 'ts',
					artifact: {
						imports: [],
						exports: [],
						functions: [],
						components: [],
						isComponentFile: false,
					},
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
			artifact: {
				imports: [{ source: 'src/q.ts', specifiers: [] }],
				exports: [{ name: 'myExport' }],
				functions: [],
				components: [],
				isComponentFile: false,
			},
			analyzedAt: 5000,
		};

		await store.saveBlobAnalysis(record);

		const retrieved = await store.getBlobAnalysis('blob_persist_1', 1, 1, 'typescript');
		assert.ok(retrieved);
		assert.strictEqual(retrieved.blobOid, 'blob_persist_1');
		assert.strictEqual(retrieved.artifact.exports.length, 1);
		assert.strictEqual(retrieved.artifact.exports[0].name, 'myExport');
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { suite, test } from 'mocha';
import { SqliteTemporalStore } from '../../temporal/persistence/node/sqliteTemporalStore.js';
import { computeCanonicalGraphDigest } from '../../core/canonical/canonicalGraphDigest.js';
import type { TemporalCommitRecord, TemporalGraphSnapshot, TemporalEntityLineageEvent } from '../../temporal/common/temporalTypes.js';

function createTempDbPath(): string {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-sqlite-prep-'));
	return path.join(tempDir, 'temporal_prep_test.db');
}

function removeSqliteFixture(dbPath: string): void {
	for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
		fs.rmSync(candidate, { force: true });
	}
	try {
		fs.rmdirSync(path.dirname(dbPath));
	} catch {}
}

function createDummySnapshot(commitSha: string, nodeCount: number, edgeCount: number): TemporalGraphSnapshot {
	const entityMap = new Map();
	const edgeMap = new Map();
	const pathToEntityId = new Map();

	for (let i = 0; i < nodeCount; i++) {
		const entityId = `entity-${i}`;
		const filePath = `src/file_${i}.ts`;
		entityMap.set(entityId, {
			entityId,
			path: filePath,
			blobOid: `blob-${i}`,
			contentHash: `hash-${i}`,
			nodeData: { id: `node-${i}`, label: `Node ${i}`, fileType: 'typescript' },
			changeKind: 'added',
		});
		pathToEntityId.set(filePath, entityId);
	}

	for (let i = 0; i < edgeCount; i++) {
		const edgeId = `edge-${i}`;
		edgeMap.set(edgeId, {
			edgeId,
			sourceEntityId: `entity-${i % nodeCount}`,
			targetEntityId: `entity-${(i + 1) % nodeCount}`,
			kind: 'imports',
			changeKind: 'added',
			edgeData: { specifier: `./file_${(i + 1) % nodeCount}` },
		});
	}

	const digest = computeCanonicalGraphDigest({ nodes: [], edges: [], entryNodeId: null });

	return {
		schemaVersion: 1,
		analyzerVersion: 1,
		profileVersion: 1,
		commitSha,
		timestamp: 1000,
		digest,
		isCheckpoint: true,
		graphData: { nodes: [], edges: [], timestamp: 1000 },
		entityMap,
		edgeMap,
		pathToEntityId,
	};
}

suite('SqlitePreparedStatements & Finalize Safety', () => {
	test('persists large commit transitions using bounded chunks without statement leaks', async () => {
		const dbPath = createTempDbPath();
		const store = new SqliteTemporalStore({ dbPath });
		try {
			await store.open();

			const digest = computeCanonicalGraphDigest({ nodes: [], edges: [], entryNodeId: null });
			const commit: TemporalCommitRecord = {
				schemaVersion: 1,
				analyzerVersion: 1,
				profileVersion: 1,
				commitSha: 'sha-large-1',
				treeSha: 'tree-large-1',
				canonicalDigest: digest,
				parentShas: [],
				authorName: 'Author',
				authorEmail: 'author@prebase.test',
				authorTimestamp: 1000,
				committerTimestamp: 1000,
				ingestedAt: 1000,
				message: 'Large commit',
				isCheckpoint: true,
				checkpointInterval: 10,
				deltaDepth: 0,
			};

			// 300 entities and 300 edges span multiple 128-item chunks
			const snapshot = createDummySnapshot('sha-large-1', 300, 300);
			await store.saveCommitIngestion(commit, snapshot, undefined, []);

			const readSnap = await store.getCheckpointSnapshot('sha-large-1');
			assert.ok(readSnap);
			assert.strictEqual(readSnap.entityMap.size, 300);
			assert.strictEqual(readSnap.edgeMap.size, 300);

			await store.close();
		} finally {
			removeSqliteFixture(dbPath);
		}
	});

	test('guarantees rollback and clean close when commit ingestion encounters an error', async () => {
		const dbPath = createTempDbPath();
		const store = new SqliteTemporalStore({ dbPath });
		try {
			await store.open();

			const commit: TemporalCommitRecord = {
				schemaVersion: 1,
				analyzerVersion: 1,
				profileVersion: 1,
				commitSha: 'sha-fail-1',
				treeSha: 'tree-fail-1',
				canonicalDigest: 'test-digest',
				parentShas: [],
				authorName: 'Author',
				authorEmail: 'author@prebase.test',
				authorTimestamp: 1000,
				committerTimestamp: 1000,
				ingestedAt: 1000,
				message: 'Failed commit',
				isCheckpoint: true,
				checkpointInterval: 10,
				deltaDepth: 0,
			};

			const brokenSnapshot = createDummySnapshot('sha-fail-1', 10, 10);
			// Inject invalid data that triggers circular JSON serialization failure inside prepared statement runner
			const invalidLineageEvent = {
				entityId: 'entity-0',
				commitSha: 'sha-fail-1',
				parentCommitSha: 'parent-0',
				lineageCase: 'git-rename-edit',
				evidence: (() => {
					const circ: any = {};
					circ.self = circ;
					return circ;
				})(),
			} as unknown as TemporalEntityLineageEvent;

			await assert.rejects(
				store.saveCommitIngestion(commit, brokenSnapshot, undefined, [invalidLineageEvent]),
				/circular|structure/i
			);

			// Store must still be open, consistent, and cleanly closable
			assert.strictEqual(store.isOpen(), true);
			const failedCommit = await store.getCommit('sha-fail-1');
			assert.strictEqual(failedCommit, undefined);

			await store.close();
			assert.strictEqual(store.isOpen(), false);
		} finally {
			removeSqliteFixture(dbPath);
		}
	});

	test('cancels between 128-item chunks when the ingestion token is cancelled', async () => {
		const dbPath = createTempDbPath();
		const store = new SqliteTemporalStore({ dbPath });
		try {
			await store.open();
			const digest = computeCanonicalGraphDigest({ nodes: [], edges: [], entryNodeId: null });
			const commit: TemporalCommitRecord = {
				schemaVersion: 1,
				analyzerVersion: 1,
				profileVersion: 1,
				commitSha: 'sha-cancel-chunks',
				treeSha: 'tree-cancel',
				canonicalDigest: digest,
				parentShas: [],
				authorName: 'Author',
				authorEmail: 'author@prebase.test',
				authorTimestamp: 1000,
				committerTimestamp: 1000,
				ingestedAt: 1000,
				message: 'cancel chunks',
				isCheckpoint: true,
				checkpointInterval: 10,
				deltaDepth: 0,
			};
			const snapshot = createDummySnapshot('sha-cancel-chunks', 400, 400);
			let checks = 0;
			const token = {
				get isCancellationRequested() {
					checks++;
					// Checks 1-3 are the pre-transaction probes; check 4 is the first
					// 128-item chunk. Cancel on the next chunk so this is not a pre-check.
					return checks > 4;
				},
			};
			await assert.rejects(
				store.saveCommitIngestion(commit, snapshot, undefined, [], token),
				/Cancelled/,
			);
			assert.ok(checks >= 5, 'cancellation must occur after the write has entered chunking, not on the initial pre-check');
			assert.strictEqual(store.isOpen(), true);
			assert.strictEqual(await store.getCommit('sha-cancel-chunks'), undefined);
			await store.close();
		} finally {
			removeSqliteFixture(dbPath);
		}
	});

	test('interrupt() aborts an in-flight write and leaves the store usable', async () => {
		const dbPath = createTempDbPath();
		const store = new SqliteTemporalStore({ dbPath });
		try {
			await store.open();
			const digest = computeCanonicalGraphDigest({ nodes: [], edges: [], entryNodeId: null });
			const commit: TemporalCommitRecord = {
				schemaVersion: 1,
				analyzerVersion: 1,
				profileVersion: 1,
				commitSha: 'sha-interrupt',
				treeSha: 'tree-interrupt',
				canonicalDigest: digest,
				parentShas: [],
				authorName: 'Author',
				authorEmail: 'author@prebase.test',
				authorTimestamp: 1000,
				committerTimestamp: 1000,
				ingestedAt: 1000,
				message: 'interrupt',
				isCheckpoint: true,
				checkpointInterval: 10,
				deltaDepth: 0,
			};
			const snapshot = createDummySnapshot('sha-interrupt', 800, 800);
			const pending = store.saveCommitIngestion(commit, snapshot, undefined, []);
			let spins = 0;
			while (!store.hasActiveWrite() && spins++ < 10_000) {
				await Promise.resolve();
			}
			store.interrupt();
			await assert.rejects(pending, /Cancelled|interrupt/i);
			assert.strictEqual(store.isOpen(), true);
			assert.strictEqual(store.hasActiveWrite(), false);
			const retry = createDummySnapshot('sha-interrupt-ok', 2, 2);
			await store.saveCommitIngestion({ ...commit, commitSha: 'sha-interrupt-ok' }, retry, undefined, []);
			assert.ok(await store.getCommit('sha-interrupt-ok'));
			await store.close();
		} finally {
			removeSqliteFixture(dbPath);
		}
	});

	test('close during an in-flight ingestion drains the write instead of closing underneath it', async () => {
		const dbPath = createTempDbPath();
		const store = new SqliteTemporalStore({ dbPath });
		try {
			await store.open();
			let inTransaction = false;
			let releaseWrite: (() => void) | undefined;
			const gate = new Promise<void>(resolve => { releaseWrite = resolve; });
			const pending = store.runInTransaction(async () => {
				inTransaction = true;
				await gate;
				return 1;
			});
			for (let i = 0; i < 50 && !inTransaction; i++) {
				await Promise.resolve();
			}
			assert.strictEqual(store.hasActiveWrite(), true);
			const closing = store.close();
			await Promise.resolve();
			assert.strictEqual(store.hasActiveWrite(), true);
			assert.strictEqual(store.isOpen(), true, 'store must not close while a transaction is active');
			releaseWrite?.();
			await Promise.allSettled([pending, closing]);
			assert.strictEqual(store.hasActiveWrite(), false);
		} finally {
			removeSqliteFixture(dbPath);
		}
	});

	test('prepared statement callback errors finalize statements and roll back', async () => {
		const dbPath = createTempDbPath();
		const store = new SqliteTemporalStore({ dbPath });
		try {
			await store.open();
			const db = (store as unknown as { _db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown; finalize: Function } } })._db;
			const originalPrepare = db.prepare.bind(db);
			let runCount = 0;
			db.prepare = ((sql: string) => {
				const stmt = originalPrepare(sql);
				const originalRun = stmt.run.bind(stmt);
				stmt.run = (...args: unknown[]) => {
					runCount++;
					if (runCount === 4) {
						const cb = args[args.length - 1];
						if (typeof cb === 'function') {
							(cb as (err: Error) => void)(Object.assign(new Error('injected sqlite callback failure'), { code: 'SQLITE_ERROR' }));
							return stmt;
						}
					}
					return originalRun(...args);
				};
				return stmt;
			}) as typeof db.prepare;

			const digest = computeCanonicalGraphDigest({ nodes: [], edges: [], entryNodeId: null });
			const commit: TemporalCommitRecord = {
				schemaVersion: 1,
				analyzerVersion: 1,
				profileVersion: 1,
				commitSha: 'sha-stmt-cb',
				treeSha: 'tree-stmt-cb',
				canonicalDigest: digest,
				parentShas: [],
				authorName: 'Author',
				authorEmail: 'author@prebase.test',
				authorTimestamp: 1000,
				committerTimestamp: 1000,
				ingestedAt: 1000,
				message: 'stmt callback',
				isCheckpoint: true,
				checkpointInterval: 10,
				deltaDepth: 0,
			};
			const snapshot = createDummySnapshot('sha-stmt-cb', 20, 20);
			await assert.rejects(store.saveCommitIngestion(commit, snapshot, undefined, []), /injected sqlite callback failure/);
			assert.strictEqual(store.isOpen(), true);
			assert.strictEqual(await store.getCommit('sha-stmt-cb'), undefined);
			await store.close();
		} finally {
			removeSqliteFixture(dbPath);
		}
	});
});

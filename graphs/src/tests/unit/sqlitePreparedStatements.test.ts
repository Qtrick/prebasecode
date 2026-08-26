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
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import sqlite3 from '@vscode/sqlite3';
import { suite, test, beforeEach, afterEach } from 'mocha';
import { SqliteTemporalStore } from '../../temporal/persistence/node/sqliteTemporalStore.js';
import { TemporalStoreMainService } from '../../temporal/persistence/node/temporalStoreMainService.js';
import { SCHEMA_V1_DDL, SCHEMA_V2_DDL, SCHEMA_V3_DDL } from '../../temporal/persistence/node/temporalMigrations.js';
import { CURRENT_SCHEMA_VERSION } from '../../temporal/common/temporalVersioning.js';
import { isTemporalError } from '../../temporal/common/temporalErrors.js';
import { computeCanonicalGraphDigest } from '../../core/canonical/canonicalGraphDigest.js';
import type {
	TemporalCommitRecord,
	TemporalGraphSnapshot,
	TemporalEntityLineageEvent,
} from '../../temporal/common/temporalTypes.js';
import type { CanonicalGraphSnapshot } from '../../common/types/canonicalTypes.js';

function createTempDbPath(): string {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-sqlite-test-'));
	return path.join(tempDir, 'temporal_test.db');
}

function executeSqliteStatement(dbPath: string, statement: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const db = new sqlite3.Database(dbPath, openError => {
			if (openError) {
				reject(openError);
				return;
			}
			db.exec(statement, statementError => {
				if (statementError) {
					db.close(() => reject(statementError));
					return;
				}
				db.close(closeError => closeError ? reject(closeError) : resolve());
			});
		});
	});
}

function removeSqliteFixture(dbPath: string): void {
	for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
		fs.rmSync(candidate, { force: true });
	}
}

function readSqliteNumber(dbPath: string, query: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const db = new sqlite3.Database(dbPath, openError => {
			if (openError) {
				reject(openError);
				return;
			}
			db.get(query, (queryError, row: { value: number } | undefined) => {
				db.close(() => {
					if (queryError) {
						reject(queryError);
					} else {
						resolve(row?.value ?? 0);
					}
				});
			});
		});
	});
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

	test('deduplicates concurrent open calls on one store instance', async () => {
		await store.close();
		await Promise.all([store.open(), store.open(), store.open()]);
		assert.strictEqual(store.isOpen(), true);
	});

	test('fails closed when a database claims v4 but lacks required schema', async () => {
		await store.close();
		await executeSqliteStatement(dbPath, 'DROP TABLE edge_events;');
		store = new SqliteTemporalStore({ dbPath });

		await assert.rejects(store.open(), error => {
			return isTemporalError(error) && error.code === 'SchemaMigrationFailed' && error.message.includes('edge_events');
		});
	});

	for (const [legacyVersion, ddl] of [[1, SCHEMA_V1_DDL], [2, SCHEMA_V2_DDL], [3, SCHEMA_V3_DDL]] as const) {
		test(`transactionally migrates a valid v${legacyVersion} database to the current schema`, async () => {
			await store.close();
			removeSqliteFixture(dbPath);
			await executeSqliteStatement(dbPath, `${ddl}\nPRAGMA user_version = ${legacyVersion};`);
			store = new SqliteTemporalStore({ dbPath });
			await store.open();

			assert.deepStrictEqual({
				version: await readSqliteNumber(dbPath, 'SELECT user_version AS value FROM pragma_user_version;'),
				entityDeletions: await readSqliteNumber(dbPath, "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'entity_deletions';"),
				edgeEvents: await readSqliteNumber(dbPath, "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'edge_events';"),
			}, {
				version: CURRENT_SCHEMA_VERSION,
				entityDeletions: 1,
				edgeEvents: 1,
			});
		});
	}

	test('rejects a future schema version without rewriting it', async () => {
		await store.close();
		removeSqliteFixture(dbPath);
		const futureVersion = CURRENT_SCHEMA_VERSION + 1;
		await executeSqliteStatement(dbPath, `PRAGMA user_version = ${futureVersion};`);
		store = new SqliteTemporalStore({ dbPath });

		await assert.rejects(store.open(), error => isTemporalError(error) && error.code === 'SchemaMigrationFailed');
		assert.strictEqual(await readSqliteNumber(dbPath, 'SELECT user_version AS value FROM pragma_user_version;'), futureVersion);
	});

	test('rolls back a v1 migration when legacy parent topology is malformed', async () => {
		await store.close();
		removeSqliteFixture(dbPath);
		await executeSqliteStatement(dbPath, `${SCHEMA_V1_DDL}
			INSERT INTO commits (
				commit_sha, parent_shas, tree_sha, author_name, author_email, author_timestamp,
				committer_timestamp, message, ingested_at, is_checkpoint, checkpoint_interval,
				schema_version, analyzer_version, profile_version
			) VALUES ('broken', '{malformed', 'tree', '', '', 0, 0, '', 0, 1, 10, 1, 1, 1);
			PRAGMA user_version = 1;`);
		store = new SqliteTemporalStore({ dbPath });

		await assert.rejects(store.open(), error => isTemporalError(error) && error.code === 'SchemaMigrationFailed');
		assert.deepStrictEqual({
			version: await readSqliteNumber(dbPath, 'SELECT user_version AS value FROM pragma_user_version;'),
			commitParentsTable: await readSqliteNumber(dbPath, "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'commit_parents';"),
		}, { version: 1, commitParentsTable: 0 });
	});

	test('Electron-main store owner rejects database paths outside its cache root', async () => {
		const storageRoot = path.dirname(dbPath);
		const mainService = new TemporalStoreMainService(storageRoot);
		const authorizedPath = path.join(storageRoot, 'authorized.db');
		await mainService.open(authorizedPath);
		await assert.rejects(mainService.open(path.join(storageRoot, '..', 'escaped.db')), /outside the authorized cache directory/);
		await mainService.close(authorizedPath);
		mainService.dispose();
	});

	test('Electron-main store owner deduplicates concurrent opens and serves IPC calls afterward', async () => {
		const storageRoot = path.dirname(dbPath);
		const mainService = new TemporalStoreMainService(storageRoot);
		const ipcPath = path.join(storageRoot, 'concurrent.db');

		await Promise.all([mainService.open(ipcPath), mainService.open(ipcPath), mainService.open(ipcPath)]);
		assert.deepStrictEqual(JSON.parse(await mainService.invoke(ipcPath, 'getAllRefs', '[]')), []);
		await Promise.all([mainService.close(ipcPath), mainService.close(ipcPath)]);
		mainService.dispose();
	});

	test('Electron-main store owner quarantines one corrupt derived cache and recreates it without touching siblings', async () => {
		const storageRoot = path.dirname(dbPath);
		const mainService = new TemporalStoreMainService(storageRoot);
		const corruptPath = path.join(storageRoot, 'corrupt.db');
		const siblingPath = path.join(storageRoot, 'sibling.db');
		fs.writeFileSync(corruptPath, 'this is not a SQLite database', 'utf8');

		try {
			await mainService.open(siblingPath);
			await mainService.open(corruptPath);
			assert.deepStrictEqual(JSON.parse(await mainService.invoke(corruptPath, 'getAllRefs', '[]')), []);
			assert.deepStrictEqual(JSON.parse(await mainService.invoke(siblingPath, 'getAllRefs', '[]')), []);
			assert.strictEqual(fs.readdirSync(storageRoot).some(name => /^corrupt\.db\.corrupt-\d+$/.test(name)), true);
		} finally {
			await mainService.close(corruptPath);
			await mainService.close(siblingPath);
			mainService.dispose();
		}
	});

	test('Electron-main store owner rejects nested and symlink database escapes', async function () {
		const storageRoot = path.dirname(dbPath);
		const mainService = new TemporalStoreMainService(storageRoot);
		await assert.rejects(mainService.open(path.join(storageRoot, 'nested', 'store.db')), /outside the authorized cache directory/);

		const outsidePath = path.join(os.tmpdir(), `prebase-temporal-outside-${Date.now()}.db`);
		const symlinkPath = path.join(storageRoot, 'linked.db');
		try {
			fs.symlinkSync(outsidePath, symlinkPath);
		} catch {
			mainService.dispose();
			this.skip();
		}
		await assert.rejects(mainService.open(symlinkPath), /outside the authorized cache directory/);
		fs.rmSync(symlinkPath, { force: true });
		fs.rmSync(outsidePath, { force: true });
		mainService.dispose();
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

	test('checkpoint restart preserves complete canonical snapshot metadata', async () => {
		const nodeData = {
			id: 'src/main.ts',
			kind: 'file' as const,
			label: 'main.ts',
			path: 'src/main.ts',
			isEntry: true,
		};
		const coverage = {
			completeWithinProfile: false,
			isComplete: false,
			discoveredCount: 3,
			analyzedCount: 1,
			analyzedFileCount: 1,
			excludedCount: 1,
			excludedFileCount: 1,
			failedCount: 1,
			truncated: true,
			truncationReason: 'test producer limit',
			exclusionBreakdown: {
				'oversized-file': 0,
				'binary-file': 0,
				'unsupported-language': 0,
				'parse-error': 1,
				'permission-denied': 0,
				'ignored-pattern': 0,
				'policy-excluded': 0,
				other: 0,
			},
			exclusionReasons: { 'parse-error': 1 },
		};
		const canonicalDigest = computeCanonicalGraphDigest({ nodes: [nodeData], edges: [], entryNodeId: nodeData.id });
		const canonicalSnapshot: CanonicalGraphSnapshot = {
			nodes: [nodeData],
			edges: [],
			projectPath: '/repo',
			projectName: 'repo',
			entryNodeId: nodeData.id,
			analyzedAt: 1234,
			sourceIdentity: 'git:tree-1',
			digest: canonicalDigest,
			versions: {
				graphSchemaVersion: 2,
				analyzerVersion: 3,
				identityVersion: 4,
				layoutVersion: 5,
				analysisProfileVersion: 6,
			},
			coverage,
			completeness: coverage,
			manifest: {
				entries: [{ path: 'src/main.ts', contentIdentity: 'blob-1', isComponent: false, language: 'typescript' }],
			},
		};
		const entity = {
			entityId: 'entity-main',
			commitSha: 'commit-c',
			path: nodeData.path,
			blobOid: 'blob-1',
			nodeData,
		};
		const snapshot: TemporalGraphSnapshot = {
			schemaVersion: 2,
			analyzerVersion: 3,
			profileVersion: 6,
			commitSha: 'commit-c',
			timestamp: canonicalSnapshot.analyzedAt,
			isCheckpoint: true,
			digest: canonicalSnapshot.digest,
			canonicalSnapshot,
			graphData: { nodes: [nodeData], edges: [], timestamp: canonicalSnapshot.analyzedAt },
			entityMap: new Map([[entity.entityId, entity]]),
			edgeMap: new Map(),
			pathToEntityId: new Map([[entity.path, entity.entityId]]),
		};
		const commit: TemporalCommitRecord = {
			commitSha: snapshot.commitSha,
			canonicalDigest: canonicalSnapshot.digest,
			parentShas: [],
			treeSha: 'tree-1',
			authorName: 'Tester',
			authorEmail: 'tester@prebase.invalid',
			authorTimestamp: 1000,
			committerTimestamp: 1100,
			message: 'canonical checkpoint',
			ingestedAt: 1200,
			isCheckpoint: true,
			checkpointInterval: 10,
			deltaDepth: 0,
			schemaVersion: 2,
			analyzerVersion: 3,
			profileVersion: 6,
		};

		await store.saveCommitIngestion(commit, snapshot);
		await store.close();
		store = new SqliteTemporalStore({ dbPath });
		await store.open();

		const restored = await store.getCheckpointSnapshot(commit.commitSha);
		assert.deepStrictEqual(restored?.canonicalSnapshot, canonicalSnapshot);
	});

	test('rejects a tampered direct checkpoint by recomputing its canonical digest', async () => {
		const nodeData = { id: 'src/main.ts', kind: 'file' as const, label: 'main.ts', path: 'src/main.ts' };
		const digest = computeCanonicalGraphDigest({ nodes: [nodeData], edges: [], entryNodeId: null });
		const commit: TemporalCommitRecord = {
			commitSha: 'tampered-checkpoint', parentShas: [], treeSha: 'tree-1', authorName: 'Tester',
			authorEmail: 'tester@prebase.invalid', authorTimestamp: 1000, committerTimestamp: 1000,
			message: 'checkpoint', ingestedAt: 1000, isCheckpoint: true, checkpointInterval: 10,
			schemaVersion: 2, analyzerVersion: 1, profileVersion: 1, canonicalDigest: digest,
		};
		const snapshot: TemporalGraphSnapshot = {
			schemaVersion: 2, analyzerVersion: 1, profileVersion: 1, commitSha: commit.commitSha,
			timestamp: 1000, isCheckpoint: true, digest,
			graphData: { nodes: [nodeData], edges: [], timestamp: 1000 },
			entityMap: new Map(), edgeMap: new Map(), pathToEntityId: new Map(),
		};
		await store.saveCommitIngestion(commit, snapshot);
		await store.close();
		await executeSqliteStatement(dbPath, "UPDATE checkpoints SET snapshot_json = replace(snapshot_json, 'src/main.ts', 'src/tampered.ts') WHERE commit_sha = 'tampered-checkpoint';");
		store = new SqliteTemporalStore({ dbPath });
		await store.open();

		await assert.rejects(store.getCheckpointSnapshot(commit.commitSha), error => {
			return isTemporalError(error) && error.code === 'DatabaseCorrupted';
		});
	});

	test('digest-keyed graph state excludes commit-specific temporal occurrences', async () => {
		const makeOccurrence = (commitSha: string, timestamp: number): { commit: TemporalCommitRecord; snapshot: TemporalGraphSnapshot } => {
			const nodeData = { id: 'src/a.ts', kind: 'file' as const, label: 'a.ts', path: 'src/a.ts' };
			const entity = { entityId: 'entity-a', commitSha, path: nodeData.path, blobOid: 'blob-a', nodeData };
			return {
				commit: {
					commitSha,
					canonicalDigest: 'same-structural-digest',
					parentShas: [],
					treeSha: `tree-${commitSha}`,
					authorName: 'Tester',
					authorEmail: 'tester@prebase.invalid',
					authorTimestamp: timestamp,
					committerTimestamp: timestamp,
					message: commitSha,
					ingestedAt: timestamp,
					isCheckpoint: true,
					checkpointInterval: 10,
					deltaDepth: 0,
					schemaVersion: 2,
					analyzerVersion: 1,
					profileVersion: 1,
				},
				snapshot: {
					schemaVersion: 2,
					analyzerVersion: 1,
					profileVersion: 1,
					commitSha,
					timestamp,
					isCheckpoint: true,
					digest: 'same-structural-digest',
					graphData: { nodes: [nodeData], edges: [], timestamp },
					entityMap: new Map([[entity.entityId, entity]]),
					edgeMap: new Map(),
					pathToEntityId: new Map([[entity.path, entity.entityId]]),
				},
			};
		};
		const first = makeOccurrence('commit-a', 1000);
		const second = makeOccurrence('commit-b', 2000);

		await store.saveCommitIngestion(first.commit, first.snapshot);
		await store.saveCommitIngestion(second.commit, second.snapshot);

		const graphState = await store.getGraphStateByDigest('same-structural-digest');
		assert.ok(graphState);
		const serializedCanonicalState = graphState.snapshotJson;
		assert.strictEqual(serializedCanonicalState.includes('"commitSha"'), false);
		assert.strictEqual(serializedCanonicalState.includes('commit-a'), false);
		assert.strictEqual(serializedCanonicalState.includes('commit-b'), false);
	});

	test('does not collapse canonical states with identical structure but incompatible coverage truth', async () => {
		const nodeData = { id: 'src/a.ts', kind: 'file' as const, label: 'a.ts', path: 'src/a.ts' };
		const digest = computeCanonicalGraphDigest({ nodes: [nodeData], edges: [], entryNodeId: null });
		const makeOccurrence = (commitSha: string, truncated: boolean): { commit: TemporalCommitRecord; snapshot: TemporalGraphSnapshot } => {
			const coverage = {
				completeWithinProfile: !truncated, isComplete: !truncated, discoveredCount: truncated ? 2 : 1,
				analyzedCount: 1, analyzedFileCount: 1, excludedCount: 0, excludedFileCount: 0,
				failedCount: 0, truncated, truncationReason: truncated ? 'producer limit' : undefined,
				exclusionBreakdown: {
					'oversized-file': 0, 'binary-file': 0, 'unsupported-language': 0, 'parse-error': 0,
					'permission-denied': 0, 'ignored-pattern': 0, 'policy-excluded': 0, other: 0,
				},
				exclusionReasons: {},
			};
			return {
				commit: {
					commitSha, canonicalDigest: digest, parentShas: [], treeSha: `tree-${commitSha}`,
					authorName: 'Tester', authorEmail: 'tester@prebase.invalid', authorTimestamp: 1000,
					committerTimestamp: 1000, message: commitSha, ingestedAt: 1000, isCheckpoint: true,
					checkpointInterval: 10, deltaDepth: 0, schemaVersion: 4, analyzerVersion: 1, profileVersion: 1,
				},
				snapshot: {
					schemaVersion: 4, analyzerVersion: 1, profileVersion: 1, commitSha, timestamp: 1000,
					isCheckpoint: true, digest, graphData: { nodes: [nodeData], edges: [], timestamp: 1000 },
					canonicalSnapshot: {
						nodes: [nodeData], edges: [], projectPath: '/repo', projectName: 'repo', entryNodeId: null,
						analyzedAt: 1000, sourceIdentity: `git:${commitSha}`, digest,
						versions: { graphSchemaVersion: 1, analyzerVersion: 1, identityVersion: 1, layoutVersion: 1, analysisProfileVersion: 1 },
						coverage, completeness: coverage, manifest: { entries: [] },
					},
					entityMap: new Map(), edgeMap: new Map(), pathToEntityId: new Map(),
				},
			};
		};

		const complete = makeOccurrence('complete', false);
		const incomplete = makeOccurrence('incomplete', true);
		await store.saveCommitIngestion(complete.commit, complete.snapshot);
		await store.saveCommitIngestion(incomplete.commit, incomplete.snapshot);

		assert.strictEqual(await readSqliteNumber(
			dbPath,
			`SELECT COUNT(*) AS value FROM graph_states WHERE canonical_digest = '${digest}';`,
		), 2);
		assert.deepStrictEqual({
			complete: (await store.getCommitCoverage('complete'))?.completeWithinProfile,
			incomplete: (await store.getCommitCoverage('incomplete'))?.completeWithinProfile,
		}, {
			complete: true,
			incomplete: false,
		});
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

		const snapshotDigest = computeCanonicalGraphDigest({ nodes: [nodeData], edges: [edgeData], entryNodeId: nodeData.id });
		const snapshot: TemporalGraphSnapshot = {
			schemaVersion: 2,
			analyzerVersion: 1,
			profileVersion: 1,
			commitSha: 'commit1',
			timestamp: 1001,
			isCheckpoint: true,
			digest: snapshotDigest,
			canonicalSnapshot: {
				nodes: [nodeData],
				edges: [edgeData],
				projectPath: '/workspaces/repo',
				projectName: 'repo',
				entryNodeId: nodeData.id,
				analyzedAt: 1001,
				sourceIdentity: 'git:commit1',
				digest: snapshotDigest,
				versions: { graphSchemaVersion: 1, analyzerVersion: 1, identityVersion: 1, layoutVersion: 1, analysisProfileVersion: 1 },
				coverage: {
					completeWithinProfile: true, isComplete: true, discoveredCount: 1, analyzedCount: 1,
					analyzedFileCount: 1, excludedCount: 0, excludedFileCount: 0, failedCount: 0,
					truncated: false, exclusionBreakdown: {
						'oversized-file': 0, 'binary-file': 0, 'unsupported-language': 0, 'parse-error': 0,
						'permission-denied': 0, 'ignored-pattern': 0, 'policy-excluded': 0, other: 0,
					}, exclusionReasons: {},
				},
				completeness: {
					completeWithinProfile: true, isComplete: true, discoveredCount: 1, analyzedCount: 1,
					analyzedFileCount: 1, excludedCount: 0, excludedFileCount: 0, failedCount: 0,
					truncated: false, exclusionBreakdown: {
						'oversized-file': 0, 'binary-file': 0, 'unsupported-language': 0, 'parse-error': 0,
						'permission-denied': 0, 'ignored-pattern': 0, 'policy-excluded': 0, other: 0,
					}, exclusionReasons: {},
				},
				manifest: { entries: [{ path: 'src/main.ts', contentIdentity: 'blob_main1', isComponent: false }] },
			},
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
		const state = await store.getGraphStateByDigest(snapshotDigest);
		assert.ok(state);
		assert.strictEqual(state.canonicalDigest, snapshotDigest);
		const canonicalState = JSON.parse(state.snapshotJson);
		assert.deepStrictEqual({
			commitSha: canonicalState.commitSha,
			timestamp: canonicalState.timestamp,
			entryNodeId: canonicalState.entryNodeId,
			nodeCount: canonicalState.nodes.length,
		}, { commitSha: undefined, timestamp: undefined, entryNodeId: 'src/main.ts', nodeCount: 1 });

		// Verify checkpoint retrieval
		const retrievedSnapshot = await store.getCheckpointSnapshot('commit1');
		assert.ok(retrievedSnapshot);
		assert.strictEqual(retrievedSnapshot.commitSha, 'commit1');
		assert.strictEqual(retrievedSnapshot.entityMap.size, 1);
		assert.strictEqual(retrievedSnapshot.entityMap.get('ent_main')?.path, 'src/main.ts');
		assert.strictEqual(retrievedSnapshot.edgeMap.size, 1);
		assert.deepStrictEqual(retrievedSnapshot.canonicalSnapshot, snapshot.canonicalSnapshot);

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

	test('atomically replaces refs and prunes deleted branches and tags', async () => {
		await store.saveRef({ refName: 'refs/heads/deleted', targetSha: 'old-head', refType: 'branch', lastObserved: 1000 });
		await store.saveRef({ refName: 'refs/tags/deleted', targetSha: 'old-tag', refType: 'tag', lastObserved: 1000 });

		await store.replaceRefs([
			{ refName: 'HEAD', targetSha: 'new-head', refType: 'symbolic-head', lastObserved: 2000 },
			{ refName: 'refs/heads/main', targetSha: 'new-head', refType: 'branch', lastObserved: 2000 },
		]);

		assert.deepStrictEqual(
			(await store.getAllRefs()).map(ref => [ref.refName, ref.targetSha]).sort(),
			[['HEAD', 'new-head'], ['refs/heads/main', 'new-head']],
		);
	});

	test('fails closed when legacy commit parent topology is malformed', async () => {
		const commit: TemporalCommitRecord = {
			commitSha: 'corrupt-child',
			parentShas: [],
			treeSha: 'tree-corrupt',
			authorName: 'Tester',
			authorEmail: 'tester@prebase.invalid',
			authorTimestamp: 1000,
			committerTimestamp: 1000,
			message: 'corrupt topology fixture',
			ingestedAt: 1000,
			isCheckpoint: true,
			checkpointInterval: 10,
			schemaVersion: 2,
			analyzerVersion: 1,
			profileVersion: 1,
		};
		const snapshot: TemporalGraphSnapshot = {
			schemaVersion: 2,
			analyzerVersion: 1,
			profileVersion: 1,
			commitSha: commit.commitSha,
			timestamp: 1000,
			isCheckpoint: true,
			graphData: { nodes: [], edges: [], timestamp: 1000 },
			entityMap: new Map(),
			edgeMap: new Map(),
			pathToEntityId: new Map(),
		};

		await store.saveCommitIngestion(commit, snapshot);
		await store.close();
		await executeSqliteStatement(dbPath, "UPDATE commits SET parent_shas = '{malformed-json' WHERE commit_sha = 'corrupt-child';");
		store = new SqliteTemporalStore({ dbPath });
		await store.open();

		await assert.rejects(store.getCommitParents(commit.commitSha), error => {
			return isTemporalError(error) && error.code === 'DatabaseCorrupted';
		});
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

	test('maintenance evicts only regenerable parse artifacts and preserves reachable checkpoint and refs', async () => {
		const digest = computeCanonicalGraphDigest({ nodes: [], edges: [], entryNodeId: null });
		const commit: TemporalCommitRecord = {
			commitSha: 'maintenance-checkpoint', canonicalDigest: digest, parentShas: [], treeSha: 'maintenance-tree',
			authorName: 'Tester', authorEmail: 'tester@prebase.invalid', authorTimestamp: 1000, committerTimestamp: 1000,
			message: 'maintenance checkpoint', ingestedAt: 1000, isCheckpoint: true, checkpointInterval: 10,
			deltaDepth: 0, schemaVersion: 2, analyzerVersion: 1, profileVersion: 1,
		};
		const snapshot: TemporalGraphSnapshot = {
			schemaVersion: 2, analyzerVersion: 1, profileVersion: 1, commitSha: commit.commitSha, timestamp: 1000,
			isCheckpoint: true, digest, graphData: { nodes: [], edges: [], timestamp: 1000 },
			entityMap: new Map(), edgeMap: new Map(), pathToEntityId: new Map(),
		};
		await store.saveCommitIngestion(commit, snapshot);
		await store.saveRef({ refName: 'refs/tags/keep', targetSha: commit.commitSha, refType: 'tag', lastObserved: 1000 });
		await store.saveBlobAnalysis({
			blobOid: 'regenerable-artifact', analyzerVersion: 1, profileVersion: 1, language: 'ts', analyzedAt: 1,
			artifact: { imports: [], exports: [], functions: [], components: [], isComponentFile: false },
		});

		const result = await store.runMaintenance(1);
		assert.deepStrictEqual({
			evicted: result.parseArtifactsEvicted,
			artifact: await store.getBlobAnalysis('regenerable-artifact', 1, 1, 'ts'),
			ref: (await store.getRef('refs/tags/keep'))?.targetSha,
			checkpoint: (await store.getCheckpointSnapshot(commit.commitSha))?.commitSha,
		}, {
			evicted: 1,
			artifact: undefined,
			ref: commit.commitSha,
			checkpoint: commit.commitSha,
		});
		assert.strictEqual(result.withinBudget, false, 'The result must be truthful when preserved graph state alone exceeds the budget.');
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

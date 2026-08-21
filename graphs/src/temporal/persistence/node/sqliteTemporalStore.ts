/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as sqlite3 from '@vscode/sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TemporalError } from '../../common/temporalErrors.js';
import { computeCanonicalGraphDigest } from '../../../core/canonical/canonicalGraphDigest.js';
import { computePureSha256 } from '../../../core/canonical/pureSha256.js';
import { computeAnalysisCacheKey, validateVersion } from '../../common/temporalVersioning.js';
import { runMigrations } from './temporalMigrations.js';
import type {
	ITemporalStore,
	RefRecord,
	RepositoryIdentityRecord,
	TemporalStoreMaintenanceResult,
} from '../common/temporalStore.js';
import type {
	BlobAnalysisRecord,
	TemporalCommitRecord,
	TemporalEdgeRecord,
	TemporalEdgeSnapshot,
	TemporalEntity,
	TemporalEntityLineageEvent,
	TemporalEntitySnapshot,
	TemporalGraphSnapshot,
	TemporalStructuralDelta,
} from '../../common/temporalTypes.js';
import type { CanonicalCoverage } from '../../../common/types/canonicalTypes.js';

export interface SqliteStoreOptions {
	readonly dbPath: string;
	readonly busyTimeoutMs?: number;
}

function getSqliteDatabaseConstructor(): any {
	const mod = sqlite3 as any;
	if (mod.default && typeof mod.default.Database === 'function') {
		return mod.default.Database;
	}
	if (typeof mod.Database === 'function') {
		return mod.Database;
	}
	if (typeof mod.default === 'function') {
		return mod.default;
	}
	return mod;
}

function runStatement(db: sqlite3.Database, statement: string): Promise<void> {
	return new Promise((resolve, reject) => {
		db.run(statement, error => error ? reject(error) : resolve());
	});
}

function readPragma(db: sqlite3.Database, name: string): Promise<string | number> {
	return new Promise((resolve, reject) => {
		db.get(`PRAGMA ${name};`, (error, row: Record<string, string | number> | undefined) => {
			if (error) {
				reject(error);
				return;
			}
			const value = row ? Object.values(row)[0] : undefined;
			if (value === undefined) {
				reject(new Error(`SQLite did not return a value for PRAGMA ${name}`));
				return;
			}
			resolve(value);
		});
	});
}

function isSqliteCorruption(error: unknown): boolean {
	if (error instanceof TemporalError) {
		return error.code === 'DatabaseCorrupted' || isSqliteCorruption(error.cause);
	}
	if (!(error instanceof Error)) {
		return false;
	}
	const errorWithCode = error as Error & { code?: unknown };
	const code = typeof errorWithCode.code === 'string' ? errorWithCode.code : '';
	return /SQLITE_(?:CORRUPT|NOTADB)/.test(code) || /(?:malformed|not a database|database disk image is malformed)/i.test(error.message);
}

function stableSerialize(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableSerialize).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function computeCanonicalStateId(snapshot: TemporalGraphSnapshot, canonicalDigest: string): string {
	const canonical = snapshot.canonicalSnapshot;
	if (!canonical) {
		return canonicalDigest;
	}
	return computePureSha256(stableSerialize({
		canonicalDigest,
		entryNodeId: canonical.entryNodeId,
		versions: canonical.versions,
		coverage: canonical.coverage,
		completeness: canonical.completeness,
	}));
}

export class SqliteTemporalStore implements ITemporalStore {
	private readonly _dbPath: string;
	private readonly _busyTimeoutMs: number;
	private _db: sqlite3.Database | undefined;
	private _isOpen = false;
	private _openPromise: Promise<void> | undefined;

	constructor(options: SqliteStoreOptions) {
		this._dbPath = options.dbPath;
		this._busyTimeoutMs = options.busyTimeoutMs ?? 3000;
	}

	isOpen(): boolean {
		return this._isOpen && this._db !== undefined;
	}

	async open(): Promise<void> {
		if (this.isOpen()) {
			return;
		}
		if (this._openPromise) {
			return this._openPromise;
		}
		const openPromise = this._open();
		this._openPromise = openPromise;
		try {
			await openPromise;
		} finally {
			if (this._openPromise === openPromise) {
				this._openPromise = undefined;
			}
		}
	}

	private async _open(): Promise<void> {

		// Ensure parent directory exists
		try {
			const dir = path.dirname(this._dbPath);
			if (dir) {
				fs.mkdirSync(dir, { recursive: true });
			}
		} catch (error) {
			throw new TemporalError('StoreNotOpen', 'Failed to create the Temporal database directory', error);
		}

		await new Promise<void>((resolve, reject) => {
			const DatabaseCtor = getSqliteDatabaseConstructor();
			const db: sqlite3.Database = new DatabaseCtor(this._dbPath, (err: any) => {
				if (err) {
					return reject(new TemporalError('StoreNotOpen', `Failed to open SQLite database at ${this._dbPath}`, err));
				}

				this._db = db;

				void (async () => {
					try {
						await this._configureDatabase(db);
						await runMigrations(db);
						const integrity = await readPragma(db, 'integrity_check');
						if (String(integrity).toLowerCase() !== 'ok') {
							throw new TemporalError('DatabaseCorrupted', 'SQLite integrity check failed for the derived Temporal cache');
						}
						this._isOpen = true;
						resolve();
					} catch (error) {
						this._db = undefined;
						db.close(() => reject(error));
					}
				})();
			});
		});
	}

	private async _configureDatabase(db: sqlite3.Database): Promise<void> {
		try {
			await runStatement(db, 'PRAGMA journal_mode = WAL;');
			await runStatement(db, `PRAGMA busy_timeout = ${this._busyTimeoutMs};`);
			await runStatement(db, 'PRAGMA synchronous = NORMAL;');
			await runStatement(db, 'PRAGMA foreign_keys = ON;');

			const [journalMode, busyTimeout, synchronous, foreignKeys] = await Promise.all([
				readPragma(db, 'journal_mode'),
				readPragma(db, 'busy_timeout'),
				readPragma(db, 'synchronous'),
				readPragma(db, 'foreign_keys'),
			]);
			if (String(journalMode).toLowerCase() !== 'wal' || Number(busyTimeout) !== this._busyTimeoutMs || Number(synchronous) !== 1 || Number(foreignKeys) !== 1) {
				throw new Error('SQLite returned an unsupported Temporal cache configuration');
			}
		} catch (error) {
			throw new TemporalError(
				isSqliteCorruption(error) ? 'DatabaseCorrupted' : 'StoreNotOpen',
				'Failed to configure or verify SQLite PRAGMAs',
				error
			);
		}
	}

	async close(): Promise<void> {
		if (this._openPromise) {
			try {
				await this._openPromise;
			} catch {
				return;
			}
		}
		if (!this._db) {
			this._isOpen = false;
			return;
		}

		return new Promise<void>((resolve, reject) => {
			this._db!.close((err) => {
				this._db = undefined;
				this._isOpen = false;
				if (err) {
					reject(new TemporalError('StoreNotOpen', 'Failed to close database', err));
				} else {
					resolve();
				}
			});
		});
	}

	private _getDb(): sqlite3.Database {
		if (!this._db || !this._isOpen) {
			throw new TemporalError('StoreNotOpen', 'Database is not open');
		}
		return this._db;
	}

	async runInTransaction<T>(operation: () => Promise<T>): Promise<T> {
		const db = this._getDb();

		await new Promise<void>((resolve, reject) => {
			db.run('BEGIN IMMEDIATE;', (err) => (err ? reject(err) : resolve()));
		});

		try {
			const result = await operation();
			await new Promise<void>((resolve, reject) => {
				db.run('COMMIT;', (err) => (err ? reject(err) : resolve()));
			});
			return result;
		} catch (error) {
			await new Promise<void>((resolve) => {
				db.run('ROLLBACK;', () => resolve());
			});
			throw error;
		}
	}

	async setRepositoryIdentity(identity: RepositoryIdentityRecord): Promise<void> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			const stmt = `
				INSERT OR REPLACE INTO repository_identity (
					repo_id, root_path, common_git_dir, object_format, created_at
				) VALUES (?, ?, ?, ?, ?);
			`;
			db.run(
				stmt,
				[
					identity.repoId,
					identity.rootPath,
					identity.commonGitDir ?? null,
					identity.objectFormat,
					identity.createdAt,
				],
				(err) => (err ? reject(err) : resolve())
			);
		});
	}

	async getRepositoryIdentity(): Promise<RepositoryIdentityRecord | undefined> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.get('SELECT * FROM repository_identity LIMIT 1;', (err, row: any) => {
				if (err) return reject(err);
				if (!row) return resolve(undefined);
				resolve({
					repoId: row.repo_id,
					rootPath: row.root_path,
					commonGitDir: row.common_git_dir || undefined,
					objectFormat: row.object_format,
					createdAt: row.created_at,
				});
			});
		});
	}

	async saveCommitIngestion(
		commit: TemporalCommitRecord,
		snapshot: TemporalGraphSnapshot,
		delta?: TemporalStructuralDelta,
		lineageEvents: readonly TemporalEntityLineageEvent[] = []
	): Promise<void> {
		validateVersion(commit.schemaVersion, 'schemaVersion');
		validateVersion(commit.analyzerVersion, 'analyzerVersion');
		validateVersion(commit.profileVersion, 'profileVersion');
		if (commit.isCheckpoint) {
			if (delta || commit.baseCommitSha || (commit.deltaDepth ?? 0) !== 0) {
				throw new TemporalError('DatabaseCorrupted', `Checkpoint '${commit.commitSha}' has an invalid reconstruction base or delta`);
			}
		} else {
			const baseCommitSha = commit.baseCommitSha;
			if (!delta || !baseCommitSha || delta.commitSha !== commit.commitSha || delta.baseCommitSha !== baseCommitSha || delta.parentCommitSha !== baseCommitSha) {
				throw new TemporalError('DatabaseCorrupted', `Delta metadata for '${commit.commitSha}' is inconsistent with its commit record`);
			}
			const baseCommit = await this.getCommit(baseCommitSha);
			if (!baseCommit || commit.deltaDepth !== (baseCommit.deltaDepth ?? 0) + 1) {
				throw new TemporalError('DatabaseCorrupted', `Delta depth for '${commit.commitSha}' is inconsistent with base '${baseCommitSha}'`);
			}
		}

		const db = this._getDb();

		return this.runInTransaction(async () => {
			// 1. Insert Commit
			const canonicalDigest = commit.canonicalDigest || snapshot.digest || snapshot.canonicalSnapshot?.digest || '';
			const canonicalStateId = computeCanonicalStateId(snapshot, canonicalDigest);
			const baseCommitSha = commit.baseCommitSha || delta?.baseCommitSha || delta?.parentCommitSha || '';
			const deltaDepth = commit.deltaDepth ?? (commit.isCheckpoint ? 0 : 1);

			await new Promise<void>((resolve, reject) => {
				const stmt = `
					INSERT OR REPLACE INTO commits (
						commit_sha, canonical_digest, canonical_state_id, parent_shas, tree_sha, author_name, author_email,
						author_timestamp, committer_timestamp, message, ingested_at,
						is_checkpoint, checkpoint_interval, delta_depth, base_commit_sha,
						schema_version, analyzer_version, profile_version
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
				`;
				db.run(
					stmt,
					[
						commit.commitSha,
						canonicalDigest,
						canonicalStateId,
						JSON.stringify(commit.parentShas),
						commit.treeSha,
						commit.authorName,
						commit.authorEmail,
						commit.authorTimestamp,
						commit.committerTimestamp,
						commit.message,
						commit.ingestedAt,
						commit.isCheckpoint ? 1 : 0,
						commit.checkpointInterval,
						deltaDepth,
						baseCommitSha,
						commit.schemaVersion,
						commit.analyzerVersion,
						commit.profileVersion,
					],
					(err) => (err ? reject(err) : resolve())
				);
			});

			// 2. Insert Relational Commit Parents
			if (commit.parentShas && commit.parentShas.length > 0) {
				for (let idx = 0; idx < commit.parentShas.length; idx++) {
					const parentSha = commit.parentShas[idx];
					await new Promise<void>((resolve, reject) => {
						const stmt = `
							INSERT OR REPLACE INTO commit_parents (commit_sha, parent_index, parent_sha)
							VALUES (?, ?, ?);
						`;
						db.run(stmt, [commit.commitSha, idx, parentSha], (err) => (err ? reject(err) : resolve()));
					});
				}
			}

			// 3. Insert or update immutable Graph State (Deduplication via canonical digest)
			const serializedCheckpoint = JSON.stringify({
				schemaVersion: snapshot.schemaVersion,
				analyzerVersion: snapshot.analyzerVersion,
				profileVersion: snapshot.profileVersion,
				commitSha: snapshot.commitSha,
				timestamp: snapshot.timestamp,
				isCheckpoint: snapshot.isCheckpoint,
				digest: canonicalDigest,
				canonicalSnapshot: snapshot.canonicalSnapshot,
				graphData: snapshot.graphData,
				entities: Array.from(snapshot.entityMap.values()),
				edges: Array.from(snapshot.edgeMap.values()),
			});
			const serializedCanonicalState = JSON.stringify({
				canonicalStateId,
				digest: canonicalDigest,
				nodes: snapshot.canonicalSnapshot?.nodes ?? snapshot.graphData.nodes,
				edges: snapshot.canonicalSnapshot?.edges ?? snapshot.graphData.edges,
				entryNodeId: snapshot.canonicalSnapshot?.entryNodeId ?? null,
				versions: snapshot.canonicalSnapshot?.versions,
				coverage: snapshot.canonicalSnapshot?.coverage,
				completeness: snapshot.canonicalSnapshot?.completeness,
			});

			if (canonicalDigest) {
				await new Promise<void>((resolve, reject) => {
					const stmt = `
						INSERT OR IGNORE INTO graph_states (
							state_id, canonical_digest, snapshot_json, created_at,
							schema_version, analyzer_version, profile_version
						) VALUES (?, ?, ?, ?, ?, ?, ?);
					`;
					db.run(
						stmt,
						[
							canonicalStateId,
							canonicalDigest,
							serializedCanonicalState,
							Date.now(),
							snapshot.schemaVersion,
							snapshot.analyzerVersion,
							snapshot.profileVersion,
						],
						(err) => (err ? reject(err) : resolve())
					);
				});
			}

			// 4. Insert Checkpoint if applicable
			if (commit.isCheckpoint) {
				await new Promise<void>((resolve, reject) => {
					const stmt = `
						INSERT OR REPLACE INTO checkpoints (
							commit_sha, canonical_digest, snapshot_json, created_at, schema_version, analyzer_version, profile_version
						) VALUES (?, ?, ?, ?, ?, ?, ?);
					`;
					db.run(
						stmt,
						[
							commit.commitSha,
							canonicalDigest,
							serializedCheckpoint,
							Date.now(),
							snapshot.schemaVersion,
							snapshot.analyzerVersion,
							snapshot.profileVersion,
						],
						(err) => (err ? reject(err) : resolve())
					);
				});
			}

			// 5. Insert Delta if provided
			if (delta) {
				await new Promise<void>((resolve, reject) => {
					const stmt = `
						INSERT OR REPLACE INTO deltas (
							commit_sha, base_commit_sha, target_canonical_digest, delta_json, delta_version, created_at
						) VALUES (?, ?, ?, ?, ?, ?);
					`;
					db.run(
						stmt,
						[
							delta.commitSha,
							delta.baseCommitSha || delta.parentCommitSha,
							delta.targetCanonicalDigest || canonicalDigest,
							JSON.stringify(delta),
							delta.deltaVersion,
							Date.now(),
						],
						(err) => (err ? reject(err) : resolve())
					);
				});
			}

			// 6. Save entities and snapshots
			for (const [entityId, entitySnap] of snapshot.entityMap) {
				// Upsert Entity
				await new Promise<void>((resolve, reject) => {
					const stmt = `
						INSERT INTO entities (entity_id, canonical_path, kind, first_seen_commit, last_seen_commit, is_active, metadata_json)
						VALUES (?, ?, 'file', ?, ?, 1, NULL)
						ON CONFLICT(entity_id) DO UPDATE SET
							canonical_path = excluded.canonical_path,
							last_seen_commit = excluded.last_seen_commit,
							is_active = 1;
					`;
					db.run(
						stmt,
						[entityId, entitySnap.path, commit.commitSha, commit.commitSha],
						(err) => (err ? reject(err) : resolve())
					);
				});

				// Insert Entity Snapshot
				await new Promise<void>((resolve, reject) => {
					const stmt = `
						INSERT OR REPLACE INTO entity_snapshots (
							entity_id, commit_sha, path, blob_oid, content_hash, node_data_json
						) VALUES (?, ?, ?, ?, ?, ?);
					`;
					db.run(
						stmt,
						[
							entityId,
							commit.commitSha,
							entitySnap.path,
							entitySnap.blobOid ?? null,
							entitySnap.contentHash ?? null,
							JSON.stringify(entitySnap.nodeData),
						],
						(err) => (err ? reject(err) : resolve())
					);
				});
			}

			// Mark deleted entities in this delta as inactive in entities table
			if (delta && delta.entitiesDeleted && delta.entitiesDeleted.length > 0) {
				for (const deletedId of delta.entitiesDeleted) {
					const deletedPath = await new Promise<string | undefined>((resolve, reject) => {
						db.get('SELECT canonical_path FROM entities WHERE entity_id = ?;', [deletedId], (error, row: { canonical_path?: string } | undefined) => {
							if (error) {
								reject(error);
								return;
							}
							resolve(row?.canonical_path);
						});
					});
					if (deletedPath) {
						await new Promise<void>((resolve, reject) => {
							db.run(
								'INSERT OR REPLACE INTO entity_deletions (entity_id, commit_sha, canonical_path) VALUES (?, ?, ?);',
								[deletedId, commit.commitSha, deletedPath],
								error => error ? reject(error) : resolve(),
							);
						});
					}
					await new Promise<void>((resolve, reject) => {
						db.run(
							'UPDATE entities SET is_active = 0, last_seen_commit = ? WHERE entity_id = ?;',
							[commit.commitSha, deletedId],
							(err) => (err ? reject(err) : resolve())
						);
					});
				}
			}

			// 7. Save lineage events
			for (const event of lineageEvents) {
				await new Promise<void>((resolve, reject) => {
					const stmt = `
						INSERT INTO lineage_events (
							entity_id, commit_sha, parent_commit_sha, lineage_case, evidence_json, created_at
						) VALUES (?, ?, ?, ?, ?, ?);
					`;
					db.run(
						stmt,
						[
							event.entityId,
							event.commitSha,
							event.parentCommitSha,
							event.lineageCase,
							JSON.stringify(event.evidence),
							Date.now(),
						],
						(err) => (err ? reject(err) : resolve())
					);
				});
			}

			// 8. Save edges and snapshots
			for (const [edgeId, edgeSnap] of snapshot.edgeMap) {
				// Upsert Edge
				await new Promise<void>((resolve, reject) => {
					const stmt = `
						INSERT INTO edges (edge_id, source_entity_id, target_entity_id, kind, first_seen_commit, last_seen_commit, is_active)
						VALUES (?, ?, ?, ?, ?, ?, 1)
						ON CONFLICT(edge_id) DO UPDATE SET
							last_seen_commit = excluded.last_seen_commit,
							is_active = 1;
					`;
					db.run(
						stmt,
						[
							edgeId,
							edgeSnap.sourceEntityId,
							edgeSnap.targetEntityId,
							edgeSnap.kind,
							commit.commitSha,
							commit.commitSha,
						],
						(err) => (err ? reject(err) : resolve())
					);
				});

				// Insert Edge Snapshot
				await new Promise<void>((resolve, reject) => {
					const stmt = `
						INSERT OR REPLACE INTO edge_snapshots (
							edge_id, commit_sha, source_entity_id, target_entity_id, kind, edge_data_json
						) VALUES (?, ?, ?, ?, ?, ?);
					`;
					db.run(
						stmt,
						[
							edgeId,
							commit.commitSha,
							edgeSnap.sourceEntityId,
							edgeSnap.targetEntityId,
							edgeSnap.kind,
							JSON.stringify(edgeSnap.edgeData),
						],
						(err) => (err ? reject(err) : resolve())
					);
				});
				await new Promise<void>((resolve, reject) => {
					db.run(
						'INSERT OR IGNORE INTO edge_events (edge_id, commit_sha, event_kind) VALUES (?, ?, ?);',
						[edgeId, commit.commitSha, 'present'],
						error => error ? reject(error) : resolve(),
					);
				});
			}
			for (const deletedEdgeId of delta?.edgesDeleted ?? []) {
				await new Promise<void>((resolve, reject) => {
					db.run(
						'INSERT OR IGNORE INTO edge_events (edge_id, commit_sha, event_kind) VALUES (?, ?, ?);',
						[deletedEdgeId, commit.commitSha, 'removed'],
						error => error ? reject(error) : resolve(),
					);
				});
			}
		});
	}

	async getCommit(commitSha: string): Promise<TemporalCommitRecord | undefined> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.get('SELECT * FROM commits WHERE commit_sha = ?;', [commitSha], (err, row: any) => {
				if (err) return reject(err);
				if (!row) return resolve(undefined);
				resolve(this._mapCommitRecord(row));
			});
		});
	}

	async getAllCommits(): Promise<TemporalCommitRecord[]> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all('SELECT * FROM commits ORDER BY ingested_at ASC;', (err, rows: any[]) => {
				if (err) return reject(err);
				resolve((rows || []).map(r => this._mapCommitRecord(r)));
			});
		});
	}

	async getLatestCommit(): Promise<TemporalCommitRecord | undefined> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.get('SELECT * FROM commits ORDER BY ingested_at DESC LIMIT 1;', (err, row: any) => {
				if (err) return reject(err);
				if (!row) return resolve(undefined);
				resolve(this._mapCommitRecord(row));
			});
		});
	}

	async getCommitCoverage(commitSha: string): Promise<CanonicalCoverage | undefined> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.get(
				`SELECT graph_states.snapshot_json
				 FROM commits
				 INNER JOIN graph_states ON graph_states.state_id = commits.canonical_state_id
				 WHERE commits.commit_sha = ?;`,
				[commitSha],
				(error, row: { snapshot_json?: string } | undefined) => {
					if (error) {
						reject(error);
						return;
					}
					if (!row?.snapshot_json) {
						resolve(undefined);
						return;
					}
					try {
						const parsed = JSON.parse(row.snapshot_json) as { coverage?: CanonicalCoverage; completeness?: CanonicalCoverage };
						const coverage = parsed.coverage ?? parsed.completeness;
						if (!coverage || typeof coverage.completeWithinProfile !== 'boolean') {
							throw new TemporalError('DatabaseCorrupted', `Canonical state coverage is missing for ${commitSha}`);
						}
						resolve(coverage);
					} catch (parseError) {
						reject(parseError instanceof TemporalError
							? parseError
							: new TemporalError('DatabaseCorrupted', `Failed to parse canonical state coverage for ${commitSha}`, parseError));
					}
				}
			);
		});
	}

	async getCommitParents(commitSha: string): Promise<string[]> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all(
				'SELECT parent_sha FROM commit_parents WHERE commit_sha = ? ORDER BY parent_index ASC;',
				[commitSha],
				(err, rows: any[]) => {
					if (err) return reject(err);
					if (rows && rows.length > 0) {
						return resolve(rows.map(r => r.parent_sha));
					}
					// Fallback to commits.parent_shas JSON if commit_parents is empty
					db.get('SELECT parent_shas FROM commits WHERE commit_sha = ?;', [commitSha], (cErr, cRow: any) => {
						if (cErr) return reject(cErr);
						if (!cRow) return resolve([]);
						try {
							const parents = JSON.parse(cRow.parent_shas);
							if (!Array.isArray(parents) || parents.some(parent => typeof parent !== 'string' || parent.length === 0)) {
								throw new Error('parent_shas must be an array of non-empty commit identifiers');
							}
							resolve(parents);
						} catch (parseError) {
							reject(new TemporalError('DatabaseCorrupted', `Failed to parse commit parent topology for ${commitSha}`, parseError));
						}
					});
				}
			);
		});
	}

	async getCommitChildren(commitSha: string): Promise<string[]> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all(
				'SELECT commit_sha FROM commit_parents WHERE parent_sha = ?;',
				[commitSha],
				(err, rows: any[]) => {
					if (err) return reject(err);
					resolve((rows || []).map(r => r.commit_sha));
				}
			);
		});
	}

	async getCheckpointSnapshot(commitSha: string): Promise<TemporalGraphSnapshot | undefined> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.get('SELECT snapshot_json, canonical_digest FROM checkpoints WHERE commit_sha = ?;', [commitSha], (err, row: any) => {
				if (err) return reject(err);
				if (!row || !row.snapshot_json) return resolve(undefined);

				try {
					const parsed = JSON.parse(row.snapshot_json);
					const canonicalNodes = parsed.canonicalSnapshot?.nodes ?? parsed.graphData?.nodes;
					const canonicalEdges = parsed.canonicalSnapshot?.edges ?? parsed.graphData?.edges;
					const serializedDigest = parsed.digest ?? parsed.canonicalSnapshot?.digest;
					const expectedDigest = row.canonical_digest ?? serializedDigest;
					if (!Array.isArray(canonicalNodes) || !Array.isArray(canonicalEdges)) {
						throw new TemporalError('DatabaseCorrupted', `Checkpoint '${commitSha}' has no canonical graph payload`);
					}
					const recomputedDigest = computeCanonicalGraphDigest({
						nodes: canonicalNodes,
						edges: canonicalEdges,
						entryNodeId: parsed.canonicalSnapshot?.entryNodeId ?? null,
					});
					if ((serializedDigest && serializedDigest !== expectedDigest) || (expectedDigest && recomputedDigest !== expectedDigest)) {
						throw new TemporalError('DatabaseCorrupted', `Checkpoint canonical digest mismatch for ${commitSha}`);
					}
					const entityMap = new Map<string, TemporalEntitySnapshot>();
					const pathToEntityId = new Map<string, string>();
					if (Array.isArray(parsed.entities)) {
						for (const e of parsed.entities) {
							entityMap.set(e.entityId, e);
							pathToEntityId.set(e.path, e.entityId);
						}
					}

					const edgeMap = new Map<string, TemporalEdgeSnapshot>();
					if (Array.isArray(parsed.edges)) {
						for (const ed of parsed.edges) {
							edgeMap.set(ed.edgeId, ed);
						}
					}

					const snapshot: TemporalGraphSnapshot = {
						schemaVersion: parsed.schemaVersion,
						analyzerVersion: parsed.analyzerVersion,
						profileVersion: parsed.profileVersion,
						commitSha: parsed.commitSha,
						timestamp: parsed.timestamp,
						isCheckpoint: true,
						canonicalSnapshot: parsed.canonicalSnapshot,
						graphData: parsed.graphData,
						entityMap,
						edgeMap,
						pathToEntityId,
						digest: parsed.digest,
					};
					resolve(snapshot);
				} catch (parseErr) {
					if (parseErr instanceof TemporalError) {
						reject(parseErr);
						return;
					}
					reject(new TemporalError('DatabaseCorrupted', `Failed to parse checkpoint JSON for ${commitSha}`, parseErr));
				}
			});
		});
	}

	async getStructuralDelta(commitSha: string): Promise<TemporalStructuralDelta | undefined> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.get('SELECT delta_json FROM deltas WHERE commit_sha = ?;', [commitSha], (err, row: any) => {
				if (err) return reject(err);
				if (!row || !row.delta_json) return resolve(undefined);

				try {
					const delta = JSON.parse(row.delta_json);
					resolve(delta);
				} catch (parseErr) {
					reject(new TemporalError('DatabaseCorrupted', `Failed to parse delta JSON for ${commitSha}`, parseErr));
				}
			});
		});
	}

	async getGraphStateByDigest(digest: string): Promise<{ stateId: string; canonicalDigest: string; snapshotJson: string } | undefined> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.get('SELECT * FROM graph_states WHERE canonical_digest = ? ORDER BY created_at DESC LIMIT 1;', [digest], (err, row: any) => {
				if (err) return reject(err);
				if (!row) return resolve(undefined);
				resolve({
					stateId: row.state_id,
					canonicalDigest: row.canonical_digest,
					snapshotJson: row.snapshot_json,
				});
			});
		});
	}

	async getEntity(entityId: string): Promise<TemporalEntity | undefined> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.get('SELECT * FROM entities WHERE entity_id = ?;', [entityId], (err, row: any) => {
				if (err) return reject(err);
				if (!row) return resolve(undefined);
				resolve({
					entityId: row.entity_id,
					canonicalPath: row.canonical_path,
					kind: row.kind,
					firstSeenCommit: row.first_seen_commit,
					lastSeenCommit: row.last_seen_commit,
					isActive: Boolean(row.is_active),
					metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
				});
			});
		});
	}

	async getEntityHistory(entityId: string): Promise<TemporalEntitySnapshot[]> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all(
				'SELECT es.* FROM entity_snapshots es LEFT JOIN commits c ON es.commit_sha = c.commit_sha WHERE es.entity_id = ? ORDER BY c.ingested_at ASC, c.author_timestamp ASC;',
				[entityId],
				(err, rows: any[]) => {
					if (err) return reject(err);
					const snapshots: TemporalEntitySnapshot[] = (rows || []).map(r => ({
						entityId: r.entity_id,
						commitSha: r.commit_sha,
						path: r.path,
						blobOid: r.blob_oid || undefined,
						contentHash: r.content_hash || undefined,
						nodeData: JSON.parse(r.node_data_json),
					}));
					resolve(snapshots);
				}
			);
		});
	}

	async getEntityHistoryReachableFrom(entityId: string, targetCommitSha: string): Promise<TemporalEntitySnapshot[]> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all(
				`WITH RECURSIVE ancestry(commit_sha) AS (
					SELECT ?
					UNION
					SELECT parent_sha FROM commit_parents JOIN ancestry ON commit_parents.commit_sha = ancestry.commit_sha
				)
				SELECT snapshots.* FROM entity_snapshots snapshots
				JOIN ancestry ON ancestry.commit_sha = snapshots.commit_sha
				JOIN commits ON commits.commit_sha = snapshots.commit_sha
				WHERE snapshots.entity_id = ?
				ORDER BY commits.committer_timestamp ASC, commits.ingested_at ASC;`,
				[targetCommitSha, entityId],
				(err, rows: any[]) => {
					if (err) return reject(err);
					try {
						resolve((rows || []).map(row => ({
							entityId: row.entity_id,
							commitSha: row.commit_sha,
							path: row.path,
							blobOid: row.blob_oid || undefined,
							contentHash: row.content_hash || undefined,
							nodeData: JSON.parse(row.node_data_json),
						})));
					} catch (parseError) {
						reject(new TemporalError('DatabaseCorrupted', `Failed to parse entity history for ${entityId}`, parseError));
					}
				}
			);
		});
	}

	async getEntityLineageEvents(entityId: string): Promise<TemporalEntityLineageEvent[]> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all(
				'SELECT * FROM lineage_events WHERE entity_id = ? ORDER BY created_at ASC;',
				[entityId],
				(err, rows: any[]) => {
					if (err) return reject(err);
					const events: TemporalEntityLineageEvent[] = (rows || []).map(r => ({
						entityId: r.entity_id,
						commitSha: r.commit_sha,
						parentCommitSha: r.parent_commit_sha,
						lineageCase: r.lineage_case,
						evidence: JSON.parse(r.evidence_json),
					}));
					resolve(events);
				}
			);
		});
	}

	async getEntityLineageEventsReachableFrom(entityId: string, targetCommitSha: string): Promise<TemporalEntityLineageEvent[]> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all(
				`WITH RECURSIVE ancestry(commit_sha) AS (
					SELECT ?
					UNION
					SELECT parent_sha FROM commit_parents JOIN ancestry ON commit_parents.commit_sha = ancestry.commit_sha
				)
				SELECT events.* FROM lineage_events events
				JOIN ancestry ON ancestry.commit_sha = events.commit_sha
				JOIN commits ON commits.commit_sha = events.commit_sha
				WHERE events.entity_id = ?
				ORDER BY commits.committer_timestamp ASC, commits.ingested_at ASC;`,
				[targetCommitSha, entityId],
				(err, rows: any[]) => {
					if (err) return reject(err);
					try {
						resolve((rows || []).map(row => ({
							entityId: row.entity_id,
							commitSha: row.commit_sha,
							parentCommitSha: row.parent_commit_sha,
							lineageCase: row.lineage_case,
							evidence: JSON.parse(row.evidence_json),
						})));
					} catch (parseError) {
						reject(new TemporalError('DatabaseCorrupted', `Failed to parse entity lineage history for ${entityId}`, parseError));
					}
				}
			);
		});
	}

	async getActiveEntitiesAtCommit(commitSha: string): Promise<TemporalEntitySnapshot[]> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all(
				'SELECT * FROM entity_snapshots WHERE commit_sha = ?;',
				[commitSha],
				(err, rows: any[]) => {
					if (err) return reject(err);
					const list: TemporalEntitySnapshot[] = (rows || []).map(r => ({
						entityId: r.entity_id,
						commitSha: r.commit_sha,
						path: r.path,
						blobOid: r.blob_oid || undefined,
						contentHash: r.content_hash || undefined,
						nodeData: JSON.parse(r.node_data_json),
					}));
					resolve(list);
				}
			);
		});
	}

	async getDeletedPathsInHistory(baseCommitSha: string): Promise<Map<string, string>> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all(
				`WITH RECURSIVE ancestry(commit_sha) AS (
					SELECT ?
					UNION
					SELECT commits.base_commit_sha
					FROM commits JOIN ancestry ON commits.commit_sha = ancestry.commit_sha
					WHERE commits.base_commit_sha IS NOT NULL AND commits.base_commit_sha <> ''
				)
				SELECT deletions.entity_id, deletions.canonical_path
				FROM entity_deletions deletions
				JOIN ancestry ON ancestry.commit_sha = deletions.commit_sha;`,
				[baseCommitSha],
				(err, rows: any[]) => {
					if (err) return reject(err);
					const map = new Map<string, string>();
					for (const r of rows || []) {
						if (r.canonical_path && r.entity_id) {
							map.set(r.canonical_path, r.entity_id);
						}
					}
					resolve(map);
				}
			);
		});
	}

	async getEdge(edgeId: string): Promise<TemporalEdgeRecord | undefined> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.get('SELECT * FROM edges WHERE edge_id = ?;', [edgeId], (err, row: any) => {
				if (err) return reject(err);
				if (!row) return resolve(undefined);
				resolve({
					edgeId: row.edge_id,
					sourceEntityId: row.source_entity_id,
					targetEntityId: row.target_entity_id,
					kind: row.kind,
					firstSeenCommit: row.first_seen_commit,
					lastSeenCommit: row.last_seen_commit,
					isActive: Boolean(row.is_active),
				});
			});
		});
	}

	async getEdgeHistory(edgeId: string): Promise<TemporalEdgeSnapshot[]> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all(
				'SELECT es.* FROM edge_snapshots es LEFT JOIN commits c ON es.commit_sha = c.commit_sha WHERE es.edge_id = ? ORDER BY c.ingested_at ASC;',
				[edgeId],
				(err, rows: any[]) => {
					if (err) return reject(err);
					const snapshots: TemporalEdgeSnapshot[] = (rows || []).map(r => ({
						edgeId: r.edge_id,
						commitSha: r.commit_sha,
						sourceEntityId: r.source_entity_id,
						targetEntityId: r.target_entity_id,
						kind: r.kind,
						edgeData: JSON.parse(r.edge_data_json),
					}));
					resolve(snapshots);
				}
			);
		});
	}

	async getEdgeHistoryReachableFrom(edgeId: string, targetCommitSha: string): Promise<TemporalEdgeSnapshot[]> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all(
				`WITH RECURSIVE ancestry(commit_sha) AS (
					SELECT ?
					UNION
					SELECT parent_sha FROM commit_parents JOIN ancestry ON commit_parents.commit_sha = ancestry.commit_sha
				)
				SELECT snapshots.* FROM edge_snapshots snapshots
				JOIN ancestry ON ancestry.commit_sha = snapshots.commit_sha
				JOIN commits ON commits.commit_sha = snapshots.commit_sha
				WHERE snapshots.edge_id = ?
				ORDER BY commits.committer_timestamp ASC, commits.ingested_at ASC;`,
				[targetCommitSha, edgeId],
				(err, rows: any[]) => {
					if (err) return reject(err);
					try {
						resolve((rows || []).map(row => ({
							edgeId: row.edge_id,
							commitSha: row.commit_sha,
							sourceEntityId: row.source_entity_id,
							targetEntityId: row.target_entity_id,
							kind: row.kind,
							edgeData: JSON.parse(row.edge_data_json),
						})));
					} catch (parseError) {
						reject(new TemporalError('DatabaseCorrupted', `Failed to parse edge history for ${edgeId}`, parseError));
					}
				}
			);
		});
	}

	async getEdgeLifecycleEventsReachableFrom(edgeId: string, targetCommitSha: string): Promise<import('../../common/temporalTypes.js').TemporalEdgeLifecycleEvent[]> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all(
				`WITH RECURSIVE ancestry(commit_sha) AS (
					SELECT ?
					UNION
					SELECT parent_sha FROM commit_parents JOIN ancestry ON commit_parents.commit_sha = ancestry.commit_sha
				)
				SELECT events.edge_id, events.commit_sha, events.event_kind, edges.source_entity_id, edges.target_entity_id, edges.kind
				FROM edge_events events
				JOIN ancestry ON ancestry.commit_sha = events.commit_sha
				LEFT JOIN edges ON edges.edge_id = events.edge_id
				JOIN commits ON commits.commit_sha = events.commit_sha
				WHERE events.edge_id = ?
				ORDER BY commits.committer_timestamp ASC, commits.ingested_at ASC;`,
				[targetCommitSha, edgeId],
				(err, rows: any[]) => {
					if (err) return reject(err);
					resolve((rows || []).map(row => ({
						edgeId: row.edge_id,
						commitSha: row.commit_sha,
						eventKind: row.event_kind,
						sourceEntityId: row.source_entity_id || undefined,
						targetEntityId: row.target_entity_id || undefined,
						kind: row.kind || undefined,
					})));
				}
			);
		});
	}

	async saveRef(ref: RefRecord): Promise<void> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			const stmt = `
				INSERT OR REPLACE INTO refs (ref_name, target_sha, ref_type, last_observed)
				VALUES (?, ?, ?, ?);
			`;
			db.run(stmt, [ref.refName, ref.targetSha, ref.refType ?? null, ref.lastObserved], (err) => (err ? reject(err) : resolve()));
		});
	}

	async replaceRefs(refs: readonly RefRecord[]): Promise<void> {
		const db = this._getDb();
		await this.runInTransaction(async () => {
			await new Promise<void>((resolve, reject) => {
				db.run('DELETE FROM refs;', error => error ? reject(error) : resolve());
			});
			for (const ref of refs) {
				await new Promise<void>((resolve, reject) => {
					db.run(
						'INSERT INTO refs (ref_name, target_sha, ref_type, last_observed) VALUES (?, ?, ?, ?);',
						[ref.refName, ref.targetSha, ref.refType ?? null, ref.lastObserved],
						error => error ? reject(error) : resolve(),
					);
				});
			}
		});
	}

	async getRef(refName: string): Promise<RefRecord | undefined> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.get('SELECT * FROM refs WHERE ref_name = ?;', [refName], (err, row: any) => {
				if (err) return reject(err);
				if (!row) return resolve(undefined);
				resolve({
					refName: row.ref_name,
					targetSha: row.target_sha,
					refType: row.ref_type || undefined,
					lastObserved: row.last_observed,
				});
			});
		});
	}

	async getAllRefs(): Promise<RefRecord[]> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.all('SELECT * FROM refs ORDER BY last_observed DESC;', (err, rows: any[]) => {
				if (err) return reject(err);
				resolve((rows || []).map(r => ({
					refName: r.ref_name,
					targetSha: r.target_sha,
					refType: r.ref_type || undefined,
					lastObserved: r.last_observed,
				})));
			});
		});
	}

	async getBlobAnalysis(
		blobOid: string,
		analyzerVersion: number,
		profileVersion: number,
		language: string
	): Promise<BlobAnalysisRecord | undefined> {
		const key = computeAnalysisCacheKey(blobOid, analyzerVersion, profileVersion, language);
		const db = this._getDb();

		return new Promise((resolve, reject) => {
			db.get('SELECT * FROM blob_parse_artifacts WHERE cache_key = ?;', [key], (err, row: any) => {
				if (err) return reject(err);
				if (!row) return resolve(undefined);
				try {
					resolve({
						blobOid: row.blob_oid,
						analyzerVersion: row.analyzer_version,
						profileVersion: row.profile_version,
						language: row.language,
						artifact: JSON.parse(row.artifact_json),
						analyzedAt: row.analyzed_at,
					});
				} catch (parseErr) {
					reject(new TemporalError('DatabaseCorrupted', `Failed to parse blob parse artifact for ${key}`, parseErr));
				}
			});
		});
	}

	async saveBlobAnalysis(record: BlobAnalysisRecord): Promise<void> {
		const key = computeAnalysisCacheKey(
			record.blobOid,
			record.analyzerVersion,
			record.profileVersion,
			record.language
		);
		const db = this._getDb();

		return new Promise((resolve, reject) => {
			const stmt = `
				INSERT OR REPLACE INTO blob_parse_artifacts (
					cache_key, blob_oid, analyzer_version, profile_version, language,
					artifact_json, analyzed_at
				) VALUES (?, ?, ?, ?, ?, ?, ?);
			`;
			db.run(
				stmt,
				[
					key,
					record.blobOid,
					record.analyzerVersion,
					record.profileVersion,
					record.language,
					JSON.stringify(record.artifact),
					record.analyzedAt,
				],
				(err) => (err ? reject(err) : resolve())
			);
		});
	}

	async runMaintenance(maxDatabaseBytes: number): Promise<TemporalStoreMaintenanceResult> {
		if (!Number.isSafeInteger(maxDatabaseBytes) || maxDatabaseBytes <= 0) {
			throw new TemporalError('StorageLimitExceeded', 'Temporal maintenance requires a positive database budget');
		}
		const db = this._getDb();
		const databaseBytes = async (): Promise<number> => Number(await readPragma(db, 'page_count')) * Number(await readPragma(db, 'page_size'));
		let size = await databaseBytes();
		let evicted = 0;
		while (size > maxDatabaseBytes) {
			const removed = await new Promise<number>((resolve, reject) => {
				db.run('DELETE FROM blob_parse_artifacts WHERE cache_key IN (SELECT cache_key FROM blob_parse_artifacts ORDER BY analyzed_at ASC LIMIT 256);', function(error) {
					if (error) return reject(error);
					resolve(this.changes ?? 0);
				});
			});
			if (removed === 0) {
				break;
			}
			evicted += removed;
			await runStatement(db, 'PRAGMA incremental_vacuum;');
			size = await databaseBytes();
		}
		return { databaseBytes: size, parseArtifactsEvicted: evicted, withinBudget: size <= maxDatabaseBytes };
	}

	async vacuum(): Promise<void> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.run('VACUUM;', (err) => (err ? reject(err) : resolve()));
		});
	}

	async clear(): Promise<void> {
		const db = this._getDb();
		return this.runInTransaction(async () => {
			await new Promise<void>((resolve, reject) => {
				db.exec(`
					DELETE FROM blob_parse_artifacts;
					DELETE FROM blob_cache;
					DELETE FROM edge_snapshots;
					DELETE FROM edges;
					DELETE FROM lineage_events;
					DELETE FROM entity_snapshots;
					DELETE FROM entities;
					DELETE FROM deltas;
					DELETE FROM checkpoints;
					DELETE FROM graph_states;
					DELETE FROM refs;
					DELETE FROM commit_parents;
					DELETE FROM commits;
					DELETE FROM repository_identity;
					DELETE FROM meta;
				`, (err) => (err ? reject(err) : resolve()));
			});
		});
	}

	private _mapCommitRecord(row: any): TemporalCommitRecord {
		return {
			commitSha: row.commit_sha,
			canonicalDigest: row.canonical_digest || undefined,
			parentShas: JSON.parse(row.parent_shas || '[]'),
			treeSha: row.tree_sha,
			authorName: row.author_name,
			authorEmail: row.author_email,
			authorTimestamp: row.author_timestamp,
			committerTimestamp: row.committer_timestamp,
			message: row.message,
			ingestedAt: row.ingested_at,
			isCheckpoint: Boolean(row.is_checkpoint),
			checkpointInterval: row.checkpoint_interval,
			deltaDepth: typeof row.delta_depth === 'number' ? row.delta_depth : (row.is_checkpoint ? 0 : 1),
			baseCommitSha: row.base_commit_sha || undefined,
			schemaVersion: row.schema_version,
			analyzerVersion: row.analyzer_version,
			profileVersion: row.profile_version,
		};
	}
}

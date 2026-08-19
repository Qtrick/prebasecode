/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as sqlite3 from '@vscode/sqlite3';
import { TemporalError } from '../../common/temporalErrors.js';
import { computeAnalysisCacheKey, validateVersion } from '../../common/temporalVersioning.js';
import { runMigrations } from './temporalMigrations.js';
import type { ITemporalStore } from '../common/temporalStore.js';
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

export class SqliteTemporalStore implements ITemporalStore {
	private readonly _dbPath: string;
	private readonly _busyTimeoutMs: number;
	private _db: sqlite3.Database | undefined;
	private _isOpen = false;

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

		await new Promise<void>((resolve, reject) => {
			const DatabaseCtor = getSqliteDatabaseConstructor();
			const db: sqlite3.Database = new DatabaseCtor(this._dbPath, (err: any) => {
				if (err) {
					return reject(new TemporalError('StoreNotOpen', `Failed to open SQLite database at ${this._dbPath}`, err));
				}

				this._db = db;

				// Configure PRAGMAs
				db.serialize(() => {
					db.run('PRAGMA journal_mode = WAL;');
					db.run(`PRAGMA busy_timeout = ${this._busyTimeoutMs};`);
					db.run('PRAGMA synchronous = NORMAL;');
					db.run('PRAGMA foreign_keys = ON;', async (fkErr) => {
						if (fkErr) {
							return reject(new TemporalError('StoreNotOpen', 'Failed to configure SQLite PRAGMAs', fkErr));
						}

						try {
							await runMigrations(db);
							this._isOpen = true;
							resolve();
						} catch (migErr) {
							reject(migErr);
						}
					});
				});
			});
		});
	}

	async close(): Promise<void> {
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

	async saveCommitIngestion(
		commit: TemporalCommitRecord,
		snapshot: TemporalGraphSnapshot,
		delta?: TemporalStructuralDelta,
		lineageEvents: readonly TemporalEntityLineageEvent[] = []
	): Promise<void> {
		validateVersion(commit.schemaVersion, 'schemaVersion');
		validateVersion(commit.analyzerVersion, 'analyzerVersion');
		validateVersion(commit.profileVersion, 'profileVersion');

		const db = this._getDb();

		return this.runInTransaction(async () => {
			// 1. Insert Commit
			await new Promise<void>((resolve, reject) => {
				const stmt = `
					INSERT OR REPLACE INTO commits (
						commit_sha, parent_shas, tree_sha, author_name, author_email,
						author_timestamp, committer_timestamp, message, ingested_at,
						is_checkpoint, checkpoint_interval, schema_version, analyzer_version, profile_version
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
				`;
				db.run(
					stmt,
					[
						commit.commitSha,
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
						commit.schemaVersion,
						commit.analyzerVersion,
						commit.profileVersion,
					],
					(err) => (err ? reject(err) : resolve())
				);
			});

			// 2. Insert Checkpoint if applicable
			if (commit.isCheckpoint) {
				const serializedSnapshot = JSON.stringify({
					schemaVersion: snapshot.schemaVersion,
					analyzerVersion: snapshot.analyzerVersion,
					profileVersion: snapshot.profileVersion,
					commitSha: snapshot.commitSha,
					timestamp: snapshot.timestamp,
					isCheckpoint: snapshot.isCheckpoint,
					graphData: snapshot.graphData,
					entities: Array.from(snapshot.entityMap.values()),
					edges: Array.from(snapshot.edgeMap.values()),
				});

				await new Promise<void>((resolve, reject) => {
					const stmt = `
						INSERT OR REPLACE INTO checkpoints (
							commit_sha, snapshot_json, created_at, schema_version, analyzer_version, profile_version
						) VALUES (?, ?, ?, ?, ?, ?);
					`;
					db.run(
						stmt,
						[
							commit.commitSha,
							serializedSnapshot,
							Date.now(),
							snapshot.schemaVersion,
							snapshot.analyzerVersion,
							snapshot.profileVersion,
						],
						(err) => (err ? reject(err) : resolve())
					);
				});
			}

			// 3. Insert Delta if provided
			if (delta) {
				await new Promise<void>((resolve, reject) => {
					const stmt = `
						INSERT OR REPLACE INTO deltas (
							commit_sha, parent_commit_sha, delta_json, delta_version, created_at
						) VALUES (?, ?, ?, ?, ?);
					`;
					db.run(
						stmt,
						[
							delta.commitSha,
							delta.parentCommitSha,
							JSON.stringify(delta),
							delta.deltaVersion,
							Date.now(),
						],
						(err) => (err ? reject(err) : resolve())
					);
				});
			}

			// 4. Save entities and snapshots
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

			// 5. Save lineage events
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

			// 6. Save edges and snapshots
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

	async getCheckpointSnapshot(commitSha: string): Promise<TemporalGraphSnapshot | undefined> {
		const db = this._getDb();
		return new Promise((resolve, reject) => {
			db.get('SELECT snapshot_json FROM checkpoints WHERE commit_sha = ?;', [commitSha], (err, row: any) => {
				if (err) return reject(err);
				if (!row || !row.snapshot_json) return resolve(undefined);

				try {
					const parsed = JSON.parse(row.snapshot_json);
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
						graphData: parsed.graphData,
						entityMap,
						edgeMap,
						pathToEntityId,
					};
					resolve(snapshot);
				} catch (parseErr) {
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

	async getBlobAnalysis(
		blobOid: string,
		analyzerVersion: number,
		profileVersion: number,
		language: string
	): Promise<BlobAnalysisRecord | undefined> {
		const key = computeAnalysisCacheKey(blobOid, analyzerVersion, profileVersion, language);
		const db = this._getDb();

		return new Promise((resolve, reject) => {
			db.get('SELECT * FROM blob_cache WHERE cache_key = ?;', [key], (err, row: any) => {
				if (err) return reject(err);
				if (!row) return resolve(undefined);
				try {
					resolve({
						blobOid: row.blob_oid,
						analyzerVersion: row.analyzer_version,
						profileVersion: row.profile_version,
						language: row.language,
						nodeData: JSON.parse(row.node_data_json),
						outgoingEdges: JSON.parse(row.outgoing_edges_json),
						analyzedAt: row.analyzed_at,
					});
				} catch (parseErr) {
					reject(new TemporalError('DatabaseCorrupted', `Failed to parse blob cache record for ${key}`, parseErr));
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
				INSERT OR REPLACE INTO blob_cache (
					cache_key, blob_oid, analyzer_version, profile_version, language,
					node_data_json, outgoing_edges_json, analyzed_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
			`;
			db.run(
				stmt,
				[
					key,
					record.blobOid,
					record.analyzerVersion,
					record.profileVersion,
					record.language,
					JSON.stringify(record.nodeData),
					JSON.stringify(record.outgoingEdges),
					record.analyzedAt,
				],
				(err) => (err ? reject(err) : resolve())
			);
		});
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
					DELETE FROM blob_cache;
					DELETE FROM edge_snapshots;
					DELETE FROM edges;
					DELETE FROM lineage_events;
					DELETE FROM entity_snapshots;
					DELETE FROM entities;
					DELETE FROM deltas;
					DELETE FROM checkpoints;
					DELETE FROM commits;
					DELETE FROM meta;
				`, (err) => (err ? reject(err) : resolve()));
			});
		});
	}

	private _mapCommitRecord(row: any): TemporalCommitRecord {
		return {
			commitSha: row.commit_sha,
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
			schemaVersion: row.schema_version,
			analyzerVersion: row.analyzer_version,
			profileVersion: row.profile_version,
		};
	}
}

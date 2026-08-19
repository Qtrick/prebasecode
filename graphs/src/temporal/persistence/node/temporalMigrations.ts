/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type * as sqlite3 from '@vscode/sqlite3';
import { TemporalError } from '../../common/temporalErrors.js';
import { CURRENT_SCHEMA_VERSION } from '../../common/temporalVersioning.js';

export const SCHEMA_V1_DDL = `
CREATE TABLE IF NOT EXISTS meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commits (
	commit_sha TEXT PRIMARY KEY,
	parent_shas TEXT NOT NULL,
	tree_sha TEXT NOT NULL,
	author_name TEXT NOT NULL,
	author_email TEXT NOT NULL,
	author_timestamp INTEGER NOT NULL,
	committer_timestamp INTEGER NOT NULL,
	message TEXT NOT NULL,
	ingested_at INTEGER NOT NULL,
	is_checkpoint INTEGER NOT NULL,
	checkpoint_interval INTEGER NOT NULL,
	schema_version INTEGER NOT NULL,
	analyzer_version INTEGER NOT NULL,
	profile_version INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commits_ingested ON commits(ingested_at);

CREATE TABLE IF NOT EXISTS checkpoints (
	commit_sha TEXT PRIMARY KEY,
	snapshot_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	schema_version INTEGER NOT NULL,
	analyzer_version INTEGER NOT NULL,
	profile_version INTEGER NOT NULL,
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deltas (
	commit_sha TEXT PRIMARY KEY,
	parent_commit_sha TEXT NOT NULL,
	delta_json TEXT NOT NULL,
	delta_version INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deltas_parent ON deltas(parent_commit_sha);

CREATE TABLE IF NOT EXISTS entities (
	entity_id TEXT PRIMARY KEY,
	canonical_path TEXT NOT NULL,
	kind TEXT NOT NULL,
	first_seen_commit TEXT NOT NULL,
	last_seen_commit TEXT NOT NULL,
	is_active INTEGER NOT NULL,
	metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_entities_path ON entities(canonical_path);

CREATE TABLE IF NOT EXISTS entity_snapshots (
	entity_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	path TEXT NOT NULL,
	blob_oid TEXT,
	content_hash TEXT,
	node_data_json TEXT NOT NULL,
	PRIMARY KEY (entity_id, commit_sha),
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entity_snapshots_commit ON entity_snapshots(commit_sha);
CREATE INDEX IF NOT EXISTS idx_entity_snapshots_blob ON entity_snapshots(blob_oid);

CREATE TABLE IF NOT EXISTS lineage_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	entity_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	parent_commit_sha TEXT NOT NULL,
	lineage_case TEXT NOT NULL,
	evidence_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lineage_entity ON lineage_events(entity_id);
CREATE INDEX IF NOT EXISTS idx_lineage_commit ON lineage_events(commit_sha);

CREATE TABLE IF NOT EXISTS edges (
	edge_id TEXT PRIMARY KEY,
	source_entity_id TEXT NOT NULL,
	target_entity_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	first_seen_commit TEXT NOT NULL,
	last_seen_commit TEXT NOT NULL,
	is_active INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_entity_id);

CREATE TABLE IF NOT EXISTS edge_snapshots (
	edge_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	source_entity_id TEXT NOT NULL,
	target_entity_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	edge_data_json TEXT NOT NULL,
	PRIMARY KEY (edge_id, commit_sha),
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edge_snapshots_commit ON edge_snapshots(commit_sha);

CREATE TABLE IF NOT EXISTS blob_cache (
	cache_key TEXT PRIMARY KEY,
	blob_oid TEXT NOT NULL,
	analyzer_version INTEGER NOT NULL,
	profile_version INTEGER NOT NULL,
	language TEXT NOT NULL,
	node_data_json TEXT NOT NULL,
	outgoing_edges_json TEXT NOT NULL,
	analyzed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blob_cache_oid ON blob_cache(blob_oid);
`;

export const SCHEMA_V2_DDL = `
CREATE TABLE IF NOT EXISTS meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repository_identity (
	repo_id TEXT PRIMARY KEY,
	root_path TEXT NOT NULL,
	common_git_dir TEXT,
	object_format TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commits (
	commit_sha TEXT PRIMARY KEY,
	parent_shas TEXT NOT NULL,
	tree_sha TEXT NOT NULL,
	author_name TEXT NOT NULL,
	author_email TEXT NOT NULL,
	author_timestamp INTEGER NOT NULL,
	committer_timestamp INTEGER NOT NULL,
	message TEXT NOT NULL,
	ingested_at INTEGER NOT NULL,
	is_checkpoint INTEGER NOT NULL,
	checkpoint_interval INTEGER NOT NULL,
	schema_version INTEGER NOT NULL,
	analyzer_version INTEGER NOT NULL,
	profile_version INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commits_ingested ON commits(ingested_at);

CREATE TABLE IF NOT EXISTS commit_parents (
	commit_sha TEXT NOT NULL,
	parent_index INTEGER NOT NULL,
	parent_sha TEXT NOT NULL,
	PRIMARY KEY (commit_sha, parent_index),
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_commit_parents_parent ON commit_parents(parent_sha);

CREATE TABLE IF NOT EXISTS refs (
	ref_name TEXT PRIMARY KEY,
	target_sha TEXT NOT NULL,
	ref_type TEXT,
	last_observed INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_states (
	state_id TEXT PRIMARY KEY,
	canonical_digest TEXT NOT NULL UNIQUE,
	snapshot_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	schema_version INTEGER NOT NULL,
	analyzer_version INTEGER NOT NULL,
	profile_version INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_graph_states_digest ON graph_states(canonical_digest);

CREATE TABLE IF NOT EXISTS checkpoints (
	commit_sha TEXT PRIMARY KEY,
	snapshot_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	schema_version INTEGER NOT NULL,
	analyzer_version INTEGER NOT NULL,
	profile_version INTEGER NOT NULL,
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deltas (
	commit_sha TEXT PRIMARY KEY,
	parent_commit_sha TEXT NOT NULL,
	delta_json TEXT NOT NULL,
	delta_version INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deltas_parent ON deltas(parent_commit_sha);

CREATE TABLE IF NOT EXISTS entities (
	entity_id TEXT PRIMARY KEY,
	canonical_path TEXT NOT NULL,
	kind TEXT NOT NULL,
	first_seen_commit TEXT NOT NULL,
	last_seen_commit TEXT NOT NULL,
	is_active INTEGER NOT NULL,
	metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_entities_path ON entities(canonical_path);

CREATE TABLE IF NOT EXISTS entity_snapshots (
	entity_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	path TEXT NOT NULL,
	blob_oid TEXT,
	content_hash TEXT,
	node_data_json TEXT NOT NULL,
	PRIMARY KEY (entity_id, commit_sha),
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entity_snapshots_commit ON entity_snapshots(commit_sha);
CREATE INDEX IF NOT EXISTS idx_entity_snapshots_blob ON entity_snapshots(blob_oid);

CREATE TABLE IF NOT EXISTS lineage_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	entity_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	parent_commit_sha TEXT NOT NULL,
	lineage_case TEXT NOT NULL,
	evidence_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lineage_entity ON lineage_events(entity_id);
CREATE INDEX IF NOT EXISTS idx_lineage_commit ON lineage_events(commit_sha);

CREATE TABLE IF NOT EXISTS edges (
	edge_id TEXT PRIMARY KEY,
	source_entity_id TEXT NOT NULL,
	target_entity_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	first_seen_commit TEXT NOT NULL,
	last_seen_commit TEXT NOT NULL,
	is_active INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_entity_id);

CREATE TABLE IF NOT EXISTS edge_snapshots (
	edge_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	source_entity_id TEXT NOT NULL,
	target_entity_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	edge_data_json TEXT NOT NULL,
	PRIMARY KEY (edge_id, commit_sha),
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edge_snapshots_commit ON edge_snapshots(commit_sha);

CREATE TABLE IF NOT EXISTS blob_parse_artifacts (
	cache_key TEXT PRIMARY KEY,
	blob_oid TEXT NOT NULL,
	analyzer_version INTEGER NOT NULL,
	profile_version INTEGER NOT NULL,
	language TEXT NOT NULL,
	artifact_json TEXT NOT NULL,
	analyzed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blob_parse_artifacts_oid ON blob_parse_artifacts(blob_oid);
`;

export const SCHEMA_V3_DDL = `
CREATE TABLE IF NOT EXISTS meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repository_identity (
	repo_id TEXT PRIMARY KEY,
	root_path TEXT NOT NULL,
	common_git_dir TEXT,
	object_format TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_states (
	canonical_digest TEXT PRIMARY KEY,
	schema_version INTEGER NOT NULL,
	analyzer_version INTEGER NOT NULL,
	profile_version INTEGER NOT NULL,
	snapshot_json TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_graph_states_digest ON graph_states(canonical_digest);

CREATE TABLE IF NOT EXISTS commits (
	commit_sha TEXT PRIMARY KEY,
	canonical_digest TEXT NOT NULL DEFAULT '',
	parent_shas TEXT NOT NULL,
	tree_sha TEXT NOT NULL,
	author_name TEXT NOT NULL,
	author_email TEXT NOT NULL,
	author_timestamp INTEGER NOT NULL,
	committer_timestamp INTEGER NOT NULL,
	message TEXT NOT NULL,
	ingested_at INTEGER NOT NULL,
	is_checkpoint INTEGER NOT NULL,
	checkpoint_interval INTEGER NOT NULL,
	delta_depth INTEGER NOT NULL DEFAULT 0,
	base_commit_sha TEXT,
	schema_version INTEGER NOT NULL,
	analyzer_version INTEGER NOT NULL,
	profile_version INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commits_ingested ON commits(ingested_at);
CREATE INDEX IF NOT EXISTS idx_commits_digest ON commits(canonical_digest);
CREATE INDEX IF NOT EXISTS idx_commits_base ON commits(base_commit_sha);

CREATE TABLE IF NOT EXISTS commit_parents (
	commit_sha TEXT NOT NULL,
	parent_index INTEGER NOT NULL,
	parent_sha TEXT NOT NULL,
	PRIMARY KEY (commit_sha, parent_index),
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_commit_parents_parent ON commit_parents(parent_sha);

CREATE TABLE IF NOT EXISTS refs (
	ref_name TEXT PRIMARY KEY,
	target_sha TEXT NOT NULL,
	ref_type TEXT,
	last_observed INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
	commit_sha TEXT PRIMARY KEY,
	canonical_digest TEXT NOT NULL DEFAULT '',
	snapshot_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	schema_version INTEGER NOT NULL,
	analyzer_version INTEGER NOT NULL,
	profile_version INTEGER NOT NULL,
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deltas (
	commit_sha TEXT PRIMARY KEY,
	base_commit_sha TEXT NOT NULL,
	target_canonical_digest TEXT NOT NULL DEFAULT '',
	delta_json TEXT NOT NULL,
	delta_version INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deltas_base ON deltas(base_commit_sha);

CREATE TABLE IF NOT EXISTS entities (
	entity_id TEXT PRIMARY KEY,
	canonical_path TEXT NOT NULL,
	kind TEXT NOT NULL,
	first_seen_commit TEXT NOT NULL,
	last_seen_commit TEXT NOT NULL,
	is_active INTEGER NOT NULL,
	metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_entities_path ON entities(canonical_path);

CREATE TABLE IF NOT EXISTS entity_snapshots (
	entity_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	path TEXT NOT NULL,
	blob_oid TEXT,
	content_hash TEXT,
	node_data_json TEXT NOT NULL,
	PRIMARY KEY (entity_id, commit_sha),
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entity_snapshots_commit ON entity_snapshots(commit_sha);
CREATE INDEX IF NOT EXISTS idx_entity_snapshots_path ON entity_snapshots(path);
CREATE INDEX IF NOT EXISTS idx_entity_snapshots_blob ON entity_snapshots(blob_oid);

CREATE TABLE IF NOT EXISTS lineage_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	entity_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	parent_commit_sha TEXT NOT NULL,
	lineage_case TEXT NOT NULL,
	evidence_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lineage_entity ON lineage_events(entity_id);
CREATE INDEX IF NOT EXISTS idx_lineage_commit ON lineage_events(commit_sha);

CREATE TABLE IF NOT EXISTS edges (
	edge_id TEXT PRIMARY KEY,
	source_entity_id TEXT NOT NULL,
	target_entity_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	first_seen_commit TEXT NOT NULL,
	last_seen_commit TEXT NOT NULL,
	is_active INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_entity_id);

CREATE TABLE IF NOT EXISTS edge_snapshots (
	edge_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	source_entity_id TEXT NOT NULL,
	target_entity_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	edge_data_json TEXT NOT NULL,
	PRIMARY KEY (edge_id, commit_sha),
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edge_snapshots_commit ON edge_snapshots(commit_sha);
CREATE INDEX IF NOT EXISTS idx_edge_snapshots_source ON edge_snapshots(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_edge_snapshots_target ON edge_snapshots(target_entity_id);

CREATE TABLE IF NOT EXISTS blob_parse_artifacts (
	cache_key TEXT PRIMARY KEY,
	blob_oid TEXT NOT NULL,
	extension TEXT NOT NULL DEFAULT '',
	analyzer_version INTEGER NOT NULL,
	profile_version INTEGER NOT NULL,
	language TEXT NOT NULL,
	artifact_json TEXT NOT NULL,
	analyzed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blob_parse_artifacts_oid ON blob_parse_artifacts(blob_oid);
`;

export async function runMigrations(db: sqlite3.Database): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		db.get('PRAGMA user_version;', async (err, row: any) => {
			if (err) {
				return reject(new TemporalError('SchemaMigrationFailed', 'Failed to read PRAGMA user_version', err));
			}

			let currentVersion = (row && typeof row.user_version === 'number') ? row.user_version : 0;

			if (currentVersion > CURRENT_SCHEMA_VERSION) {
				return reject(
					new TemporalError(
						'SchemaMigrationFailed',
						`Database schema version ${currentVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`
					)
				);
			}

			try {
				if (currentVersion === 0) {
					// Fresh database -> initialize directly to Schema V3
					await execSql(db, SCHEMA_V3_DDL);
					await execSql(db, `PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
					return resolve();
				}

				if (currentVersion === 1) {
					// Upgrade Schema v1 -> Schema v2
					await execSql(db, `
						CREATE TABLE IF NOT EXISTS repository_identity (
							repo_id TEXT PRIMARY KEY,
							root_path TEXT NOT NULL,
							common_git_dir TEXT,
							object_format TEXT NOT NULL,
							created_at INTEGER NOT NULL
						);

						CREATE TABLE IF NOT EXISTS commit_parents (
							commit_sha TEXT NOT NULL,
							parent_index INTEGER NOT NULL,
							parent_sha TEXT NOT NULL,
							PRIMARY KEY (commit_sha, parent_index),
							FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
						);

						CREATE INDEX IF NOT EXISTS idx_commit_parents_parent ON commit_parents(parent_sha);

						CREATE TABLE IF NOT EXISTS refs (
							ref_name TEXT PRIMARY KEY,
							target_sha TEXT NOT NULL,
							ref_type TEXT,
							last_observed INTEGER NOT NULL
						);

						CREATE TABLE IF NOT EXISTS graph_states (
							canonical_digest TEXT PRIMARY KEY,
							schema_version INTEGER NOT NULL,
							analyzer_version INTEGER NOT NULL,
							profile_version INTEGER NOT NULL,
							snapshot_json TEXT NOT NULL,
							created_at INTEGER NOT NULL
						);

						CREATE INDEX IF NOT EXISTS idx_graph_states_digest ON graph_states(canonical_digest);

						CREATE TABLE IF NOT EXISTS blob_parse_artifacts (
							cache_key TEXT PRIMARY KEY,
							blob_oid TEXT NOT NULL,
							extension TEXT NOT NULL DEFAULT '',
							analyzer_version INTEGER NOT NULL,
							profile_version INTEGER NOT NULL,
							language TEXT NOT NULL,
							artifact_json TEXT NOT NULL,
							analyzed_at INTEGER NOT NULL
						);

						CREATE INDEX IF NOT EXISTS idx_blob_parse_artifacts_oid ON blob_parse_artifacts(blob_oid);
					`);

					// Backfill commit_parents from commits.parent_shas
					const rows: any[] = await allSql(db, 'SELECT commit_sha, parent_shas FROM commits;');
					const insertStmt = db.prepare('INSERT OR IGNORE INTO commit_parents (commit_sha, parent_index, parent_sha) VALUES (?, ?, ?);');
					for (const r of rows || []) {
						try {
							const parents: string[] = JSON.parse(r.parent_shas || '[]');
							parents.forEach((psha, idx) => {
								if (psha) {
									insertStmt.run(r.commit_sha, idx, psha);
								}
							});
						} catch {
							// Ignore malformed JSON in legacy row
						}
					}
					insertStmt.finalize();
					currentVersion = 2;
				}

				if (currentVersion === 2) {
					// Upgrade Schema v2 -> Schema v3
					await execSql(db, `
						CREATE TABLE IF NOT EXISTS graph_states (
							canonical_digest TEXT PRIMARY KEY,
							schema_version INTEGER NOT NULL,
							analyzer_version INTEGER NOT NULL,
							profile_version INTEGER NOT NULL,
							snapshot_json TEXT NOT NULL,
							created_at INTEGER NOT NULL
						);
					`);

					// Ensure commits table has v3 columns
					try {
						await execSql(db, 'ALTER TABLE commits ADD COLUMN canonical_digest TEXT NOT NULL DEFAULT "";');
					} catch { /* column might already exist */ }
					try {
						await execSql(db, 'ALTER TABLE commits ADD COLUMN delta_depth INTEGER NOT NULL DEFAULT 0;');
					} catch { /* column might already exist */ }
					try {
						await execSql(db, 'ALTER TABLE commits ADD COLUMN base_commit_sha TEXT;');
					} catch { /* column might already exist */ }

					// Ensure deltas table has v3 columns
					try {
						await execSql(db, 'ALTER TABLE deltas ADD COLUMN base_commit_sha TEXT NOT NULL DEFAULT "";');
					} catch { /* column might already exist */ }
					try {
						await execSql(db, 'ALTER TABLE deltas ADD COLUMN target_canonical_digest TEXT NOT NULL DEFAULT "";');
					} catch { /* column might already exist */ }

					// Ensure checkpoints table has v3 columns
					try {
						await execSql(db, 'ALTER TABLE checkpoints ADD COLUMN canonical_digest TEXT NOT NULL DEFAULT "";');
					} catch { /* column might already exist */ }

					// Ensure blob_parse_artifacts table has extension column
					try {
						await execSql(db, 'ALTER TABLE blob_parse_artifacts ADD COLUMN extension TEXT NOT NULL DEFAULT "";');
					} catch { /* column might already exist */ }

					await execSql(db, `PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
					currentVersion = 3;
				}

				resolve();
			} catch (migrationErr: any) {
				reject(new TemporalError('SchemaMigrationFailed', migrationErr?.message || String(migrationErr), migrationErr));
			}
		});
	});
}

function execSql(db: sqlite3.Database, sql: string): Promise<void> {
	return new Promise((resolve, reject) => {
		db.exec(sql, (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

function allSql(db: sqlite3.Database, sql: string): Promise<any[]> {
	return new Promise((resolve, reject) => {
		db.all(sql, (err, rows) => {
			if (err) reject(err);
			else resolve(rows || []);
		});
	});
}

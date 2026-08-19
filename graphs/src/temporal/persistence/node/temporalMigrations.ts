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

export async function runMigrations(db: sqlite3.Database): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		db.get('PRAGMA user_version;', (err, row: any) => {
			if (err) {
				return reject(new TemporalError('SchemaMigrationFailed', 'Failed to read PRAGMA user_version', err));
			}

			const currentVersion = (row && typeof row.user_version === 'number') ? row.user_version : 0;

			if (currentVersion > CURRENT_SCHEMA_VERSION) {
				return reject(
					new TemporalError(
						'SchemaMigrationFailed',
						`Database schema version ${currentVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`
					)
				);
			}

			if (currentVersion === 0) {
				// Fresh database -> initialize directly to Schema V2
				db.exec(SCHEMA_V2_DDL, (execErr) => {
					if (execErr) {
						return reject(new TemporalError('SchemaMigrationFailed', 'Failed to execute Schema V2 DDL', execErr));
					}

					db.run(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`, (verErr) => {
						if (verErr) {
							return reject(new TemporalError('SchemaMigrationFailed', 'Failed to set PRAGMA user_version', verErr));
						}
						resolve();
					});
				});
			} else if (currentVersion === 1) {
				// Upgrade Schema v1 -> Schema v2
				const v2MigrationSql = `
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
						state_id TEXT PRIMARY KEY,
						canonical_digest TEXT NOT NULL UNIQUE,
						snapshot_json TEXT NOT NULL,
						created_at INTEGER NOT NULL,
						schema_version INTEGER NOT NULL,
						analyzer_version INTEGER NOT NULL,
						profile_version INTEGER NOT NULL
					);

					CREATE INDEX IF NOT EXISTS idx_graph_states_digest ON graph_states(canonical_digest);

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

				db.exec(v2MigrationSql, (migErr) => {
					if (migErr) {
						return reject(new TemporalError('SchemaMigrationFailed', 'Failed to execute Schema V2 upgrade DDL', migErr));
					}

					// Backfill commit_parents from commits.parent_shas
					db.all('SELECT commit_sha, parent_shas FROM commits;', (selErr, rows: any[]) => {
						if (selErr) {
							return reject(new TemporalError('SchemaMigrationFailed', 'Failed to read commits for commit_parents backfill', selErr));
						}

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

						db.run('PRAGMA user_version = 2;', (verErr) => {
							if (verErr) {
								return reject(new TemporalError('SchemaMigrationFailed', 'Failed to set PRAGMA user_version = 2', verErr));
							}
							resolve();
						});
					});
				});
			} else {
				// Already at current version
				resolve();
			}
		});
	});
}

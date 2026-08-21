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

export const SCHEMA_V4_ADDITIONS_DDL = `
CREATE TABLE IF NOT EXISTS entity_deletions (
	entity_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	canonical_path TEXT NOT NULL,
	PRIMARY KEY (entity_id, commit_sha),
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entity_deletions_commit ON entity_deletions(commit_sha);
CREATE INDEX IF NOT EXISTS idx_entity_deletions_path ON entity_deletions(canonical_path);

CREATE TABLE IF NOT EXISTS edge_events (
	edge_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	event_kind TEXT NOT NULL,
	PRIMARY KEY (edge_id, commit_sha, event_kind),
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edge_events_commit ON edge_events(commit_sha);
`;

export const SCHEMA_V4_DDL = `
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
	state_id TEXT PRIMARY KEY,
	canonical_digest TEXT NOT NULL,
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
	canonical_state_id TEXT,
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

CREATE TABLE IF NOT EXISTS entity_deletions (
	entity_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	canonical_path TEXT NOT NULL,
	PRIMARY KEY (entity_id, commit_sha),
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entity_deletions_commit ON entity_deletions(commit_sha);
CREATE INDEX IF NOT EXISTS idx_entity_deletions_path ON entity_deletions(canonical_path);

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

CREATE TABLE IF NOT EXISTS edge_events (
	edge_id TEXT NOT NULL,
	commit_sha TEXT NOT NULL,
	event_kind TEXT NOT NULL,
	PRIMARY KEY (edge_id, commit_sha, event_kind),
	FOREIGN KEY (commit_sha) REFERENCES commits(commit_sha) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edge_events_commit ON edge_events(commit_sha);

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

/**
 * v5 changes history-table semantics from full observations to structural
 * transitions. Temporal stores are derived caches, so rebuilding graph state
 * is safer than attempting to reinterpret dense v4 observations as events.
 */
export const SCHEMA_V5_ADDITIONS_DDL = `
ALTER TABLE commits ADD COLUMN lineage_coverage TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE commits ADD COLUMN lineage_anchor_sha TEXT;
CREATE INDEX IF NOT EXISTS idx_commits_lineage_anchor ON commits(lineage_anchor_sha);
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
				await execSql(db, 'BEGIN IMMEDIATE;');
				if (currentVersion === 0) {
					// Establish the v3 baseline, then use the same v3 -> v4 path as
					// existing caches so fresh and migrated schemas are identical.
					await execSql(db, SCHEMA_V3_DDL);
					currentVersion = 3;
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
					for (const r of rows || []) {
						let parents: string[];
						try {
							const parsed = JSON.parse(r.parent_shas || '[]');
							if (!Array.isArray(parsed) || parsed.some(parent => typeof parent !== 'string')) {
								throw new Error('parent_shas is not a string array');
							}
							parents = parsed;
						} catch (error) {
							throw new TemporalError('DatabaseCorrupted', `Malformed parent topology for legacy commit '${r.commit_sha}'`, error);
						}
						for (let index = 0; index < parents.length; index++) {
							if (parents[index]) {
								await runSql(db, 'INSERT OR IGNORE INTO commit_parents (commit_sha, parent_index, parent_sha) VALUES (?, ?, ?);', [r.commit_sha, index, parents[index]]);
							}
						}
					}
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
					if (!(await columnExists(db, 'commits', 'canonical_digest'))) {
						await execSql(db, 'ALTER TABLE commits ADD COLUMN canonical_digest TEXT NOT NULL DEFAULT "";');
					}
					if (!(await columnExists(db, 'commits', 'delta_depth'))) {
						await execSql(db, 'ALTER TABLE commits ADD COLUMN delta_depth INTEGER NOT NULL DEFAULT 0;');
					}
					if (!(await columnExists(db, 'commits', 'base_commit_sha'))) {
						await execSql(db, 'ALTER TABLE commits ADD COLUMN base_commit_sha TEXT;');
					}

					// Ensure deltas table has v3 columns
					if (!(await columnExists(db, 'deltas', 'base_commit_sha'))) {
						await execSql(db, 'ALTER TABLE deltas ADD COLUMN base_commit_sha TEXT NOT NULL DEFAULT "";');
					}
					if (!(await columnExists(db, 'deltas', 'target_canonical_digest'))) {
						await execSql(db, 'ALTER TABLE deltas ADD COLUMN target_canonical_digest TEXT NOT NULL DEFAULT "";');
					}

					// Ensure checkpoints table has v3 columns
					if (!(await columnExists(db, 'checkpoints', 'canonical_digest'))) {
						await execSql(db, 'ALTER TABLE checkpoints ADD COLUMN canonical_digest TEXT NOT NULL DEFAULT "";');
					}

					// Ensure blob_parse_artifacts table has extension column
					if (!(await columnExists(db, 'blob_parse_artifacts', 'extension'))) {
						await execSql(db, 'ALTER TABLE blob_parse_artifacts ADD COLUMN extension TEXT NOT NULL DEFAULT "";');
					}
					currentVersion = 3;
				}

				if (currentVersion === 3) {
					await execSql(db, 'ALTER TABLE graph_states RENAME TO graph_states_v3;');
					await execSql(db, `
						CREATE TABLE graph_states (
							state_id TEXT PRIMARY KEY,
							canonical_digest TEXT NOT NULL,
							schema_version INTEGER NOT NULL,
							analyzer_version INTEGER NOT NULL,
							profile_version INTEGER NOT NULL,
							snapshot_json TEXT NOT NULL,
							created_at INTEGER NOT NULL
						);
						INSERT INTO graph_states (state_id, canonical_digest, schema_version, analyzer_version, profile_version, snapshot_json, created_at)
						SELECT canonical_digest, canonical_digest, schema_version, analyzer_version, profile_version, snapshot_json, created_at
						FROM graph_states_v3;
						DROP TABLE graph_states_v3;
						CREATE INDEX idx_graph_states_digest ON graph_states(canonical_digest);
					`);
					if (!(await columnExists(db, 'commits', 'canonical_state_id'))) {
						await execSql(db, 'ALTER TABLE commits ADD COLUMN canonical_state_id TEXT;');
					}
					await execSql(db, 'UPDATE commits SET canonical_state_id = canonical_digest WHERE canonical_state_id IS NULL;');
					await execSql(db, SCHEMA_V4_ADDITIONS_DDL);
					const lineageRows = await allSql(db, 'SELECT entity_id, commit_sha, evidence_json FROM lineage_events WHERE lineage_case = \'terminated\';');
					for (const lineage of lineageRows) {
						let evidence: { oldPath?: string };
						try {
							evidence = JSON.parse(lineage.evidence_json || '{}');
						} catch (error) {
							throw new TemporalError('DatabaseCorrupted', `Malformed lineage evidence for '${lineage.commit_sha}'`, error);
						}
						if (evidence.oldPath) {
							await runSql(db, 'INSERT OR IGNORE INTO entity_deletions (entity_id, commit_sha, canonical_path) VALUES (?, ?, ?);', [lineage.entity_id, lineage.commit_sha, evidence.oldPath]);
						}
					}
					const deltaRows = await allSql(db, 'SELECT commit_sha, delta_json FROM deltas;');
					for (const deltaRow of deltaRows) {
						let delta: { edgesDeleted?: string[] };
						try {
							delta = JSON.parse(deltaRow.delta_json || '{}');
						} catch (error) {
							throw new TemporalError('DatabaseCorrupted', `Malformed delta payload for '${deltaRow.commit_sha}'`, error);
						}
						for (const edgeId of delta.edgesDeleted ?? []) {
							await runSql(db, 'INSERT OR IGNORE INTO edge_events (edge_id, commit_sha, event_kind) VALUES (?, ?, ?);', [edgeId, deltaRow.commit_sha, 'removed']);
						}
					}
					currentVersion = 4;
				}

				if (currentVersion === 4) {
					// v4 persisted an observation for every entity and edge at every
					// commit. v5 persists only checkpoints and structural transitions.
					// Discard only derived graph state; refs and blob artifacts stay warm.
					await execSql(db, `
						DELETE FROM entity_deletions;
						DELETE FROM edge_events;
						DELETE FROM lineage_events;
						DELETE FROM entity_snapshots;
						DELETE FROM edge_snapshots;
						DELETE FROM checkpoints;
						DELETE FROM deltas;
						DELETE FROM commit_parents;
						DELETE FROM commits;
						DELETE FROM graph_states;
						DELETE FROM entities;
						DELETE FROM edges;
					`);
					await execSql(db, SCHEMA_V5_ADDITIONS_DDL);
					currentVersion = 5;
				}

				await validateCurrentSchema(db);
				await execSql(db, `PRAGMA user_version = ${currentVersion};`);
				await execSql(db, 'COMMIT;');
				resolve();
			} catch (migrationErr: any) {
				try {
					await execSql(db, 'ROLLBACK;');
				} catch {
					// Preserve the original migration failure.
				}
				reject(new TemporalError('SchemaMigrationFailed', migrationErr?.message || String(migrationErr), migrationErr));
			}
		});
	});
}

function execSql(db: sqlite3.Database, sql: string): Promise<void> {
	return new Promise((resolve, reject) => {
		db.exec(sql, (err) => {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
}

function allSql(db: sqlite3.Database, sql: string): Promise<any[]> {
	return new Promise((resolve, reject) => {
		db.all(sql, (err, rows) => {
			if (err) {
				reject(err);
			} else {
				resolve(rows || []);
			}
		});
	});
}

function runSql(db: sqlite3.Database, sql: string, parameters: readonly unknown[]): Promise<void> {
	return new Promise((resolve, reject) => {
		db.run(sql, parameters, error => error ? reject(error) : resolve());
	});
}

async function columnExists(db: sqlite3.Database, table: string, column: string): Promise<boolean> {
	const columns = await allSql(db, `PRAGMA table_info(${table});`);
	return columns.some(candidate => candidate.name === column);
}

async function validateCurrentSchema(db: sqlite3.Database): Promise<void> {
	const requiredColumns: Readonly<Record<string, readonly string[]>> = {
		meta: ['key', 'value'],
		repository_identity: ['repo_id', 'root_path', 'object_format'],
		commits: ['commit_sha', 'canonical_digest', 'canonical_state_id', 'parent_shas', 'is_checkpoint', 'delta_depth', 'base_commit_sha', 'lineage_coverage', 'lineage_anchor_sha', 'schema_version', 'analyzer_version', 'profile_version'],
		commit_parents: ['commit_sha', 'parent_index', 'parent_sha'],
		refs: ['ref_name', 'target_sha', 'last_observed'],
		graph_states: ['state_id', 'canonical_digest', 'snapshot_json', 'schema_version', 'analyzer_version', 'profile_version'],
		checkpoints: ['commit_sha', 'canonical_digest', 'snapshot_json'],
		deltas: ['commit_sha', 'base_commit_sha', 'target_canonical_digest', 'delta_json', 'delta_version'],
		entities: ['entity_id', 'canonical_path'],
		entity_snapshots: ['entity_id', 'commit_sha', 'path', 'node_data_json'],
		entity_deletions: ['entity_id', 'commit_sha', 'canonical_path'],
		lineage_events: ['entity_id', 'commit_sha', 'parent_commit_sha', 'lineage_case', 'evidence_json'],
		edges: ['edge_id', 'source_entity_id', 'target_entity_id', 'kind'],
		edge_snapshots: ['edge_id', 'commit_sha', 'source_entity_id', 'target_entity_id', 'edge_data_json'],
		edge_events: ['edge_id', 'commit_sha', 'event_kind'],
		blob_parse_artifacts: ['cache_key', 'blob_oid', 'extension', 'analyzer_version', 'profile_version', 'language', 'artifact_json'],
	};

	for (const [table, expectedColumns] of Object.entries(requiredColumns)) {
		const columns = await allSql(db, `PRAGMA table_info(${table});`);
		const actualColumns = new Set(columns.map(column => column.name));
		const missingColumns = expectedColumns.filter(column => !actualColumns.has(column));
		if (missingColumns.length > 0) {
			throw new TemporalError('DatabaseCorrupted', `Temporal schema table '${table}' is missing required columns: ${missingColumns.join(', ')}`);
		}
	}

	const foreignKeyFailures = await allSql(db, 'PRAGMA foreign_key_check;');
	if (foreignKeyFailures.length > 0) {
		throw new TemporalError('DatabaseCorrupted', 'Temporal schema contains invalid foreign-key relationships');
	}
}

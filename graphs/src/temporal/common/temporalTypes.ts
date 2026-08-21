/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';
import type { CanonicalGraphSnapshot } from '../../common/types/canonicalTypes.js';

export type GraphNodeData = GraphNode;
export type GraphEdgeData = GraphEdge;

export type TemporalIndexStatus =
	| 'unregistered'
	| 'not-indexed'
	| 'queued'
	| 'indexing'
	| 'ready'
	| 'incomplete'
	| 'rebuilding'
	| 'failed'
	| 'cancelled';

/**
 * Machine-readable reason that an index status could not be determined or
 * completed. These values deliberately avoid surfacing raw Git, SQLite, or
 * source-content error messages to consumers.
 */
export type TemporalIndexDiagnosticCode =
	| 'repository-unavailable'
	| 'database-corrupted'
	| 'schema-migration-failed'
	| 'history-unavailable'
	| 'git-error'
	| 'runtime-failure';

/**
 * The Phase-3-facing commit index state. A failed status always carries a
 * diagnostic code so callers never have to infer an operational failure from
 * an unrelated lifecycle state such as `unregistered`.
 */
export interface TemporalCommitIndexStatus {
	readonly status: TemporalIndexStatus;
	readonly diagnosticCode?: TemporalIndexDiagnosticCode;
}

export interface ArchitectureGraphData {
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	readonly timestamp: number;
}

export type TemporalEntityKind = 'file' | 'module' | 'directory' | 'package';

export type TemporalEdgeKind = 'imports' | 're-exports' | 'contains' | 'references';

/**
 * 12 Canonical Lineage Transitions for cross-commit entity identity resolution.
 */
export type TemporalLineageCase =
	| 'same-canonical-id'       // 1: Unchanged file: same path & content identity
	| 'modified-in-place'       // 2: Modified in place: same path, changed blob
	| 'git-rename'              // 3: Exact rename: Git rename evidence (R100)
	| 'git-rename-edit'         // 4: Rename + edit: Git rename (R<100) + structural similarity
	| 'directory-move'          // 5: Directory move: path prefix transformation
	| 'forked-copy'             // 6: Copy: source entity continues, target gets fresh entity ID
	| 'terminated'              // 7: Delete: record termination event
	| 'recreated-fresh'         // 8: Delete-then-recreate: fresh entity ID on recreation
	| 'distinct-basename'       // 9: Identical basenames in different dirs: distinct entity IDs
	| 'ambiguous-unresolved'    // 10: Ambiguous rename/copy: fail closed with distinct entity IDs
	| 'swapped-paths'           // 11: Swapped paths: follow content/git evidence rather than paths
	| 'merge-continuity';       // 12: Merge commit: first-parent baseline with multi-parent continuity

export interface TemporalEntity {
	readonly entityId: string;
	readonly canonicalPath: string;
	readonly kind: TemporalEntityKind;
	readonly firstSeenCommit: string;
	readonly lastSeenCommit: string;
	readonly isActive: boolean;
	readonly metadata?: Record<string, unknown>;
}

export interface TemporalEntitySnapshot {
	readonly entityId: string;
	readonly commitSha: string;
	readonly path: string;
	readonly blobOid?: string;
	readonly contentHash?: string;
	readonly nodeData: GraphNodeData;
}

export interface TemporalEntityLineageEvent {
	readonly entityId: string;
	readonly commitSha: string;
	readonly parentCommitSha: string;
	readonly lineageCase: TemporalLineageCase;
	readonly evidence: {
		readonly sourceEntityId?: string;
		readonly oldPath?: string;
		readonly newPath?: string;
		readonly oldBlobOid?: string;
		readonly newBlobOid?: string;
		readonly similarity?: number;
		readonly confidence: number;
		readonly details?: string;
	};
}

export interface TemporalEdgeRecord {
	readonly edgeId: string;
	readonly sourceEntityId: string;
	readonly targetEntityId: string;
	readonly kind: TemporalEdgeKind;
	readonly firstSeenCommit: string;
	readonly lastSeenCommit: string;
	readonly isActive: boolean;
}

export interface TemporalEdgeSnapshot {
	readonly edgeId: string;
	readonly commitSha: string;
	readonly sourceEntityId: string;
	readonly targetEntityId: string;
	readonly kind: TemporalEdgeKind;
	readonly edgeData: GraphEdgeData;
}

/** A persisted edge observation scoped to all-parent ancestry; `present` is emitted per indexed commit and `removed` records deletion. */
export interface TemporalEdgeLifecycleEvent {
	readonly edgeId: string;
	readonly commitSha: string;
	readonly eventKind: 'present' | 'removed';
	readonly sourceEntityId?: string;
	readonly targetEntityId?: string;
	readonly kind?: TemporalEdgeKind;
}

/** Repository ref metadata for the Phase-3 ref picker. */
export interface TemporalRepositoryRef {
	readonly name: string;
	readonly targetSha: string;
	readonly kind: 'head' | 'branch' | 'remote-branch' | 'tag' | 'annotated-tag';
	/** Present only for the current HEAD ref when it is not attached to a branch. */
	readonly isDetached?: boolean;
}

/** Metadata-only primary-timeline row. Selecting a row is the only operation that reconstructs its graph. */
export interface TemporalCommitSummary {
	readonly sha: string;
	readonly parents: readonly string[];
	readonly authorName: string;
	readonly authorEmail: string;
	readonly authorTimestamp: number;
	readonly committerTimestamp: number;
	readonly message: string;
	readonly indexStatus: TemporalCommitIndexStatus;
}

export interface TemporalHistoryPage {
	readonly commits: readonly TemporalCommitSummary[];
	readonly hasMore: boolean;
	/** Opaque cursor pinned to the ref SHA from the first request. */
	readonly nextCursor?: string;
}

export interface TemporalHistoryPageOptions {
	readonly ref?: string;
	readonly cursor?: string;
	readonly pageSize?: number;
}

/** Repository-local maintenance result. Retention only evicts regenerable parse artifacts, never graph-state chains. */
export interface TemporalMaintenanceResult {
	readonly databaseBytes: number;
	readonly parseArtifactsEvicted: number;
	readonly withinBudget: boolean;
}

export interface TemporalStructuralDelta {
	readonly commitSha: string;
	readonly baseCommitSha: string;
	readonly parentCommitSha: string;
	readonly targetCanonicalDigest?: string;
	readonly targetTimestamp?: number;
	readonly targetCanonicalMetadata?: TemporalCanonicalSnapshotMetadata;
	readonly deltaVersion: number;
	readonly entitiesAdded: readonly TemporalEntitySnapshot[];
	readonly entitiesModified: readonly TemporalEntitySnapshot[];
	readonly entitiesDeleted: readonly string[]; // entityIds
	readonly entitiesRenamed: readonly { readonly entityId: string; readonly oldPath: string; readonly newPath: string }[];
	readonly edgesAdded: readonly TemporalEdgeSnapshot[];
	readonly edgesModified: readonly TemporalEdgeSnapshot[];
	readonly edgesDeleted: readonly string[]; // edgeIds
}

export interface TemporalCommitRecord {
	readonly commitSha: string;
	readonly canonicalDigest?: string;
	readonly parentShas: readonly string[];
	readonly treeSha: string;
	readonly authorName: string;
	readonly authorEmail: string;
	readonly authorTimestamp: number;
	readonly committerTimestamp: number;
	readonly message: string;
	readonly ingestedAt: number;
	readonly isCheckpoint: boolean;
	readonly checkpointInterval: number;
	readonly deltaDepth?: number;
	readonly baseCommitSha?: string;
	readonly schemaVersion: number;
	readonly analyzerVersion: number;
	readonly profileVersion: number;
}

export type TemporalCanonicalSnapshotMetadata = Omit<CanonicalGraphSnapshot, 'nodes' | 'edges' | 'digest'>;
import type { BlobParseArtifact } from '../../core/canonical/parseArtifactCache.js';

export interface TemporalGraphSnapshot {
	readonly schemaVersion: number;
	readonly analyzerVersion: number;
	readonly profileVersion: number;
	readonly commitSha: string;
	readonly timestamp: number;
	readonly isCheckpoint: boolean;
	readonly canonicalSnapshot?: CanonicalGraphSnapshot;
	readonly graphData: ArchitectureGraphData;
	readonly entityMap: ReadonlyMap<string, TemporalEntitySnapshot>; // entityId -> snapshot
	readonly edgeMap: ReadonlyMap<string, TemporalEdgeSnapshot>;     // edgeId -> snapshot
	readonly pathToEntityId: ReadonlyMap<string, string>;            // path -> entityId
	readonly digest?: string;
}

export interface TemporalReconstructionPlan {
	readonly targetCommitSha: string;
	readonly baseCheckpointSha?: string;
	readonly deltaShas: readonly string[]; // in forward replay order: base -> delta1 -> delta2 -> target
	readonly totalDeltas: number;
	readonly isDirectCheckpoint: boolean;
}

export interface TemporalQueryOptions {
	readonly fromCommitSha?: string;
	readonly toCommitSha?: string;
	readonly limit?: number;
}

export interface BlobAnalysisRecord {
	readonly blobOid: string;
	readonly analyzerVersion: number;
	readonly profileVersion: number;
	readonly language: string;
	readonly artifact: BlobParseArtifact;
	readonly analyzedAt: number;
}

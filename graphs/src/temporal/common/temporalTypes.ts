/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';

export type GraphNodeData = GraphNode;
export type GraphEdgeData = GraphEdge;

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

export interface TemporalStructuralDelta {
	readonly commitSha: string;
	readonly parentCommitSha: string;
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
	readonly schemaVersion: number;
	readonly analyzerVersion: number;
	readonly profileVersion: number;
}

export interface TemporalGraphSnapshot {
	readonly schemaVersion: number;
	readonly analyzerVersion: number;
	readonly profileVersion: number;
	readonly commitSha: string;
	readonly timestamp: number;
	readonly isCheckpoint: boolean;
	readonly graphData: ArchitectureGraphData;
	readonly entityMap: ReadonlyMap<string, TemporalEntitySnapshot>; // entityId -> snapshot
	readonly edgeMap: ReadonlyMap<string, TemporalEdgeSnapshot>;     // edgeId -> snapshot
	readonly pathToEntityId: ReadonlyMap<string, string>;            // path -> entityId
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
	readonly pathScope?: string;
	readonly entityIds?: readonly string[];
	readonly maxDepth?: number;
	readonly limit?: number;
}

export interface BlobAnalysisRecord {
	readonly blobOid: string;
	readonly analyzerVersion: number;
	readonly profileVersion: number;
	readonly language: string;
	readonly nodeData: GraphNodeData;
	readonly outgoingEdges: readonly { readonly targetPath: string; readonly kind: TemporalEdgeKind; readonly weight?: number }[];
	readonly analyzedAt: number;
}

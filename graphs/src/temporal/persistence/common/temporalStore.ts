/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

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
	TemporalLineageCoverage,
} from '../../common/temporalTypes.js';
import type { CanonicalCoverage } from '../../../common/types/canonicalTypes.js';
import type { CancellationTokenLike } from '../../../core/canonical/contentSource.js';

export interface RepositoryIdentityRecord {
	readonly repoId: string;
	readonly rootPath: string;
	readonly commonGitDir?: string;
	readonly objectFormat: 'sha1' | 'sha256';
	readonly createdAt: number;
}

export interface RefRecord {
	readonly refName: string;
	readonly targetSha: string;
	readonly refType?: string;
	readonly lastObserved: number;
}

export interface TemporalStoreMaintenanceResult {
	readonly databaseBytes: number;
	readonly parseArtifactsEvicted: number;
	readonly withinBudget: boolean;
}

export interface TemporalCommitIndexMetadata {
	readonly commitSha: string;
	readonly coverage?: CanonicalCoverage;
	readonly lineageCoverage?: TemporalLineageCoverage;
}

export interface ITemporalStore {
	isOpen(): boolean;
	open(): Promise<void>;
	close(): Promise<void>;
	/** Abort an in-flight SQLite operation. No-op if the connection is closed. */
	interrupt?(): void | Promise<void>;
	/** True while a write transaction (or equivalent) is executing against this store. */
	hasActiveWrite?(): boolean;

	// Repository identity
	setRepositoryIdentity(identity: RepositoryIdentityRecord): Promise<void>;
	getRepositoryIdentity(): Promise<RepositoryIdentityRecord | undefined>;

	// Atomic commit ingestion transaction
	saveCommitIngestion(
		commit: TemporalCommitRecord,
		snapshot: TemporalGraphSnapshot,
		delta?: TemporalStructuralDelta,
		lineageEvents?: readonly TemporalEntityLineageEvent[],
		token?: CancellationTokenLike
	): Promise<void>;

	// Commit & DAG queries
	getCommit(commitSha: string): Promise<TemporalCommitRecord | undefined>;
	getAllCommits(): Promise<TemporalCommitRecord[]>;
	getLatestCommit(): Promise<TemporalCommitRecord | undefined>;
	/** Returns persisted canonical coverage without reconstructing a graph state. */
	getCommitCoverage(commitSha: string): Promise<CanonicalCoverage | undefined>;
	getCommitLineageCoverage(commitSha: string): Promise<TemporalLineageCoverage | undefined>;
	/** Batched metadata-only lookup for timeline rows; never reconstructs graph payloads. */
	getCommitIndexMetadata(commitShas: readonly string[]): Promise<TemporalCommitIndexMetadata[]>;
	getCommitParents(commitSha: string): Promise<string[]>;
	getCommitChildren(commitSha: string): Promise<string[]>;

	// Snapshot, State & Delta queries
	getCheckpointSnapshot(commitSha: string): Promise<TemporalGraphSnapshot | undefined>;
	getStructuralDelta(commitSha: string): Promise<TemporalStructuralDelta | undefined>;
	getGraphStateByDigest(digest: string): Promise<{ stateId: string; canonicalDigest: string; snapshotJson: string } | undefined>;

	// Entity and Edge queries
	getEntity(entityId: string): Promise<TemporalEntity | undefined>;
	getEntityHistory(entityId: string): Promise<TemporalEntitySnapshot[]>;
	/** All-parent DAG-reachable records, ordered by persisted commit time. */
	getEntityHistoryReachableFrom(entityId: string, targetCommitSha: string): Promise<TemporalEntitySnapshot[]>;
	getEntityLineageEvents(entityId: string): Promise<TemporalEntityLineageEvent[]>;
	getEntityLineageEventsReachableFrom(entityId: string, targetCommitSha: string): Promise<TemporalEntityLineageEvent[]>;
	/** Returns entity snapshots persisted at this commit (transitions or full checkpoint). Reconstruct canonical state for full active entity query. */
	getEntitySnapshotsAtCommit(commitSha: string): Promise<TemporalEntitySnapshot[]>;
	getDeletedPathsInHistory(baseCommitSha: string): Promise<Map<string, string>>;
	getEdge(edgeId: string): Promise<TemporalEdgeRecord | undefined>;
	getEdgeHistory(edgeId: string): Promise<TemporalEdgeSnapshot[]>;
	getEdgeHistoryReachableFrom(edgeId: string, targetCommitSha: string): Promise<TemporalEdgeSnapshot[]>;
	getEdgeLifecycleEventsReachableFrom(edgeId: string, targetCommitSha: string): Promise<import('../../common/temporalTypes.js').TemporalEdgeLifecycleEvent[]>;

	// Refs
	saveRef(ref: RefRecord): Promise<void>;
	replaceRefs(refs: readonly RefRecord[]): Promise<void>;
	getRef(refName: string): Promise<RefRecord | undefined>;
	getAllRefs(): Promise<RefRecord[]>;

	// Blob analysis cache
	getBlobAnalysis(
		blobOid: string,
		analyzerVersion: number,
		profileVersion: number,
		language: string
	): Promise<BlobAnalysisRecord | undefined>;
	saveBlobAnalysis(record: BlobAnalysisRecord): Promise<void>;
	/** Evicts only regenerable parse artifacts; canonical states and reconstruction chains are never deleted. */
	runMaintenance(maxDatabaseBytes: number): Promise<TemporalStoreMaintenanceResult>;

	// Maintenance
	vacuum(): Promise<void>;
	clear(): Promise<void>;
}

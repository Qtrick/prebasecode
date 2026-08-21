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
} from '../../common/temporalTypes.js';

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

export interface ITemporalStore {
	isOpen(): boolean;
	open(): Promise<void>;
	close(): Promise<void>;

	// Repository identity
	setRepositoryIdentity(identity: RepositoryIdentityRecord): Promise<void>;
	getRepositoryIdentity(): Promise<RepositoryIdentityRecord | undefined>;

	// Atomic commit ingestion transaction
	saveCommitIngestion(
		commit: TemporalCommitRecord,
		snapshot: TemporalGraphSnapshot,
		delta?: TemporalStructuralDelta,
		lineageEvents?: readonly TemporalEntityLineageEvent[]
	): Promise<void>;

	// Commit & DAG queries
	getCommit(commitSha: string): Promise<TemporalCommitRecord | undefined>;
	getAllCommits(): Promise<TemporalCommitRecord[]>;
	getLatestCommit(): Promise<TemporalCommitRecord | undefined>;
	getCommitParents(commitSha: string): Promise<string[]>;
	getCommitChildren(commitSha: string): Promise<string[]>;

	// Snapshot, State & Delta queries
	getCheckpointSnapshot(commitSha: string): Promise<TemporalGraphSnapshot | undefined>;
	getStructuralDelta(commitSha: string): Promise<TemporalStructuralDelta | undefined>;
	getGraphStateByDigest(digest: string): Promise<{ stateId: string; canonicalDigest: string; snapshotJson: string } | undefined>;

	// Entity and Edge queries
	getEntity(entityId: string): Promise<TemporalEntity | undefined>;
	getEntityHistory(entityId: string): Promise<TemporalEntitySnapshot[]>;
	getEntityLineageEvents(entityId: string): Promise<TemporalEntityLineageEvent[]>;
	getActiveEntitiesAtCommit(commitSha: string): Promise<TemporalEntitySnapshot[]>;
	getDeletedPathsInHistory(baseCommitSha: string): Promise<Map<string, string>>;
	getEdge(edgeId: string): Promise<TemporalEdgeRecord | undefined>;
	getEdgeHistory(edgeId: string): Promise<TemporalEdgeSnapshot[]>;

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

	// Maintenance
	vacuum(): Promise<void>;
	clear(): Promise<void>;
}

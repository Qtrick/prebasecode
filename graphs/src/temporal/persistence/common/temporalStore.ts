/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	BlobAnalysisRecord,
	TemporalCommitRecord,
	TemporalEdgeRecord,
	TemporalEntity,
	TemporalEntityLineageEvent,
	TemporalEntitySnapshot,
	TemporalGraphSnapshot,
	TemporalStructuralDelta,
} from '../../common/temporalTypes.js';

export interface ITemporalStore {
	isOpen(): boolean;
	open(): Promise<void>;
	close(): Promise<void>;

	// Atomic commit ingestion transaction
	saveCommitIngestion(
		commit: TemporalCommitRecord,
		snapshot: TemporalGraphSnapshot,
		delta?: TemporalStructuralDelta,
		lineageEvents?: readonly TemporalEntityLineageEvent[]
	): Promise<void>;

	// Commit metadata queries
	getCommit(commitSha: string): Promise<TemporalCommitRecord | undefined>;
	getAllCommits(): Promise<TemporalCommitRecord[]>;
	getLatestCommit(): Promise<TemporalCommitRecord | undefined>;

	// Snapshot and Delta queries
	getCheckpointSnapshot(commitSha: string): Promise<TemporalGraphSnapshot | undefined>;
	getStructuralDelta(commitSha: string): Promise<TemporalStructuralDelta | undefined>;

	// Entity and Edge queries
	getEntity(entityId: string): Promise<TemporalEntity | undefined>;
	getEntityHistory(entityId: string): Promise<TemporalEntitySnapshot[]>;
	getEntityLineageEvents(entityId: string): Promise<TemporalEntityLineageEvent[]>;
	getActiveEntitiesAtCommit(commitSha: string): Promise<TemporalEntitySnapshot[]>;
	getEdge(edgeId: string): Promise<TemporalEdgeRecord | undefined>;

	// Blob analysis cache
	getBlobAnalysis(
		blobOid: string,
		analyzerVersion: number,
		profileVersion: number,
		language: string
	): Promise<BlobAnalysisRecord | undefined>;
	saveBlobAnalysis(record: BlobAnalysisRecord): Promise<void>;

	// Transaction support
	runInTransaction<T>(operation: () => Promise<T>): Promise<T>;

	// Maintenance
	vacuum(): Promise<void>;
	clear(): Promise<void>;
}

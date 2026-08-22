/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IChannel } from '../../../../../../base/parts/ipc/common/ipc.js';
import { ProxyChannel } from '../../../../../../base/parts/ipc/common/ipc.js';
import type { ITemporalStore } from '../../temporal/persistence/common/temporalStore.js';
import type { CanonicalCoverage } from '../../common/types/canonicalTypes.js';
import { deserializeTemporalStoreValue, serializeTemporalStoreValue, type ITemporalStoreMainService, type TemporalStoreIpcResponse } from '../../temporal/persistence/common/temporalStoreChannel.js';
import { TemporalError } from '../../temporal/common/temporalErrors.js';
import type {
	BlobAnalysisRecord,
	TemporalCommitRecord,
	TemporalEdgeRecord,
	TemporalEdgeSnapshot,
	TemporalEntity,
	TemporalEntityLineageEvent,
	TemporalEntitySnapshot,
	TemporalGraphSnapshot,
	TemporalLineageCoverage,
	TemporalStructuralDelta,
} from '../../temporal/common/temporalTypes.js';
import type { RefRecord, RepositoryIdentityRecord, TemporalCommitIndexMetadata, TemporalStoreMaintenanceResult } from '../../temporal/persistence/common/temporalStore.js';

export class WorkbenchTemporalStore implements ITemporalStore {
	private readonly _main: ITemporalStoreMainService;
	private _isOpen = false;

	constructor(channel: IChannel, private readonly _dbPath: string) {
		this._main = ProxyChannel.toService<ITemporalStoreMainService>(channel);
	}

	isOpen(): boolean { return this._isOpen; }
	async open(): Promise<void> { await this._unwrap(this._main.open(this._dbPath)); this._isOpen = true; }
	async close(): Promise<void> { if (this._isOpen) { await this._unwrap(this._main.close(this._dbPath)); this._isOpen = false; } }

	private async _unwrap<T>(responsePromise: Promise<string>): Promise<T> {
		const response = deserializeTemporalStoreValue<TemporalStoreIpcResponse>(await responsePromise);
		if (!response.ok) {
			throw new TemporalError(response.error.code, response.error.message);
		}
		const value = deserializeTemporalStoreValue<T | null>(response.value);
		return (value === null ? undefined : value) as T;
	}

	private _call<T>(method: keyof ITemporalStore, ...args: readonly unknown[]): Promise<T> {
		return this._unwrap<T>(this._main.invoke(this._dbPath, method, serializeTemporalStoreValue(args)));
	}

	setRepositoryIdentity(identity: RepositoryIdentityRecord): Promise<void> { return this._call('setRepositoryIdentity', identity); }
	getRepositoryIdentity(): Promise<RepositoryIdentityRecord | undefined> { return this._call('getRepositoryIdentity'); }
	saveCommitIngestion(commit: TemporalCommitRecord, snapshot: TemporalGraphSnapshot, delta?: TemporalStructuralDelta, lineageEvents?: readonly TemporalEntityLineageEvent[]): Promise<void> { return this._call('saveCommitIngestion', commit, snapshot, delta, lineageEvents); }
	getCommit(commitSha: string): Promise<TemporalCommitRecord | undefined> { return this._call('getCommit', commitSha); }
	getAllCommits(): Promise<TemporalCommitRecord[]> { return this._call('getAllCommits'); }
	getLatestCommit(): Promise<TemporalCommitRecord | undefined> { return this._call('getLatestCommit'); }
	getCommitCoverage(commitSha: string): Promise<CanonicalCoverage | undefined> { return this._call('getCommitCoverage', commitSha); }
	getCommitLineageCoverage(commitSha: string): Promise<TemporalLineageCoverage | undefined> { return this._call('getCommitLineageCoverage', commitSha); }
	getCommitIndexMetadata(commitShas: readonly string[]): Promise<TemporalCommitIndexMetadata[]> { return this._call('getCommitIndexMetadata', commitShas); }
	getCommitParents(commitSha: string): Promise<string[]> { return this._call('getCommitParents', commitSha); }
	getCommitChildren(commitSha: string): Promise<string[]> { return this._call('getCommitChildren', commitSha); }
	getCheckpointSnapshot(commitSha: string): Promise<TemporalGraphSnapshot | undefined> { return this._call('getCheckpointSnapshot', commitSha); }
	getStructuralDelta(commitSha: string): Promise<TemporalStructuralDelta | undefined> { return this._call('getStructuralDelta', commitSha); }
	getGraphStateByDigest(digest: string): Promise<{ stateId: string; canonicalDigest: string; snapshotJson: string } | undefined> { return this._call('getGraphStateByDigest', digest); }
	getEntity(entityId: string): Promise<TemporalEntity | undefined> { return this._call('getEntity', entityId); }
	getEntityHistory(entityId: string): Promise<TemporalEntitySnapshot[]> { return this._call('getEntityHistory', entityId); }
	getEntityHistoryReachableFrom(entityId: string, targetCommitSha: string): Promise<TemporalEntitySnapshot[]> { return this._call('getEntityHistoryReachableFrom', entityId, targetCommitSha); }
	getEntityLineageEvents(entityId: string): Promise<TemporalEntityLineageEvent[]> { return this._call('getEntityLineageEvents', entityId); }
	getEntityLineageEventsReachableFrom(entityId: string, targetCommitSha: string): Promise<TemporalEntityLineageEvent[]> { return this._call('getEntityLineageEventsReachableFrom', entityId, targetCommitSha); }
	getEntitySnapshotsAtCommit(commitSha: string): Promise<TemporalEntitySnapshot[]> { return this._call('getEntitySnapshotsAtCommit', commitSha); }
	getDeletedPathsInHistory(baseCommitSha: string): Promise<Map<string, string>> { return this._call('getDeletedPathsInHistory', baseCommitSha); }
	getEdge(edgeId: string): Promise<TemporalEdgeRecord | undefined> { return this._call('getEdge', edgeId); }
	getEdgeHistory(edgeId: string): Promise<TemporalEdgeSnapshot[]> { return this._call('getEdgeHistory', edgeId); }
	getEdgeHistoryReachableFrom(edgeId: string, targetCommitSha: string): Promise<TemporalEdgeSnapshot[]> { return this._call('getEdgeHistoryReachableFrom', edgeId, targetCommitSha); }
	getEdgeLifecycleEventsReachableFrom(edgeId: string, targetCommitSha: string): Promise<import('../../temporal/common/temporalTypes.js').TemporalEdgeLifecycleEvent[]> { return this._call('getEdgeLifecycleEventsReachableFrom', edgeId, targetCommitSha); }
	saveRef(ref: RefRecord): Promise<void> { return this._call('saveRef', ref); }
	replaceRefs(refs: readonly RefRecord[]): Promise<void> { return this._call('replaceRefs', refs); }
	getRef(refName: string): Promise<RefRecord | undefined> { return this._call('getRef', refName); }
	getAllRefs(): Promise<RefRecord[]> { return this._call('getAllRefs'); }
	getBlobAnalysis(blobOid: string, analyzerVersion: number, profileVersion: number, language: string): Promise<BlobAnalysisRecord | undefined> { return this._call('getBlobAnalysis', blobOid, analyzerVersion, profileVersion, language); }
	saveBlobAnalysis(record: BlobAnalysisRecord): Promise<void> { return this._call('saveBlobAnalysis', record); }
	runMaintenance(maxDatabaseBytes: number): Promise<TemporalStoreMaintenanceResult> { return this._call('runMaintenance', maxDatabaseBytes); }
	vacuum(): Promise<void> { return this._call('vacuum'); }
	clear(): Promise<void> { return this._call('clear'); }
}

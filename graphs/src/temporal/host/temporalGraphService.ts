/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { GitHeadChangeEvent, IGitHistoryService } from '../../history/git/gitHistoryService.js';
import { GitHistoryError } from '../../history/git/gitTypes.js';
import { isTemporalError, TemporalError } from '../common/temporalErrors.js';
import type { TemporalCommitIngestionService } from '../ingestion/temporalCommitIngestionService.js';
import type { TemporalRepositoryRegistry } from '../ingestion/temporalRepositoryRegistry.js';
import type {
	TemporalCommitIndexStatus,
	TemporalCommitSummary,
	TemporalEdgeLifecycleEvent,
	TemporalEntityLineageEvent,
	TemporalEdgeSnapshot,
	TemporalEntitySnapshot,
	TemporalGraphSnapshot,
	TemporalHistoryPage,
	TemporalHistoryPageOptions,
	TemporalMaintenanceResult,
	TemporalQueryOptions,
	TemporalRepositoryRef,
} from '../common/temporalTypes.js';

export type { TemporalCommitIndexStatus, TemporalIndexStatus } from '../common/temporalTypes.js';

export interface ITemporalGraphService {
	getCommitIndexStatus(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalCommitIndexStatus>;
	getRepositoryRefs(rootPath: string, token?: CancellationTokenLike): Promise<TemporalRepositoryRef[]>;
	getHistoryPage(rootPath: string, options?: TemporalHistoryPageOptions, token?: CancellationTokenLike): Promise<TemporalHistoryPage>;
	runMaintenance(rootPath: string, maxDatabaseBytes: number, token?: CancellationTokenLike): Promise<TemporalMaintenanceResult>;
	ensureCommitIndexed(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot>;
	getGraphAtCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot>;
	getEntityHistory(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntitySnapshot[]>;
	getEntityHistoryAtRef(rootPath: string, entityId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEntitySnapshot[]>;
	getEntityLineageEvents(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]>;
	getEntityLineageEventsAtRef(rootPath: string, entityId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]>;
	getEdgeHistory(rootPath: string, edgeId: string, token?: CancellationTokenLike): Promise<TemporalEdgeSnapshot[]>;
	getEdgeHistoryAtRef(rootPath: string, edgeId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEdgeSnapshot[]>;
	getEdgeLifecycleEvents(rootPath: string, edgeId: string, token?: CancellationTokenLike): Promise<TemporalEdgeLifecycleEvent[]>;
	getEdgeLifecycleEventsAtRef(rootPath: string, edgeId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEdgeLifecycleEvent[]>;
	queryTemporalGraph(rootPath: string, options: TemporalQueryOptions, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot[]>;
	ingestCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot>;
	ingestCommitRange(rootPath: string, commitShas: string[], token?: CancellationTokenLike): Promise<void>;
	handleHeadChanged(event: GitHeadChangeEvent, rootPath: string): Promise<void>;
	dispose(): Promise<void>;
}

export class TemporalGraphService implements ITemporalGraphService {
	private static readonly REF_REFRESH_MAX_AGE_MS = 30_000;
	private readonly _gitService: IGitHistoryService;
	private readonly _registry: TemporalRepositoryRegistry;

	constructor(
		gitService: IGitHistoryService,
		registry: TemporalRepositoryRegistry,
		// Retained temporarily for source compatibility with Phase 2 callers.
		// Runtime-owned ingestion is the sole production authority.
		_ingestionService?: TemporalCommitIngestionService
	) {
		this._gitService = gitService;
		this._registry = registry;
	}

	async getCommitIndexStatus(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalCommitIndexStatus> {
		if (token?.isCancellationRequested) {
			return { status: 'cancelled' };
		}
		try {
			const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
			const store = await this._registry.getStore(identity.repositoryId, rootPath);
			const runtime = await this._registry.getRuntime(identity.repositoryId, rootPath, this._gitService);
			const runtimeStatus = runtime.getIndexStatus(commitSha);
			if (runtimeStatus && runtimeStatus !== 'ready' && runtimeStatus !== 'incomplete') {
				return { status: runtimeStatus };
			}
			const commit = await store.getCommit(commitSha);
			if (!commit) {
				return { status: 'not-indexed' };
			}

			// Runtime status is intentionally ephemeral. Read the coverage attached to
			// this commit's canonical state without reconstructing graph payloads for
			// every timeline status row after a workbench restart.
			const coverage = await store.getCommitCoverage(commitSha);
			const lineageCoverage = typeof store.getCommitLineageCoverage === 'function'
				? await store.getCommitLineageCoverage(commitSha)
				: commit.lineageCoverage ?? { kind: 'complete' as const };
			if (!coverage) {
				return { status: 'failed', diagnosticCode: 'database-corrupted' };
			}
			if (!lineageCoverage) {
				return { status: 'failed', diagnosticCode: 'database-corrupted' };
			}
			return {
				status: coverage.completeWithinProfile ? 'ready' : 'incomplete',
				lineageCoverage,
			};
		} catch (error) {
			return this._toFailedIndexStatus(error);
		}
	}

	async ensureCommitIndexed(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot> {
		if (token?.isCancellationRequested) {
			return this.ingestCommit(rootPath, commitSha, token);
		}
		const status = await this.getCommitIndexStatus(rootPath, commitSha, token);
		if ((status.status === 'ready' || status.status === 'incomplete') && status.lineageCoverage?.kind !== 'partial') {
			return this.getGraphAtCommit(rootPath, commitSha, token);
		}
		return this.ingestCommit(rootPath, commitSha, token);
	}

	async getRepositoryRefs(rootPath: string, token?: CancellationTokenLike): Promise<TemporalRepositoryRef[]> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const runtime = await this._registry.getRuntime(identity.repositoryId, rootPath, this._gitService);
		if (token?.isCancellationRequested) {
			throw new GitHistoryError('Cancelled', 'Repository ref request was cancelled');
		}
		let refs = await runtime.store.getAllRefs();
		const newestObservation = refs.reduce((newest, ref) => Math.max(newest, ref.lastObserved), 0);
		if (refs.length === 0 || Date.now() - newestObservation > TemporalGraphService.REF_REFRESH_MAX_AGE_MS) {
			await runtime.refreshRefs();
			refs = await runtime.store.getAllRefs();
		}
		return refs.map(ref => ({
			name: ref.refName,
			targetSha: ref.targetSha,
			kind: ref.refType === 'symbolic-head' || ref.refType === 'detached-head'
				? 'head'
				: ref.refType === 'remote-branch'
					? 'remote-branch'
					: ref.refType === 'annotated-tag'
						? 'annotated-tag'
						: ref.refType === 'tag' ? 'tag' : 'branch',
			isDetached: ref.refType === 'detached-head' ? true : undefined,
		}));
	}

	async getHistoryPage(rootPath: string, options: TemporalHistoryPageOptions = {}, token?: CancellationTokenLike): Promise<TemporalHistoryPage> {
		const pageSize = Math.min(250, Math.max(1, options.pageSize ?? 50));
		const cursor = options.cursor ? this._parseHistoryCursor(options.cursor) : undefined;
		const ref = cursor?.refSha ?? await this._gitService.resolveRef(rootPath, options.ref ?? 'HEAD', token);
		const skip = cursor?.skip ?? 0;
		const history = await this._gitService.log(rootPath, { ref, firstParent: true, skip, limit: pageSize + 1 }, token);
		if (token?.isCancellationRequested) {
			throw new GitHistoryError('Cancelled', 'Temporal history request was cancelled');
		}
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		const runtime = await this._registry.getRuntime(identity.repositoryId, rootPath, this._gitService);
		const page = history.slice(0, pageSize);
		const metadataBySha = new Map((await store.getCommitIndexMetadata(page.map(commit => commit.sha))).map(metadata => [metadata.commitSha, metadata]));
		const commits: TemporalCommitSummary[] = page.map(commit => {
			const runtimeStatus = runtime.getIndexStatus(commit.sha);
			const metadata = metadataBySha.get(commit.sha);
			const coverage = metadata?.coverage;
			const indexStatus: TemporalCommitIndexStatus = runtimeStatus && runtimeStatus !== 'ready' && runtimeStatus !== 'incomplete'
				? { status: runtimeStatus }
				: !metadata
					? { status: 'not-indexed' }
					: !coverage || !metadata.lineageCoverage
						? { status: 'failed', diagnosticCode: 'database-corrupted' as const }
						: {
							status: coverage.completeWithinProfile ? 'ready' as const : 'incomplete' as const,
							lineageCoverage: metadata.lineageCoverage,
						};
			return {
				sha: commit.sha,
				parents: commit.parents,
				authorName: commit.author.name,
				authorEmail: commit.author.email,
				authorTimestamp: commit.authorTimestamp,
				committerTimestamp: commit.committerTimestamp,
				message: commit.message,
				indexStatus,
			};
		});
		const hasMore = history.length > pageSize;
		return { commits, hasMore, nextCursor: hasMore ? this._makeHistoryCursor(ref, skip + pageSize) : undefined };
	}

	async runMaintenance(rootPath: string, maxDatabaseBytes: number, token?: CancellationTokenLike): Promise<TemporalMaintenanceResult> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		if (token?.isCancellationRequested) {
			throw new GitHistoryError('Cancelled', 'Temporal maintenance was cancelled');
		}
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		return store.runMaintenance(maxDatabaseBytes);
	}

	async getGraphAtCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const runtime = await this._registry.getRuntime(identity.repositoryId, rootPath, this._gitService);
		try {
			return await runtime.ingestionService.reconstructGraphAtCommit(rootPath, commitSha, token);
		} catch (error) {
			// A corruption recovery replaces the derived database with an empty store.
			// Retry the user request through bounded ingestion rather than leaking a
			// misleading missing-checkpoint error. If the commit row still exists, the
			// reconstruction chain itself is malformed and must continue to fail closed.
			if (error instanceof TemporalError && error.code === 'CheckpointNotFound' && !(await runtime.store.getCommit(commitSha))) {
				return runtime.ingestCommit(commitSha, {}, token);
			}
			throw error;
		}
	}

	async getEntityHistory(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntitySnapshot[]> {
		const head = await this._gitService.getHead(rootPath, token);
		return this.getEntityHistoryAtRef(rootPath, entityId, head, token);
	}

	async getEntityHistoryAtRef(rootPath: string, entityId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEntitySnapshot[]> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		return store.getEntityHistoryReachableFrom(entityId, await this._gitService.resolveRef(rootPath, targetRef, token));
	}

	async getEntityLineageEvents(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]> {
		const head = await this._gitService.getHead(rootPath, token);
		return this.getEntityLineageEventsAtRef(rootPath, entityId, head, token);
	}

	async getEntityLineageEventsAtRef(rootPath: string, entityId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		return store.getEntityLineageEventsReachableFrom(entityId, await this._gitService.resolveRef(rootPath, targetRef, token));
	}

	async getEdgeHistory(rootPath: string, edgeId: string, token?: CancellationTokenLike): Promise<TemporalEdgeSnapshot[]> {
		const head = await this._gitService.getHead(rootPath, token);
		return this.getEdgeHistoryAtRef(rootPath, edgeId, head, token);
	}

	async getEdgeHistoryAtRef(rootPath: string, edgeId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEdgeSnapshot[]> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		return store.getEdgeHistoryReachableFrom(edgeId, await this._gitService.resolveRef(rootPath, targetRef, token));
	}

	async getEdgeLifecycleEvents(rootPath: string, edgeId: string, token?: CancellationTokenLike): Promise<TemporalEdgeLifecycleEvent[]> {
		return this.getEdgeLifecycleEventsAtRef(rootPath, edgeId, await this._gitService.getHead(rootPath, token), token);
	}

	async getEdgeLifecycleEventsAtRef(rootPath: string, edgeId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEdgeLifecycleEvent[]> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		return store.getEdgeLifecycleEventsReachableFrom(edgeId, await this._gitService.resolveRef(rootPath, targetRef, token));
	}

	private _makeHistoryCursor(refSha: string, skip: number): string {
		return `${refSha}:${skip}`;
	}

	private _parseHistoryCursor(cursor: string): { refSha: string; skip: number } {
		const separator = cursor.lastIndexOf(':');
		const refSha = separator > 0 ? cursor.slice(0, separator) : '';
		const skip = Number.parseInt(separator > 0 ? cursor.slice(separator + 1) : '', 10);
		if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(refSha) || !Number.isSafeInteger(skip) || skip < 0) {
			throw new GitHistoryError('ParseFailure', 'Invalid Temporal history cursor');
		}
		return { refSha, skip };
	}

	private _toFailedIndexStatus(error: unknown): TemporalCommitIndexStatus {
		if (isTemporalError(error)) {
			switch (error.code) {
				case 'Cancelled':
					return { status: 'cancelled' };
				case 'RepositoryNotFound':
					return { status: 'unregistered', diagnosticCode: 'repository-unavailable' };
				case 'DatabaseCorrupted':
				case 'DeltaReconstructionFailed':
				case 'CheckpointNotFound':
					return { status: 'failed', diagnosticCode: 'database-corrupted' };
				case 'SchemaMigrationFailed':
					return { status: 'failed', diagnosticCode: 'schema-migration-failed' };
				default:
					return { status: 'failed', diagnosticCode: 'runtime-failure' };
			}
		}
		if (error instanceof GitHistoryError) {
			switch (error.code) {
				case 'Cancelled':
					return { status: 'cancelled' };
				case 'RepositoryUnavailable':
				case 'RepositoryNotFound':
					return { status: 'unregistered', diagnosticCode: 'repository-unavailable' };
				case 'Timeout':
				case 'HistoryIncomplete':
					return { status: 'failed', diagnosticCode: 'history-unavailable' };
				default:
					return { status: 'failed', diagnosticCode: 'git-error' };
			}
		}
		return { status: 'failed', diagnosticCode: 'runtime-failure' };
	}

	async queryTemporalGraph(rootPath: string, options: TemporalQueryOptions, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot[]> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		const runtime = await this._registry.getRuntime(identity.repositoryId, rootPath, this._gitService);
		const toCommitSha = options.toCommitSha ?? await this._gitService.getHead(rootPath, token);
		const history = await this._gitService.log(rootPath, {
			ref: toCommitSha,
			firstParent: true,
			// This legacy graph-materializing API is intentionally bounded. Phase-3
			// timeline consumers use getHistoryPage() and reconstruct only selection.
			limit: Math.max(1, options.limit ?? 50),
		}, token);
		let filtered = (await Promise.all(history.map(commit => store.getCommit(commit.sha))))
			.filter((commit): commit is NonNullable<typeof commit> => Boolean(commit))
			.reverse();
		if (options.fromCommitSha) {
			const idx = filtered.findIndex(c => c.commitSha === options.fromCommitSha);
			filtered = idx >= 0 ? filtered.slice(idx) : [];
		}
		if (options.limit && options.limit > 0) {
			filtered = filtered.slice(Math.max(0, filtered.length - options.limit));
		}

		const results: TemporalGraphSnapshot[] = [];
		for (const commit of filtered) {
			if (token?.isCancellationRequested) break;
			const snap = await runtime.ingestionService.reconstructGraphAtCommit(rootPath, commit.commitSha, token);
			results.push(snap);
		}

		return results;
	}

	async ingestCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const runtime = await this._registry.getRuntime(identity.repositoryId, rootPath, this._gitService);

		return runtime.ingestCommit(commitSha, {}, token);
	}

	async ingestCommitRange(rootPath: string, commitShas: string[], token?: CancellationTokenLike): Promise<void> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const runtime = await this._registry.getRuntime(identity.repositoryId, rootPath, this._gitService);

		for (const sha of commitShas) {
			if (token?.isCancellationRequested) break;
			await runtime.ingestCommit(sha, {}, token);
		}
	}

	async handleHeadChanged(event: GitHeadChangeEvent, rootPath: string): Promise<void> {
		if (!event.currentHead) {
			return;
		}

		const identity = await this._gitService.getRepositoryIdentity(rootPath);
		// Match event repositoryId to target repository
		if (event.repositoryId && event.repositoryId !== identity.repositoryId && event.repositoryId !== rootPath) {
			return;
		}
		const runtime = await this._registry.getRuntime(identity.repositoryId, rootPath, this._gitService);
		await runtime.ingestCommit(event.currentHead, { isExplicitHead: true });
	}

	async handleRegisteredRepositoryHeadChanged(event: GitHeadChangeEvent): Promise<void> {
		if (!event.currentHead) {
			return;
		}
		const runtime = this._registry.getExistingRuntime(event.repositoryId);
		if (!runtime) {
			return;
		}
		await runtime.ingestCommit(event.currentHead, { isExplicitHead: true });
		await runtime.refreshRefs(event.currentHead);
	}

	async dispose(): Promise<void> {
		await this._registry.dispose();
	}
}

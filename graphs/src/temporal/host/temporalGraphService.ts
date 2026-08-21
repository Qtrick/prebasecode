/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { GitHeadChangeEvent, IGitHistoryService } from '../../history/git/gitHistoryService.js';
import { GitHistoryError } from '../../history/git/gitTypes.js';
import { isTemporalError } from '../common/temporalErrors.js';
import type { TemporalCommitIngestionService } from '../ingestion/temporalCommitIngestionService.js';
import type { TemporalRepositoryRegistry } from '../ingestion/temporalRepositoryRegistry.js';
import type {
	TemporalEntityLineageEvent,
	TemporalEdgeSnapshot,
	TemporalEntitySnapshot,
	TemporalGraphSnapshot,
	TemporalQueryOptions,
	TemporalCommitIndexStatus,
} from '../common/temporalTypes.js';

export type { TemporalCommitIndexStatus, TemporalIndexStatus } from '../common/temporalTypes.js';

export interface ITemporalGraphService {
	getCommitIndexStatus(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalCommitIndexStatus>;
	ensureCommitIndexed(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot>;
	getGraphAtCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot>;
	getEntityHistory(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntitySnapshot[]>;
	getEntityHistoryAtRef(rootPath: string, entityId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEntitySnapshot[]>;
	getEntityLineageEvents(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]>;
	getEntityLineageEventsAtRef(rootPath: string, entityId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]>;
	getEdgeHistory(rootPath: string, edgeId: string, token?: CancellationTokenLike): Promise<TemporalEdgeSnapshot[]>;
	getEdgeHistoryAtRef(rootPath: string, edgeId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEdgeSnapshot[]>;
	queryTemporalGraph(rootPath: string, options: TemporalQueryOptions, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot[]>;
	ingestCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot>;
	ingestCommitRange(rootPath: string, commitShas: string[], token?: CancellationTokenLike): Promise<void>;
	handleHeadChanged(event: GitHeadChangeEvent, rootPath: string): Promise<void>;
	dispose(): Promise<void>;
}

export class TemporalGraphService implements ITemporalGraphService {
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
		try {
			const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
			const store = await this._registry.getStore(identity.repositoryId, rootPath);
			const runtime = await this._registry.getRuntime(identity.repositoryId, rootPath, this._gitService);
			const runtimeStatus = runtime.getIndexStatus(commitSha);
			if (runtimeStatus) {
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
			if (!coverage) {
				return { status: 'failed', diagnosticCode: 'database-corrupted' };
			}
			return {
				status: coverage.completeWithinProfile ? 'ready' : 'incomplete',
			};
		} catch (error) {
			return this._toFailedIndexStatus(error);
		}
	}

	async ensureCommitIndexed(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot> {
		const status = await this.getCommitIndexStatus(rootPath, commitSha, token);
		if (status.status === 'ready' || status.status === 'incomplete') {
			return this.getGraphAtCommit(rootPath, commitSha, token);
		}
		return this.ingestCommit(rootPath, commitSha, token);
	}

	async getGraphAtCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const runtime = await this._registry.getRuntime(identity.repositoryId, rootPath, this._gitService);
		return runtime.ingestionService.reconstructGraphAtCommit(rootPath, commitSha, token);
	}

	async getEntityHistory(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntitySnapshot[]> {
		const head = await this._gitService.getHead(rootPath, token);
		return this.getEntityHistoryAtRef(rootPath, entityId, head, token);
	}

	async getEntityHistoryAtRef(rootPath: string, entityId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEntitySnapshot[]> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		return this._scopeHistoryToRef(rootPath, targetRef, await store.getEntityHistory(entityId), token);
	}

	async getEntityLineageEvents(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]> {
		const head = await this._gitService.getHead(rootPath, token);
		return this.getEntityLineageEventsAtRef(rootPath, entityId, head, token);
	}

	async getEntityLineageEventsAtRef(rootPath: string, entityId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		return this._scopeHistoryToRef(rootPath, targetRef, await store.getEntityLineageEvents(entityId), token);
	}

	async getEdgeHistory(rootPath: string, edgeId: string, token?: CancellationTokenLike): Promise<TemporalEdgeSnapshot[]> {
		const head = await this._gitService.getHead(rootPath, token);
		return this.getEdgeHistoryAtRef(rootPath, edgeId, head, token);
	}

	async getEdgeHistoryAtRef(rootPath: string, edgeId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEdgeSnapshot[]> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		return this._scopeHistoryToRef(rootPath, targetRef, await store.getEdgeHistory(edgeId), token);
	}

	private async _scopeHistoryToRef<T extends { readonly commitSha: string }>(rootPath: string, targetRef: string, records: readonly T[], token?: CancellationTokenLike): Promise<T[]> {
		const targetSha = await this._gitService.resolveRef(rootPath, targetRef, token);
		const history = await this._gitService.log(rootPath, { ref: targetSha }, token);
		const order = new Map(history.slice().reverse().map((commit, index) => [commit.sha, index]));
		return records
			.filter(record => order.has(record.commitSha))
			.sort((first, second) => order.get(first.commitSha)! - order.get(second.commitSha)!);
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
			limit: Math.max(options.limit ?? 0, 10_000),
		}, token);
		const commitsBySha = new Map((await store.getAllCommits()).map(commit => [commit.commitSha, commit]));
		let filtered = history
			.map(commit => commitsBySha.get(commit.sha))
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

		return runtime.queueIngestion(commitSha, async () => {
			return runtime.ingestionService.ingestCommit(rootPath, commitSha, {}, token);
		});
	}

	async ingestCommitRange(rootPath: string, commitShas: string[], token?: CancellationTokenLike): Promise<void> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const runtime = await this._registry.getRuntime(identity.repositoryId, rootPath, this._gitService);

		for (const sha of commitShas) {
			if (token?.isCancellationRequested) break;
			await runtime.queueIngestion(sha, async () => {
				return runtime.ingestionService.ingestCommit(rootPath, sha, {}, token);
			});
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
		await runtime.queueIngestion(event.currentHead, async () => {
			return runtime.ingestionService.ingestCommit(rootPath, event.currentHead!, { isExplicitHead: true });
		});
	}

	async handleRegisteredRepositoryHeadChanged(event: GitHeadChangeEvent): Promise<void> {
		if (!event.currentHead) {
			return;
		}
		const runtime = this._registry.getExistingRuntime(event.repositoryId);
		if (!runtime) {
			return;
		}
		await runtime.queueIngestion(event.currentHead, async () => {
			return runtime.ingestionService.ingestCommit(runtime.rootPath, event.currentHead!, { isExplicitHead: true });
		});
		await runtime.refreshRefs(event.currentHead);
	}

	async dispose(): Promise<void> {
		await this._registry.dispose();
	}
}

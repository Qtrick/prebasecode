/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IGitHistoryService } from '../../history/git/gitHistoryService.js';
import type { ITemporalStore } from '../persistence/common/temporalStore.js';
import { BlobAnalysisCache, TwoTierParseArtifactCache } from '../analysis/blobAnalysisCache.js';
import { IncrementalGraphAnalyzer } from '../analysis/incrementalGraphAnalyzer.js';
import { TemporalCommitIngestionService, type ITemporalStoreProvider } from './temporalCommitIngestionService.js';
import { TemporalReconstructionEngine } from '../core/temporalReconstruction.js';
import { TemporalIndexPlanner } from '../core/temporalIndexPlanner.js';
import { TemporalError } from '../common/temporalErrors.js';
import type { ICanonicalParseService } from '../../core/canonical/canonicalParseService.js';
import {
	CURRENT_ANALYZER_VERSION,
	CURRENT_PROFILE_VERSION,
} from '../common/temporalVersioning.js';
import type { TemporalGraphSnapshot, TemporalIndexStatus } from '../common/temporalTypes.js';

import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';

export class IngestionSequencer {
	private _current: Promise<unknown> = Promise.resolve();
	private _isDisposed = false;
	private _activeCts: { cancel(): void; isCancellationRequested: boolean } | undefined;
	private readonly _pendingQueue: Array<{ reject: (err: Error) => void }> = [];

	queue<T>(promiseFactory: (token: CancellationTokenLike) => Promise<T>, callerToken?: CancellationTokenLike): Promise<T> {
		if (this._isDisposed) {
			return Promise.reject(new TemporalError('Cancelled', 'Ingestion sequencer is disposed'));
		}
		if (callerToken?.isCancellationRequested) {
			return Promise.reject(new TemporalError('Cancelled', 'Ingestion request was cancelled before execution'));
		}

		return new Promise<T>((resolve, reject) => {
			const item = { reject };
			this._pendingQueue.push(item);

			const run = async () => {
				const queueIndex = this._pendingQueue.indexOf(item);
				if (queueIndex !== -1) {
					this._pendingQueue.splice(queueIndex, 1);
				}

				if (this._isDisposed) {
					throw new TemporalError('Cancelled', 'Ingestion sequencer is disposed');
				}
				if (callerToken?.isCancellationRequested) {
					throw new TemporalError('Cancelled', 'Ingestion request was cancelled before execution');
				}

				let cancelled = false;
				const listeners = new Set<() => void>();
				const token: CancellationTokenLike = {
					get isCancellationRequested() {
						return cancelled || Boolean(callerToken?.isCancellationRequested);
					},
					onCancellationRequested(listener: () => void) {
						listeners.add(listener);
						const sub = callerToken?.onCancellationRequested?.(listener);
						return {
							dispose: () => {
								listeners.delete(listener);
								sub?.dispose();
							}
						};
					}
				};

				const cts = {
					get isCancellationRequested() {
						return token.isCancellationRequested;
					},
					cancel: () => {
						if (!cancelled) {
							cancelled = true;
							for (const listener of Array.from(listeners)) {
								try {
									listener();
								} catch {
									// ignore listener errors
								}
							}
						}
					}
				};

				this._activeCts = cts;
				try {
					const result = await promiseFactory(token);
					resolve(result);
					return result;
				} catch (error) {
					reject(error);
					throw error;
				} finally {
					if (this._activeCts === cts) {
						this._activeCts = undefined;
					}
				}
			};

			const next = this._current.then(run, run);
			this._current = next.catch(() => {});
		});
	}

	async dispose(timeoutMs: number = 2000): Promise<void> {
		this._isDisposed = true;
		this._activeCts?.cancel();
		while (this._pendingQueue.length > 0) {
			const pending = this._pendingQueue.shift();
			pending?.reject(new TemporalError('Cancelled', 'Ingestion sequencer was disposed'));
		}
		await Promise.race([
			this._current,
			new Promise<void>(res => setTimeout(res, timeoutMs))
		]);
	}
}

export class TemporalRepositoryRuntime {
	readonly repositoryId: string;
	readonly rootPath: string;
	readonly store: ITemporalStore;
	readonly parseCache: TwoTierParseArtifactCache;
	readonly analyzer: IncrementalGraphAnalyzer;
	readonly ingestionService: TemporalCommitIngestionService;

	private readonly _sequencer = new IngestionSequencer();
	private readonly _gitService: IGitHistoryService;
	private readonly _inFlightBySha = new Map<string, Promise<TemporalGraphSnapshot>>();
	private readonly _statusBySha = new Map<string, TemporalIndexStatus>();
	private _isDisposed = false;
	private _disposePromise: Promise<void> | undefined;

	constructor(
		repositoryId: string,
		rootPath: string,
		store: ITemporalStore,
		gitService: IGitHistoryService,
		parseService?: ICanonicalParseService,
		reconstructionEngine?: TemporalReconstructionEngine,
		indexPlanner?: TemporalIndexPlanner
	) {
		this.repositoryId = repositoryId;
		this.rootPath = rootPath;
		this.store = store;
		this._gitService = gitService;

		const l1 = new BlobAnalysisCache(10_000, CURRENT_ANALYZER_VERSION, CURRENT_PROFILE_VERSION);
		this.parseCache = new TwoTierParseArtifactCache(l1, store, CURRENT_ANALYZER_VERSION, CURRENT_PROFILE_VERSION);
		this.analyzer = new IncrementalGraphAnalyzer({ parseArtifactCache: this.parseCache, parseService });

		const storeProvider: ITemporalStoreProvider = {
			getStore: async () => this.store,
		};

		this.ingestionService = new TemporalCommitIngestionService(
			gitService,
			storeProvider,
			this.analyzer,
			reconstructionEngine,
			indexPlanner
		);
	}

	queueIngestion(commitSha: string, task: (token: CancellationTokenLike) => Promise<TemporalGraphSnapshot>, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot> {
		if (this._isDisposed) {
			return Promise.reject(new TemporalError('Cancelled', `Repository runtime '${this.repositoryId}' is disposed`));
		}
		if (token?.isCancellationRequested) {
			return Promise.reject(new TemporalError('Cancelled', `Ingestion of '${commitSha}' was cancelled`));
		}

		const existing = this._inFlightBySha.get(commitSha);
		if (existing) {
			return existing;
		}

		this._statusBySha.set(commitSha, 'queued');
		const queued = this._sequencer.queue(async (combinedToken) => {
			if (this._isDisposed || combinedToken.isCancellationRequested) {
				throw new TemporalError('Cancelled', `Repository runtime '${this.repositoryId}' is disposed or cancelled`);
			}
			this._statusBySha.set(commitSha, 'indexing');
			const snapshot = await task(combinedToken);
			this._statusBySha.set(commitSha, snapshot.canonicalSnapshot?.coverage.completeWithinProfile === false ? 'incomplete' : 'ready');
			return snapshot;
		}, token);

		this._inFlightBySha.set(commitSha, queued);
		void queued.then(() => {
			this._inFlightBySha.delete(commitSha);
		}, error => {
			this._inFlightBySha.delete(commitSha);
			this._statusBySha.set(commitSha, error instanceof TemporalError && error.code === 'Cancelled' ? 'cancelled' : 'failed');
		});

		return queued;
	}

	hasInFlightIngestion(commitSha: string): boolean {
		return this._inFlightBySha.has(commitSha);
	}

	getIndexStatus(commitSha: string): TemporalIndexStatus | undefined {
		return this._statusBySha.get(commitSha);
	}

	async refreshRefs(headSha?: string): Promise<void> {
		const observedAt = Date.now();
		const identity = await this._gitService.getRepositoryIdentity(this.rootPath);
		const resolvedHead = headSha ?? (!identity.isUnborn ? await this._gitService.getHead(this.rootPath) : undefined);
		const refs = [];
		if (resolvedHead) {
			refs.push({ refName: 'HEAD', targetSha: resolvedHead, refType: identity.headBranch ? 'symbolic-head' : 'detached-head', lastObserved: observedAt });
		}
		const [branches, tags] = await Promise.all([
			this._gitService.listBranches(this.rootPath),
			this._gitService.listTags(this.rootPath),
		]);
		for (const branch of branches) {
			const prefix = branch.isRemote ? 'refs/remotes/' : 'refs/heads/';
			refs.push({ refName: `${prefix}${branch.name}`, targetSha: branch.commit, refType: branch.isRemote ? 'remote-branch' : 'branch', lastObserved: observedAt });
		}
		for (const tag of tags) {
			refs.push({ refName: `refs/tags/${tag.name}`, targetSha: tag.peeledCommit ?? tag.tagCommit, refType: tag.isAnnotated ? 'annotated-tag' : 'tag', lastObserved: observedAt });
		}
		await this.store.replaceRefs(refs);
	}

	dispose(timeoutMs: number = 2500): Promise<void> {
		if (!this._disposePromise) {
			this._disposePromise = this._disposeOnce(timeoutMs);
		}
		return this._disposePromise;
	}

	private async _disposeOnce(timeoutMs: number): Promise<void> {
		this._isDisposed = true;
		await this._sequencer.dispose(timeoutMs);
		this._inFlightBySha.clear();
		this._statusBySha.clear();
		await Promise.race([
			this.store.close(),
			new Promise<void>(res => setTimeout(res, 1000))
		]);
	}
}

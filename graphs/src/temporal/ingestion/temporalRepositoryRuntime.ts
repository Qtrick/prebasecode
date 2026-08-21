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

export class IngestionSequencer {
	private _current: Promise<unknown> = Promise.resolve();
	private _isDisposed = false;

	queue<T>(promiseFactory: () => Promise<T>): Promise<T> {
		if (this._isDisposed) {
			return Promise.reject(new TemporalError('Cancelled', 'Ingestion sequencer is disposed'));
		}
		const res = this._current.then(
			() => promiseFactory(),
			() => promiseFactory()
		);
		this._current = res.catch(() => {});
		return res;
	}

	async dispose(): Promise<void> {
		this._isDisposed = true;
		await this._current;
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

	queueIngestion(commitSha: string, task: () => Promise<TemporalGraphSnapshot>): Promise<TemporalGraphSnapshot> {
		if (this._isDisposed) {
			return Promise.reject(new TemporalError('Cancelled', `Repository runtime '${this.repositoryId}' is disposed`));
		}

		const existing = this._inFlightBySha.get(commitSha);
		if (existing) {
			return existing;
		}

		this._statusBySha.set(commitSha, 'queued');
		const queued = this._sequencer.queue(async () => {
			if (this._isDisposed) {
				throw new TemporalError('Cancelled', `Repository runtime '${this.repositoryId}' is disposed`);
			}
			this._statusBySha.set(commitSha, 'indexing');
			const snapshot = await task();
			this._statusBySha.set(commitSha, snapshot.canonicalSnapshot?.coverage.completeWithinProfile === false ? 'incomplete' : 'ready');
			return snapshot;
		});

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

	dispose(): Promise<void> {
		if (!this._disposePromise) {
			this._disposePromise = this._disposeOnce();
		}
		return this._disposePromise;
	}

	private async _disposeOnce(): Promise<void> {
		this._isDisposed = true;
		await this._sequencer.dispose();
		this._inFlightBySha.clear();
		this._statusBySha.clear();
		await this.store.close();
	}
}

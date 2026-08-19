/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IGitHistoryService } from '../../history/git/gitHistoryService.js';
import type { ITemporalStore } from '../persistence/common/temporalStore.js';
import { BlobAnalysisCache, TwoTierParseArtifactCache } from '../analysis/blobAnalysisCache.js';
import { IncrementalGraphAnalyzer } from '../analysis/incrementalGraphAnalyzer.js';
import { TemporalCommitIngestionService } from './temporalCommitIngestionService.js';
import { TemporalReconstructionEngine } from '../core/temporalReconstruction.js';
import { TemporalIndexPlanner } from '../core/temporalIndexPlanner.js';
import { TemporalError } from '../common/temporalErrors.js';
import {
	CURRENT_ANALYZER_VERSION,
	CURRENT_PROFILE_VERSION,
} from '../common/temporalVersioning.js';
import type { TemporalGraphSnapshot } from '../common/temporalTypes.js';

export class IngestionSequencer {
	private _current: Promise<unknown> = Promise.resolve();

	queue<T>(promiseFactory: () => Promise<T>): Promise<T> {
		const res = this._current.then(
			() => promiseFactory(),
			() => promiseFactory()
		);
		this._current = res.catch(() => {});
		return res;
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
	private readonly _inFlightBySha = new Map<string, Promise<TemporalGraphSnapshot>>();
	private _isDisposed = false;

	constructor(
		repositoryId: string,
		rootPath: string,
		store: ITemporalStore,
		gitService: IGitHistoryService,
		reconstructionEngine?: TemporalReconstructionEngine,
		indexPlanner?: TemporalIndexPlanner
	) {
		this.repositoryId = repositoryId;
		this.rootPath = rootPath;
		this.store = store;

		const l1 = new BlobAnalysisCache(10_000, CURRENT_ANALYZER_VERSION, CURRENT_PROFILE_VERSION);
		this.parseCache = new TwoTierParseArtifactCache(l1, store, CURRENT_ANALYZER_VERSION, CURRENT_PROFILE_VERSION);
		this.analyzer = new IncrementalGraphAnalyzer({ parseArtifactCache: this.parseCache });

		const runtimeRegistry = {
			getStore: async () => this.store,
			hasStore: () => true,
			closeStore: async () => {},
			closeAll: async () => {},
			dispose: async () => {},
		} as any;

		this.ingestionService = new TemporalCommitIngestionService(
			gitService,
			runtimeRegistry,
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

		const queued = this._sequencer.queue(async () => {
			if (this._isDisposed) {
				throw new TemporalError('Cancelled', `Repository runtime '${this.repositoryId}' is disposed`);
			}
			return task();
		});

		this._inFlightBySha.set(commitSha, queued);
		queued.finally(() => {
			this._inFlightBySha.delete(commitSha);
		});

		return queued;
	}

	async dispose(): Promise<void> {
		this._isDisposed = true;
		this._inFlightBySha.clear();
		await this.store.close();
	}
}

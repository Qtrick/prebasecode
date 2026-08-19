/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { GitHeadChangeEvent, IGitHistoryService } from '../../history/git/gitHistoryService.js';
import type { TemporalCommitIngestionService } from '../ingestion/temporalCommitIngestionService.js';
import type { TemporalRepositoryRegistry } from '../ingestion/temporalRepositoryRegistry.js';
import type {
	TemporalEntityLineageEvent,
	TemporalEntitySnapshot,
	TemporalGraphSnapshot,
	TemporalQueryOptions,
} from '../common/temporalTypes.js';

export interface ITemporalGraphService {
	getGraphAtCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot>;
	getEntityHistory(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntitySnapshot[]>;
	getEntityLineageEvents(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]>;
	queryTemporalGraph(rootPath: string, options: TemporalQueryOptions, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot[]>;
	ingestCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot>;
	ingestCommitRange(rootPath: string, commitShas: string[], token?: CancellationTokenLike): Promise<void>;
	handleHeadChanged(event: GitHeadChangeEvent, rootPath: string): Promise<void>;
}

export class TemporalGraphService implements ITemporalGraphService {
	private readonly _gitService: IGitHistoryService;
	private readonly _registry: TemporalRepositoryRegistry;
	private readonly _ingestionService: TemporalCommitIngestionService;

	constructor(
		gitService: IGitHistoryService,
		registry: TemporalRepositoryRegistry,
		ingestionService: TemporalCommitIngestionService
	) {
		this._gitService = gitService;
		this._registry = registry;
		this._ingestionService = ingestionService;
	}

	async getGraphAtCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot> {
		return this._ingestionService.reconstructGraphAtCommit(rootPath, commitSha, token);
	}

	async getEntityHistory(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntitySnapshot[]> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		return store.getEntityHistory(entityId);
	}

	async getEntityLineageEvents(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		return store.getEntityLineageEvents(entityId);
	}

	async queryTemporalGraph(rootPath: string, options: TemporalQueryOptions, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot[]> {
		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);
		const allCommits = await store.getAllCommits();

		let filtered = allCommits;
		if (options.fromCommitSha) {
			const idx = filtered.findIndex(c => c.commitSha === options.fromCommitSha);
			if (idx >= 0) filtered = filtered.slice(idx);
		}
		if (options.toCommitSha) {
			const idx = filtered.findIndex(c => c.commitSha === options.toCommitSha);
			if (idx >= 0) filtered = filtered.slice(0, idx + 1);
		}
		if (options.limit && options.limit > 0) {
			filtered = filtered.slice(0, options.limit);
		}

		const results: TemporalGraphSnapshot[] = [];
		for (const commit of filtered) {
			if (token?.isCancellationRequested) break;
			const snap = await this._ingestionService.reconstructGraphAtCommit(rootPath, commit.commitSha, token);
			results.push(snap);
		}

		return results;
	}

	async ingestCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot> {
		return this._ingestionService.ingestCommit(rootPath, commitSha, {}, token);
	}

	async ingestCommitRange(rootPath: string, commitShas: string[], token?: CancellationTokenLike): Promise<void> {
		return this._ingestionService.ingestCommitRange(rootPath, commitShas, token);
	}

	async handleHeadChanged(event: GitHeadChangeEvent, rootPath: string): Promise<void> {
		if (event.currentHead) {
			await this._ingestionService.ingestCommit(rootPath, event.currentHead, { isExplicitHead: true });
		}
	}
}

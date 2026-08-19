/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { IGitHistoryService } from '../../history/git/gitHistoryService.js';
import { GitTreeContentSource } from '../../history/git/gitTreeContentSource.js';
import { TemporalError } from '../common/temporalErrors.js';
import {
	CURRENT_ANALYZER_VERSION,
	CURRENT_PROFILE_VERSION,
	CURRENT_SCHEMA_VERSION,
	DEFAULT_CHECKPOINT_INTERVAL,
} from '../common/temporalVersioning.js';
import { IncrementalGraphAnalyzer } from '../analysis/incrementalGraphAnalyzer.js';
import { TemporalReconstructionEngine } from '../core/temporalReconstruction.js';
import { TemporalIndexPlanner } from '../core/temporalIndexPlanner.js';
import { TemporalRepositoryRegistry } from './temporalRepositoryRegistry.js';
import type {
	TemporalCommitRecord,
	TemporalGraphSnapshot,
} from '../common/temporalTypes.js';

export interface IngestCommitOptions {
	readonly isExplicitHead?: boolean;
	readonly forceCheckpoint?: boolean;
}

export class TemporalCommitIngestionService {
	private readonly _gitService: IGitHistoryService;
	private readonly _registry: TemporalRepositoryRegistry;
	private readonly _analyzer: IncrementalGraphAnalyzer;
	private readonly _reconstructionEngine: TemporalReconstructionEngine;
	private readonly _indexPlanner: TemporalIndexPlanner;

	constructor(
		gitService: IGitHistoryService,
		registry: TemporalRepositoryRegistry,
		analyzer: IncrementalGraphAnalyzer = new IncrementalGraphAnalyzer(),
		reconstructionEngine: TemporalReconstructionEngine = new TemporalReconstructionEngine(),
		indexPlanner: TemporalIndexPlanner = new TemporalIndexPlanner()
	) {
		this._gitService = gitService;
		this._registry = registry;
		this._analyzer = analyzer;
		this._reconstructionEngine = reconstructionEngine;
		this._indexPlanner = indexPlanner;
	}

	async ingestCommit(
		rootPath: string,
		commitSha: string,
		options: IngestCommitOptions = {},
		token?: CancellationTokenLike
	): Promise<TemporalGraphSnapshot> {
		if (token?.isCancellationRequested) {
			throw new TemporalError('Cancelled', 'Ingestion cancelled');
		}

		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const repoId = identity.repositoryId;
		const store = await this._registry.getStore(repoId, rootPath);

		// Check if already ingested
		const existingRecord = await store.getCommit(commitSha);
		if (existingRecord) {
			return this.reconstructGraphAtCommit(rootPath, commitSha, token);
		}

		// Read commit metadata from Git
		const commitMeta = await this._gitService.getCommit(rootPath, commitSha, token);
		const allCommits = await store.getAllCommits();
		const commitIndex = allCommits.length;
		const isRoot = commitMeta.parents.length === 0;
		const isCheckpoint = Boolean(
			options.forceCheckpoint ||
			this._indexPlanner.shouldCreateCheckpoint(commitIndex, isRoot, Boolean(options.isExplicitHead))
		);

		// Get parent snapshot if exists
		let parentSnapshot: TemporalGraphSnapshot | undefined;
		let diffChanges: any[] = [];
		if (commitMeta.parents.length > 0) {
			const primaryParentSha = commitMeta.parents[0];
			try {
				parentSnapshot = await this.reconstructGraphAtCommit(rootPath, primaryParentSha, token);
				const diffRes = await this._gitService.diffCommitToParent(rootPath, commitSha, 0, token);
				diffChanges = diffRes.changes as any[];
			} catch {
				// Fallback to full parse if parent cannot be reconstructed
				parentSnapshot = undefined;
			}
		}

		// Run Incremental Analysis
		const contentSource = new GitTreeContentSource(this._gitService, rootPath, commitSha);
		const analysisOutput = await this._analyzer.analyzeCommit({
			commitSha,
			contentSource,
			diffChanges,
			parentSnapshot,
			isCheckpoint,
			token,
		});

		const commitRecord: TemporalCommitRecord = {
			commitSha,
			parentShas: commitMeta.parents,
			treeSha: commitMeta.treeSha || '',
			authorName: commitMeta.author?.name || '',
			authorEmail: commitMeta.author?.email || '',
			authorTimestamp: commitMeta.authorTimestamp || 0,
			committerTimestamp: commitMeta.committerTimestamp || 0,
			message: commitMeta.message || '',
			ingestedAt: Date.now(),
			isCheckpoint,
			checkpointInterval: DEFAULT_CHECKPOINT_INTERVAL,
			schemaVersion: CURRENT_SCHEMA_VERSION,
			analyzerVersion: CURRENT_ANALYZER_VERSION,
			profileVersion: CURRENT_PROFILE_VERSION,
		};

		// Save atomically into SQLite Store
		await store.saveCommitIngestion(
			commitRecord,
			analysisOutput.snapshot,
			analysisOutput.delta,
			analysisOutput.lineageEvents
		);

		return analysisOutput.snapshot;
	}

	async reconstructGraphAtCommit(
		rootPath: string,
		commitSha: string,
		token?: CancellationTokenLike
	): Promise<TemporalGraphSnapshot> {
		if (token?.isCancellationRequested) {
			throw new TemporalError('Cancelled', 'Reconstruction cancelled');
		}

		const identity = await this._gitService.getRepositoryIdentity(rootPath, token);
		const store = await this._registry.getStore(identity.repositoryId, rootPath);

		// 1. Check if direct checkpoint exists
		const directCheckpoint = await store.getCheckpointSnapshot(commitSha);
		if (directCheckpoint) {
			return directCheckpoint;
		}

		// 2. Plan reconstruction traversal
		const allCommits = await store.getAllCommits();
		const plan = this._indexPlanner.planReconstruction(commitSha, allCommits);

		if (!plan.baseCheckpointSha) {
			throw new TemporalError(
				'CheckpointNotFound',
				`No base checkpoint or delta chain found to reconstruct commit '${commitSha}'`
			);
		}

		const baseCheckpoint = await store.getCheckpointSnapshot(plan.baseCheckpointSha);
		if (!baseCheckpoint) {
			throw new TemporalError(
				'CheckpointNotFound',
				`Base checkpoint '${plan.baseCheckpointSha}' not found in store`
			);
		}

		// 3. Load all deltas in order
		const deltas: any[] = [];
		for (const deltaSha of plan.deltaShas) {
			const delta = await store.getStructuralDelta(deltaSha);
			if (!delta) {
				throw new TemporalError(
					'DeltaReconstructionFailed',
					`Structural delta for commit '${deltaSha}' is missing in store`
				);
			}
			deltas.push(delta);
		}

		// 4. Reconstruct snapshot
		return this._reconstructionEngine.reconstruct(baseCheckpoint, deltas, commitSha);
	}

	async ingestCommitRange(
		rootPath: string,
		commitShasInOrder: string[],
		token?: CancellationTokenLike
	): Promise<void> {
		for (let i = 0; i < commitShasInOrder.length; i++) {
			if (token?.isCancellationRequested) {
				break;
			}
			const sha = commitShasInOrder[i];
			const isExplicitHead = i === commitShasInOrder.length - 1;
			await this.ingestCommit(rootPath, sha, { isExplicitHead }, token);
		}
	}
}

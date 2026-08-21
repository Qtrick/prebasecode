/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { IGitHistoryService } from '../../history/git/gitHistoryService.js';
import type { GitExactDiffChange } from '../../history/git/gitTypes.js';
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
import type { ITemporalStore } from '../persistence/common/temporalStore.js';
import type {
	TemporalCommitRecord,
	TemporalGraphSnapshot,
} from '../common/temporalTypes.js';

const MAX_RECONSTRUCTION_DEPTH = DEFAULT_CHECKPOINT_INTERVAL * 2;

export interface IngestCommitOptions {
	readonly isExplicitHead?: boolean;
	readonly forceCheckpoint?: boolean;
	/** Internal: replace an isolated checkpoint once its parent segment is available. */
	readonly reconcileExisting?: boolean;
}

export interface ITemporalStoreProvider {
	getStore(repositoryId: string, rootPath: string): Promise<ITemporalStore>;
}

export class TemporalCommitIngestionService {
	private readonly _gitService: IGitHistoryService;
	private readonly _registry: ITemporalStoreProvider;
	private readonly _analyzer: IncrementalGraphAnalyzer;
	private readonly _reconstructionEngine: TemporalReconstructionEngine;
	private readonly _indexPlanner: TemporalIndexPlanner;

	constructor(
		gitService: IGitHistoryService,
		registry: ITemporalStoreProvider,
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

		// Record repository identity
		await store.setRepositoryIdentity({
			repoId,
			rootPath,
			commonGitDir: identity.commonGitDir,
			objectFormat: identity.objectFormat || (commitSha.length === 64 ? 'sha256' : 'sha1'),
			createdAt: Date.now(),
		});

		// Check if already ingested
		const existingRecord = await store.getCommit(commitSha);
		if (existingRecord && !options.reconcileExisting) {
			const parentSha = existingRecord.parentShas[0];
			if (existingRecord.lineageCoverage?.kind === 'partial' && parentSha && await store.getCommit(parentSha)) {
				return this.ingestCommit(rootPath, commitSha, { ...options, reconcileExisting: true }, token);
			}
			return this.reconstructGraphAtCommit(rootPath, commitSha, token);
		}

		// Read commit metadata from Git
		const commitMeta = await this._gitService.getCommit(rootPath, commitSha, token);
		const isRoot = commitMeta.parents.length === 0;

		// Calculate depth only from an already-indexed parent. A selection must
		// never recursively analyze history back to the repository root.
		let deltaDepth = 0;
		let parentSnapshot: TemporalGraphSnapshot | undefined;
		let lineageCoverage: TemporalCommitRecord['lineageCoverage'] = { kind: 'complete' };
		if (commitMeta.parents.length > 0) {
			const parentSha = commitMeta.parents[0];
			const parent = await store.getCommit(parentSha);
			deltaDepth = parent?.isCheckpoint ? 1 : (parent?.deltaDepth ?? 0) + 1;
			if (parent) {
				parentSnapshot = await this.reconstructGraphAtCommit(rootPath, parentSha, token);
				lineageCoverage = parent.lineageCoverage ?? { kind: 'complete' };
			} else {
				lineageCoverage = { kind: 'partial', unknownBeforeCommitSha: commitSha };
			}
		}

		const isCheckpoint = Boolean(
			options.forceCheckpoint ||
			!parentSnapshot ||
			this._indexPlanner.shouldCreateCheckpoint(deltaDepth, isRoot, Boolean(options.isExplicitHead))
		);

		let diffChanges: readonly GitExactDiffChange[] = [];
		if (parentSnapshot) {
			const diffRes = await this._gitService.diffCommitToParent(rootPath, commitSha, 0, token);
			diffChanges = diffRes.changes;
		}

		// Read prior deleted paths in history for robust CASE 8 fresh recreation
		const deletedPathsInHistory = parentSnapshot
			? await store.getDeletedPathsInHistory(commitMeta.parents[0])
			: new Map<string, string>();

		// Run Incremental Analysis backed by persistent L2 store
		const contentSource = new GitTreeContentSource(this._gitService, rootPath, commitSha);
		const analysisOutput = await this._analyzer.analyzeCommit({
			commitSha,
			contentSource,
			diffChanges,
			parentSnapshot,
			isCheckpoint,
			token,
			deletedPathsInHistory,
		});

		const canonicalDigest = analysisOutput.snapshot.digest || analysisOutput.snapshot.canonicalSnapshot?.digest;

		const commitRecord: TemporalCommitRecord = {
			commitSha,
			canonicalDigest,
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
			deltaDepth: isCheckpoint ? 0 : deltaDepth,
			baseCommitSha: isCheckpoint ? undefined : commitMeta.parents[0] || undefined,
			lineageCoverage,
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

		// 2. Follow the persisted delta-base chain. This bounded lookup avoids an
		// O(repository history) commit-table scan for every reconstruction.
		const targetCommit = await store.getCommit(commitSha);
		let current = targetCommit;
		const backwardsDeltas: string[] = [];
		const visited = new Set<string>();
		let baseCheckpointSha: string | undefined;
		while (current && !visited.has(current.commitSha) && backwardsDeltas.length <= MAX_RECONSTRUCTION_DEPTH) {
			visited.add(current.commitSha);
			if (current.isCheckpoint) {
				baseCheckpointSha = current.commitSha;
				break;
			}
			backwardsDeltas.push(current.commitSha);
			const base = current.baseCommitSha ?? current.parentShas[0];
			current = base ? await store.getCommit(base) : undefined;
		}
		if (backwardsDeltas.length > MAX_RECONSTRUCTION_DEPTH || (current && visited.has(current.commitSha) && !current.isCheckpoint)) {
			throw new TemporalError('DatabaseCorrupted', `Temporal reconstruction chain for '${commitSha}' is cyclic or exceeds its policy bound`);
		}
		const plan = { baseCheckpointSha, deltaShas: backwardsDeltas.reverse() };

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

		// 4. Reconstruct snapshot and verify digest
		const reconstructed = this._reconstructionEngine.reconstruct(baseCheckpoint, deltas, commitSha);
		if (targetCommit?.canonicalDigest && reconstructed.digest && reconstructed.digest !== targetCommit.canonicalDigest) {
			throw new TemporalError(
				'DatabaseCorrupted',
				`Reconstructed snapshot digest mismatch for ${commitSha}: expected ${targetCommit.canonicalDigest}, got ${reconstructed.digest}`
			);
		}

		return reconstructed;
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DEFAULT_CHECKPOINT_INTERVAL } from '../common/temporalVersioning.js';
import type { TemporalCommitRecord, TemporalReconstructionPlan } from '../common/temporalTypes.js';

export interface IndexPlannerOptions {
	readonly checkpointInterval?: number;
	readonly maxDeltaDepth?: number;
}

export class TemporalIndexPlanner {
	private readonly _checkpointInterval: number;
	private readonly _maxDeltaDepth: number;

	constructor(options: IndexPlannerOptions = {}) {
		this._checkpointInterval = options.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL;
		this._maxDeltaDepth = options.maxDeltaDepth ?? DEFAULT_CHECKPOINT_INTERVAL * 2;
	}

	/**
	 * Determines whether a commit should be indexed as a full checkpoint.
	 * Bounded delta depth policy: root commits are always checkpoints; commits exceeding delta depth are checkpoints.
	 */
	shouldCreateCheckpoint(currentDeltaDepth: number, isRoot: boolean, isExplicitHead: boolean): boolean {
		if (isRoot) {
			return true;
		}
		if (currentDeltaDepth >= this._checkpointInterval || currentDeltaDepth >= this._maxDeltaDepth) {
			return true;
		}
		// If explicit head and delta depth is significant (e.g. >= 5), take a checkpoint for snappy HEAD queries
		if (isExplicitHead && currentDeltaDepth >= 5) {
			return true;
		}
		return false;
	}

	/**
	 * Plans the optimal reconstruction path from the nearest preceding checkpoint to targetCommitSha along true DAG ancestry.
	 */
	planDagReconstruction(
		targetCommitSha: string,
		commitsBySha: ReadonlyMap<string, TemporalCommitRecord>
	): TemporalReconstructionPlan {
		const targetRecord = commitsBySha.get(targetCommitSha);
		if (!targetRecord) {
			return {
				targetCommitSha,
				deltaShas: [],
				totalDeltas: 0,
				isDirectCheckpoint: false,
			};
		}

		if (targetRecord.isCheckpoint) {
			return {
				targetCommitSha,
				baseCheckpointSha: targetCommitSha,
				deltaShas: [],
				totalDeltas: 0,
				isDirectCheckpoint: true,
			};
		}

		// Traverse backwards along the exact delta base lineage to find the base checkpoint
		let currentSha: string | undefined = targetCommitSha;
		const chain: string[] = [];
		const visited = new Set<string>();

		while (currentSha && !visited.has(currentSha)) {
			visited.add(currentSha);
			const record = commitsBySha.get(currentSha);
			if (!record) {
				break;
			}

			if (record.isCheckpoint) {
				return {
					targetCommitSha,
					baseCheckpointSha: currentSha,
					deltaShas: chain.reverse(),
					totalDeltas: chain.length,
					isDirectCheckpoint: chain.length === 0,
				};
			}

			chain.push(currentSha);
			currentSha = record.baseCommitSha || (record.parentShas && record.parentShas[0]) || undefined;
		}

		// Fallback if disconnected
		return {
			targetCommitSha,
			deltaShas: [],
			totalDeltas: 0,
			isDirectCheckpoint: false,
		};
	}

	/**
	 * Linear topological fallback planReconstruction.
	 */
	planReconstruction(
		targetCommitSha: string,
		allCommitsInTopologicalOrder: readonly TemporalCommitRecord[]
	): TemporalReconstructionPlan {
		const targetIndex = allCommitsInTopologicalOrder.findIndex(c => c.commitSha === targetCommitSha);
		if (targetIndex < 0) {
			return {
				targetCommitSha,
				deltaShas: [],
				totalDeltas: 0,
				isDirectCheckpoint: false,
			};
		}

		const targetRecord = allCommitsInTopologicalOrder[targetIndex];
		if (targetRecord.isCheckpoint) {
			return {
				targetCommitSha,
				baseCheckpointSha: targetCommitSha,
				deltaShas: [],
				totalDeltas: 0,
				isDirectCheckpoint: true,
			};
		}

		// Search backwards for the nearest checkpoint
		let checkpointIndex = -1;
		for (let i = targetIndex - 1; i >= 0; i--) {
			if (allCommitsInTopologicalOrder[i].isCheckpoint) {
				checkpointIndex = i;
				break;
			}
		}

		if (checkpointIndex < 0) {
			const deltaShas = allCommitsInTopologicalOrder.slice(0, targetIndex + 1).map(c => c.commitSha);
			return {
				targetCommitSha,
				deltaShas,
				totalDeltas: deltaShas.length,
				isDirectCheckpoint: false,
			};
		}

		const baseCheckpointSha = allCommitsInTopologicalOrder[checkpointIndex].commitSha;
		const deltaShas = allCommitsInTopologicalOrder.slice(checkpointIndex + 1, targetIndex + 1).map(c => c.commitSha);

		return {
			targetCommitSha,
			baseCheckpointSha,
			deltaShas,
			totalDeltas: deltaShas.length,
			isDirectCheckpoint: false,
		};
	}
}

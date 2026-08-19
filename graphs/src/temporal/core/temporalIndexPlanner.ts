/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DEFAULT_CHECKPOINT_INTERVAL } from '../common/temporalVersioning.js';
import type { TemporalCommitRecord, TemporalReconstructionPlan } from '../common/temporalTypes.js';

export interface IndexPlannerOptions {
	readonly checkpointInterval?: number;
}

export class TemporalIndexPlanner {
	private readonly _checkpointInterval: number;

	constructor(options: IndexPlannerOptions = {}) {
		this._checkpointInterval = options.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL;
	}

	/**
	 * Determines whether a commit should be indexed as a full checkpoint.
	 */
	shouldCreateCheckpoint(commitIndex: number, isRoot: boolean, isExplicitHead: boolean): boolean {
		if (isRoot || isExplicitHead) {
			return true;
		}
		return commitIndex % this._checkpointInterval === 0;
	}

	/**
	 * Plans the optimal reconstruction path from the nearest preceding checkpoint to targetCommitSha.
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
			// No preceding checkpoint found; replay all deltas from root
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

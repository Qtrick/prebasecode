/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { TemporalError } from '../common/temporalErrors.js';
import { TemporalDeltaEngine } from './temporalDelta.js';
import type {
	TemporalGraphSnapshot,
	TemporalStructuralDelta,
} from '../common/temporalTypes.js';

export class TemporalReconstructionEngine {
	private readonly _deltaEngine: TemporalDeltaEngine;

	constructor(deltaEngine: TemporalDeltaEngine = new TemporalDeltaEngine()) {
		this._deltaEngine = deltaEngine;
	}

	/**
	 * Deterministically reconstructs a full graph snapshot at a target commit
	 * by replaying an ordered chain of forward deltas onto a base checkpoint snapshot.
	 */
	reconstruct(
		baseCheckpoint: TemporalGraphSnapshot,
		orderedDeltas: readonly TemporalStructuralDelta[],
		targetCommitSha: string
	): TemporalGraphSnapshot {
		let currentSnapshot = baseCheckpoint;

		for (let i = 0; i < orderedDeltas.length; i++) {
			const delta = orderedDeltas[i];

			if (delta.parentCommitSha && delta.parentCommitSha !== currentSnapshot.commitSha) {
				throw new TemporalError(
					'DeltaReconstructionFailed',
					`Delta chain discontinuity at step ${i}: delta parent '${delta.parentCommitSha}' does not match current state '${currentSnapshot.commitSha}'`
				);
			}

			const isTarget = delta.commitSha === targetCommitSha;
			currentSnapshot = this._deltaEngine.applyDelta(currentSnapshot, delta, isTarget);
		}

		if (currentSnapshot.commitSha !== targetCommitSha) {
			throw new TemporalError(
				'DeltaReconstructionFailed',
				`Reconstructed snapshot commit '${currentSnapshot.commitSha}' does not match target commit '${targetCommitSha}'`
			);
		}

		return currentSnapshot;
	}
}

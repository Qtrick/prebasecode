/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type TemporalErrorCode =
	| 'StoreNotOpen'
	| 'StoreAlreadyOpen'
	| 'DatabaseCorrupted'
	| 'SchemaMigrationFailed'
	| 'CommitNotFound'
	| 'CheckpointNotFound'
	| 'DeltaReconstructionFailed'
	| 'LineageAmbiguity'
	| 'InvalidVersion'
	| 'BlobAnalysisFailed'
	| 'IngestionFailed'
	| 'RepositoryNotFound'
	| 'Cancelled'
	| 'Timeout'
	| 'StorageLimitExceeded';

export class TemporalError extends Error {
	readonly code: TemporalErrorCode;
	override readonly cause?: unknown;

	constructor(code: TemporalErrorCode, message: string, cause?: unknown) {
		super(`[Temporal:${code}] ${message}`);
		this.name = 'TemporalError';
		this.code = code;
		this.cause = cause;
		Object.setPrototypeOf(this, TemporalError.prototype);
	}
}

export function isTemporalError(error: unknown): error is TemporalError {
	return error instanceof TemporalError;
}

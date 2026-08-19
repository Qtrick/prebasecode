/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { TemporalError } from './temporalErrors.js';

export const CURRENT_SCHEMA_VERSION = 1;
export const CURRENT_ANALYZER_VERSION = 1;
export const CURRENT_PROFILE_VERSION = 1;
export const CURRENT_DELTA_VERSION = 1;

/** Default interval between full checkpoints (e.g. Every 10 commits) */
export const DEFAULT_CHECKPOINT_INTERVAL = 10;

/**
 * Validates that a version value is a strictly positive, finite integer.
 * Throws TemporalError('InvalidVersion') if invalid.
 */
export function validateVersion(version: unknown, fieldName: string): number {
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
		throw new TemporalError(
			'InvalidVersion',
			`Version for '${fieldName}' must be a positive integer >= 1, received: ${String(version)}`
		);
	}
	return version;
}

/**
 * Checks if a stored version is compatible with the current running version.
 */
export function isVersionCompatible(storedVersion: number, currentVersion: number): boolean {
	return storedVersion === currentVersion;
}

/**
 * Computes deterministic blob analysis cache key.
 */
export function computeAnalysisCacheKey(
	blobOid: string,
	analyzerVersion: number,
	profileVersion: number,
	language: string
): string {
	validateVersion(analyzerVersion, 'analyzerVersion');
	validateVersion(profileVersion, 'profileVersion');
	const cleanOid = blobOid.trim().toLowerCase();
	const cleanLang = language.trim().toLowerCase();
	return `${cleanOid}:a${analyzerVersion}:p${profileVersion}:${cleanLang}`;
}

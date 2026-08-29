/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';

export const PHASE3_EVIDENCE_SCHEMA_VERSION = 1;

/**
 * Metadata required on each report consumed by the Phase 3 final gate.
 *
 * This intentionally stays acceptance-local: it proves that evidence came from
 * the checked source revision without becoming a general reporting framework.
 */
export function phase3EvidenceMetadata(repo, scenario) {
	if (!scenario) {
		throw new Error('Phase 3 evidence scenario is required.');
	}
	return {
		schemaVersion: PHASE3_EVIDENCE_SCHEMA_VERSION,
		scenario,
		sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
		generatedAt: new Date().toISOString(),
	};
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeProducerFingerprint, producerIdForScenario } from './phase3ProducerDomains.mjs';

export const PHASE3_EVIDENCE_SCHEMA_VERSION = 3;

/**
 * Pathspecs whose working-tree bytes can change product or acceptance behavior
 * while HEAD stays the same. Reports, screenshots, logs, build output, secrets,
 * and node_modules are intentionally absent so generating evidence cannot
 * invalidate the fingerprint that evidence claims.
 */
export const SOURCE_FINGERPRINT_PATHSPECS = [
	'src/vs/workbench/contrib/prebase',
	'src/vs/platform/native',
	'graphs',
	'extensions/prebase-magnus',
	'supabase/functions',
	'supabase/migrations',
	'test/prebase',
	'test/fixtures',
	'scripts',
	'.agents/skills/launch',
	'package.json',
	'package-lock.json',
	'product.json',
];

const SECRET_PATH = /(?:^|\/)\.env(?:\.[^/]+)?$|(?:^|\/)(?:credentials|secrets?|secret-store)(?:\.[^/]+)?$/i;

function gitNulList(repo, extraArgs) {
	return execFileSync('git', extraArgs, { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
		.split('\0')
		.filter(Boolean);
}

function isSecretPath(relativePath) {
	return SECRET_PATH.test(relativePath.replaceAll('\\', '/'));
}

export function isExcludedFingerprintPath(relativePath) {
	const normalized = relativePath.replaceAll('\\', '/');
	if (isSecretPath(normalized)) {
		return true;
	}
	if (normalized === 'reports' || normalized.startsWith('reports/')) {
		return true;
	}
	if (normalized === 'node_modules' || normalized.startsWith('node_modules/') || normalized.includes('/node_modules/')) {
		return true;
	}
	return false;
}

export function isHashableWorkingTreeFile(repo, relativePath) {
	try {
		const stat = lstatSync(join(repo, relativePath));
		return stat.isFile();
	} catch {
		return false;
	}
}

/**
 * Tracked + untracked (not ignored) files under the fingerprint pathspecs.
 * Deleted working-tree files are omitted (their absence changes the digest).
 * Secret basenames are listed nowhere and never read.
 */
export function listFilesUnderPathspecs(repo, pathspecs) {
	const tracked = gitNulList(repo, ['ls-files', '-z', '--', ...pathspecs]);
	const others = gitNulList(repo, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...pathspecs]);
	const seen = new Set();
	const files = [];
	for (const relativePath of [...tracked, ...others]) {
		const normalized = relativePath.replaceAll('\\', '/');
		if (seen.has(normalized) || isExcludedFingerprintPath(normalized) || !isHashableWorkingTreeFile(repo, normalized)) {
			continue;
		}
		seen.add(normalized);
		files.push(normalized);
	}
	files.sort();
	return files;
}

export function listSourceFingerprintFiles(repo) {
	return listFilesUnderPathspecs(repo, SOURCE_FINGERPRINT_PATHSPECS);
}

export function computePathspecFingerprint(repo, pathspecs, label = '') {
	const hash = createHash('sha256');
	if (label) {
		hash.update(label);
		hash.update('\0');
	}
	for (const relativePath of listFilesUnderPathspecs(repo, pathspecs)) {
		hash.update(relativePath);
		hash.update('\0');
		hash.update(readFileSync(join(repo, relativePath)));
		hash.update('\0');
	}
	return hash.digest('hex');
}

export function computeSourceFingerprint(repo) {
	return computePathspecFingerprint(repo, SOURCE_FINGERPRINT_PATHSPECS, 'product');
}

export function currentSourceIdentity(repo) {
	const sourceFingerprint = computeSourceFingerprint(repo);
	return {
		sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
		sourceFingerprint,
		productFingerprint: sourceFingerprint,
	};
}

/**
 * Metadata required on each report consumed by the Phase 3 final gate.
 *
 * This intentionally stays acceptance-local: it proves that evidence came from
 * the current commit AND the current dirty/untracked source tree.
 */
export function phase3EvidenceMetadata(repo, scenario, options = {}) {
	if (!scenario) {
		throw new Error('Phase 3 evidence scenario is required.');
	}
	const identity = currentSourceIdentity(repo);
	const metadata = {
		schemaVersion: PHASE3_EVIDENCE_SCHEMA_VERSION,
		scenario,
		sourceHead: identity.sourceHead,
		sourceFingerprint: identity.sourceFingerprint,
		productFingerprint: identity.productFingerprint,
		generatedAt: new Date().toISOString(),
	};
	const producerId = options.producerId ?? producerIdForScenario(scenario);
	if (producerId) {
		metadata.producerId = producerId;
		metadata.producerFingerprint = options.producerFingerprint ?? computeProducerFingerprint(repo, producerId);
	}
	return metadata;
}

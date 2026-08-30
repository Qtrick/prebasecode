/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
	computePathspecFingerprint,
	listFilesUnderPathspecs,
} from './phase3Evidence.mjs';

/** @typedef {'shared-workbench'|'core-ide'|'graphs-common'|'network-graph'|'temporal'|'desktop-runtime'|'electron-test-lab'|'tauri-test-lab'|'runtime-preview'|'magnus-core'|'magnus-desktop-tools'|'web-context'|'privacy'|'cloud-auth'|'launch-harness'|'acceptance-shared'|'assurance-leaf'} Phase3Domain */

/** @type {Record<Phase3Domain, string[]>} */
export const DOMAIN_PATHSPECS = {
	'shared-workbench': ['src/vs/workbench/contrib/prebase'],
	'core-ide': ['src/vs/workbench/contrib/prebase', 'test/fixtures/typescript-lanes'],
	'graphs-common': ['graphs'],
	'network-graph': ['graphs/src/host/workbench', 'graphs/src/core'],
	'temporal': ['graphs/src/temporal', 'graphs/scripts/acceptance'],
	'desktop-runtime': ['src/vs/workbench/contrib/prebase', 'src/vs/platform/native'],
	'electron-test-lab': ['test/prebase/fixtures/desktop-electron', 'test/prebase/acceptance/prebase-desktop-product-path.mjs', 'test/prebase/acceptance/prebase-desktop-native-cases.mjs', 'test/prebase/acceptance/prebase-restart-soak.mjs'],
	'tauri-test-lab': ['test/prebase/fixtures/desktop-tauri', 'test/prebase/acceptance/prebase-desktop-product-path.mjs', 'test/prebase/acceptance/prebase-restart-soak.mjs'],
	'runtime-preview': ['src/vs/workbench/contrib/prebase/browser/runtimeEditor.ts', 'src/vs/workbench/contrib/prebase/browser/prebaseRuntimeView.ts', 'test/prebase/acceptance/runtime-preview-live.mjs'],
	'magnus-core': ['extensions/prebase-magnus'],
	'magnus-desktop-tools': ['extensions/prebase-magnus/src/desktopTools.ts', 'extensions/prebase-magnus/src/nativeTools.ts', 'test/prebase/acceptance/prebase-magnus-tools-live.mjs'],
	'web-context': ['extensions/prebase-magnus/src/hybridWebContext.ts', 'extensions/prebase-magnus/src/webContextCore.ts', 'extensions/prebase-magnus/src/localFirecrawlClient.ts', 'supabase/functions/web-search', 'test/prebase/acceptance/prebase-hybrid-web-smoke.mjs'],
	'privacy': ['scripts/privacy', 'test/prebase/acceptance/prebase-privacy-runtime.mjs'],
	'cloud-auth': ['supabase/functions', 'supabase/migrations', 'extensions/prebase-magnus/src/secretResolver.ts'],
	'launch-harness': ['.agents/skills/launch', 'test/prebase/acceptance/workbenchHarness.mjs'],
	'acceptance-shared': [
		'test/prebase/acceptance/phase3Evidence.mjs',
		'test/prebase/acceptance/phase3ProducerDomains.mjs',
		'test/prebase/acceptance/prebase-phase3-final-gate.mjs',
		'test/prebase/acceptance/workbenchHarness.mjs',
	],
	'assurance-leaf': ['scripts/assurance', 'scripts/icons', 'scripts/privacy', 'scripts/startup', 'scripts/supabase', 'graphs/scripts/verify-boundary', 'graphs/scripts/verify-typescript-lanes.mjs', 'package.json', 'package-lock.json', 'product.json'],
};

/** Prefix → domain for changed-path classification (longest match wins). */
/** @type {Array<[string, Phase3Domain]>} */
export const PATH_PREFIX_DOMAINS = [
	['graphs/src/temporal/', 'temporal'],
	['graphs/scripts/acceptance/', 'temporal'],
	['graphs/src/host/workbench/', 'network-graph'],
	['graphs/', 'graphs-common'],
	['extensions/prebase-magnus/src/desktopTools.ts', 'magnus-desktop-tools'],
	['extensions/prebase-magnus/src/nativeTools.ts', 'magnus-desktop-tools'],
	['extensions/prebase-magnus/src/hybridWebContext.ts', 'web-context'],
	['extensions/prebase-magnus/src/webContextCore.ts', 'web-context'],
	['extensions/prebase-magnus/src/localFirecrawlClient.ts', 'web-context'],
	['extensions/prebase-magnus/', 'magnus-core'],
	['supabase/functions/web-search/', 'web-context'],
	['supabase/', 'cloud-auth'],
	['scripts/privacy/', 'privacy'],
	['scripts/assurance/', 'assurance-leaf'],
	['scripts/icons/', 'assurance-leaf'],
	['scripts/startup/', 'assurance-leaf'],
	['scripts/supabase/', 'assurance-leaf'],
	['src/vs/platform/native/', 'desktop-runtime'],
	['src/vs/workbench/contrib/prebase/browser/runtimeEditor.ts', 'runtime-preview'],
	['src/vs/workbench/contrib/prebase/browser/prebaseRuntimeView.ts', 'runtime-preview'],
	['src/vs/workbench/contrib/prebase/', 'shared-workbench'],
	['test/prebase/fixtures/desktop-electron/', 'electron-test-lab'],
	['test/prebase/fixtures/desktop-tauri/', 'tauri-test-lab'],
	['test/prebase/acceptance/prebase-desktop-product-path.mjs', 'electron-test-lab'],
	['test/prebase/acceptance/prebase-desktop-native-cases.mjs', 'electron-test-lab'],
	['test/prebase/acceptance/prebase-restart-soak.mjs', 'electron-test-lab'],
	['test/prebase/acceptance/prebase-magnus-tools-live.mjs', 'magnus-desktop-tools'],
	['test/prebase/acceptance/prebase-hybrid-web-smoke.mjs', 'web-context'],
	['test/prebase/acceptance/prebase-privacy-runtime.mjs', 'privacy'],
	['test/prebase/acceptance/runtime-preview-live.mjs', 'runtime-preview'],
	['test/prebase/acceptance/prebase-core-ide-live.mjs', 'core-ide'],
	['test/prebase/acceptance/prebase-magnus-stream-live.mjs', 'magnus-core'],
	['test/prebase/acceptance/prebase-active-soak.mjs', 'acceptance-shared'],
	['test/prebase/acceptance/prebase-idle-soak.mjs', 'acceptance-shared'],
	['test/prebase/acceptance/prebase-process-leak-diag.mjs', 'acceptance-shared'],
	['test/prebase/acceptance/prebase-load-quit-live.mjs', 'acceptance-shared'],
	['test/prebase/acceptance/', 'acceptance-shared'],
	['test/prebase/', 'acceptance-shared'],
	['test/fixtures/', 'core-ide'],
	['.agents/skills/launch/', 'launch-harness'],
	['package.json', 'assurance-leaf'],
	['package-lock.json', 'assurance-leaf'],
	['product.json', 'assurance-leaf'],
];

/** @type {Record<string, Phase3Domain[]>} */
export const PRODUCER_DOMAINS = {
	'parser-benchmark': ['graphs-common', 'acceptance-shared'],
	'magnus-streaming-smoke': ['magnus-core', 'shared-workbench', 'launch-harness', 'acceptance-shared'],
	'core-ide': ['core-ide', 'shared-workbench', 'graphs-common', 'network-graph', 'runtime-preview', 'magnus-core', 'launch-harness', 'acceptance-shared'],
	'runtime-preview': ['runtime-preview', 'launch-harness', 'acceptance-shared'],
	'temporal-small': ['temporal', 'graphs-common', 'network-graph', 'shared-workbench', 'launch-harness', 'acceptance-shared'],
	'temporal-large': ['temporal', 'graphs-common', 'network-graph', 'shared-workbench', 'launch-harness', 'acceptance-shared'],
	'electron-product-path': ['desktop-runtime', 'electron-test-lab', 'magnus-desktop-tools', 'launch-harness', 'acceptance-shared'],
	'electron-native-cases': ['electron-test-lab', 'desktop-runtime', 'magnus-desktop-tools', 'launch-harness', 'acceptance-shared'],
	'tauri-product-path': ['desktop-runtime', 'tauri-test-lab', 'magnus-desktop-tools', 'launch-harness', 'acceptance-shared'],
	'magnus-electron-tools': ['magnus-core', 'magnus-desktop-tools', 'electron-test-lab', 'desktop-runtime', 'launch-harness', 'acceptance-shared'],
	'magnus-tauri-tools': ['magnus-core', 'magnus-desktop-tools', 'tauri-test-lab', 'desktop-runtime', 'launch-harness', 'acceptance-shared'],
	'hybrid-web-smoke': ['web-context', 'magnus-core', 'cloud-auth', 'acceptance-shared'],
	'privacy': ['privacy', 'shared-workbench', 'launch-harness', 'acceptance-shared'],
	'load-quit': ['shared-workbench', 'graphs-common', 'temporal', 'runtime-preview', 'magnus-core', 'electron-test-lab', 'tauri-test-lab', 'launch-harness', 'acceptance-shared'],
	'lifecycle-cycles': ['shared-workbench', 'graphs-common', 'launch-harness', 'acceptance-shared'],
	'electron-restart-soak': ['desktop-runtime', 'electron-test-lab', 'launch-harness', 'acceptance-shared'],
	'tauri-restart-soak': ['desktop-runtime', 'tauri-test-lab', 'launch-harness', 'acceptance-shared'],
	'idle-soak': ['shared-workbench', 'launch-harness', 'acceptance-shared'],
	'active-soak': ['shared-workbench', 'graphs-common', 'network-graph', 'temporal', 'runtime-preview', 'magnus-core', 'launch-harness', 'acceptance-shared'],
	assurance: ['assurance-leaf', 'acceptance-shared', 'magnus-core', 'graphs-common', 'shared-workbench', 'privacy'],
};

/** Producer-specific harness files included in producer fingerprint. */
/** @type {Record<string, string[]>} */
export const PRODUCER_HARNESS_PATHS = {
	'parser-benchmark': ['graphs/scripts/parser-batch-bench.ts', 'graphs/scripts/graphs-test-register.mjs'],
	'magnus-streaming-smoke': ['test/prebase/acceptance/prebase-magnus-stream-live.mjs'],
	'core-ide': ['test/prebase/acceptance/prebase-core-ide-live.mjs'],
	'runtime-preview': ['test/prebase/acceptance/runtime-preview-live.mjs'],
	'temporal-small': ['graphs/scripts/acceptance/temporal-live.mjs'],
	'temporal-large': ['graphs/scripts/acceptance/temporal-live.mjs'],
	'electron-product-path': ['test/prebase/acceptance/prebase-desktop-product-path.mjs'],
	'electron-native-cases': ['test/prebase/acceptance/prebase-desktop-native-cases.mjs'],
	'tauri-product-path': ['test/prebase/acceptance/prebase-desktop-product-path.mjs'],
	'magnus-electron-tools': ['test/prebase/acceptance/prebase-magnus-tools-live.mjs'],
	'magnus-tauri-tools': ['test/prebase/acceptance/prebase-magnus-tools-live.mjs'],
	'hybrid-web-smoke': ['test/prebase/acceptance/prebase-hybrid-web-smoke.mjs'],
	'privacy': ['test/prebase/acceptance/prebase-privacy-runtime.mjs'],
	'load-quit': ['test/prebase/acceptance/prebase-load-quit-live.mjs'],
	'lifecycle-cycles': ['test/prebase/acceptance/prebase-process-leak-diag.mjs'],
	'electron-restart-soak': ['test/prebase/acceptance/prebase-restart-soak.mjs', 'test/prebase/acceptance/prebase-desktop-product-path.mjs'],
	'tauri-restart-soak': ['test/prebase/acceptance/prebase-restart-soak.mjs', 'test/prebase/acceptance/prebase-desktop-product-path.mjs'],
	'idle-soak': ['test/prebase/acceptance/prebase-idle-soak.mjs'],
	'active-soak': ['test/prebase/acceptance/prebase-active-soak.mjs', 'test/prebase/acceptance/prebase-process-leak-diag.mjs'],
	assurance: ['test/prebase/acceptance/prebase-phase3-assurance.mjs'],
};

/** Historical median durations for plan estimates (ms). */
export const PRODUCER_ESTIMATED_DURATION_MS = {
	'parser-benchmark': 90_000,
	'magnus-streaming-smoke': 45_000,
	'core-ide': 120_000,
	'runtime-preview': 60_000,
	'temporal-small': 90_000,
	'temporal-large': 150_000,
	'electron-product-path': 30_000,
	'electron-native-cases': 35_000,
	'tauri-product-path': 30_000,
	'magnus-electron-tools': 150_000,
	'magnus-tauri-tools': 240_000,
	'hybrid-web-smoke': 60_000,
	'privacy': 90_000,
	'load-quit': 120_000,
	'lifecycle-cycles': 22 * 60 * 1000,
	'electron-restart-soak': 15 * 60 * 1000,
	'tauri-restart-soak': 4 * 60 * 1000,
	'idle-soak': 15 * 60 * 1000,
	'active-soak': 12 * 60 * 1000,
	assurance: 8 * 60 * 1000,
};

/** Scenario ids that map to a producer for fingerprinting. */
export const SCENARIO_PRODUCER_ID = {
	'code-graph': 'core-ide',
	'themes-a11y': 'core-ide',
};

export function producerIdForScenario(scenarioId) {
	if (SCENARIO_PRODUCER_ID[scenarioId]) {
		return SCENARIO_PRODUCER_ID[scenarioId];
	}
	if (PRODUCER_DOMAINS[scenarioId]) {
		return scenarioId;
	}
	return undefined;
}

export const PRODUCER_EXECUTION_ORDER = [
	'parser-benchmark',
	'magnus-streaming-smoke',
	'core-ide',
	'runtime-preview',
	'temporal-small',
	'temporal-large',
	'electron-product-path',
	'electron-native-cases',
	'tauri-product-path',
	'magnus-electron-tools',
	'magnus-tauri-tools',
	'hybrid-web-smoke',
	'privacy',
	'load-quit',
	'lifecycle-cycles',
	'electron-restart-soak',
	'tauri-restart-soak',
	'idle-soak',
	'active-soak',
];

function normalizePath(relativePath) {
	return relativePath.replaceAll('\\', '/');
}

export function domainsForPath(relativePath) {
	const normalized = normalizePath(relativePath);
	const matches = [];
	for (const [prefix, domain] of PATH_PREFIX_DOMAINS) {
		if (normalized === prefix || normalized.startsWith(prefix)) {
			matches.push({ prefix, domain });
		}
	}
	if (!matches.length) {
		return [];
	}
	matches.sort((a, b) => b.prefix.length - a.prefix.length);
	const seen = new Set();
	const domains = [];
	for (const match of matches) {
		if (!seen.has(match.domain)) {
			seen.add(match.domain);
			domains.push(match.domain);
		}
	}
	return domains;
}

export function pathspecsForProducer(producerId) {
	const domains = PRODUCER_DOMAINS[producerId] ?? [];
	const pathspecs = new Set();
	for (const domain of domains) {
		for (const spec of DOMAIN_PATHSPECS[domain] ?? []) {
			pathspecs.add(spec);
		}
	}
	for (const harness of PRODUCER_HARNESS_PATHS[producerId] ?? []) {
		pathspecs.add(harness);
	}
	return [...pathspecs].sort();
}

export function computeProducerFingerprint(repo, producerId) {
	const pathspecs = pathspecsForProducer(producerId);
	return computePathspecFingerprint(repo, pathspecs, `producer:${producerId}`);
}

export function listChangedSourcePaths(repo) {
	const tracked = execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
		.split('\0')
		.filter(Boolean);
	const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
		.split('\0')
		.filter(Boolean);
	const staged = execFileSync('git', ['diff', '--name-only', '-z', '--cached'], { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
		.split('\0')
		.filter(Boolean);
	return [...new Set([...tracked, ...untracked, ...staged].map(normalizePath))].sort();
}

export function classifyChangedPaths(repo, changedPaths = listChangedSourcePaths(repo)) {
	const unknown = [];
	const domains = new Set();
	for (const path of changedPaths) {
		const mapped = domainsForPath(path);
		if (!mapped.length) {
			unknown.push(path);
		} else {
			for (const domain of mapped) {
				domains.add(domain);
			}
		}
	}
	return { unknown, domains: [...domains] };
}

export function producersAffectedByDomains(domainSet) {
	const wanted = new Set(domainSet);
	const affected = new Set();
	for (const [producerId, domains] of Object.entries(PRODUCER_DOMAINS)) {
		if (domains.some(domain => wanted.has(domain))) {
			affected.add(producerId);
		}
	}
	return [...affected];
}

export function sortProducersByExecutionOrder(producerIds) {
	const order = new Map(PRODUCER_EXECUTION_ORDER.map((id, index) => [id, index]));
	return [...producerIds].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}

export function producerDomainsFingerprint(repo, producerIds) {
	const hash = createHash('sha256');
	for (const producerId of sortProducersByExecutionOrder(producerIds)) {
		hash.update(producerId);
		hash.update('\0');
		hash.update(computeProducerFingerprint(repo, producerId));
		hash.update('\0');
	}
	return hash.digest('hex');
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	computePathspecFingerprint,
} from './phase3Evidence.mjs';

/** @typedef {'shared-workbench'|'core-ide'|'graphs-common'|'network-graph'|'temporal'|'desktop-runtime'|'electron-test-lab'|'tauri-test-lab'|'runtime-preview'|'magnus-core'|'magnus-guidance'|'magnus-desktop-tools'|'web-context'|'privacy'|'cloud-auth'|'launch-harness'|'validation-orchestration'|'assurance-leaf'|'load-quit-lab'|'lifecycle-lab'|'idle-soak-lab'|'active-soak-lab'|'live-activity'} Phase3Domain */

/** @type {Record<Phase3Domain, string[]>} */
export const DOMAIN_PATHSPECS = {
	'shared-workbench': ['src/vs/workbench/contrib/prebase'],
	'core-ide': ['src/vs/workbench/contrib/prebase', 'test/fixtures/typescript-lanes'],
	'graphs-common': ['graphs'],
	'network-graph': ['graphs/src/host/workbench', 'graphs/src/core'],
	'temporal': ['graphs/src/temporal', 'graphs/src/view/temporal', 'graphs/scripts/acceptance'],
	'desktop-runtime': ['src/vs/workbench/contrib/prebase', 'src/vs/platform/native'],
	'electron-test-lab': ['test/prebase/fixtures/desktop-electron', 'test/prebase/acceptance/prebase-desktop-product-path.mjs', 'test/prebase/acceptance/prebase-desktop-native-cases.mjs', 'test/prebase/acceptance/prebase-restart-soak.mjs'],
	'tauri-test-lab': ['test/prebase/fixtures/desktop-tauri', 'test/prebase/acceptance/prebase-desktop-product-path.mjs', 'test/prebase/acceptance/prebase-restart-soak.mjs'],
	'runtime-preview': ['src/vs/workbench/contrib/prebase/browser/runtimeEditor.ts', 'src/vs/workbench/contrib/prebase/browser/prebaseRuntimeView.ts', 'test/prebase/acceptance/runtime-preview-live.mjs'],
	'magnus-core': [
		'extensions/prebase-magnus/package.json',
		'extensions/prebase-magnus/src/aiService.ts',
		'extensions/prebase-magnus/src/chatParticipant.ts',
		'extensions/prebase-magnus/src/extension.ts',
		'extensions/prebase-magnus/src/languageModelProvider.ts',
		'extensions/prebase-magnus/src/modes.ts',
		'extensions/prebase-magnus/src/requestAssembler.ts',
		'extensions/prebase-magnus/src/smokeTransport.ts',
		'extensions/prebase-magnus/src/toolExecutor.ts',
		'extensions/prebase-magnus/src/transports.ts',
	],
	'magnus-guidance': [
		'extensions/prebase-magnus/src/projectGuidanceDiscovery.ts',
		'extensions/prebase-magnus/src/projectGuidanceService.ts',
		'extensions/prebase-magnus/src/projectGuidanceSession.ts',
		'extensions/prebase-magnus/src/projectGuidanceRegistry.ts',
		'extensions/prebase-magnus/src/projectGuidanceDelta.ts',
		'extensions/prebase-magnus/src/projectGuidanceJit.ts',
		'extensions/prebase-magnus/src/nativeTools.ts',
		'extensions/prebase-magnus/src/chatParticipant.ts',
		'extensions/prebase-magnus/src/toolExecutor.ts',
		'extensions/prebase-magnus/src/extension.ts',
		'extensions/prebase-magnus/package.json',
		'test/prebase/fixtures/project-guidance-monorepo',
		'test/prebase/fixtures/project-guidance-ecosystems',
		'test/prebase/fixtures/project-guidance-claude',
		'test/prebase/fixtures/project-guidance-claude-excludes',
		'test/prebase/fixtures/project-guidance-gemini',
		'test/prebase/fixtures/project-guidance-github',
		'test/prebase/fixtures/project-guidance-github-manual',
		'test/prebase/fixtures/project-guidance-cline',
		'test/prebase/fixtures/project-guidance-windsurf',
		'test/prebase/fixtures/project-guidance-kiro',
		'test/prebase/fixtures/project-guidance-opencode',
		'test/prebase/fixtures/project-guidance-extra-skills',
		'test/prebase/fixtures/project-guidance-playbooks',
		'test/prebase/fixtures/project-guidance-skill-meta',
		'test/prebase/fixtures/project-guidance-multi-root',
		'test/prebase/fixtures/project-guidance-duplicate-skills',
	],
	'magnus-desktop-tools': ['extensions/prebase-magnus/src/desktopTools.ts', 'extensions/prebase-magnus/src/nativeTools.ts', 'test/prebase/acceptance/prebase-magnus-tools-live.mjs'],
	'web-context': ['extensions/prebase-magnus/src/hybridWebContext.ts', 'extensions/prebase-magnus/src/webContextCore.ts', 'extensions/prebase-magnus/src/localFirecrawlClient.ts', 'supabase/functions/web-search', 'test/prebase/acceptance/prebase-hybrid-web-smoke.mjs'],
	'privacy': ['scripts/privacy', 'test/prebase/acceptance/prebase-privacy-runtime.mjs'],
	'cloud-auth': ['supabase/functions', 'supabase/migrations', 'extensions/prebase-magnus/src/secretResolver.ts'],
	'launch-harness': ['.agents/skills/launch', 'test/prebase/acceptance/workbenchHarness.mjs'],
	/** Planner/gate code — changing this must NOT fingerprint-invalidate every product producer. */
	'validation-orchestration': [
		'test/prebase/acceptance/phase3Evidence.mjs',
		'test/prebase/acceptance/phase3ProducerDomains.mjs',
		'test/prebase/acceptance/prebase-phase3-final-gate.mjs',
	],
	'load-quit-lab': ['test/prebase/acceptance/prebase-load-quit-live.mjs'],
	'lifecycle-lab': ['test/prebase/acceptance/prebase-process-leak-diag.mjs'],
	'live-activity': [
		'src/vs/platform/prebaseLiveActivity',
		'src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts',
		'native/prebase-live-activity',
		'test/prebase/acceptance/prebase-magnus-live-activity-live.mjs',
	],
	'idle-soak-lab': ['test/prebase/acceptance/prebase-idle-soak.mjs'],
	'active-soak-lab': ['test/prebase/acceptance/prebase-active-soak.mjs'],
	'assurance-leaf': ['scripts/assurance', 'scripts/icons', 'scripts/privacy', 'scripts/startup', 'scripts/supabase', 'graphs/scripts/verify-boundary', 'graphs/scripts/verify-typescript-lanes.mjs', 'package.json', 'package-lock.json', 'product.json'],
};

/** Prefix → domain for changed-path classification (longest match wins). No broad test/prebase/ catch-all. */
/** @type {Array<[string, Phase3Domain]>} */
export const PATH_PREFIX_DOMAINS = [
	['graphs/src/temporal/', 'temporal'],
	['graphs/src/view/temporal/', 'temporal'],
	['graphs/scripts/acceptance/', 'temporal'],
	['src/vs/platform/prebaseLiveActivity/', 'live-activity'],
	['src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts', 'live-activity'],
	['native/prebase-live-activity/', 'live-activity'],
	['test/prebase/acceptance/prebase-magnus-live-activity-live.mjs', 'live-activity'],
	['graphs/src/host/workbench/', 'network-graph'],
	['graphs/', 'graphs-common'],
	['extensions/prebase-magnus/src/desktopTools.ts', 'magnus-desktop-tools'],
	['extensions/prebase-magnus/src/nativeTools.ts', 'magnus-desktop-tools'],
	['extensions/prebase-magnus/src/nativeTools.ts', 'magnus-guidance'],
	['extensions/prebase-magnus/src/extension.ts', 'magnus-core'],
	['extensions/prebase-magnus/src/extension.ts', 'magnus-guidance'],
	['extensions/prebase-magnus/package.json', 'magnus-core'],
	['extensions/prebase-magnus/package.json', 'magnus-guidance'],
	['extensions/prebase-magnus/src/hybridWebContext.ts', 'web-context'],
	['extensions/prebase-magnus/src/webContextCore.ts', 'web-context'],
	['extensions/prebase-magnus/src/localFirecrawlClient.ts', 'web-context'],
	['extensions/prebase-magnus/src/projectGuidance', 'magnus-guidance'],
	['test/prebase/fixtures/project-guidance-', 'magnus-guidance'],
	['test/prebase/acceptance/prebase-magnus-guidance-live.mjs', 'magnus-guidance'],
	['docs/PROJECT_GUIDANCE_COMPATIBILITY.md', 'magnus-guidance'],
	['test/prebase/acceptance/prebase-magnus-guidance-smoke-failures.test.mjs', 'magnus-guidance'],
	['extensions/prebase-magnus/src/toolExecutor.ts', 'magnus-core'],
	['extensions/prebase-magnus/src/toolExecutor.ts', 'magnus-guidance'],
	['extensions/prebase-magnus/src/chatParticipant.ts', 'magnus-core'],
	['extensions/prebase-magnus/src/chatParticipant.ts', 'magnus-guidance'],
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
	['test/prebase/acceptance/prebase-graph-visual-recovery-live.mjs', 'graphs-common'],
	['test/prebase/acceptance/prebase-magnus-stream-live.mjs', 'magnus-core'],
	['test/prebase/acceptance/prebase-active-soak.mjs', 'active-soak-lab'],
	['test/prebase/acceptance/prebase-idle-soak.mjs', 'idle-soak-lab'],
	['test/prebase/acceptance/prebase-process-leak-diag.mjs', 'lifecycle-lab'],
	['test/prebase/acceptance/prebase-load-quit-live.mjs', 'load-quit-lab'],
	['test/prebase/acceptance/phase3Evidence.mjs', 'validation-orchestration'],
	['test/prebase/acceptance/phase3ProducerDomains.mjs', 'validation-orchestration'],
	['test/prebase/acceptance/prebase-phase3-final-gate.mjs', 'validation-orchestration'],
	['test/prebase/acceptance/phase3', 'validation-orchestration'],
	['test/prebase/acceptance/workbenchHarness.mjs', 'launch-harness'],
	['test/prebase/acceptance/prebase-phase3-assurance.mjs', 'assurance-leaf'],
	['test/fixtures/', 'core-ide'],
	['.agents/skills/launch/', 'launch-harness'],
	['.agents/skills/prebase-validation/', 'validation-orchestration'],
	['package.json', 'assurance-leaf'],
	['package-lock.json', 'assurance-leaf'],
	['product.json', 'assurance-leaf'],
];

/**
 * Product + harness domains only. validation-orchestration is intentionally omitted
 * from product producers so planner edits do not fingerprint-stale every soak.
 * @type {Record<string, Phase3Domain[]>}
 */
export const PRODUCER_DOMAINS = {
	'parser-benchmark': ['graphs-common'],
	'magnus-streaming-smoke': ['magnus-core', 'magnus-guidance', 'shared-workbench', 'launch-harness'],
	'magnus-guidance-smoke': ['magnus-guidance', 'magnus-core', 'shared-workbench', 'launch-harness'],
	'magnus-live-activity': ['live-activity', 'magnus-core', 'launch-harness'],
	'core-ide': ['core-ide', 'shared-workbench', 'graphs-common', 'network-graph', 'runtime-preview', 'magnus-core', 'launch-harness'],
	'runtime-preview': ['runtime-preview', 'launch-harness'],
	'temporal-small': ['temporal', 'graphs-common', 'network-graph', 'shared-workbench', 'launch-harness'],
	'temporal-large': ['temporal', 'graphs-common', 'network-graph', 'shared-workbench', 'launch-harness'],
	'electron-product-path': ['desktop-runtime', 'electron-test-lab', 'magnus-desktop-tools', 'launch-harness'],
	'electron-native-cases': ['electron-test-lab', 'desktop-runtime', 'magnus-desktop-tools', 'launch-harness'],
	'tauri-product-path': ['desktop-runtime', 'tauri-test-lab', 'magnus-desktop-tools', 'launch-harness'],
	'magnus-electron-tools': ['magnus-core', 'magnus-desktop-tools', 'electron-test-lab', 'desktop-runtime', 'launch-harness'],
	'magnus-tauri-tools': ['magnus-core', 'magnus-desktop-tools', 'tauri-test-lab', 'desktop-runtime', 'launch-harness'],
	'hybrid-web-smoke': ['web-context', 'magnus-core', 'cloud-auth', 'launch-harness'],
	'privacy': ['privacy', 'shared-workbench', 'launch-harness'],
	'load-quit': ['shared-workbench', 'graphs-common', 'temporal', 'runtime-preview', 'magnus-core', 'electron-test-lab', 'tauri-test-lab', 'launch-harness', 'load-quit-lab', 'live-activity'],
	'lifecycle-cycles': ['shared-workbench', 'graphs-common', 'launch-harness', 'lifecycle-lab', 'live-activity'],
	'electron-restart-soak': ['desktop-runtime', 'electron-test-lab', 'launch-harness'],
	'tauri-restart-soak': ['desktop-runtime', 'tauri-test-lab', 'launch-harness'],
	'idle-soak': ['shared-workbench', 'launch-harness', 'idle-soak-lab'],
	'active-soak': ['shared-workbench', 'graphs-common', 'network-graph', 'temporal', 'runtime-preview', 'magnus-core', 'launch-harness', 'active-soak-lab'],
	assurance: ['assurance-leaf', 'magnus-core', 'graphs-common', 'shared-workbench', 'privacy'],
};

/** Release / milestone-only producers (excluded from commit-tier plans unless directly affected). */
export const RELEASE_ONLY_PRODUCERS = new Set([
	'parser-benchmark',
	'temporal-large',
	'load-quit',
	'lifecycle-cycles',
	'electron-restart-soak',
	'tauri-restart-soak',
	'idle-soak',
	'active-soak',
	'assurance',
]);

/** Producer-specific harness files included in producer fingerprint. */
/** @type {Record<string, string[]>} */
export const PRODUCER_HARNESS_PATHS = {
	'parser-benchmark': ['graphs/scripts/parser-batch-bench.ts', 'graphs/scripts/graphs-test-register.mjs'],
	'magnus-streaming-smoke': ['test/prebase/acceptance/prebase-magnus-stream-live.mjs'],
	'magnus-guidance-smoke': ['test/prebase/acceptance/prebase-magnus-guidance-live.mjs'],
	'magnus-live-activity': ['test/prebase/acceptance/prebase-magnus-live-activity-live.mjs'],
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

/** Calibrated fallback estimates (ms). Prefer recent successful evidence/checkpoint durations when available. */
export const PRODUCER_ESTIMATED_DURATION_MS = {
	'parser-benchmark': 90_000,
	'magnus-streaming-smoke': 45_000,
	'magnus-guidance-smoke': 20_000,
	'magnus-live-activity': 45_000,
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
	'lifecycle-cycles': 90_000,
	'electron-restart-soak': 15 * 60 * 1000,
	'tauri-restart-soak': 4 * 60 * 1000,
	'idle-soak': 15 * 60 * 1000,
	'active-soak': 12 * 60 * 1000,
	assurance: 8 * 60 * 1000,
};

/** Hard upper/lower clamps for adaptive estimates (ms). */
const ESTIMATE_BOUNDS_MS = {
	'magnus-guidance-smoke': { min: 5_000, max: 120_000 },
	'lifecycle-cycles': { min: 30_000, max: 25 * 60 * 1000 },
	'electron-restart-soak': { min: 60_000, max: 90 * 60 * 1000 },
	'tauri-restart-soak': { min: 60_000, max: 60 * 60 * 1000 },
	'idle-soak': { min: 60_000, max: 30 * 60 * 1000 },
	'active-soak': { min: 60_000, max: 30 * 60 * 1000 },
};

const EVIDENCE_DURATION_PATHS = {
	'magnus-guidance-smoke': 'magnus/project-guidance-smoke.json',
	'magnus-streaming-smoke': 'magnus/streaming-smoke.json',
	'lifecycle-cycles': 'soak/lifecycle.json',
	'load-quit': 'shutdown/load-quit-matrix.json',
	'idle-soak': 'soak/idle.json',
	'active-soak': 'soak/active.json',
	'electron-restart-soak': 'soak/electron-restart.json',
	'tauri-restart-soak': 'soak/tauri-restart.json',
	'hybrid-web-smoke': 'magnus/hybrid-web-smoke.json',
	'privacy': 'privacy/runtime-observation.json',
	'core-ide': 'core-ide/live.json',
	'runtime-preview': 'runtime-preview/live.json',
	'parser-benchmark': 'performance/parser-batch.json',
};

/** Scenario ids that map to a producer for fingerprinting. */
export const SCENARIO_PRODUCER_ID = {
	'code-graph': 'core-ide',
	'themes-a11y': 'core-ide',
	'magnus-guidance-smoke': 'magnus-guidance-smoke',
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
	'magnus-guidance-smoke',
	'magnus-live-activity',
	'core-ide',
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

/** Heavy desktop/product producers: commit-tier only when their lab/product domain is touched. */
export const COMMIT_HEAVY_PRODUCERS = new Set([
	'core-ide',
	'electron-product-path',
	'electron-native-cases',
	'tauri-product-path',
	'magnus-electron-tools',
	'magnus-tauri-tools',
	'hybrid-web-smoke',
	'runtime-preview',
	'temporal-small',
	'privacy',
]);

/**
 * Domains that unlock a COMMIT_HEAVY smoke when touched (product + lab).
 * Release-only soaks must NOT use this list — product domains like `temporal`
 * would otherwise pull active-soak / load-quit into every layout commit.
 */
function commitHeavyGateDomains(producerId) {
	return (PRODUCER_DOMAINS[producerId] ?? []).filter(domain =>
		domain.endsWith('-lab')
		|| domain === 'electron-test-lab'
		|| domain === 'tauri-test-lab'
		|| domain === 'assurance-leaf'
		|| domain === 'privacy'
		|| domain === 'runtime-preview'
		|| domain === 'temporal'
		|| domain === 'web-context'
		|| domain === 'core-ide'
	);
}

/** Release-only: unlock only when the soak/lab harness itself (or privacy/assurance leaf) is touched. */
function releaseOnlyGateDomains(producerId) {
	return (PRODUCER_DOMAINS[producerId] ?? []).filter(domain =>
		domain.endsWith('-lab')
		|| domain === 'electron-test-lab'
		|| domain === 'tauri-test-lab'
		|| domain === 'assurance-leaf'
		|| domain === 'privacy'
	);
}

/**
 * Commit-tier producers: fast relevant checks for normal feature commits.
 * Release soaks stay out unless their own lab harness domain was touched.
 * Heavy product smokes run when their product/lab domain was touched.
 */
export function producersForCommitTier(changedPaths, options = {}) {
	const { unknown, domains } = classifyChangedPaths(undefined, changedPaths);
	const affected = new Set(producersAffectedByDomains(domains));
	if (options.includeAssurance === true && domains.includes('assurance-leaf')) {
		affected.add('assurance');
	}
	const filtered = [...affected].filter(id => {
		if (RELEASE_ONLY_PRODUCERS.has(id)) {
			return releaseOnlyGateDomains(id).some(domain => domains.includes(domain));
		}
		if (COMMIT_HEAVY_PRODUCERS.has(id)) {
			return commitHeavyGateDomains(id).some(domain => domains.includes(domain));
		}
		return true;
	});
	return {
		producers: sortProducersByExecutionOrder(filtered),
		domains,
		unknown,
	};
}

function clampEstimate(producerId, ms) {
	const bounds = ESTIMATE_BOUNDS_MS[producerId] ?? { min: 5_000, max: 90 * 60 * 1000 };
	return Math.min(bounds.max, Math.max(bounds.min, ms));
}

function median(values) {
	if (!values.length) {
		return undefined;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Adaptive duration estimate: recent successful plan/checkpoint → evidence duration → calibrated fallback.
 */
export function estimateProducerDurationMs(repo, producerId, options = {}) {
	const samples = [];
	const planPath = options.validationPlanPath ?? join(repo, 'reports/graph-acceptance/phase-3-final/validation-plan.json');
	try {
		if (existsSync(planPath)) {
			const plan = JSON.parse(readFileSync(planPath, 'utf8'));
			for (const entry of plan.producers ?? []) {
				if (entry.id === producerId && entry.execution?.status === 'COMPLETE' && Number.isFinite(entry.execution.durationMs)) {
					samples.push(entry.execution.durationMs);
				}
			}
		}
	} catch { /* ignore corrupt plan */ }

	const evidenceRel = EVIDENCE_DURATION_PATHS[producerId];
	if (evidenceRel) {
		try {
			const evidencePath = join(repo, 'reports/graph-acceptance/phase-3-final', evidenceRel);
			if (existsSync(evidencePath)) {
				const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
				if (evidence.ok === true && Number.isFinite(evidence.durationMs) && evidence.durationMs > 0) {
					samples.push(evidence.durationMs);
				}
			}
		} catch { /* ignore */ }
	}

	const adaptive = median(samples.slice(-5));
	const fallback = PRODUCER_ESTIMATED_DURATION_MS[producerId] ?? 60_000;
	return clampEstimate(producerId, adaptive ?? fallback);
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

/** Classify whether a producer failure looks like transient infrastructure. */
export function isTransientProducerFailure(result) {
	if (!result) {
		return false;
	}
	if (result.timedOut) {
		return false;
	}
	if ((result.leftoverPids?.length ?? 0) > 0 && result.code === 0) {
		return true;
	}
	const logTail = typeof result.logTail === 'string' ? result.logTail.toLowerCase() : '';
	if (/eaddrinuse|address already in use|port .* in use|cdp attach|websocket.*failed to connect|ephemeral.*busy/.test(logTail)) {
		return true;
	}
	return false;
}

#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquirePhase3AcceptanceLock, processState, processTree, terminateOwnedProcessTree } from './workbenchHarness.mjs';
import { assuranceEvidenceOk } from './prebase-phase3-assurance.mjs';
import { currentSourceIdentity } from './phase3Evidence.mjs';
import {
	PRODUCER_DOMAINS,
	PRODUCER_ESTIMATED_DURATION_MS,
	RELEASE_ONLY_PRODUCERS,
	classifyChangedPaths,
	computeProducerFingerprint,
	estimateProducerDurationMs,
	isTransientProducerFailure,
	listChangedSourcePaths,
	producersForCommitTier,
	sortProducersByExecutionOrder,
} from './phase3ProducerDomains.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceRoot = join(repo, 'reports/graph-acceptance/phase-3-final');
const gateLogRoot = join(evidenceRoot, 'gate-logs');
const validationPlanPath = join(evidenceRoot, 'validation-plan.json');
export const VALIDATION_PLAN_SCHEMA_VERSION = 1;
const validationStateRoot = join(repo, '.build/prebase-validation');
export const ACTIVE_SOAK_FINAL_MIN_DURATION_MS = 10 * 60 * 1000;
const TREE_DRAIN_MS = 8_000;
const FAILURE_LOG_TAIL_LINES = 60;

export function expectedProducerFingerprint(repo, producerId) {
	return computeProducerFingerprint(repo, producerId);
}

function formatDuration(ms) {
	if (!Number.isFinite(ms) || ms < 0) {
		return '0s';
	}
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
}

function timestamp() {
	return new Date().toISOString().slice(11, 19);
}

function tailLog(logPath, maxLines = FAILURE_LOG_TAIL_LINES) {
	try {
		const lines = readFileSync(logPath, 'utf8').split('\n');
		return lines.slice(-maxLines).join('\n');
	} catch {
		return '';
	}
}

export function probeEnvironmentPrerequisites(env = process.env) {
	return {
		firecrawlConfigured: Boolean(String(env.FIRECRAWL_API_KEY ?? '').trim()),
		linkupConfigured: Boolean(String(env.LINKUP_API_KEY ?? '').trim()),
		geminiConfigured: Boolean(String(env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? '').trim()),
	};
}

export function computePlanKey(repoRoot, identity, prerequisites = probeEnvironmentPrerequisites()) {
	const producerFingerprints = Object.fromEntries(
		[...PHASE3_PRODUCERS.map(item => item.id), 'assurance'].map(id => [id, expectedProducerFingerprint(repoRoot, id)]),
	);
	return createHash('sha256').update(JSON.stringify({
		schemaVersion: VALIDATION_PLAN_SCHEMA_VERSION,
		productFingerprint: identity.productFingerprint ?? identity.sourceFingerprint,
		producerFingerprints,
		prerequisites: {
			firecrawlConfigured: prerequisites.firecrawlConfigured,
			linkupConfigured: prerequisites.linkupConfigured,
		},
	})).digest('hex');
}

export function planStateDir(planKey, runId) {
	return join(validationStateRoot, planKey, runId);
}

export function planCheckpointPath(runId, planKey) {
	if (planKey) {
		return join(planStateDir(planKey, runId), 'checkpoint.json');
	}
	return join(validationStateRoot, 'legacy', `${runId}.json`);
}

export function findReusablePlan(repoRoot, identity, prerequisites = probeEnvironmentPrerequisites()) {
	const planKey = computePlanKey(repoRoot, identity, prerequisites);
	const keyDir = join(validationStateRoot, planKey);
	if (!existsSync(keyDir)) {
		return undefined;
	}
	const entries = readdirSyncSafe(keyDir);
	for (const runId of entries.sort().reverse()) {
		const checkpoint = join(keyDir, runId, 'checkpoint.json');
		if (!existsSync(checkpoint)) {
			continue;
		}
		try {
			const plan = JSON.parse(readFileSync(checkpoint, 'utf8'));
			if (plan.planKey === planKey) {
				return plan;
			}
		} catch {
			continue;
		}
	}
	return undefined;
}

function readdirSyncSafe(dir) {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

export function activeSoakProducerTimeoutMs(env = process.env) {
	const configured = Number(env.PREBASE_ACTIVE_SOAK_MS || 12 * 60 * 1000);
	const durationMs = Number.isFinite(configured) && configured > 0 ? configured : 12 * 60 * 1000;
	return durationMs + 4 * 60 * 1000;
}

export function idleSoakProducerTimeoutMs(env = process.env) {
	const configured = Number(env.PREBASE_SOAK_MS || 15 * 60 * 1000);
	const durationMs = Number.isFinite(configured) && configured > 0 ? configured : 15 * 60 * 1000;
	return durationMs + 4 * 60 * 1000;
}

/**
 * One producer → one or more required artifacts. Order is the sequential run order.
 * Resource-sensitive PreBase scenarios must never overlap.
 */
export const PHASE3_PRODUCERS = [
	{ id: 'parser-benchmark', artifacts: ['parser-benchmark'], command: ['node', '--experimental-strip-types', '--import=./graphs/scripts/graphs-test-register.mjs', 'graphs/scripts/parser-batch-bench.ts'], timeoutMs: 25 * 60 * 1000 },
	{ id: 'magnus-streaming-smoke', artifacts: ['magnus-streaming-smoke'], command: ['node', 'test/prebase/acceptance/prebase-magnus-stream-live.mjs'], timeoutMs: 180_000 },
	{ id: 'magnus-guidance-smoke', artifacts: ['magnus-guidance-smoke'], command: ['node', 'test/prebase/acceptance/prebase-magnus-guidance-live.mjs'], timeoutMs: 180_000 },
	{ id: 'magnus-live-activity', artifacts: ['magnus-live-activity'], command: ['node', 'test/prebase/acceptance/prebase-magnus-live-activity-live.mjs'], timeoutMs: 120_000 },
	{ id: 'core-ide', artifacts: ['core-ide', 'code-graph', 'themes-a11y'], command: ['node', 'test/prebase/acceptance/prebase-core-ide-live.mjs'], timeoutMs: 240_000 },
	{ id: 'runtime-preview', artifacts: ['runtime-preview'], command: ['node', 'test/prebase/acceptance/runtime-preview-live.mjs'], timeoutMs: 180_000 },
	{ id: 'temporal-small', artifacts: ['temporal-small'], command: ['node', 'graphs/scripts/acceptance/temporal-live.mjs'], timeoutMs: 180_000 },
	{ id: 'temporal-large', artifacts: ['temporal-large'], command: ['node', 'graphs/scripts/acceptance/temporal-live.mjs', '--large'], timeoutMs: 240_000 },
	{ id: 'electron-product-path', artifacts: ['electron-product-path'], command: ['node', 'test/prebase/acceptance/prebase-desktop-product-path.mjs', '--electron-only'], timeoutMs: 180_000 },
	{ id: 'electron-native-cases', artifacts: ['electron-native-cases'], command: ['node', 'test/prebase/acceptance/prebase-desktop-native-cases.mjs'], timeoutMs: 240_000 },
	{ id: 'tauri-product-path', artifacts: ['tauri-product-path'], command: ['node', 'test/prebase/acceptance/prebase-desktop-product-path.mjs', '--tauri-only'], timeoutMs: 240_000 },
	{ id: 'magnus-electron-tools', artifacts: ['magnus-electron-tools'], command: ['node', 'test/prebase/acceptance/prebase-magnus-tools-live.mjs'], timeoutMs: 300_000 },
	{ id: 'magnus-tauri-tools', artifacts: ['magnus-tauri-tools'], command: ['node', 'test/prebase/acceptance/prebase-magnus-tools-live.mjs', '--tauri'], timeoutMs: 420_000 },
	{ id: 'hybrid-web-smoke', artifacts: ['hybrid-web-smoke'], command: ['node', 'test/prebase/acceptance/prebase-hybrid-web-smoke.mjs'], timeoutMs: 180_000 },
	{ id: 'privacy', artifacts: ['privacy'], command: ['node', 'test/prebase/acceptance/prebase-privacy-runtime.mjs'], timeoutMs: 180_000 },
	{ id: 'load-quit', artifacts: ['load-quit'], command: ['node', 'test/prebase/acceptance/prebase-load-quit-live.mjs'], timeoutMs: 240_000 },
	{ id: 'lifecycle-cycles', artifacts: ['lifecycle-cycles'], command: ['node', 'test/prebase/acceptance/prebase-process-leak-diag.mjs'], timeoutMs: 25 * 60 * 1000 },
	{ id: 'electron-restart-soak', artifacts: ['electron-restart-soak'], command: ['node', 'test/prebase/acceptance/prebase-restart-soak.mjs'], timeoutMs: 90 * 60 * 1000 },
	{ id: 'tauri-restart-soak', artifacts: ['tauri-restart-soak'], command: ['node', 'test/prebase/acceptance/prebase-restart-soak.mjs', '--tauri'], timeoutMs: 60 * 60 * 1000 },
	{ id: 'idle-soak', artifacts: ['idle-soak'], command: ['node', 'test/prebase/acceptance/prebase-idle-soak.mjs'], timeoutMs: idleSoakProducerTimeoutMs() },
	{ id: 'active-soak', artifacts: ['active-soak'], command: ['node', 'test/prebase/acceptance/prebase-active-soak.mjs'], timeoutMs: activeSoakProducerTimeoutMs(), minDurationMs: ACTIVE_SOAK_FINAL_MIN_DURATION_MS, evidenceKind: 'final' },
];

export const PHASE3_REQUIRED_EVIDENCE = [
	{ id: 'electron-product-path', path: 'electron/product-path.json' },
	{ id: 'tauri-product-path', path: 'tauri/product-path.json' },
	{ id: 'electron-native-cases', path: 'electron/native-cases.json' },
	{ id: 'runtime-preview', path: 'runtime-preview/live.json' },
	{ id: 'temporal-small', path: 'temporal/live.json' },
	{ id: 'temporal-large', path: 'temporal/large-live.json' },
	{ id: 'magnus-electron-tools', path: 'magnus/electron-tools-live.json' },
	{ id: 'magnus-tauri-tools', path: 'magnus/tauri-tools-live.json' },
	{ id: 'magnus-streaming-smoke', path: 'magnus/streaming-smoke.json' },
	{ id: 'magnus-guidance-smoke', path: 'magnus/project-guidance-smoke.json' },
	{ id: 'magnus-live-activity', path: 'magnus/live-activity.json' },
	{ id: 'hybrid-web-smoke', path: 'magnus/hybrid-web-smoke.json' },
	{ id: 'load-quit', path: 'shutdown/load-quit-matrix.json' },
	{ id: 'idle-soak', path: 'soak/idle.json' },
	{ id: 'lifecycle-cycles', path: 'soak/lifecycle.json' },
	{ id: 'electron-restart-soak', path: 'soak/electron-restart.json' },
	{ id: 'tauri-restart-soak', path: 'soak/tauri-restart.json' },
	{ id: 'core-ide', path: 'core-ide/live.json' },
	{ id: 'code-graph', path: 'core-ide/code-graph.json' },
	{ id: 'themes-a11y', path: 'core-ide/themes-a11y.json' },
	{ id: 'privacy', path: 'privacy/runtime-observation.json' },
	{ id: 'parser-benchmark', path: 'performance/parser-batch.json' },
	{ id: 'active-soak', path: 'soak/active.json', minDurationMs: ACTIVE_SOAK_FINAL_MIN_DURATION_MS, evidenceKind: 'final' },
];

export function producerForArtifact(artifactId) {
	return PHASE3_PRODUCERS.find(producer => producer.artifacts.includes(artifactId));
}

export function producersForArtifacts(artifactIds) {
	const wanted = new Set(artifactIds);
	return PHASE3_PRODUCERS.filter(producer => producer.artifacts.some(id => wanted.has(id)));
}

function readJson(rel) {
	const full = join(evidenceRoot, rel);
	if (!existsSync(full)) {
		return { missing: true, path: rel };
	}
	return { path: rel, ...JSON.parse(readFileSync(full, 'utf8')) };
}

export function scenarioOk(entry, evidence) {
	if (evidence.missing) {
		return { ok: false, reason: 'missing evidence' };
	}
	if (evidence.ok === false) {
		return { ok: false, reason: (evidence.failures ?? []).join('; ') || 'ok:false' };
	}
	if (evidence.ok !== true) {
		return { ok: false, reason: 'ok field is not true' };
	}
	if (typeof evidence.sourceHead !== 'string' || !evidence.sourceHead) {
		return { ok: false, reason: 'evidence source HEAD is missing' };
	}
	if (typeof evidence.sourceFingerprint !== 'string' || !evidence.sourceFingerprint) {
		return { ok: false, reason: 'evidence source fingerprint is missing' };
	}
	if (entry.evidenceKind && evidence.evidenceKind !== entry.evidenceKind) {
		return { ok: false, reason: `expected ${entry.evidenceKind} evidence` };
	}
	if (entry.minDurationMs && (!Number.isFinite(evidence.durationMs) || evidence.durationMs < entry.minDurationMs)) {
		return { ok: false, reason: `evidence duration is below ${entry.minDurationMs}ms` };
	}
	if (entry.expectedProducerFingerprint) {
		if (typeof evidence.producerFingerprint !== 'string' || !evidence.producerFingerprint) {
			return { ok: false, reason: 'evidence producer fingerprint is missing' };
		}
		if (evidence.producerFingerprint !== entry.expectedProducerFingerprint) {
			return { ok: false, reason: 'evidence producer fingerprint does not match current producer inputs' };
		}
	} else if (entry.sourceFingerprint && evidence.sourceFingerprint !== entry.sourceFingerprint) {
		return { ok: false, reason: 'evidence source fingerprint does not match current worktree' };
	}
	const provenanceHeadMismatch = entry.sourceHead && evidence.sourceHead !== entry.sourceHead;
	if (entry.id === 'assurance') {
		return assuranceEvidenceOk(entry, evidence);
	}
	if (entry.id && evidence.scenario !== entry.id) {
		return { ok: false, reason: 'evidence scenario does not match required scenario' };
	}
	return { ok: true, provenanceHeadMismatch: provenanceHeadMismatch || undefined };
}

export const HYBRID_FIRECRAWL_EXTERNAL_REASON = 'FIRECRAWL_API_KEY unresolved (operator-owned; BETA-040 local enrichment)';

export function hybridFirecrawlExternalSkip(evidence, identity, prerequisites = probeEnvironmentPrerequisites()) {
	if (!evidence || evidence.missing || evidence.skipped !== true || evidence.firecrawlConfigured !== false) {
		return false;
	}
	if (prerequisites.firecrawlConfigured) {
		return false;
	}
	if (!identity?.sourceFingerprint || evidence.sourceFingerprint !== identity.sourceFingerprint) {
		return false;
	}
	if (typeof evidence.producerFingerprint === 'string' && evidence.producerFingerprint) {
		return evidence.producerFingerprint === expectedProducerFingerprint(repo, 'hybrid-web-smoke');
	}
	return true;
}

function entryIdentity(repo, identity, spec) {
	const producer = producerForArtifact(spec.id);
	const producerId = producer?.id;
	return {
		...spec,
		sourceHead: identity.sourceHead,
		sourceFingerprint: identity.sourceFingerprint,
		productFingerprint: identity.productFingerprint ?? identity.sourceFingerprint,
		producerId,
		expectedProducerFingerprint: producerId ? expectedProducerFingerprint(repo, producerId) : undefined,
	};
}

export function classifyRequiredEvidence(identity, evidenceById = undefined, repoRoot = repo, prerequisites = probeEnvironmentPrerequisites()) {
	const stale = [];
	for (const spec of PHASE3_REQUIRED_EVIDENCE) {
		const evidence = evidenceById?.get(spec.id) ?? readJson(spec.path);
		if (spec.id === 'hybrid-web-smoke' && hybridFirecrawlExternalSkip(evidence, identity, prerequisites)) {
			continue;
		}
		if (spec.id === 'hybrid-web-smoke' && evidence.skipped === true && evidence.firecrawlConfigured === false && prerequisites.firecrawlConfigured) {
			stale.push({ id: spec.id, path: spec.path, reason: 'FIRECRAWL_API_KEY is now configured; hybrid-web-smoke must rerun', producer: producerForArtifact(spec.id)?.id });
			continue;
		}
		const verdict = scenarioOk(entryIdentity(repoRoot, identity, spec), evidence);
		if (!verdict.ok) {
			stale.push({ id: spec.id, path: spec.path, reason: verdict.reason, producer: producerForArtifact(spec.id)?.id });
		}
	}
	return stale;
}

export function classifyProducerStatus(repo, identity, producer, prerequisites = probeEnvironmentPrerequisites()) {
	const artifacts = producer.artifacts.map(id => PHASE3_REQUIRED_EVIDENCE.find(spec => spec.id === id)).filter(Boolean);
	const producerFingerprint = expectedProducerFingerprint(repo, producer.id);
	const dependencies = PRODUCER_DOMAINS[producer.id] ?? [];
	let status = 'CURRENT_GREEN';
	let reason = 'current';
	for (const spec of artifacts) {
		const evidence = readJson(spec.path);
		if (spec.id === 'hybrid-web-smoke' && hybridFirecrawlExternalSkip(evidence, identity, prerequisites)) {
			status = 'EXTERNAL';
			reason = HYBRID_FIRECRAWL_EXTERNAL_REASON;
			continue;
		}
		if (spec.id === 'hybrid-web-smoke' && evidence.skipped === true && evidence.firecrawlConfigured === false && prerequisites.firecrawlConfigured) {
			status = 'STALE';
			reason = 'FIRECRAWL_API_KEY is now configured; hybrid-web-smoke must rerun';
			break;
		}
		const verdict = scenarioOk(entryIdentity(repo, identity, spec), evidence);
		if (!verdict.ok) {
			status = evidence.missing ? 'MISSING' : 'STALE';
			reason = verdict.reason;
			break;
		}
	}
	return {
		id: producer.id,
		expectedProducerFingerprint: producerFingerprint,
		status,
		reason,
		estimatedDurationMs: estimateProducerDurationMs(repo, producer.id),
		timeoutMs: producer.timeoutMs,
		artifacts: producer.artifacts,
		dependencies,
	};
}

export function buildValidationPlan(repoRoot, identity, options = {}) {
	const prerequisites = probeEnvironmentPrerequisites();
	const planKey = computePlanKey(repoRoot, identity, prerequisites);
	if (!options.forceNew) {
		const reusable = findReusablePlan(repoRoot, identity, prerequisites);
		if (reusable && !options.tier && !(options.onlyProducers?.length)) {
			reusable.reused = true;
			reusable.currentHead = identity.sourceHead;
			return reusable;
		}
	}
	const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
	let producers = PHASE3_PRODUCERS.map(producer => classifyProducerStatus(repoRoot, identity, producer, prerequisites));
	const assurance = readJson('assurance.json');
	const assuranceVerdict = scenarioOk({
		id: 'assurance',
		sourceHead: identity.sourceHead,
		sourceFingerprint: identity.sourceFingerprint,
		expectedProducerFingerprint: expectedProducerFingerprint(repoRoot, 'assurance'),
	}, assurance);
	producers.push({
		id: 'assurance',
		expectedProducerFingerprint: expectedProducerFingerprint(repoRoot, 'assurance'),
		status: assuranceVerdict.ok ? 'CURRENT_GREEN' : (assurance.missing ? 'MISSING' : 'STALE'),
		reason: assuranceVerdict.ok ? 'current' : assuranceVerdict.reason,
		estimatedDurationMs: estimateProducerDurationMs(repoRoot, 'assurance'),
		timeoutMs: PRODUCER_ESTIMATED_DURATION_MS.assurance,
		artifacts: ['assurance.json'],
		dependencies: PRODUCER_DOMAINS.assurance ?? [],
	});

	const changedPaths = options.changedPaths ?? listChangedSourcePaths(repoRoot);
	const classification = classifyChangedPaths(repoRoot, changedPaths);
	let deferredRelease = [];
	let onlyFilter = options.onlyProducers?.length ? new Set(options.onlyProducers) : undefined;

	if (options.tier === 'commit') {
		const commitPlan = producersForCommitTier(changedPaths);
		const allow = new Set(commitPlan.producers);
		deferredRelease = producers
			.filter(item => RELEASE_ONLY_PRODUCERS.has(item.id) && !allow.has(item.id) && item.status !== 'CURRENT_GREEN' && item.status !== 'EXTERNAL')
			.map(item => item.id);
		producers = producers.map(item => {
			if (item.status === 'CURRENT_GREEN' || item.status === 'EXTERNAL') {
				return item;
			}
			if (allow.has(item.id) || (onlyFilter && onlyFilter.has(item.id))) {
				return item;
			}
			return {
				...item,
				status: 'DEFERRED_RELEASE',
				reason: 'commit-tier excludes release-only / unaffected producer',
			};
		});
	}

	if (onlyFilter) {
		producers = producers.map(item => {
			if (onlyFilter.has(item.id)) {
				return item.status === 'CURRENT_GREEN' || item.status === 'EXTERNAL'
					? item
					: { ...item, status: item.status === 'DEFERRED_RELEASE' ? 'STALE' : item.status };
			}
			if (item.status === 'CURRENT_GREEN' || item.status === 'EXTERNAL') {
				return item;
			}
			return {
				...item,
				status: 'SKIPPED',
				reason: `excluded by --only-producer (selected: ${[...onlyFilter].join(', ')})`,
			};
		});
	}

	const remaining = producers.filter(item => item.status !== 'CURRENT_GREEN' && item.status !== 'EXTERNAL' && item.status !== 'DEFERRED_RELEASE' && item.status !== 'SKIPPED');
	const totalEstimatedDurationMs = remaining.reduce((sum, item) => sum + item.estimatedDurationMs, 0);
	return {
		runId,
		planKey: options.tier || onlyFilter ? `${planKey}:${options.tier ?? 'only'}` : planKey,
		tier: options.tier ?? 'release',
		onlyProducers: options.onlyProducers ?? [],
		plannedAtHead: identity.sourceHead,
		currentHead: identity.sourceHead,
		sourceHead: identity.sourceHead,
		productFingerprint: identity.productFingerprint ?? identity.sourceFingerprint,
		sourceFingerprint: identity.sourceFingerprint,
		prerequisites,
		createdAt: new Date().toISOString(),
		reused: false,
		totalEstimatedDurationMs,
		changedPathCount: changedPaths.length,
		changedDomains: classification.domains,
		unknownChangedPaths: classification.unknown,
		deferredReleaseProducers: deferredRelease,
		producers: sortProducersByExecutionOrder(producers.map(item => item.id)).map(id => producers.find(item => item.id === id)),
	};
}

async function drainOwnedTree(pid) {
	if (!Number.isFinite(pid) || pid <= 0) {
		return [];
	}
	const started = Date.now();
	while (Date.now() - started < TREE_DRAIN_MS) {
		const leftover = processTree(pid).map(row => row.pid);
		if (leftover.length === 0) {
			return [];
		}
		await new Promise(resolveWait => setTimeout(resolveWait, 200));
	}
	return processTree(pid).map(row => row.pid);
}

function killLeftoverPids(pids) {
	for (const pid of pids ?? []) {
		if (processState(pid) !== 'gone') {
			try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
		}
	}
}

async function runProcess(id, command, args, timeoutMs, options = {}) {
	const verbose = options.verbose === true;
	mkdirSync(gateLogRoot, { recursive: true });
	const log = join(gateLogRoot, `${id}.log`);
	const estimatedMs = estimateProducerDurationMs(repo, id);
	console.error(`[${timestamp()}] START ${id}`);
	console.error(`estimated ${formatDuration(estimatedMs)} (timeout ${formatDuration(timeoutMs)})`);
	console.error(`log: ${log}`);
	return new Promise((resolveRun, reject) => {
		const startedAt = Date.now();
		const output = createWriteStream(log);
		let timedOut = false;
		let termination;
		const child = spawn(command, args, {
			cwd: repo,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, PREBASE_PHASE3_GATE_CHILD: '1' },
		});
		if (verbose) {
			child.stdout.pipe(process.stdout);
			child.stderr.pipe(process.stderr);
		}
		child.stdout.pipe(output);
		child.stderr.pipe(output);
		const finish = async (code) => {
			const elapsedMs = Date.now() - startedAt;
			const leftoverPids = [...new Set([
				...(termination?.leftoverPids ?? []),
				...(await drainOwnedTree(child.pid)),
			])].filter(pid => processState(pid) !== 'gone');
			const ok = (code ?? 1) === 0 && !timedOut && leftoverPids.length === 0;
			console.error(`[${timestamp()}] ${ok ? 'PASS' : 'FAIL'} ${id}`);
			console.error(`elapsed ${formatDuration(elapsedMs)}`);
			if (!ok) {
				console.error(`exit=${code ?? 1} timedOut=${timedOut} leftoverPids=${leftoverPids.join(',') || 'none'}`);
				console.error(`full log: ${log}`);
				const tail = tailLog(log);
				if (tail) {
					console.error('--- log tail ---');
					console.error(tail);
					console.error('--- end tail ---');
				}
			}
			output.end(() => resolveRun({
				code: code ?? 1,
				timedOut,
				elapsedMs,
				log,
				logTail: ok ? '' : tailLog(log),
				harnessPid: child.pid,
				timeoutMs,
				termination,
				leftoverPids,
			}));
		};
		const deadline = setTimeout(async () => {
			timedOut = true;
			output.write(`\n[phase3-final-gate] timed out after ${timeoutMs}ms; terminating owned process tree pid=${child.pid}\n`);
			termination = await terminateOwnedProcessTree(child.pid);
			output.write(`[phase3-final-gate] tree termination leftoverPids=${JSON.stringify(termination.leftoverPids)} usedSigkill=${termination.usedSigkill}\n`);
		}, timeoutMs);
		child.on('error', reject);
		child.on('close', code => {
			clearTimeout(deadline);
			void finish(code);
		});
	});
}

export function parseMode(argv) {
	const verbose = argv.includes('--verbose');
	const plan = argv.includes('--plan');
	const forceNewPlan = argv.includes('--new-plan');
	const executePlanIndex = argv.findIndex(arg => arg === '--execute-plan' || arg === '--resume-plan');
	const executePlan = executePlanIndex >= 0 ? argv[executePlanIndex + 1] : undefined;
	const resumePlan = argv.includes('--resume-plan');
	const validateEvidence = argv.includes('--validate-evidence');
	const rerunStale = argv.includes('--rerun-stale') || argv.includes('--rerun-required');
	const rerunAll = argv.includes('--rerun-all') || argv.includes('--rerun-live');
	const tierIndex = argv.findIndex(arg => arg === '--tier');
	const tierRaw = tierIndex >= 0 ? argv[tierIndex + 1] : undefined;
	const tier = tierRaw === 'commit' || tierRaw === 'release' ? tierRaw : undefined;
	if (tierIndex >= 0 && !tier) {
		throw new Error('--tier requires commit or release');
	}
	const onlyIndex = argv.findIndex(arg => arg === '--only-producer');
	const onlyProducers = onlyIndex >= 0
		? String(argv[onlyIndex + 1] ?? '').split(',').map(item => item.trim()).filter(Boolean)
		: [];
	if (onlyIndex >= 0 && onlyProducers.length === 0) {
		throw new Error('--only-producer requires a producer id');
	}
	const modes = [plan, Boolean(executePlan), validateEvidence, rerunStale, rerunAll].filter(Boolean);
	if (modes.length !== 1) {
		throw new Error('Specify exactly one of --plan, --execute-plan <runId>, --resume-plan <runId>, --validate-evidence, --rerun-stale, or --rerun-all.');
	}
	if ((tier || onlyProducers.length) && !plan && !executePlan && !rerunStale && !rerunAll) {
		throw new Error('--tier / --only-producer require --plan, --execute-plan/--resume-plan, or a rerun mode.');
	}
	return { verbose, plan, forceNewPlan, executePlan, resumePlan, validateEvidence, rerunStale, rerunAll, tier, onlyProducers };
}

/** Resume/execute skip: never restart producers already COMPLETE (or deferred/skipped/green). */
export function shouldSkipProducerExecution(entry) {
	return entry.status === 'CURRENT_GREEN'
		|| entry.status === 'EXTERNAL'
		|| entry.status === 'DEFERRED_RELEASE'
		|| entry.status === 'SKIPPED'
		|| entry.execution?.status === 'COMPLETE';
}

export function loadPlan(runId, planKey) {
	if (planKey) {
		const checkpoint = planCheckpointPath(runId, planKey);
		if (existsSync(checkpoint)) {
			return JSON.parse(readFileSync(checkpoint, 'utf8'));
		}
	}
	for (const keyDir of readdirSyncSafe(validationStateRoot)) {
		const checkpoint = join(validationStateRoot, keyDir, runId, 'checkpoint.json');
		if (existsSync(checkpoint)) {
			return JSON.parse(readFileSync(checkpoint, 'utf8'));
		}
	}
	if (existsSync(validationPlanPath)) {
		const primary = JSON.parse(readFileSync(validationPlanPath, 'utf8'));
		if (primary.runId === runId) {
			return primary;
		}
	}
	throw new Error(`validation plan not found for runId=${runId}`);
}

function writeJsonAtomic(targetPath, data) {
	mkdirSync(dirname(targetPath), { recursive: true });
	const tmp = `${targetPath}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2));
	renameSync(tmp, targetPath);
}

export function persistPlan(plan) {
	const planKey = plan.planKey ?? computePlanKey(repo, { productFingerprint: plan.productFingerprint, sourceFingerprint: plan.sourceFingerprint });
	const checkpoint = planCheckpointPath(plan.runId, planKey);
	plan.planKey = planKey;
	plan.currentHead = currentSourceIdentity(repo).sourceHead;
	writeJsonAtomic(checkpoint, plan);
	writeJsonAtomic(validationPlanPath, plan);
}

export function assertPlanIdentity(plan, identity, repoRoot = repo) {
	const productFingerprint = identity.productFingerprint ?? identity.sourceFingerprint;
	if (plan.productFingerprint !== productFingerprint && plan.tier !== 'commit' && !(plan.onlyProducers?.length)) {
		throw new Error('plan stale due to code change: product fingerprint mismatch');
	}
	for (const entry of plan.producers ?? []) {
		if (entry.status === 'DEFERRED_RELEASE' || entry.status === 'SKIPPED' || entry.status === 'CURRENT_GREEN' || entry.status === 'EXTERNAL') {
			continue;
		}
		const current = expectedProducerFingerprint(repoRoot, entry.id);
		if (entry.expectedProducerFingerprint !== current) {
			throw new Error(`plan stale due to code change: producer ${entry.id} fingerprint mismatch`);
		}
	}
	const prerequisites = probeEnvironmentPrerequisites();
	const planPrereqs = plan.prerequisites ?? {};
	if (planPrereqs.firecrawlConfigured !== prerequisites.firecrawlConfigured
		|| planPrereqs.linkupConfigured !== prerequisites.linkupConfigured) {
		throw new Error('plan stale due to environment prerequisite change');
	}
}

function readJsonFileSafe(fullPath) {
	if (!existsSync(fullPath)) {
		return undefined;
	}
	return JSON.parse(readFileSync(fullPath, 'utf8'));
}

async function executeValidationPlan(plan, identity, options = {}) {
	const reruns = new Map();
	const onlyFilter = options.onlyProducers?.length ? new Set(options.onlyProducers) : undefined;
	for (const entry of plan.producers) {
		if (entry.execution?.status === 'RUNNING') {
			delete entry.execution;
		}
		if (shouldSkipProducerExecution(entry)) {
			continue;
		}
		if (onlyFilter && !onlyFilter.has(entry.id)) {
			continue;
		}
		const currentFingerprint = entry.id === 'assurance'
			? expectedProducerFingerprint(repo, 'assurance')
			: expectedProducerFingerprint(repo, entry.id);
		if (currentFingerprint !== entry.expectedProducerFingerprint) {
			throw new Error(`plan stale due to code change: producer ${entry.id} fingerprint mismatch`);
		}
		entry.execution = { status: 'RUNNING', startedAt: new Date().toISOString(), attempts: 0 };
		persistPlan(plan);

		const runOnce = async () => {
			if (entry.id === 'assurance') {
				return runProcess('assurance', process.execPath, ['test/prebase/acceptance/prebase-phase3-assurance.mjs'], PRODUCER_ESTIMATED_DURATION_MS.assurance, options);
			}
			const producer = PHASE3_PRODUCERS.find(item => item.id === entry.id);
			if (!producer) {
				throw new Error(`unknown producer in plan: ${entry.id}`);
			}
			return runProcess(producer.id, producer.command[0], producer.command.slice(1), producer.timeoutMs, options);
		};

		let result = await runOnce();
		entry.execution.attempts = 1;
		if (result.code !== 0 || result.timedOut || result.leftoverPids.length) {
			if (isTransientProducerFailure(result)) {
				console.error(`[${timestamp()}] transient failure for ${entry.id}; cleaning up and retrying once`);
				if (result.harnessPid) {
					await terminateOwnedProcessTree(result.harnessPid);
				}
				killLeftoverPids(result.leftoverPids);
				result = await runOnce();
				entry.execution.attempts = 2;
			}
		}

		entry.execution = {
			status: result.code === 0 && !result.timedOut && result.leftoverPids.length === 0 ? 'COMPLETE' : 'FAILED',
			startedAt: entry.execution.startedAt,
			finishedAt: new Date().toISOString(),
			exitCode: result.code,
			timedOut: result.timedOut,
			durationMs: result.elapsedMs,
			log: result.log,
			leftoverPids: result.leftoverPids,
			attempts: entry.execution.attempts,
		};
		if (entry.id !== 'assurance') {
			const producer = PHASE3_PRODUCERS.find(item => item.id === entry.id);
			reruns.set(entry.id, result);
			for (const artifactId of producer.artifacts) {
				reruns.set(artifactId, result);
			}
		}
		persistPlan(plan);
		if (entry.execution.status === 'FAILED') {
			throw new Error(`producer failed: ${entry.id} exit=${result.code} timedOut=${result.timedOut}`);
		}
		if (result.leftoverPids.length) {
			await terminateOwnedProcessTree(result.harnessPid);
			killLeftoverPids(result.leftoverPids);
		}
	}
	return reruns;
}

function writeManifest(identity, planned, reruns = new Map()) {
	const scenarios = PHASE3_REQUIRED_EVIDENCE.map(spec => {
		const evidence = readJson(spec.path);
		const producer = producerForArtifact(spec.id);
		const rerun = reruns.get(spec.id) ?? (producer ? reruns.get(producer.id) : undefined);
		if (spec.id === 'hybrid-web-smoke' && hybridFirecrawlExternalSkip(evidence, identity, probeEnvironmentPrerequisites())) {
			return {
				id: spec.id,
				path: spec.path,
				ok: true,
				reason: HYBRID_FIRECRAWL_EXTERNAL_REASON,
				externalSkip: true,
				quit: evidence.quit ?? undefined,
				rerun,
			};
		}
		const verdict = scenarioOk(entryIdentity(repo, identity, spec), evidence);
		if (rerun && (rerun.code !== 0 || rerun.timedOut) && verdict.ok) {
			if (rerun.timedOut && (rerun.leftoverPids?.length ?? 0) === 0) {
				return { id: spec.id, path: spec.path, ok: true, reason: verdict.reason, quit: evidence.quit ?? undefined, rerun };
			}
			return {
				id: spec.id,
				path: spec.path,
				ok: false,
				reason: rerun.timedOut ? `live rerun timed out after ${rerun.elapsedMs}ms` : `stale evidence: live rerun exited ${rerun.code}`,
				rerun,
				quit: evidence.quit ?? undefined,
			};
		}
		return { id: spec.id, path: spec.path, ok: verdict.ok, reason: verdict.reason, quit: evidence.quit ?? undefined, rerun };
	});
	const assurance = readJson('assurance.json');
	const assuranceVerdict = scenarioOk({
		id: 'assurance',
		sourceHead: identity.sourceHead,
		sourceFingerprint: identity.sourceFingerprint,
		expectedProducerFingerprint: expectedProducerFingerprint(repo, 'assurance'),
	}, assurance);
	const failures = scenarios.filter(item => !item.ok).map(item => `${item.id}: ${item.reason}`);
	if (!assuranceVerdict.ok) {
		failures.push(`assurance: ${assuranceVerdict.reason}`);
	}
	const externalBlockers = [
		{ id: 'gemini-provider-roundtrip', reason: 'Isolated acceptance profile has no Gemini key; classified as external compatibility smoke.' },
		{ id: 'release-signing', reason: 'Release signing credentials are operator-owned (BETA-015).' },
		...scenarios.filter(item => item.externalSkip).map(item => ({ id: item.id, reason: item.reason })),
	];
	const producerFingerprints = Object.fromEntries(
		[...PHASE3_PRODUCERS.map(item => item.id), 'assurance'].map(id => [id, expectedProducerFingerprint(repo, id)]),
	);
	const manifest = {
		phase: '3-final',
		sourceHead: identity.sourceHead,
		sourceFingerprint: identity.sourceFingerprint,
		productFingerprint: identity.productFingerprint ?? identity.sourceFingerprint,
		producerFingerprints,
		validationRunId: planned.runId,
		generatedAt: new Date().toISOString(),
		overallRepositoryControlledGate: failures.length === 0,
		externalBlockers,
		failures,
		scenarios,
		assurance: { path: 'assurance.json', ok: assuranceVerdict.ok, reason: assuranceVerdict.reason },
		plannedProducers: planned.producers?.filter(item => item.execution?.status === 'COMPLETE' || item.status !== 'CURRENT_GREEN').map(item => item.id) ?? [],
	};
	writeFileSync(join(evidenceRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
	return manifest;
}

async function run() {
	const release = await acquirePhase3AcceptanceLock();
	try {
		const mode = parseMode(process.argv);
		const identity = currentSourceIdentity(repo);

		if (mode.plan) {
			const plan = buildValidationPlan(repo, identity, {
				forceNew: mode.forceNewPlan || Boolean(mode.tier) || mode.onlyProducers.length > 0,
				tier: mode.tier,
				onlyProducers: mode.onlyProducers,
			});
			persistPlan(plan);
			const remaining = plan.producers.filter(item => item.status !== 'CURRENT_GREEN' && item.status !== 'EXTERNAL' && item.status !== 'DEFERRED_RELEASE' && item.status !== 'SKIPPED');
			const currentGreen = plan.producers.filter(item => item.status === 'CURRENT_GREEN').length;
			const external = plan.producers.filter(item => item.status === 'EXTERNAL').length;
			const deferred = plan.producers.filter(item => item.status === 'DEFERRED_RELEASE').length;
			console.log(JSON.stringify(plan, null, 2));
			console.error(`[phase3-final-gate] validation plan ${plan.runId}${plan.reused ? ' (reused)' : ''}${plan.tier ? ` tier=${plan.tier}` : ''}`);
			console.error(`planKey ${plan.planKey}`);
			console.error(`producers ${plan.producers.length}; current-green ${currentGreen}; stale/missing ${remaining.length}; external ${external}; deferred-release ${deferred}`);
			if (plan.unknownChangedPaths?.length) {
				console.error(`[phase3-final-gate] unknown changed paths (assign a domain if they affect live behavior): ${plan.unknownChangedPaths.slice(0, 20).join(', ')}${plan.unknownChangedPaths.length > 20 ? ' …' : ''}`);
			}
			if (plan.deferredReleaseProducers?.length) {
				console.error(`[phase3-final-gate] release-only deferred: ${plan.deferredReleaseProducers.join(', ')}`);
			}
			console.error(`estimated remaining ${formatDuration(plan.totalEstimatedDurationMs)}`);
			return;
		}

		if (mode.executePlan) {
			const plan = loadPlan(mode.executePlan);
			assertPlanIdentity(plan, identity);
			const reruns = await executeValidationPlan(plan, identity, { verbose: mode.verbose, onlyProducers: mode.onlyProducers });
			const manifest = writeManifest(identity, plan, reruns);
			console.log(JSON.stringify({
				ok: manifest.overallRepositoryControlledGate,
				failures: manifest.failures,
				sourceHead: identity.sourceHead,
				productFingerprint: manifest.productFingerprint,
				validationRunId: plan.runId,
			}, null, 2));
			if (!manifest.overallRepositoryControlledGate) {
				process.exitCode = 1;
			}
			return;
		}

		if (mode.validateEvidence) {
			const manifest = writeManifest(identity, { runId: readJsonFileSafe(validationPlanPath)?.runId, producers: [] });
			console.log(JSON.stringify({
				ok: manifest.overallRepositoryControlledGate,
				failures: manifest.failures,
				sourceHead: identity.sourceHead,
				productFingerprint: manifest.productFingerprint,
			}, null, 2));
			if (!manifest.overallRepositoryControlledGate) {
				process.exitCode = 1;
			}
			return;
		}

		const planned = { producers: [] };
		const reruns = new Map();
		if (mode.rerunAll) {
			planned.producers = PHASE3_PRODUCERS.map(producer => ({ id: producer.id, status: 'STALE' }));
		} else if (mode.rerunStale) {
			const stale = classifyRequiredEvidence(identity);
			planned.producers = producersForArtifacts(stale.map(item => item.id)).map(producer => ({ id: producer.id, status: 'STALE' }));
			console.error(`[phase3-final-gate] stale/missing/red artifacts: ${stale.length === 0 ? 'none' : stale.map(item => `${item.id} (${item.reason})`).join('; ')}`);
		}
		const producersToRun = mode.rerunAll || mode.rerunStale
			? PHASE3_PRODUCERS.filter(producer => planned.producers.some(item => item.id === producer.id))
			: [];
		if (producersToRun.length) {
			console.error(`[phase3-final-gate] planned producers (${producersToRun.length}): ${producersToRun.map(item => item.id).join(', ')}`);
		}
		for (const producer of producersToRun) {
			const result = await runProcess(producer.id, producer.command[0], producer.command.slice(1), producer.timeoutMs, { verbose: mode.verbose });
			reruns.set(producer.id, result);
			for (const artifactId of producer.artifacts) {
				reruns.set(artifactId, result);
			}
			if (result.code !== 0 || result.timedOut || result.leftoverPids.length) {
				console.error(`[phase3-final-gate] stopping after ${producer.id} failure`);
				break;
			}
			if (result.leftoverPids.length) {
				await terminateOwnedProcessTree(result.harnessPid);
				killLeftoverPids(result.leftoverPids);
			}
		}

		const manifest = writeManifest(identity, { runId: undefined, producers: planned.producers }, reruns);
		console.log(JSON.stringify({
			ok: manifest.overallRepositoryControlledGate,
			failures: manifest.failures,
			sourceHead: identity.sourceHead,
			sourceFingerprint: identity.sourceFingerprint,
			plannedProducers: manifest.plannedProducers,
		}, null, 2));
		if (!manifest.overallRepositoryControlledGate) {
			process.exitCode = 1;
		}
	} finally {
		release();
	}
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

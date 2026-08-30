#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquirePhase3AcceptanceLock, processState, processTree, terminateOwnedProcessTree } from './workbenchHarness.mjs';
import { assuranceEvidenceOk } from './prebase-phase3-assurance.mjs';
import { currentSourceIdentity } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceRoot = join(repo, 'reports/graph-acceptance/phase-3-final');
const gateLogRoot = join(evidenceRoot, 'gate-logs');
export const ACTIVE_SOAK_FINAL_MIN_DURATION_MS = 10 * 60 * 1000;
const TREE_DRAIN_MS = 8_000;

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
	{ id: 'lifecycle-cycles', artifacts: ['lifecycle-cycles'], command: ['node', 'test/prebase/acceptance/prebase-process-leak-diag.mjs'], timeoutMs: 15 * 60 * 1000 },
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
	if (entry.sourceHead && evidence.sourceHead !== entry.sourceHead) {
		return { ok: false, reason: 'evidence source HEAD does not match current HEAD' };
	}
	if (entry.sourceFingerprint && evidence.sourceFingerprint !== entry.sourceFingerprint) {
		return { ok: false, reason: 'evidence source fingerprint does not match current worktree' };
	}
	if (entry.id === 'assurance') {
		return assuranceEvidenceOk(entry, evidence);
	}
	if (entry.id && evidence.scenario !== entry.id) {
		return { ok: false, reason: 'evidence scenario does not match required scenario' };
	}
	return { ok: true };
}

export const HYBRID_FIRECRAWL_EXTERNAL_REASON = 'FIRECRAWL_API_KEY unresolved (operator-owned; BETA-040 local enrichment)';

export function hybridFirecrawlExternalSkip(evidence, identity) {
	if (!evidence || evidence.missing || evidence.skipped !== true || evidence.firecrawlConfigured !== false) {
		return false;
	}
	if (!identity?.sourceHead || evidence.sourceHead !== identity.sourceHead) {
		return false;
	}
	if (!identity?.sourceFingerprint || evidence.sourceFingerprint !== identity.sourceFingerprint) {
		return false;
	}
	return true;
}

export function classifyRequiredEvidence(identity, evidenceById = undefined) {
	const stale = [];
	for (const spec of PHASE3_REQUIRED_EVIDENCE) {
		const evidence = evidenceById?.get(spec.id) ?? readJson(spec.path);
		if (spec.id === 'hybrid-web-smoke' && hybridFirecrawlExternalSkip(evidence, identity)) {
			continue;
		}
		const verdict = scenarioOk({ ...spec, sourceHead: identity.sourceHead, sourceFingerprint: identity.sourceFingerprint }, evidence);
		if (!verdict.ok) {
			stale.push({ id: spec.id, path: spec.path, reason: verdict.reason, producer: producerForArtifact(spec.id)?.id });
		}
	}
	return stale;
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

async function runProcess(id, command, args, timeoutMs) {
	mkdirSync(gateLogRoot, { recursive: true });
	const log = join(gateLogRoot, `${id}.log`);
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
		child.stdout.pipe(process.stdout);
		child.stderr.pipe(process.stderr);
		child.stdout.pipe(output);
		child.stderr.pipe(output);
		const finish = async (code) => {
			const leftoverPids = [...new Set([
				...(termination?.leftoverPids ?? []),
				...(await drainOwnedTree(child.pid)),
			])].filter(pid => processState(pid) !== 'gone');
			output.end(() => resolveRun({
				code: code ?? 1,
				timedOut,
				elapsedMs: Date.now() - startedAt,
				log,
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

function parseMode(argv) {
	const validateEvidence = argv.includes('--validate-evidence');
	const rerunStale = argv.includes('--rerun-stale') || argv.includes('--rerun-required');
	const rerunAll = argv.includes('--rerun-all') || argv.includes('--rerun-live');
	const selected = [validateEvidence, rerunStale, rerunAll].filter(Boolean).length;
	if (selected !== 1) {
		throw new Error('Specify exactly one of --validate-evidence, --rerun-stale, or --rerun-all.');
	}
	return { validateEvidence, rerunStale, rerunAll };
}

async function run() {
	const release = await acquirePhase3AcceptanceLock();
	try {
		const mode = parseMode(process.argv);
		const identity = currentSourceIdentity(repo);
		const planned = [];
		if (mode.rerunAll) {
			planned.push(...PHASE3_PRODUCERS);
		} else if (mode.rerunStale) {
			const stale = classifyRequiredEvidence(identity);
			const assurance = readJson('assurance.json');
			const assuranceVerdict = scenarioOk({ id: 'assurance', sourceHead: identity.sourceHead, sourceFingerprint: identity.sourceFingerprint }, assurance);
			planned.push(...producersForArtifacts(stale.map(item => item.id)));
			console.error(`[phase3-final-gate] stale/missing/red artifacts: ${stale.length === 0 ? 'none' : stale.map(item => `${item.id} (${item.reason})`).join('; ')}`);
			if (!assuranceVerdict.ok) {
				console.error(`[phase3-final-gate] assurance is not current (${assuranceVerdict.reason}); rerun npm run test:prebase-phase3-assurance separately`);
			}
		}
		if (planned.length) {
			console.error(`[phase3-final-gate] planned producers (${planned.length}): ${planned.map(item => item.id).join(', ')}`);
		}

		const reruns = new Map();
		for (const producer of planned) {
			console.error(`[phase3-final-gate] running ${producer.id}`);
			const result = await runProcess(producer.id, producer.command[0], producer.command.slice(1), producer.timeoutMs);
			reruns.set(producer.id, result);
			for (const artifactId of producer.artifacts) {
				reruns.set(artifactId, result);
			}
			if (result.code !== 0 || result.timedOut || result.leftoverPids.length) {
				console.error(`[phase3-final-gate] ${producer.id} ${result.timedOut ? 'timed out' : `exited ${result.code}`}${result.leftoverPids.length ? ` leftoverPids=${result.leftoverPids.join(',')}` : ''}`);
			}
			if (result.leftoverPids.length) {
				await terminateOwnedProcessTree(result.harnessPid);
				for (const pid of result.leftoverPids) {
					if (processState(pid) !== 'gone') {
						try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
					}
				}
			}
		}

		const scenarios = PHASE3_REQUIRED_EVIDENCE.map(spec => {
			const evidence = readJson(spec.path);
			const producer = producerForArtifact(spec.id);
			const rerun = reruns.get(spec.id) ?? (producer ? reruns.get(producer.id) : undefined);
			if (spec.id === 'hybrid-web-smoke' && hybridFirecrawlExternalSkip(evidence, identity)) {
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
			const verdict = scenarioOk({ ...spec, sourceHead: identity.sourceHead, sourceFingerprint: identity.sourceFingerprint }, evidence);
			if (rerun && (rerun.code !== 0 || rerun.timedOut) && verdict.ok) {
				if (rerun.timedOut && (rerun.leftoverPids?.length ?? 0) === 0) {
					return {
						id: spec.id,
						path: spec.path,
						ok: true,
						reason: verdict.reason,
						quit: evidence.quit ?? undefined,
						rerun,
					};
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
			return {
				id: spec.id,
				path: spec.path,
				ok: verdict.ok,
				reason: verdict.reason,
				quit: evidence.quit ?? undefined,
				rerun,
			};
		});
		const assurance = readJson('assurance.json');
		const assuranceVerdict = scenarioOk({ id: 'assurance', sourceHead: identity.sourceHead, sourceFingerprint: identity.sourceFingerprint }, assurance);
		const failures = scenarios.filter(item => !item.ok).map(item => `${item.id}: ${item.reason}`);
		if (!assuranceVerdict.ok) {
			failures.push(`assurance: ${assuranceVerdict.reason}`);
		}
		const externalBlockers = [
			{ id: 'gemini-provider-roundtrip', reason: 'Isolated acceptance profile has no Gemini key; classified as external compatibility smoke.' },
			{ id: 'release-signing', reason: 'Release signing credentials are operator-owned (BETA-015).' },
			...scenarios.filter(item => item.externalSkip).map(item => ({ id: item.id, reason: item.reason })),
		];
		const manifest = {
			phase: '3-final',
			sourceHead: identity.sourceHead,
			sourceFingerprint: identity.sourceFingerprint,
			generatedAt: new Date().toISOString(),
			overallRepositoryControlledGate: failures.length === 0,
			externalBlockers,
			failures,
			scenarios,
			assurance: { path: 'assurance.json', ok: assuranceVerdict.ok, reason: assuranceVerdict.reason },
			plannedProducers: planned.map(item => item.id),
		};
		writeFileSync(join(evidenceRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
		console.log(JSON.stringify({
			ok: manifest.overallRepositoryControlledGate,
			failures,
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

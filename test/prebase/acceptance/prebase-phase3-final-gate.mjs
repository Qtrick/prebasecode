#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { acquirePhase3AcceptanceLock } from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceRoot = join(repo, 'reports/graph-acceptance/phase-3-final');
const gateLogRoot = join(evidenceRoot, 'gate-logs');
export const ACTIVE_SOAK_FINAL_MIN_DURATION_MS = 10 * 60 * 1000;

export const PHASE3_REQUIRED_EVIDENCE = [
	{ id: 'electron-product-path', path: 'electron/product-path.json', rerun: ['node', 'test/prebase/acceptance/prebase-desktop-product-path.mjs', '--electron-only'], timeoutMs: 180_000 },
	{ id: 'tauri-product-path', path: 'tauri/product-path.json', rerun: ['node', 'test/prebase/acceptance/prebase-desktop-product-path.mjs', '--tauri-only'], timeoutMs: 180_000 },
	{ id: 'electron-native-cases', path: 'electron/native-cases.json' },
	{ id: 'runtime-preview', path: 'runtime-preview/live.json', rerun: ['node', 'test/prebase/acceptance/runtime-preview-live.mjs'], timeoutMs: 180_000 },
	{ id: 'temporal-small', path: 'temporal/live.json', rerun: ['node', 'graphs/scripts/acceptance/temporal-live.mjs'], timeoutMs: 180_000 },
	{ id: 'temporal-large', path: 'temporal/large-live.json', rerun: ['node', 'graphs/scripts/acceptance/temporal-live.mjs', '--large'], timeoutMs: 240_000 },
	{ id: 'magnus-electron-tools', path: 'magnus/electron-tools-live.json' },
	{ id: 'magnus-tauri-tools', path: 'magnus/tauri-tools-live.json' },
	{ id: 'magnus-streaming-smoke', path: 'magnus/streaming-smoke.json', rerun: ['node', 'test/prebase/acceptance/prebase-magnus-stream-live.mjs'], timeoutMs: 180_000 },
	{ id: 'load-quit', path: 'shutdown/load-quit-matrix.json', rerun: ['node', 'test/prebase/acceptance/prebase-load-quit-live.mjs'], timeoutMs: 240_000 },
	{ id: 'idle-soak', path: 'soak/idle.json' },
	{ id: 'electron-restart-soak', path: 'soak/electron-restart.json' },
	{ id: 'tauri-restart-soak', path: 'soak/tauri-restart.json' },
	{ id: 'core-ide', path: 'core-ide/live.json', rerun: ['node', 'test/prebase/acceptance/prebase-core-ide-live.mjs'], timeoutMs: 240_000 },
	{ id: 'code-graph', path: 'core-ide/code-graph.json' },
	{ id: 'themes-a11y', path: 'core-ide/themes-a11y.json' },
	{ id: 'privacy', path: 'privacy/runtime-observation.json', rerun: ['node', 'test/prebase/acceptance/prebase-privacy-runtime.mjs'], timeoutMs: 180_000 },
	{ id: 'parser-benchmark', path: 'performance/parser-batch.json' },
	{ id: 'active-soak', path: 'soak/active.json', rerun: ['node', 'test/prebase/acceptance/prebase-active-soak.mjs'], timeoutMs: 15 * 60 * 1000, minDurationMs: ACTIVE_SOAK_FINAL_MIN_DURATION_MS, evidenceKind: 'final' },
];

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
	if (entry.evidenceKind && evidence.evidenceKind !== entry.evidenceKind) {
		return { ok: false, reason: `expected ${entry.evidenceKind} evidence` };
	}
	if (entry.minDurationMs && (!Number.isFinite(evidence.durationMs) || evidence.durationMs < entry.minDurationMs)) {
		return { ok: false, reason: `evidence duration is below ${entry.minDurationMs}ms` };
	}
	if (entry.sourceHead && evidence.sourceHead !== entry.sourceHead && evidence.head !== entry.sourceHead) {
		return { ok: false, reason: 'evidence source HEAD does not match current HEAD' };
	}
	return { ok: true };
}

function runProcess(id, command, args, timeoutMs) {
	mkdirSync(gateLogRoot, { recursive: true });
	const log = join(gateLogRoot, `${id}.log`);
	return new Promise((resolveRun, reject) => {
		const startedAt = Date.now();
		const output = createWriteStream(log);
		let timedOut = false;
		const child = spawn(command, args, {
			cwd: repo,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, PREBASE_PHASE3_GATE_CHILD: '1' },
		});
		child.stdout.pipe(process.stdout);
		child.stderr.pipe(process.stderr);
		child.stdout.pipe(output);
		child.stderr.pipe(output);
		const deadline = setTimeout(() => {
			timedOut = true;
			output.write(`\\n[phase3-final-gate] timed out after ${timeoutMs}ms\\n`);
			child.kill('SIGTERM');
			setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
		}, timeoutMs);
		child.on('error', reject);
		child.on('close', code => {
			clearTimeout(deadline);
			output.end(() => resolveRun({ code: code ?? 1, timedOut, elapsedMs: Date.now() - startedAt, log }));
		});
	});
}

async function run() {
	const release = await acquirePhase3AcceptanceLock();
	try {
		const validateEvidence = process.argv.includes('--validate-evidence');
		const rerunLive = process.argv.includes('--rerun-live');
		if (validateEvidence === rerunLive) {
			throw new Error('Specify exactly one of --validate-evidence or --rerun-live.');
		}
		const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
		const liveOrder = [
			'core-ide',
			'magnus-streaming-smoke',
			'privacy',
			'load-quit',
			'runtime-preview',
			'temporal-small',
			'temporal-large',
			'active-soak',
		];
		const reruns = new Map();
		if (rerunLive) {
			for (const id of liveOrder) {
				const spec = PHASE3_REQUIRED_EVIDENCE.find(item => item.id === id);
				if (!spec?.rerun) {
					continue;
				}
				console.error(`[phase3-final-gate] running ${id}`);
				const result = await runProcess(id, spec.rerun[0], spec.rerun.slice(1), spec.timeoutMs ?? 120_000);
				reruns.set(id, result);
				if (result.code !== 0 || result.timedOut) {
					console.error(`[phase3-final-gate] ${id} ${result.timedOut ? 'timed out' : `exited ${result.code}`}`);
				}
			}
		}

		const scenarios = PHASE3_REQUIRED_EVIDENCE.map(spec => {
			const evidence = readJson(spec.path);
			const verdict = scenarioOk({ ...spec, sourceHead: head }, evidence);
			const rerun = reruns.get(spec.id);
			if (rerun && (rerun.code !== 0 || rerun.timedOut) && verdict.ok) {
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
		const assuranceVerdict = scenarioOk({ id: 'assurance', sourceHead: head }, assurance);
		const failures = scenarios.filter(item => !item.ok).map(item => `${item.id}: ${item.reason}`);
		if (!assuranceVerdict.ok) {
			failures.push(`assurance: ${assuranceVerdict.reason}`);
		}
		const externalBlockers = [
			{ id: 'gemini-provider-roundtrip', reason: 'Isolated acceptance profile has no Gemini key; classified as external compatibility smoke.' },
			{ id: 'release-signing', reason: 'Release signing credentials are operator-owned (BETA-015).' },
		];
		const manifest = {
			phase: '3-final',
			sourceHead: head,
			generatedAt: new Date().toISOString(),
			overallRepositoryControlledGate: failures.length === 0,
			externalBlockers,
			failures,
			scenarios,
			assurance: { path: 'assurance.json', ok: assuranceVerdict.ok, reason: assuranceVerdict.reason },
		};
		writeFileSync(join(evidenceRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
		console.log(JSON.stringify({ ok: manifest.overallRepositoryControlledGate, failures, sourceHead: head }, null, 2));
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

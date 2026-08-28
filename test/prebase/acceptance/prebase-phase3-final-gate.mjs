#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { acquirePhase3AcceptanceLock } from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceRoot = join(repo, 'reports/graph-acceptance/phase-3-final');

export const PHASE3_REQUIRED_EVIDENCE = [
	{ id: 'electron-product-path', path: 'electron/product-path.json', rerun: ['node', 'test/prebase/acceptance/prebase-desktop-product-path.mjs', '--electron-only'] },
	{ id: 'tauri-product-path', path: 'tauri/product-path.json', rerun: ['node', 'test/prebase/acceptance/prebase-desktop-product-path.mjs', '--tauri-only'] },
	{ id: 'electron-native-cases', path: 'electron/native-cases.json' },
	{ id: 'runtime-preview', path: 'runtime-preview/live.json', rerun: ['node', 'test/prebase/acceptance/runtime-preview-live.mjs'] },
	{ id: 'temporal-small', path: 'temporal/live.json', rerun: ['node', 'graphs/scripts/acceptance/temporal-live.mjs'] },
	{ id: 'temporal-large', path: 'temporal/large-live.json', rerun: ['node', 'graphs/scripts/acceptance/temporal-live.mjs', '--large'] },
	{ id: 'magnus-electron-tools', path: 'magnus/electron-tools-live.json' },
	{ id: 'magnus-tauri-tools', path: 'magnus/tauri-tools-live.json' },
	{ id: 'magnus-streaming-smoke', path: 'magnus/streaming-smoke.json', rerun: ['node', 'test/prebase/acceptance/prebase-magnus-stream-live.mjs'] },
	{ id: 'load-quit', path: 'shutdown/load-quit-matrix.json', rerun: ['node', 'test/prebase/acceptance/prebase-load-quit-live.mjs'] },
	{ id: 'idle-soak', path: 'soak/idle.json' },
	{ id: 'electron-restart-soak', path: 'soak/electron-restart.json' },
	{ id: 'tauri-restart-soak', path: 'soak/tauri-restart.json' },
	{ id: 'core-ide', path: 'core-ide/live.json', rerun: ['node', 'test/prebase/acceptance/prebase-core-ide-live.mjs'] },
	{ id: 'code-graph', path: 'core-ide/code-graph.json' },
	{ id: 'themes-a11y', path: 'core-ide/themes-a11y.json' },
	{ id: 'privacy', path: 'privacy/runtime-observation.json', rerun: ['node', 'test/prebase/acceptance/prebase-privacy-runtime.mjs'] },
	{ id: 'parser-benchmark', path: 'performance/parser-batch.json' },
	{ id: 'active-soak', path: 'soak/active.json', rerun: ['node', 'test/prebase/acceptance/prebase-active-soak.mjs'] },
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
	return { ok: true };
}

function runProcess(command, args) {
	return new Promise((resolveRun, reject) => {
		const child = spawn(command, args, {
			cwd: repo,
			stdio: 'inherit',
			env: { ...process.env, PREBASE_PHASE3_GATE_CHILD: '1' },
		});
		child.on('error', reject);
		child.on('exit', code => resolveRun(code ?? 1));
	});
}

async function run() {
	const release = await acquirePhase3AcceptanceLock();
	try {
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
		const rerunExits = new Map();
		if (process.env.PREBASE_PHASE3_SKIP_RERUN !== '1') {
			for (const id of liveOrder) {
				const spec = PHASE3_REQUIRED_EVIDENCE.find(item => item.id === id);
				if (!spec?.rerun) {
					continue;
				}
				console.error(`[phase3-final-gate] running ${id}`);
				const code = await runProcess(spec.rerun[0], spec.rerun.slice(1));
				if (code !== 0) {
					rerunExits.set(id, code);
					console.error(`[phase3-final-gate] ${id} exited ${code}`);
				}
			}
		}

		const scenarios = PHASE3_REQUIRED_EVIDENCE.map(spec => {
			const evidence = readJson(spec.path);
			const verdict = scenarioOk(spec, evidence);
			const rerunCode = rerunExits.get(spec.id);
			if (rerunCode && verdict.ok) {
				return {
					id: spec.id,
					path: spec.path,
					ok: false,
					reason: `stale evidence: live rerun exited ${rerunCode}`,
					quit: evidence.quit ?? undefined,
				};
			}
			return {
				id: spec.id,
				path: spec.path,
				ok: verdict.ok,
				reason: verdict.reason,
				quit: evidence.quit ?? undefined,
			};
		});
		const failures = scenarios.filter(item => !item.ok).map(item => `${item.id}: ${item.reason}`);
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
			assuranceSummary: 'run npm run assurance:quick and npm run assurance:static after the last source edit',
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

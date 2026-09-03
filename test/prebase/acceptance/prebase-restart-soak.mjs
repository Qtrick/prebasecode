#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFramework } from './prebase-desktop-product-path.mjs';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/soak');

async function run() {
	mkdirSync(evidenceDir, { recursive: true });
	const framework = process.argv.includes('--tauri') ? 'tauri' : 'electron';
	const cycles = Number(process.env.PREBASE_RESTART_CYCLES || (framework === 'electron' ? 20 : 10));
	const startedAt = Date.now();
	const results = [];
	for (let cycle = 1; cycle <= cycles; cycle++) {
		const result = await runFramework(framework, { writeEvidence: false });
		results.push({ cycle, ok: result.ok, failures: result.failures, state: result.state, quitMs: result.quit?.latencyMs });
		if (!result.ok) {
			break;
		}
	}
	const passed = results.filter(item => item.ok).length;
	const evidence = {
		...phase3EvidenceMetadata(repo, `${framework}-restart-soak`),
		ok: passed === cycles,
		framework,
		cycles,
		passed,
		failed: cycles - passed,
		elapsedMs: Date.now() - startedAt,
		results,
		note: 'Each cycle is a full PreBase product-path including restart/stop/child/port/Quit.',
	};
	writeFileSync(join(evidenceDir, `${framework}-restart.json`), JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify({ ok: evidence.ok, framework, passed, cycles, elapsedMs: evidence.elapsedMs }, null, 2));
	if (!evidence.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

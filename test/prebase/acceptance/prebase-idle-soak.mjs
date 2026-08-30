#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	dismissStartup,
	launchPreBase,
	processState,
	quitPreBase,
	waitForWorkbenchDriver,
} from './workbenchHarness.mjs';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/soak');

function processTree(rootPid) {
	try {
		const table = execFileSync('ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,comm='], { encoding: 'utf8' });
		const rows = table.trim().split('\n').map(line => {
			const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
			if (!match) {
				return undefined;
			}
			return { pid: Number(match[1]), ppid: Number(match[2]), cpu: Number(match[3]), rssKb: Number(match[4]), comm: match[5] };
		}).filter(Boolean);
		const children = new Map();
		for (const row of rows) {
			const list = children.get(row.ppid) ?? [];
			list.push(row);
			children.set(row.ppid, list);
		}
		const collected = [];
		const walk = (pid) => {
			const row = rows.find(item => item.pid === pid);
			if (row) {
				collected.push(row);
			}
			for (const child of children.get(pid) ?? []) {
				walk(child.pid);
			}
		};
		walk(rootPid);
		return collected;
	} catch {
		return [];
	}
}

export function soakFailures(evidence) {
	const failures = [];
	if (evidence.error) failures.push(`idle soak aborted: ${String(evidence.error).split('\n')[0]}`);
	if (!(evidence.samples?.length >= 2)) failures.push('soak did not collect samples');
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit after soak');
	const cpus = (evidence.samples ?? []).map(sample => sample.cpuSum).filter(Number.isFinite);
	if (cpus.length >= 2 && cpus.at(-1) - cpus[0] > 40) failures.push('CPU drifted upward during idle soak');
	const counts = (evidence.samples ?? []).map(sample => sample.processCount);
	if (counts.length >= 2 && counts.at(-1) - counts[0] > 4) failures.push('process count grew during idle soak');
	return failures;
}

async function run() {
	mkdirSync(evidenceDir, { recursive: true });
	const durationMs = Number(process.env.PREBASE_SOAK_MS || 15 * 60 * 1000);
	const intervalMs = Number(process.env.PREBASE_SOAK_INTERVAL_MS || 30_000);
	const launched = await launchPreBase(repo, repo);
	const evidence = {
		...phase3EvidenceMetadata(repo, 'idle-soak'),
		kind: 'idle',
		durationMs,
		intervalMs,
		prebasePid: launched.info.pid,
		samples: [],
	};
	try {
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		const deadline = Date.now() + durationMs;
		while (Date.now() <= deadline) {
			const tree = processTree(launched.info.pid);
			evidence.samples.push({
				at: new Date().toISOString(),
				processCount: tree.length,
				cpuSum: Number(tree.reduce((sum, row) => sum + row.cpu, 0).toFixed(1)),
				rssMb: Number((tree.reduce((sum, row) => sum + row.rssKb, 0) / 1024).toFixed(1)),
				processes: tree.map(row => ({ pid: row.pid, ppid: row.ppid, cpu: row.cpu, rssMb: Number((row.rssKb / 1024).toFixed(1)), comm: row.comm })),
			});
			const waitMs = Math.min(intervalMs, Math.max(250, deadline - Date.now()));
			if (waitMs > 0) {
				await new Promise(resolveWait => setTimeout(resolveWait, waitMs));
			}
		}
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		evidence.quit = await quitPreBase(launched.info.pid);
		evidence.remaining = processState(launched.info.pid);
	}
	const failures = soakFailures(evidence);
	const result = { ...evidence, ok: failures.length === 0 && !evidence.error, failures };
	writeFileSync(join(evidenceDir, 'idle.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures, samples: evidence.samples.length, durationMs, quit: evidence.quit }, null, 2));
	process.exit(result.ok ? 0 : 1);
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	dismissStartup,
	gracefulWorkbenchQuit,
	launchPreBase,
	processTree,
	waitForWorkbenchDriver,
	workbenchCommand,
} from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/soak');

async function runActivity(page) {
	await page.getByRole('tab', { name: 'PreBase Maps', exact: true }).click().catch(() => undefined);
	await page.getByRole('button', { name: 'Code Graph', exact: true }).click().catch(() => undefined);
	await page.waitForTimeout(2_000);
	await page.getByRole('button', { name: 'Temporal', exact: true }).click().catch(() => undefined);
	await page.waitForTimeout(2_000);
	await workbenchCommand(page, 'prebase.graph.openNetwork').catch(() => undefined);
	await page.waitForTimeout(1_500);
	await workbenchCommand(page, 'workbench.view.prebase.runtime').catch(() => undefined);
	await page.waitForTimeout(1_000);
}

async function run() {
	mkdirSync(evidenceDir, { recursive: true });
	const durationMs = Number(process.env.PREBASE_ACTIVE_SOAK_MS || 12 * 60 * 1000);
	const intervalMs = Number(process.env.PREBASE_SOAK_INTERVAL_MS || 30_000);
	const launched = await launchPreBase(repo, repo);
	const evidence = {
		kind: 'active',
		durationMs,
		intervalMs,
		prebasePid: launched.info.pid,
		samples: [],
	};
	try {
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		const start = Date.now();
		const activityEnd = start + Math.floor(durationMs * 0.65);
		const end = start + durationMs;
		while (Date.now() < end) {
			if (Date.now() < activityEnd) {
				await runActivity(launched.page);
			}
			const tree = processTree(launched.info.pid);
			evidence.samples.push({
				at: new Date().toISOString(),
				phase: Date.now() < activityEnd ? 'active' : 'quiesce',
				processCount: tree.length,
				cpuSum: Number(tree.reduce((sum, row) => sum + row.cpu, 0).toFixed(1)),
				rssMb: Number((tree.reduce((sum, row) => sum + row.rssKb, 0) / 1024).toFixed(1)),
			});
			await launched.page.waitForTimeout(intervalMs);
		}
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		evidence.quit = await gracefulWorkbenchQuit(launched.page, launched.info.pid);
	}
	const active = evidence.samples.filter(sample => sample.phase === 'active');
	const quiesce = evidence.samples.filter(sample => sample.phase === 'quiesce');
	const failures = [];
	if (active.length < 1) failures.push('active soak did not collect active samples');
	if (quiesce.length < 2) failures.push('active soak did not collect quiesce samples');
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit after active soak');
	const counts = evidence.samples.map(sample => sample.processCount);
	if (counts.length >= 2 && counts.at(-1) - counts[0] > 6) failures.push('process count grew excessively during active soak');
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(evidenceDir, 'active.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures, samples: evidence.samples.length, durationMs, quit: evidence.quit }, null, 2));
	if (!result.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

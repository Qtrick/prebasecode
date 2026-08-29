#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	acquirePhase3AcceptanceLock,
	dismissStartup,
	gracefulWorkbenchQuit,
	launchPreBase,
	processTree,
	summarizeProcessTree,
	waitForWorkbenchDriver,
	workbenchCommandWithTimeout,
} from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/soak');
export const ACTIVE_SOAK_FINAL_MIN_DURATION_MS = 10 * 60 * 1000;

function isolatedFixtureWorkspace() {
	const dest = mkdtempSync(join(tmpdir(), 'pb-active-soak-ws-'));
	cpSync(join(repo, 'test/fixtures/typescript-lanes'), dest, { recursive: true });
	execFileSync('git', ['init'], { cwd: dest, stdio: 'pipe' });
	execFileSync('git', ['add', '.'], { cwd: dest, stdio: 'pipe' });
	execFileSync('git', ['-c', 'user.email=soak@prebase.test', '-c', 'user.name=Soak', 'commit', '--no-gpg-sign', '-m', 'soak fixture'], { cwd: dest, stdio: 'pipe' });
	return dest;
}

async function boundedClick(page, role, name, timeout = 2_500) {
	const locator = page.getByRole(role, { name, exact: true });
	if (await locator.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false)) {
		await locator.first().click({ timeout }).catch(() => undefined);
	}
}

async function runActivityOnce(page) {
	await boundedClick(page, 'tab', 'PreBase Maps');
	await boundedClick(page, 'button', 'Code Graph');
	await page.waitForTimeout(400);
	await boundedClick(page, 'button', 'Temporal');
	await page.waitForTimeout(400);
	await boundedClick(page, 'button', 'Full Map');
	await boundedClick(page, 'button', 'Focus Changes');
	await workbenchCommandWithTimeout(page, 8_000, 'workbench.view.prebase.runtime').catch(() => undefined);
	await workbenchCommandWithTimeout(page, 8_000, 'prebase.magnus.open').catch(() => undefined);
}

function sample(pid, phase) {
	const tree = processTree(pid);
	return {
		at: new Date().toISOString(),
		phase,
		processCount: tree.length,
		cpuSum: Number(tree.reduce((sum, row) => sum + row.cpu, 0).toFixed(1)),
		rssMb: Number((tree.reduce((sum, row) => sum + row.rssKb, 0) / 1024).toFixed(1)),
		topProcesses: summarizeProcessTree(tree, 8),
	};
}

export function activeSoakFailures(evidence) {
	const failures = [];
	if (evidence.activityError) failures.push(`active soak activity failed: ${evidence.activityError}`);
	const active = evidence.samples?.filter(item => item.phase === 'active') ?? [];
	const quiesce = evidence.samples?.filter(item => item.phase === 'quiesce') ?? [];
	if (active.length < 4) failures.push('active soak did not collect enough independent active samples');
	if (quiesce.length < 2) failures.push('active soak did not collect quiesce samples');
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit after active soak');
	if (evidence.quit?.usedSigkill || evidence.quit?.terminationPath === 'sigkill') {
		failures.push('active soak required SIGKILL');
	}
	const lastQuiesce = quiesce.slice(-2);
	if (lastQuiesce.length && lastQuiesce.every(item => item.cpuSum >= 90)) {
		failures.push(`quiescent CPU remained ~100% (${lastQuiesce.map(item => item.cpuSum).join(', ')})`);
	}
	const lastRenderer = lastQuiesce.map(item => item.topProcesses?.find(row => row.role === 'renderer')?.cpu).filter(cpu => Number.isFinite(cpu));
	if (lastRenderer.length && lastRenderer.every(cpu => cpu >= 40)) {
		failures.push(`quiescent renderer CPU remained high (${lastRenderer.join(', ')})`);
	}
	return failures;
}

async function run() {
	const release = await acquirePhase3AcceptanceLock();
	mkdirSync(evidenceDir, { recursive: true });
	const durationMs = Number(process.env.PREBASE_ACTIVE_SOAK_MS || 12 * 60 * 1000);
	const intervalMs = Number(process.env.PREBASE_SOAK_INTERVAL_MS || 20_000);
	const evidenceKind = durationMs >= ACTIVE_SOAK_FINAL_MIN_DURATION_MS ? 'final' : 'diagnostic';
	let launched;
	const evidence = {
		kind: 'active',
		evidenceKind,
		sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
		durationMs,
		intervalMs,
		samples: [],
	};
	let activityError;
	try {
		launched = await launchPreBase(repo, isolatedFixtureWorkspace());
		evidence.prebasePid = launched.info.pid;
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		const start = Date.now();
		const activityEnd = start + Math.floor(durationMs * 0.65);
		const end = start + durationMs;
		let activityPromise = Promise.resolve();
		let activityRunning = false;
		const queueActivity = () => {
			if (activityRunning || Date.now() >= activityEnd) {
				return;
			}
			activityRunning = true;
			activityPromise = runActivityOnce(launched.page)
				.catch(error => { activityError = String(error); })
				.finally(() => { activityRunning = false; });
		};
		queueActivity();
		let closedForQuiesce = false;
		while (Date.now() < end) {
			if (!closedForQuiesce && Date.now() >= activityEnd) {
				closedForQuiesce = true;
				await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.closeAllEditors').catch(() => undefined);
				await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.closePanel').catch(() => undefined);
				await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.closeSidebar').catch(() => undefined);
				await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.closeAuxiliaryBar').catch(() => undefined);
			}
			evidence.samples.push(sample(launched.info.pid, Date.now() < activityEnd ? 'active' : 'quiesce'));
			if (Date.now() < activityEnd && !activityRunning) {
				queueActivity();
			}
			const waitMs = Math.min(intervalMs, Math.max(250, end - Date.now()));
			await new Promise(resolveWait => setTimeout(resolveWait, waitMs));
		}
		await activityPromise;
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		if (launched) {
			evidence.quit = await gracefulWorkbenchQuit(launched.page, launched.info.pid);
		}
		release();
	}
	if (activityError && !evidence.error) {
		evidence.activityError = activityError;
	}
	const failures = activeSoakFailures(evidence);
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(evidenceDir, evidenceKind === 'final' ? 'active.json' : 'active-diagnostic.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures, samples: evidence.samples.length, durationMs, quit: evidence.quit }, null, 2));
	if (!result.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

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
	classifyProcessRole,
	processTree,
	summarizeProcessTree,
	waitForWorkbenchDriver,
	workbenchCommandWithTimeout,
} from './workbenchHarness.mjs';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';
import { activePhaseResourceFailures, monotonicGrowth } from './prebase-process-leak-diag.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/soak');
export const ACTIVE_SOAK_FINAL_MIN_DURATION_MS = 10 * 60 * 1000;

export function activeSoakEvidenceTarget(durationMs) {
	const evidenceKind = durationMs >= ACTIVE_SOAK_FINAL_MIN_DURATION_MS ? 'final' : 'diagnostic';
	return {
		evidenceKind,
		fileName: evidenceKind === 'final' ? 'active.json' : 'active-diagnostic.json',
	};
}

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
	// Reclaim editor/webview surfaces between cycles so active-phase growth is product-owned, not harness accumulation.
	await workbenchCommandWithTimeout(page, 8_000, 'workbench.action.closeAllEditors').catch(() => undefined);
	await workbenchCommandWithTimeout(page, 8_000, 'workbench.action.closePanel').catch(() => undefined);
}

async function sample(page, pid, phase) {
	const tree = processTree(pid);
	const diagnostics = await workbenchCommandWithTimeout(page, 5_000, 'prebase.test.getDiagnostics').catch(() => undefined);
	const inventory = diagnostics?.webContents;
	const roles = {};
	for (const row of tree) {
		const role = classifyProcessRole(row.comm, row.command);
		roles[role] = (roles[role] ?? 0) + 1;
	}
	return {
		at: new Date().toISOString(),
		phase,
		processCount: tree.length,
		roles,
		cpuSum: Number(tree.reduce((sum, row) => sum + row.cpu, 0).toFixed(1)),
		rssMb: Number((tree.reduce((sum, row) => sum + row.rssKb, 0) / 1024).toFixed(1)),
		topProcesses: summarizeProcessTree(tree, 8),
		webContentsLiveCount: Number.isFinite(inventory?.liveCount) ? inventory.liveCount : undefined,
		webContentsLiveIds: Array.isArray(inventory?.liveIds) ? inventory.liveIds : [],
		runtimePreviewStatus: typeof diagnostics?.runtimePreviewStatus === 'string' ? diagnostics.runtimePreviewStatus : undefined,
		parserActiveRequests: Number(diagnostics?.parserActiveRequests ?? 0),
		temporalActiveWrites: Number(diagnostics?.temporalActiveWrites ?? 0),
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
	const quiesceLive = quiesce.map(item => item.webContentsLiveCount).filter(count => Number.isFinite(count));
	if (quiesce.length >= 3 && quiesceLive.length < 3) {
		failures.push('soak quiescence did not record live WebContents counts');
	}
	if (monotonicGrowth(quiesceLive)) {
		failures.push('live WebContents count grew monotonically during soak quiescence');
	}
	const quiesceProcesses = quiesce.map(item => item.processCount).filter(count => Number.isFinite(count));
	if (monotonicGrowth(quiesceProcesses, 2)) {
		failures.push('owned process count grew monotonically during soak quiescence');
	}
	failures.push(...activePhaseResourceFailures(evidence.samples ?? []));
	return failures;
}

async function run() {
	const release = await acquirePhase3AcceptanceLock();
	mkdirSync(evidenceDir, { recursive: true });
	const durationMs = Number(process.env.PREBASE_ACTIVE_SOAK_MS || 12 * 60 * 1000);
	const intervalMs = Number(process.env.PREBASE_SOAK_INTERVAL_MS || 20_000);
	const { evidenceKind, fileName } = activeSoakEvidenceTarget(durationMs);
	let launched;
	const evidence = {
		...phase3EvidenceMetadata(repo, 'active-soak'),
		kind: 'active',
		evidenceKind,
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
			evidence.samples.push(await sample(launched.page, launched.info.pid, Date.now() < activityEnd ? 'active' : 'quiesce'));
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
	const result = { ...evidence, ok: failures.length === 0 && !evidence.error, failures };
	writeFileSync(join(evidenceDir, fileName), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures, samples: evidence.samples.length, durationMs, quit: evidence.quit }, null, 2));
	process.exit(result.ok ? 0 : 1);
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const execFileAsync = promisify(execFile);

export function processState(pid) {
	try {
		return execFileSync('ps', ['-o', 'pid=,ppid=,pcpu=,rss=,comm=', '-p', String(pid)], { encoding: 'utf8' }).trim() || 'gone';
	} catch {
		return 'gone';
	}
}

export function portOwners(port) {
	try {
		return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number);
	} catch {
		return [];
	}
}

export async function waitFor(predicate, timeoutMs = 45_000, intervalMs = 200) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await predicate();
		if (value) {
			return value;
		}
		await new Promise(resolveWait => setTimeout(resolveWait, intervalMs));
	}
	return undefined;
}

export async function dismissStartup(page, options = {}) {
	const skipOffline = Boolean(options.skipOffline);
	let trustDismissed = false;
	let offlineDismissed = false;
	let offlinePromptSeen = false;
	let onboardingVisible = false;
	let onboardingDismissed = false;
	const trust = page.getByRole('button', { name: /Yes, I trust the authors/i });
	if (await trust.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true, () => false)) {
		await trust.click();
		trustDismissed = true;
	}
	if (await page.locator('.prebase-onboarding').first().waitFor({ state: 'visible', timeout: 2_000 }).then(() => true, () => false)) {
		onboardingVisible = true;
	}
	const signInDialog = page.getByRole('dialog', { name: 'Sign in to PreBase' });
	if (await signInDialog.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true, () => false)) {
		onboardingVisible = true;
	}
	const offline = page.getByRole('button', { name: 'Continue Offline', exact: true });
	if (!skipOffline && await offline.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
		offlinePromptSeen = true;
		await offline.click();
		offlineDismissed = true;
		await signInDialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
	} else if (!onboardingVisible) {
		onboardingDismissed = true;
	}
	return { trustDismissed, offlineDismissed, offlinePromptSeen, onboardingVisible, onboardingDismissed };
}

/**
 * Complete the Welcome to PreBase onboarding editor when it appears after offline gate.
 * Returns distinct lifecycle facts for P2 fail-closed acceptance.
 */
export async function completeOnboardingWelcomeFlow(page) {
	const result = {
		offlineChoicePresented: false,
		offlineChoiceActivated: false,
		onboardingPresented: false,
		onboardingCompleted: false,
		onboardingPersisted: false,
		onboardingReopened: false,
		onboardingReturnSessionCorrect: false,
		onboardingDismissed: false,
		onboardingVisible: false,
	};
	const offline = page.getByRole('button', { name: 'Continue Offline', exact: true });
	if (await offline.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
		result.offlineChoicePresented = true;
		await offline.click();
		result.offlineChoiceActivated = true;
	}
	const welcome = page.locator('.prebase-onboarding').first();
	if (await welcome.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true, () => false)) {
		result.onboardingPresented = true;
		result.onboardingVisible = true;
		for (let step = 0; step < 8; step++) {
			const finish = page.getByRole('button', { name: 'Finish', exact: true });
			if (await finish.isVisible().catch(() => false)) {
				await finish.click({ timeout: 4_000 }).catch(() => undefined);
				break;
			}
			const cont = page.getByRole('button', { name: 'Continue', exact: true });
			if (await cont.isVisible().catch(() => false)) {
				await cont.click({ timeout: 4_000 }).catch(() => undefined);
			} else {
				const skip = page.getByRole('button', { name: 'Skip', exact: true });
				if (await skip.isVisible().catch(() => false)) {
					await skip.click({ timeout: 4_000 }).catch(() => undefined);
				}
			}
			await page.waitForTimeout(400);
		}
		await welcome.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined);
		result.onboardingCompleted = !(await welcome.isVisible().catch(() => false));
		result.onboardingDismissed = result.onboardingCompleted;
		result.onboardingVisible = !result.onboardingCompleted;
	}
	const diag = await workbenchCommandWithTimeout(page, 6_000, 'prebase.test.getDiagnostics').catch(() => null);
	result.onboardingPersisted = Boolean(diag?.onboardingComplete);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+R' : 'Control+R').catch(() => undefined);
	await workbenchCommandWithTimeout(page, 4_000, 'workbench.action.reloadWindow').catch(() => undefined);
	await waitForWorkbenchDriver(page, 90_000);
	const afterReload = await workbenchCommandWithTimeout(page, 8_000, 'prebase.test.getDiagnostics').catch(() => null);
	result.onboardingPersisted = Boolean(afterReload?.onboardingComplete);
	await workbenchCommandWithTimeout(page, 8_000, 'prebase.onboarding.open').catch(() => undefined);
	result.onboardingReopened = await page.locator('.prebase-onboarding').first().isVisible().catch(() => false)
		|| await page.getByText('Welcome to PreBase').first().isVisible().catch(() => false);
	await workbenchCommandWithTimeout(page, 8_000, 'prebase.onboarding.reset').catch(() => undefined);
	const afterReset = await workbenchCommandWithTimeout(page, 8_000, 'prebase.test.getDiagnostics').catch(() => null);
	result.onboardingReturnSessionCorrect = result.onboardingReopened
		&& result.onboardingPersisted
		&& Boolean(afterReset?.onboardingComplete === false || afterReset?.onboardingComplete === undefined);
	return result;
}

/** P2 passes only when offline onboarding was dismissed or never appeared. */
export function p2OfflineOnboardingProven(startupResult) {
	if (!startupResult || typeof startupResult !== 'object') {
		return false;
	}
	if (startupResult.offlineDismissed) {
		return true;
	}
	return startupResult.offlinePromptSeen === false;
}

export async function quitPreBase(pid) {
	const before = processState(pid);
	const startedAt = Date.now();
	try {
		process.kill(pid, 'SIGTERM');
	} catch {
		/* already gone */
	}
	const gone = await waitFor(() => processState(pid) === 'gone', 20_000, 100);
	if (!gone) {
		try {
			process.kill(pid, 'SIGKILL');
		} catch {
			/* already gone */
		}
		await waitFor(() => processState(pid) === 'gone', 5_000, 100);
	}
	return { before, latencyMs: Date.now() - startedAt, remaining: processState(pid) };
}

export async function workbenchCommand(page, commandId, ...args) {
	return page.evaluate(async ({ id, commandArgs }) => {
		const driver = window.driver;
		if (!driver || typeof driver.executeCommand !== 'function') {
			throw new Error('window.driver.executeCommand is unavailable; launch PreBase with --enable-smoke-test-driver');
		}
		return driver.executeCommand(id, ...commandArgs);
	}, { id: commandId, commandArgs: args });
}

export async function recoverHungWorkbenchPage(page, timeoutMs = 60_000) {
	await Promise.race([
		(async () => {
			// Playwright serializes page.evaluate calls; a timed-out command can still block the queue.
			// Navigation aborts the hung evaluate so later harness commands can proceed.
			if (typeof page.reload === 'function') {
				await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => undefined);
			}
			await waitForWorkbenchDriver(page, timeoutMs);
		})(),
		new Promise((_, reject) => {
			setTimeout(() => reject(new Error(`recoverHungWorkbenchPage timeout (${timeoutMs}ms)`)), timeoutMs);
		}),
	]).catch(() => undefined);
}

export async function workbenchCommandWithTimeout(page, timeoutMs, commandId, ...args) {
	const previous = 12_000;
	page.setDefaultTimeout(timeoutMs);
	const evaluateOptions = { timeout: timeoutMs }; // Playwright evaluate ignores this; Promise.race is authoritative.
	let timer;
	const evaluatePromise = page.evaluate(async ({ id, commandArgs }) => {
		const driver = window.driver;
		if (!driver || typeof driver.executeCommand !== 'function') {
			throw new Error('window.driver.executeCommand is unavailable; launch PreBase with --enable-smoke-test-driver');
		}
		return driver.executeCommand(id, ...commandArgs);
	}, { id: commandId, commandArgs: args });
	evaluatePromise.catch(() => undefined);
	try {
		return await Promise.race([
			evaluatePromise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(`workbench command timeout (${timeoutMs}ms): ${commandId}`)), evaluateOptions.timeout);
			}),
		]);
	} finally {
		clearTimeout(timer);
		page.setDefaultTimeout(previous);
	}
}

export async function invokeLanguageModelTool(page, toolId, parameters = {}) {
	return workbenchCommand(page, 'prebase.test.invokeLanguageModelTool', toolId, parameters);
}

const SECRET_ARG_PATTERN = /\b(authorization|token|key|secret|password|bearer)=([^\s]+)/gi;

export function redactCommandLine(command = '') {
	return String(command)
		.replace(SECRET_ARG_PATTERN, '$1=[redacted]')
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
		.replace(/\bAIza[A-Za-z0-9_-]{10,}\b/g, '[redacted]');
}

export function classifyProcessRole(comm = '', command = '') {
	const text = `${comm} ${command}`.toLowerCase();
	if (/--type=gpu-process|type=gpu-process|\bgpu\b/i.test(text)) return 'gpu';
	if (/--type=renderer|type=renderer|helper \(renderer\)/i.test(text)) return 'renderer';
	if (/--utility-sub-type=network|network\s*service|networkservice/i.test(text)) return 'networkService';
	if (/--type=utility|type=utility/i.test(text)) {
		if (/extensionhost|extension-host/i.test(text)) return 'extensionHost';
		if (/tsserver/i.test(text)) return 'tsserver';
		return 'utility';
	}
	if (/extensionhost|extension-host|exthost/i.test(text)) return 'extensionHost';
	if (/tsserver|typescript.*tsserver/i.test(text)) return 'tsserver';
	if (/ptyhost|pty-host|conpty/i.test(text)) return 'ptyHost';
	if (/(^|[\\/])git([\\/\s.-]|$)/i.test(text)) return 'git';
	if (/parser|canonical/i.test(text)) return 'parser';
	if (/cargo|tauri/i.test(text)) return 'tauriChild';
	if (/code helper|prebase helper/i.test(text) && /helper/.test(text)) return 'helper';
	if (/electron|prebase|code helper|code - oss/i.test(text)) return 'main';
	return 'other';
}

export function summarizeProcessTree(tree, limit = 8) {
	return [...tree]
		.sort((a, b) => b.cpu - a.cpu || b.rssKb - a.rssKb)
		.slice(0, limit)
		.map(row => ({
			pid: row.pid,
			ppid: row.ppid,
			cpu: row.cpu,
			rssMb: Number((row.rssKb / 1024).toFixed(1)),
			role: classifyProcessRole(row.comm, row.command),
			comm: redactCommandLine(String(row.comm ?? '')).slice(0, 80),
		}));
}

export function sampleProcessTreeSockets(pids) {
	if (!pids.length) {
		return [];
	}
	try {
		const output = execFileSync('lsof', ['-a', '-P', '-iTCP', '-p', pids.join(',')], {
			encoding: 'utf8',
			timeout: 8_000,
		});
		const rows = [];
		for (const line of output.split('\n').slice(1)) {
			const match = line.match(/^\S+\s+(\d+)\s+.*?\s(TCP|UDP)\s+(\S+)/);
			if (!match) {
				continue;
			}
			const peer = match[3];
			const hostMatch = peer.match(/->([^:\s]+):(\d+)/) || peer.match(/([^:\s]+):(\d+)/);
			if (!hostMatch) {
				continue;
			}
			rows.push({ pid: Number(match[1]), host: hostMatch[1], port: Number(hostMatch[2]) });
		}
		return rows;
	} catch {
		return [];
	}
}

const LOCK_DIR = join(tmpdir(), 'prebase-phase3-acceptance.lock');

function lockPidAlive() {
	try {
		const pid = Number(readFileSync(join(LOCK_DIR, 'pid'), 'utf8'));
		if (!Number.isFinite(pid) || pid === process.pid) {
			return false;
		}
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function describePhase3AcceptanceLock() {
	try {
		const pid = Number(readFileSync(join(LOCK_DIR, 'pid'), 'utf8'));
		let scenario = 'unknown';
		let startedAt;
		try {
			const meta = JSON.parse(readFileSync(join(LOCK_DIR, 'meta.json'), 'utf8'));
			if (typeof meta.scenario === 'string' && meta.scenario.trim()) {
				scenario = meta.scenario.trim();
			}
			if (typeof meta.startedAt === 'string') {
				startedAt = meta.startedAt;
			}
		} catch {
			/* pid-only lock from older harness */
		}
		const ageMs = startedAt && Number.isFinite(Date.parse(startedAt)) ? Date.now() - Date.parse(startedAt) : undefined;
		return { pid, scenario, startedAt, ageMs, alive: lockPidAlive(), lockDir: LOCK_DIR };
	} catch {
		return undefined;
	}
}

export function formatPhase3LockBlockMessage(owner, stale = false) {
	const pid = owner?.pid ?? 'unknown';
	const scenario = owner?.scenario ?? 'unknown';
	const age = Number.isFinite(owner?.ageMs) ? `${Math.round(owner.ageMs / 1000)}s` : 'unknown';
	const kind = stale ? 'stale' : 'active';
	return `[phase3-lock] ${kind} owner pid=${pid} scenario=${scenario} age=${age} lockDir=${owner?.lockDir ?? LOCK_DIR}`;
}

export async function acquirePhase3AcceptanceLock(scenario = process.env.PREBASE_PHASE3_SCENARIO || basename(process.argv[1] ?? 'unknown')) {
	if (process.env.PREBASE_PHASE3_GATE_CHILD === '1') {
		return () => undefined;
	}
	for (let attempt = 0; attempt < 180; attempt++) {
		try {
			mkdirSync(LOCK_DIR);
			writeFileSync(join(LOCK_DIR, 'pid'), String(process.pid));
			writeFileSync(join(LOCK_DIR, 'meta.json'), JSON.stringify({
				pid: process.pid,
				scenario,
				startedAt: new Date().toISOString(),
			}));
			return () => {
				try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
			};
		} catch {
			const owner = describePhase3AcceptanceLock();
			if (!lockPidAlive()) {
				console.error(formatPhase3LockBlockMessage(owner, true));
				try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
				continue;
			}
			if (attempt === 0) {
				console.error(formatPhase3LockBlockMessage(owner, false));
			}
			await new Promise(resolveWait => setTimeout(resolveWait, 1_000));
		}
	}
	const owner = describePhase3AcceptanceLock();
	throw new Error(`Another Phase 3 PreBase acceptance instance is active (pid=${owner?.pid} scenario=${owner?.scenario} ageMs=${owner?.ageMs}); resource tests must run sequentially.`);
}

function collectOwnedPids(rootPid, ownedPids) {
	ownedPids.add(rootPid);
	for (const row of processTree(rootPid)) {
		ownedPids.add(row.pid);
	}
	return ownedPids;
}

function remainingOwnedPids(ownedPids) {
	return [...ownedPids].filter(pid => processState(pid) !== 'gone');
}

function signalPids(pids, signal) {
	for (const pid of pids.slice().reverse()) {
		try { process.kill(pid, signal); } catch { /* already gone */ }
	}
}

function signalProcessTree(rootPid, signal, ownedPids) {
	collectOwnedPids(rootPid, ownedPids);
	signalPids(remainingOwnedPids(ownedPids), signal);
}

function treeGone(rootPid, ownedPids) {
	collectOwnedPids(rootPid, ownedPids);
	return processState(rootPid) === 'gone' && remainingOwnedPids(ownedPids).length === 0;
}

/**
 * Terminate a test-owned process tree (harness + Electron/Tauri/npm descendants).
 * Collects descendants before signalling so a dead parent cannot hide children.
 */
export async function terminateOwnedProcessTree(rootPid, { termMs = 5_000, killMs = 3_000 } = {}) {
	const ownedPids = collectOwnedPids(rootPid, new Set());
	if (remainingOwnedPids(ownedPids).length === 0 && processState(rootPid) === 'gone') {
		return { leftoverPids: [], ownedPids: [...ownedPids], usedSigkill: false };
	}
	signalProcessTree(rootPid, 'SIGTERM', ownedPids);
	await waitFor(() => treeGone(rootPid, ownedPids), termMs, 100);
	let usedSigkill = false;
	if (!treeGone(rootPid, ownedPids)) {
		usedSigkill = true;
		signalProcessTree(rootPid, 'SIGKILL', ownedPids);
		await waitFor(() => treeGone(rootPid, ownedPids), killMs, 100);
	}
	return { leftoverPids: remainingOwnedPids(ownedPids), ownedPids: [...ownedPids], usedSigkill };
}

export async function gracefulWorkbenchQuit(page, pid) {
	const startedAt = Date.now();
	const before = processState(pid);
	let terminationPath = 'workbench';
	const ownedPids = collectOwnedPids(pid, new Set());
	try {
		await workbenchCommandWithTimeout(page, 4_000, 'workbench.action.quit');
	} catch {
		/* command timeout or teardown */
	}
	for (const name of ['Quit', 'Terminate', 'Close Anyway', 'Don\'t Save']) {
		const button = page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') });
		if (await button.first().waitFor({ state: 'visible', timeout: 800 }).then(() => true, () => false)) {
			await button.last().click({ timeout: 800 }).catch(() => undefined);
		}
	}
	let workbenchCompleted = Boolean(await waitFor(() => treeGone(pid, ownedPids), 6_000, 100));
	if (!workbenchCompleted) {
		terminationPath = 'sigterm';
		signalProcessTree(pid, 'SIGTERM', ownedPids);
		await waitFor(() => treeGone(pid, ownedPids), 4_000, 100);
	}
	if (!treeGone(pid, ownedPids)) {
		terminationPath = 'sigkill';
		signalProcessTree(pid, 'SIGKILL', ownedPids);
		await waitFor(() => treeGone(pid, ownedPids), 3_000, 100);
	}
	const leftover = remainingOwnedPids(ownedPids);
	return {
		before,
		remaining: leftover.length === 0 ? 'gone' : 'tree',
		leftoverPids: leftover,
		latencyMs: Date.now() - startedAt,
		terminationPath,
		workbenchCompleted,
		usedSigterm: terminationPath === 'sigterm' || terminationPath === 'sigkill',
		usedSigkill: terminationPath === 'sigkill',
	};
}

export function processTree(rootPid) {
	try {
		const table = execFileSync('ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,command='], { encoding: 'utf8' });
		const rows = table.trim().split('\n').map(line => {
			const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
			if (!match) {
				return undefined;
			}
			const fullCommand = match[5];
			const comm = fullCommand.split(/\s+/)[0] || '';
			return { pid: Number(match[1]), ppid: Number(match[2]), cpu: Number(match[3]), rssKb: Number(match[4]), comm, command: fullCommand };
		}).filter(Boolean);
		const children = new Map();
		for (const row of rows) {
			const list = children.get(row.ppid) ?? [];
			list.push(row);
			children.set(row.ppid, list);
		}
		const collected = [];
		const walk = pid => {
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

export async function waitForWorkbenchDriver(page, timeoutMs = 90_000) {
	await page.waitForFunction(() => window.driver && typeof window.driver.executeCommand === 'function' && typeof window.driver.whenWorkbenchRestored === 'function', null, { timeout: timeoutMs });
	let timer;
	const restored = page.evaluate(() => window.driver.whenWorkbenchRestored());
	restored.catch(() => undefined);
	try {
		await Promise.race([
			restored,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(`whenWorkbenchRestored timeout (${timeoutMs}ms)`)), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export async function launchPreBase(repo, workspace, extraArgs = [], options = {}) {
	const sourceProfile = options.userDataDir || mkdtempSync(join(tmpdir(), 'pb-phase3-profile-'));
	const launch = join(repo, '.agents/skills/launch/scripts/launch.sh');
	const { stdout } = await execFileAsync(launch, [
		'--repo', repo,
		'--source-user-data-dir', sourceProfile,
		'--',
		'--enable-smoke-test-driver',
		'--disable-workspace-trust',
		'--skip-release-notes',
		'--skip-welcome',
		...extraArgs,
		workspace,
	], {
		cwd: repo,
		env: {
			...process.env,
			HTTP_PROXY: '',
			HTTPS_PROXY: '',
			ALL_PROXY: '',
			CODE_OSS_DEV_AUTHED_USER_DATA_DIR: sourceProfile,
		},
		maxBuffer: 10 * 1024 * 1024,
	});
	const info = JSON.parse(stdout.trim().split('\n').findLast(line => line.startsWith('{')));
	try {
		const browser = await chromium.connectOverCDP(`http://127.0.0.1:${info.cdpPort}`);
		const page = await waitFor(async () => {
			return browser.contexts()
				.flatMap(context => context.pages())
				.find(candidate => candidate.url().includes('workbench'));
		}, 45_000, 250);
		if (!page) {
			throw new Error('Workbench page not found');
		}
		page.setDefaultTimeout(12_000);
		return { info, browser, page, sourceProfile };
	} catch (error) {
		const ownedPids = new Set();
		signalProcessTree(info.pid, 'SIGTERM', ownedPids);
		throw error;
	}
}

export async function findGraphFrame(page) {
	for (const frame of page.frames()) {
		if (frame.url().includes('graph-editor')) {
			return frame;
		}
		const count = await frame.locator('#netCanvas').count().catch(() => 0);
		if (count > 0) {
			return frame;
		}
	}
	return undefined;
}

export async function attachCdpNetworkObserver(page) {
	const requests = [];
	const session = await page.context().newCDPSession(page);
	let disposed = false;
	const onRequest = event => {
		if (disposed) {
			return;
		}
		const url = event.request?.url;
		if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
			return;
		}
		try {
			const parsed = new URL(url);
			if (requests.length >= 400) {
				requests.shift();
			}
			requests.push({
				host: parsed.hostname,
				origin: parsed.origin,
				url: url.slice(0, 240),
				source: 'cdp',
				type: event.type,
			});
		} catch {
			/* ignore */
		}
	};
	try {
		await session.send('Network.enable');
	} catch (error) {
		try { await session.detach(); } catch { /* ignore */ }
		throw error;
	}
	session.on('Network.requestWillBeSent', onRequest);
	return {
		requests,
		async dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			if (typeof session.off === 'function') {
				session.off('Network.requestWillBeSent', onRequest);
			} else if (typeof session.removeListener === 'function') {
				session.removeListener('Network.requestWillBeSent', onRequest);
			}
			try { await session.send('Network.disable'); } catch { /* ignore */ }
			try { await session.detach(); } catch { /* ignore */ }
		},
	};
}

export function repoFromUrl(metaUrl) {
	return resolve(new URL('../../..', metaUrl).pathname);
}

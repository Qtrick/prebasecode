#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

export async function dismissStartup(page) {
	const trust = page.getByRole('button', { name: /Yes, I trust the authors/i });
	if (await trust.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true, () => false)) {
		await trust.click();
	}
	const offline = page.getByRole('button', { name: 'Continue Offline', exact: true });
	if (await offline.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
		await offline.click();
	}
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

export async function invokeLanguageModelTool(page, toolId, parameters = {}) {
	return workbenchCommand(page, 'prebase.test.invokeLanguageModelTool', toolId, parameters);
}

export function processTree(rootPid) {
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

export async function gracefulWorkbenchQuit(page, pid) {
	const startedAt = Date.now();
	const before = processState(pid);
	try {
		await workbenchCommand(page, 'workbench.action.quit');
	} catch {
		/* tearing down */
	}
	for (const name of ['Quit', 'Terminate', 'Close Anyway', 'Don\'t Save']) {
		const button = page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') });
		if (await button.first().waitFor({ state: 'visible', timeout: 1_500 }).then(() => true, () => false)) {
			await button.last().click().catch(() => undefined);
		}
	}
	let remaining = processState(pid);
	if (remaining !== 'gone') {
		remaining = (await waitFor(() => processState(pid) === 'gone', 8_000, 100)) ? 'gone' : processState(pid);
	}
	if (remaining !== 'gone') {
		try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
		remaining = (await waitFor(() => processState(pid) === 'gone', 4_000, 100)) ? 'gone' : processState(pid);
	}
	if (remaining !== 'gone') {
		try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
		await waitFor(() => processState(pid) === 'gone', 3_000, 100);
		remaining = processState(pid);
	}
	return { before, latencyMs: Date.now() - startedAt, remaining, usedSigkill: remaining === 'gone' && Date.now() - startedAt > 8_000 };
}

export async function waitForWorkbenchDriver(page, timeoutMs = 90_000) {
	await page.waitForFunction(() => window.driver && typeof window.driver.executeCommand === 'function' && typeof window.driver.whenWorkbenchRestored === 'function', null, { timeout: timeoutMs });
	await page.evaluate(() => window.driver.whenWorkbenchRestored());
}

export async function launchPreBase(repo, workspace, extraArgs = []) {
	const sourceProfile = mkdtempSync(join(tmpdir(), 'pb-phase3-profile-'));
	const launch = join(repo, '.agents/skills/launch/scripts/launch.sh');
	const { stdout } = await execFileAsync(launch, [
		'--repo', repo,
		'--source-user-data-dir', sourceProfile,
		'--',
		'--enable-smoke-test-driver',
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
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${info.cdpPort}`);
	const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('workbench'));
	if (!page) {
		throw new Error('Workbench page not found');
	}
	page.setDefaultTimeout(180_000);
	return { info, browser, page, sourceProfile };
}

export function repoFromUrl(metaUrl) {
	return resolve(new URL('../../..', metaUrl).pathname);
}

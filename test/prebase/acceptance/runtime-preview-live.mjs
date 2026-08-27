#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3.18/runtime-preview');
const screenshotDir = join(repo, 'reports/graph-acceptance/phase-3.18/screenshots');

function allocatePort() {
	const source = `
		const net = require('node:net');
		const server = net.createServer();
		server.listen(0, '127.0.0.1', () => {
			console.log(server.address().port);
			server.close();
		});
	`;
	return Number(execFileSync(process.execPath, ['-e', source], { encoding: 'utf8' }).trim());
}

function createFixture(port) {
	const dir = mkdtempSync(join(tmpdir(), 'pb-runtime-'));
	writeFileSync(join(dir, 'package.json'), JSON.stringify({
		name: 'prebase-runtime-live',
		private: true,
		scripts: { dev: `node server.mjs --port ${port}` },
	}, null, 2));
	writeFileSync(join(dir, 'server.mjs'), `
		import http from 'node:http';
		const port = Number(process.argv.at(-1));
		const server = http.createServer((_request, response) => {
			response.setHeader('content-type', 'text/html; charset=utf-8');
			response.end('<!doctype html><html><head><title>PreBase Runtime Fixture</title></head><body><main><h1>Runtime Ready</h1><button>Inspect me</button></main></body></html>');
		});
		server.listen(port, () => console.log('RUNTIME_FIXTURE_READY http://localhost:' + port));
		for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
	`);
	return dir;
}

function processState(pid) {
	try {
		return execFileSync('ps', ['-o', 'pid=,ppid=,pcpu=,rss=,comm=', '-p', String(pid)], { encoding: 'utf8' }).trim() || 'gone';
	} catch {
		return 'gone';
	}
}

function portOwners(port) {
	try {
		return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number);
	} catch {
		return [];
	}
}

async function waitFor(predicate, timeoutMs = 45_000, intervalMs = 200) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await predicate();
		if (value) return value;
		await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs));
	}
	return undefined;
}

async function dismissStartup(page) {
	const trust = page.getByRole('button', { name: /Yes, I trust the authors/i });
	if (await trust.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true, () => false)) {
		await trust.click();
	}
	const offline = page.getByRole('button', { name: 'Continue Offline', exact: true });
	if (await offline.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
		await offline.click();
	}
}

async function executeWorkbenchCommand(page, commandId, visibleName) {
	await page.keyboard.press('Escape').catch(() => undefined);
	await page.keyboard.press('Shift+Meta+P');
	const palette = page.locator('.quick-input-widget');
	await palette.waitFor({ state: 'visible', timeout: 8_000 });
	await palette.locator('input').fill(commandId);
	const row = palette.locator('.monaco-list-row').filter({ hasText: visibleName }).first();
	if (await row.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true, () => false)) {
		await row.click();
	} else {
		await page.keyboard.press('Enter');
	}
	await palette.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
}

async function confirmStartIfNeeded(page) {
	const prompt = page.getByText('Start preview server?');
	if (!await prompt.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
		return;
	}
	const dialogButton = page.locator('.monaco-dialog-box .monaco-button, .dialog-buttons .monaco-button').filter({ hasText: /^Start$/ });
	if (await dialogButton.count()) {
		await dialogButton.last().click();
		return;
	}
	await page.getByRole('button', { name: /^Start$/ }).last().click();
}

async function quit(pid) {
	const before = processState(pid);
	const startedAt = Date.now();
	try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
	const gone = await waitFor(() => processState(pid) === 'gone', 15_000, 100);
	return { before, latencyMs: Date.now() - startedAt, remaining: gone ? 'gone' : processState(pid) };
}

export function runtimePreviewAcceptanceFailures(evidence) {
	const failures = [];
	if (!evidence.targetOpened) failures.push('Runtime Preview target did not open');
	if (!evidence.detectedScript) failures.push('Runtime Preview did not detect the dev script');
	if (!evidence.serverStarted) failures.push('Runtime Preview server did not start');
	if (!evidence.previewConnected) failures.push('Runtime Preview did not connect to the fixture');
	if (!evidence.inspected) failures.push('Runtime Preview inspection did not see fixture content');
	if (!evidence.restarted) failures.push('Runtime Preview did not restart cleanly');
	if (!evidence.stopped || evidence.portAfterStop?.length) failures.push('Runtime Preview stop retained the server port');
	if (!evidence.startedBeforeQuit) failures.push('Runtime Preview was not active for quit-under-load');
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit');
	if (evidence.portAfterQuit?.length) failures.push('PreBase quit retained the Runtime Preview server');
	return failures;
}

async function run() {
	mkdirSync(evidenceDir, { recursive: true });
	mkdirSync(screenshotDir, { recursive: true });
	const port = allocatePort();
	const fixture = createFixture(port);
	const sourceProfile = mkdtempSync(join(tmpdir(), 'pb-runtime-profile-'));
	const launch = join(repo, '.claude/skills/launch/scripts/launch.sh');
	const { stdout } = await execFileAsync(launch, ['--repo', repo, '--', fixture], {
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
	let browser;
	let evidence = { fixture, port, pid: info.pid, cdpPort: info.cdpPort, logFile: info.logFile };
	try {
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${info.cdpPort}`);
		const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('workbench'));
		if (!page) throw new Error('Workbench page not found');
		await dismissStartup(page);

		await executeWorkbenchCommand(page, 'workbench.view.prebase.runtime', 'Runtime Preview');
		const runtimeView = page.locator('.prebase-runtime-view');
		if (!await runtimeView.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
			const activity = page.getByRole('tab', { name: /Runtime Preview/i }).or(page.getByRole('button', { name: /Runtime Preview/i }));
			if (await activity.first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false)) {
				await activity.first().click();
			}
		}
		await executeWorkbenchCommand(page, 'prebase.runtime.open', 'Open Runtime Preview');
		await runtimeView.waitFor({ state: 'visible', timeout: 20_000 });
		evidence.targetOpened = await page.getByRole('tab', { name: /Runtime Preview/ }).count() > 0 || await runtimeView.isVisible();

		await runtimeView.getByRole('button', { name: 'Detect Configurations', exact: true }).click();
		const scriptSelect = runtimeView.locator('select').first();
		await waitFor(async () => (await scriptSelect.locator('option').allTextContents()).some(value => /dev/i.test(value)));
		evidence.detectedScript = (await scriptSelect.locator('option').allTextContents()).some(value => /dev/i.test(value));

		await runtimeView.getByRole('button', { name: 'Start', exact: true }).click();
		await confirmStartIfNeeded(page);
		evidence.serverStarted = Boolean(await waitFor(() => portOwners(port).length > 0, 60_000));
		if (!evidence.serverStarted) {
			await executeWorkbenchCommand(page, 'prebase.runtime.start', 'Start Runtime Preview');
			await confirmStartIfNeeded(page);
			evidence.serverStarted = Boolean(await waitFor(() => portOwners(port).length > 0, 30_000));
		}
		if (evidence.serverStarted) {
			const urlInput = runtimeView.getByPlaceholder('http://localhost:5173');
			await urlInput.fill(`http://127.0.0.1:${port}`);
			await runtimeView.getByRole('button', { name: 'Connect', exact: true }).click();
			evidence.previewConnected = Boolean(await waitFor(async () => {
				const status = await runtimeView.innerText();
				if (!status.includes('Connected: yes')) return false;
				for (const frame of page.frames()) {
					if (await frame.getByRole('heading', { name: 'Runtime Ready', exact: true }).count().catch(() => 0)) return true;
				}
				return false;
			}, 20_000));
		}

		await runtimeView.getByRole('button', { name: 'Inspect', exact: true }).click();
		evidence.inspected = Boolean(await waitFor(async () => {
			for (const frame of page.frames()) {
				if (await frame.getByRole('heading', { name: 'Runtime Ready', exact: true }).count().catch(() => 0)) return true;
			}
			return false;
		}));
		await page.screenshot({ path: join(screenshotDir, 'runtime-preview-live.png') });

		const restartOwnersBefore = portOwners(port);
		await runtimeView.getByRole('button', { name: 'Restart', exact: true }).click();
		await confirmStartIfNeeded(page);
		evidence.restarted = Boolean(await waitFor(() => {
			const owners = portOwners(port);
			return owners.length > 0 && owners.some(pid => !restartOwnersBefore.includes(pid));
		}));
		await page.waitForTimeout(1_000);
		await runtimeView.getByRole('button', { name: 'Stop', exact: true }).click();
		evidence.stopped = Boolean(await waitFor(() => portOwners(port).length === 0, 15_000));
		evidence.portAfterStop = portOwners(port);

		await page.waitForTimeout(1_000);
		await runtimeView.getByRole('button', { name: 'Start', exact: true }).click();
		await confirmStartIfNeeded(page);
		evidence.startedBeforeQuit = Boolean(await waitFor(() => portOwners(port).length > 0));
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (browser) browser.close = async () => undefined;
		evidence.quit = await quit(info.pid);
		await waitFor(() => portOwners(port).length === 0, 15_000);
		evidence.portAfterQuit = portOwners(port);
	}
	const failures = runtimePreviewAcceptanceFailures(evidence);
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(evidenceDir, 'live.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
	if (!result.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	if (process.argv[2] === '--evaluate') {
		const evidence = JSON.parse(readFileSync(0, 'utf8'));
		const failures = runtimePreviewAcceptanceFailures(evidence);
		console.log(JSON.stringify({ ok: failures.length === 0, failures }));
		if (failures.length) process.exitCode = 1;
	} else {
		await run();
	}
}

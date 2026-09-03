#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import {
	acquirePhase3AcceptanceLock,
	dismissStartup,
	gracefulWorkbenchQuit,
	portOwners,
	waitFor,
	waitForWorkbenchDriver,
	workbenchCommandWithTimeout,
} from './workbenchHarness.mjs';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';
const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/runtime-preview');
const screenshotDir = join(repo, 'reports/graph-acceptance/phase-3-final/screenshots');

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

function processSnapshot(pid) {
	try {
		return execFileSync('ps', ['-o', 'pid=,ppid=,pcpu=,rss=,comm=', '-p', String(pid)], { encoding: 'utf8' }).trim() || 'gone';
	} catch {
		return 'gone';
	}
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
	const release = await acquirePhase3AcceptanceLock('runtime-preview');
	try {
		mkdirSync(evidenceDir, { recursive: true });
		mkdirSync(screenshotDir, { recursive: true });
		const port = allocatePort();
		const fixture = createFixture(port);
		const launch = join(repo, '.agents/skills/launch/scripts/launch.sh');
		const { execFile } = await import('node:child_process');
		const { promisify } = await import('node:util');
		const execFileAsync = promisify(execFile);
		const { stdout } = await execFileAsync(launch, ['--repo', repo, '--', '--enable-smoke-test-driver', '--skip-release-notes', '--skip-welcome', fixture], {
			cwd: repo,
			env: {
				...process.env,
				HTTP_PROXY: '',
				HTTPS_PROXY: '',
				ALL_PROXY: '',
				VSCODE_SKIP_PRELAUNCH: process.env.VSCODE_SKIP_PRELAUNCH ?? '1',
			},
			maxBuffer: 10 * 1024 * 1024,
		});
		const info = JSON.parse(stdout.trim().split('\n').findLast(line => line.startsWith('{')));
		let browser;
		let page;
		let evidence = { ...phase3EvidenceMetadata(repo, 'runtime-preview'), fixture, port, pid: info.pid, cdpPort: info.cdpPort, logFile: info.logFile };
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${info.cdpPort}`);
			page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('workbench'));
			if (!page) throw new Error('Workbench page not found');
			await dismissStartup(page);
			await waitForWorkbenchDriver(page);

			// Prefer smoke-driver executeCommand — platform Command Palette chords false-fail cross-OS.
			await workbenchCommandWithTimeout(page, 15_000, 'workbench.view.prebase.runtime').catch(() => undefined);
			const runtimeView = page.locator('.prebase-runtime-view');
			if (!await runtimeView.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
				const activity = page.getByRole('tab', { name: /Runtime Preview/i }).or(page.getByRole('button', { name: /Runtime Preview/i }));
				if (await activity.first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false)) {
					await activity.first().click();
				}
			}
			await workbenchCommandWithTimeout(page, 15_000, 'prebase.runtime.open').catch(() => undefined);
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
				await workbenchCommandWithTimeout(page, 15_000, 'prebase.runtime.start').catch(() => undefined);
				await confirmStartIfNeeded(page);
				evidence.serverStarted = Boolean(await waitFor(() => portOwners(port).length > 0, 30_000));
			}
			if (evidence.serverStarted) {
				const urlInput = runtimeView.getByPlaceholder('http://localhost:5173');
				await urlInput.fill(`http://127.0.0.1:${port}`);
				await runtimeView.getByRole('button', { name: 'Connect', exact: true }).click();
				evidence.previewConnected = Boolean(await waitFor(async () => {
					const status = `${await runtimeView.innerText()} ${await page.locator('.prebase-runtime-editor').innerText().catch(() => '')}`;
					const connected = /\bStatus:\s*connected\b/i.test(status) || /\bConnected\b/.test(status);
					if (!connected) return false;
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
			if (page && info?.pid) {
				evidence.quit = await gracefulWorkbenchQuit(page, info.pid);
			}
			if (browser) {
				try { await browser.close(); } catch { /* already disconnected */ }
			}
			await waitFor(() => portOwners(port).length === 0, 8_000);
			evidence.portAfterQuit = portOwners(port);
			evidence.gracefulQuitMs = evidence.quit?.latencyMs;
			evidence.quitRequiredSigkill = evidence.quit?.latencyMs > 6_000;
		}
		const failures = runtimePreviewAcceptanceFailures(evidence);
		const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
		writeFileSync(join(evidenceDir, 'live.json'), JSON.stringify(result, null, 2));
		console.log(JSON.stringify(result, null, 2));
		if (!result.ok) process.exitCode = 1;
	} finally {
		await release?.();
	}
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

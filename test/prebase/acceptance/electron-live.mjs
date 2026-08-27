#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = join(repo, 'test/prebase/fixtures/desktop-electron');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3.18/electron');
const screenshotDir = join(repo, 'reports/graph-acceptance/phase-3.18/screenshots');
const electronBin = join(repo, 'node_modules/.bin/electron');

function allocatePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			server.close(error => error || !port ? reject(error ?? new Error('no port')) : resolve(port));
		});
		server.once('error', reject);
	});
}

function processState(pid) {
	try {
		return execFileSync('ps', ['-o', 'pid=,ppid=,pcpu=,rss=,comm=', '-p', String(pid)], { encoding: 'utf8' }).trim() || 'gone';
	} catch {
		return 'gone';
	}
}

const port = await allocatePort();
mkdirSync(evidenceDir, { recursive: true });
mkdirSync(screenshotDir, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronBin, ['.', `--remote-debugging-port=${port}`], {
	cwd: fixture,
	stdio: ['ignore', 'pipe', 'pipe'],
	env,
});
if (!child.pid) {
	throw new Error('Failed to spawn Electron fixture');
}
const logs = [];
child.stdout.on('data', chunk => logs.push(String(chunk)));
child.stderr.on('data', chunk => logs.push(String(chunk)));
const started = Date.now();
let browser;
try {
	let last = '';
	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (response.ok) {
				break;
			}
			last = `HTTP ${response.status}`;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		if (attempt === 39) {
			throw new Error(`CDP never became ready: ${last}`);
		}
		await new Promise(resolveWait => setTimeout(resolveWait, 250));
	}
	browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
	const page = browser.contexts()[0]?.pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
	await page.getByRole('textbox', { name: 'Name' }).fill('Ada');
	await page.getByRole('button', { name: 'Greet' }).click();
	await page.getByRole('status').filter({ hasText: 'Hello, Ada from main' }).waitFor({ timeout: 5_000 });
	const screenshot = join(screenshotDir, 'electron-full-app-ipc.png');
	await page.screenshot({ path: screenshot });
	const evidence = {
		ok: true,
		framework: 'electron',
		mode: 'fullApp',
		backend: 'cdp',
		appRootFixture: 'test/prebase/fixtures/desktop-electron',
		backendProof: { text: 'Hello, Ada from main', ipc: 'greet' },
		actions: ['fill Name with Ada', 'click Greet'],
		assertions: ['status == Hello, Ada from main'],
		durationMs: Date.now() - started,
		pid: child.pid,
		debugPort: port,
		screenshot,
	};
	writeFileSync(join(evidenceDir, 'live.json'), JSON.stringify(evidence, null, 2));
	if (browser) {
		browser.close = async () => undefined;
	}
	child.kill('SIGTERM');
	const exited = await new Promise(resolveExit => {
		const timer = setTimeout(() => resolveExit(false), 4_000);
		child.once('exit', () => {
			clearTimeout(timer);
			resolveExit(true);
		});
	});
	if (!exited) {
		child.kill('SIGKILL');
	}
	evidence.quit = {
		exited: true,
		remaining: processState(child.pid),
		forced: !exited,
	};
	writeFileSync(join(evidenceDir, 'live.json'), JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify(evidence, null, 2));
	if (evidence.quit.remaining !== 'gone') {
		process.exitCode = 1;
	}
} catch (error) {
	try { if (browser) browser.close = async () => undefined; } catch { /* ignore */ }
	try { child.kill('SIGKILL'); } catch { /* ignore */ }
	console.error(error);
	process.exit(1);
}

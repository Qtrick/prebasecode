#!/usr/bin/env node
/**
 * Live Electron fixture acceptance for Phase 3.17.
 * Launches the repo Electron binary against test/prebase/fixtures/desktop-electron,
 * interacts through CDP, writes evidence, then stops the owned process.
 */
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = join(repo, 'test/prebase/fixtures/desktop-electron');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3.17/electron');
const electronBin = join(repo, 'node_modules/.bin/electron');

function allocatePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			server.close(err => err || !port ? reject(err ?? new Error('no port')) : resolve(port));
		});
		server.once('error', reject);
	});
}

const port = await allocatePort();
mkdirSync(evidenceDir, { recursive: true });
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
const started = Date.now();
let browser;
try {
	let last = '';
	for (let i = 0; i < 40; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) {
				break;
			}
			last = `HTTP ${res.status}`;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		if (i === 39) {
			throw new Error(`CDP never became ready: ${last}`);
		}
		await new Promise(r => setTimeout(r, 250));
	}
	browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
	const page = browser.contexts()[0]?.pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
	await page.getByRole('textbox', { name: 'Name' }).fill('Ada');
	await page.getByRole('button', { name: 'Greet' }).click();
	await page.getByRole('status').filter({ hasText: 'Hello, Ada' }).waitFor({ timeout: 5000 });
	const screenshot = join(evidenceDir, 'full-app-greet.png');
	await page.screenshot({ path: screenshot });
	const evidence = {
		framework: 'electron',
		mode: 'fullApp',
		backend: 'cdp',
		appRootFixture: 'test/prebase/fixtures/desktop-electron',
		sessionStatus: 'passed',
		actionCount: 2,
		assertionCount: 1,
		durationMs: Date.now() - started,
		pid: child.pid,
		debugPort: port,
		screenshot,
		processCleanup: 'pending',
	};
	writeFileSync(join(evidenceDir, 'live.json'), JSON.stringify(evidence, null, 2));
	await browser.close().catch(() => undefined);
	browser = undefined;
	child.kill('SIGTERM');
	const exited = await new Promise(resolve => {
		const timer = setTimeout(() => resolve(false), 4000);
		child.once('exit', () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
	if (!exited) {
		child.kill('SIGKILL');
	}
	evidence.processCleanup = exited ? 'clean' : 'killed';
	writeFileSync(join(evidenceDir, 'live.json'), JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify({ ok: true, ...evidence }));
} catch (error) {
	try { await browser?.close(); } catch { /* ignore */ }
	try { child.kill('SIGKILL'); } catch { /* ignore */ }
	console.error(error);
	process.exit(1);
}

#!/usr/bin/env node
/**
 * Live PreBase workbench acceptance: Continue Offline → Temporal Graph → Runtime Preview → SIGTERM quit.
 * Does not call Playwright browser.close() until after PreBase has exited (close() would quit Electron).
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3.17');
const screenshotDir = join(evidenceDir, 'screenshots');
mkdirSync(screenshotDir, { recursive: true });
mkdirSync(join(evidenceDir, 'temporal'), { recursive: true });
mkdirSync(join(evidenceDir, 'shutdown'), { recursive: true });

function processSnapshot(pid) {
	try {
		return execSync(`ps -o pid=,ppid=,pcpu=,rss=,comm= -p ${pid} && pgrep -P ${pid} -l || true`, { encoding: 'utf8' }).trim();
	} catch {
		return 'gone';
	}
}

function createTemporalFixture() {
	const dir = mkdtempSync(join(tmpdir(), 'pb-temporal-'));
	execSync('git init -q && git config user.email phase317@prebase.local && git config user.name "Phase 317"', { cwd: dir });
	mkdirSync(join(dir, 'src'), { recursive: true });
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'temporal-live', private: true }, null, 2));
	writeFileSync(join(dir, 'src/index.js'), "import { greet } from './greet.js';\nimport { tally } from './tally.js';\nconsole.log(greet('world'), tally([1,2,3]));\n");
	writeFileSync(join(dir, 'src/greet.js'), "export function greet(name) { return `Hello, ${name}`; }\n");
	writeFileSync(join(dir, 'src/tally.js'), "export function tally(xs) { return xs.reduce((a,b)=>a+b,0); }\n");
	execSync('git add -A && git commit -qm "feat: initial app"', { cwd: dir });
	for (let i = 1; i <= 8; i++) {
		execSync(`echo "export function extra${i}() { return ${i}; }" >> src/greet.js && git add src/greet.js && git commit -qm "feat: extra ${i}"`, { cwd: dir });
	}
	writeFileSync(join(dir, 'src/tally.js'), "export function tally(xs) { return xs.reduce((a,b)=>a+b,0) * 2; }\n");
	execSync('git add src/tally.js && git commit -qm "fix: double tally"', { cwd: dir });
	const head = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
	const commits = execSync('git rev-list --count HEAD', { cwd: dir, encoding: 'utf8' }).trim();
	return { dir, head, commits: Number(commits) };
}

async function commandPalette(page, text) {
	await page.keyboard.press('Shift+Meta+P');
	const input = page.locator('.quick-input-widget input, .monaco-quick-input-widget input').first();
	await input.waitFor({ timeout: 8000 });
	await input.fill(text);
	await page.waitForTimeout(250);
	await page.keyboard.press('Enter');
}

async function dismissAuth(page) {
	await page.keyboard.press('Escape').catch(() => undefined);
	for (const name of ['Skip', 'Continue without Signing In', 'Continue Offline', 'Continue']) {
		const loc = page.getByRole('button', { name, exact: true });
		if (await loc.count()) {
			await loc.first().click({ timeout: 4000 }).catch(() => undefined);
			await page.waitForTimeout(300);
		}
	}
	return 'skip-flow';
}

const fixture = createTemporalFixture();
const launchSh = join(repo, '.agents/skills/launch/scripts/launch.sh');
const launched = spawn(launchSh, ['--', fixture.dir], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
let jsonLine = '';
await new Promise((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error('launch.sh timed out')), 120000);
	launched.stdout.on('data', chunk => {
		const text = chunk.toString();
		process.stderr.write(text);
		for (const line of text.split('\n')) {
			if (line.startsWith('{')) {
				jsonLine = line.trim();
			}
		}
	});
	launched.stderr.on('data', chunk => process.stderr.write(chunk));
	launched.on('exit', code => {
		clearTimeout(timer);
		if (!jsonLine) {
			reject(new Error(`launch.sh exited ${code} without JSON`));
		} else {
			resolve();
		}
	});
});
const info = JSON.parse(jsonLine);
writeFileSync(join(evidenceDir, 'shutdown/launch-temporal.json'), JSON.stringify({ ...info, fixture }, null, 2));

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${info.cdpPort}`);
let page;
for (let i = 0; i < 20 && !page; i++) {
	page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('workbench'))
		?? browser.contexts().flatMap(c => c.pages())[0];
	if (!page) {
		await new Promise(r => setTimeout(r, 250));
	}
}
if (!page) {
	throw new Error('No PreBase workbench page on CDP');
}
await page.waitForTimeout(4000);
const dismissed = await dismissAuth(page);
const offline = page.getByRole('button', { name: 'Continue Offline' });
if (await offline.count()) {
	await offline.first().click({ timeout: 5000 }).catch(() => undefined);
	await page.waitForTimeout(800);
}
const walkthroughSkip = page.getByRole('button', { name: 'Skip', exact: true });
if (await walkthroughSkip.count()) {
	await walkthroughSkip.last().click().catch(() => undefined);
	await page.waitForTimeout(400);
}
await page.screenshot({ path: join(screenshotDir, '02_after_offline.png') });

const maps = page.getByRole('tab', { name: /PreBase Maps|Maps/i }).or(page.getByLabel(/PreBase Maps/i));
if (await maps.count()) {
	await maps.first().click().catch(() => undefined);
	await page.waitForTimeout(600);
}
const temporalMode = page.getByRole('button', { name: 'Temporal', exact: true });
if (await temporalMode.count()) {
	await temporalMode.first().click().catch(() => undefined);
	await page.waitForTimeout(800);
}
await commandPalette(page, 'Open Temporal Graph');
const indexingDeadline = Date.now() + 45000;
let statusText = '';
let nodes = 0;
while (Date.now() < indexingDeadline) {
	statusText = await page.locator('.prebase-maps-view, .monaco-workbench').innerText().catch(() => '');
	const match = statusText.match(/Nodes\s+(\d+)/i);
	nodes = match ? Number(match[1]) : 0;
	if (nodes > 0 && !/Indexing/i.test(statusText)) {
		break;
	}
	await page.waitForTimeout(1000);
}
await page.screenshot({ path: join(screenshotDir, '04_temporal_full_map.png') });

const fullMap = page.getByRole('button', { name: 'Full Map' });
if (await fullMap.count()) {
	await fullMap.first().click().catch(() => undefined);
}
const focus = page.getByRole('button', { name: 'Focus Changes' });
if (await focus.count()) {
	await focus.first().click().catch(() => undefined);
	await page.waitForTimeout(1200);
	await page.screenshot({ path: join(screenshotDir, '05_temporal_focus_changes.png') });
	if (await fullMap.count()) {
		await fullMap.first().click().catch(() => undefined);
	}
}
const follow = page.getByText('Follow HEAD');
if (await follow.count()) {
	await follow.first().click().catch(() => undefined);
}
const fit = page.getByRole('button', { name: /Fit/i });
if (await fit.count()) {
	await fit.first().click().catch(() => undefined);
}
await page.screenshot({ path: join(screenshotDir, '06_temporal_after_controls.png') });

await commandPalette(page, 'Runtime Preview');
await page.waitForTimeout(800);
await page.screenshot({ path: join(screenshotDir, '07_runtime_preview.png') });

const beforeQuit = processSnapshot(info.pid);
const t0 = Date.now();
try { process.kill(info.pid, 'SIGTERM'); } catch { /* already gone */ }
let remaining = 'alive';
for (let i = 0; i < 80; i++) {
	try {
		process.kill(info.pid, 0);
		await new Promise(r => setTimeout(r, 100));
	} catch {
		remaining = 'gone';
		break;
	}
}
const quitMs = Date.now() - t0;
const afterQuit = processSnapshot(info.pid);

const evidence = {
	framework: 'prebase',
	mode: 'workbench',
	fixture: fixture.dir,
	commits: fixture.commits,
	head: fixture.head,
	dismissed,
	temporal: {
		statusSnippet: statusText.slice(0, 800),
		nodes,
		stuckIndexing: /Indexing/i.test(statusText) && nodes === 0,
		unexpectedError: /\bError\b/i.test(statusText) && !/error.ts/i.test(statusText),
	},
	quit: { t0, quitMs, remaining, beforeQuit, afterQuit },
	pid: info.pid,
	cdpPort: info.cdpPort,
};
writeFileSync(join(evidenceDir, 'temporal/live.json'), JSON.stringify(evidence, null, 2));
writeFileSync(join(evidenceDir, 'shutdown/idle-quit.json'), JSON.stringify(evidence.quit, null, 2));
const ok = remaining === 'gone' && nodes > 0;
console.log(JSON.stringify({ ok, ...evidence }, null, 2));
if (!ok) {
	process.exitCode = 1;
}

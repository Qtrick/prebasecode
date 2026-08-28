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
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final');
const temporalDir = join(evidenceDir, 'temporal');
const screenshotDir = join(evidenceDir, 'screenshots');
const shutdownDir = join(evidenceDir, 'shutdown');

export function temporalAcceptanceFailures(evidence) {
	const failures = [];
	const large = evidence.scale === 'large';
	if (large) {
		if (!(evidence.fixture?.commits >= 50)) failures.push('large fixture commit count is below 50');
		if (!(evidence.fixture?.files?.length >= 250)) failures.push('large fixture HEAD does not contain 250+ files');
	} else {
		if (evidence.fixture?.commits !== 10) failures.push('fixture commit count is not 10');
		if (evidence.fixture?.files?.length !== 4) failures.push('fixture HEAD does not contain four files');
		if (evidence.fixture?.expectedModifiedPath !== 'src/tally.js') failures.push('fixture first-parent diff is not src/tally.js');
	}
	if (!evidence.targetOpened) failures.push('Temporal Graph target did not open');
	if (!evidence.repoLoaded) failures.push('Temporal fixture repository did not load');

	const full = evidence.fullMap;
	if (!full) {
		failures.push('Full Map metrics are missing');
	} else {
		if (full.selectedCommitSha !== evidence.fixture?.head) failures.push('Full Map selected SHA does not equal fixture HEAD');
		if (full.renderedCommitSha !== evidence.fixture?.head) failures.push('Full Map rendered SHA does not equal fixture HEAD');
		if (!(full.receivedNodeCount > 0)) failures.push('Full Map received zero nodes');
		if (!(full.visibleNodeCount > 0)) failures.push('Full Map exposed zero visible nodes');
		if (!(full.nodesDrawn > 0)) failures.push('Full Map drew zero nodes');
		if (full.finiteCoordinateCount !== full.receivedNodeCount) failures.push('Full Map contains non-finite node coordinates');
		if (!(full.canvas?.distinctPixels > 0)) failures.push('Full Map canvas is blank');
		if (!Number.isFinite(full.transform?.x) || !Number.isFinite(full.transform?.y) || !(full.transform?.k > 0)) {
			failures.push('Full Map transform is invalid');
		}
		if (large && !(full.receivedNodeCount >= 250)) failures.push('large Full Map received fewer than 250 nodes');
		if (large && full.screenFillRatio !== undefined && full.screenFillRatio < 0.08) failures.push('large Full Map leaves a huge empty canvas');
		if (large && full.maxCommunityOverlap !== undefined && full.maxCommunityOverlap > 0.85) failures.push('large Full Map communities overlap too much');
	}

	const focus = evidence.focusChanges;
	if (!focus) {
		failures.push('Focus Changes metrics are missing');
	} else {
		if (!(focus.summary?.modifiedCount >= 1)) failures.push('Focus Changes has no modified diff');
		if (focus.displayMode !== 'changes') failures.push('Focus Changes mode did not activate');
		if (!(focus.visibleNodeCount > 0)) failures.push('Focus Changes exposed zero changed nodes');
		if (!(focus.nodesDrawn > 0)) failures.push('Focus Changes drew zero changed nodes');
		if (!(focus.canvas?.distinctPixels > 0)) failures.push('Focus Changes canvas is blank');
		if (large && !(focus.visibleNodeCount >= 4)) failures.push('large Focus Changes did not keep a focused set visible');
	}

	if (evidence.unexpectedError) failures.push('Workbench exposed an unexpected Error state');
	if (evidence.stuckIndexing) failures.push('Temporal indexing remained stuck');
	if (evidence.camera?.afterFocus?.k && evidence.camera?.afterUserZoom?.k && Math.abs(evidence.camera.afterUserZoom.k - evidence.camera.afterFocus.k) < 0.02) {
		failures.push('manual camera zoom did not change the transform');
	}
	if (evidence.camera?.afterUserZoom?.k && evidence.camera?.afterWait?.k && Math.abs(evidence.camera.afterWait.k - evidence.camera.afterUserZoom.k) > 0.05) {
		failures.push('Temporal camera stole the user zoom during a same-mode refresh');
	}
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit');
	return failures;
}

function git(cwd, args) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createFixture() {
	const dir = mkdtempSync(join(tmpdir(), 'pb-temporal-'));
	git(dir, ['init', '-q', '-b', 'main']);
	git(dir, ['config', 'user.email', 'phase318@prebase.local']);
	git(dir, ['config', 'user.name', 'Phase 318']);
	mkdirSync(join(dir, 'src'));
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'temporal-live', private: true }, null, 2));
	writeFileSync(join(dir, 'src/index.js'), "import { greet } from './greet.js';\nimport { tally } from './tally.js';\nconsole.log(greet('world'), tally([1, 2, 3]));\n");
	writeFileSync(join(dir, 'src/greet.js'), "export function greet(name) { return `Hello, ${name}`; }\n");
	writeFileSync(join(dir, 'src/tally.js'), "export function tally(xs) { return xs.reduce((sum, value) => sum + value, 0); }\n");
	git(dir, ['add', '--', 'package.json', 'src/index.js', 'src/greet.js', 'src/tally.js']);
	git(dir, ['commit', '-qm', 'feat: initial app']);
	for (let index = 1; index <= 8; index++) {
		writeFileSync(join(dir, 'src/greet.js'), `export function greet(name) { return \`Hello, \${name}\`; }\nexport const revision = ${index};\n`);
		git(dir, ['add', '--', 'src/greet.js']);
		git(dir, ['commit', '-qm', `feat: greet revision ${index}`]);
	}
	writeFileSync(join(dir, 'src/tally.js'), "export function tally(xs) { return xs.reduce((sum, value) => sum + value, 0) * 2; }\n");
	git(dir, ['add', '--', 'src/tally.js']);
	git(dir, ['commit', '-qm', 'fix: double tally']);

	const files = git(dir, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean);
	const expectedModifiedPath = git(dir, ['diff', '--name-only', 'HEAD^', 'HEAD']);
	return {
		dir,
		head: git(dir, ['rev-parse', 'HEAD']),
		commits: Number(git(dir, ['rev-list', '--count', 'HEAD'])),
		files,
		expectedModifiedPath,
		firstParentSummary: git(dir, ['show', '--stat', '--oneline', '--format=%H %P %s', 'HEAD']),
	};
}

function createLargeFixture() {
	const layers = ['core', 'ui', 'host', 'parser', 'runtime', 'desktop', 'magnus', 'cloud', 'test', 'adapters', 'layout', 'util'];
	const perLayer = 28;
	const dir = mkdtempSync(join(tmpdir(), 'pb-temporal-large-'));
	git(dir, ['init', '-q', '-b', 'main']);
	git(dir, ['config', 'user.email', 'phase3final@prebase.local']);
	git(dir, ['config', 'user.name', 'Phase 3 Final']);
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'temporal-large', private: true }, null, 2));
	git(dir, ['add', '--', 'package.json']);
	git(dir, ['commit', '-qm', 'chore: init']);

	const paths = [];
	for (const layer of layers) {
		mkdirSync(join(dir, 'src', layer), { recursive: true });
		for (let index = 0; index < perLayer; index++) {
			paths.push(`src/${layer}/mod-${String(index).padStart(2, '0')}.js`);
		}
	}

	const writeModule = (relative, extraImport) => {
		const parts = relative.split('/');
		const layer = parts[1];
		const index = Number(parts[2].replace(/[^\d]/g, ''));
		const nextInLayer = `./mod-${String((index + 1) % perLayer).padStart(2, '0')}.js`;
		const lines = [];
		if (index < perLayer - 1) {
			lines.push(`import { token as next } from '${nextInLayer}';`, 'void next;');
		} else {
			lines.push(`import { token as cycle } from './mod-00.js';`, 'void cycle;');
		}
		if (index % 7 === 0) {
			const crossLayer = layers[(layers.indexOf(layer) + 3) % layers.length];
			lines.push(`import { token as cross } from '../${crossLayer}/mod-${String(index % perLayer).padStart(2, '0')}.js';`, 'void cross;');
		}
		if (extraImport) {
			lines.push(extraImport);
		}
		lines.push(`export const token = '${relative}';`, `export function run() { return token; }`, '');
		writeFileSync(join(dir, relative), lines.join('\n'));
	};

	for (const relative of paths) {
		writeModule(relative);
	}
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-qm', 'feat: import layered architecture']);

	for (let revision = 1; revision <= 45; revision++) {
		const relative = paths[(revision * 7) % paths.length];
		writeModule(relative, `export const revision = ${revision};`);
		git(dir, ['add', '--', relative]);
		git(dir, ['commit', '-qm', `fix: revise ${relative}`]);
	}

	const renamedFrom = paths[10];
	const renamedTo = renamedFrom.replace('.js', '.renamed.js');
	git(dir, ['mv', renamedFrom, renamedTo]);
	git(dir, ['commit', '-qm', `refactor: rename ${renamedFrom}`]);

	const deleted = paths[20];
	git(dir, ['rm', '-q', '--', deleted]);
	git(dir, ['commit', '-qm', `chore: delete ${deleted}`]);

	const touched = [paths[1], paths[40], paths[80], paths[120], paths[160], paths[200], paths[240], paths[300]];
	for (const relative of touched) {
		if (!relative || relative === deleted || relative === renamedFrom) {
			continue;
		}
		writeModule(relative, 'export const wave = 1;');
	}
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-qm', 'feat: cross-community wave']);

	const files = git(dir, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean);
	return {
		dir,
		head: git(dir, ['rev-parse', 'HEAD']),
		commits: Number(git(dir, ['rev-list', '--count', 'HEAD'])),
		files,
		expectedModifiedPath: git(dir, ['diff', '--name-only', 'HEAD^', 'HEAD']),
		firstParentSummary: git(dir, ['show', '--stat', '--oneline', '--format=%H %P %s', 'HEAD']),
		scale: 'large',
	};
}

function processSnapshot(pid) {
	try {
		return execFileSync('ps', ['-o', 'pid=,ppid=,pcpu=,rss=,comm=', '-p', String(pid)], { encoding: 'utf8' }).trim() || 'gone';
	} catch {
		return 'gone';
	}
}

async function dismissAuth(page) {
	const offline = page.getByRole('button', { name: 'Continue Offline', exact: true });
	const appeared = await offline.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
	if (!appeared) return false;
	await offline.click();
	await page.getByRole('dialog', { name: 'Sign in to PreBase' }).waitFor({ state: 'hidden', timeout: 5_000 });
	return true;
}

async function findGraphFrame(page, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const frame of page.frames()) {
			if (frame !== page.mainFrame() && await frame.locator('#netCanvas').count()) return frame;
		}
		await page.waitForTimeout(250);
	}
	return undefined;
}

async function installMetricsBridge(frame) {
	await frame.evaluate(content => {
		const source = document.querySelector('script[nonce]');
		const script = document.createElement('script');
		script.setAttribute('nonce', source?.getAttribute('nonce') ?? '');
		script.textContent = content;
		document.documentElement.appendChild(script);
	}, `
		window.__prebaseRecordRenderMetrics = true;
		window.__prebaseAcceptanceTimer = setInterval(function () {
			if (window.__prebaseGraphRenderMetrics) {
				document.documentElement.dataset.prebaseGraphMetrics = JSON.stringify(window.__prebaseGraphRenderMetrics);
			}
		}, 50);
		dirty = true;
		kickRaf();
	`);
}

async function readMetrics(frame) {
	return frame.evaluate(() => {
		const raw = document.documentElement.dataset.prebaseGraphMetrics;
		const metrics = raw ? JSON.parse(raw) : undefined;
		const canvas = document.getElementById('netCanvas');
		const context = canvas?.getContext?.('2d');
		const pixels = context && canvas?.width && canvas?.height
			? context.getImageData(0, 0, canvas.width, canvas.height).data
			: [];
		let distinctPixels = 0;
		for (let index = 4; index < pixels.length; index += 4) {
			if (pixels[index] !== pixels[0] || pixels[index + 1] !== pixels[1] || pixels[index + 2] !== pixels[2] || pixels[index + 3] !== pixels[3]) {
				distinctPixels++;
			}
		}
		return metrics ? { ...metrics, canvas: { ...metrics.canvas, distinctPixels } } : undefined;
	});
}

async function waitForMetrics(page, frame, predicate, timeoutMs = 45_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const metrics = await readMetrics(frame).catch(() => undefined);
		if (metrics && predicate(metrics)) return metrics;
		await page.waitForTimeout(250);
	}
	return readMetrics(frame).catch(() => undefined);
}

async function quitOwnedApp(pid) {
	const before = processSnapshot(pid);
	const startedAt = Date.now();
	try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
	let remaining = 'alive';
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			process.kill(pid, 0);
			await new Promise(resolveWait => setTimeout(resolveWait, 100));
		} catch {
			remaining = 'gone';
			break;
		}
	}
	return { startedAt, quitMs: Date.now() - startedAt, remaining, before, after: processSnapshot(pid) };
}

async function run() {
	mkdirSync(temporalDir, { recursive: true });
	mkdirSync(screenshotDir, { recursive: true });
	mkdirSync(shutdownDir, { recursive: true });
	const fixture = process.argv.includes('--large') ? createLargeFixture() : createFixture();
	const scale = process.argv.includes('--large') ? 'large' : 'small';
	const evidenceName = scale === 'large' ? 'large-live.json' : 'live.json';
	const { stdout } = await execFileAsync(join(repo, '.agents/skills/launch/scripts/launch.sh'), ['--', fixture.dir], {
		cwd: repo,
		maxBuffer: 10 * 1024 * 1024,
	});
	const info = JSON.parse(stdout.trim().split('\n').findLast(line => line.startsWith('{')));
	let browser;
	let quit;
	let evidence = { scale, fixture, pid: info.pid, cdpPort: info.cdpPort };
	try {
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${info.cdpPort}`);
		const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('workbench'));
		if (!page) throw new Error('Workbench page not found');
		await dismissAuth(page);
		await page.getByRole('tab', { name: 'PreBase Maps', exact: true }).click();
		await page.getByRole('button', { name: 'Temporal', exact: true }).click();
		const metricTimeout = scale === 'large' ? 180_000 : 45_000;
		const frame = await findGraphFrame(page, scale === 'large' ? 120_000 : 60_000);
		if (!frame) throw new Error('Temporal Graph webview did not open');
		await installMetricsBridge(frame);
		const fullMap = await waitForMetrics(page, frame, metrics =>
			metrics.displayMode === 'state' &&
			metrics.renderedCommitSha === fixture.head &&
			metrics.nodesDrawn > 0 &&
			(scale !== 'large' || metrics.receivedNodeCount >= 250)
		, metricTimeout);
		await page.screenshot({ path: join(screenshotDir, scale === 'large' ? 'temporal-large-full-map.png' : 'temporal-full-map.png') });
		await frame.locator('#netCanvas').screenshot({ path: join(screenshotDir, scale === 'large' ? 'temporal-large-full-map-canvas.png' : 'temporal-full-map-canvas.png') });

		await page.getByRole('button', { name: 'Focus Changes', exact: true }).click();
		const focusChanges = await waitForMetrics(page, frame, metrics =>
			metrics.displayMode === 'changes' &&
			metrics.summary?.modifiedCount >= 1 &&
			metrics.nodesDrawn > 0
		, metricTimeout);
		await page.screenshot({ path: join(screenshotDir, scale === 'large' ? 'temporal-large-focus-changes.png' : 'temporal-focus-changes.png') });
		await frame.locator('#netCanvas').screenshot({ path: join(screenshotDir, scale === 'large' ? 'temporal-large-focus-changes-canvas.png' : 'temporal-focus-changes-canvas.png') });

		const afterFocus = await readMetrics(frame);
		const canvas = frame.locator('#netCanvas');
		const box = await canvas.boundingBox();
		if (box) {
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.wheel(0, -600);
			await page.waitForTimeout(400);
		}
		const afterUserZoom = await readMetrics(frame);
		if (afterUserZoom?.transform && afterFocus?.transform && Math.abs((afterUserZoom.transform.k || 0) - (afterFocus.transform.k || 0)) < 0.01) {
			await page.mouse.wheel(0, -800);
			await page.waitForTimeout(400);
		}
		await page.waitForTimeout(1500);
		const afterWait = await readMetrics(frame);

		await frame.locator('#temporalFitBtn').click();
		await frame.locator('#temporalCenterLockBtn').click();
		await frame.locator('#temporalFitBtn').click();

		const workbenchText = await page.locator('.monaco-workbench').innerText().catch(() => '');
		evidence = {
			...evidence,
			targetOpened: await page.getByRole('tab', { name: /Temporal Graph/ }).count() > 0,
			repoLoaded: workbenchText.includes(fixture.dir.split('/').at(-1)),
			fullMap,
			focusChanges,
			camera: {
				afterFocus: afterFocus?.transform,
				afterUserZoom: afterUserZoom?.transform,
				afterWait: afterWait?.transform,
			},
			stuckIndexing: /Indexing/.test(workbenchText) && !fullMap?.nodesDrawn,
			unexpectedError: /\bError\b/.test(workbenchText) && !/error\.ts/.test(workbenchText),
		};
	} catch (error) {
		evidence = { ...evidence, error: error instanceof Error ? error.stack ?? error.message : String(error) };
	} finally {
		if (browser) browser.close = async () => undefined;
		quit = await quitOwnedApp(info.pid);
		evidence = { ...evidence, quit };
	}

	const failures = temporalAcceptanceFailures(evidence);
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(temporalDir, evidenceName), JSON.stringify(result, null, 2));
	writeFileSync(join(shutdownDir, scale === 'large' ? 'temporal-large-quit.json' : 'temporal-quit.json'), JSON.stringify(quit, null, 2));
	console.log(JSON.stringify(result, null, 2));
	if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
	if (process.argv[2] === '--evaluate') {
		const evidence = JSON.parse(readFileSync(0, 'utf8'));
		const failures = temporalAcceptanceFailures(evidence);
		const result = { ok: failures.length === 0 && !evidence.error, failures };
		console.log(JSON.stringify(result));
		if (!result.ok) process.exitCode = 1;
	} else {
		await run();
	}
}

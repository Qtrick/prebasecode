#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { phase3EvidenceMetadata } from '../../../test/prebase/acceptance/phase3Evidence.mjs';
import {
	createCanonicalScaleFixture,
	createFixture,
	createLargeFixture,
	expectedRepositoryHeadFileCount,
} from './temporal-fixtures.mjs';

export {
	createCanonicalScaleFixture,
	createFixture,
	createLargeFixture,
	expectedRepositoryHeadFileCount,
} from './temporal-fixtures.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final');
const temporalDir = join(evidenceDir, 'temporal');
const screenshotDir = join(evidenceDir, 'screenshots');
const shutdownDir = join(evidenceDir, 'shutdown');

export function temporalAcceptanceFailures(evidence) {
	const failures = [];
	const canonicalScale = evidence.scale === 'canonical-scale';
	const large = evidence.scale === 'large';
	if (canonicalScale) {
		if (!(evidence.fixture?.commits >= 50)) {failures.push('canonical-scale fixture commit count is below 50');}
		if (!(evidence.fixture?.files?.length >= 9000)) {failures.push('canonical-scale fixture HEAD does not contain 9000+ files');}
		if (evidence.fixture?.moduleCount !== 9680) {failures.push('canonical-scale fixture module seed count is not 9680');}
		if (evidence.fixture?.expectedHeadFileCount && evidence.fixture.files?.length !== evidence.fixture.expectedHeadFileCount) {
			failures.push('canonical-scale fixture HEAD file count does not match expected module graph');
		}
	} else if (large) {
		if (!(evidence.fixture?.commits >= 50)) {failures.push('large fixture commit count is below 50');}
		if (!(evidence.fixture?.files?.length >= 250)) {failures.push('large fixture HEAD does not contain 250+ files');}
		if (evidence.fixture?.moduleCount !== 336) {failures.push('large fixture module seed count is not 336');}
		if (evidence.fixture?.expectedHeadFileCount && evidence.fixture.files?.length !== evidence.fixture.expectedHeadFileCount) {
			failures.push('large fixture HEAD file count does not match expected module graph');
		}
	} else {
		if (evidence.fixture?.commits !== 10) {failures.push('fixture commit count is not 10');}
		if (evidence.fixture?.files?.length !== 4) {failures.push('fixture HEAD does not contain four files');}
		if (evidence.fixture?.expectedModifiedPath !== 'src/tally.js') {failures.push('fixture first-parent diff is not src/tally.js');}
	}
	if (!evidence.targetOpened) {failures.push('Temporal Graph target did not open');}
	if (!evidence.repoLoaded) {failures.push('Temporal fixture repository did not load');}

	const full = evidence.fullMap;
	if (!full) {
		failures.push('Full Map metrics are missing');
	} else {
		if (full.selectedCommitSha !== evidence.fixture?.head) {failures.push('Full Map selected SHA does not equal fixture HEAD');}
		if (full.renderedCommitSha !== evidence.fixture?.head) {failures.push('Full Map rendered SHA does not equal fixture HEAD');}
		if (!(full.receivedNodeCount > 0)) {failures.push('Full Map received zero nodes');}
		if (!(full.visibleNodeCount > 0)) {failures.push('Full Map exposed zero visible nodes');}
		if (!(full.nodesDrawn > 0)) {failures.push('Full Map drew zero nodes');}
		if (full.finiteCoordinateCount !== full.receivedNodeCount) {failures.push('Full Map contains non-finite node coordinates');}
		if (!(full.canvas?.distinctPixels > 0)) {failures.push('Full Map canvas is blank');}
		if (!Number.isFinite(full.transform?.x) || !Number.isFinite(full.transform?.y) || !(full.transform?.k > 0)) {
			failures.push('Full Map transform is invalid');
		}
		if (large && !(full.receivedNodeCount >= 250)) {failures.push('large Full Map received fewer than 250 nodes');}
		if (canonicalScale && !(full.receivedNodeCount >= 9000)) {failures.push('canonical-scale Full Map received fewer than 9000 nodes');}
		if ((large || canonicalScale) && full.screenFillRatio !== undefined && full.screenFillRatio < 0.08) {failures.push(`${large ? 'large' : 'canonical-scale'} Full Map leaves a huge empty canvas`);}
		if ((large || canonicalScale) && full.maxCommunityOverlap !== undefined && full.maxCommunityOverlap > 0.85) {failures.push(`${large ? 'large' : 'canonical-scale'} Full Map communities overlap too much`);}
		if (canonicalScale) {
			const received = full.receivedNodeCount;
			const leafDrawn = Number.isFinite(full.leafNodesDrawn) ? full.leafNodesDrawn : 0;
			const aggregateDrawn = Number.isFinite(full.aggregateNodesDrawn) ? full.aggregateNodesDrawn : 0;
			// Density budget must use leaf+aggregate — a low nodesDrawn override must not green a dense draw.
			const nodesDrawn = leafDrawn + aggregateDrawn;
			if (!(aggregateDrawn > 0)) {failures.push('canonical-scale Full Map drew zero aggregate communities');}
			if (leafDrawn >= received * 0.08) {
				failures.push(`canonical-scale Full Map drew too many leaf nodes (${leafDrawn}/${received}) — overview must not recreate the dot galaxy`);
			}
			if (nodesDrawn >= received * 0.1) {
				failures.push(`canonical-scale Full Map drew too many total nodes (${nodesDrawn}/${received})`);
			}
			if ((full.transform?.k ?? 1) < 0.35 && full.projectionTier !== 'overview') {
				failures.push(`canonical-scale Full Map projection tier is ${full.projectionTier || 'missing'} at overview zoom`);
			}
			if (!(full.aggregateEdgesDrawn > 0)) {failures.push('canonical-scale Full Map drew zero aggregate edges');}
			if (!Number.isFinite(full.leafEdgesDrawn) || full.leafEdgesDrawn > Math.max(250, received * 0.04)) {
				failures.push(`canonical-scale Full Map leaf-edge hairball too dense (${full.leafEdgesDrawn})`);
			}
			if (!(full.communitiesRepresented >= 4)) {
				failures.push(`canonical-scale Full Map represents too few communities (${full.communitiesRepresented})`);
			}
			if (!(full.communityLabelsDrawn >= 1)) {
				failures.push('canonical-scale Full Map drew zero community labels');
			}
			if (!Number.isFinite(full.labelCollisionCullCount)) {
				failures.push('canonical-scale Full Map labelCollisionCullCount is not finite');
			}
			if (!Number.isFinite(full.renderedLabelOverlapCount) || full.renderedLabelOverlapCount > 0) {
				failures.push(`canonical-scale Full Map has rendered label overlaps (${full.renderedLabelOverlapCount})`);
			}
		}
	}

	const focus = evidence.focusChanges;
	if (!focus) {
		failures.push('Focus Changes metrics are missing');
	} else {
		if (!(focus.summary?.modifiedCount >= 1)) {failures.push('Focus Changes has no modified diff');}
		if (focus.displayMode !== 'changes') {failures.push('Focus Changes mode did not activate');}
		if (!(focus.visibleNodeCount > 0)) {failures.push('Focus Changes exposed zero changed nodes');}
		if (!(focus.nodesDrawn > 0)) {failures.push('Focus Changes drew zero changed nodes');}
		if (!(focus.canvas?.distinctPixels > 0)) {failures.push('Focus Changes canvas is blank');}
		if ((large || canonicalScale) && !(focus.visibleNodeCount >= 4)) {failures.push(`${large ? 'large' : 'canonical-scale'} Focus Changes did not keep a focused set visible`);}
	}

	if (evidence.unexpectedError) {failures.push('Workbench exposed an unexpected Error state');}
	if (evidence.stuckIndexing) {failures.push('Temporal indexing remained stuck');}
	if (evidence.camera?.afterFocus?.k && evidence.camera?.afterUserZoom?.k && Math.abs(evidence.camera.afterUserZoom.k - evidence.camera.afterFocus.k) < 0.02) {
		failures.push('manual camera zoom did not change the transform');
	}
	if (evidence.camera?.afterUserZoom?.k && evidence.camera?.afterWait?.k && Math.abs(evidence.camera.afterWait.k - evidence.camera.afterUserZoom.k) > 0.05) {
		failures.push('Temporal camera stole the user zoom during a same-mode refresh');
	}
	if (evidence.quit?.remaining !== 'gone') {failures.push('PreBase did not quit');}
	return failures;
}

export function resolveTemporalScale(argv) {
	if (argv.includes('--canonical-scale') && argv.includes('--large')) {
		throw new Error('temporal-live: --canonical-scale and --large are mutually exclusive');
	}
	if (argv.includes('--canonical-scale')) {
		return 'canonical-scale';
	}
	if (argv.includes('--large')) {
		return 'large';
	}
	return 'small';
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
	if (!appeared) {return false;}
	await offline.click();
	await page.getByRole('dialog', { name: 'Sign in to PreBase' }).waitFor({ state: 'hidden', timeout: 5_000 });
	return true;
}

async function findGraphFrame(page, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const frame of page.frames()) {
			if (frame !== page.mainFrame() && await frame.locator('#netCanvas').count()) {return frame;}
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
		if (window.__prebaseGraphRenderMetrics) {
			document.documentElement.dataset.prebaseGraphMetrics = JSON.stringify(window.__prebaseGraphRenderMetrics);
		}
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
		if (metrics && predicate(metrics)) {return metrics;}
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
	const scale = resolveTemporalScale(process.argv);
	const fixture = scale === 'canonical-scale'
		? createCanonicalScaleFixture()
		: scale === 'large'
			? createLargeFixture()
			: createFixture();
	const evidenceName = scale === 'canonical-scale'
		? 'canonical-scale-live.json'
		: scale === 'large'
			? 'large-live.json'
			: 'live.json';
	const producerId = scale === 'canonical-scale'
		? 'temporal-canonical-scale'
		: scale === 'large'
			? 'temporal-large'
			: 'temporal-small';
	const { stdout } = await execFileAsync(join(repo, '.agents/skills/launch/scripts/launch.sh'), ['--', fixture.dir], {
		cwd: repo,
		maxBuffer: 10 * 1024 * 1024,
	});
	const info = JSON.parse(stdout.trim().split('\n').findLast(line => line.startsWith('{')));
	let browser;
	let quit;
	let evidence = { ...phase3EvidenceMetadata(repo, producerId), scale, fixture, pid: info.pid, cdpPort: info.cdpPort };
	const metricTimeout = scale === 'canonical-scale' ? 360_000 : scale === 'large' ? 180_000 : 45_000;
	const graphFrameTimeout = scale === 'canonical-scale' ? 240_000 : scale === 'large' ? 120_000 : 60_000;
	const minReceivedNodes = scale === 'canonical-scale' ? 9000 : scale === 'large' ? 250 : 1;
	try {
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${info.cdpPort}`);
		const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('workbench'));
		if (!page) {throw new Error('Workbench page not found');}
		await dismissAuth(page);
		await page.getByRole('tab', { name: 'PreBase Maps', exact: true }).click();
		await page.getByRole('button', { name: 'Temporal', exact: true }).click();
		const frame = await findGraphFrame(page, graphFrameTimeout);
		if (!frame) {throw new Error('Temporal Graph webview did not open');}
		await installMetricsBridge(frame);
		const canvasShot = (name) => frame.locator('#netCanvas').screenshot({
			path: join(screenshotDir, name),
			animations: 'disabled',
			timeout: 8_000,
		});
		const fullMap = await waitForMetrics(page, frame, metrics =>
			metrics.displayMode === 'state' &&
			metrics.renderedCommitSha === fixture.head &&
			metrics.nodesDrawn > 0 &&
			metrics.receivedNodeCount >= minReceivedNodes
		, metricTimeout);
		evidence.fullMap = fullMap;
		const fullMapShotPrefix = scale === 'canonical-scale' ? 'temporal-canonical-scale' : scale === 'large' ? 'temporal-large' : 'temporal';
		await page.screenshot({ path: join(screenshotDir, `${fullMapShotPrefix}-full-map.png`) });
		await canvasShot(`${fullMapShotPrefix}-full-map-canvas.png`);

		await page.getByRole('button', { name: 'Focus Changes', exact: true }).click();
		const focusChanges = await waitForMetrics(page, frame, metrics =>
			metrics.displayMode === 'changes' &&
			metrics.summary?.modifiedCount >= 1 &&
			metrics.nodesDrawn > 0
		, metricTimeout);
		evidence.focusChanges = focusChanges;
		await page.screenshot({ path: join(screenshotDir, `${fullMapShotPrefix}-focus-changes.png`) });
		await canvasShot(`${fullMapShotPrefix}-focus-changes-canvas.png`);

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
		if (browser) {browser.close = async () => undefined;}
		quit = await quitOwnedApp(info.pid);
		evidence = { ...evidence, quit };
	}

	const failures = temporalAcceptanceFailures(evidence);
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(temporalDir, evidenceName), JSON.stringify(result, null, 2));
	const quitEvidenceName = scale === 'canonical-scale'
		? 'temporal-canonical-scale-quit.json'
		: scale === 'large'
			? 'temporal-large-quit.json'
			: 'temporal-quit.json';
	const quitProducerId = scale === 'canonical-scale'
		? 'temporal-canonical-scale-quit'
		: scale === 'large'
			? 'temporal-large-quit'
			: 'temporal-quit';
	writeFileSync(join(shutdownDir, quitEvidenceName), JSON.stringify({
		...phase3EvidenceMetadata(repo, quitProducerId),
		ok: quit?.remaining === 'gone',
		quit,
	}, null, 2));
	console.log(JSON.stringify(result, null, 2));
	if (!result.ok) {process.exitCode = 1;}
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
	if (process.argv[2] === '--evaluate') {
		const evidence = JSON.parse(readFileSync(0, 'utf8'));
		const failures = temporalAcceptanceFailures(evidence);
		const result = { ok: failures.length === 0 && !evidence.error, failures };
		console.log(JSON.stringify(result));
		if (!result.ok) {process.exitCode = 1;}
	} else {
		await run();
	}
}

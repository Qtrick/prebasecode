#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------
 * Focused live visual recovery dogfood: real PreBase workspace, one session,
 * all Network layouts + Temporal Full/Focus. Not a release soak.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	acquirePhase3AcceptanceLock,
	dismissStartup,
	findGraphFrame,
	gracefulWorkbenchQuit,
	launchPreBase,
	waitFor,
	waitForWorkbenchDriver,
	workbenchCommandWithTimeout,
} from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/visual-recovery');
const screenshotDir = join(evidenceDir, 'screenshots');
mkdirSync(screenshotDir, { recursive: true });

async function enableGraphMetrics(frame) {
	await frame.evaluate(() => {
		window.__prebaseRecordRenderMetrics = true;
	}).catch(() => undefined);
}

async function readGraphMetrics(frame) {
	return frame.evaluate(() => window.__prebaseGraphRenderMetrics || null).catch(() => null);
}

async function fitAndWait(frame, page) {
	await frame.locator('#fit').click({ timeout: 3_000 }).catch(() => undefined);
	await page.waitForTimeout(500);
	return readGraphMetrics(frame);
}

function summarize(metrics, mode) {
	if (!metrics) {
		return { mode, ok: false };
	}
	const k = Number(metrics.transform?.k ?? 0);
	const util = Number(metrics.screenUtilization ?? 0);
	const nodes = Number(metrics.nodesDrawn ?? metrics.visibleNodeCount ?? 0);
	const hits = Array.isArray(metrics.nodeHits) ? metrics.nodeHits : [];
	const radii = hits.map(h => Number(h.radius ?? h.r ?? 0)).filter(r => r > 0).sort((a, b) => a - b);
	const medianHit = radii.length ? radii[Math.floor(radii.length / 2)] : null;
	const p10Hit = radii.length ? radii[Math.floor(radii.length * 0.1)] : null;
	return {
		mode,
		structuralOk: nodes > 0 && k > 0,
		humanVisualReviewRequired: true,
		ok: nodes > 0 && k > 0,
		nodesDrawn: nodes,
		receivedNodeCount: metrics.receivedNodeCount,
		leafNodesDrawn: metrics.leafNodesDrawn,
		aggregateNodesDrawn: metrics.aggregateNodesDrawn,
		projectionTier: metrics.projectionTier || metrics.lodTier,
		edgesDrawn: metrics.edgesDrawn,
		labelsDrawn: metrics.labelsDrawn,
		transformK: k,
		screenUtilization: util,
		medianHitRadius: medianHit,
		p10HitRadius: p10Hit,
		lodTier: metrics.lodTier,
		networkLayoutMode: metrics.networkLayoutMode,
		displayMode: metrics.displayMode,
		projectedBounds: metrics.projectedBounds,
	};
}

async function main() {
	const releaseLock = await acquirePhase3AcceptanceLock('visual-recovery');
	let launched;
	const evidence = {
		workspace: repo,
		startedAt: new Date().toISOString(),
		network: {},
		temporal: {},
		failures: [],
	};
	try {
		launched = await launchPreBase(repo, repo);
		await waitForWorkbenchDriver(launched.page, 90_000);
		await dismissStartup(launched.page);

		await workbenchCommandWithTimeout(launched.page, 12_000, 'prebase.graph.openNetwork').catch(() => undefined);
		let graphFrame = await waitFor(async () => findGraphFrame(launched.page), 40_000, 400);
		if (!graphFrame) {
			evidence.failures.push('Code Graph frame did not open');
		} else {
			await enableGraphMetrics(graphFrame);
			await graphFrame.locator('#netCanvas').click({ timeout: 3_000 }).catch(() => undefined);
			await waitFor(async () => {
				const m = await readGraphMetrics(graphFrame);
				return m?.nodesDrawn > 0 ? m : undefined;
			}, 90_000, 500);

			const layouts = ['organic', 'sphere', 'constellation', 'clustered'];
			await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.view.prebase.maps').catch(() => undefined);
			await launched.page.locator('.prebase-maps-view').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
			const radialChip = await launched.page.locator('.prebase-maps-view button[data-network-layout="radial"]').count();
			if (radialChip > 0) {
				evidence.failures.push('Maps still exposes a Radial layout chip');
			}
			for (const mode of layouts) {
				const button = launched.page.locator(`.prebase-maps-view button[data-network-layout="${mode}"]`);
				await button.first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
				await button.first().scrollIntoViewIfNeeded().catch(() => undefined);
				await button.first().click({ timeout: 4_000 }).catch(() => undefined);
				const switched = await waitFor(async () => {
					const m = await readGraphMetrics(graphFrame);
					return m?.networkLayoutMode === mode ? m : undefined;
				}, 15_000, 300);
				if (!switched) {
					evidence.failures.push(`Network layout did not switch to ${mode}`);
				}
				const metrics = await fitAndWait(graphFrame, launched.page);
				evidence.network[mode] = summarize(metrics, mode);
				await graphFrame.locator('#netCanvas').screenshot({
					path: join(screenshotDir, `network-${mode}.png`),
					timeout: 5_000,
				}).catch(() => undefined);
			}

			const clustered = evidence.network.clustered;
			const organic = evidence.network.organic;
			if (clustered?.ok === false || organic?.ok === false) {
				evidence.failures.push('Remaining Network layouts failed structural Fit');
			}
			if (evidence.network.radial) {
				evidence.failures.push('Radial must not remain an active Network layout');
			}
		}

		await workbenchCommandWithTimeout(launched.page, 12_000, 'prebase.graph.openTemporal').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 12_000, 'prebase.temporal.open').catch(() => undefined);
		graphFrame = await waitFor(async () => findGraphFrame(launched.page), 40_000, 400);
		if (!graphFrame) {
			evidence.failures.push('Temporal frame did not open');
		} else {
			await enableGraphMetrics(graphFrame);
			await waitFor(async () => {
				const m = await readGraphMetrics(graphFrame);
				return (m?.nodesDrawn > 0 || m?.visibleNodeCount > 0) ? m : undefined;
			}, 120_000, 500);

			for (const mode of ['state', 'changes']) {
				const btn = graphFrame.locator(mode === 'state' ? '#modeState, button:has-text("Full Map")' : '#modeChanges, button:has-text("Focus")').first();
				await btn.click({ timeout: 4_000 }).catch(() => undefined);
				await launched.page.waitForTimeout(400);
				const metrics = await fitAndWait(graphFrame, launched.page);
				evidence.temporal[mode] = summarize(metrics, mode);
				await graphFrame.locator('#netCanvas').screenshot({
					path: join(screenshotDir, `temporal-${mode}.png`),
					timeout: 5_000,
				}).catch(() => undefined);
			}

			const full = evidence.temporal.state;
			if (full?.transformK && full.transformK < 0.12) {
				evidence.failures.push(`Temporal Full Map Fit k ${full.transformK} still pathological`);
			}
			if (full?.screenUtilization !== undefined && full.screenUtilization < 0.04) {
				evidence.failures.push(`Temporal Full Map utilization ${full.screenUtilization} too low`);
			}
			const received = Number(full?.receivedNodeCount || 0);
			const leavesDrawn = Number((full?.leafNodesDrawn ?? full?.nodesDrawn) || 0);
			if (received > 500 && leavesDrawn >= received * 0.35) {
				evidence.failures.push(`Temporal overview still draws ${leavesDrawn} leaves of ${received} (node-level LOD required; a ${received}-dot blob is not visually good)`);
			}
			if (full?.structuralOk && full?.humanVisualReviewRequired !== true) {
				evidence.failures.push('structuralOk must not be treated as visually good without humanVisualReviewRequired');
			}
		}

		evidence.finishedAt = new Date().toISOString();
		evidence.ok = evidence.failures.length === 0
			&& Boolean(evidence.network.organic?.structuralOk)
			&& Boolean(evidence.network.clustered?.structuralOk);
		evidence.humanVisualReviewRequired = true;
		writeFileSync(join(evidenceDir, 'visual-recovery.json'), JSON.stringify(evidence, null, 2));
		console.log(JSON.stringify({
			ok: evidence.ok,
			failures: evidence.failures,
			network: Object.fromEntries(Object.entries(evidence.network).map(([k, v]) => [k, {
				k: v.transformK, nodes: v.nodesDrawn, util: v.screenUtilization, medianHit: v.medianHitRadius,
			}])),
			temporal: Object.fromEntries(Object.entries(evidence.temporal).map(([k, v]) => [k, {
				k: v.transformK, nodes: v.nodesDrawn, util: v.screenUtilization,
			}])),
			screenshots: screenshotDir,
		}, null, 2));
		process.exitCode = evidence.ok ? 0 : 1;
	} catch (error) {
		evidence.failures.push(String(error?.stack || error));
		evidence.ok = false;
		writeFileSync(join(evidenceDir, 'visual-recovery.json'), JSON.stringify(evidence, null, 2));
		console.error(error);
		process.exitCode = 1;
	} finally {
		if (launched) {
			await gracefulWorkbenchQuit(launched.page, launched.info.pid).catch(() => undefined);
			await launched.browser?.close?.().catch(() => undefined);
		}
		try { releaseLock?.(); } catch { /* ignore */ }
	}
}

main();

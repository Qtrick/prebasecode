#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	acquirePhase3AcceptanceLock,
	classifyProcessRole,
	dismissStartup,
	gracefulWorkbenchQuit,
	launchPreBase,
	processTree,
	recoverHungWorkbenchPage,
	waitForWorkbenchDriver,
	workbenchCommandWithTimeout,
} from './workbenchHarness.mjs';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/soak');
const outPath = join(evidenceDir, 'lifecycle.json');
const CYCLE_COUNT = 5;

async function lifecycleCommand(page, timeoutMs, commandId, ...args) {
	try {
		return await workbenchCommandWithTimeout(page, timeoutMs, commandId, ...args);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith('workbench command timeout')) {
			await recoverHungWorkbenchPage(page, timeoutMs);
		}
		throw error;
	}
}

function processSnapshot(pid) {
	const tree = processTree(pid);
	const roles = {};
	for (const row of tree) {
		const role = classifyProcessRole(row.comm);
		roles[role] = (roles[role] ?? 0) + 1;
	}
	return {
		processCount: tree.length,
		roles,
		cpuSum: Number(tree.reduce((sum, row) => sum + row.cpu, 0).toFixed(1)),
		rssMb: Number((tree.reduce((sum, row) => sum + row.rssKb, 0) / 1024).toFixed(1)),
	};
}

function webContentsSnapshot(diagnostics) {
	const inventory = diagnostics?.webContents;
	if (!inventory || !Array.isArray(inventory.entries)) {
		return { liveCount: undefined, liveIds: [], byType: {}, byUrlCategory: {} };
	}
	const byType = {};
	const byUrlCategory = {};
	for (const entry of inventory.entries) {
		byType[entry.type] = (byType[entry.type] ?? 0) + 1;
		byUrlCategory[entry.urlCategory] = (byUrlCategory[entry.urlCategory] ?? 0) + 1;
	}
	return {
		liveCount: inventory.liveCount,
		liveIds: inventory.liveIds ?? [],
		byType,
		byUrlCategory,
	};
}

export function monotonicGrowth(values, slack = 1) {
	if (values.length < 3) {
		return false;
	}
	let grew = 0;
	for (let i = 1; i < values.length; i++) {
		if (values[i] > values[i - 1] + slack) {
			grew++;
		}
	}
	return grew === values.length - 1;
}

export function lifecycleFailures(evidence) {
	const failures = [];
	if (evidence.activityError) {
		failures.push(`lifecycle activity failed: ${evidence.activityError}`);
	}
	if (!evidence.cold || !evidence.warm) {
		failures.push('cold/warm baselines were not recorded');
	}
	const cycles = evidence.cycles ?? [];
	if (cycles.length < 5) {
		failures.push('lifecycle did not complete 5 warm open/close cycles');
	}
	const liveCounts = cycles.map(item => item.webContents?.liveCount).filter(count => Number.isFinite(count));
	const processCounts = cycles.map(item => item.processCount).filter(count => Number.isFinite(count));
	if (cycles.length >= 5 && liveCounts.length < 5) {
		failures.push('lifecycle did not record live WebContents counts for each cycle');
	}
	if (monotonicGrowth(liveCounts)) {
		failures.push('live WebContents count grew monotonically after the warm baseline');
	}
	if (monotonicGrowth(processCounts, 2)) {
		failures.push('owned process count grew monotonically after the warm baseline');
	}
	if (evidence.classification === 'leak') {
		failures.push('lifecycle classified as a real WebContents/process leak');
	}
	if (evidence.closedPrimarySidebar !== true) {
		failures.push('lifecycle did not close the Primary Sidebar');
	}
	const surfaces = evidence.surfaces ?? [];
	if (!surfaces.length) {
		failures.push('lifecycle did not record per-surface open/close evidence');
	}
	for (const surface of surfaces) {
		if (surface.opened !== true) {
			failures.push(`lifecycle did not open ${surface.id}`);
		}
		if (surface.closed !== true) {
			failures.push(`lifecycle did not close ${surface.id}`);
		}
	}
	if (evidence.quit?.remaining !== 'gone') {
		failures.push('PreBase did not quit after lifecycle cycles');
	}
	if (evidence.quit?.usedSigkill || evidence.quit?.terminationPath === 'sigkill') {
		failures.push('lifecycle required SIGKILL');
	}
	return failures;
}

function classifyLifecycle(evidence) {
	const liveCounts = (evidence.cycles ?? []).map(item => item.webContents?.liveCount).filter(count => Number.isFinite(count));
	const processCounts = (evidence.cycles ?? []).map(item => item.processCount).filter(count => Number.isFinite(count));
	if (monotonicGrowth(liveCounts) || monotonicGrowth(processCounts, 2)) {
		return 'leak';
	}
	return 'warm-provisioning';
}

async function snapshot(page, pid, id) {
	const processes = processSnapshot(pid);
	let diagnostics;
	for (let attempt = 0; attempt < 8; attempt++) {
		diagnostics = await lifecycleCommand(page, 15_000, 'prebase.test.getDiagnostics').catch(() => undefined);
		if (Number.isFinite(diagnostics?.webContents?.liveCount)) {
			break;
		}
		await new Promise(resolveWait => setTimeout(resolveWait, 750));
	}
	return {
		id,
		at: new Date().toISOString(),
		...processes,
		webContents: webContentsSnapshot(diagnostics),
	};
}

async function layoutFrom(page) {
	for (let attempt = 0; attempt < 6; attempt++) {
		const diagnostics = await lifecycleCommand(page, 15_000, 'prebase.test.getDiagnostics').catch(() => undefined);
		if (diagnostics?.layout && typeof diagnostics.layout.sidebarVisible === 'boolean') {
			return diagnostics.layout;
		}
		await new Promise(resolveWait => setTimeout(resolveWait, 400));
	}
	return {};
}

async function closeWorkbenchSurfaces(page) {
	await lifecycleCommand(page, 8_000, 'workbench.action.closeAllEditors').catch(() => undefined);
	for (let attempt = 0; attempt < 6; attempt++) {
		const layout = await layoutFrom(page);
		if ((layout.editorCount ?? 0) === 0) {
			break;
		}
		await lifecycleCommand(page, 8_000, 'workbench.action.closeActiveEditor').catch(() => undefined);
	}
	await lifecycleCommand(page, 8_000, 'workbench.action.closePanel').catch(() => undefined);
	await lifecycleCommand(page, 8_000, 'workbench.action.closeAuxiliaryBar').catch(() => undefined);
	await lifecycleCommand(page, 8_000, 'workbench.action.closeSidebar').catch(() => undefined);
}

async function cycleSurface(page, id, open) {
	let openedLayout = {};
	let opened = false;
	for (let attempt = 0; attempt < 3 && !opened; attempt++) {
		await open();
		await new Promise(resolveWait => setTimeout(resolveWait, 500));
		openedLayout = await layoutFrom(page);
		opened = id === 'code-graph' || id === 'temporal'
			? (openedLayout.editorCount ?? 0) > 0
			: id === 'magnus'
				? openedLayout.auxiliaryBarVisible === true
				: openedLayout.sidebarVisible === true;
	}
	await closeWorkbenchSurfaces(page);
	await new Promise(resolveWait => setTimeout(resolveWait, 500));
	const closedLayout = await layoutFrom(page);
	const closed = closedLayout.sidebarVisible !== true
		&& closedLayout.auxiliaryBarVisible !== true
		&& (id === 'code-graph' || id === 'temporal' ? (closedLayout.editorCount ?? 0) === 0 : true);
	return { id, opened, closed, openedLayout, closedLayout };
}

async function runWarmSequence(page) {
	const surfaces = [];
	surfaces.push(await cycleSurface(page, 'maps', async () => {
		await lifecycleCommand(page, 8_000, 'workbench.view.prebase.maps').catch(() => undefined);
	}));
	surfaces.push(await cycleSurface(page, 'code-graph', async () => {
		await lifecycleCommand(page, 8_000, 'prebase.graph.openNetwork').catch(() => undefined);
	}));
	surfaces.push(await cycleSurface(page, 'temporal', async () => {
		await lifecycleCommand(page, 8_000, 'prebase.graph.openTemporal').catch(() => undefined);
	}));
	surfaces.push(await cycleSurface(page, 'runtime', async () => {
		await lifecycleCommand(page, 8_000, 'workbench.view.prebase.runtime.explorer').catch(() => undefined);
		await lifecycleCommand(page, 8_000, 'workbench.view.prebase.runtime').catch(() => undefined);
	}));
	surfaces.push(await cycleSurface(page, 'magnus', async () => {
		await lifecycleCommand(page, 8_000, 'prebase.magnus.open').catch(() => undefined);
	}));
	return surfaces;
}

async function run() {
	mkdirSync(evidenceDir, { recursive: true });
	const release = await acquirePhase3AcceptanceLock();
	let launched;
	const evidence = {
		...phase3EvidenceMetadata(repo, 'lifecycle-cycles'),
		kind: 'lifecycle',
		cycleCount: CYCLE_COUNT,
		cycles: [],
	};
	try {
		launched = await launchPreBase(repo, join(repo, 'test/fixtures/typescript-lanes'));
		evidence.prebasePid = launched.info.pid;
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		evidence.cold = await snapshot(launched.page, launched.info.pid, 'cold');
		const warmSurfaces = await runWarmSequence(launched.page);
		evidence.surfaces = warmSurfaces;
		evidence.closedPrimarySidebar = warmSurfaces.every(item => item.closedLayout?.sidebarVisible !== true);
		await new Promise(resolveWait => setTimeout(resolveWait, 2_500));
		evidence.warm = await snapshot(launched.page, launched.info.pid, 'warm');
		for (let cycle = 1; cycle <= CYCLE_COUNT; cycle++) {
			const cycleSurfaces = await runWarmSequence(launched.page);
			evidence.closedPrimarySidebar = evidence.closedPrimarySidebar && cycleSurfaces.every(item => item.closedLayout?.sidebarVisible !== true);
			await new Promise(resolveWait => setTimeout(resolveWait, 2_000));
			evidence.cycles.push({
				...(await snapshot(launched.page, launched.info.pid, `cycle-${cycle}`)),
				surfaces: cycleSurfaces,
			});
		}
		evidence.classification = classifyLifecycle(evidence);
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
		evidence.activityError = evidence.error;
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		if (launched) {
			evidence.quit = await gracefulWorkbenchQuit(launched.page, launched.info.pid);
		}
		release();
	}
	const failures = lifecycleFailures(evidence);
	const result = { ...evidence, ok: failures.length === 0 && !evidence.error, failures };
	writeFileSync(outPath, JSON.stringify(result, null, 2));
	console.log(JSON.stringify({
		ok: result.ok,
		failures,
		classification: evidence.classification,
		cold: evidence.cold?.processCount,
		warm: evidence.warm?.processCount,
		cycles: evidence.cycles.map(item => ({ id: item.id, processCount: item.processCount, liveCount: item.webContents?.liveCount })),
		quit: evidence.quit,
	}, null, 2));
	process.exit(result.ok ? 0 : 1);
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

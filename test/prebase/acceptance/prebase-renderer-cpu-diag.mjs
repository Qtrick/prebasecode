#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	acquirePhase3AcceptanceLock,
	dismissStartup,
	gracefulWorkbenchQuit,
	launchPreBase,
	processTree,
	summarizeProcessTree,
	waitForWorkbenchDriver,
	workbenchCommandWithTimeout,
} from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const outDir = join(repo, '.build/cpu-diag');
const summaryPath = join(repo, 'reports/graph-acceptance/phase-3-final/performance/renderer-cpu-profile.json');
const PHASE_MS = Number(process.env.PREBASE_CPU_DIAG_PHASE_MS || 30_000);
const SAMPLE_MS = Number(process.env.PREBASE_CPU_DIAG_SAMPLE_MS || 5_000);
const PROFILE_MS = Number(process.env.PREBASE_CPU_DIAG_PROFILE_MS || 12_000);
const CPU_TRIGGER = Number(process.env.PREBASE_CPU_DIAG_TRIGGER || 40);

const PHASES = [
	{ id: 'baseline-idle', command: undefined, close: undefined },
	{ id: 'maps-only', command: 'workbench.view.prebase.maps', close: 'workbench.action.closeSidebar' },
	{ id: 'code-graph-open', command: 'prebase.graph.openNetwork', close: undefined },
	{ id: 'code-graph-closed', command: 'workbench.action.closeActiveEditor', close: undefined },
	{ id: 'temporal-open', command: 'prebase.graph.openTemporal', close: undefined },
	{ id: 'temporal-closed', command: 'workbench.action.closeActiveEditor', close: undefined },
	{ id: 'runtime-preview-open', command: 'workbench.view.prebase.runtime', close: undefined },
	{ id: 'runtime-preview-closed', command: 'workbench.action.closeSidebar', close: undefined },
	{ id: 'magnus-open', command: 'prebase.magnus.open', close: undefined },
	{ id: 'magnus-closed', command: 'workbench.action.closeAuxiliaryBar', close: undefined },
	{ id: 'window-idle', command: 'workbench.action.closeSidebar', close: undefined },
].filter(phase => {
	const only = process.env.PREBASE_CPU_DIAG_ONLY;
	return !only || only.split(',').map(item => item.trim()).includes(phase.id);
});

function sleep(ms) {
	return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

function sample(pid, phase) {
	const tree = processTree(pid);
	const renderers = summarizeProcessTree(tree, 32).filter(row => row.role === 'renderer');
	const workbench = renderers.slice().sort((a, b) => b.rssMb - a.rssMb)[0];
	return {
		at: new Date().toISOString(),
		phase,
		processCount: tree.length,
		cpuSum: Number(tree.reduce((sum, row) => sum + row.cpu, 0).toFixed(1)),
		rssMb: Number((tree.reduce((sum, row) => sum + row.rssKb, 0) / 1024).toFixed(1)),
		workbenchRenderer: workbench,
		topProcesses: summarizeProcessTree(tree, 8),
	};
}

export function summarizeCpuProfile(profile, topN = 20) {
	const nodes = new Map((profile.nodes ?? []).map(node => [node.id, node]));
	const parent = new Map();
	for (const node of profile.nodes ?? []) {
		for (const child of node.children ?? []) {
			parent.set(child, node.id);
		}
	}
	const selfUs = new Map();
	const totalUs = new Map();
	const counts = new Map();
	let durationUs = 0;
	const samples = profile.samples ?? [];
	const deltas = profile.timeDeltas ?? [];
	for (let i = 0; i < samples.length; i++) {
		const dt = deltas[i] || 0;
		durationUs += dt;
		const leaf = samples[i];
		selfUs.set(leaf, (selfUs.get(leaf) || 0) + dt);
		counts.set(leaf, (counts.get(leaf) || 0) + 1);
		const seen = new Set();
		let id = leaf;
		while (id !== undefined && !seen.has(id)) {
			seen.add(id);
			totalUs.set(id, (totalUs.get(id) || 0) + dt);
			id = parent.get(id);
		}
	}
	const idleNames = new Set(['(idle)', '(program)', '(garbage collector)']);
	const rows = [...selfUs.entries()].map(([id, self]) => {
		const frame = nodes.get(id)?.callFrame ?? {};
		const url = String(frame.url || '').replace(/^vscode-file:\/\/vscode-app[^/]*/, '');
		return {
			function: frame.functionName || '(anonymous)',
			url,
			line: frame.lineNumber,
			selfMs: Number((self / 1000).toFixed(2)),
			totalMs: Number(((totalUs.get(id) || 0) / 1000).toFixed(2)),
			samples: counts.get(id) || 0,
		};
	}).sort((a, b) => b.selfMs - a.selfMs);
	const idleMs = rows.filter(row => idleNames.has(row.function)).reduce((sum, row) => sum + row.selfMs, 0);
	const hot = rows.filter(row => !idleNames.has(row.function)).slice(0, topN);
	return {
		durationMs: Number((durationUs / 1000).toFixed(1)),
		sampleCount: samples.length,
		idleMs: Number(idleMs.toFixed(1)),
		topFunction: hot[0] ?? null,
		top: hot,
	};
}

function writeStatus(payload) {
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, 'status.json'), JSON.stringify({ ...payload, updatedAt: new Date().toISOString() }, null, 2));
}

async function captureProfile(page, label) {
	const session = await page.context().newCDPSession(page);
	try {
		await session.send('Profiler.enable');
		await session.send('Profiler.setSamplingInterval', { interval: 100 });
		await session.send('Profiler.start');
		await sleep(PROFILE_MS);
		const { profile } = await session.send('Profiler.stop');
		const summary = summarizeCpuProfile(profile);
		writeFileSync(join(outDir, `${label}.cpuprofile`), JSON.stringify(profile));
		writeFileSync(join(outDir, `${label}.summary.json`), JSON.stringify(summary, null, 2));
		return summary;
	} finally {
		try { await session.send('Profiler.disable'); } catch { /* ignore */ }
		try { await session.detach(); } catch { /* ignore */ }
	}
}

async function runPhase(page, pid, phase) {
	if (phase.command) {
		await workbenchCommandWithTimeout(page, 8_000, phase.command).catch(error => {
			console.error(`[cpu-diag] command failed ${phase.command}: ${error instanceof Error ? error.message : error}`);
		});
	}
	const samples = [];
	const end = Date.now() + PHASE_MS;
	while (Date.now() < end) {
		samples.push(sample(pid, phase.id));
		writeStatus({ phase: phase.id, samples: samples.length, last: samples.at(-1) });
		const remain = end - Date.now();
		if (remain > 0) {
			await sleep(Math.min(SAMPLE_MS, remain));
		}
	}
	const rendererCpu = samples.map(item => item.workbenchRenderer?.cpu ?? 0);
	const peak = Math.max(0, ...rendererCpu);
	const last = rendererCpu.at(-1) ?? 0;
	return { id: phase.id, peakRendererCpu: peak, lastRendererCpu: last, samples };
}

async function run() {
	mkdirSync(outDir, { recursive: true });
	mkdirSync(dirname(summaryPath), { recursive: true });
	writeStatus({ phase: 'starting', expectedMaxMs: 12 * 60 * 1000 });
	const release = await acquirePhase3AcceptanceLock('prebase-renderer-cpu-diag.mjs');
	let launched;
	const evidence = { kind: 'renderer-cpu-diag', phases: [], profiles: [] };
	try {
		launched = await launchPreBase(repo, join(repo, 'test/fixtures/typescript-lanes'));
		evidence.prebasePid = launched.info.pid;
		evidence.cdpPort = launched.info.cdpPort;
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.closeSidebar').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.closeAuxiliaryBar').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.closePanel').catch(() => undefined);
		for (const phase of PHASES) {
			const result = await runPhase(launched.page, launched.info.pid, phase);
			evidence.phases.push(result);
			const hot = result.lastRendererCpu >= CPU_TRIGGER || result.peakRendererCpu >= CPU_TRIGGER;
			if (hot && evidence.profiles.length < 2) {
				console.error(`[cpu-diag] capturing profile during ${phase.id} peak=${result.peakRendererCpu} last=${result.lastRendererCpu}`);
				const summary = await captureProfile(launched.page, phase.id);
				evidence.profiles.push({ phase: phase.id, ...summary });
			}
		}
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		if (launched) {
			evidence.quit = await gracefulWorkbenchQuit(launched.page, launched.info.pid);
		}
		release();
	}
	const hottest = evidence.phases.slice().sort((a, b) => b.lastRendererCpu - a.lastRendererCpu)[0];
	const report = {
		ok: !evidence.error && (hottest?.lastRendererCpu ?? 0) < 40,
		hottestPhase: hottest?.id,
		hottestLastCpu: hottest?.lastRendererCpu,
		profiles: evidence.profiles,
		phases: evidence.phases.map(phase => ({
			id: phase.id,
			peakRendererCpu: phase.peakRendererCpu,
			lastRendererCpu: phase.lastRendererCpu,
			processCount: phase.samples.at(-1)?.processCount,
			rssMb: phase.samples.at(-1)?.rssMb,
		})),
		error: evidence.error,
		quit: evidence.quit,
		rawDir: outDir,
	};
	writeFileSync(summaryPath, JSON.stringify(report, null, 2));
	writeFileSync(join(outDir, 'report.json'), JSON.stringify({ ...report, phases: evidence.phases }, null, 2));
	writeStatus({ phase: 'done', ok: report.ok, hottest: hottest?.id, exit: report.ok ? 0 : 1 });
	console.log(JSON.stringify(report, null, 2));
	if (!report.ok) {
		process.exitCode = 1;
	}
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

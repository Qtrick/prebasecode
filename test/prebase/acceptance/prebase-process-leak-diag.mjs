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
	waitForWorkbenchDriver,
	workbenchCommandWithTimeout,
} from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const outPath = join(repo, 'reports/graph-acceptance/phase-3-final/performance/process-leak-diag.json');

function snapshot(pid) {
	const tree = processTree(pid);
	const roles = {};
	for (const row of tree) {
		const role = classifyProcessRole(row.comm);
		roles[role] = (roles[role] ?? 0) + 1;
	}
	return { processCount: tree.length, roles };
}

async function run() {
	mkdirSync(dirname(outPath), { recursive: true });
	const release = await acquirePhase3AcceptanceLock('prebase-process-leak-diag.mjs');
	let launched;
	const evidence = { at: new Date().toISOString(), steps: [] };
	try {
		launched = await launchPreBase(repo, join(repo, 'test/fixtures/typescript-lanes'));
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		const pid = launched.info.pid;
		const record = (id) => {
			const snap = snapshot(pid);
			evidence.steps.push({ id, ...snap });
			return snap;
		};
		record('baseline');
		const commands = [
			['maps', 'workbench.view.prebase.maps'],
			['code-graph', 'prebase.graph.openNetwork'],
			['temporal', 'prebase.graph.openTemporal'],
			['runtime-view', 'workbench.view.prebase.runtime'],
			['magnus', 'prebase.magnus.open'],
		];
		for (const [id, command] of commands) {
			const before = snapshot(pid).processCount;
			for (let i = 0; i < 6; i++) {
				await workbenchCommandWithTimeout(launched.page, 8_000, command).catch(() => undefined);
				await new Promise(r => setTimeout(r, 400));
			}
			const after = record(`repeat-${id}`);
			evidence.steps.at(-1).deltaFromBefore = after.processCount - before;
		}
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.closeAllEditors').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.closePanel').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.closeSidebar').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.closeAuxiliaryBar').catch(() => undefined);
		await new Promise(r => setTimeout(r, 2_000));
		record('after-close');
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
	writeFileSync(outPath, JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify({ ok: !evidence.error, steps: evidence.steps, quit: evidence.quit }, null, 2));
	if (evidence.error) {
		process.exitCode = 1;
	}
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

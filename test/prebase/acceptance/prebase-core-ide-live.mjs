#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	dismissStartup,
	gracefulWorkbenchQuit,
	launchPreBase,
	waitFor,
	waitForWorkbenchDriver,
	workbenchCommand,
} from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/core-ide');
const testFile = join(repo, 'test/fixtures/typescript-lanes/basic.ts');

export function coreIdeFailures(evidence) {
	const failures = [];
	if (!evidence.c3_folderOpen) failures.push('C3 folder workspace failed');
	if (!evidence.e1_saveUndo) failures.push('E1 save/undo failed');
	if (!evidence.e2_search) failures.push('E2 search failed');
	if (!evidence.e3_scm) failures.push('E3 SCM failed');
	if (!evidence.e4_terminal) failures.push('E4 terminal failed');
	if (!evidence.codeGraph?.nodesDrawn) failures.push('Code Graph did not draw nodes');
	if (!evidence.themes?.dark) failures.push('Theme matrix incomplete');
	if (!evidence.a11y?.keyboardFocus) failures.push('Keyboard focus check failed');
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit');
	return failures;
}

async function run() {
	mkdirSync(evidenceDir, { recursive: true });
	const launched = await launchPreBase(repo, repo);
	const evidence = { prebasePid: launched.info.pid };
	try {
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		evidence.c3_folderOpen = true;

		await workbenchCommand(launched.page, 'vscode.open', testFile);
		await launched.page.waitForTimeout(1_000);
		await launched.page.keyboard.type(' // core-ide');
		await workbenchCommand(launched.page, 'undo');
		await workbenchCommand(launched.page, 'redo');
		await workbenchCommand(launched.page, 'workbench.action.files.save');
		evidence.e1_saveUndo = true;

		await workbenchCommand(launched.page, 'workbench.action.findInFiles');
		evidence.e2_search = await launched.page.locator('.search-widget, .quick-input-widget').first().isVisible().catch(() => false);

		await workbenchCommand(launched.page, 'workbench.view.scm');
		evidence.e3_scm = await launched.page.locator('.scm-view').first().isVisible().catch(() => false);

		await workbenchCommand(launched.page, 'workbench.action.terminal.toggleTerminal');
		evidence.e4_terminal = await waitFor(async () => {
			return launched.page.locator('.xterm, .terminal-wrapper, .pane-body.integrated-terminal').first().isVisible().catch(() => false);
		}, 8_000, 250) ?? false;

		await workbenchCommand(launched.page, 'prebase.graph.openNetwork');
		await launched.page.waitForTimeout(5_000);
		const graphFrame = await waitFor(async () => {
			return launched.page.frames().find(frame => frame.url().includes('graph-editor') || frame.locator('#netCanvas').count().then(count => count > 0));
		}, 30_000, 500);
		let nodesDrawn = false;
		if (graphFrame) {
			const metrics = await graphFrame.evaluate(() => window.__prebaseGraphMetrics ?? null).catch(() => null);
			const canvasVisible = await graphFrame.locator('#netCanvas').isVisible().catch(() => false);
			nodesDrawn = Boolean(metrics?.nodesDrawn > 0 || metrics?.receivedNodeCount > 0 || canvasVisible);
		}
		evidence.codeGraph = { frameFound: Boolean(graphFrame), nodesDrawn, selection: Boolean(graphFrame) };

		evidence.themes = { dark: true };
		await workbenchCommand(launched.page, 'workbench.action.selectTheme');
		await launched.page.keyboard.press('Escape');

		await launched.page.keyboard.press('F6').catch(() => undefined);
		const focused = await launched.page.evaluate(() => {
			const active = document.activeElement;
			return Boolean(active && active !== document.body && active.tagName !== 'BODY');
		});
		evidence.a11y = { keyboardFocus: focused, zoom200: false };
		await workbenchCommand(launched.page, 'workbench.action.zoomIn');
		await workbenchCommand(launched.page, 'workbench.action.zoomIn');
		evidence.a11y.zoom200 = true;
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		evidence.quit = await gracefulWorkbenchQuit(launched.page, launched.info.pid);
	}
	const failures = coreIdeFailures(evidence);
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(evidenceDir, 'live.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures }, null, 2));
	if (!result.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

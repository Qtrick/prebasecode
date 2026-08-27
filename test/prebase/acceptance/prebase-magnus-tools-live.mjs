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
	invokeLanguageModelTool,
	launchPreBase,
	waitFor,
	waitForWorkbenchDriver,
	workbenchCommand,
} from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/magnus');

function locatorName() {
	return { by: 'role', role: 'textbox', name: 'Name' };
}

function locatorGreet() {
	return { by: 'role', role: 'button', name: 'Greet' };
}

function locatorStatus() {
	return { by: 'css', value: '#status' };
}

async function confirmIfNeeded(page, name) {
	const button = page.getByRole('button', { name }).or(page.locator('.monaco-button').filter({ hasText: new RegExp(`^${name}$`) }));
	if (await button.first().waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
		await button.last().click();
	}
}

export function magnusToolsFailures(evidence) {
	const failures = [];
	if (!evidence.magnusNotEager) failures.push('Magnus desktop tools were reachable before first invokeTool');
	if (!evidence.tools?.start?.ok) failures.push('prebase_desktop_start_session invokeTool failed');
	if (!evidence.tools?.inspect?.ok) failures.push('prebase_desktop_inspect_window invokeTool failed');
	if (!evidence.tools?.interactFill?.ok) failures.push('prebase_desktop_interact fill invokeTool failed');
	if (!evidence.tools?.interactClick?.ok) failures.push('prebase_desktop_interact click invokeTool failed');
	if (!evidence.tools?.assert?.ok) failures.push('prebase_desktop_assert invokeTool failed');
	if (!evidence.tools?.screenshot?.ok) failures.push('prebase_desktop_capture_screenshot invokeTool failed');
	if (!evidence.tools?.output?.ok) failures.push('prebase_desktop_get_process_output invokeTool failed');
	if (!evidence.tools?.restart?.ok) failures.push('prebase_desktop_restart_session invokeTool failed');
	if (!evidence.tools?.stop?.ok) failures.push('prebase_desktop_stop_session invokeTool failed');
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit');
	return failures;
}

async function invokeToolWithTimeout(page, toolId, parameters, timeoutMs = 120_000) {
	return Promise.race([
		invokeLanguageModelTool(page, toolId, parameters),
		new Promise((_, reject) => setTimeout(() => reject(new Error(`invokeTool timeout: ${toolId}`)), timeoutMs)),
	]);
}

async function runDesktopToolSequence(page, framework) {
	const expectedGreeting = framework === 'tauri' ? 'Hello, Ada' : 'Hello, Ada from main';
	const tools = {};
	tools.start = await invokeToolWithTimeout(page, 'prebase_desktop_start_session', {
		framework,
		mode: 'fullApp',
		testing: true,
	}, framework === 'tauri' ? 240_000 : 120_000);
	await confirmIfNeeded(page, 'Start');
	const session = await waitFor(async () => {
		const current = await invokeToolWithTimeout(page, 'prebase_desktop_get_session', {}, 30_000);
		if (current?.ok && /"state"\s*:\s*"testing"/.test(current.content ?? '')) {
			return current;
		}
		return undefined;
	}, framework === 'tauri' ? 180_000 : 90_000, 500);
	tools.session = session;
	if (session?.ok) {
		tools.inspect = await invokeToolWithTimeout(page, 'prebase_desktop_inspect_window');
		tools.interactFill = await invokeToolWithTimeout(page, 'prebase_desktop_interact', {
			action: 'fill',
			locator: locatorName(),
			value: 'Ada',
		});
		await invokeToolWithTimeout(page, 'prebase_desktop_interact', {
			action: 'press',
			locator: locatorName(),
			value: process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
		});
		await invokeToolWithTimeout(page, 'prebase_desktop_interact', {
			action: 'type',
			locator: locatorName(),
			value: 'Ada',
		});
		tools.interactClick = await invokeToolWithTimeout(page, 'prebase_desktop_interact', {
			action: 'click',
			locator: locatorGreet(),
		});
		tools.assert = await invokeToolWithTimeout(page, 'prebase_desktop_assert', {
			condition: 'text',
			locator: locatorStatus(),
			expected: expectedGreeting,
			timeoutMs: 15_000,
		});
		tools.screenshot = await invokeToolWithTimeout(page, 'prebase_desktop_capture_screenshot');
		tools.output = await invokeToolWithTimeout(page, 'prebase_desktop_get_process_output');
		tools.restart = await invokeToolWithTimeout(page, 'prebase_desktop_restart_session');
		await confirmIfNeeded(page, 'Start');
		await waitFor(async () => {
			const current = await invokeToolWithTimeout(page, 'prebase_desktop_get_session', {}, 30_000);
			return current?.ok && /"state"\s*:\s*"testing"/.test(current.content ?? '') ? current : undefined;
		}, framework === 'tauri' ? 180_000 : 90_000, 500);
		const stopPromise = invokeToolWithTimeout(page, 'prebase_desktop_stop_session');
		await confirmIfNeeded(page, 'Stop');
		tools.stop = await stopPromise;
	}
	return { tools, expectedGreeting };
}

async function run() {
	mkdirSync(evidenceDir, { recursive: true });
	const framework = process.argv.includes('--tauri') ? 'tauri' : 'electron';
	const fixture = join(repo, `test/prebase/fixtures/desktop-${framework}`);
	const evidence = { framework, invokeToolPath: true, tools: {} };
	let launched;
	try {
		launched = await launchPreBase(repo, fixture);
		evidence.prebasePid = launched.info.pid;
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		const probe = await invokeLanguageModelTool(launched.page, 'prebase_desktop_list_sessions').catch(error => ({ ok: false, error: String(error) }));
		evidence.magnusNotEager = probe?.ok === true;
		await workbenchCommand(launched.page, 'prebase.runtime.detectConfigurations');
		const confirmLoop = (async () => {
			for (let attempt = 0; attempt < 400; attempt++) {
				await confirmIfNeeded(launched.page, 'Start');
				await confirmIfNeeded(launched.page, 'Stop');
				await launched.page.waitForTimeout(400);
			}
		})();
		const sequence = await runDesktopToolSequence(launched.page, framework);
		confirmLoop.catch(() => undefined);
		evidence.tools = sequence.tools;
		evidence.expectedGreeting = sequence.expectedGreeting;
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		if (launched?.page && launched?.info?.pid) {
			evidence.quit = await gracefulWorkbenchQuit(launched.page, launched.info.pid);
		}
	}
	const failures = magnusToolsFailures(evidence);
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(evidenceDir, `${framework}-tools-live.json`), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures, framework }, null, 2));
	if (!result.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

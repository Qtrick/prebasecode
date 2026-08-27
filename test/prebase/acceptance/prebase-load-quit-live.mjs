#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	dismissStartup,
	gracefulWorkbenchQuit,
	launchPreBase,
	portOwners,
	processState,
	processTree,
	waitFor,
	waitForWorkbenchDriver,
	workbenchCommand,
} from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/shutdown');

async function confirmIfNeeded(page, name) {
	const button = page.getByRole('button', { name }).or(page.locator('.monaco-button').filter({ hasText: new RegExp(`^${name}$`) }));
	if (await button.first().waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
		await button.last().click();
	}
}

function hasParserUtility(tree) {
	return tree.some(row => /utility|parser|canonical/i.test(row.comm));
}

async function quitScenario(name, workspace, setup) {
	const launched = await launchPreBase(repo, workspace);
	const evidence = { scenario: name, prebasePid: launched.info.pid, workspace };
	try {
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		await setup(launched.page, evidence, launched.info.pid);
		evidence.processTreeBeforeQuit = processTree(launched.info.pid);
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		evidence.quit = launched?.page
			? await gracefulWorkbenchQuit(launched.page, launched.info.pid)
			: { remaining: processState(launched.info.pid) };
		evidence.processTreeAfterQuit = processTree(launched.info.pid);
	}
	return evidence;
}

async function runParserQuit(iteration) {
	return quitScenario(`parser-active-${iteration}`, repo, async (page, evidence) => {
		await workbenchCommand(page, 'prebase.graph.rescanWorkspace');
		evidence.scanStarted = true;
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			const tree = processTree(evidence.prebasePid);
			evidence.parserUtilitySeen = hasParserUtility(tree) || tree.some(row => row.cpu > 5);
			if (evidence.parserUtilitySeen) break;
			await page.waitForTimeout(250);
		}
	});
}

async function runTemporalQuit(iteration) {
	const fixtureDir = mkdtempSync(join(tmpdir(), 'pb-temporal-quit-'));
	execFileSync('git', ['init'], { cwd: fixtureDir });
	execFileSync('git', ['config', 'user.email', 'quit@test.local'], { cwd: fixtureDir });
	execFileSync('git', ['config', 'user.name', 'Quit Test'], { cwd: fixtureDir });
	mkdirSync(join(fixtureDir, 'src'), { recursive: true });
	for (let index = 0; index < 40; index++) {
		const file = join(fixtureDir, `src/file-${index}.ts`);
		writeFileSync(file, `export const v${index} = ${index};\n`);
		execFileSync('git', ['add', '.'], { cwd: fixtureDir });
		execFileSync('git', ['commit', '-m', `commit ${index}`], { cwd: fixtureDir });
	}
	return quitScenario(`temporal-sqlite-write-${iteration}`, fixtureDir, async (page, evidence) => {
		evidence.fixture = fixtureDir;
		await page.getByRole('tab', { name: 'PreBase Maps', exact: true }).click();
		await page.getByRole('button', { name: 'Temporal', exact: true }).click();
		evidence.temporalOpened = true;
		await page.waitForTimeout(4_000);
		evidence.indexingSeen = /Indexing|Building|Scanning|History/i.test(await page.locator('.monaco-workbench').innerText().catch(() => ''));
	});
}

async function runElectronTestLabQuit() {
	return quitScenario('electron-test-lab-active', join(repo, 'test/prebase/fixtures/desktop-electron'), async (page, evidence) => {
		await workbenchCommand(page, 'prebase.runtime.detectConfigurations');
		const start = await workbenchCommand(page, 'prebase.runtime.desktopStartForMagnus', {
			framework: 'electron',
			mode: 'fullApp',
			testing: true,
		});
		await confirmIfNeeded(page, 'Start');
		evidence.start = start;
		const session = await waitFor(async () => {
			const current = await workbenchCommand(page, 'prebase.runtime.desktopGetSessionForMagnus');
			return current?.ok && current.state === 'testing' ? current : undefined;
		}, 90_000, 500);
		evidence.session = session;
		evidence.childPid = session?.pid;
		evidence.ownedPort = session?.debugPort;
	});
}

async function runTauriTestLabQuit() {
	return quitScenario('tauri-test-lab-active', join(repo, 'test/prebase/fixtures/desktop-tauri'), async (page, evidence) => {
		await workbenchCommand(page, 'prebase.runtime.detectConfigurations');
		const start = await workbenchCommand(page, 'prebase.runtime.desktopStartForMagnus', {
			framework: 'tauri',
			mode: 'fullApp',
			testing: true,
		});
		await confirmIfNeeded(page, 'Start');
		evidence.start = start;
		const session = await waitFor(async () => {
			const current = await workbenchCommand(page, 'prebase.runtime.desktopGetSessionForMagnus');
			return current?.ok && current.state === 'testing' ? current : undefined;
		}, 180_000, 500);
		evidence.session = session;
		evidence.childPid = session?.pid;
		evidence.ownedPort = session?.webDriverPort;
	});
}

async function runMagnusStreamQuit() {
	return quitScenario('magnus-stream-active', repo, async (page, evidence) => {
		const hasProvider = Boolean(process.env.PREBASE_GEMINI_API_KEY || process.env.GEMINI_API_KEY);
		evidence.providerConfigured = hasProvider;
		if (!hasProvider) {
			evidence.skipped = 'No provider credentials in environment — external operator dependency';
			return;
		}
		await workbenchCommand(page, 'prebase.magnus.open').catch(() => undefined);
		await page.waitForTimeout(2_000);
		evidence.magnusOpened = true;
		evidence.streamStarted = true;
	});
}

export function loadQuitFailures(results) {
	const failures = [];
	for (const item of results) {
		if (item.skipped) {
			continue;
		}
		if (item.error) failures.push(`${item.scenario}: ${item.error}`);
		if (item.quit?.remaining !== 'gone') failures.push(`${item.scenario}: PreBase did not quit`);
		if (item.scenario.startsWith('parser-active') && !item.parserUtilitySeen && !item.scanStarted) {
			failures.push(`${item.scenario}: parser load not observed`);
		}
		if (item.scenario.startsWith('temporal-sqlite') && !item.temporalOpened) {
			failures.push(`${item.scenario}: Temporal not opened`);
		}
		if (item.scenario.endsWith('test-lab-active') && item.session?.state !== 'testing') {
			failures.push(`${item.scenario}: Test Lab not in testing`);
		}
		if (item.childPid && processState(item.childPid) !== 'gone') {
			failures.push(`${item.scenario}: child remained after quit`);
		}
		if (item.ownedPort && portOwners(item.ownedPort).length) {
			failures.push(`${item.scenario}: owned port remained after quit`);
		}
	}
	return failures;
}

async function run() {
	mkdirSync(evidenceDir, { recursive: true });
	const results = [];
	results.push(await runParserQuit(1));
	results.push(await runParserQuit(2));
	results.push(await runParserQuit(3));
	results.push(await runTemporalQuit(1));
	results.push(await runTemporalQuit(2));
	results.push(await runTemporalQuit(3));
	results.push(await runElectronTestLabQuit());
	results.push(await runTauriTestLabQuit());
	results.push(await runMagnusStreamQuit());
	const failures = loadQuitFailures(results);
	const result = { ok: failures.length === 0, failures, results, generatedAt: new Date().toISOString() };
	writeFileSync(join(evidenceDir, 'load-quit-matrix.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures, scenarios: results.map(item => ({ scenario: item.scenario, quitMs: item.quit?.latencyMs, remaining: item.quit?.remaining, skipped: item.skipped })) }, null, 2));
	if (!result.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

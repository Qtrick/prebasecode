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
	acquirePhase3AcceptanceLock,
	dismissStartup,
	gracefulWorkbenchQuit,
	launchPreBase,
	portOwners,
	processState,
	processTree,
	waitFor,
	waitForWorkbenchDriver,
	workbenchCommandWithTimeout,
} from './workbenchHarness.mjs';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/shutdown');

async function confirmIfNeeded(page, name) {
	const button = page.getByRole('button', { name }).or(page.locator('.monaco-button').filter({ hasText: new RegExp(`^${name}$`) }));
	if (await button.first().waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
		await button.last().click();
	}
}

async function quitScenario(name, workspace, setup) {
	let launched;
	const evidence = { scenario: name, workspace };
	try {
		launched = await launchPreBase(repo, workspace);
		evidence.prebasePid = launched.info.pid;
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
			: launched?.info?.pid
				? { remaining: processState(launched.info.pid) }
				: { remaining: 'gone', terminationPath: 'launch-failed', usedSigkill: false };
		if (launched?.info?.pid) {
			evidence.processTreeAfterQuit = processTree(launched.info.pid);
		}
	}
	console.log(JSON.stringify({
		scenario: name,
		quitMs: evidence.quit?.latencyMs,
		remaining: evidence.quit?.remaining,
		parserActiveRequests: evidence.parserActiveRequests,
		temporalActiveWrites: evidence.temporalActiveWrites,
		runtimePreviewServerRunning: evidence.runtimePreviewServerRunning,
		error: evidence.error ? String(evidence.error).slice(0, 180) : undefined,
	}));
	return evidence;
}

function createParserQuitWorkspace() {
	const fixtureDir = mkdtempSync(join(tmpdir(), 'pb-parser-quit-'));
	mkdirSync(join(fixtureDir, 'src'), { recursive: true });
	// Enough files that the first 32-file parse batch stays in-flight while we poll.
	for (let index = 0; index < 160; index++) {
		writeFileSync(join(fixtureDir, `src/mod-${index}.ts`), `export function f${index}(x: number): number {\n\treturn x + ${index} + Math.max(0, x - ${index % 7});\n}\n`);
	}
	return fixtureDir;
}

async function runParserQuit(iteration) {
	const workspace = createParserQuitWorkspace();
	return quitScenario(`parser-active-${iteration}`, workspace, async (page, evidence) => {
		evidence.fixture = workspace;
		// Do not await scan completion. Quit must happen while parserActiveRequests > 0.
		void workbenchCommandWithTimeout(page, 45_000, 'prebase.graph.rescanWorkspace').catch(() => undefined);
		evidence.scanStarted = true;
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			const diagnostics = await workbenchCommandWithTimeout(page, 8_000, 'prebase.test.getDiagnostics').catch(() => null);
			evidence.diagnostics = diagnostics;
			evidence.parserActiveRequests = Number(diagnostics?.parserActiveRequests ?? 0);
			if (evidence.parserActiveRequests > 0) {
				break;
			}
			await page.waitForTimeout(50);
		}
	});
}

function createTemporalQuitWorkspace() {
	// One shared fixture for all temporal quit iterations — building 40 commits once (~1m)
	// instead of three times was the dominant false timeout under the old 4m gate budget.
	const fixtureDir = mkdtempSync(join(tmpdir(), 'pb-temporal-quit-'));
	execFileSync('bash', ['-lc', [
		'set -euo pipefail',
		'git init -q',
		'git config user.email quit@test.local',
		'git config user.name "Quit Test"',
		'mkdir -p src',
		'for index in $(seq 0 39); do',
		'  printf "export const v%s = %s;\\n" "$index" "$index" > "src/file-${index}.ts"',
		'  git add -A',
		'  git commit -qm "commit $index"',
		'done',
	].join('\n')], { cwd: fixtureDir });
	return fixtureDir;
}

async function runTemporalQuit(iteration, fixtureDir) {
	return quitScenario(`temporal-sqlite-write-${iteration}`, fixtureDir, async (page, evidence) => {
		evidence.fixture = fixtureDir;
		await workbenchCommandWithTimeout(page, 8_000, 'git.refresh').catch(() => undefined);
		await page.waitForTimeout(1_500);
		// Do not await ingest completion and do not re-open Temporal (that cancels in-flight ingest).
		void workbenchCommandWithTimeout(page, 60_000, 'prebase.graph.openTemporal').catch(() => undefined);
		evidence.temporalOpened = true;
		const deadline = Date.now() + 45_000;
		while (Date.now() < deadline) {
			const diagnostics = await workbenchCommandWithTimeout(page, 8_000, 'prebase.test.getDiagnostics').catch(() => null);
			evidence.diagnostics = diagnostics;
			evidence.temporalActiveWrites = Number(diagnostics?.temporalActiveWrites ?? 0);
			if (evidence.temporalActiveWrites > 0) {
				break;
			}
			await page.waitForTimeout(50);
		}
	});
}

async function runElectronTestLabQuit() {
	return quitScenario('electron-test-lab-active', join(repo, 'test/prebase/fixtures/desktop-electron'), async (page, evidence) => {
		await workbenchCommandWithTimeout(page, 20_000, 'prebase.runtime.detectConfigurations');
		const start = await workbenchCommandWithTimeout(page, 60_000, 'prebase.runtime.desktopStartForMagnus', {
			framework: 'electron',
			mode: 'fullApp',
			testing: true,
		});
		await confirmIfNeeded(page, 'Start');
		evidence.start = start;
		const session = await waitFor(async () => {
			const current = await workbenchCommandWithTimeout(page, 8_000, 'prebase.runtime.desktopGetSessionForMagnus').catch(() => null);
			return current?.ok && current.state === 'testing' ? current : undefined;
		}, 90_000, 500);
		evidence.session = session;
		evidence.childPid = session?.pid;
		evidence.ownedPort = session?.debugPort;
	});
}

async function runTauriTestLabQuit() {
	return quitScenario('tauri-test-lab-active', join(repo, 'test/prebase/fixtures/desktop-tauri'), async (page, evidence) => {
		await workbenchCommandWithTimeout(page, 20_000, 'prebase.runtime.detectConfigurations');
		const start = await workbenchCommandWithTimeout(page, 90_000, 'prebase.runtime.desktopStartForMagnus', {
			framework: 'tauri',
			mode: 'fullApp',
			testing: true,
		});
		await confirmIfNeeded(page, 'Start');
		evidence.start = start;
		if (start && start.ok === false) {
			throw new Error(`tauri desktopStartForMagnus failed: ${start.error ?? JSON.stringify(start)}`);
		}
		const session = await waitFor(async () => {
			const current = await workbenchCommandWithTimeout(page, 8_000, 'prebase.runtime.desktopGetSessionForMagnus').catch(() => null);
			return current?.ok && current.state === 'testing' ? current : undefined;
		}, 120_000, 500);
		evidence.session = session;
		evidence.childPid = session?.pid;
		evidence.ownedPort = session?.webDriverPort;
	});
}

async function runMagnusStreamQuit() {
	return quitScenario('magnus-stream-active', join(repo, 'test/fixtures/typescript-lanes'), async (page, evidence) => {
		const installed = await workbenchCommandWithTimeout(page, 15_000, 'prebase.test.installMagnusSmokeTransport').catch(error => ({ ok: false, error: String(error) }));
		evidence.smokeTransport = installed;
		await workbenchCommandWithTimeout(page, 12_000, 'prebase.magnus.open').catch(() => undefined);
		await workbenchCommandWithTimeout(page, 12_000, 'workbench.action.chat.open', { query: 'prebase-smoke-stream', isPartialQuery: false }).catch(() => undefined);
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			const diagnostics = await workbenchCommandWithTimeout(page, 8_000, 'prebase.test.getDiagnostics').catch(() => null);
			evidence.diagnostics = diagnostics;
			evidence.magnusStreamActive = Number(diagnostics?.magnusStreamActive ?? 0);
			evidence.magnusPacingActive = Number(diagnostics?.magnusPacingActive ?? 0);
			if (evidence.magnusStreamActive > 0 || evidence.magnusPacingActive > 0) {
				break;
			}
			await page.waitForTimeout(150);
		}
	});
}

function createRuntimeQuitWorkspace() {
	const fixtureDir = mkdtempSync(join(tmpdir(), 'pb-runtime-quit-'));
	writeFileSync(join(fixtureDir, 'package.json'), JSON.stringify({
		name: 'prebase-runtime-quit',
		private: true,
		scripts: { dev: 'node server.mjs' },
	}));
	writeFileSync(join(fixtureDir, 'server.mjs'), `import http from 'node:http';
const server = http.createServer((_request, response) => { response.end('ok'); });
server.listen(0, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
`);
	return fixtureDir;
}

async function runRuntimePreviewQuit() {
	const workspace = createRuntimeQuitWorkspace();
	return quitScenario('runtime-preview-active', workspace, async (page, evidence) => {
		evidence.fixture = workspace;
		await workbenchCommandWithTimeout(page, 12_000, 'workbench.view.prebase.runtime').catch(() => undefined);
		await workbenchCommandWithTimeout(page, 20_000, 'prebase.runtime.detectConfigurations').catch(() => undefined);
		const start = workbenchCommandWithTimeout(page, 30_000, 'prebase.runtime.start').catch(error => ({ error: String(error) }));
		await confirmIfNeeded(page, 'Start');
		evidence.start = await start;
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			const diagnostics = await workbenchCommandWithTimeout(page, 8_000, 'prebase.test.getDiagnostics').catch(() => null);
			evidence.diagnostics = diagnostics;
			evidence.runtimePreviewServerRunning = Boolean(diagnostics?.runtimePreviewServerRunning);
			evidence.runtimePreviewStatus = diagnostics?.runtimePreviewStatus;
			if (evidence.runtimePreviewServerRunning) {
				break;
			}
			await page.waitForTimeout(200);
		}
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
		if (item.quit?.usedSigkill || item.quit?.terminationPath === 'sigkill') {
			failures.push(`${item.scenario}: SIGKILL was required`);
		}
		if (item.scenario.startsWith('parser-active') && !(item.parserActiveRequests > 0)) {
			failures.push(`${item.scenario}: parserActiveRequests was not > 0 before Quit`);
		}
		if (item.scenario.startsWith('temporal-sqlite') && !(item.temporalActiveWrites > 0)) {
			failures.push(`${item.scenario}: temporalActiveWrites was not > 0 before Quit`);
		}
		if (item.scenario === 'magnus-stream-active' && !(item.magnusStreamActive > 0 || item.magnusPacingActive > 0)) {
			failures.push(`${item.scenario}: Magnus stream was not active before Quit`);
		}
		if (item.scenario === 'runtime-preview-active' && !item.runtimePreviewServerRunning) {
			failures.push(`${item.scenario}: Runtime Preview server was not running before Quit`);
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
	const release = await acquirePhase3AcceptanceLock();
	mkdirSync(evidenceDir, { recursive: true });
	const results = [];
	try {
		results.push(await runParserQuit(1));
		results.push(await runParserQuit(2));
		results.push(await runParserQuit(3));
		const temporalWorkspace = createTemporalQuitWorkspace();
		results.push(await runTemporalQuit(1, temporalWorkspace));
		results.push(await runTemporalQuit(2, temporalWorkspace));
		results.push(await runTemporalQuit(3, temporalWorkspace));
		results.push(await runRuntimePreviewQuit());
		results.push(await runElectronTestLabQuit());
		results.push(await runTauriTestLabQuit());
		results.push(await runMagnusStreamQuit());
	} finally {
		release();
	}
	const failures = loadQuitFailures(results);
	const result = { ...phase3EvidenceMetadata(repo, 'load-quit'), ok: failures.length === 0, failures, results };
	writeFileSync(join(evidenceDir, 'load-quit-matrix.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures, scenarios: results.map(item => ({ scenario: item.scenario, quitMs: item.quit?.latencyMs, remaining: item.quit?.remaining, skipped: item.skipped })) }, null, 2));
	if (!result.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * PreBase product-path acceptance.
 * Playwright/CDP drives PreBase. PreBase must drive the Electron/Tauri app.
 * Direct Playwright connection to the fixture is a failure.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	dismissStartup,
	launchPreBase,
	portOwners,
	processState,
	quitPreBase,
	waitFor,
	waitForWorkbenchDriver,
	workbenchCommand,
} from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceRoot = join(repo, 'reports/graph-acceptance/phase-3-final');

function locatorName() {
	return { by: 'role', role: 'textbox', name: 'Name' };
}

function locatorGreet() {
	return { by: 'role', role: 'button', name: 'Greet' };
}

function locatorStatus() {
	return { by: 'css', value: '#status' };
}

export function productPathAcceptanceFailures(evidence) {
	const failures = [];
	if (evidence.bypassedPreBase) {
		failures.push('Acceptance connected Playwright directly to the fixture');
	}
	if (!evidence.detected) {
		failures.push('PreBase did not detect the desktop project');
	}
	if (!evidence.started) {
		failures.push('Desktop session did not start');
	}
	if (evidence.state !== 'testing') {
		failures.push(`Session state is ${evidence.state ?? 'missing'}, expected testing`);
	}
	if (evidence.backend !== (evidence.framework === 'tauri' ? 'webdriver' : 'cdp')) {
		failures.push(`Unexpected automation backend: ${evidence.backend}`);
	}
	if (!evidence.inspected) {
		failures.push('Inspect did not return a semantic snapshot');
	}
	if (!evidence.filled) {
		failures.push('Fill Name did not succeed');
	}
	if (!evidence.clicked) {
		failures.push('Click Greet did not succeed');
	}
	if (!evidence.asserted) {
		failures.push('Assert did not prove the backend greeting');
	}
	if (!evidence.screenshotOk) {
		failures.push('Screenshot did not return a PNG');
	}
	if (!evidence.outputOk) {
		failures.push('Process output was not collected');
	}
	if (!evidence.restarted) {
		failures.push('Restart did not return a testing session');
	}
	if (evidence.restarted && evidence.assertedAfterRestart !== true) {
		failures.push('Assert after restart did not prove the backend greeting');
	}
	if (!evidence.stopped) {
		failures.push('Stop did not complete');
	}
	if (evidence.childAfterStop && evidence.childAfterStop !== 'gone') {
		failures.push('Owned child remained after stop');
	}
	if (evidence.portAfterStop?.length) {
		failures.push('Debug/WebDriver port remained after stop');
	}
	if (evidence.quit?.remaining && evidence.quit.remaining !== 'gone') {
		failures.push('PreBase did not quit');
	}
	return failures;
}

async function confirmIfNeeded(page, name) {
	const button = page.getByRole('button', { name }).or(page.locator('.monaco-button').filter({ hasText: new RegExp(`^${name}$`) }));
	if (await button.first().waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
		await button.last().click();
	}
}

export async function runFramework(framework) {
	const fixture = join(repo, `test/prebase/fixtures/desktop-${framework}`);
	const evidenceDir = join(evidenceRoot, framework);
	const screenshotDir = join(evidenceRoot, 'screenshots');
	mkdirSync(evidenceDir, { recursive: true });
	mkdirSync(screenshotDir, { recursive: true });
	const expectedGreeting = framework === 'tauri' ? 'Hello, Ada' : 'Hello, Ada from main';
	const evidence = {
		framework,
		productPath: true,
		bypassedPreBase: false,
		expectedGreeting,
	};
	let launched;
	try {
		launched = await launchPreBase(repo, fixture);
		evidence.prebasePid = launched.info.pid;
		evidence.cdpPort = launched.info.cdpPort;
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);

		await workbenchCommand(launched.page, 'prebase.runtime.detectConfigurations');
		const start = await workbenchCommand(launched.page, 'prebase.runtime.desktopStartForMagnus', {
			framework,
			mode: 'fullApp',
			testing: true,
		});
		await confirmIfNeeded(launched.page, 'Start');
		evidence.start = { ok: start?.ok === true, state: start?.state, backend: start?.backend, purpose: start?.purpose, sessionId: start?.sessionId, reason: start?.reason, errorMessage: start?.errorMessage };
		evidence.detected = start?.ok === true || Boolean(start?.framework);
		const session = await waitFor(async () => {
			const current = await workbenchCommand(launched.page, 'prebase.runtime.desktopGetSessionForMagnus');
			if (current?.ok && (current.state === 'testing' || current.state === 'error' || current.state === 'setupRequired')) {
				return current;
			}
			return undefined;
		}, framework === 'tauri' ? 180_000 : 90_000, 500);
		evidence.started = session?.state === 'testing';
		evidence.state = session?.state;
		evidence.backend = session?.backend;
		evidence.purpose = session?.purpose;
		evidence.sessionId = session?.sessionId;
		evidence.childPid = session?.pid;
		evidence.ownedPort = session?.webDriverPort ?? session?.debugPort;
		if (session?.state === 'error' && session.sessionId) {
			const output = await workbenchCommand(launched.page, 'prebase.runtime.desktopGetProcessOutputForMagnus', session.sessionId);
			evidence.startOutput = (output?.entries ?? []).map(entry => entry.text).join('\n').slice(-4_000);
		}

		if (session?.state === 'testing') {
			const inspected = await workbenchCommand(launched.page, 'prebase.runtime.desktopInspectForMagnus', session.sessionId);
			evidence.inspected = inspected?.ok === true && Array.isArray(inspected.interactive);
			evidence.inspectTitle = inspected?.title;

			const filled = await workbenchCommand(launched.page, 'prebase.runtime.desktopInteractForMagnus', {
				sessionId: session.sessionId,
				action: 'fill',
				locator: locatorName(),
				value: 'Ada',
			});
			evidence.filled = filled?.ok === true;

			const typed = await workbenchCommand(launched.page, 'prebase.runtime.desktopInteractForMagnus', {
				sessionId: session.sessionId,
				action: 'press',
				locator: locatorName(),
				value: process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
			});
			evidence.selectedAll = typed?.ok === true;
			const replaced = await workbenchCommand(launched.page, 'prebase.runtime.desktopInteractForMagnus', {
				sessionId: session.sessionId,
				action: 'type',
				locator: locatorName(),
				value: 'Ada',
			});
			evidence.typed = replaced?.ok === true;

			const clicked = await workbenchCommand(launched.page, 'prebase.runtime.desktopInteractForMagnus', {
				sessionId: session.sessionId,
				action: 'click',
				locator: locatorGreet(),
			});
			evidence.clicked = clicked?.ok === true;

			const asserted = await workbenchCommand(launched.page, 'prebase.runtime.desktopAssertForMagnus', {
				sessionId: session.sessionId,
				condition: 'text',
				locator: locatorStatus(),
				expected: expectedGreeting,
				timeoutMs: 10_000,
			});
			evidence.asserted = asserted?.ok === true;
			evidence.assertActual = asserted?.actual ?? asserted?.reason;

			const shot = await workbenchCommand(launched.page, 'prebase.runtime.desktopCaptureScreenshotForMagnus', session.sessionId);
			evidence.screenshotOk = shot?.ok === true && typeof shot.pngBase64 === 'string' && shot.pngBase64.length > 32;
			if (evidence.screenshotOk) {
				writeFileSync(join(screenshotDir, `${framework}-product-path.png`), Buffer.from(shot.pngBase64, 'base64'));
			}

			const output = await workbenchCommand(launched.page, 'prebase.runtime.desktopGetProcessOutputForMagnus', session.sessionId);
			evidence.outputOk = output?.ok === true;
			evidence.outputTruncated = Boolean(output?.truncated);

			const restarted = await workbenchCommand(launched.page, 'prebase.runtime.desktopRestartForMagnus', session.sessionId);
			await confirmIfNeeded(launched.page, 'Start');
			const afterRestart = await waitFor(async () => {
				const current = await workbenchCommand(launched.page, 'prebase.runtime.desktopGetSessionForMagnus');
				return current?.ok && current.state === 'testing' ? current : undefined;
			}, framework === 'tauri' ? 180_000 : 90_000, 500);
			evidence.restarted = afterRestart?.state === 'testing';
			evidence.restartSessionId = afterRestart?.sessionId;
			evidence.childPidAfterRestart = afterRestart?.pid;

			if (afterRestart?.state === 'testing') {
				await waitFor(async () => {
					const inspected = await workbenchCommand(launched.page, 'prebase.runtime.desktopInspectForMagnus', afterRestart.sessionId);
					return inspected?.ok === true ? inspected : undefined;
				}, 30_000, 250);
				await workbenchCommand(launched.page, 'prebase.runtime.desktopInteractForMagnus', {
					sessionId: afterRestart.sessionId,
					action: 'fill',
					locator: locatorName(),
					value: 'Ada',
				});
				await workbenchCommand(launched.page, 'prebase.runtime.desktopInteractForMagnus', {
					sessionId: afterRestart.sessionId,
					action: 'click',
					locator: locatorGreet(),
				});
				const assertedAgain = await workbenchCommand(launched.page, 'prebase.runtime.desktopAssertForMagnus', {
					sessionId: afterRestart.sessionId,
					condition: 'text',
					locator: locatorStatus(),
					expected: expectedGreeting,
					timeoutMs: 15_000,
				});
				evidence.assertedAfterRestart = assertedAgain?.ok === true;
				evidence.assertAfterRestartActual = assertedAgain?.actual ?? assertedAgain?.reason;
			}

			const stopPromise = workbenchCommand(launched.page, 'prebase.runtime.desktopStopForMagnus', afterRestart?.sessionId ?? session.sessionId);
			await confirmIfNeeded(launched.page, 'Stop');
			const stop = await stopPromise;
			evidence.stopped = stop?.ok === true;
			await waitFor(async () => {
				const current = await workbenchCommand(launched.page, 'prebase.runtime.desktopGetSessionForMagnus');
				return !current?.ok || current.state === 'stopped' || current.state === 'idle';
			}, 20_000, 200);
			if (evidence.childPid) {
				evidence.childAfterStop = processState(evidence.childPid);
			}
			if (evidence.ownedPort) {
				evidence.portAfterStop = portOwners(evidence.ownedPort);
			}
		}
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		if (launched?.info?.pid) {
			evidence.quit = await quitPreBase(launched.info.pid);
		}
	}
	const failures = productPathAcceptanceFailures(evidence);
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(evidenceDir, 'product-path.json'), JSON.stringify(result, null, 2));
	return result;
}

async function run() {
	mkdirSync(evidenceRoot, { recursive: true });
	const frameworks = process.argv.includes('--tauri-only')
		? ['tauri']
		: process.argv.includes('--electron-only')
			? ['electron']
			: ['electron', 'tauri'];
	const results = [];
	for (const framework of frameworks) {
		results.push(await runFramework(framework));
	}
	const combined = {
		ok: results.every(result => result.ok),
		results: results.map(result => ({ framework: result.framework, ok: result.ok, failures: result.failures, state: result.state })),
	};
	console.log(JSON.stringify(combined, null, 2));
	if (!combined.ok) {
		process.exitCode = 1;
	}
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	if (process.argv[2] === '--evaluate') {
		const { readFileSync } = await import('node:fs');
		const evidence = JSON.parse(readFileSync(0, 'utf8'));
		const failures = productPathAcceptanceFailures(evidence);
		console.log(JSON.stringify({ ok: failures.length === 0, failures }));
		if (failures.length) {
			process.exitCode = 1;
		}
	} else {
		await run();
	}
}

#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	dismissStartup,
	launchPreBase,
	processState,
	quitPreBase,
	waitFor,
	waitForWorkbenchDriver,
	workbenchCommand,
} from './workbenchHarness.mjs';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/electron');

async function confirmIfNeeded(page, name) {
	const button = page.getByRole('button', { name }).or(page.locator('.monaco-button').filter({ hasText: new RegExp(`^${name}$`) }));
	if (await button.first().waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
		await button.last().click();
	}
}

async function interact(page, sessionId, action, locator, value) {
	return workbenchCommand(page, 'prebase.runtime.desktopInteractForMagnus', {
		sessionId,
		action,
		locator,
		value,
		timeoutMs: 8_000,
	});
}

async function run() {
	mkdirSync(evidenceDir, { recursive: true });
	const fixture = join(repo, 'test/prebase/fixtures/desktop-electron');
	const launched = await launchPreBase(repo, fixture);
	const evidence = { ...phase3EvidenceMetadata(repo, 'electron-native-cases'), productPath: true, bypassedPreBase: false, cases: {} };
	try {
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		await workbenchCommand(launched.page, 'prebase.runtime.detectConfigurations');
		const start = await workbenchCommand(launched.page, 'prebase.runtime.desktopStartForMagnus', {
			framework: 'electron',
			mode: 'fullApp',
			testing: true,
		});
		await confirmIfNeeded(launched.page, 'Start');
		const session = await waitFor(async () => {
			const current = await workbenchCommand(launched.page, 'prebase.runtime.desktopGetSessionForMagnus');
			return current?.ok && current.state === 'testing' ? current : undefined;
		}, 90_000, 500);
		evidence.state = session?.state;
		evidence.backend = session?.backend;
		if (session?.state !== 'testing') {
			throw new Error(`Session did not reach testing: ${JSON.stringify(start)}`);
		}
		const id = session.sessionId;
		const click = (name) => interact(launched.page, id, 'click', { by: 'role', role: 'button', name });
		evidence.cases.visible = await click('Visible');
		evidence.cases.covered = await click('Covered');
		evidence.cases.disabled = await click('Disabled');
		evidence.cases.ambiguous = await interact(launched.page, id, 'click', { by: 'text', value: 'Ambiguous' });
		evidence.cases.offscreen = await click('Offscreen');
		evidence.cases.moving = await click('Moving');
		evidence.cases.check = await interact(launched.page, id, 'check', { by: 'role', role: 'checkbox', name: 'Agree' });
		evidence.cases.uncheck = await interact(launched.page, id, 'uncheck', { by: 'role', role: 'checkbox', name: 'Agree' });
		evidence.cases.readonlyFill = await interact(launched.page, id, 'fill', { by: 'role', role: 'textbox', name: 'Readonly' }, 'nope');
		evidence.cases.plainFill = await interact(launched.page, id, 'fill', { by: 'role', role: 'textbox', name: 'Plain' }, 'Ada');
		evidence.cases.notesFill = await interact(launched.page, id, 'fill', { by: 'role', role: 'textbox', name: 'Notes' }, 'hello');
		evidence.cases.tab = await interact(launched.page, id, 'press', { by: 'role', role: 'textbox', name: 'Tab A' }, 'Tab');
		evidence.cases.shiftTab = await interact(launched.page, id, 'press', { by: 'role', role: 'textbox', name: 'Tab B' }, 'Shift+Tab');
		evidence.cases.escape = await interact(launched.page, id, 'press', { by: 'role', role: 'textbox', name: 'Tab A' }, 'Escape');
		evidence.cases.enter = await interact(launched.page, id, 'press', { by: 'role', role: 'textbox', name: 'Name' }, 'Enter');
		evidence.cases.doubleClick = await interact(launched.page, id, 'doubleClick', { by: 'role', role: 'button', name: 'Visible' });
		const stopPromise = workbenchCommand(launched.page, 'prebase.runtime.desktopStopForMagnus', id);
		await confirmIfNeeded(launched.page, 'Stop');
		evidence.stopped = (await stopPromise)?.ok === true;
		evidence.childAfterStop = session.pid ? processState(session.pid) : 'gone';
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		evidence.quit = await quitPreBase(launched.info.pid);
	}
	const failures = [];
	if (evidence.state !== 'testing') failures.push('session was not testing');
	if (evidence.backend !== 'cdp') failures.push('native cases did not use CDP');
	if (evidence.cases.visible?.ok !== true) failures.push('visible click failed');
	if (evidence.cases.covered?.ok !== false) failures.push('covered click did not fail');
	if (evidence.cases.disabled?.ok !== false) failures.push('disabled click did not fail');
	if (evidence.cases.ambiguous?.ok !== false) failures.push('ambiguous click did not fail');
	if (evidence.cases.offscreen?.ok !== true) failures.push('offscreen click did not scroll into view');
	if (evidence.cases.check?.ok !== true) failures.push('check did not verify checked state');
	if (evidence.cases.uncheck?.ok !== true) failures.push('uncheck did not verify unchecked state');
	if (evidence.cases.readonlyFill?.ok !== false) failures.push('readonly fill did not fail');
	if (evidence.cases.plainFill?.ok !== true) failures.push('plain fill failed');
	if (evidence.cases.notesFill?.ok !== true) failures.push('textarea fill failed');
	if (evidence.cases.tab?.ok !== true) failures.push('Tab press failed');
	if (evidence.cases.enter?.ok !== true) failures.push('Enter press failed');
	if (evidence.stopped !== true) failures.push('stop failed');
	if (evidence.childAfterStop && evidence.childAfterStop !== 'gone') failures.push('child remained');
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit');
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(evidenceDir, 'native-cases.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures, moving: evidence.cases.moving, doubleClick: evidence.cases.doubleClick }, null, 2));
	if (!result.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

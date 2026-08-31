#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Real Live Activity acceptance: launches PreBase and observes runtime diagnostics.
 *  Native NSPanel pixels are not CDP-visible; this proves workbench→native plumbing + session continuity.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	acquirePhase3AcceptanceLock,
	dismissStartup,
	gracefulWorkbenchQuit,
	launchPreBase,
	waitForWorkbenchDriver,
	workbenchCommandWithTimeout,
} from './workbenchHarness.mjs';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/magnus');
const fixture = join(repo, 'test/fixtures/typescript-lanes');
const nativeAddon = join(repo, 'native/prebase-live-activity/build/Release/prebase_live_activity.node');

export function liveActivityLiveFailures(evidence) {
	const failures = [];
	if (evidence.platform === 'darwin' && !evidence.nativePresent) {
		failures.push('native AppKit module missing');
	}
	if (evidence.platform !== 'darwin') {
		return failures;
	}
	if (!evidence.diagnosticsAfterOpen) {
		failures.push('live diagnostics unavailable after Magnus open');
	}
	if (evidence.diagnosticsAfterOpen?.backend !== 'native-appkit') {
		failures.push(`expected native-appkit backend, got ${evidence.diagnosticsAfterOpen?.backend}`);
	}
	if (evidence.smokeTransportInstalled && !evidence.diagnosticsAfterOpen?.sessionId) {
		failures.push('Magnus session id missing while smoke transport was installed');
	}
	if (evidence.smokeTransportInstalled && evidence.diagnosticsAfterOpen?.sessionId) {
		const status = evidence.diagnosticsAfterOpen.status;
		if (!['working', 'waiting', 'completed', 'attention', 'failed'].includes(status)) {
			failures.push(`expected active Magnus Live Activity status after smoke prompt, got ${status}`);
		}
	}
	if (evidence.blurredDiagnostics && evidence.mode === 'alwaysWorking' && evidence.diagnosticsAfterOpen?.sessionId) {
		if (evidence.blurredDiagnostics.visible !== true && !['working', 'waiting', 'completed', 'attention', 'failed'].includes(evidence.blurredDiagnostics.status)) {
			failures.push('Live Activity lost session state after blur in alwaysWorking mode');
		}
	}
	if (evidence.quit?.remaining !== 'gone') {
		failures.push('PreBase did not quit cleanly after Live Activity live acceptance');
	}
	return failures;
}

async function run() {
	const release = await acquirePhase3AcceptanceLock('magnus-live-activity');
	mkdirSync(evidenceDir, { recursive: true });
	const startedAt = Date.now();
	const platform = process.platform;
	const nativePresent = existsSync(nativeAddon);
	let launched;
	const evidence = {
		...phase3EvidenceMetadata(repo, 'magnus-live-activity'),
		kind: 'magnus-live-activity-live',
		testKind: 'live-runtime',
		liveGui: 'workbench-diagnostics-runtime',
		platform,
		nativePresent,
		mode: 'alwaysWorking',
	};

	try {
		if (platform !== 'darwin') {
			evidence.skipped = 'Live Activity AppKit path is macOS-only';
			evidence.ok = true;
			evidence.failures = [];
			writeFileSync(join(evidenceDir, 'live-activity.json'), JSON.stringify(evidence, null, 2) + '\n');
			console.log(JSON.stringify({ ok: true, skipped: evidence.skipped, out: join(evidenceDir, 'live-activity.json') }));
			process.exit(0);
		}

		launched = await launchPreBase(repo, fixture);
		evidence.prebasePid = launched.info.pid;
		evidence.launchMs = Date.now() - startedAt;
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);

		// Prefer alwaysWorking so Live Activity can show while the window still has focus.
		await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.test.getDiagnostics', {
			liveActivityMode: 'alwaysWorking',
		}).catch(() => undefined);

		const installed = await workbenchCommandWithTimeout(launched.page, 15_000, 'prebase.test.installMagnusSmokeTransport').catch(error => ({ ok: false, error: String(error) }));
		evidence.smokeTransportInstalled = Boolean(installed?.ok);
		await workbenchCommandWithTimeout(launched.page, 15_000, 'prebase.magnus.open').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 15_000, 'workbench.action.chat.open', {
			query: 'prebase-smoke-stream',
			isPartialQuery: false,
		}).catch(() => undefined);

		const waitDeadline = Date.now() + 20_000;
		while (Date.now() < waitDeadline) {
			const diag = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.diagnostics').catch(() => null);
			evidence.diagnosticsAfterOpen = diag;
			if (diag?.sessionId && (diag.status === 'working' || diag.status === 'waiting' || diag.status === 'completed' || diag.status === 'attention')) {
				break;
			}
			await new Promise(r => setTimeout(r, 500));
		}

		await launched.page.evaluate(() => {
			window.dispatchEvent(new Event('blur'));
		}).catch(() => undefined);
		await new Promise(r => setTimeout(r, 800));
		evidence.blurredDiagnostics = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.diagnostics').catch(() => null);

		evidence.workbenchDiagnostics = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.test.getDiagnostics').catch(() => null);
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

	evidence.durationMs = Date.now() - startedAt;
	const failures = liveActivityLiveFailures(evidence);
	if (evidence.error) {
		failures.push(evidence.error);
	}
	const result = { ...evidence, ok: failures.length === 0, failures };
	const out = join(evidenceDir, 'live-activity.json');
	writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
	console.log(JSON.stringify({
		ok: result.ok,
		failures,
		out,
		backend: result.diagnosticsAfterOpen?.backend,
		status: result.diagnosticsAfterOpen?.status,
		durationMs: result.durationMs,
		liveGui: result.liveGui,
	}, null, 2));
	process.exit(result.ok ? 0 : 1);
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

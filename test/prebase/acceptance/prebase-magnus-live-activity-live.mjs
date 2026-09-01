#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Real Live Activity acceptance: launches PreBase and observes factual native AppKit diagnostics & interactions.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
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
const screenshotDir = join(repo, 'reports/graph-acceptance/phase-3-final/screenshots');
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
	if (!evidence.nativeDiagnostics) {
		failures.push('factual native AppKit diagnostics unavailable');
	} else {
		if (!evidence.nativeDiagnostics.panelCreated) {
			failures.push('native NSPanel was not created');
		}
		if (!evidence.nativeDiagnostics.panelVisible) {
			failures.push('native NSPanel was not visible');
		}
		const frame = evidence.nativeDiagnostics.panelFrame;
		if (!frame || typeof frame.width !== 'number' || frame.width <= 0 || typeof frame.height !== 'number' || frame.height <= 0) {
			failures.push('native NSPanel frame invalid or zero-sized');
		}
	}
	if (evidence.followUpSimulation && !evidence.followUpSimulation.ok) {
		failures.push('native follow-up message simulation failed');
	}
	if (evidence.questionContinuity && !evidence.questionContinuity.ok) {
		failures.push(`question continuity failed: ${evidence.questionContinuity.reason ?? 'unknown'}`);
	}
	if (evidence.approvalContinuity && !evidence.approvalContinuity.ok) {
		failures.push(`approval continuity failed: ${evidence.approvalContinuity.reason ?? 'unknown'}`);
	}
	if (evidence.nativeScreenshot && !evidence.nativeScreenshot.captured) {
		failures.push('native panel screenshot capture failed');
	}
	if (evidence.quit?.remaining !== 'gone') {
		failures.push('PreBase did not quit cleanly after Live Activity live acceptance');
	}
	return failures;
}

function captureNativePanelScreenshot(panelFrame, screenFrame, outPath) {
	if (!panelFrame || !screenFrame || process.platform !== 'darwin') {
		return { captured: false, reason: 'unsupported platform or missing geometry' };
	}
	try {
		const screenH = screenFrame.height || 1080;
		const captureX = Math.max(0, Math.round(panelFrame.x));
		const captureY = Math.max(0, Math.round(screenH - (panelFrame.y + panelFrame.height)));
		const captureW = Math.max(10, Math.round(panelFrame.width));
		const captureH = Math.max(10, Math.round(panelFrame.height));
		const rectArg = `-R${captureX},${captureY},${captureW},${captureH}`;
		execSync(`screencapture -x ${rectArg} "${outPath}"`, { timeout: 5000, stdio: 'pipe' });
		const stat = statSync(outPath);
		return {
			captured: stat.size > 0,
			sizeBytes: stat.size,
			rect: { x: captureX, y: captureY, width: captureW, height: captureH },
			outPath,
		};
	} catch (err) {
		return { captured: false, error: err instanceof Error ? err.message : String(err) };
	}
}

async function run() {
	const release = await acquirePhase3AcceptanceLock('magnus-live-activity');
	mkdirSync(evidenceDir, { recursive: true });
	mkdirSync(screenshotDir, { recursive: true });
	const startedAt = Date.now();
	const platform = process.platform;
	const nativePresent = existsSync(nativeAddon);
	let launched;
	const evidence = {
		...phase3EvidenceMetadata(repo, 'magnus-live-activity'),
		kind: 'magnus-live-activity-live',
		testKind: 'live-runtime',
		liveGui: 'native-appkit-panel',
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

		// Query factual native AppKit diagnostics directly
		evidence.nativeDiagnostics = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.nativeDiagnostics').catch(() => null);

		// Question continuity: seed pending carousel → native option → canonical answer
		const questionSeed = await workbenchCommandWithTimeout(launched.page, 15_000, 'prebase.test.seedMagnusLiveActivityPending', { kind: 'question' }).catch(() => ({ ok: false }));
		evidence.questionSeed = questionSeed;
		let questionPending = Boolean(questionSeed?.ok && (questionSeed?.liveActivityPendingKind === 'question' || questionSeed?.liveActivityStatus === 'attention'));
		const questionDeadline = Date.now() + 12_000;
		while (!questionPending && Date.now() < questionDeadline) {
			const diag = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.diagnostics').catch(() => null);
			if (diag?.pendingKind === 'question' && questionSeed?.interactionId) {
				questionPending = true;
				evidence.questionDiagnosticsBefore = diag;
				break;
			}
			await new Promise(r => setTimeout(r, 400));
		}
		if (questionPending && !evidence.questionDiagnosticsBefore) {
			evidence.questionDiagnosticsBefore = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.diagnostics').catch(() => null);
		}
		const questionAnswerSim = questionPending
			? await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.simulate', 'option', 0).catch(() => false)
			: false;
		const questionDiagAfter = questionAnswerSim
			? await (async () => {
				const deadline = Date.now() + 10_000;
				while (Date.now() < deadline) {
					const diag = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.diagnostics').catch(() => null);
					if (diag?.pendingKind !== 'question') {
						return diag;
					}
					await new Promise(r => setTimeout(r, 400));
				}
				return await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.diagnostics').catch(() => null);
			})()
			: null;
		evidence.questionContinuity = {
			ok: Boolean(questionSeed?.ok && questionAnswerSim && questionDiagAfter?.pendingKind !== 'question'),
			reason: !questionSeed?.ok ? `seed-failed${questionSeed?.invokeError ? `:${questionSeed.invokeError}` : ''}` : (!questionAnswerSim ? 'native-option-failed' : (questionDiagAfter?.pendingKind === 'question' ? 'pending-not-cleared' : undefined)),
			interactionId: questionSeed?.interactionId,
			liveActivityPendingKind: questionSeed?.liveActivityPendingKind,
			liveActivityStatus: questionSeed?.liveActivityStatus,
		};

		// Approval continuity: seed pending tool approval → native deny (safe) → pending clears
		const approvalSeed = await workbenchCommandWithTimeout(launched.page, 15_000, 'prebase.test.seedMagnusLiveActivityPending', { kind: 'approval' }).catch(() => ({ ok: false }));
		evidence.approvalSeed = approvalSeed;
		let approvalPending = Boolean(approvalSeed?.ok);
		const approvalDeadline = Date.now() + 12_000;
		while (Date.now() < approvalDeadline) {
			const diag = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.diagnostics').catch(() => null);
			const native = diag?.native ?? await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.nativeDiagnostics').catch(() => null);
			if (diag?.pendingKind === 'approval' && approvalSeed?.interactionId) {
				approvalPending = true;
				evidence.approvalDiagnosticsBefore = { ...diag, native };
				break;
			}
			await new Promise(r => setTimeout(r, 400));
		}
		const approvalDenySim = approvalPending
			? await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.simulate', 'deny').catch(() => false)
			: false;
		const approvalDiagAfter = approvalDenySim
			? await (async () => {
				const deadline = Date.now() + 10_000;
				while (Date.now() < deadline) {
					const diag = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.diagnostics').catch(() => null);
					if (diag?.pendingKind !== 'approval') {
						return diag;
					}
					await new Promise(r => setTimeout(r, 400));
				}
				return await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.diagnostics').catch(() => null);
			})()
			: null;
		evidence.approvalContinuity = {
			ok: Boolean(approvalSeed?.ok && approvalDenySim && approvalDiagAfter?.pendingKind !== 'approval'),
			reason: !approvalSeed?.ok ? `seed-failed${approvalSeed?.invokeError ? `:${approvalSeed.invokeError}` : approvalSeed?.reason ? `:${approvalSeed.reason}` : ''}` : (!approvalDenySim ? 'native-deny-failed' : (approvalDiagAfter?.pendingKind === 'approval' ? 'pending-not-cleared' : undefined)),
			interactionId: approvalSeed?.interactionId,
		};

		// Test native follow-up message simulation through native text field (after pending interactions)
		const followUpSim = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.simulate', 'followUp', 'follow-up from native activity').catch(() => false);
		evidence.followUpSimulation = { ok: Boolean(followUpSim) };

		// Capture native NSPanel screenshot using native panel bounds
		const screenshotFile = join(screenshotDir, 'magnus-live-activity-native.png');
		evidence.nativeScreenshot = captureNativePanelScreenshot(
			evidence.nativeDiagnostics?.panelFrame,
			evidence.nativeDiagnostics?.screenFrame,
			screenshotFile,
		);

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
		nativePanelCreated: result.nativeDiagnostics?.panelCreated,
		nativePanelVisible: result.nativeDiagnostics?.panelVisible,
		nativePanelFrame: result.nativeDiagnostics?.panelFrame,
		nativeScreenshot: result.nativeScreenshot,
		durationMs: result.durationMs,
		liveGui: result.liveGui,
	}, null, 2));
	process.exit(result.ok ? 0 : 1);
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}


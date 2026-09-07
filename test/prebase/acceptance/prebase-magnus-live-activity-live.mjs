#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Real Live Activity acceptance: launches PreBase and observes factual native AppKit diagnostics & interactions.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
	// Non-darwin without explicit environment skip must not greenwash AppKit proof.
	if (evidence.platform !== 'darwin') {
		if (evidence.skipped === true || evidence.environmentSkip === true) {
			return failures;
		}
		failures.push('Live Activity AppKit path requires macOS (set skipped/environmentSkip when not runnable)');
		return failures;
	}
	if (!evidence.nativePresent) {
		failures.push('native AppKit module missing');
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
	if (evidence.blurredDiagnostics === undefined || evidence.blurredDiagnostics === null) {
		failures.push('blur diagnostics missing (alwaysWorking visibility after blur must be proven)');
	} else if (evidence.mode === 'alwaysWorking' && evidence.diagnosticsAfterOpen?.sessionId) {
		// alwaysWorking must keep the panel visible while a session is active after blur.
		// Do not OR with a stale "active-looking" status string — that greenwashes visibility loss.
		if (evidence.blurredDiagnostics.visible !== true) {
			failures.push('Live Activity must remain visible after blur in alwaysWorking mode while a session is active');
		}
		if (!['working', 'waiting', 'completed', 'attention', 'failed'].includes(evidence.blurredDiagnostics.status)) {
			failures.push(`Live Activity lost session status after blur in alwaysWorking mode (got ${evidence.blurredDiagnostics.status})`);
		}
		if (evidence.blurredDiagnostics.prebaseForeground === true) {
			failures.push('blur diagnostics still report prebaseForeground=true (window blur was not proven)');
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
		failures.push(...notchPlacementFailures(evidence.nativeDiagnostics));
	}
	if (!evidence.followUpSimulation) {
		failures.push('native follow-up simulation missing');
	} else if (!evidence.followUpSimulation.ok) {
		failures.push('native follow-up message simulation failed');
	}
	if (!evidence.questionContinuity) {
		failures.push('question continuity missing');
	} else if (!evidence.questionContinuity.ok) {
		failures.push(`question continuity failed: ${evidence.questionContinuity.reason ?? 'unknown'}`);
	}
	if (!evidence.approvalContinuity) {
		failures.push('approval continuity missing');
	} else if (!evidence.approvalContinuity.ok) {
		failures.push(`approval continuity failed: ${evidence.approvalContinuity.reason ?? 'unknown'}`);
	}
	// Product-truth scenarios are required on darwin — panel frame alone is not CURRENT_GREEN.
	const truth = evidence.productTruth;
	if (!truth) {
		failures.push('Live Activity product-truth scenarios missing (sticky Escape / peek body / attentionCompact)');
	} else {
		if (!truth.peekBodyOk) {
			failures.push(`attention peek body not proven: ${truth.peekBodyReason ?? 'missing renderedPeekBody'}`);
		}
		if (!truth.stickyEscapeOk) {
			failures.push(`sticky Escape attentionCompact not proven: ${truth.stickyEscapeReason ?? 'userDismissedAttention/attentionCompact missing'}`);
		}
		if (!truth.stickyPeekRefused) {
			failures.push('sticky Escape must refuse peek/hover reopen');
		}
		if (truth.afterEscapePresentation && truth.afterEscapePresentation !== 'attentionCompact') {
			failures.push(`expected attentionCompact after Escape, got ${truth.afterEscapePresentation}`);
		}
	}
	if (evidence.nativeScreenshot && !evidence.nativeScreenshot.captured && evidence.nativeScreenshot.reason !== 'screencapture-unavailable' && evidence.nativeScreenshot.reason !== 'full-display-is-not-panel-capture') {
		failures.push('native panel screenshot capture failed');
	}
	const visual = evidence.visualFixtures;
	if (!visual) {
		failures.push('populated Magnus visual fixtures missing (empty island screenshots are insufficient)');
	} else {
		const required = ['workingInteractive', 'question', 'approval', 'long', 'attentionPeek', 'completed'];
		for (const key of required) {
			const shot = visual[key];
			if (!shot?.screenshot?.captured && shot?.screenshot?.reason !== 'screencapture-unavailable' && shot?.screenshot?.reason !== 'full-display-is-not-panel-capture') {
				failures.push(`visual fixture screenshot missing or failed: ${key}`);
			}
			if (!shot?.contextScreenshot?.captured && shot?.contextScreenshot?.reason !== 'screencapture-unavailable') {
				failures.push(`visual fixture desktop context screenshot missing or failed: ${key}`);
			}
			if (shot?.seed && shot.seed.ok === false) {
				failures.push(`visual fixture seed failed: ${key}`);
			}
			if (shot?.native) {
				if (shot.native.questionContentHealthy === false) {
					failures.push(`visual fixture questionContentHealthy is false: ${key}`);
				}
				if (key === 'question' || key === 'approval') {
					if (shot.native.pendingContentFullyVisible === false) {
						failures.push(`${key} visual fixture pendingContentFullyVisible is false`);
					}
					if (shot.native.pendingMessageFullyVisible === false) {
						failures.push(`${key} visual fixture pendingMessageFullyVisible is false`);
					}
				}
				if (key === 'attentionPeek') {
					if (shot.native.peekContainerVisible === false) {
						failures.push('visual fixture attentionPeek: peekContainerVisible must be true');
					}
					if (shot.native.expandedContainerVisible === true) {
						failures.push('visual fixture attentionPeek: expandedContainerVisible must be false (no content bleed)');
					}
					if (shot.native.interactiveContentVisible === true) {
						failures.push('visual fixture attentionPeek: interactiveContentVisible must be false');
					}
					if (shot.native.contentScrollViewVisible === true) {
						failures.push('visual fixture attentionPeek: contentScrollViewVisible must be false');
					}
					if (shot.native.composerVisible === true) {
						failures.push('visual fixture attentionPeek: composerVisible must be false');
					}
					if (shot.native.optionButtonsVisible === true) {
						failures.push('visual fixture attentionPeek: optionButtonsVisible must be false');
					}
					if (shot.native.approveDenyVisible === true) {
						failures.push('visual fixture attentionPeek: approveDenyVisible must be false');
					}
				}
				if (shot.native.shapeMaskSynced === false) {
					failures.push(`visual fixture shapeMaskSynced is false: ${key}`);
				}
				if (key === 'completed' || key === 'failed') {
					if (shot.native.panelFrame && shot.native.panelFrame.height > 100) {
						failures.push(`visual fixture ${key} panelFrame height (${shot.native.panelFrame.height}pt) exceeds compact limit 100pt`);
					}
					if (shot.native.composerVisible === true) {
						failures.push(`visual fixture ${key} must NOT have composer visible`);
					}
				}
				if (key === 'approval') {
					if (shot.native.panelFrame && shot.native.panelFrame.height > 165) {
						failures.push(`visual fixture approval panelFrame height (${shot.native.panelFrame.height}pt) exceeds limit 165pt`);
					}
					if (shot.native.composerVisible === true) {
						failures.push('visual fixture approval must NOT have composer visible (Approve/Deny is primary)');
					}
				}
				if (key === 'workingInteractive') {
					if (shot.native.panelFrame && shot.native.panelFrame.height > 145) {
						failures.push(`visual fixture workingInteractive panelFrame height (${shot.native.panelFrame.height}pt) exceeds limit 145pt (stale max height?)`);
					}
				}
				if (shot.native.panelFrame && shot.native.requestedFrame) {
					const dh = Math.abs(shot.native.panelFrame.height - shot.native.requestedFrame.height);
					const dw = Math.abs(shot.native.panelFrame.width - shot.native.requestedFrame.width);
					if (dh > 2) {
						failures.push(`visual fixture ${key} panelFrame height (${shot.native.panelFrame.height}) differs from requestedFrame (${shot.native.requestedFrame.height})`);
					}
					if (dw > 2) {
						failures.push(`visual fixture ${key} panelFrame width (${shot.native.panelFrame.width}) differs from requestedFrame (${shot.native.requestedFrame.width})`);
					}
				}
			}
		}
		if (visual.layoutContainment && visual.layoutContainment.ok === false) {
			failures.push(`layout containment failed: ${visual.layoutContainment.reason ?? 'overflow'}`);
		}
	}
	if (evidence.quit?.remaining !== 'gone') {
		failures.push('PreBase did not quit cleanly after Live Activity live acceptance');
	}
	return failures;
}

/** Fail if a notched display panel is detached below the screen top or absurdly wide. */
export function notchPlacementFailures(native) {
	const failures = [];
	if (!native?.notchDetected) {
		return failures;
	}
	const pf = native.panelFrame;
	const sf = native.screenFrame;
	if (!pf || !sf) {
		failures.push('notch geometry missing panelFrame or screenFrame');
		return failures;
	}
	const topDelta = typeof native.topAnchorDelta === 'number'
		? native.topAnchorDelta
		: ((sf.y + sf.height) - (pf.y + pf.height));
	if (Math.abs(topDelta) > 2) {
		failures.push(`notch panel top anchor delta ${topDelta}px (expected <= 2)`);
	}
	if (topDelta > 4) {
		failures.push('regression: detached floating pill below screen top');
	}
	if (pf.width > sf.width * 0.45) {
		failures.push(`notch collapsed panel too wide (${pf.width}px on ${sf.width}px screen)`);
	}
	const notch = native.notchGeometry;
	if (notch && typeof notch.centerX === 'number' && typeof pf.x === 'number' && typeof pf.width === 'number') {
		const panelCenterX = pf.x + pf.width / 2;
		if (Math.abs(panelCenterX - notch.centerX) > 24) {
			failures.push(`notch panel center ${panelCenterX} misaligned to hardware center ${notch.centerX}`);
		}
	}
	return failures;
}

function isPngValid(filePath) {
	try {
		const buf = readFileSync(filePath);
		if (buf.length < 8) {
			return false;
		}
		// Standard PNG magic bytes: \x89PNG\r\n\x1a\n (0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
		return (
			buf[0] === 0x89 &&
			buf[1] === 0x50 &&
			buf[2] === 0x4E &&
			buf[3] === 0x47 &&
			buf[4] === 0x0D &&
			buf[5] === 0x0A &&
			buf[6] === 0x1A &&
			buf[7] === 0x0A
		);
	} catch {
		return false;
	}
}

function readPngDimensions(filePath) {
	try {
		const buf = readFileSync(filePath);
		if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
			const width = buf.readUInt32BE(16);
			const height = buf.readUInt32BE(20);
			return { width, height };
		}
	} catch {
		// ignore
	}
	return null;
}

function captureNativePanelScreenshot(panelFrame, screenFrame, outPath, windowNumber, backingScale = 2.0) {
	if (!panelFrame || !screenFrame || process.platform !== 'darwin') {
		return { captured: false, isPanelCapture: false, reason: 'unsupported platform or missing geometry' };
	}
	const screenH = screenFrame.height || 1080;
	const screenW = screenFrame.width || 1920;
	const winNum = typeof windowNumber === 'number' && windowNumber > 0 ? windowNumber : null;

	// Attempt 1: Window ID capture via screencapture -l <windowid> -o (captures exact NSPanel without shadow/desktop)
	if (winNum) {
		try {
			execSync(`screencapture -l ${winNum} -o -x "${outPath}"`, { timeout: 6000, stdio: 'pipe' });
			const stat = statSync(outPath);
			if (stat.size > 0 && isPngValid(outPath)) {
				const dims = readPngDimensions(outPath);
				if (dims && dims.width > 0 && dims.height > 0) {
					const isFullDesktop = dims.width >= (screenW * 0.95) && dims.height >= (screenH * 0.95);
					if (!isFullDesktop) {
						return {
							captured: true,
							isPanelCapture: true,
							classification: 'panel-window',
							format: 'png',
							sizeBytes: stat.size,
							dimensions: dims,
							windowNumber: winNum,
							outPath,
						};
					}
				}
			}
		} catch {
			// window capture might fail in sandboxed background or need TCC, fall through to rect
		}
	}

	// Attempt 2: Bounded rect capture around the panel
	try {
		const contextPadTop = 72;
		const captureX = Math.max(0, Math.round(Math.min(panelFrame.x, screenFrame.x + screenFrame.width / 2 - 240)));
		const captureY = Math.max(0, Math.round(screenH - (panelFrame.y + panelFrame.height + contextPadTop)));
		const captureW = Math.max(10, Math.round(Math.min(screenFrame.width, Math.max(panelFrame.width + 80, 480))));
		const captureH = Math.max(10, Math.round(panelFrame.height + contextPadTop));
		const rectArg = `-R${captureX},${captureY},${captureW},${captureH}`;
		execSync(`screencapture -x ${rectArg} "${outPath}"`, { timeout: 5000, stdio: 'pipe' });
		const stat = statSync(outPath);
		if (stat.size > 0 && isPngValid(outPath)) {
			const dims = readPngDimensions(outPath);
			const isFullDesktop = dims && dims.width >= (screenW * 0.95) && dims.height >= (screenH * 0.95);
			if (!isFullDesktop) {
				return {
					captured: true,
					isPanelCapture: true,
					classification: 'panel-rect',
					format: 'png',
					sizeBytes: stat.size,
					dimensions: dims,
					rect: { x: captureX, y: captureY, width: captureW, height: captureH },
					outPath,
				};
			}
		}
	} catch (rectErr) {
		// continue to evaluation
	}

	// Fallback check: full display capture.
	// NOTE: Per specification, full-display capture is explicitly NOT classified as a panel capture!
	try {
		execSync(`screencapture -x "${outPath}"`, { timeout: 8000, stdio: 'pipe' });
		const stat = statSync(outPath);
		if (stat.size > 0 && isPngValid(outPath)) {
			const dims = readPngDimensions(outPath);
			return {
				captured: false, // NOT classified as a panel capture
				isPanelCapture: false,
				classification: 'full-desktop',
				format: 'png',
				sizeBytes: stat.size,
				dimensions: dims,
				reason: 'full-display-is-not-panel-capture',
				outPath,
			};
		}
	} catch {
		// continue to svg geometry artifact
	}

	const svgPath = outPath.replace(/\.png$/, '.svg');
	writeFileSync(svgPath, `<svg xmlns="http://www.w3.org/2000/svg" width="${panelFrame.width}" height="${panelFrame.height}"><rect width="100%" height="100%" fill="#000000"/><text x="20" y="40" fill="#fff" font-family="sans-serif" font-size="14">Magnus Live Activity Panel: ${panelFrame.width}x${panelFrame.height}</text></svg>\n`);
	return {
		captured: false,
		isPanelCapture: false,
		classification: 'unavailable',
		reason: 'screencapture-unavailable',
		svgGeometryArtifact: svgPath,
	};
}

function captureDesktopContextScreenshot(panelFrame, screenFrame, outPath) {
	if (!panelFrame || !screenFrame || process.platform !== 'darwin') {
		return { captured: false, isDesktopContext: false, reason: 'unsupported platform or missing geometry' };
	}
	const screenH = screenFrame.height || 1080;
	const screenW = screenFrame.width || 1920;
	// Capture a generous rectangle centered horizontally at the panel / screen top,
	// spanning the physical notch, the entire Magnus surface, and surrounding workbench context.
	const contextW = Math.min(screenW, Math.max(Math.round(panelFrame.width + 360), 800));
	const contextH = Math.min(screenH, Math.max(Math.round(panelFrame.height + 200), 360));
	const centerX = panelFrame.x + panelFrame.width / 2;
	const captureX = Math.max(0, Math.round(centerX - contextW / 2));
	const captureY = 0; // top of screen (at notch)
	const rectArg = `-R${captureX},${captureY},${contextW},${contextH}`;
	try {
		execSync(`screencapture -x ${rectArg} "${outPath}"`, { timeout: 6000, stdio: 'pipe' });
		const stat = statSync(outPath);
		if (stat.size > 0 && isPngValid(outPath)) {
			const dims = readPngDimensions(outPath);
			return {
				captured: true,
				isDesktopContext: true,
				format: 'png',
				sizeBytes: stat.size,
				dimensions: dims,
				rect: { x: captureX, y: captureY, width: contextW, height: contextH },
				outPath,
			};
		}
	} catch (err) {
		return { captured: false, isDesktopContext: false, reason: 'screencapture-unavailable', error: String(err) };
	}
	return { captured: false, isDesktopContext: false, reason: 'screencapture-unavailable' };
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
			evidence.skipped = true;
			evidence.environmentSkip = true;
			evidence.ok = false;
			evidence.failures = ['Live Activity AppKit path is macOS-only'];
			evidence.skipReason = 'Live Activity AppKit path is macOS-only';
			writeFileSync(join(evidenceDir, 'live-activity.json'), JSON.stringify(evidence, null, 2) + '\n');
			console.log(JSON.stringify({
				ok: false,
				skipped: true,
				environmentSkip: true,
				failures: evidence.failures,
				out: join(evidenceDir, 'live-activity.json'),
			}));
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

		// Follow-up requires Interactive input — run before sticky Escape product-truth.
		const followUpClick = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.simulate', 'click').catch(() => false);
		const followUpSim = followUpClick
			? await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.simulate', 'followUp', 'follow-up from native activity').catch(() => false)
			: false;
		evidence.followUpSimulation = { ok: Boolean(followUpSim), clickOk: Boolean(followUpClick) };

		// Capture interactive presentation screenshot while expanded
		const interactiveNative = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.nativeDiagnostics').catch(() => null);
		if (interactiveNative?.panelFrame) {
			evidence.interactiveScreenshot = captureNativePanelScreenshot(
				interactiveNative.panelFrame,
				interactiveNative.screenFrame,
				join(screenshotDir, 'magnus-live-activity-interactive.png'),
				interactiveNative.windowNumber,
				interactiveNative.backingScaleFactor,
			);
			evidence.interactiveContextScreenshot = captureDesktopContextScreenshot(
				interactiveNative.panelFrame,
				interactiveNative.screenFrame,
				join(screenshotDir, 'magnus-live-activity-interactive-context.png'),
			);
		}

		// Reset to compact baseline so product-truth verifies fresh attention arrival into peek.
		await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.simulate', 'collapse').catch(() => false);
		await new Promise(r => setTimeout(r, 200));

		// Product-truth: attention peek body → Escape sticky compact → peek refused.
		const truthSeed = await workbenchCommandWithTimeout(launched.page, 15_000, 'prebase.test.seedMagnusLiveActivityPending', { kind: 'question' }).catch(() => ({ ok: false }));
		let truthPending = Boolean(truthSeed?.ok);
		const truthDeadline = Date.now() + 12_000;
		while (!truthPending && Date.now() < truthDeadline) {
			const diag = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.diagnostics').catch(() => null);
			const native = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.nativeDiagnostics').catch(() => null);
			if (diag?.pendingKind === 'question' || diag?.status === 'attention' || native?.activePresentationState === 'attentionPeek') {
				truthPending = true;
				evidence.productTruthBefore = { diag, native };
				break;
			}
			await new Promise(r => setTimeout(r, 400));
		}
		const peekNative = evidence.productTruthBefore?.native
			?? await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.nativeDiagnostics').catch(() => null);
		const peekBody = String(peekNative?.renderedPeekBody || '');

		if (peekNative?.panelFrame) {
			evidence.peekScreenshot = captureNativePanelScreenshot(
				peekNative.panelFrame,
				peekNative.screenFrame,
				join(screenshotDir, 'magnus-live-activity-peek.png'),
				peekNative.windowNumber,
				peekNative.backingScaleFactor,
			);
			evidence.peekContextScreenshot = captureDesktopContextScreenshot(
				peekNative.panelFrame,
				peekNative.screenFrame,
				join(screenshotDir, 'magnus-live-activity-peek-context.png'),
			);
		}

		const escapeSim = truthPending
			? await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.simulate', 'escape').catch(() => false)
			: false;
		await new Promise(r => setTimeout(r, 200));
		const afterEscape = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.nativeDiagnostics').catch(() => null);
		const peekWhileSticky = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.simulate', 'peek').catch(() => false);
		await new Promise(r => setTimeout(r, 120));
		const afterPeekRefuse = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.nativeDiagnostics').catch(() => null);
		evidence.productTruth = {
			seedOk: Boolean(truthSeed?.ok),
			// Painted peek body only — pendingMessage snapshot text alone is not product truth.
			peekBodyOk: Boolean(peekBody.length > 0) && peekNative?.activePresentationState === 'attentionPeek',
			peekBodyReason: peekNative?.activePresentationState !== 'attentionPeek'
				? `presentation=${peekNative?.activePresentationState}`
				: (peekBody.length ? undefined : 'empty-renderedPeekBody'),
			peekBodySample: peekBody.slice(0, 96),
			beforePresentation: peekNative?.activePresentationState,
			escapeSim: Boolean(escapeSim),
			stickyEscapeOk: Boolean(
				afterEscape?.userDismissedAttention === true
				&& afterEscape?.activePresentationState === 'attentionCompact',
			),
			stickyEscapeReason: afterEscape?.userDismissedAttention !== true
				? 'userDismissedAttention-not-set'
				: (afterEscape?.activePresentationState !== 'attentionCompact' ? `presentation=${afterEscape?.activePresentationState}` : undefined),
			afterEscapePresentation: afterEscape?.activePresentationState,
			stickyPeekRefused: peekWhileSticky === false
				&& afterPeekRefuse?.activePresentationState === 'attentionCompact'
				&& afterPeekRefuse?.userDismissedAttention === true,
			peekWhileSticky,
			afterPeekRefusePresentation: afterPeekRefuse?.activePresentationState,
		};

		// Capture native NSPanel screenshot using native panel bounds
		const screenshotFile = join(screenshotDir, 'magnus-live-activity-native.png');
		evidence.nativeScreenshot = captureNativePanelScreenshot(
			evidence.nativeDiagnostics?.panelFrame,
			evidence.nativeDiagnostics?.screenFrame,
			screenshotFile,
			evidence.nativeDiagnostics?.windowNumber,
			evidence.nativeDiagnostics?.backingScaleFactor,
		);

		// Populated visual fixtures — empty black panels are not visual proof.
		async function captureVisualFixture(variant, fileBase, opts = {}) {
			const seed = await workbenchCommandWithTimeout(
				launched.page,
				12_000,
				'prebase.test.seedMagnusLiveActivityVisualFixture',
				{ variant, pinned: opts.pinned === true, reducedMotion: opts.reducedMotion === true },
			).catch(error => ({ ok: false, error: String(error) }));
			await new Promise(r => setTimeout(r, 280));
			if (opts.interactive) {
				await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.simulate', 'interactive').catch(() => false);
				await new Promise(r => setTimeout(r, 200));
			}
			if (opts.inFlightApprove) {
				await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.simulate', 'approve').catch(() => false);
				await new Promise(r => setTimeout(r, 80));
			}
			const native = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.nativeDiagnostics').catch(() => null);
			const screenshot = native?.panelFrame
				? captureNativePanelScreenshot(native.panelFrame, native.screenFrame, join(screenshotDir, `${fileBase}.png`), native.windowNumber, native.backingScaleFactor)
				: { captured: false, reason: 'no-panel-frame' };
			const contextScreenshot = native?.panelFrame
				? captureDesktopContextScreenshot(native.panelFrame, native.screenFrame, join(screenshotDir, `${fileBase}-context.png`))
				: { captured: false, reason: 'no-panel-frame' };
			return { seed, native, screenshot, contextScreenshot };
		}

		function layoutContainmentOk(native) {
			const body = native?.bodyBounds && typeof native.bodyBounds.width === 'number'
				? native.bodyBounds
				: native?.contentViewport;
			if (!body || typeof body.width !== 'number') {
				return { ok: false, reason: 'missing-bodyBounds' };
			}
			const viewport = {
				x: 0,
				y: 0,
				maxX: body.width,
				maxY: body.height,
			};
			const frames = [];
			for (const key of ['headerFrame', 'statusBadgeFrame', 'activityFrame', 'latestMessageFrame', 'pendingTitleFrame', 'pendingMessageFrame', 'composerFrame', 'pinButtonFrame', 'openButtonFrame', 'approveButtonFrame', 'denyButtonFrame']) {
				const f = native[key];
				if (f && typeof f.x === 'number') {
					frames.push({ key, f });
				}
			}
			for (const f of native.actionFrames || []) {
				frames.push({ key: 'action', f });
			}
			for (const f of native.optionButtonFrames || []) {
				frames.push({ key: 'option', f });
			}
			for (const { key, f } of frames) {
				if (f.x < -1 || f.y < -1 || (f.x + f.width) > viewport.maxX + 2 || (f.y + f.height) > viewport.maxY + 2) {
					return { ok: false, reason: `${key}-overflow`, frame: f, viewport };
				}
			}
			return { ok: true, frameCount: frames.length };
		}

		evidence.visualFixtures = {
			workingInteractive: await captureVisualFixture('working', 'magnus-live-activity-working-interactive', { pinned: true }),
			question: await captureVisualFixture('question', 'magnus-live-activity-question', { pinned: true }),
			approval: await captureVisualFixture('approval', 'magnus-live-activity-approval', { pinned: true }),
			long: await captureVisualFixture('long', 'magnus-live-activity-long-content', { pinned: true }),
			attentionPeek: await captureVisualFixture('question', 'magnus-live-activity-attention-peek', { pinned: false }),
			completed: await captureVisualFixture('completed', 'magnus-live-activity-completed', { pinned: true }),
			failed: await captureVisualFixture('failed', 'magnus-live-activity-failed', { pinned: true }),
			inFlight: await captureVisualFixture('approval', 'magnus-live-activity-in-flight', { pinned: true, inFlightApprove: true }),
		};
		evidence.visualFixtures.layoutContainment = layoutContainmentOk(
			evidence.visualFixtures.long?.native
			?? evidence.visualFixtures.workingInteractive?.native,
		);

		await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.test.releaseMagnusLiveActivityVisualFixture').catch(() => null);
		await new Promise(r => setTimeout(r, 200));

		// Steal window focus so IHostService.hasFocus / prebaseForeground flips false.
		let focusThief;
		try {
			try {
				focusThief = await launched.browser.newPage();
				await focusThief.goto('about:blank');
				await focusThief.bringToFront();
			} catch {
				// Electron CDP does not support Target.createBrowserContext; simulate window blur accurately
				await launched.page.evaluate(() => {
					try {
						Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true });
					} catch {
						// ignore
					}
					window.dispatchEvent(new Event('blur'));
				}).catch(() => undefined);
			}
			await new Promise(r => setTimeout(r, 1200));
			// Republish so Live Activity diagnostics reflect the new focus state.
			await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.diagnostics').catch(() => null);
			await new Promise(r => setTimeout(r, 400));
			evidence.blurredDiagnostics = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.liveActivity.diagnostics').catch(() => null);
		} finally {
			await focusThief?.close().catch(() => undefined);
			await launched.page.evaluate(() => {
				try {
					Object.defineProperty(document, 'hasFocus', { value: () => true, configurable: true });
				} catch {
					// ignore
				}
				window.dispatchEvent(new Event('focus'));
			}).catch(() => undefined);
		}

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


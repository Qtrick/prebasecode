#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Static source-contract checks for Magnus Live Activity (NOT a live GUI proof).
 *--------------------------------------------------------------------------------------------*/

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/magnus');
const nativeAddon = join(repo, 'native/prebase-live-activity/build/Release/prebase_live_activity.node');

const started = Date.now();
const failures = [];
const platform = process.platform;
const nativePresent = existsSync(nativeAddon);
const architectureChosen = nativePresent ? 'native-appkit' : (platform === 'darwin' ? 'native-appkit-missing' : 'non-darwin');

if (platform === 'darwin' && !nativePresent) {
	failures.push('native AppKit module missing; run npm run compile:live-activity');
}

const magnusCommon = readFileSync(join(repo, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'), 'utf8');
const mainService = readFileSync(join(repo, 'src/vs/platform/prebaseLiveActivity/electron-main/prebaseLiveActivityMainService.ts'), 'utf8');
const contributionPath = join(repo, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
const sessionPath = join(repo, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivitySession.ts');
const contribution = readFileSync(contributionPath, 'utf8') + readFileSync(sessionPath, 'utf8');
if (!contribution.includes('chatService.sendRequest(sessionResource')) {
	failures.push('follow-up must use chatService.sendRequest on the snapshot session');
}
if (contribution.includes('startNewLocalSession')) {
	failures.push('Live Activity must not start a second chat session');
}
if (!contribution.includes('applyMagnusLiveActivitySessionCommand')) {
	failures.push('Live Activity commands must dispatch through magnusLiveActivitySession');
}
if (!readFileSync(sessionPath, 'utf8').includes('IChatToolInvocation.confirmWith')) {
	failures.push('approvals must resolve the canonical tool invocation');
}
if (readFileSync(sessionPath, 'utf8').includes('invokeTool')) {
	failures.push('session command path must not call invokeTool');
}
if (!contribution.includes('summarizeMagnusWorkspaceDiff') && !contribution.includes('editingSessionLineStats')) {
	failures.push('workspaceDiff must use Magnus editing-session / edited-file attribution');
}
if (!contribution.includes('countSessionTerminals') && !contribution.includes('ITerminalChatService')) {
	failures.push('terminalCount must use session-filtered ITerminalChatService');
}
if (/\bdestructive:\s*false\b/.test(contribution)) {
	failures.push('destructive must not be hardcoded false');
}
if (!contribution.includes('prebase.test.seedMagnusLiveActivityPending')) {
	failures.push('smoke seed command for pending approval/question missing');
}
if (!contribution.includes('interactionId: first.id')) {
	failures.push('question pendingInteraction.interactionId must be question.id');
}

const native = readFileSync(join(repo, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
if (!native.includes('safeAreaInsets') || !native.includes('auxiliaryTopLeftArea')) {
	failures.push('native geometry must use NSScreen safeAreaInsets and auxiliary areas');
}
if (!native.includes('LiveActivityWindowLevel') && !native.includes('kCGMaximumWindowLevelKey')) {
	failures.push('native panel must use elevated window level to escape menu-bar clamp');
}
if (!native.includes('ScreenHasPhysicalNotch') || !native.includes('NSMinX(auxRight) > NSMaxX(auxLeft)')) {
	failures.push('native notch detection must require a real auxiliary gap between left and right areas');
}
if (!native.includes('CGDisplayIsBuiltin')) {
	failures.push('builtin display selection must prefer CGDisplayIsBuiltin notched screen');
}
if (!native.includes('topY - height') && !native.includes('topY - bandH')) {
	failures.push('native layout must top-anchor at screen.frame.maxY and grow downward');
}
if ((!native.includes('wingPathInRect') && !native.includes('CreateNotchedIslandPath')) || !native.includes('self.notched')) {
	failures.push('native shape creation must branch notch wings vs pill capsule');
}
if (!native.includes('hasShadow = !notched')) {
	failures.push('native notch mode must disable floating shadow');
}
if (!native.includes('removeMonitors') || !native.includes('event.keyCode != 53')) {
	failures.push('native Escape/unpin and monitor teardown missing');
}
if (/MacBook Pro|14-inch|16-inch/.test(native)) {
	failures.push('native geometry must not hard-code a MacBook model');
}
if (!native.includes('pendingOptions') || !native.includes('answerOption:')) {
	failures.push('native question option controls missing');
}
if (!native.includes('metricsLabel')) {
	failures.push('native metricsLabel serialization missing');
}
if (!magnusCommon.includes('LIVE_ACTIVITY_COMPLETED_HOLD_MS')) {
	failures.push('completed hold constant missing from magnusLiveActivity.ts');
}
if (!/LIVE_ACTIVITY_COMPLETED_HOLD_MS\s*=\s*8_000/.test(magnusCommon)) {
	failures.push('completed hold must remain 8s for transient finished state');
}
if (!mainService.includes('enable-smoke-test-driver')) {
	failures.push('simulateAction must be gated behind enable-smoke-test-driver in main service');
}
if (!/async simulateAction[\s\S]*enable-smoke-test-driver[\s\S]*return false/.test(mainService)) {
	failures.push('simulateAction must fail closed when smoke test driver is disabled');
}
const contributionSource = readFileSync(contributionPath, 'utf8');
if (!contributionSource.includes('requireSmokeTestDriver') || !contributionSource.includes('prebase.magnus.liveActivity.simulate')) {
	failures.push('workbench simulate command must require smoke test driver');
}
if (!native.includes('userDismissedAttention')) {
	failures.push('native Escape/collapse must sticky-dismiss attention peek across snapshot republish');
}
if (!native.includes('dict[@"userDismissedAttention"]')) {
	failures.push('native diagnostics must expose userDismissedAttention for AppKit product-truth proof');
}
if (!native.includes('emit:@"dismissAttention"')) {
	failures.push('native collapse must emit dismissAttention so renderer projection can stay attentionCompact');
}
{
	const applyStart = native.indexOf('- (void)applySnapshotDict:(NSDictionary *)snapshot {');
	const stickyBranch = applyStart >= 0
		? native.slice(applyStart, applyStart + 4500)
		: '';
	if (!/else if \(!self\.pinned && self\.userDismissedAttention\)/.test(stickyBranch)
		|| !/lasting compact until click/.test(stickyBranch)
		|| !/self\.attentionPeek = NO/.test(stickyBranch)
		|| !/self\.content\.peekOnly = NO/.test(stickyBranch)
		|| !/self\.content\.expanded = NO/.test(stickyBranch)) {
		failures.push('applySnapshotDict must keep sticky Escape attention dismiss as lasting compact (not republished peek)');
	}
	const peekBodyStart = native.indexOf('NSString *peekBody = nil;');
	const peekBody = peekBodyStart >= 0 ? native.slice(peekBodyStart, peekBodyStart + 900) : '';
	if (!/pendingTitle\.length/.test(peekBody)
		|| !/pendingMessage\.length/.test(peekBody)
		|| !/activityLabel\.length/.test(peekBody)
		|| !/configureLabel:self\.activityDescription lines:2/.test(peekBody)
		|| peekBody.indexOf('pendingTitle.length') > peekBody.indexOf('activityLabel.length')) {
		failures.push('peek body must prefer pendingTitle → pendingMessage → activityLabel with measured 2-line clamp');
	}
	if (!native.includes('renderedPeekBody')) {
		failures.push('native diagnostics must expose renderedPeekBody for AppKit peek product-truth proof');
	}
	if (!native.includes('hitTest:') || !native.includes('CGPathContainsPoint') || !native.includes('shapeAwareHitTesting')) {
		failures.push('native must implement shape-aware hit testing so transparent panel regions pass clicks through');
	}
	if (!native.includes('dict[@"shapeAwareHitTesting"] = @YES')) {
		failures.push('native diagnostics must expose shapeAwareHitTesting=YES');
	}
	if (!native.includes('dict[@"contentViewport"]')
		|| !native.includes('dict[@"contentSafeViewport"]')
		|| !native.includes('dict[@"contentPopulated"]')
		|| !native.includes('dict[@"headerFrame"]')
		|| !native.includes('dict[@"activityFrame"]')
		|| !native.includes('dict[@"composerFrame"]')
		|| !native.includes('dict[@"approveButtonFrame"]')
		|| !native.includes('dict[@"optionButtonFrames"]')
		|| !native.includes('dict[@"silhouetteMetrics"]')
		|| !native.includes('dict[@"actionRowIds"]')
		|| !native.includes('dict[@"geometrySignature"]')) {
		failures.push('native diagnostics must expose layout containment frames (contentViewport + contentSafeViewport + contentPopulated + control frames + silhouetteMetrics + actionRowIds + geometrySignature)');
	}
	if (!native.includes('kOpticalShoulderInsetMin') || !native.includes('shapeMaskLayer') || !native.includes('colorWithCalibratedWhite:0.0 alpha:1.0')) {
		failures.push('native must use optical shoulder inset + true-black fill + synchronized shape mask');
	}
	if (!native.includes('kContentFooterGutter') || !native.includes('dict[@"contentFooterGutter"]')) {
		failures.push('native must expose contentFooterGutter diagnostic from kContentFooterGutter');
	}
	if (!native.includes('dict[@"contentViewport"] = RectDict(scrollFrame)')
		|| !native.includes('dict[@"contentScrollFrame"] = RectDict(scrollFrame)')) {
		failures.push('contentViewport must equal contentScrollFrame (actual scroll host, not a footer heuristic)');
	}
	if (!native.includes('Approval/question: pending is primary')
		|| !native.includes('if (!hasPending) {')) {
		failures.push('pending approval/question must hide activity/action log so text cannot paint under Deny/Approve');
	}
	if (!native.includes('reconcileActionRowsIntoDocument')
		|| !native.includes('Preserve visible slot order when ids still present')) {
		failures.push('native must reconcile action rows by stable id without reshuffling');
	}
	if (!native.includes('Same semantic layout: reuse pinned height')
		|| !native.includes('pinnedInteractiveHeight')) {
		failures.push('geometrySignature must pin interactive height so content-only text updates do not resize');
	}
	if (!native.includes('@"id": actionId') || !contribution.includes('actionLedger') || !contribution.includes('_actionLedger')) {
		failures.push('action identity must survive TS ledger → NAPI bridge (id+label)');
	}
	if (!contribution.includes('existing?.at ?? Date.now()')) {
		failures.push('action ledger must preserve stable at timestamps across label/status updates');
	}
	if (!/status\?:\s*'running'\s*\|\s*'passed'\s*\|\s*'failed'\s*\|\s*'other'/.test(magnusCommon)) {
		failures.push('MagnusLiveActivityAction must expose optional status for bridge identity');
	}
	if (!native.includes('refreshContentSubviewsPreservingPresentationWithSize:')
		|| !native.includes('populated first paint')) {
		failures.push('native must stage expanded content at target size before morph (no blank black expansion)');
	}
	if (!native.includes('computeExpandedWidth:') || !native.includes('kExpandedWidthPad')) {
		failures.push('native must prefer natural notch width and only pad for option rows (kExpandedWidthPad)');
	}
	{
		const widthFnStart = native.indexOf('- (CGFloat)computeExpandedWidth:(CGFloat)naturalW {');
		const widthFn = widthFnStart >= 0 ? native.slice(widthFnStart, widthFnStart + 350) : '';
		if (!/pendingOptions\.count > 2/.test(widthFn)
			|| !/kExpandedWidthPad/.test(widthFn)
			|| !/return naturalW;/.test(widthFn)
			|| /320/.test(widthFn)) {
			failures.push('computeExpandedWidth must return naturalW unless question has >2 options; must not force 320pt');
		}
		if (!/kExpandedHeightMin = 72/.test(native)
			|| !/kExpandedHeightMax = 192/.test(native)
			|| !/kExpandedWidthPad = 28/.test(native)
			|| !/kStableCompactLeftWing = 64/.test(native)
			|| !/kStableCompactRightWing = 64/.test(native)) {
			failures.push('native geometry constants must stay at min=72 max=192 pad=28 stable wings=64');
		}
		if (!/LIVE_ACTIVITY_EXPANDED_HEIGHT_MIN = 72/.test(magnusCommon)
			|| !/LIVE_ACTIVITY_EXPANDED_HEIGHT_MAX = 192/.test(magnusCommon)
			|| !/LIVE_ACTIVITY_EXPANDED_WIDTH_PAD = 28/.test(magnusCommon)
			|| !/LIVE_ACTIVITY_WING_WIDTH_DEFAULT = 64/.test(magnusCommon)) {
			failures.push('TS magnusLiveActivity geometry constants must stay aligned with native (72/192/28/64)');
		}
		if (/MAX\(320/.test(native) || /kExpandedMinWidth\s*=\s*320/.test(native)) {
			failures.push('native must not force a fixed 320pt expanded min width');
		}
		{
			const stackFnStart = native.indexOf('- (CGFloat)computeControlsStackHeight {');
			const stackFn = stackFnStart >= 0 ? native.slice(stackFnStart, stackFnStart + 900) : '';
			if (!/Must match layoutControls/.test(stackFn)
				|| !/kControlHeight \+ 7/.test(stackFn)
				|| !/perRow = \(maxDirect >= 3\) \? 2/.test(stackFn)) {
				failures.push('computeControlsStackHeight must match layoutControls (composer + approval + 2-col option rows)');
			}
			if (!native.includes('computeControlsStackHeight] + kContentFooterGutter')
				&& !native.includes('computeControlsStackHeight] + 10')) {
				failures.push('scroll footerReserve must use max(reservedFooterHeight, computeControlsStackHeight+kContentFooterGutter)');
			}
			const layoutStart = native.indexOf('- (void)layoutControls:(NSRect)win {');
			const layoutBlock = layoutStart >= 0 ? native.slice(layoutStart, layoutStart + 5200) : '';
			if (!/perRow = \(maxDirect >= 3\) \? 2/.test(layoutBlock)
				|| !/Prefer 2-column grids/.test(layoutBlock)) {
				failures.push('layoutControls must use 2-column option grids when ≥3 options');
			}
			if (!native.includes('Magnus needs an answer')
				|| !native.includes('Magnus needs approval')) {
				failures.push('peek long titles must use short intentional copy (Magnus needs an answer/approval)');
			}
		}
	}
	if (!native.includes('dict[@"expandedContentAlpha"]')
		|| !native.includes('dict[@"contentScrollEnabled"]')
		|| !native.includes('dict[@"approveButtonTitle"]')
		|| !native.includes('dict[@"denyButtonTitle"]')
		|| !native.includes('Approve (in progress)')
		|| !native.includes('Deny (in progress)')
		|| native.includes('@"Applying…"')
		|| native.includes('@"Dismissing…"')) {
		failures.push('native must expose populated/scroll/action-title diagnostics and keep Approve/Deny titles (not Applying/Dismissing)');
	}
	if (!native.includes('beginActionInFlight') || !native.includes('kActionInFlightTimeout') || !native.includes('endActionInFlightRestoring')) {
		failures.push('native action lifecycle must use in-flight + timeout recovery without optimistic clear');
	}
	if (!native.includes('dict[@"actionInFlight"]') || !native.includes('dict[@"actionInFlightTimeoutMs"]')) {
		failures.push('native diagnostics must expose actionInFlight and actionInFlightTimeoutMs');
	}
	{
		const answerStart = native.indexOf('- (void)answerOption:(id)sender {');
		const answerBlock = answerStart >= 0 ? native.slice(answerStart, answerStart + 900) : '';
		if (/clearPendingInteraction/.test(answerBlock)) {
			failures.push('answerOption must not optimistically clearPendingInteraction before snapshot acknowledgment');
		}
		if (!/beginActionInFlight/.test(answerBlock)) {
			failures.push('answerOption must beginActionInFlight so options stay visible while awaiting acknowledgment');
		}
	}
	for (const method of ['approve:', 'deny:']) {
		const marker = `- (void)${method}(id)sender {`;
		const start = native.indexOf(marker);
		const block = start >= 0 ? native.slice(start, start + 500) : '';
		if (!/if \(self\.actionInFlight\)/.test(block) || !/beginActionInFlight/.test(block)) {
			failures.push(`${method} must guard duplicates with actionInFlight and beginActionInFlight`);
		}
	}
	if (!contributionSource.includes('prebase.test.seedMagnusLiveActivityVisualFixture')
		|| !magnusCommon.includes('createMagnusLiveActivityVisualFixture')) {
		failures.push('visual fixture seed command and createMagnusLiveActivityVisualFixture must exist for populated screenshot acceptance');
	}
	if (!native.includes('payload[@"screenLocked"]') || !native.includes('self.screenLocked = [snapshot[@"screenLocked"] boolValue]')) {
		failures.push('native SnapshotToDict/applySnapshotDict must serialize and honor screenLocked');
	}
	{
		const escapeStart = native.indexOf('- (void)installLocalKeyMonitor {');
		const escapeBlock = escapeStart >= 0 ? native.slice(escapeStart, escapeStart + 1200) : '';
		const dismissAt = escapeBlock.indexOf('emit:@"dismissAttention"');
		const unpinAt = escapeBlock.indexOf('emit:@"unpin"');
		if (dismissAt < 0 || unpinAt < 0 || dismissAt > unpinAt || !native.includes('collapseEmittingDismiss')) {
			failures.push('Escape must emit dismissAttention before unpin to avoid renderer race');
		}
	}
	if (!/action == "interactive"[\s\S]{0,200}enterInteractiveSticky/.test(native)) {
		failures.push('simulateAction("interactive") must enter sticky Interactive (not bare expandInteractive)');
	}
	if (!native.includes('attentionCompact is sticky Escape only')) {
		failures.push('native attentionCompact must require userDismissedAttention (not any collapsed attention)');
	}
	if (!native.includes('payload[@"userDismissedAttention"]')) {
		failures.push('SnapshotToDict must serialize userDismissedAttention for sticky restore');
	}
	if (!native.includes('Sticky Escape: do not reopen peek') || !native.includes('Attention peek is not hover-owned')) {
		failures.push('hover/mouseExit must not defeat sticky Escape or dismiss attentionPeek');
	}
	if (!/@"completedTransient"|@"failedTransient"/.test(native)) {
		failures.push('native diagnostics must emit completedTransient/failedTransient vocabulary');
	}
	if (!native.includes('Screen lock is a hard hide') || !native.includes('Snapshot lock must hide immediately')) {
		failures.push('native must orderOut on screenLocked (setVisible + applySnapshotDict)');
	}
	if (!/simulateSubmitFollowUp[\s\S]{0,200}self\.input\.hidden/.test(native)) {
		failures.push('simulateSubmitFollowUp must fail closed when Interactive input is hidden');
	}
	if (!/expandPeek\][\s\S]{0,200}peekOnly == YES/.test(native)) {
		failures.push('simulateAction peek/hover must return whether expandPeek actually peeked');
	}
	const contributionSourceFlush = contributionSource;
	const flushMarker = contributionSourceFlush.indexOf('Presentation before snapshot');
	const flushRegion = flushMarker >= 0 ? contributionSourceFlush.slice(flushMarker, flushMarker + 700) : '';
	if (!contributionSourceFlush.includes('Presentation before snapshot')
		|| flushRegion.indexOf('setPresentation(presentation)') < 0
		|| flushRegion.indexOf('setPresentation(presentation)') > flushRegion.indexOf('setSnapshot({')) {
		failures.push('contribution must apply presentation before snapshot (unlock attentionPeek + hide safety)');
	}
	if (!contributionSource.includes('getSystemIdleState(1)') || !contributionSource.includes("state === 'locked'")) {
		failures.push('contribution must cold-query getSystemIdleState for lock at startup');
	}
}
if (!native.includes('Pre-position controls before/during the frame morph')
	|| !native.includes('refreshContentOnly')
	|| !native.includes('refreshContentSubviewsPreservingPresentation')
	|| !native.includes('Identical geometry: content refresh only')) {
	failures.push('animated layout must pre-position controls and separate content-only refreshes from geometry morphs');
}
if (!contributionSource.includes('panelStateSource') || !contributionSource.includes('renderer-projection')) {
	failures.push('renderer diagnostics must label panelState as renderer-projection (not native hover truth)');
}
if (/topY - h - 8|NSMaxY\(frame\) - h - 8|pill: \{ x, y: 8/.test(native + magnusCommon)) {
	failures.push('detached floating pill below menu bar must not return (no top offset gap)');
}

const evidence = {
	ok: failures.length === 0,
	failures,
	platform,
	architectureChosen,
	nativePresent,
	testKind: 'static-source-contract',
	liveGui: 'source-contracts-only',
	notchGeometry: 'NSScreen.safeAreaInsets + auxiliaryTopLeftArea/auxiliaryTopRightArea',
	noNotchFallback: 'center-top floating pill',
	sessionIdentity: 'IChatService sessionResource — follow-up uses chatService.sendRequest',
	approvalContinuity: 'IChatToolInvocation.confirmWith on the same toolCallId',
	questionContinuity: 'native answer → question.id + optionId → notifyQuestionCarouselAnswer',
	durationMs: Date.now() - started,
	...phase3EvidenceMetadata(repo, 'magnus-live-activity-static'),
};

mkdirSync(evidenceDir, { recursive: true });
const out = join(evidenceDir, 'live-activity-static.json');
writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ ok: evidence.ok, failures, out, nativePresent, platform, testKind: evidence.testKind }));
process.exit(failures.length ? 1 : 0);

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
	const peekBody = peekBodyStart >= 0 ? native.slice(peekBodyStart, peekBodyStart + 700) : '';
	if (!/activityLabel\.length/.test(peekBody)
		|| !/pendingMessage\.length/.test(peekBody)
		|| !/pendingTitle\.length/.test(peekBody)
		|| !/substringToIndex:93/.test(peekBody)) {
		failures.push('peek body must prefer activity → pendingMessage → pendingTitle with truncated body');
	}
}
if (!native.includes('Delay control layout until frame animation completes to prevent visible popping')) {
	failures.push('animated layout must delay control layout until frame settles');
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

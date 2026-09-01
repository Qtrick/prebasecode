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
const architectureChosen = 'native-appkit';
const nativePresent = existsSync(nativeAddon);

if (platform === 'darwin' && !nativePresent) {
	failures.push('native AppKit module missing; run npm run compile:live-activity');
}

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

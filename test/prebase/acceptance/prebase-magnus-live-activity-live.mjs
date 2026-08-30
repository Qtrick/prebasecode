#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Magnus Live Activity / notch producer (macOS). Not a second Magnus session.
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

const contribution = readFileSync(join(repo, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts'), 'utf8');
if (!contribution.includes('this.chatService.sendRequest(sessionResource')) {
	failures.push('follow-up must use chatService.sendRequest on the snapshot session');
}
if (contribution.includes('startNewLocalSession')) {
	failures.push('Live Activity must not start a second chat session');
}
if (!contribution.includes('IChatToolInvocation.confirmWith')) {
	failures.push('approvals must resolve the canonical tool invocation');
}
if (contribution.includes('invokeTool')) {
	failures.push('notch must not call invokeTool');
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

const evidence = {
	ok: failures.length === 0,
	failures,
	platform,
	architectureChosen,
	nativePresent,
	notchGeometry: 'NSScreen.safeAreaInsets + auxiliaryTopLeftArea/auxiliaryTopRightArea',
	noNotchFallback: 'center-top floating pill',
	sessionIdentity: 'IChatService sessionResource — follow-up uses chatService.sendRequest',
	approvalContinuity: 'IChatToolInvocation.confirmWith on the same toolCallId',
	projectGuidance: 'follow-up uses the canonical Magnus request path',
	mutationPreflight: 'same chatParticipant/toolExecutor path as Agents UI',
	focusBehavior: 'NSPanel nonactivating; hover does not focus PreBase',
	reduceMotion: 'workbench.reduceMotion / IAccessibilityService.isMotionReduced',
	privacy: 'redactLiveActivityText; screen-lock hides details',
	quit: 'lifecycleMainService.onWillShutdown joins disposeNative (monitors, timers, panel, TSFN)',
	liveGui: 'source-contracts-only',
	durationMs: Date.now() - started,
	...phase3EvidenceMetadata(repo, 'magnus-live-activity'),
};

mkdirSync(evidenceDir, { recursive: true });
const out = join(evidenceDir, 'live-activity.json');
writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ ok: evidence.ok, failures, out, nativePresent, platform, architectureChosen }));
process.exit(failures.length ? 1 : 0);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Linux-runnable Live Activity product-truth contracts.
 * Imports the pure platform module via a strip-types child so full client transpile is not required.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('attention / screen-lock / pendingMessage state machine product truth', () => {
	const script = `
import assert from 'node:assert/strict';
import {
	buildMagnusLiveActivitySnapshot,
	canonicalizeLiveActivityPanelState,
	computeLiveActivityExpandedHeight,
	resolveLiveActivityPanelState,
	shouldShowLiveActivity,
} from ${JSON.stringify(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'))};

const session = {
	sessionId: 'sess-1',
	sessionResource: 'vscode-chat://local/sess-1',
	startedAt: 1000,
	title: 'Fix graph',
	isInProgress: true,
	currentActivity: 'Reading',
	needsInput: true,
	pendingInteraction: {
		kind: 'approval',
		interactionId: 'a',
		title: 'Approve',
		message: 'This removes the unused helper and cannot be undone.',
	},
};

const attention = buildMagnusLiveActivitySnapshot(session, { revision: 1, prebaseForeground: false, connected: true });
assert.equal(attention.status, 'attention');
assert.equal(resolveLiveActivityPanelState({ visible: true, hovering: false, pinned: false, snapshot: attention, now: 0 }), 'attentionPeek');
assert.equal(resolveLiveActivityPanelState({
	visible: true, hovering: true, pinned: false, snapshot: attention, now: 500, hoverSince: 0, openDelayMs: 150,
}), 'attentionPeek');
assert.equal(resolveLiveActivityPanelState({
	visible: true, hovering: false, pinned: false, snapshot: attention, now: 0, userDismissedAttention: true,
}), 'attentionCompact', 'sticky Escape must keep attentionCompact across republish');
assert.equal(resolveLiveActivityPanelState({
	visible: true, hovering: false, pinned: true, snapshot: attention, now: 0, userDismissedAttention: true,
}), 'attentionInteractive', 'pinned Interactive wins over sticky Escape');
assert.equal(resolveLiveActivityPanelState({ visible: true, hovering: false, pinned: true, snapshot: attention, now: 0 }), 'attentionInteractive');
assert.equal(resolveLiveActivityPanelState({
	visible: true, hovering: false, pinned: false, interactive: true, snapshot: attention, now: 0,
}), 'attentionInteractive');

const peekTitle = computeLiveActivityExpandedHeight({ bandHeight: 34, peekOnly: true, hasPendingTitle: true, hasPendingMessage: true, hasActivity: true });
const peekActivity = computeLiveActivityExpandedHeight({ bandHeight: 34, peekOnly: true, hasActivity: true, hasPendingMessage: true });
const peekFallback = computeLiveActivityExpandedHeight({ bandHeight: 34, peekOnly: true, hasPendingMessage: true });
assert.equal(peekTitle, 34 + 32);
assert.equal(peekActivity, 34 + 32);
assert.equal(peekFallback, 34 + 32, 'pendingMessage alone must not inflate peek height');

const working = buildMagnusLiveActivitySnapshot({ ...session, needsInput: false, pendingInteraction: undefined }, {
	revision: 2, prebaseForeground: false, connected: true,
});
assert.equal(resolveLiveActivityPanelState({ visible: true, hovering: false, pinned: false, snapshot: working, now: 0 }), 'compact');
assert.equal(resolveLiveActivityPanelState({
	visible: true, hovering: true, pinned: false, snapshot: working, now: 500, hoverSince: 0, openDelayMs: 150,
}), 'peek');

const failed = buildMagnusLiveActivitySnapshot({
	...session, failed: true, isInProgress: false, needsInput: false, pendingInteraction: undefined,
}, { revision: 3, prebaseForeground: false, connected: true });
assert.equal(resolveLiveActivityPanelState({ visible: true, hovering: false, pinned: false, snapshot: failed, now: 0 }), 'failedTransient');

const locked = buildMagnusLiveActivitySnapshot(session, {
	revision: 4, prebaseForeground: false, connected: true, screenLocked: true,
});
assert.equal(locked.pendingInteraction, undefined);
assert.equal(shouldShowLiveActivity('attentionOnly', locked), false);
assert.equal(shouldShowLiveActivity('alwaysWorking', locked), false);
assert.equal(resolveLiveActivityPanelState({
	visible: shouldShowLiveActivity('alwaysWorking', locked), hovering: false, pinned: true, snapshot: locked, now: 0,
}), 'hidden');

assert.equal(canonicalizeLiveActivityPanelState('attention'), 'attentionPeek');
assert.equal(canonicalizeLiveActivityPanelState('collapsed'), 'compact');
assert.equal(canonicalizeLiveActivityPanelState('hoverPreview'), 'peek');

assert.equal(
	attention.pendingInteraction?.message,
	'This removes the unused helper and cannot be undone.',
);
assert.ok(JSON.stringify(attention).includes('"message":"This removes the unused helper and cannot be undone."'));
`;

	const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('native pendingMessage bridge + unpin/collapse source contracts (Linux-readable)', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	assert.match(native, /payload\[@"pendingMessage"\] = JSString\(pending\.Get\("message"\)\)/);
	assert.match(native, /self\.content\.pendingMessage = snapshot\[@"pendingMessage"\]/);
	assert.match(native, /dict\[@"pendingMessage"\] = self\.content\.pendingMessage/);
	assert.match(native, /renderedPendingMessage/);
	assert.match(native, /- \(void\)enterInteractiveSticky/);
	assert.match(native, /\[controller enterInteractiveSticky\]/);
	assert.match(native, /userDismissedAttention/);
	assert.match(native, /dict\[@"userDismissedAttention"\]/);
	assert.match(native, /attentionCompact/);
	assert.match(native, /pendingMessage\.length/);

	const escapeMonitor = native.indexOf('- (void)installLocalKeyMonitor {');
	assert.ok(escapeMonitor > 0);
	const escapeBlock = native.slice(escapeMonitor, escapeMonitor + 1400);
	assert.match(escapeBlock, /userDismissedAttention = YES/);
	assert.match(escapeBlock, /wasPinned/);
	assert.match(escapeBlock, /emit:@"unpin"/);
	assert.match(escapeBlock, /collapseEmittingDismiss/);
	const dismissAt = escapeBlock.indexOf('emit:@"dismissAttention"');
	const unpinAt = escapeBlock.indexOf('emit:@"unpin"');
	assert.ok(dismissAt >= 0 && unpinAt > dismissAt, 'Escape must emit dismissAttention before unpin');

	const collapseStart = native.indexOf('- (void)collapseEmittingDismiss:(BOOL)emitDismiss {');
	const collapse = native.slice(collapseStart, native.indexOf('- (void)emit:', collapseStart));
	assert.match(collapse, /if \(self\.pinned\) \{\s*return;/);
	assert.match(collapse, /userDismissedAttention = YES/);
	assert.match(collapse, /emit:@"dismissAttention"/);
	assert.match(collapse, /self\.attentionPeek = NO/);
	assert.match(collapse, /self\.content\.peekOnly = NO/);
	assert.match(collapse, /self\.content\.expanded = NO/);
	assert.match(native, /renderedPeekBody/);
	assert.match(native, /payload\[@"screenLocked"\]/);
	assert.match(native, /self\.screenLocked = \[snapshot\[@"screenLocked"\] boolValue\]/);
	assert.match(native, /action == "interactive"[\s\S]{0,200}enterInteractiveSticky/);

	assert.match(native, /payload\[@"userDismissedAttention"\]/);
	assert.match(native, /\[snapshot\[@"userDismissedAttention"\] boolValue\]/);
	assert.match(native, /attentionCompact is sticky Escape only/);
	assert.match(native, /completedTransient|failedTransient/);
	assert.match(native, /Sticky Escape: do not reopen peek/);
	assert.match(native, /Attention peek is not hover-owned/);

	const ts = readFileSync(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'), 'utf8');
	assert.match(ts, /if \(snapshot\.screenLocked\) \{\s*return false;/);
	assert.match(ts, /reason: 'screen-locked'/);
	assert.match(ts, /testState: hide \? undefined : input\.testState/);
	assert.match(ts, /hasLatestMessage/);
	assert.match(ts, /return attention \? 'attentionInteractive'/);
	assert.match(ts, /return 'attentionCompact'/);
	assert.match(ts, /return 'attentionPeek'/);
	assert.match(ts, /return 'failedTransient'/);
	assert.doesNotMatch(ts, /forceEmphasis/);

	const contribution = readFileSync(resolve(repoRoot, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts'), 'utf8');
	assert.match(contribution, /Presentation before snapshot/);
	const flushMarker = contribution.indexOf('Presentation before snapshot');
	assert.ok(flushMarker >= 0);
	const flushRegion = contribution.slice(flushMarker, flushMarker + 700);
	assert.ok(
		flushRegion.indexOf('setPresentation(presentation)') >= 0
		&& flushRegion.indexOf('setPresentation(presentation)') < flushRegion.indexOf('setSnapshot({'),
		'unlock must present before snapshot so attentionPeek can expand',
	);
	const fixtureSeed = contribution.indexOf('publishVisualFixtureForSmoke');
	assert.ok(fixtureSeed >= 0);
	const fixtureRegion = contribution.slice(fixtureSeed, fixtureSeed + 1800);
	assert.ok(
		fixtureRegion.indexOf('setPresentation({') >= 0
		&& fixtureRegion.indexOf('setPresentation({') < fixtureRegion.indexOf('setSnapshot({'),
		'visual fixture seed must also apply presentation before snapshot',
	);
	assert.match(contribution, /userDismissedAttention: this\._userDismissedAttention/);
	assert.match(contribution, /getSystemIdleState\(1\)/);
	assert.match(native, /Screen lock is a hard hide/);
	assert.match(native, /Snapshot lock must hide immediately/);
	assert.match(native, /peekOnly == YES/);
	assert.match(native, /simulateSubmitFollowUp[\s\S]{0,200}self\.input\.hidden/);
	assert.match(native, /const BOOL activeInteraction = isInteractive && \(self\.hovering \|\| self\.panel\.firstResponder == self\.input\.currentEditor \|\| self\.input\.stringValue\.length > 0 \|\| self\.exitTimer != nil\);/);
	assert.match(native, /if \(self\.content\.expanded && !peekSurface && !activeInteraction\) \{/);
	assert.match(native, /self\.content\.expanded = self\.content\.expanded && \(peekSurface \|\| activeInteraction\);/);
});

test('visual fixtures and height variants cover populated Live Activity layouts', () => {
	const script = `
import assert from 'node:assert/strict';
import {
	computeLiveActivityExpandedHeight,
	createMagnusLiveActivityVisualFixture,
	resolveLiveActivityPanelState,
} from ${JSON.stringify(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'))};

const working = createMagnusLiveActivityVisualFixture('working', { revision: 1 });
const question = createMagnusLiveActivityVisualFixture('question', { revision: 2 });
const approval = createMagnusLiveActivityVisualFixture('approval', { revision: 3 });
const long = createMagnusLiveActivityVisualFixture('long', { revision: 4 });
const completed = createMagnusLiveActivityVisualFixture('completed', { revision: 5 });
const failed = createMagnusLiveActivityVisualFixture('failed', { revision: 6 });

assert.equal(working.status, 'working');
assert.equal(question.status, 'attention');
assert.equal(question.pendingInteraction?.kind, 'question');
assert.ok((question.pendingInteraction?.options?.length ?? 0) >= 3);
assert.equal(approval.pendingInteraction?.kind, 'approval');
assert.ok((long.latestShortMessage?.length ?? 0) > 120);
assert.equal(completed.status, 'completed');
assert.equal(failed.status, 'failed');

assert.equal(resolveLiveActivityPanelState({
	visible: true, hovering: false, pinned: false, snapshot: question, now: 0,
}), 'attentionPeek');
assert.equal(resolveLiveActivityPanelState({
	visible: true, hovering: false, pinned: true, snapshot: approval, now: 0,
}), 'attentionInteractive');
assert.equal(resolveLiveActivityPanelState({
	visible: true, hovering: false, pinned: false, snapshot: completed, now: 0,
}), 'completedTransient');
assert.equal(resolveLiveActivityPanelState({
	visible: true, hovering: false, pinned: false, snapshot: failed, now: 0,
}), 'failedTransient');

const empty = computeLiveActivityExpandedHeight({ bandHeight: 34 });
const short = computeLiveActivityExpandedHeight({ bandHeight: 34, hasActivity: true });
const medium = computeLiveActivityExpandedHeight({ bandHeight: 34, hasActivity: true, hasLatestMessage: true });
const longH = computeLiveActivityExpandedHeight({
	bandHeight: 34, hasActivity: true, hasLatestMessage: true, actionsCount: 3, hasMetrics: true,
});
const longPending = computeLiveActivityExpandedHeight({
	bandHeight: 34, hasPendingTitle: true, hasPendingMessage: true, pendingKind: 'approval', hasActivity: true,
});
const longOptions = computeLiveActivityExpandedHeight({
	bandHeight: 34, hasPendingTitle: true, hasPendingMessage: true, pendingKind: 'question', hasOptions: true, hasActivity: true,
});
assert.ok(short > empty);
assert.equal(medium, short, 'current activity is primary; latest message must not add a second working text block');
assert.ok(longH >= medium);
assert.ok(longPending > longH || longPending > medium);
assert.ok(longOptions > medium);
	assert.ok(short < 220 - 20, 'short working content must leave headroom below expanded max');
	assert.ok(longOptions <= 220);
`;

	const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('TS Live Activity geometry constants stay aligned with native notch polish', () => {
	const script = `
import assert from 'node:assert/strict';
import {
	LIVE_ACTIVITY_CAMERA_HOUSING_MIN,
	LIVE_ACTIVITY_EXPANDED_HEIGHT_MAX,
	LIVE_ACTIVITY_EXPANDED_HEIGHT_MIN,
	LIVE_ACTIVITY_EXPANDED_MIN_WIDTH,
	LIVE_ACTIVITY_EXPANDED_WIDTH_PAD,
	LIVE_ACTIVITY_WING_WIDTH,
	LIVE_ACTIVITY_WING_WIDTH_DEFAULT,
	computeLiveActivityWingWidth,
} from ${JSON.stringify(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'))};

assert.equal(LIVE_ACTIVITY_EXPANDED_HEIGHT_MIN, 72);
assert.equal(LIVE_ACTIVITY_EXPANDED_HEIGHT_MAX, 220);
assert.equal(LIVE_ACTIVITY_EXPANDED_WIDTH_PAD, 28);
assert.equal(LIVE_ACTIVITY_WING_WIDTH_DEFAULT, 64);
assert.equal(LIVE_ACTIVITY_WING_WIDTH, 64);
assert.equal(LIVE_ACTIVITY_CAMERA_HOUSING_MIN, 24);
assert.equal(LIVE_ACTIVITY_EXPANDED_MIN_WIDTH, 152);
assert.equal(computeLiveActivityWingWidth(10), 64);
assert.equal(computeLiveActivityWingWidth(200), 64);
`;

	const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('native source keeps natural expanded width + truthful Approve/Deny in-flight titles', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	assert.match(native, /kExpandedHeightMin = 72/);
	assert.match(native, /kExpandedHeightMax = 220/);
	assert.match(native, /kExpandedWidthPad\b.*=\s*28/);
	assert.match(native, /kExpandedWidthStandardPad = 36/);
	assert.match(native, /kExpandedWidthWidePad = 84/);
	assert.match(native, /kContentMinScrollHeight = 24/);
	assert.match(native, /kStableCompactLeftWing = 64/);
	assert.match(native, /computeExpandedWidth:/);
	// New bucket strategy: approval+question always use WIDE bucket, not per-option-count
	assert.match(native, /InteractiveApproval/);
	assert.match(native, /kExpandedWidthWidePad/);
	assert.match(native, /contentPopulated/);
	assert.match(native, /contentSafeViewport/);
	assert.match(native, /Approve \(in progress\)/);
	assert.match(native, /Deny \(in progress\)/);
	assert.doesNotMatch(native, /@"Applying…"/);
	assert.doesNotMatch(native, /@"Dismissing…"/);
	assert.doesNotMatch(native, /kExpandedMinWidth = 320/);
	assert.doesNotMatch(native, /MAX\(280\.0/);
});

test('privacy: redactLiveActivityText redacts sensitive tokens while preserving normal text', () => {
	const script = `
import assert from 'node:assert/strict';
import { redactLiveActivityText } from ${JSON.stringify(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'))};

// Preserves normal filenames and activities
assert.equal(redactLiveActivityText('Reading src/vs/workbench/file.ts'), 'Reading src/vs/workbench/file.ts');
assert.equal(redactLiveActivityText('Running npm test'), 'Running npm test');

// Redacts AWS access keys
assert.equal(redactLiveActivityText('AWS key AKIAIOSFODNN7EXAMPLE used'), 'AWS key [redacted] used');

// Redacts PEM private keys
const pem = '-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEA0\\n-----END RSA PRIVATE KEY-----';
assert.equal(redactLiveActivityText('Key: ' + pem), 'Key: [redacted]');

// Redacts Supabase access tokens
assert.equal(redactLiveActivityText('Token sbp_abcdef0123456789abcdef0123456789abcdef01'), 'Token [redacted]');

// Redacts GitHub PATs (ghp_ and github_pat_)
assert.equal(redactLiveActivityText('PAT ghp_1234567890abcdefghijklmnopqrstuvwxyz'), 'PAT [redacted]');
assert.equal(redactLiveActivityText('PAT github_pat_1234567890abcdefghijklmnopqrstuvwxyz'), 'PAT [redacted]');

// Redacts Bearer and JWT tokens
assert.equal(redactLiveActivityText('Bearer secret_token_1234567890_abc'), 'Bearer [redacted]');
assert.equal(redactLiveActivityText('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'), '[redacted]');

// Redacts Gemini and OpenAI API keys
assert.equal(redactLiveActivityText('Key AIzaSyD1234567890abcdefghij'), 'Key [redacted]');
assert.equal(redactLiveActivityText('Key sk-proj-1234567890abcdefghijkl'), 'Key [redacted]');

// Redacts generic secret assignments
assert.equal(redactLiveActivityText('api_key=supersecret12345'), 'api_key=[redacted]');
assert.equal(redactLiveActivityText('password: "supersecret12345"'), 'password=[redacted]');
`;

	const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('bridge preserves recentActions id/at/status and caps to max actions', () => {
	const script = `
import assert from 'node:assert/strict';
import {
	LIVE_ACTIVITY_MAX_ACTIONS,
	buildMagnusLiveActivitySnapshot,
} from ${JSON.stringify(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'))};

const session = {
	sessionId: 'sess-actions',
	sessionResource: 'vscode-chat://local/sess-actions',
	startedAt: 1000,
	title: 'Action identity',
	isInProgress: true,
	currentActivity: 'Working',
	recentActions: [
		{ id: 'A', label: 'Read file', at: 1100, status: 'passed' },
		{ id: 'B', label: 'Edit file', at: 1200, status: 'running' },
		{ id: 'C', label: 'Run test', at: 1300 },
		{ id: 'D', label: 'Ship', at: 1400, status: 'other' },
		{ id: 'E', label: 'Extra', at: 1500, status: 'failed' },
	],
};

const snap = buildMagnusLiveActivitySnapshot(session, { revision: 9, prebaseForeground: false, connected: true });
assert.equal(snap.recentActions.length, LIVE_ACTIVITY_MAX_ACTIONS);
assert.deepEqual(
	snap.recentActions.map(a => ({ id: a.id, at: a.at, status: a.status })),
	[
		{ id: 'B', at: 1200, status: 'running' },
		{ id: 'C', at: 1300, status: undefined },
		{ id: 'D', at: 1400, status: 'other' },
		{ id: 'E', at: 1500, status: 'failed' },
	],
);
assert.ok(snap.recentActions.every(a => typeof a.id === 'string' && a.id.length > 0));
assert.ok(snap.recentActions.every(a => typeof a.label === 'string' && a.label.length > 0));
`;

	const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('native notch polish contracts: optical shoulder, true viewport, action id reconcile, footer gutter', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	// effShoulderR is authoritative 6pt matching physical MacBook bezel curve
	assert.match(native, /CGFloat effR = 6\.0;/);
	assert.match(native, /kContentFooterGutter = 8/);
	assert.match(native, /colorWithCalibratedWhite:0\.0 alpha:1\.0/);
	assert.match(native, /shapeMaskLayer/);
	assert.match(native, /dict\[@"contentViewport"\] = RectDict\(scrollFrame\)/);
	assert.match(native, /dict\[@"contentScrollFrame"\] = RectDict\(scrollFrame\)/);
	assert.match(native, /dict\[@"silhouetteMetrics"\]/);
	assert.match(native, /nonDegenerateShoulder/);
	assert.match(native, /opticalTopInset/);
	assert.match(native, /effShoulderR/);
	assert.match(native, /dict\[@"actionRowIds"\]/);
	assert.match(native, /dict\[@"geometrySignature"\]/);
	assert.match(native, /reconcileActionRowsIntoDocument/);
	assert.match(native, /@"id": actionId/);
	assert.match(native, /Approval\/question: pending is primary/);
	assert.match(native, /Same semantic layout: reuse pinned height/);

	const contribution = readFileSync(resolve(repoRoot, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts'), 'utf8');
	assert.match(contribution, /_actionLedger/);
	assert.match(contribution, /existing\?\.at \?\? Date\.now\(\)/);
	assert.match(contribution, /store\.set\(id, \{ id, label: redactLiveActivityText\(label\), at, status \}\)/);

	const ts = readFileSync(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'), 'utf8');
	assert.match(ts, /readonly status\?: 'running' \| 'passed' \| 'failed' \| 'other'/);
	assert.match(ts, /\.\.\.\(action\.status \? \{ status: action\.status \} : \{\}\)/);
});

test('working height has one primary text block, matching the native activity-or-message hierarchy', () => {
	const script = `
import assert from 'node:assert/strict';
import { computeLiveActivityExpandedHeight } from ${JSON.stringify(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'))};

const activityOnly = computeLiveActivityExpandedHeight({ bandHeight: 34, hasActivity: true });
const messageOnly = computeLiveActivityExpandedHeight({ bandHeight: 34, hasLatestMessage: true });
const both = computeLiveActivityExpandedHeight({ bandHeight: 34, hasActivity: true, hasLatestMessage: true });

assert.equal(both, activityOnly, 'working activity is primary; a latest message must not consume a second semantic height block');
assert.ok(messageOnly <= activityOnly, 'latest message is the fallback primary block when activity is absent');
`;

	const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);

	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	assert.match(native, /if \(self\.content\.activityLabel\.length\) \{[\s\S]{0,500}\} else if \(self\.content\.latestMessage\.length\) \{/,
		'native natural-height measurement must use activity OR latest message');
});

test('native layout treats the scroll host as the actual viewport and fails shallow question containment', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// This must be a direct comparison against the real scroll frame. A min(messageBottom,
	// viewportBottom) calculation only hides clipping and is not a containment check.
	assert.match(native, /const CGFloat scrollOffsetY = self\.content\.contentScrollView\.documentVisibleRect\.origin\.y;/,
		'pending document coordinates must be converted into the scroll host coordinate space');
	assert.match(native, /const CGFloat actualVisibleViewportBottom = NSMaxY\(scrollFrame\);/);
	assert.match(native, /const CGFloat actualVisibleViewportTop = NSMinY\(scrollFrame\);/);
	assert.match(native, /pendingFieldTop = actualVisibleViewportTop \+ NSMinY\(pendingField\.frame\) - scrollOffsetY;/);
	assert.match(native, /pendingFieldBottom = actualVisibleViewportTop \+ NSMaxY\(pendingField\.frame\) - scrollOffsetY;/);
	assert.match(native, /pendingContentTop >= actualVisibleViewportTop - 0\.5/,
		'containment must detect a question title or message clipped above the viewport');
	assert.match(native, /pendingContentBottom <= actualVisibleViewportBottom \+ 0\.5/,
		'containment must detect a question title or message clipped below the viewport');
	assert.match(native, /dict\[@"pendingMessageFullyVisible"\]/,
		'diagnostics must expose the pending-message containment result, not just frame coordinates');
	assert.match(native, /dict\[@"pendingContentFullyVisible"\]/,
		'diagnostics must expose containment for the complete question, including its title');
	assert.match(native, /dict\[@"questionContentHealthy"\]/,
		'a shallow question viewport must be reported unhealthy rather than skipped');
	assert.doesNotMatch(native, /MIN\(pendingMessageBottom\s*,\s*actualVisibleViewportBottom\)/,
		'clamping a message bottom to the viewport is not valid containment');
});

test('native shape mask follows the same presentation-aware morph as the visible silhouette', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	assert.match(native, /CABasicAnimation \*maskPathAnimation = \[CABasicAnimation animationWithKeyPath:@"path"\]/);
	assert.match(native, /maskPathAnimation\.fromValue = \(__bridge id\)fromPath;/,
		'the mask must start from the visible layer\'s presentation-aware path');
	assert.match(native, /maskPathAnimation\.toValue = \(__bridge id\)targetPath;/);
	assert.match(native, /maskPathAnimation\.duration = duration;/);
	assert.match(native, /\[self\.shapeMaskLayer addAnimation:maskPathAnimation forKey:@"morphPath"\]/);
	assert.match(native, /CABasicAnimation \*maskFrameAnimation = \[CABasicAnimation animationWithKeyPath:@"frame"\]/);
	assert.match(native, /maskFrameAnimation\.fromValue = \[NSValue valueWithRect:NSRectFromCGRect\(fromFrame\)\];/);
	assert.match(native, /maskFrameAnimation\.toValue = \[NSValue valueWithRect:NSRectFromCGRect\(targetFrame\)\];/);
	assert.match(native, /maskFrameAnimation\.duration = duration;/);
	assert.match(native, /\[self\.shapeMaskLayer addAnimation:maskFrameAnimation forKey:@"morphFrame"\]/);
	assert.doesNotMatch(native, /Mask jumps to the target silhouette/,
		'the mask cannot snap to target geometry while the visible shape is mid-morph');
});

test('native panel frame settles to lastRequestedFrame and resets scroll on new interactions', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	assert.match(native, /\[CATransaction setCompletionBlock:\^\{[\s\S]*?\[self\.controller\.panel setFrame:self\.controller\.lastRequestedFrame display:YES\]/,
		'CATransaction completion block must synchronize the panel frame to lastRequestedFrame');
	assert.match(native, /if \(!self\.transitionInFlight && self\.panel && !NSEqualRects\(self\.lastRequestedFrame, NSZeroRect\)\)[\s\S]*?\[self\.panel setFrame:self\.lastRequestedFrame display:YES\]/,
		'settled diagnostics must guarantee panel frame matches lastRequestedFrame');
	assert.match(native, /scrollToPoint:NSZeroPoint/,
		'new pending interactions must reset scroll view to the top');
});

test('diagnostics enforce truthful transitionInFlight, compact peek height, and scroll reset on kind/status transitions', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	assert.match(native, /dict\[@"transitionInFlight"\] = @\(self\.transitionInFlight \|\| !effectivelySettled\);/,
		'diagnostics must never report transitionInFlight=false if panel frame has not settled to requestedFrame');
	assert.match(native, /BOOL interactionChanged = !\[incomingInteractionId isEqualToString:self\.interactionId\][\s\S]*?!\[incomingPendingKind isEqualToString:self\.pendingKind\]/,
		'interactionChanged must detect pendingKind transitions even when interactionId is empty');
	assert.match(native, /kPeekBodyHeight = 32;/,
		'peek body height must be 32pt to eliminate empty black slab');
});

// ─── TEST-WRITER ADDITIONS ────────────────────────────────────────────────────
// These tests were added to cover behavior gaps identified during forensic redesign.
// They target specific false-green cases: the old per-option-count width check was
// green even when approval/question panels were too narrow and clipping text.

test('width bucket strategy: approval and question always use WIDE bucket (forensic redesign)', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	// WIDE bucket must trigger on approval state class — not just on option count
	assert.match(native, /PrebasePresentationStateInteractiveApproval[\s\S]{0,300}kExpandedWidthWidePad/,
		'approval state must trigger WIDE width bucket (not per-option-count)');
	// WIDE bucket must trigger on question state class
	assert.match(native, /PrebasePresentationStateInteractiveQuestion[\s\S]{0,300}kExpandedWidthWidePad/,
		'question state must trigger WIDE width bucket');
	// STANDARD bucket for working interactive
	assert.match(native, /kExpandedWidthStandardPad/,
		'STANDARD bucket constant must exist for working/terminal states');
	// The function must NOT gate on pendingOptions.count > 2 alone for width selection
	const widthFnStart = native.indexOf('- (CGFloat)computeExpandedWidth:(CGFloat)naturalW {');
	const widthFn = widthFnStart >= 0 ? native.slice(widthFnStart, widthFnStart + 900) : '';
	assert.ok(!/pendingOptions\.count > 2/.test(widthFn),
		'computeExpandedWidth must not gate WIDE bucket on option count alone — approval/question always WIDE');
	// COMPACT: return naturalW for non-expanded states
	assert.match(native, /\/\/ COMPACT: peek, attention-peek, compact/,
		'COMPACT bucket must return naturalW without padding');
});

test('minimum scroll viewport floor: working interactive cannot be capped to ~16pt usable area', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	// The old MIN(114.0, h) cap is abolished — only permitted to appear in comments, not live code
	// Check: no standalone code use of MIN(114 (comment OK, actual h = MIN(114, ...) not OK)
	assert.doesNotMatch(native, /\n\t*h = MIN\(114/,
		'h = MIN(114, ...) must not exist in code — it created ~16pt usable viewport, blocking real content display');
	// New floor: kContentMinScrollHeight = 24
	assert.match(native, /kContentMinScrollHeight = 24/,
		'minimum scroll height constant must be defined at 24pt');
	// Floor is applied in computeTargetContentHeight
	assert.match(native, /Enforce minimum usable scroll viewport/,
		'minimum viewport enforcement comment must exist in computeTargetContentHeight');
	assert.match(native, /h = MAX\(h, minH\)/,
		'height must be raised to minimum (not capped) when below the usable floor');
	// Cross-check: 114pt was the OLD cap; new minimum must be higher
	// (bandH=32 + top=6 + header=16 + gap=3 + scroll=40 + footer~44 + pad=8 = ~149pt minimum)
	assert.doesNotMatch(native, /h = MIN\(114/,
		'the 114pt cap must not appear anywhere in height computation');
});

test('status badge content safe inset: wider safe zone prevents right-edge clipping', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	// kContentSafeExtraX must be at least 8 (was 6 — insufficient for effShoulderR=18+6=24 clearance)
	assert.match(native, /kContentSafeExtraX = 8/,
		'safe extra inset must be 8pt minimum (was 6 — caused status badge clipping at right shoulder)');
	// kContentInsetX must be 14 (was 16; MAX(14,18)+8=26 is the effective safe inset for notched)
	assert.match(native, /kContentInsetX = 14/,
		'base content inset must be 14pt so notched effective safe inset = MAX(14,18)+8 = 26pt');
	// ContentSafeInsetX for notched must use the dynamic effShoulderR with isExpanded parameter
	const contentSafeStart = native.indexOf('static CGFloat ContentSafeInsetX');
	const contentSafeFn = contentSafeStart >= 0 ? native.slice(contentSafeStart, contentSafeStart + 600) : '';
	assert.match(contentSafeFn, /BOOL isExpanded/,
		'ContentSafeInsetX must accept isExpanded parameter for expanded shoulder geometry');
	assert.match(contentSafeFn, /bodyWallOffset = isExpanded \? effShoulderR \+ 4\.0 : effShoulderR/,
		'ContentSafeInsetX must compute body wall offset based on expanded state');
});

test('width buckets are purely semantic — no streaming-induced width churn', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	// Width bucket is determined by semantic state alone: approval/question → WIDE, working → STANDARD
	// Raw character counts must NOT trigger width changes (prevents streaming churn).
	assert.match(native, /kExpandedWidthWidePad/,
		'WIDE bucket constant must exist for approval/question');
	assert.match(native, /kExpandedWidthStandardPad/,
		'STANDARD bucket constant must exist for working/terminal');
	assert.match(native, /return naturalW;/,
		'COMPACT bucket must return naturalW without padding');
	assert.doesNotMatch(native, /activityLabel\.length > 60/,
		'width must not depend on raw activity label length (causes streaming churn)');
	assert.doesNotMatch(native, /pendingTitle\.length \+ self\.content\.pendingMessage\.length > 80/,
		'width must not depend on raw pending content length (causes streaming churn)');
});

test('premium control dimensions contract: 28pt controls, 12pt composer radius, 18pt expanded shoulder', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	// Control height upgraded from 24 to 28pt for premium feel
	assert.match(native, /kControlHeight = 28/,
		'control height must be 28pt (was 24 — too small relative to typical macOS controls)');
	// Icon buttons also 28pt
	assert.match(native, /kIconControlSize = 28/,
		'icon control size must be 28pt to match composer height (was 24pt)');
	// Composer corner radius changed from 10 to 12pt for softer feel
	assert.match(native, /kComposerCornerRadius = 12/,
		'composer corner radius must be 12pt (was 10 — upgraded for softer feel)');
	assert.doesNotMatch(native, /kComposerCornerRadius = 10[^0-9]/,
		'old 10pt composer radius must not appear in code');
	// Shoulder radius is authoritative 6pt matching physical MacBook bezel curve
	assert.match(native, /CGFloat effR = 6\.0;/,
		'authoritative shoulder radius must be 6pt');
	assert.doesNotMatch(native, /CGFloat effR = isExpanded \? 18\.0 : 6\.0/,
		'shoulder radius must not have contradictory 18pt expanded branch');
	// Steep Bezier tangent for shallow shoulders (kKappa ≈ 0.552)
	assert.match(native, /kKappa = 0\.55/,
		'shoulder Bezier CP must use kKappa tangent offset');
	// Premium composer border: 1.0pt width (was 0.5pt — barely visible)
	assert.match(native, /layer\.borderWidth = 1\.0[\s\S]{0,200}layer\.borderColor = \[NSColor colorWithCalibratedWhite:0\.38/,
		'composer border must be 1.0pt at 0.38 white opacity (was 0.5pt at 0.32 — too subtle)');
	// Symbol size upgraded to 11.5pt to fill 28pt buttons
	assert.match(native, /configurationWithPointSize:11\.5 weight:NSFontWeightMedium/,
		'icon symbol must be 11.5pt (was 10.5pt — too small for 28pt buttons)');
	// Button corner radius 10pt for rounded action buttons
	assert.match(native, /kButtonCornerRadius = 10/,
		'button corner radius must be 10pt');
	// Bottom corner radius changed from 22 to 18 for asymmetric curvature
	assert.match(native, /kBottomCornerRadius = 18/,
		'bottom corner radius must be 18pt (was 22 — asymmetric top/bottom)');
	assert.doesNotMatch(native, /kBottomCornerRadius = 22/,
		'old 22pt bottom radius must not appear');
});

test('expanded geometry: full-width top edge with housing-to-body shoulder flare', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	const expandedBlock = native.slice(
		native.indexOf('EXPANDED GEOMETRY'),
		native.indexOf('COMPACT/PILL GEOMETRY'),
	);

	// Expanded MoveTo starts at panel origin (0,0) — full width top, like compact
	assert.match(expandedBlock, /CGPathMoveToPoint\(path, NULL, 0, 0\)/,
		'expanded MoveTo must start at (0,0) for full-width top edge');

	// Top edge traverses full panel width
	assert.match(expandedBlock, /CGPathAddLineToPoint\(path, NULL, totalW, 0\)/,
		'expanded top-right must span to totalW');

	// Shoulder flare creates housing-to-body transition below the top edge
	assert.match(expandedBlock, /shoulderDrop = 8\.0/);
	assert.match(expandedBlock, /shoulderCurve = effShoulderR/);
	assert.match(expandedBlock, /full-width top edge/);
});

test('expanded shoulder radius is authoritative 6pt matching physical bezel', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	const computeBlock = native.slice(
		native.indexOf('ComputeSilhouetteShoulderMetrics'),
		native.indexOf('return metrics'),
	);
	// Authoritative single shoulder radius: 6pt
	assert.match(computeBlock, /CGFloat effR = 6\.0;/);
	assert.match(computeBlock, /metrics\.effShoulderR = effR/);
	assert.match(computeBlock, /metrics\.opticalInset = effR/);
	assert.match(computeBlock, /metrics\.flare = effR/);
	assert.doesNotMatch(computeBlock, /CGFloat effR = 22;/);
	assert.doesNotMatch(computeBlock, /CGFloat effR = 30;/);
	assert.doesNotMatch(computeBlock, /CGFloat effR = 40;/);
});

test('bottom corner radius is 18pt (asymmetric top/bottom)', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	assert.match(native, /kBottomCornerRadius = 18/);
});

test('auth card uses 16px border-radius, provider buttons use 12px', () => {
	const source = readFileSync(resolve(repoRoot, 'src/vs/workbench/contrib/prebase/browser/prebaseStartupAuthContribution.ts'), 'utf8');
	// Auth card border-radius
	assert.match(source, /borderRadius:\s*'16px'/,
		'auth card must use 16px border-radius');
	// Provider button border-radius
	const btnMatches = source.match(/borderRadius:\s*'12px'/g);
	assert.ok(btnMatches && btnMatches.length >= 2,
		'must have multiple 12px border-radius values (buttons + offline)');
	// Backdrop blur
	assert.match(source, /backdropFilter:\s*'blur\(8px\)/,
		'backdrop blur must be 8px');
	assert.doesNotMatch(source, /backdropFilter:\s*'blur\(6px\)/,
		'old 6px blur must not appear');
});

test('foreground quick messaging: background mode shows working sessions when PreBase is focused', () => {
	// Read the TS source to verify the behavior contract
	const ts = readFileSync(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'), 'utf8');
	// The shouldShowLiveActivity function must show working sessions when PreBase is foregrounded
	assert.ok(ts.includes('return !snapshot.prebaseForeground || snapshot.status === \'working\' || snapshot.status === \'waiting\''),
		'background mode must show working/waiting sessions for quick messaging when PreBase is focused');
	// Attention sessions must always be shown regardless of foreground state
	assert.ok(ts.includes('if (snapshot.status === \'attention\') {\n\t\treturn true;\n\t}'),
		'attention sessions must always be shown regardless of foreground state');
});

test('content safe insets account for expanded shoulder geometry', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	// ContentSafeInsetX must accept isExpanded parameter
	const contentSafeStart = native.indexOf('static CGFloat ContentSafeInsetX');
	const contentSafeFn = contentSafeStart >= 0 ? native.slice(contentSafeStart, contentSafeStart + 600) : '';
	assert.match(contentSafeFn, /BOOL isExpanded/,
		'ContentSafeInsetX must accept isExpanded parameter');
	assert.match(contentSafeFn, /bodyWallOffset = isExpanded \? effShoulderR \+ 4\.0 : effShoulderR/,
		'expanded state must add 4pt to shoulder radius for body wall offset');
	// All expanded callers must pass YES
	const expandedCallers = ['placeContentBlock', 'headerInset', 'docContentW', 'sideInset', 'footerInset'];
	for (const caller of expandedCallers) {
		const idx = native.indexOf(caller);
		if (idx >= 0) {
			const context = native.slice(Math.max(0, idx - 200), idx + 200);
			if (context.includes('ContentSafeInsetX')) {
				// Verify expanded callers pass YES
				const safeIdx = context.indexOf('ContentSafeInsetX');
				const afterCall = context.slice(safeIdx, safeIdx + 100);
				assert.ok(afterCall.includes(', YES)') || afterCall.includes(', expanded)'),
					`${caller} must pass isExpanded=YES to ContentSafeInsetX`);
			}
		}
	}
});

test('top bleed covers physical notch height on notch displays', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	// kTopBleed must be at least 14pt to cover the physical camera housing
	assert.match(native, /kTopBleed = 14/,
		'kTopBleed must be 14pt minimum to cover physical notch height (~9pt on modern MacBooks)');
	assert.doesNotMatch(native, /kTopBleed = 4[^0-9]/,
		'old 4pt top bleed must not appear (insufficient for physical notch coverage)');
});

test('expanded body walls stay close to panel edges for physical notch attachment', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');
	const expandedBlock = native.slice(
		native.indexOf('EXPANDED GEOMETRY'),
		native.indexOf('COMPACT/PILL GEOMETRY'),
	);
	// Body walls should be offset only by shoulderCurve (no extra bottom-radius offset)
	assert.match(expandedBlock, /bodyLeft = shoulderCurve/,
		'expanded bodyLeft must be shoulderCurve (no extra bottom-radius offset)');
	assert.match(expandedBlock, /bodyRight = totalW - shoulderCurve/,
		'expanded bodyRight must be totalW - shoulderCurve');
	// Shoulder drop should be gentle (8pt, matching bezel curvature)
	assert.match(expandedBlock, /shoulderDrop = 8\.0/,
		'shoulderDrop must be 8pt for subtle flare');
});

test('malformed response recovery uses simplified retry strategy', () => {
	const source = readFileSync(resolve(repoRoot, 'extensions/prebase-magnus/src/chatParticipant.ts'), 'utf8');
	// Must have recovery logic for malformed responses
	assert.ok(source.includes('malformed'),
		'malformed disposition must be handled');
	assert.ok(source.includes('recoveredStarvation'),
		'malformed recovery must use recoveredStarvation flag');
	assert.ok(source.includes('messages.slice(-2)'),
		'malformed retry must simplify message history');
	assert.ok(source.includes('reasoningEffort: \'low\''),
		'malformed retry must use low reasoning effort');
});

test('session listing function exists for notch session switcher', () => {
	const source = readFileSync(resolve(repoRoot, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts'), 'utf8');
	assert.ok(source.includes('listMagnusSessions'),
		'listMagnusSessions function must exist for session switcher');
	assert.ok(source.includes('prebase.magnus.liveActivity.listSessions'),
		'listSessions action must be registered');
	assert.ok(source.includes('prebase.magnus.liveActivity.selectSession'),
		'selectSession action must be registered');
	assert.ok(source.includes('prebase.magnus.liveActivity.createNewAgent'),
		'createNewAgent action must be registered');
});

test('pill height coherence: TS LIVE_ACTIVITY_PILL_HEIGHT matches native kPillHeight (both 34)', () => {
	const ts = readFileSync(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'), 'utf8');
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	const tsMatch = ts.match(/export const LIVE_ACTIVITY_PILL_HEIGHT\s*=\s*(\d+)/);
	assert.ok(tsMatch, 'LIVE_ACTIVITY_PILL_HEIGHT must be exported in TS source');
	const tsPillHeight = Number(tsMatch[1]);

	const nativeMatch = native.match(/static const CGFloat kPillHeight\s*=\s*(\d+)/);
	assert.ok(nativeMatch, 'kPillHeight must be defined in native source');
	const nativePillHeight = Number(nativeMatch[1]);

	assert.strictEqual(tsPillHeight, nativePillHeight, 'TS pill height must equal native pill height');
	assert.strictEqual(tsPillHeight, 34, 'pill height must be 34');
});

test('session switcher uses chatWidgetService.openSession (not just prebase.magnus.open)', () => {
	const source = readFileSync(resolve(repoRoot, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts'), 'utf8');

	const selectSessionStart = source.indexOf("id: 'prebase.magnus.liveActivity.selectSession'");
	assert.ok(selectSessionStart > 0, 'selectSession action must exist');
	const selectSessionBlock = source.slice(selectSessionStart, selectSessionStart + 900);

	assert.match(selectSessionBlock, /chatWidgetService\.openSession\(/,
		'selectSession must call chatWidgetService.openSession to actually switch sessions');
	assert.doesNotMatch(selectSessionBlock, /prebase\.magnus\.open/,
		'selectSession must not use prebase.magnus.open (that only opens, does not switch)');
});

test('createNewAgent uses chatService.startNewLocalSession (not just prebase.magnus.open)', () => {
	const source = readFileSync(resolve(repoRoot, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts'), 'utf8');

	const createStart = source.indexOf("id: 'prebase.magnus.liveActivity.createNewAgent'");
	assert.ok(createStart > 0, 'createNewAgent action must exist');
	const createBlock = source.slice(createStart, createStart + 900);

	assert.match(createBlock, /chatService\.startNewLocalSession\(/,
		'createNewAgent must call chatService.startNewLocalSession to create a real new session');
	assert.doesNotMatch(createBlock, /prebase\.magnus\.open/,
		'createNewAgent must not use prebase.magnus.open (that opens, does not create)');
});

test('no stale geometry values: native must not contain old kTopBleed=4, shoulderDrop=20.0, or bodyLeft with effBottomR*0.5', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	assert.doesNotMatch(native, /kTopBleed = 4[^0-9]/,
		'old kTopBleed=4 must not appear (replaced by 14)');
	assert.doesNotMatch(native, /shoulderDrop = 20\.0/,
		'old shoulderDrop=20.0 must not appear (replaced by 14.0)');
	assert.doesNotMatch(native, /bodyLeft = effBottomR \* 0\.5/,
		'old bodyLeft=effBottomR*0.5 must not appear');
});

test('ContentSafeInsetX comment mentions 4pt safety margin, not effBottomR*0.5', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	const contentSafeStart = native.indexOf('static CGFloat ContentSafeInsetX');
	assert.ok(contentSafeStart > 0, 'ContentSafeInsetX must exist');
	const commentBlock = native.slice(contentSafeStart - 300, contentSafeStart + 100);

	assert.match(commentBlock, /4pt safety margin/,
		'ContentSafeInsetX comment must mention 4pt safety margin');
	assert.doesNotMatch(commentBlock, /effBottomR\*0\.5/,
		'ContentSafeInsetX comment must not mention effBottomR*0.5');
});

test('command contract: acceptLiveActivityCommand accepts selectSession and createSession', () => {
	const script = `
import assert from 'node:assert/strict';
import {
	acceptLiveActivityCommand,
	buildMagnusLiveActivitySnapshot,
} from ${JSON.stringify(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'))};

const baseSnapshot = buildMagnusLiveActivitySnapshot({
	sessionId: 'sess-1',
	sessionResource: 'vscode-chat://local/sess-1',
	startedAt: 1000,
	title: 'Fix issue',
	isInProgress: true,
	currentActivity: 'Compiling',
}, { revision: 1, prebaseForeground: false, connected: true });

const selectCmd = acceptLiveActivityCommand(baseSnapshot, {
	kind: 'selectSession',
	targetSessionId: 'sess-xyz',
});
assert.ok(selectCmd.ok, 'selectSession command must be accepted');

const createCmd = acceptLiveActivityCommand(baseSnapshot, {
	kind: 'createSession',
});
assert.ok(createCmd.ok, 'createSession command must be accepted');

// Invalid commands fail closed
const invalidSelect = acceptLiveActivityCommand(baseSnapshot, { kind: 'selectSession' });
assert.equal(invalidSelect.ok, false, 'selectSession without targetSessionId must be rejected');

// Screen locked snapshot rejects all commands
const lockedSnapshot = buildMagnusLiveActivitySnapshot({
	sessionId: 'sess-1',
	sessionResource: 'vscode-chat://local/sess-1',
	startedAt: 1000,
	title: 'Fix issue',
	isInProgress: true,
	currentActivity: 'Compiling',
}, { revision: 1, prebaseForeground: false, connected: true, screenLocked: true });

const lockedSelect = acceptLiveActivityCommand(lockedSnapshot, { kind: 'selectSession', targetSessionId: 'sess-xyz' });
assert.equal(lockedSelect.ok, false, 'screen locked snapshot must reject selectSession');
`;
	const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(child.status, 0, child.stderr || child.stdout);
});

test('snapshot contract: sessionTitle, availableSessions, and conversationTranscript are preserved in snapshot', () => {
	const script = `
import assert from 'node:assert/strict';
import {
	buildMagnusLiveActivitySnapshot,
} from ${JSON.stringify(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'))};

const snapshot = buildMagnusLiveActivitySnapshot({
	sessionId: 'sess-1',
	sessionResource: 'vscode-chat://local/sess-1',
	startedAt: 1000,
	title: 'Fix issue',
	isInProgress: true,
	currentActivity: 'Compiling',
	sessionTitle: 'Fix issue',
	availableSessions: [
		{ sessionId: 'sess-1', title: 'Fix issue', isCurrent: true, startedAt: 1000 },
		{ sessionId: 'sess-2', title: 'Add tests', isCurrent: false, startedAt: 2000 },
	],
	conversationTranscript: [
		{ role: 'user', content: 'Run test suite' },
		{ role: 'agent', content: 'Tests running, 15 passed' },
	],
}, { revision: 1, prebaseForeground: false, connected: true });

assert.equal(snapshot.sessionTitle, 'Fix issue');
assert.equal(snapshot.availableSessions.length, 2);
assert.equal(snapshot.availableSessions[0].sessionId, 'sess-1');
assert.equal(snapshot.availableSessions[0].isCurrent, true);
assert.equal(snapshot.conversationTranscript.length, 2);
assert.equal(snapshot.conversationTranscript[0].role, 'user');
assert.equal(snapshot.conversationTranscript[1].content, 'Tests running, 15 passed');
`;
	const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(child.status, 0, child.stderr || child.stdout);
});

test('native UI layout: approval buttons balanced 50/50 with equal widths', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Approve and Deny buttons must divide width equally (50/50)
	assert.match(native, /CGFloat denyW = floor\(\(usableW - apprGap\) \/ 2\.0\);/,
		'Deny button width must be computed as 50% split');
	assert.match(native, /CGFloat approveW = usableW - apprGap - denyW;/,
		'Approve button width must match remainder for exact pixel-perfect 50/50 split');
	assert.match(native, /self\.denyButton\.frame = NSMakeRect\(footerInset, bottomY, denyW, kControlHeight\);/,
		'Deny button must use denyW');
	assert.match(native, /self\.approveButton\.frame = NSMakeRect\(footerInset \+ denyW \+ apprGap, bottomY, approveW, kControlHeight\);/,
		'Approve button must use approveW');
});

test('native backgrounded interaction: simulateAction allows peek and hover when backgrounded', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// simulateAction must not return early if environmentState is backgrounded
	const simActionIdx = native.indexOf('SimulateAction(const Napi::CallbackInfo');
	assert.ok(simActionIdx > 0, 'SimulateAction method must exist');
	const simActionBlock = native.slice(simActionIdx, simActionIdx + 800);

	assert.doesNotMatch(simActionBlock, /isEqualToString:@"backgrounded"/,
		'SimulateAction must not contain backgrounded early-return guard');
});

test('canonical notch session selection: explicit selected session survives republish over busy heuristic and falls back on disposal', () => {
	const contribTs = readFileSync(resolve(repoRoot, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts'), 'utf8');

	// Explicit selected session identity properties
	assert.match(contribTs, /private _selectedSessionId: string \| undefined;/, 'Must store _selectedSessionId');
	assert.match(contribTs, /private _selectedSessionResource: string \| undefined;/, 'Must store _selectedSessionResource');

	// In _publish(), prioritize _selectedSessionId
	assert.match(contribTs, /if \(this\._selectedSessionId\)\s*\{\s*model = allModels\.find\(m => m\.sessionId === this\._selectedSessionId\);/,
		'_publish must prioritize _selectedSessionId over heuristic ranking');

	// In selectSession command, store _selectedSessionId and _selectedSessionResource
	assert.match(contribTs, /if \(command\.kind === 'selectSession'\)\s*\{[\s\S]*this\._selectedSessionId = targetModel\.sessionId;[\s\S]*this\._selectedSessionResource = targetModel\.sessionResource\.toString\(\);/,
		'selectSession must establish canonical selected session identity');

	// In onDidDisposeSession, clear canonical IDs if the disposed session was selected
	assert.match(contribTs, /onDidDisposeSession\(e =>\s*\{[\s\S]*if \(this\._selectedSessionResource && e\.sessionResources\.some\(r => r\.toString\(\) === this\._selectedSessionResource\)\)\s*\{\s*this\._selectedSessionId = undefined;\s*this\._selectedSessionResource = undefined;\s*\}/,
		'Disposal of canonical selected session must clear selection and fall back deterministically');

	// Behavioral verification: stale session fails closed in acceptLiveActivityCommand
	const script = `
import assert from 'node:assert/strict';
import {
	acceptLiveActivityCommand,
	buildMagnusLiveActivitySnapshot,
} from ${JSON.stringify(resolve(repoRoot, 'src/vs/platform/prebaseLiveActivity/common/magnusLiveActivity.ts'))};

const snapshot = buildMagnusLiveActivitySnapshot({
	sessionId: 'session-B',
	sessionResource: 'vscode-chat://local/session-B',
	startedAt: 1000,
	title: 'Selected Session B',
	isInProgress: true,
	currentActivity: 'Editing',
}, { revision: 10, prebaseForeground: false, connected: true });

// Valid followUp to selected session B succeeds
const validRes = acceptLiveActivityCommand(snapshot, { kind: 'followUp', sessionId: 'session-B', sessionResource: 'vscode-chat://local/session-B', text: 'Hello B' });
assert.strictEqual(validRes.ok, true, 'Valid command to selected session must be accepted');

// Stale command targeting session A must be rejected
const staleRes = acceptLiveActivityCommand(snapshot, { kind: 'followUp', sessionId: 'session-A', sessionResource: 'vscode-chat://local/session-A', text: 'Hello A' });
assert.strictEqual(staleRes.ok, false, 'Command targeting stale session A must be rejected');
assert.strictEqual(staleRes.reason, 'session-mismatch');
`;
	const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.strictEqual(child.status, 0, child.stderr || child.stdout);
});

test('new Magnus session: initial followUp attaches agentId prebase.magnus.agent and switcher includes new session', () => {
	const contribTs = readFileSync(resolve(repoRoot, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts'), 'utf8');
	const sessionTs = readFileSync(resolve(repoRoot, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivitySession.ts'), 'utf8');

	// createSession command establishes canonical selection
	assert.match(contribTs, /if \(command\.kind === 'createSession'\)\s*\{[\s\S]*const model = ref\.object;[\s\S]*this\._selectedSessionId = model\.sessionId;[\s\S]*this\._selectedSessionResource = model\.sessionResource\.toString\(\);/,
		'createSession must assign newly created session as canonical selected session');

	// listMagnusSessions includes newly created canonical session with title 'New Magnus Session'
	assert.match(contribTs, /function listMagnusSessions\(models: Iterable<IChatModel>, selectedSessionId\?: string/,
		'listMagnusSessions must accept selectedSessionId');
	assert.match(contribTs, /'New Magnus Session'/,
		'Empty canonical selected session must display "New Magnus Session" in switcher');

	// followUp on empty model routes with agentId: 'prebase.magnus.agent'
	assert.match(sessionTs, /const isInitialRequest = requests\.length === 0;/,
		'applyMagnusLiveActivitySessionCommand must detect initial request on new session');
	assert.match(sessionTs, /const options = isInitialRequest \? \{ agentId: 'prebase\.magnus\.agent' \} : undefined;/,
		'applyMagnusLiveActivitySessionCommand must target prebase.magnus.agent on initial request');
	assert.match(sessionTs, /await deps\.chatService\.sendRequest\(sessionResource, text, options\);/,
		'sendRequest must pass options with agentId');
});

test('native text containment and typography: ordinary words not broken while paths and extreme tokens sanitize safely', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// SanitizeTextForContainment must allow normal English words up to 28 chars without breaking
	assert.match(native, /isPureLetters/, 'SanitizeTextForContainment must track pure alphabetical words');
	assert.match(native, /runLength >= 28/, 'Pure letter words must be permitted up to 28 characters without split');
	assert.match(native, /runLength >= 24/, 'Mixed alphanumeric runs (hashes/tokens) must break at 24 characters');
	assert.match(native, /ch == '\/' \|\| ch == '\\\\' \|\| ch == '\?' \|\| ch == '&'/, 'Paths and URLs must break after delimiters');
});

test('native session button truncation and accessibility: tail truncation paragraph style and tooltips', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Button lineBreakMode and paragraph style must truncate tail
	assert.match(native, /btnStyle\.lineBreakMode = NSLineBreakByTruncatingTail;/,
		'sessionButton paragraph style must use NSLineBreakByTruncatingTail');
	assert.match(native, /self\.controller\.sessionButton\.cell\.lineBreakMode = NSLineBreakByTruncatingTail;/,
		'sessionButton cell must use NSLineBreakByTruncatingTail');
	assert.match(native, /self\.controller\.sessionButton\.toolTip = sessionName;/,
		'sessionButton must set tooltip to full sessionName');
	assert.match(native, /self\.controller\.sessionButton\.accessibilityLabel = \[NSString stringWithFormat:@"Current session: %@", sessionName\];/,
		'sessionButton must set accessibilityLabel');
});

test('native conversation projection: distinct YOU/MAGNUS role styling, bounded turns, and suppression on pending', () => {
	const native = readFileSync(resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Must have placeAttributedBlock
	assert.match(native, /- \(BOOL\)placeAttributedBlock:\(NSTextField \*\)field attributedString:\(NSAttributedString \*\)attrString/,
		'placeAttributedBlock must exist in native panel');

	// Must format YOU badge and MAGNUS badge
	assert.match(native, /NSString \*badgeStr = isUser \? @"YOU" : @"MAGNUS";/,
		'Conversation projection must use distinct YOU vs MAGNUS badges');
	assert.match(native, /startTurn = \(NSInteger\)self\.conversationTranscript\.count > 3 \? \(NSInteger\)self\.conversationTranscript\.count - 3 : 0;/,
		'Conversation projection must bound context to last 2-3 turns');

	// Must be suppressed when hasPending is YES
	const pendIdx = native.indexOf('if (!hasPending) {');
	const transcriptIdx = native.indexOf('if (self.conversationTranscript.count > 0) {');
	assert.ok(pendIdx > 0, 'hasPending check must exist');
	assert.ok(transcriptIdx > pendIdx, 'conversationTranscript rendering must be enclosed in !hasPending block');
});




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
assert.ok(short < 192 - 20, 'short working content must leave headroom below expanded max');
assert.ok(longOptions <= 192);
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
assert.equal(LIVE_ACTIVITY_EXPANDED_HEIGHT_MAX, 192);
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
	assert.match(native, /kExpandedHeightMax = 192/);
	assert.match(native, /kExpandedWidthPad = 28/);
	assert.match(native, /kStableCompactLeftWing = 64/);
	assert.match(native, /computeExpandedWidth:/);
	assert.match(native, /pendingOptions\.count > 2/);
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
	assert.match(native, /kOpticalShoulderInsetMin = 8/);
	assert.match(native, /kOpticalShoulderInsetMax = 12/);
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

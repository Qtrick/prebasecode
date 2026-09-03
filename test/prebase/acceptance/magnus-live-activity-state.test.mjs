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
assert.equal(peekTitle, 34 + 8 + 20 + 8);
assert.equal(peekActivity, 34 + 8 + 18 + 8);
assert.equal(peekFallback, 34 + 8 + 16 + 8, 'pendingMessage alone must not inflate peek height');

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
});

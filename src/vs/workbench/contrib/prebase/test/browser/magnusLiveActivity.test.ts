/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../../base/test/common/utils.js";
import assert from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
	acceptLiveActivityCommand,
	buildMagnusLiveActivitySnapshot,
	collapsedStatusLabel,
	deriveLiveActivityGeometry,
	deriveMagnusTestStateFromInvocations,
	formatDiffMetric,
	isMagnusParticipantId,
	selectPrimaryMagnusSession,
	summarizeMagnusWorkspaceDiff,
	LIVE_ACTIVITY_EXIT_GRACE_MS,
	LIVE_ACTIVITY_HOVER_OPEN_DELAY_MS,
	LIVE_ACTIVITY_MAX_ACTIONS,
	LIVE_ACTIVITY_MAX_MESSAGE_CHARS,
	redactLiveActivityText,
	resolveLiveActivityPanelState,
	shouldShowLiveActivity,
	type MagnusLiveActivitySessionInput,
} from '../../../../../platform/prebaseLiveActivity/common/magnusLiveActivity.js';

function session(partial: Partial<MagnusLiveActivitySessionInput> = {}): MagnusLiveActivitySessionInput {
	return {
		sessionId: 'sess-1',
		sessionResource: 'vscode-chat://local/sess-1',
		startedAt: 1_000,
		title: 'Fix graph',
		isInProgress: true,
		currentActivity: 'Reading graphEditor.ts',
		recentActions: [{ id: 't1', label: 'Reading graphEditor.ts', at: 1_100 }],
		...partial,
	};
}

function readRepo(relativePath: string): string {
	return readFileSync(resolve(relativePath), 'utf8');
}

suite('Magnus Live Activity projection', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('is a projection of Magnus participants only', () => {
		assert.strictEqual(isMagnusParticipantId('prebase.magnus.agent'), true);
		assert.strictEqual(isMagnusParticipantId('github.copilot'), false);
		assert.strictEqual(isMagnusParticipantId(undefined), false);
		assert.strictEqual(isMagnusParticipantId('prebase.magnus'), false);
	});

	test('busy Magnus session wins over a newer idle Magnus session; non-Magnus is ignored', () => {
		const copilot = { id: 'copilot', isMagnus: false, isBusy: true, lastMessageDate: 9_000 };
		const idleNewer = { id: 'idle', isMagnus: true, isBusy: false, lastMessageDate: 8_000 };
		const busyOlder = { id: 'busy', isMagnus: true, isBusy: true, lastMessageDate: 1_000 };
		assert.strictEqual(selectPrimaryMagnusSession([copilot, idleNewer, busyOlder])?.id, 'busy');
		assert.strictEqual(selectPrimaryMagnusSession([copilot, idleNewer])?.id, 'idle');
		assert.strictEqual(selectPrimaryMagnusSession([copilot]), undefined);
	});

	test('snapshot keeps the same session id and resource', () => {
		const snap = buildMagnusLiveActivitySnapshot(session(), { revision: 3, prebaseForeground: false, connected: true });
		assert.strictEqual(snap.sessionId, 'sess-1');
		assert.strictEqual(snap.sessionResource, 'vscode-chat://local/sess-1');
		assert.strictEqual(snap.revision, 3);
		assert.strictEqual(snap.status, 'working');
	});

	test('stale revision and stale approval fail closed', () => {
		const snap = buildMagnusLiveActivitySnapshot(session({
			pendingInteraction: { kind: 'approval', interactionId: 'tool-9', title: 'Delete file?', message: 'Remove obsolete.ts' },
			needsInput: true,
			isInProgress: true,
		}), { revision: 4, prebaseForeground: false, connected: true });
		assert.strictEqual(snap.status, 'attention');
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'approve', interactionId: 'tool-9', revision: 3 }), { ok: false, reason: 'stale-revision' });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'approve', interactionId: 'tool-8', revision: 4 }), { ok: false, reason: 'stale-interaction' });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'approve', interactionId: 'tool-9', revision: 4 }), { ok: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'followUp', sessionId: 'other', text: 'hello', revision: 4 }), { ok: false, reason: 'session-mismatch' });
	});

	test('follow-up is accepted only for the canonical session', () => {
		const snap = buildMagnusLiveActivitySnapshot(session(), { revision: 1, prebaseForeground: false, connected: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'followUp', sessionId: 'sess-1', sessionResource: snap.sessionResource, text: 'Also keep keyboard selection', revision: 1 }), { ok: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'followUp', sessionId: 'sess-1', text: '   ', revision: 1 }), { ok: false, reason: 'empty-message' });
	});

	test('follow-up with a different sessionResource fails closed', () => {
		const snap = buildMagnusLiveActivitySnapshot(session(), { revision: 2, prebaseForeground: false, connected: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, {
			kind: 'followUp',
			sessionId: 'sess-1',
			sessionResource: 'vscode-chat://local/sess-other',
			text: 'continue on the other chat',
			revision: 2,
		}), { ok: false, reason: 'session-mismatch' });
	});

	test('omitted revision is accepted; a newer snapshot revision is not', () => {
		const snap = buildMagnusLiveActivitySnapshot(session(), { revision: 7, prebaseForeground: false, connected: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'followUp', sessionId: 'sess-1', text: 'keep going' }), { ok: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'followUp', sessionId: 'sess-1', text: 'keep going', revision: 8 }), { ok: false, reason: 'stale-revision' });
	});

	test('idle snapshot has no session and rejects follow-up', () => {
		const snap = buildMagnusLiveActivitySnapshot(undefined, { revision: 1, prebaseForeground: false, connected: true });
		assert.strictEqual(snap.status, 'idle');
		assert.strictEqual(snap.sessionId, undefined);
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'followUp', text: 'hello', revision: 1 }), { ok: false, reason: 'no-session' });
	});

	test('approve/deny/answer fail closed when the pending kind does not match', () => {
		const question = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'question', interactionId: 'q-1', title: 'Which file?', message: 'Pick one', options: [{ id: 'a', label: 'A' }] },
		}), { revision: 1, prebaseForeground: false, connected: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(question, { kind: 'approve', interactionId: 'q-1', revision: 1 }), { ok: false, reason: 'not-an-approval' });
		assert.deepStrictEqual(acceptLiveActivityCommand(question, { kind: 'answer', interactionId: 'q-1', revision: 1 }), { ok: false, reason: 'missing-option' });
		assert.deepStrictEqual(acceptLiveActivityCommand(question, { kind: 'answer', interactionId: 'q-1', optionId: 'nope', revision: 1 }), { ok: false, reason: 'stale-option' });
		assert.deepStrictEqual(acceptLiveActivityCommand(question, { kind: 'answer', interactionId: 'q-1', optionId: 'a', revision: 1 }), { ok: true });

		const approval = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'a-1', title: 'Run rm?', message: 'destructive' },
		}), { revision: 1, prebaseForeground: false, connected: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(approval, { kind: 'answer', interactionId: 'a-1', optionId: 'a', revision: 1 }), { ok: false, reason: 'not-a-question' });
		assert.deepStrictEqual(acceptLiveActivityCommand(approval, { kind: 'deny', interactionId: 'a-1', revision: 1 }), { ok: true });

		const none = buildMagnusLiveActivitySnapshot(session(), { revision: 1, prebaseForeground: false, connected: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(none, { kind: 'approve', interactionId: 'missing', revision: 1 }), { ok: false, reason: 'no-pending-interaction' });
	});

	test('openInPrebase/pin reject a mismatched session and accept when identity is omitted', () => {
		const snap = buildMagnusLiveActivitySnapshot(session(), { revision: 1, prebaseForeground: false, connected: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'openInPrebase', sessionId: 'sess-other', revision: 1 }), { ok: false, reason: 'session-mismatch' });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'pin', revision: 1 }), { ok: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'unpin', sessionId: 'sess-1', revision: 1 }), { ok: true });
	});

	test('background mode hides when PreBase is focused', () => {
		const working = buildMagnusLiveActivitySnapshot(session(), { revision: 1, prebaseForeground: true, connected: true });
		assert.strictEqual(shouldShowLiveActivity('background', working), false);
		const backgrounded = buildMagnusLiveActivitySnapshot(session(), { revision: 2, prebaseForeground: false, connected: true });
		assert.strictEqual(shouldShowLiveActivity('background', backgrounded), true);
		assert.strictEqual(shouldShowLiveActivity('off', backgrounded), false);
		assert.strictEqual(shouldShowLiveActivity('alwaysWorking', working), true);
		const attention = buildMagnusLiveActivitySnapshot(session({ needsInput: true, pendingInteraction: { kind: 'approval', interactionId: 'a', title: 'Approve', message: '' } }), { revision: 3, prebaseForeground: true, connected: true });
		assert.strictEqual(shouldShowLiveActivity('attentionOnly', attention), true);
		assert.strictEqual(shouldShowLiveActivity('attentionOnly', working), false);
	});

	test('in-progress without current activity is waiting; failed wins over pending input', () => {
		const waiting = buildMagnusLiveActivitySnapshot(session({ currentActivity: undefined, isInProgress: true }), { revision: 1, prebaseForeground: false, connected: true });
		assert.strictEqual(waiting.status, 'waiting');
		const failed = buildMagnusLiveActivitySnapshot(session({
			failed: true,
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'a', title: 'Approve', message: '' },
		}), { revision: 2, prebaseForeground: false, connected: true });
		assert.strictEqual(failed.status, 'failed');
	});

	test('hover delay and exit grace do not open instantly', () => {
		const snap = buildMagnusLiveActivitySnapshot(session(), { revision: 1, prebaseForeground: false, connected: true });
		assert.strictEqual(resolveLiveActivityPanelState({ visible: true, hovering: true, pinned: false, snapshot: snap, now: 100, hoverSince: 0, openDelayMs: 150 }), 'collapsed');
		assert.strictEqual(resolveLiveActivityPanelState({ visible: true, hovering: true, pinned: false, snapshot: snap, now: 160, hoverSince: 0, openDelayMs: 150 }), 'hoverPreview');
		assert.strictEqual(resolveLiveActivityPanelState({ visible: true, hovering: false, pinned: false, snapshot: snap, now: 200, lastInsideAt: 140, exitGraceMs: 100 }), 'hoverPreview');
		assert.strictEqual(resolveLiveActivityPanelState({ visible: true, hovering: false, pinned: false, snapshot: snap, now: 250, lastInsideAt: 140, exitGraceMs: 100 }), 'collapsed');
		assert.strictEqual(resolveLiveActivityPanelState({ visible: true, hovering: false, pinned: true, snapshot: snap, now: 400 }), 'pinned');
	});

	test('hover opens at the delay boundary and exit grace is exclusive', () => {
		const snap = buildMagnusLiveActivitySnapshot(session(), { revision: 1, prebaseForeground: false, connected: true });
		const openDelay = LIVE_ACTIVITY_HOVER_OPEN_DELAY_MS;
		const exitGrace = LIVE_ACTIVITY_EXIT_GRACE_MS;
		assert.strictEqual(resolveLiveActivityPanelState({ visible: true, hovering: true, pinned: false, snapshot: snap, now: openDelay - 1, hoverSince: 0, openDelayMs: openDelay }), 'collapsed');
		assert.strictEqual(resolveLiveActivityPanelState({ visible: true, hovering: true, pinned: false, snapshot: snap, now: openDelay, hoverSince: 0, openDelayMs: openDelay }), 'hoverPreview');
		assert.strictEqual(resolveLiveActivityPanelState({ visible: true, hovering: false, pinned: false, snapshot: snap, now: exitGrace - 1, lastInsideAt: 0, exitGraceMs: exitGrace }), 'hoverPreview');
		assert.strictEqual(resolveLiveActivityPanelState({ visible: true, hovering: false, pinned: false, snapshot: snap, now: exitGrace, lastInsideAt: 0, exitGraceMs: exitGrace }), 'collapsed');
	});

	test('attention and completed override hover; hidden wins over pinned', () => {
		const attention = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'a', title: 'Approve', message: '' },
		}), { revision: 1, prebaseForeground: false, connected: true });
		assert.strictEqual(resolveLiveActivityPanelState({
			visible: true, hovering: true, pinned: false, snapshot: attention, now: 0, hoverSince: 0, openDelayMs: 150,
		}), 'attention');

		const completed = buildMagnusLiveActivitySnapshot(session({ isInProgress: false, completed: true }), { revision: 2, prebaseForeground: false, connected: true });
		assert.strictEqual(resolveLiveActivityPanelState({
			visible: true, hovering: true, pinned: false, snapshot: completed, now: 500, hoverSince: 0,
		}), 'completedTransient');

		assert.strictEqual(resolveLiveActivityPanelState({
			visible: false, hovering: false, pinned: true, snapshot: attention, now: 0,
		}), 'hidden');
	});

	test('redacts secrets and never keeps raw env-looking values', () => {
		assert.ok(redactLiveActivityText('Authorization: Bearer sk-abc123456').includes('[redacted]'));
		assert.ok(!redactLiveActivityText('AIzaSyDummyKeyValue0123456789').includes('AIzaSy'));
	});

	test('masks password and api_key assignments and truncates long copy', () => {
		const password = redactLiveActivityText('password=hunter2 leftover');
		assert.match(password, /password=\[redacted\]/);
		assert.ok(!password.includes('hunter2'));

		const apiKey = redactLiveActivityText('api_key: super-secret-value');
		assert.match(apiKey, /api_key=\[redacted\]/);
		assert.ok(!apiKey.includes('super-secret-value'));

		const long = redactLiveActivityText('x'.repeat(LIVE_ACTIVITY_MAX_MESSAGE_CHARS + 40));
		assert.strictEqual(long.length, LIVE_ACTIVITY_MAX_MESSAGE_CHARS);
	});

	test('snapshot redacts pending interaction copy and caps recent actions', () => {
		const actions = Array.from({ length: LIVE_ACTIVITY_MAX_ACTIONS + 2 }, (_, i) => ({
			id: `t${i}`,
			label: `step ${i}`,
			at: 1_000 + i,
		}));
		const snap = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			recentActions: actions,
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'tool-secret',
				title: 'token=abc123xyz',
				message: 'password: hunter2',
			},
		}), { revision: 1, prebaseForeground: false, connected: true });
		assert.strictEqual(snap.recentActions.length, LIVE_ACTIVITY_MAX_ACTIONS);
		assert.strictEqual(snap.recentActions[0].id, 't2');
		assert.ok(!snap.pendingInteraction?.title.includes('abc123xyz'));
		assert.ok(!snap.pendingInteraction?.message.includes('hunter2'));
	});

	test('screen lock hides details while keeping session identity', () => {
		const snap = buildMagnusLiveActivitySnapshot(session({
			latestShortMessage: 'token=abc123xyz',
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'tool-9', title: 'Delete?', message: 'secret' },
		}), { revision: 4, prebaseForeground: false, connected: true, screenLocked: true });
		assert.strictEqual(snap.sessionId, 'sess-1');
		assert.strictEqual(snap.taskTitle, undefined);
		assert.strictEqual(snap.currentActivity, undefined);
		assert.strictEqual(snap.latestShortMessage, undefined);
		assert.deepStrictEqual(snap.recentActions, []);
		assert.strictEqual(snap.pendingInteraction, undefined);
	});

	test('notched geometry does not use a hardcoded MacBook model and no-notch uses a center pill', () => {
		const notched = deriveLiveActivityGeometry({
			width: 1512, height: 982, scaleFactor: 2,
			safeAreaTop: 32, auxLeftWidth: 620, auxRightWidth: 620, auxLeftHeight: 32, auxRightHeight: 32,
		});
		assert.strictEqual(notched.notched, true);
		assert.ok(notched.cameraHousingWidth > 24);
		assert.ok(notched.hit.width < 200, 'collapsed hit target must stay small');
		const pill = deriveLiveActivityGeometry({
			width: 1920, height: 1080, scaleFactor: 1,
			safeAreaTop: 0, auxLeftWidth: 0, auxRightWidth: 0, auxLeftHeight: 0, auxRightHeight: 0,
		});
		assert.strictEqual(pill.notched, false);
		assert.strictEqual(pill.cameraHousingWidth, 0);
		assert.strictEqual(pill.leftWing.width, 0);
		assert.strictEqual(pill.rightWing.width, 0);
		assert.ok(pill.pill.width < 300, 'no-notch fallback must not invent a giant fake notch');
		assert.ok(Math.abs(pill.pill.x - (1920 - pill.pill.width) / 2) < 1);
	});

	test('disconnected or one-sided display metrics fall back to a small center pill', () => {
		const gone = deriveLiveActivityGeometry({
			width: 0, height: 0, scaleFactor: 0,
			safeAreaTop: 0, auxLeftWidth: 0, auxRightWidth: 0, auxLeftHeight: 0, auxRightHeight: 0,
		});
		assert.strictEqual(gone.notched, false);
		assert.strictEqual(gone.cameraHousingWidth, 0);
		assert.ok(gone.pill.width < 300);

		const external = deriveLiveActivityGeometry({
			width: 3840, height: 2160, scaleFactor: 2,
			safeAreaTop: 25, auxLeftWidth: 0, auxRightWidth: 0, auxLeftHeight: 0, auxRightHeight: 0,
		});
		assert.strictEqual(external.notched, false);
		assert.strictEqual(external.cameraHousingWidth, 0);
		assert.ok(external.pill.width < 300);
		assert.ok(Math.abs(external.pill.x - (3840 - external.pill.width) / 2) < 1);

		const onesided = deriveLiveActivityGeometry({
			width: 1920, height: 1080, scaleFactor: 1,
			safeAreaTop: 32, auxLeftWidth: 900, auxRightWidth: 0, auxLeftHeight: 32, auxRightHeight: 0,
		});
		assert.strictEqual(onesided.notched, false);
		assert.strictEqual(onesided.cameraHousingWidth, 0);
		assert.ok(onesided.pill.width < 300);
	});

	test('borderline safe-area metrics fall back to the center pill', () => {
		const borderline = deriveLiveActivityGeometry({
			width: 1512, height: 982, scaleFactor: 0,
			safeAreaTop: 8, auxLeftWidth: 40, auxRightWidth: 40, auxLeftHeight: 8, auxRightHeight: 8,
		});
		assert.strictEqual(borderline.notched, false);
		assert.strictEqual(borderline.cameraHousingWidth, 0);
		assert.ok(Math.abs(borderline.pill.x - (1512 - borderline.pill.width) / 2) < 1);
	});

	test('disconnected snapshot is labeled unavailable and rejects commands', () => {
		const snap = buildMagnusLiveActivitySnapshot(session(), { revision: 9, prebaseForeground: false, connected: false });
		assert.strictEqual(snap.status, 'disconnected');
		assert.strictEqual(collapsedStatusLabel(snap), 'Magnus status unavailable');
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'followUp', text: 'hi', revision: 9 }), { ok: false, reason: 'disconnected' });
	});

	test('disconnected snapshot drops stale activity and is never shown', () => {
		const snap = buildMagnusLiveActivitySnapshot(session({
			currentActivity: 'Writing secrets.ts',
			latestShortMessage: 'password=hunter2',
			recentActions: [{ id: 't1', label: 'token=abc', at: 1 }],
		}), { revision: 9, prebaseForeground: false, connected: false });
		assert.strictEqual(snap.sessionId, 'sess-1');
		assert.strictEqual(snap.currentActivity, undefined);
		assert.strictEqual(snap.latestShortMessage, undefined);
		assert.deepStrictEqual(snap.recentActions, []);
		assert.strictEqual(shouldShowLiveActivity('alwaysWorking', snap), false);
		assert.strictEqual(shouldShowLiveActivity('background', snap), false);
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'approve', interactionId: 'anything', revision: 9 }), { ok: false, reason: 'disconnected' });
	});

	test('reconnect restores working status on the same session', () => {
		const input = session();
		const down = buildMagnusLiveActivitySnapshot(input, { revision: 10, prebaseForeground: false, connected: false });
		assert.strictEqual(down.status, 'disconnected');
		const up = buildMagnusLiveActivitySnapshot(input, { revision: 11, prebaseForeground: false, connected: true });
		assert.strictEqual(up.status, 'working');
		assert.strictEqual(up.sessionId, 'sess-1');
		assert.strictEqual(up.sessionResource, input.sessionResource);
		assert.strictEqual(up.revision, 11);
		assert.strictEqual(shouldShowLiveActivity('background', up), true);
	});

	test('snapshot revisions are monotonic and a stale revision fails closed after reconnect', () => {
		const input = session();
		const first = buildMagnusLiveActivitySnapshot(input, { revision: 4, prebaseForeground: false, connected: true });
		const down = buildMagnusLiveActivitySnapshot(input, { revision: 5, prebaseForeground: false, connected: false });
		const up = buildMagnusLiveActivitySnapshot(input, { revision: 6, prebaseForeground: false, connected: true });
		assert.ok(first.revision < down.revision);
		assert.ok(down.revision < up.revision);
		assert.strictEqual(up.sessionId, first.sessionId);
		assert.strictEqual(up.sessionResource, first.sessionResource);
		assert.deepStrictEqual(acceptLiveActivityCommand(up, { kind: 'followUp', sessionId: 'sess-1', text: 'continue', revision: 4 }), { ok: false, reason: 'stale-revision' });
		assert.deepStrictEqual(acceptLiveActivityCommand(up, { kind: 'followUp', sessionId: 'sess-1', text: 'continue', revision: 5 }), { ok: false, reason: 'stale-revision' });
		assert.deepStrictEqual(acceptLiveActivityCommand(up, { kind: 'followUp', sessionId: 'sess-1', text: 'continue', revision: 6 }), { ok: true });
	});

	test('screen lock and hideDetails strip pending interaction so approvals fail closed', () => {
		const input = session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'tool-9', title: 'Delete?', message: 'secret' },
		});
		const locked = buildMagnusLiveActivitySnapshot(input, { revision: 4, prebaseForeground: false, connected: true, screenLocked: true });
		assert.strictEqual(locked.status, 'attention');
		assert.strictEqual(locked.pendingInteraction, undefined);
		assert.deepStrictEqual(acceptLiveActivityCommand(locked, { kind: 'approve', interactionId: 'tool-9', revision: 4 }), { ok: false, reason: 'no-pending-interaction' });
		assert.deepStrictEqual(acceptLiveActivityCommand(locked, { kind: 'followUp', sessionId: 'sess-1', text: 'go', revision: 4 }), { ok: true });
	});

	test('follow-up with a matching resource but a different sessionId fails closed', () => {
		const snap = buildMagnusLiveActivitySnapshot(session(), { revision: 2, prebaseForeground: false, connected: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, {
			kind: 'followUp',
			sessionId: 'sess-other',
			sessionResource: snap.sessionResource,
			text: 'continue',
			revision: 2,
		}), { ok: false, reason: 'session-mismatch' });
	});

	test('deny without an interaction id is stale; disconnected rejects pin', () => {
		const approval = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'a-1', title: 'Run rm?', message: 'destructive' },
		}), { revision: 1, prebaseForeground: false, connected: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(approval, { kind: 'deny', revision: 1 }), { ok: false, reason: 'stale-interaction' });

		const down = buildMagnusLiveActivitySnapshot(session(), { revision: 2, prebaseForeground: false, connected: false });
		assert.deepStrictEqual(acceptLiveActivityCommand(down, { kind: 'pin', revision: 2 }), { ok: false, reason: 'disconnected' });
	});

	test('idle Magnus sessions are not shown even when a session id remains', () => {
		const idle = buildMagnusLiveActivitySnapshot(session({ isInProgress: false, completed: false }), { revision: 1, prebaseForeground: false, connected: true });
		assert.strictEqual(idle.status, 'idle');
		assert.strictEqual(idle.sessionId, 'sess-1');
		assert.strictEqual(shouldShowLiveActivity('alwaysWorking', idle), false);
		assert.strictEqual(shouldShowLiveActivity('background', idle), false);
	});

	test('pin wins over attention; attention labels distinguish question vs approval', () => {
		const attention = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'a', title: 'Approve', message: '' },
		}), { revision: 1, prebaseForeground: false, connected: true });
		assert.strictEqual(resolveLiveActivityPanelState({
			visible: true, hovering: false, pinned: true, snapshot: attention, now: 0,
		}), 'pinned');
		assert.strictEqual(collapsedStatusLabel(attention), 'Magnus needs approval');

		const question = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'question', interactionId: 'q', title: 'Which file?', message: 'Pick' },
		}), { revision: 2, prebaseForeground: false, connected: true });
		assert.strictEqual(collapsedStatusLabel(question), 'Magnus needs an answer');
	});

	test('failed and completed labels do not invent extra detail', () => {
		const failed = buildMagnusLiveActivitySnapshot(session({
			failed: true,
			isInProgress: false,
			latestShortMessage: 'disk full',
		}), { revision: 1, prebaseForeground: false, connected: true });
		assert.strictEqual(collapsedStatusLabel(failed), 'Magnus stopped · disk full');

		const done = buildMagnusLiveActivitySnapshot(session({
			isInProgress: false,
			completed: true,
		}), { revision: 2, prebaseForeground: false, connected: true });
		assert.strictEqual(collapsedStatusLabel(done), 'Finished');
	});

	test('completed label does not invent Magnus git diffs', () => {
		const snap = buildMagnusLiveActivitySnapshot(session({
			isInProgress: false,
			completed: true,
			workspaceDiff: { files: 6, attributedToMagnus: true },
		}), { revision: 5, prebaseForeground: false, connected: true });
		assert.strictEqual(snap.status, 'completed');
		assert.strictEqual(collapsedStatusLabel(snap), 'Finished · 6 files');
		assert.strictEqual(snap.workspaceDiff?.attributedToMagnus, true);
	});

	test('summarizeMagnusWorkspaceDiff omits +/- when only edited file URIs are known', () => {
		const summary = summarizeMagnusWorkspaceDiff({
			editedFileUris: ['file:///a.ts', 'file:///b.ts', 'file:///a.ts', ''],
		});
		assert.deepStrictEqual(summary, { files: 2, attributedToMagnus: true });
		assert.strictEqual('additions' in (summary ?? {}), false);
		assert.strictEqual('deletions' in (summary ?? {}), false);
		assert.strictEqual(formatDiffMetric(summary), '2 files');
		assert.strictEqual(summarizeMagnusWorkspaceDiff({ editedFileUris: [] }), undefined);
	});

	test('summarizeMagnusWorkspaceDiff includes line stats when provided and always attributes to Magnus', () => {
		assert.deepStrictEqual(summarizeMagnusWorkspaceDiff({
			editedFileUris: ['file:///a.ts'],
			sessionFileCount: 3,
			additions: 12,
			deletions: 4,
		}), { files: 3, additions: 12, deletions: 4, attributedToMagnus: true });
		assert.deepStrictEqual(summarizeMagnusWorkspaceDiff({
			editedFileUris: [],
			additions: 0,
			deletions: 5,
		}), { files: 1, additions: 0, deletions: 5, attributedToMagnus: true });
	});

	test('deriveMagnusTestStateFromInvocations prefers running, then failed, and ignores non-test tools', () => {
		assert.strictEqual(deriveMagnusTestStateFromInvocations([
			{ toolId: 'runTests', state: 'passed' },
			{ toolId: 'testing.runAll', state: 'running' },
			{ toolId: 'runTests', state: 'failed' },
		]), 'running');
		assert.strictEqual(deriveMagnusTestStateFromInvocations([
			{ toolId: 'vscode.test.run', state: 'passed' },
			{ toolId: 'prebase_run_test', state: 'failed' },
		]), 'failed');
		assert.strictEqual(deriveMagnusTestStateFromInvocations([
			{ toolId: 'runTests', state: 'passed' },
		]), 'passed');
		assert.strictEqual(deriveMagnusTestStateFromInvocations([
			{ toolId: 'edit_file', state: 'failed' },
			{ toolId: 'run_terminal', state: 'running' },
		]), undefined);
		assert.strictEqual(deriveMagnusTestStateFromInvocations([]), undefined);
	});

	test('finished collapsed label shows +/- · N files when line stats are present', () => {
		const snap = buildMagnusLiveActivitySnapshot(session({
			isInProgress: false,
			completed: true,
			workspaceDiff: { files: 2, additions: 8, deletions: 3, attributedToMagnus: true },
		}), { revision: 6, prebaseForeground: false, connected: true });
		assert.strictEqual(collapsedStatusLabel(snap), 'Finished · +8 −3 · 2 files');
		assert.strictEqual(formatDiffMetric(snap.workspaceDiff), '+8 −3 · 2 files');
	});

	test('working collapsed label includes diff and terminal counts when present', () => {
		const snap = buildMagnusLiveActivitySnapshot(session({
			currentActivity: 'Editing graph',
			startedAt: 1_000,
			workspaceDiff: { files: 1, additions: 2, deletions: 0, attributedToMagnus: true },
			terminalCount: 2,
		}), { revision: 1, prebaseForeground: false, connected: true });
		assert.strictEqual(collapsedStatusLabel(snap, 1_000 + 45_000), 'Editing graph · 45s · +2 −0 · 1 file · 2 tasks');
		const oneTask = buildMagnusLiveActivitySnapshot(session({
			currentActivity: undefined,
			startedAt: undefined,
			terminalCount: 1,
			workspaceDiff: { files: 4, attributedToMagnus: true },
		}), { revision: 2, prebaseForeground: false, connected: true });
		assert.strictEqual(collapsedStatusLabel(oneTask), '4 files · 1 task');
	});

	test('answer accept requires pendingInteraction.interactionId (question id), not resolveId', () => {
		const snap = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: {
				kind: 'question',
				interactionId: 'question-42',
				resolveId: 'resolve-carousel-7',
				title: 'Which approach?',
				message: 'Pick one',
				options: [{ id: 'a', label: 'A' }],
			},
		}), { revision: 3, prebaseForeground: false, connected: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, {
			kind: 'answer',
			interactionId: 'resolve-carousel-7',
			optionId: 'a',
			revision: 3,
		}), { ok: false, reason: 'stale-interaction' });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, {
			kind: 'answer',
			interactionId: 'question-other',
			optionId: 'a',
			revision: 3,
		}), { ok: false, reason: 'stale-interaction' });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, {
			kind: 'answer',
			interactionId: 'question-42',
			optionId: 'nope',
			revision: 3,
		}), { ok: false, reason: 'stale-option' });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, {
			kind: 'answer',
			interactionId: 'question-42',
			optionId: 'a',
			revision: 3,
		}), { ok: true });
	});
});

suite('Magnus Live Activity contribution contracts', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('follow-up uses sendRequest on the snapshot sessionResource and never starts a second session', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		const handleStart = contribution.indexOf('private async _handleCommand');
		const handleEnd = contribution.indexOf('override dispose');
		assert.ok(handleStart >= 0 && handleEnd > handleStart, 'must locate _handleCommand');
		const handle = contribution.slice(handleStart, handleEnd);

		assert.match(handle, /acceptLiveActivityCommand\(snapshot, command\)/);
		assert.match(handle, /if \(!accepted\.ok\)/);
		assert.ok(handle.indexOf('acceptLiveActivityCommand') < handle.indexOf('this.chatService.sendRequest'), 'fail-closed accept must run before sendRequest');

		assert.match(handle, /const sessionResource = URI\.parse\(snapshot\.sessionResource\)/);
		assert.match(handle, /this\.chatService\.sendRequest\(sessionResource, \(command\.text \?\? ''\)\.trim\(\)\)/);
		assert.strictEqual((handle.match(/sendRequest\(/g) || []).length, 1, 'follow-up must have exactly one sendRequest');
		assert.ok(handle.indexOf("command.kind === 'followUp'") < handle.indexOf('this.chatService.sendRequest'), 'sendRequest is the follow-up path');

		assert.doesNotMatch(contribution, /startNewLocalSession/);
		assert.doesNotMatch(contribution, /vscode\.lm/);
		assert.doesNotMatch(contribution, /invokeTool/);
		assert.doesNotMatch(handle, /new.*Session/);
		assert.doesNotMatch(handle, /URI\.parse\(command\.sessionResource\)/);
		assert.strictEqual((contribution.match(/this\.chatService\.sendRequest\(/g) || []).length, 1, 'sendRequest is the only message path');
	});

	test('approvals confirm the same tool invocation and do not invoke tools', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		const handle = contribution.slice(contribution.indexOf('private async _handleCommand'), contribution.indexOf('override dispose'));
		assert.match(handle, /IChatToolInvocation\.confirmWith\(/);
		assert.match(handle, /ToolConfirmKind\.UserAction/);
		assert.match(handle, /ToolConfirmKind\.Denied/);
		assert.match(handle, /toolCallId === command\.interactionId/);
		assert.match(handle, /approval failed closed: invocation missing/);
		assert.doesNotMatch(handle, /invokeTool/);
		assert.doesNotMatch(handle, /lm\.invokeTool/);
	});

	test('question pendingInteraction uses question.id; answers key by that id; destructive only when Red', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		const extractStart = contribution.indexOf('function extractPending');
		const extractEnd = contribution.indexOf('function extractActions');
		assert.ok(extractStart >= 0 && extractEnd > extractStart, 'must locate extractPending');
		const extract = contribution.slice(extractStart, extractEnd);
		assert.match(extract, /interactionId:\s*first\.id/);
		assert.match(extract, /resolveId:\s*part\.resolveId/);
		assert.ok(extract.indexOf('interactionId: first.id') < extract.indexOf('resolveId: part.resolveId'));
		assert.doesNotMatch(extract, /interactionId:\s*part\.resolveId/);
		assert.doesNotMatch(extract, /destructive:\s*false/);
		assert.match(extract, /\.\.\.\(destructive === true \? \{ destructive: true \} : \{\}\)/);
		assert.match(extract, /id:\s*option\.value\s*\|\|\s*option\.id/);

		const handle = contribution.slice(contribution.indexOf('private async _handleCommand'), contribution.indexOf('override dispose'));
		assert.match(handle, /notifyQuestionCarouselAnswer\(/);
		assert.match(handle, /pending\.requestId\s*\?\?\s*last\?\.id/);
		assert.match(handle, /\{\s*\[pending\.interactionId\]:\s*\{\s*selectedValue:\s*command\.optionId\s*\}\s*\}/);
		assert.match(handle, /pending\.resolveId/);
		assert.match(handle, /carousel missing\/used/);
	});

	test('terminalCount refreshes on tool-session register and terminal dispose/change', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		const ctor = contribution.slice(contribution.indexOf('constructor('), contribution.indexOf('private _bindModels'));
		assert.match(ctor, /ITerminalService/);
		assert.match(ctor, /onDidRegisterTerminalInstanceWithToolSession/);
		assert.match(ctor, /onDidDisposeInstance/);
		assert.match(ctor, /onDidChangeInstances/);
		assert.match(ctor, /Event\.any\(/);
		assert.match(contribution, /countSessionTerminals\(deps\.terminalChat, model\.sessionResource\)/);
	});

	test('non-mac constructor returns before the native channel and dispose tears the panel down', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		const ctor = contribution.slice(contribution.indexOf('constructor('), contribution.indexOf('private _bindModels'));
		assert.match(ctor, /if \(isWeb \|\| !isMacintosh\) \{\s*return;/);
		assert.ok(ctor.indexOf('if (isWeb || !isMacintosh)') < ctor.indexOf('ProxyChannel.toService'), 'non-mac must no-op before native IPC');
		assert.match(contribution, /backend: isMacintosh && !isWeb \? 'unavailable' : 'non-mac'/);
		assert.match(contribution, /void this\._main\?\.disposeNative\(\)/);
	});

	test('presentation honors Reduce Motion from accessibility or graph setting', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		assert.match(contribution, /this\.accessibilityService\.isMotionReduced\(\)/);
		assert.match(contribution, /prebase\.graph\.reduceMotion/);
		assert.match(contribution, /reducedMotion,/);
	});

	test('Open in PreBase focuses the host, opens Magnus, and unpins', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		const handle = contribution.slice(contribution.indexOf('private async _handleCommand'), contribution.indexOf('override dispose'));
		const openStart = handle.indexOf("command.kind === 'openInPrebase'");
		assert.ok(openStart >= 0, 'must handle openInPrebase');
		const openEnd = handle.indexOf("if (!snapshot.sessionResource)", openStart);
		const open = handle.slice(openStart, openEnd > openStart ? openEnd : handle.length);
		assert.match(open, /this\._pinned = false/);
		assert.match(open, /this\.hostService\.focus\(mainWindow, \{ mode: FocusMode\.Force \}\)/);
		assert.match(open, /this\.commandService\.executeCommand\('prebase\.magnus\.open'\)/);
		assert.ok(open.indexOf('this._pinned = false') < open.indexOf('this.hostService.focus'), 'unpin before focus');
		assert.doesNotMatch(open, /sendRequest/);
		assert.doesNotMatch(open, /startNewLocalSession/);
	});

	test('hideDetails or screen lock both suppress snapshot details; revision increments on publish', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		const publish = contribution.slice(contribution.indexOf('private _publish(): void'), contribution.indexOf('private async _handleCommand'));
		assert.match(publish, /this\._revision \+= 1/);
		assert.ok(publish.indexOf('this._revision += 1') < publish.indexOf('revision: this._revision'), 'publish must bump revision before snapshot');
		assert.match(publish, /prebase\.magnus\.liveActivity\.hideDetails/);
		assert.match(publish, /screenLocked: this\._screenLocked/);
		assert.match(publish, /hideDetails: userHideDetails/);
		assert.match(contribution, /onDidLockScreen/);
		assert.match(contribution, /this\._screenLocked = true/);
		assert.match(contribution, /onDidUnlockScreen/);
		assert.match(contribution, /this\._screenLocked = false/);
	});

	test('observes IChatService models and looks up approvals on the same sessionResource', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		assert.match(contribution, /this\.chatService\.onDidCreateModel/);
		assert.match(contribution, /this\.chatService\.onDidDisposeSession/);
		assert.match(contribution, /selectPrimaryMagnusModel\(this\.chatService\.chatModels\.get\(\)\)/);
		assert.match(contribution, /isMagnusParticipantId/);
		const handle = contribution.slice(contribution.indexOf('private async _handleCommand'), contribution.indexOf('override dispose'));
		assert.match(handle, /this\.chatService\.getSession\(sessionResource\)/);
		assert.ok(handle.indexOf('URI.parse(snapshot.sessionResource)') < handle.indexOf('this.chatService.getSession'), 'approvals use the snapshot session');
		assert.match(contribution, /prebase\.magnus\.liveActivity\.display'\) === 'active' \? 'active' : 'builtin'/);
	});

	test('native connection is fail-closed until getNativeBackend reports native-appkit', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		assert.match(contribution, /this\._nativeConnected = false/);
		assert.match(contribution, /getNativeBackend\(\)/);
		assert.match(contribution, /this\._nativeConnected = backend === 'native-appkit'/);
		assert.match(contribution, /connected: this\._nativeConnected/);
		assert.doesNotMatch(contribution, /connected:\s*true/);
		assert.match(contribution, /notifyQuestionCarouselAnswer/);
	});
});

suite('Magnus Live Activity native and settings contracts', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('live activity settings are macOS-only', () => {
		const config = readRepo('src/vs/workbench/contrib/prebase/common/prebaseConfiguration.ts');
		for (const key of [
			'prebase.magnus.liveActivity.mode',
			'prebase.magnus.liveActivity.display',
			'prebase.magnus.liveActivity.hideDetails',
		]) {
			const start = config.indexOf(`'${key}'`);
			assert.ok(start >= 0, `missing setting ${key}`);
			const next = config.indexOf("\n\t\t'", start + key.length + 2);
			const block = config.slice(start, next === -1 ? config.length : next);
			assert.match(block, /included:\s*isMacintosh/, `${key} must be hidden off macOS`);
			assert.doesNotMatch(block, /included:\s*true/);
		}
	});

	test('main process never loads the native addon off macOS and tears it down on shutdown', () => {
		const main = readRepo('src/vs/platform/prebaseLiveActivity/electron-main/prebaseLiveActivityMainService.ts');
		const loader = main.slice(main.indexOf('function loadNativeAddon'), main.indexOf('export class MagnusLiveActivityMainService'));
		assert.match(loader, /if \(!isMacintosh\) \{\s*return undefined;/);
		assert.ok(loader.indexOf('if (!isMacintosh)') < loader.indexOf('createRequire'), 'Windows/Linux must not require the .node');

		assert.match(main, /if \(!isMacintosh\) \{\s*return;\s*\}/);
		assert.match(main, /onWillShutdown\(e => \{\s*e\.join\('MagnusLiveActivityMainService', this\.disposeNative\(\)\)/);
		assert.match(main, /this\._native\?\.dispose\(\)/);
		assert.match(main, /this\._native = undefined/);
		assert.match(main, /this\._backend = 'unavailable'/);
	});

	test('native compile is skipped off darwin and non-mac builds use the stub', () => {
		const build = readRepo('native/prebase-live-activity/build.mjs');
		assert.match(build, /if \(process\.platform !== 'darwin'\)/);
		assert.match(build, /process\.exit\(0\)/);

		const gyp = readRepo('native/prebase-live-activity/binding.gyp');
		assert.match(gyp, /OS=='mac'/);
		assert.match(gyp, /src\/live_activity\.mm/);
		assert.match(gyp, /OS!='mac'/);
		assert.match(gyp, /src\/live_activity_stub\.cc/);
	});

	test('native teardown clears monitor, timers, and panel; hover delays match the TypeScript FSM', () => {
		const native = readRepo('native/prebase-live-activity/src/live_activity.mm');
		const teardownStart = native.indexOf('- (void)teardown {');
		assert.ok(teardownStart >= 0, 'must locate teardown implementation');
		const teardownEnd = native.indexOf('\n@end', teardownStart);
		const teardown = native.slice(teardownStart, teardownEnd > teardownStart ? teardownEnd : native.length);
		assert.match(teardown, /\[self\.hoverTimer invalidate\]/);
		assert.match(teardown, /self\.hoverTimer = nil/);
		assert.match(teardown, /\[self\.exitTimer invalidate\]/);
		assert.match(teardown, /self\.exitTimer = nil/);
		assert.match(teardown, /\[self removeMonitors\]/);
		assert.doesNotMatch(teardown, /\[NSEvent removeMonitor:/);
		assert.match(teardown, /\[self\.panel close\]/);
		assert.match(teardown, /self\.panel = nil/);

		const removeStart = native.indexOf('- (void)removeMonitors {');
		assert.ok(removeStart >= 0, 'must locate removeMonitors');
		const removeEnd = native.indexOf('\n- (', removeStart + 1);
		const remove = native.slice(removeStart, removeEnd > removeStart ? removeEnd : native.length);
		assert.match(remove, /\[NSEvent removeMonitor:self\.globalMonitor\]/);
		assert.match(remove, /self\.globalMonitor = nil/);
		assert.match(remove, /\[NSEvent removeMonitor:self\.localMonitor\]/);
		assert.match(remove, /self\.localMonitor = nil/);

		assert.match(native, /gDisposed = true/);
		assert.match(native, /\[gController teardown\]/);
		assert.match(native, /if \(gDisposed \|\| info\.Length\(\) < 1/);

		const openSec = (LIVE_ACTIVITY_HOVER_OPEN_DELAY_MS / 1000).toFixed(2);
		const exitSec = (LIVE_ACTIVITY_EXIT_GRACE_MS / 1000).toFixed(2);
		assert.match(native, new RegExp(`scheduledTimerWithTimeInterval:${openSec}`));
		assert.match(native, new RegExp(`scheduledTimerWithTimeInterval:${exitSec}`));
	});

	test('native Escape unpins, monitors stay off when hidden, and buttons have accessible names', () => {
		const native = readRepo('native/prebase-live-activity/src/live_activity.mm');
		assert.match(native, /event\.keyCode != 53/);
		assert.match(native, /\[strong emit:@"unpin"/);
		assert.match(native, /addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown/);
		assert.match(native, /\[self removeMonitors\]/);
		assert.match(native, /controller\.displayMode = display/);
		assert.match(native, /isEqualToString:@"active"/);
		assert.match(native, /button\.accessibilityLabel = title/);
		assert.match(native, /NSAccessibilityButtonRole/);
		assert.match(native, /if \(self\.globalMonitor\) \{\s*return;/);
	});

	test('native SnapshotToDict emits metrics and pending options; answers clear pending locally', () => {
		const native = readRepo('native/prebase-live-activity/src/live_activity.mm');
		assert.match(native, /payload\[@"metricsLabel"\]/);
		assert.match(native, /workspaceDiff/);
		assert.match(native, /terminalCount/);
		assert.match(native, /testState/);
		assert.match(native, /pendingOptions/);
		assert.match(native, /answerOption:/);
		assert.match(native, /@"optionId": optionId/);
		assert.match(native, /clearPendingInteraction/);
		assert.match(native, /\[self clearPendingInteraction\]/);
		// Never invent destructive:false — only set @YES when explicitly true.
		assert.doesNotMatch(native, /@"destructive"\]\s*=\s*@NO/);
		assert.doesNotMatch(native, /Get\("destructive"\)\.ToBoolean/);
		assert.match(native, /Get\("destructive"\)\.IsBoolean/);
	});

	test('native emits session identity with revision and honors Reduce Motion', () => {
		const native = readRepo('native/prebase-live-activity/src/live_activity.mm');
		assert.match(native, /@"sessionId": self\.sessionId/);
		assert.match(native, /@"sessionResource": self\.sessionResource/);
		assert.match(native, /@"revision": @\(self\.revision\)/);
		assert.match(native, /animationBehavior = reduced \? NSWindowAnimationBehaviorNone/);
		assert.match(native, /animate:!self\.reducedMotion/);
		assert.doesNotMatch(native, /MacBook Pro|MacBookAir|14-inch|16-inch/);
	});

	test('pointer monitors install only while visible and are removed when hidden', () => {
		const native = readRepo('native/prebase-live-activity/src/live_activity.mm');
		const setVisibleStart = native.indexOf('- (void)setVisible:(BOOL)visible pinned:(BOOL)pinned reduced:(BOOL)reduced {');
		const teardownStart = native.indexOf('- (void)teardown {');
		assert.ok(setVisibleStart >= 0 && teardownStart > setVisibleStart, 'must locate setVisible');
		const setVisible = native.slice(setVisibleStart, teardownStart);

		const hiddenStart = setVisible.indexOf('if (!visible)');
		const hiddenEnd = setVisible.indexOf('[self installMonitor]');
		assert.ok(hiddenStart >= 0 && hiddenEnd > hiddenStart, 'hidden branch must return before installMonitor');
		const hidden = setVisible.slice(hiddenStart, hiddenEnd);
		assert.match(hidden, /\[self\.panel orderOut:nil\]/);
		assert.match(hidden, /ignoresMouseEvents = YES/);
		assert.match(hidden, /\[self\.hoverTimer invalidate\]/);
		assert.match(hidden, /\[self\.exitTimer invalidate\]/);
		assert.match(hidden, /\[self removeMonitors\]/);
		assert.match(hidden, /return;/);
		assert.doesNotMatch(hidden, /installMonitor/);

		const visible = setVisible.slice(hiddenEnd);
		assert.match(visible, /\[self installMonitor\]/);
		assert.doesNotMatch(visible, /removeMonitors/);

		const installStart = native.indexOf('- (void)installMonitor {');
		const installEnd = native.indexOf('- (void)removeMonitors {');
		const install = native.slice(installStart, installEnd);
		assert.match(install, /if \(self\.globalMonitor\) \{\s*return;/);
		assert.match(install, /addGlobalMonitorForEventsMatchingMask:NSEventMaskMouseMoved/);
		assert.match(install, /addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown/);
	});

	test('collapsed panel is click-through; expand enables mouse; NSPanel stays nonactivating', () => {
		const native = readRepo('native/prebase-live-activity/src/live_activity.mm');
		const buildStart = native.indexOf('- (void)buildPanel {');
		const makeButtonStart = native.indexOf('- (NSButton *)makeButton:');
		const build = native.slice(buildStart, makeButtonStart);
		assert.match(build, /NSWindowStyleMaskNonactivatingPanel/);
		assert.match(build, /NSWindowStyleMaskBorderless/);
		assert.match(build, /ignoresMouseEvents = YES/);

		const expandStart = native.indexOf('- (void)expandPreview {');
		const collapseStart = native.indexOf('- (void)collapse {');
		const emitStart = native.indexOf('- (void)emit:');
		const expand = native.slice(expandStart, collapseStart);
		const collapse = native.slice(collapseStart, emitStart);
		assert.match(expand, /ignoresMouseEvents = NO/);
		assert.match(collapse, /ignoresMouseEvents = YES/);
	});

	test('native geometry uses safe-area insets and displayMode builtin vs active', () => {
		const native = readRepo('native/prebase-live-activity/src/live_activity.mm');
		const targetStart = native.indexOf('- (NSScreen *)targetScreen {');
		const layoutStart = native.indexOf('- (void)layoutForScreen {');
		const controlsStart = native.indexOf('- (void)layoutControls:');
		assert.ok(targetStart >= 0 && layoutStart > targetStart && controlsStart > layoutStart, 'must locate screen helpers');
		const target = native.slice(targetStart, layoutStart);
		assert.match(target, /\[self\.displayMode isEqualToString:@"active"\]/);
		assert.match(target, /\[NSEvent mouseLocation\]/);
		assert.match(target, /safeAreaInsets\.top > 8/);
		assert.match(target, /\[NSScreen mainScreen\]/);

		const layout = native.slice(layoutStart, controlsStart);
		assert.match(layout, /screen\.safeAreaInsets/);
		assert.match(layout, /screen\.auxiliaryTopLeftArea/);
		assert.match(layout, /screen\.auxiliaryTopRightArea/);
		assert.match(layout, /insets\.top > 8 && auxLeft\.size\.width > 40 && auxRight\.size\.width > 40/);
		assert.match(layout, /self\.content\.housingWidth = 0/);
		assert.match(layout, /NSMidX\(frame\) - w \/ 2\.0/);
		assert.doesNotMatch(layout, /MacBook Pro|MacBookAir|14-inch|16-inch/);
	});

	test('non-mac stub exports unavailable and does not create a panel', () => {
		const stub = readRepo('native/prebase-live-activity/src/live_activity_stub.cc');
		assert.match(stub, /exports\.Set\("unavailable"/);
		assert.doesNotMatch(stub, /setSnapshot|setPresentation|NSPanel|AppKit/);
	});
});

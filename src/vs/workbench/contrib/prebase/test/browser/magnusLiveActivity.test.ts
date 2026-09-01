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
	LIVE_ACTIVITY_COMPLETED_HOLD_MS,
	LIVE_ACTIVITY_EXPANDED_HEIGHT,
	LIVE_ACTIVITY_EXIT_GRACE_MS,
	LIVE_ACTIVITY_HOVER_OPEN_DELAY_MS,
	LIVE_ACTIVITY_MAX_ACTIONS,
	LIVE_ACTIVITY_MAX_MESSAGE_CHARS,
	LIVE_ACTIVITY_PILL_HEIGHT,
	LIVE_ACTIVITY_PILL_WIDTH,
	LIVE_ACTIVITY_WING_WIDTH,
	redactLiveActivityText,
	resolveLiveActivityPanelState,
	shouldShowLiveActivity,
	type LiveActivityGeometry,
	type MagnusLiveActivitySessionInput,
	type MagnusLiveActivitySnapshot,
} from '../../../../../platform/prebaseLiveActivity/common/magnusLiveActivity.js';
import { applyMagnusLiveActivitySessionCommand, extractPending } from '../../browser/magnusLiveActivitySession.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { IChatToolInvocation, ToolConfirmKind, type ConfirmedReason } from '../../../chat/common/chatService/chatService.js';
import type { IChatModel, IChatRequestModel, IChatResponseModel, IResponse, IChatProgressResponseContent } from '../../../chat/common/model/chatModel.js';

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

interface LiveActivityScreenLayout {
	readonly originX: number;
	readonly originY: number;
	readonly width: number;
	readonly height: number;
	readonly scaleFactor: number;
	readonly safeAreaTop: number;
	readonly auxLeftWidth: number;
	readonly auxRightWidth: number;
	readonly auxLeftHeight: number;
	readonly auxRightHeight: number;
}

function layoutLiveActivityPanelFrame(screen: LiveActivityScreenLayout, expanded = false): {
	readonly geo: LiveActivityGeometry;
	readonly frame: { x: number; y: number; width: number; height: number };
	readonly topY: number;
	readonly collapsedBandTop: number;
} {
	const geo = deriveLiveActivityGeometry({
		width: screen.width,
		height: screen.height,
		scaleFactor: screen.scaleFactor,
		safeAreaTop: screen.safeAreaTop,
		auxLeftWidth: screen.auxLeftWidth,
		auxRightWidth: screen.auxRightWidth,
		auxLeftHeight: screen.auxLeftHeight,
		auxRightHeight: screen.auxRightHeight,
	});
	const topY = screen.originY + screen.height;
	if (geo.notched) {
		const bandH = geo.pill.height;
		const height = expanded ? LIVE_ACTIVITY_EXPANDED_HEIGHT : bandH;
		return {
			geo,
			topY,
			collapsedBandTop: topY - bandH,
			frame: {
				x: screen.originX + geo.pill.x,
				y: topY - height,
				width: geo.pill.width,
				height,
			},
		};
	}
	const width = expanded ? 320 : geo.pill.width;
	const height = expanded ? LIVE_ACTIVITY_EXPANDED_HEIGHT : geo.pill.height;
	return {
		geo,
		topY,
		collapsedBandTop: topY - geo.pill.height,
		frame: {
			x: screen.originX + Math.round((screen.width - width) / 2),
			y: topY - height,
			width,
			height,
		},
	};
}

function axisAlignedRectsIntersect(
	a: { x: number; y: number; width: number; height: number },
	b: { x: number; y: number; width: number; height: number },
): boolean {
	return a.x < b.x + b.width
		&& a.x + a.width > b.x
		&& a.y < b.y + b.height
		&& a.y + a.height > b.y;
}

function mockRequest(parts: IChatProgressResponseContent[], id = 'req-1'): IChatRequestModel {
	const response: Partial<IChatResponseModel> = {
		entireResponse: {
			value: parts,
			getMarkdown: () => '',
			getFinalResponse: () => '',
			toString: () => '',
		} satisfies IResponse,
	};
	return {
		id,
		response: response as IChatResponseModel,
	} as IChatRequestModel;
}

function mockToolInvocation(options: {
	toolCallId: string;
	state: IChatToolInvocation.State;
	toolId?: string;
	invocationMessage?: string;
}): IChatToolInvocation {
	return {
		kind: 'toolInvocation',
		toolCallId: options.toolCallId,
		toolId: options.toolId ?? 'test-tool',
		invocationMessage: options.invocationMessage ?? 'Run tool',
		pastTenseMessage: undefined,
		originMessage: undefined,
		presentation: undefined!,
		source: undefined!,
		state: observableValue('toolState', options.state),
		toolSpecificData: undefined,
		toolSpecificDataKind: observableValue('test', undefined),
		isAttachedToThinking: false,
		toJSON: () => undefined!,
	};
}

function waitingConfirmationState(confirm?: (reason: ConfirmedReason) => void): IChatToolInvocation.State {
	return {
		type: IChatToolInvocation.StateKind.WaitingForConfirmation,
		parameters: { path: '/tmp/x' },
		confirmationMessages: { title: 'Delete file?', message: 'Remove obsolete.ts' },
		confirm: confirm ?? (() => { }),
	} as IChatToolInvocation.State;
}

function connectedSnapshot(partial: Partial<MagnusLiveActivitySessionInput> = {}): MagnusLiveActivitySnapshot {
	return buildMagnusLiveActivitySnapshot(session(partial), { revision: 1, prebaseForeground: false, connected: true });
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
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'approve', interactionId: 'tool-9', revision: 3 }), { ok: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'followUp', text: 'hello', revision: 3 }), { ok: false, reason: 'stale-revision' });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'approve', interactionId: 'tool-8', revision: 4 }), { ok: false, reason: 'stale-interaction' });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'approve', interactionId: 'tool-9', revision: 4 }), { ok: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(snap, { kind: 'followUp', sessionId: 'other', text: 'hello', revision: 4 }), { ok: false, reason: 'session-mismatch' });
	});

	test('stale revision bypass requires matching pending kind', () => {
		const approvalSnap = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'tool-9', title: 'Delete?', message: '' },
		}), { revision: 4, prebaseForeground: false, connected: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(approvalSnap, { kind: 'answer', interactionId: 'tool-9', optionId: 'a', revision: 3 }), { ok: false, reason: 'stale-revision' });
		assert.deepStrictEqual(acceptLiveActivityCommand(approvalSnap, { kind: 'deny', interactionId: 'tool-9', revision: 3 }), { ok: true });

		const questionSnap = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'question', interactionId: 'q-1', title: 'Pick', message: '', options: [{ id: 'a', label: 'A' }] },
		}), { revision: 5, prebaseForeground: false, connected: true });
		assert.deepStrictEqual(acceptLiveActivityCommand(questionSnap, { kind: 'approve', interactionId: 'q-1', revision: 4 }), { ok: false, reason: 'stale-revision' });
		assert.deepStrictEqual(acceptLiveActivityCommand(questionSnap, { kind: 'answer', interactionId: 'q-1', optionId: 'a', revision: 4 }), { ok: true });
	});

	test('snapshot preserves destructive only when explicitly true', () => {
		const destructive = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'tool-danger', title: 'Delete?', message: 'Remove', destructive: true },
		}), { revision: 1, prebaseForeground: false, connected: true });
		assert.strictEqual(destructive.pendingInteraction?.destructive, true);

		const safe = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'tool-safe', title: 'Run?', message: 'Safe op' },
		}), { revision: 2, prebaseForeground: false, connected: true });
		assert.strictEqual(safe.pendingInteraction?.destructive, undefined);
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

	test('notched geometry is top-anchored with housing derived from aux metrics', () => {
		const notched = deriveLiveActivityGeometry({
			width: 1512, height: 982, scaleFactor: 2,
			safeAreaTop: 32, auxLeftWidth: 620, auxRightWidth: 620, auxLeftHeight: 32, auxRightHeight: 32,
		});
		assert.strictEqual(notched.notched, true);
		assert.strictEqual(notched.pill.y, 0, 'top anchor uses screen.frame.maxY (y=0 in screen-relative coords)');
		assert.strictEqual(notched.pill.height, 32);
		assert.strictEqual(notched.cameraHousingWidth, 272);
		assert.strictEqual(notched.pill.width, 124 + 272 + 124);
		assert.ok(notched.hit.width < 200, 'collapsed hit target must stay small');
		const pill = deriveLiveActivityGeometry({
			width: 1920, height: 1080, scaleFactor: 1,
			safeAreaTop: 0, auxLeftWidth: 0, auxRightWidth: 0, auxLeftHeight: 0, auxRightHeight: 0,
		});
		assert.strictEqual(pill.notched, false);
		assert.strictEqual(pill.cameraHousingWidth, 0);
		assert.strictEqual(pill.leftWing.width, 0);
		assert.strictEqual(pill.rightWing.width, 0);
		assert.strictEqual(pill.pill.y, 0, 'no-notch pill is flush with screen top');
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

	test('overlapping aux widths do not invent a physical notch', () => {
		const overlap = deriveLiveActivityGeometry({
			width: 1000, height: 700, scaleFactor: 1,
			safeAreaTop: 32, auxLeftWidth: 500, auxRightWidth: 500, auxLeftHeight: 32, auxRightHeight: 32,
		});
		assert.strictEqual(overlap.notched, false);
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

suite('Magnus Live Activity notch alignment (P0)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const builtinNotched: LiveActivityScreenLayout = {
		originX: 0,
		originY: 0,
		width: 1512,
		height: 982,
		scaleFactor: 2,
		safeAreaTop: 32,
		auxLeftWidth: 620,
		auxRightWidth: 620,
		auxLeftHeight: 32,
		auxRightHeight: 32,
	};

	const externalRight: LiveActivityScreenLayout = {
		originX: 1728,
		originY: 0,
		width: 1920,
		height: 1080,
		scaleFactor: 1,
		safeAreaTop: 0,
		auxLeftWidth: 0,
		auxRightWidth: 0,
		auxLeftHeight: 0,
		auxRightHeight: 0,
	};

	const externalLeft: LiveActivityScreenLayout = {
		originX: -1920,
		originY: 0,
		width: 1920,
		height: 1080,
		scaleFactor: 1,
		safeAreaTop: 0,
		auxLeftWidth: 0,
		auxRightWidth: 0,
		auxLeftHeight: 0,
		auxRightHeight: 0,
	};

	test('collapsed panel top is flush with screen.frame.maxY, not a visibleFrame menu-bar gap', () => {
		const collapsed = layoutLiveActivityPanelFrame(builtinNotched, false);
		assert.strictEqual(collapsed.frame.y + collapsed.frame.height, collapsed.topY);
		assert.strictEqual(collapsed.collapsedBandTop, collapsed.frame.y);
		assert.notStrictEqual(collapsed.frame.y, collapsed.topY - collapsed.frame.height - 8, 'detached floating pill offset must not return');

		const pill = layoutLiveActivityPanelFrame(externalRight, false);
		assert.strictEqual(pill.frame.y + pill.frame.height, pill.topY);
		assert.strictEqual(pill.topY, 1080);
	});

	test('notched wings bracket the housing and never overlap the camera exclusion band', () => {
		const { geo, frame, topY } = layoutLiveActivityPanelFrame(builtinNotched, false);
		const bandTop = topY - geo.pill.height;
		const housing = {
			x: builtinNotched.originX + builtinNotched.auxLeftWidth,
			y: bandTop,
			width: geo.cameraHousingWidth,
			height: geo.pill.height,
		};
		const leftWing = {
			x: builtinNotched.originX + geo.leftWing.x,
			y: bandTop,
			width: geo.leftWing.width,
			height: geo.leftWing.height,
		};
		const rightWing = {
			x: builtinNotched.originX + geo.rightWing.x,
			y: bandTop,
			width: geo.rightWing.width,
			height: geo.rightWing.height,
		};
		assert.strictEqual(leftWing.x + leftWing.width, housing.x);
		assert.strictEqual(rightWing.x, housing.x + housing.width);
		assert.strictEqual(axisAlignedRectsIntersect(leftWing, housing), false);
		assert.strictEqual(axisAlignedRectsIntersect(rightWing, housing), false);
		assert.strictEqual(frame.width, LIVE_ACTIVITY_WING_WIDTH + geo.cameraHousingWidth + LIVE_ACTIVITY_WING_WIDTH);
		assert.ok(frame.width < builtinNotched.width, 'collapsed width must be notch+wings, not full-screen pill');
	});

	test('expanded layout keeps the same top anchor and grows downward', () => {
		const collapsed = layoutLiveActivityPanelFrame(builtinNotched, false);
		const expanded = layoutLiveActivityPanelFrame(builtinNotched, true);
		assert.strictEqual(expanded.frame.x, collapsed.frame.x);
		assert.strictEqual(expanded.frame.width, collapsed.frame.width);
		assert.strictEqual(expanded.frame.y + expanded.frame.height, collapsed.topY);
		assert.strictEqual(expanded.frame.height, LIVE_ACTIVITY_EXPANDED_HEIGHT);
		assert.ok(expanded.frame.height > collapsed.frame.height);
		assert.strictEqual(expanded.frame.y, collapsed.topY - LIVE_ACTIVITY_EXPANDED_HEIGHT);
		assert.strictEqual(expanded.collapsedBandTop, collapsed.collapsedBandTop);
	});

	test('notched vs no-notch fallback modes choose wings or a small center pill', () => {
		const notched = layoutLiveActivityPanelFrame(builtinNotched, false);
		assert.strictEqual(notched.geo.notched, true);
		assert.strictEqual(notched.geo.leftWing.width, LIVE_ACTIVITY_WING_WIDTH);
		assert.strictEqual(notched.geo.rightWing.width, LIVE_ACTIVITY_WING_WIDTH);

		const pill = layoutLiveActivityPanelFrame(externalRight, false);
		assert.strictEqual(pill.geo.notched, false);
		assert.strictEqual(pill.geo.leftWing.width, 0);
		assert.strictEqual(pill.frame.width, LIVE_ACTIVITY_PILL_WIDTH);
		assert.strictEqual(pill.frame.height, LIVE_ACTIVITY_PILL_HEIGHT);
		assert.ok(Math.abs(pill.frame.x - (externalRight.originX + (externalRight.width - LIVE_ACTIVITY_PILL_WIDTH) / 2)) < 1);
	});

	test('multi-display screen origins offset absolute panel frames without re-centering on primary', () => {
		const primary = layoutLiveActivityPanelFrame(builtinNotched, false);
		const right = layoutLiveActivityPanelFrame(externalRight, false);
		const left = layoutLiveActivityPanelFrame(externalLeft, false);

		assert.strictEqual(primary.frame.x, builtinNotched.originX + primary.geo.pill.x);
		assert.strictEqual(primary.topY, 982);
		assert.strictEqual(right.frame.x, 1728 + Math.round((1920 - LIVE_ACTIVITY_PILL_WIDTH) / 2));
		assert.strictEqual(right.topY, 1080);
		assert.strictEqual(left.frame.x, -1920 + Math.round((1920 - LIVE_ACTIVITY_PILL_WIDTH) / 2));
		assert.strictEqual(left.topY, 1080);
		assert.notStrictEqual(right.frame.x, primary.frame.x);
		assert.notStrictEqual(left.frame.x, primary.frame.x);
	});

	test('completed status stays visible transiently and wins collapsed hover state', () => {
		const completed = buildMagnusLiveActivitySnapshot(session({ isInProgress: false, completed: true }), {
			revision: 1,
			prebaseForeground: false,
			connected: true,
		});
		assert.strictEqual(shouldShowLiveActivity('alwaysWorking', completed), true);
		assert.strictEqual(shouldShowLiveActivity('background', completed), true);
		assert.strictEqual(resolveLiveActivityPanelState({
			visible: true,
			hovering: false,
			pinned: false,
			snapshot: completed,
			now: 0,
		}), 'completedTransient');
		assert.strictEqual(resolveLiveActivityPanelState({
			visible: true,
			hovering: true,
			pinned: false,
			snapshot: completed,
			now: 500,
			hoverSince: 0,
		}), 'completedTransient');
		assert.strictEqual(LIVE_ACTIVITY_COMPLETED_HOLD_MS, 8_000);
	});
});

suite('Magnus Live Activity pending projection (runtime)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('WaitingForConfirmation maps to approval with toolCallId and confirmation copy', () => {
		const invocation = mockToolInvocation({
			toolCallId: 'tool-9',
			state: waitingConfirmationState(),
		});
		const pending = extractPending(mockRequest([invocation]));
		assert.strictEqual(pending?.kind, 'approval');
		assert.strictEqual(pending?.interactionId, 'tool-9');
		assert.strictEqual(pending?.title, 'Delete file?');
		assert.strictEqual(pending?.message, 'Remove obsolete.ts');
		assert.strictEqual(pending?.destructive, undefined);
	});

	test('destructive is set only when risk assessment returns true', () => {
		const invocation = mockToolInvocation({
			toolCallId: 'tool-danger',
			state: waitingConfirmationState(),
			toolId: 'rm_rf',
		});
		const safe = extractPending(mockRequest([invocation]), { isDestructive: () => false });
		const hot = extractPending(mockRequest([invocation]), { isDestructive: () => true });
		assert.strictEqual(safe?.destructive, undefined);
		assert.strictEqual(hot?.destructive, true);
	});

	test('unused question carousel keys interactionId by question.id and caps options', () => {
		const carousel = {
			kind: 'questionCarousel' as const,
			questions: [{
				id: 'question-42',
				type: 'singleSelect' as const,
				title: 'Which approach?',
				message: 'Pick one',
				options: [
					{ id: 'a', value: 'val-a', label: 'A' },
					{ id: 'b', value: 'val-b', label: 'B' },
					{ id: 'c', value: 'val-c', label: 'C' },
					{ id: 'd', value: 'val-d', label: 'D' },
					{ id: 'e', value: 'val-e', label: 'E' },
				],
			}],
			allowSkip: false,
			resolveId: 'resolve-7',
			isUsed: false,
		};
		const pending = extractPending(mockRequest([carousel], 'req-q'));
		assert.strictEqual(pending?.kind, 'question');
		assert.strictEqual(pending?.interactionId, 'question-42');
		assert.strictEqual(pending?.resolveId, 'resolve-7');
		assert.strictEqual(pending?.requestId, 'req-q');
		assert.strictEqual(pending?.options?.length, 4);
		assert.strictEqual(pending?.options?.[0].id, 'val-a');
	});

	test('used question carousel is skipped; approval wins when it appears first', () => {
		const usedCarousel = {
			kind: 'questionCarousel' as const,
			questions: [{ id: 'q1', type: 'text' as const, title: 'Old question' }],
			allowSkip: false,
			resolveId: 'resolve-used',
			isUsed: true,
		};
		assert.strictEqual(extractPending(mockRequest([usedCarousel])), undefined);

		const approval = mockToolInvocation({ toolCallId: 'tool-first', state: waitingConfirmationState() });
		const openCarousel = {
			kind: 'questionCarousel' as const,
			questions: [{ id: 'q2', type: 'text' as const, title: 'Later question' }],
			allowSkip: false,
			resolveId: 'resolve-open',
			isUsed: false,
		};
		const mixed = extractPending(mockRequest([approval, openCarousel]));
		assert.strictEqual(mixed?.kind, 'approval');
		assert.strictEqual(mixed?.interactionId, 'tool-first');
	});

	test('question carousel without request id is ignored', () => {
		const carousel = {
			kind: 'questionCarousel' as const,
			questions: [{ id: 'q-no-req', type: 'text' as const, title: 'No request' }],
			allowSkip: false,
			resolveId: 'resolve-x',
			isUsed: false,
		};
		assert.strictEqual(extractPending({ response: { entireResponse: { value: [carousel] } } } as IChatRequestModel), undefined);
	});
});

suite('Magnus Live Activity session command dispatch (runtime)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('approve confirms the canonical tool invocation on the snapshot session', async () => {
		let confirmed: ConfirmedReason | undefined;
		const invocation = mockToolInvocation({
			toolCallId: 'tool-9',
			state: waitingConfirmationState(reason => { confirmed = reason; }),
		});
		const sessionResource = URI.parse('vscode-chat://local/sess-1');
		const model = {
			sessionId: 'sess-1',
			lastRequest: mockRequest([invocation]),
			getRequests: () => [mockRequest([invocation], 'req-1')],
		} as IChatModel;
		let notified = false;
		const snapshot = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'tool-9', title: 'Delete?', message: 'Remove' },
		}), { revision: 1, prebaseForeground: false, connected: true });

		await applyMagnusLiveActivitySessionCommand(snapshot, {
			kind: 'approve',
			interactionId: 'tool-9',
			revision: 1,
		}, {
			chatService: {
				getSession: resource => resource.toString() === sessionResource.toString() ? model : undefined,
				sendRequest: async () => { throw new Error('sendRequest must not run'); },
				notifyQuestionCarouselAnswer: () => { notified = true; },
			},
			logService: { info: () => { } },
		});

		assert.strictEqual(confirmed?.type, ToolConfirmKind.UserAction);
		assert.strictEqual(notified, false);
	});

	test('deny confirms denied; stale snapshot pending rejects without a second confirm', async () => {
		let confirmCount = 0;
		const invocation = mockToolInvocation({
			toolCallId: 'tool-9',
			state: waitingConfirmationState(() => { confirmCount++; }),
		});
		const request = mockRequest([invocation]);
		const model = { sessionId: 'sess-1', lastRequest: request, getRequests: () => [request] } as IChatModel;
		const snapshot = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'tool-9', title: 'Delete?', message: '' },
		}), { revision: 1, prebaseForeground: false, connected: true });

		await applyMagnusLiveActivitySessionCommand(snapshot, {
			kind: 'deny',
			interactionId: 'tool-9',
			revision: 1,
		}, {
			chatService: {
				getSession: () => model,
				sendRequest: async () => undefined,
				notifyQuestionCarouselAnswer: () => { },
			},
			logService: { info: () => { } },
		});
		assert.strictEqual(confirmCount, 1);

		await applyMagnusLiveActivitySessionCommand(snapshot, {
			kind: 'approve',
			interactionId: 'tool-other',
			revision: 1,
		}, {
			chatService: {
				getSession: () => model,
				sendRequest: async () => undefined,
				notifyQuestionCarouselAnswer: () => { },
			},
			logService: { info: () => { } },
		});
		assert.strictEqual(confirmCount, 1, 'stale interaction must not confirm again');
	});

	test('answer notifies chat with question.id keyed map on the pending request', async () => {
		const carousel = {
			kind: 'questionCarousel' as const,
			questions: [{ id: 'question-42', type: 'singleSelect' as const, title: 'Pick', options: [{ id: 'a', value: 'val-a', label: 'A' }] }],
			allowSkip: false,
			resolveId: 'resolve-7',
			isUsed: false,
		};
		const older = mockRequest([carousel], 'req-old');
		const model = {
			sessionId: 'sess-1',
			lastRequest: mockRequest([], 'req-new'),
			getRequests: () => [older],
		} as IChatModel;
		let answerArgs: { requestId: string; resolveId: string; answers: Record<string, unknown> } | undefined;
		const snapshot = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: {
				kind: 'question',
				interactionId: 'question-42',
				requestId: 'req-old',
				resolveId: 'resolve-7',
				title: 'Pick',
				message: '',
				options: [{ id: 'val-a', label: 'A' }],
			},
		}), { revision: 2, prebaseForeground: false, connected: true });

		await applyMagnusLiveActivitySessionCommand(snapshot, {
			kind: 'answer',
			interactionId: 'question-42',
			optionId: 'val-a',
			revision: 2,
		}, {
			chatService: {
				getSession: () => model,
				sendRequest: async () => undefined,
				notifyQuestionCarouselAnswer: (requestId, resolveId, answers) => {
					answerArgs = { requestId, resolveId, answers: answers ?? {} };
				},
			},
			logService: { info: () => { } },
		});

		assert.deepStrictEqual(answerArgs, {
			requestId: 'req-old',
			resolveId: 'resolve-7',
			answers: { 'question-42': { selectedValue: 'val-a' } },
		});
	});

	test('answer fails closed when carousel is used or invocation left waiting state', async () => {
		const usedCarousel = {
			kind: 'questionCarousel' as const,
			questions: [{ id: 'q1', type: 'text' as const, title: 'Used' }],
			allowSkip: false,
			resolveId: 'resolve-used',
			isUsed: true,
		};
		const model = {
			sessionId: 'sess-1',
			lastRequest: mockRequest([usedCarousel], 'req-1'),
			getRequests: () => [mockRequest([usedCarousel], 'req-1')],
		} as IChatModel;
		let notified = false;
		const questionSnap = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: {
				kind: 'question',
				interactionId: 'q1',
				requestId: 'req-1',
				resolveId: 'resolve-used',
				title: 'Used',
				message: '',
			},
		}), { revision: 1, prebaseForeground: false, connected: true });
		await applyMagnusLiveActivitySessionCommand(questionSnap, {
			kind: 'answer',
			interactionId: 'q1',
			optionId: 'x',
			revision: 1,
		}, {
			chatService: {
				getSession: () => model,
				sendRequest: async () => undefined,
				notifyQuestionCarouselAnswer: () => { notified = true; },
			},
			logService: { info: () => { } },
		});
		assert.strictEqual(notified, false);

		let confirmCount = 0;
		const executedInvocation = mockToolInvocation({
			toolCallId: 'tool-exec',
			state: {
				type: IChatToolInvocation.StateKind.Executing,
				parameters: {},
				confirmed: { type: ToolConfirmKind.UserAction },
				progress: observableValue('progress', { message: undefined, progress: undefined }),
			} as IChatToolInvocation.State,
		});
		const executedRequest = mockRequest([executedInvocation]);
		const approvalSnap = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'tool-exec', title: 'Run', message: '' },
		}), { revision: 1, prebaseForeground: false, connected: true });
		let applied = false;
		await applyMagnusLiveActivitySessionCommand(approvalSnap, {
			kind: 'approve',
			interactionId: 'tool-exec',
			revision: 1,
		}, {
			chatService: {
				getSession: () => ({
					sessionId: 'sess-1',
					lastRequest: executedRequest,
					getRequests: () => [executedRequest],
				} as IChatModel),
				sendRequest: async () => undefined,
				notifyQuestionCarouselAnswer: () => { confirmCount++; },
			},
			logService: { info: () => { } },
			onInteractionApplied: () => { applied = true; },
		});
		assert.strictEqual(applied, false);
		assert.strictEqual(confirmCount, 0);
	});

	test('follow-up sends trimmed text on snapshot sessionResource only', async () => {
		const sessionResource = URI.parse('vscode-chat://local/sess-1');
		let sent: { resource: URI; text: string } | undefined;
		const snapshot = connectedSnapshot();
		await applyMagnusLiveActivitySessionCommand(snapshot, {
			kind: 'followUp',
			text: '  continue refactor  ',
		}, {
			chatService: {
				getSession: () => undefined,
				sendRequest: async (resource, text) => { sent = { resource, text }; },
				notifyQuestionCarouselAnswer: () => { },
			},
			logService: { info: () => { } },
		});
		assert.deepStrictEqual(sent, { resource: sessionResource, text: 'continue refactor' });
	});

	test('approve and answer fail closed when snapshot sessionId mismatches live model', async () => {
		let confirmed = false;
		const invocation = mockToolInvocation({
			toolCallId: 'tool-9',
			state: waitingConfirmationState(() => { confirmed = true; }),
		});
		const request = mockRequest([invocation]);
		const wrongModel = { sessionId: 'sess-other', lastRequest: request, getRequests: () => [request] } as IChatModel;
		const logs: string[] = [];
		const approvalSnap = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'tool-9', title: 'Delete?', message: '' },
		}), { revision: 1, prebaseForeground: false, connected: true });

		await applyMagnusLiveActivitySessionCommand(approvalSnap, {
			kind: 'approve',
			interactionId: 'tool-9',
			revision: 1,
		}, {
			chatService: {
				getSession: () => wrongModel,
				sendRequest: async () => undefined,
				notifyQuestionCarouselAnswer: () => { },
			},
			logService: { info: msg => logs.push(msg) },
		});
		assert.strictEqual(confirmed, false);
		assert.ok(logs.some(l => l.includes('session mismatch')));

		const carousel = {
			kind: 'questionCarousel' as const,
			questions: [{ id: 'q-1', type: 'singleSelect' as const, title: 'Pick', options: [{ id: 'a', value: 'val-a', label: 'A' }] }],
			allowSkip: false,
			resolveId: 'resolve-1',
			isUsed: false,
		};
		const questionRequest = mockRequest([carousel], 'req-q');
		const questionModel = { sessionId: 'sess-1', lastRequest: questionRequest, getRequests: () => [questionRequest] } as IChatModel;
		let notified = false;
		logs.length = 0;
		const questionSnap = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: {
				kind: 'question',
				interactionId: 'q-1',
				requestId: 'req-q',
				resolveId: 'resolve-1',
				title: 'Pick',
				message: '',
				options: [{ id: 'val-a', label: 'A' }],
			},
		}), { revision: 2, prebaseForeground: false, connected: true });

		await applyMagnusLiveActivitySessionCommand(questionSnap, {
			kind: 'answer',
			interactionId: 'q-1',
			optionId: 'val-a',
			revision: 2,
		}, {
			chatService: {
				getSession: () => undefined,
				sendRequest: async () => undefined,
				notifyQuestionCarouselAnswer: () => { notified = true; },
			},
			logService: { info: msg => logs.push(msg) },
		});
		assert.strictEqual(notified, false);
		assert.ok(logs.some(l => l.includes('session mismatch')));
	});

	test('answer rejects stale optionId against live carousel, not snapshot options alone', async () => {
		const carousel = {
			kind: 'questionCarousel' as const,
			questions: [{ id: 'question-42', type: 'singleSelect' as const, title: 'Pick', options: [{ id: 'a', value: 'val-a', label: 'A' }] }],
			allowSkip: false,
			resolveId: 'resolve-7',
			isUsed: false,
		};
		const request = mockRequest([carousel], 'req-1');
		const model = { sessionId: 'sess-1', lastRequest: request, getRequests: () => [request] } as IChatModel;
		let notified = false;
		const logs: string[] = [];
		const snapshot = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: {
				kind: 'question',
				interactionId: 'question-42',
				requestId: 'req-1',
				resolveId: 'resolve-7',
				title: 'Pick',
				message: '',
				options: [{ id: 'val-a', label: 'A' }],
			},
		}), { revision: 1, prebaseForeground: false, connected: true });

		await applyMagnusLiveActivitySessionCommand(snapshot, {
			kind: 'answer',
			interactionId: 'question-42',
			optionId: 'stale-option',
			revision: 1,
		}, {
			chatService: {
				getSession: () => model,
				sendRequest: async () => undefined,
				notifyQuestionCarouselAnswer: () => { notified = true; },
			},
			logService: { info: msg => logs.push(msg) },
		});
		assert.strictEqual(notified, false);
		assert.ok(logs.some(l => l.includes('stale option')));
	});

	test('approve on question pending and answer on approval pending fail closed at dispatch', async () => {
		const carousel = {
			kind: 'questionCarousel' as const,
			questions: [{ id: 'q-1', type: 'singleSelect' as const, title: 'Pick', options: [{ id: 'a', value: 'val-a', label: 'A' }] }],
			allowSkip: false,
			resolveId: 'resolve-q',
			isUsed: false,
		};
		const questionRequest = mockRequest([carousel], 'req-q');
		const questionModel = { sessionId: 'sess-1', lastRequest: questionRequest, getRequests: () => [questionRequest] } as IChatModel;
		let confirmed = false;
		const logs: string[] = [];
		const questionSnap = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: {
				kind: 'question',
				interactionId: 'q-1',
				requestId: 'req-q',
				resolveId: 'resolve-q',
				title: 'Pick',
				message: '',
				options: [{ id: 'val-a', label: 'A' }],
			},
		}), { revision: 1, prebaseForeground: false, connected: true });

		await applyMagnusLiveActivitySessionCommand(questionSnap, {
			kind: 'approve',
			interactionId: 'q-1',
			revision: 1,
		}, {
			chatService: {
				getSession: () => questionModel,
				sendRequest: async () => undefined,
				notifyQuestionCarouselAnswer: () => { },
			},
			logService: { info: msg => logs.push(msg) },
			onInteractionApplied: () => { confirmed = true; },
		});
		assert.strictEqual(confirmed, false);
		assert.ok(logs.some(l => l.includes('stale interaction')));

		const invocation = mockToolInvocation({
			toolCallId: 'tool-9',
			state: waitingConfirmationState(),
		});
		const approvalRequest = mockRequest([invocation]);
		const approvalModel = { sessionId: 'sess-1', lastRequest: approvalRequest, getRequests: () => [approvalRequest] } as IChatModel;
		let notified = false;
		logs.length = 0;
		const approvalSnap = buildMagnusLiveActivitySnapshot(session({
			needsInput: true,
			pendingInteraction: { kind: 'approval', interactionId: 'tool-9', title: 'Delete?', message: '' },
		}), { revision: 2, prebaseForeground: false, connected: true });

		await applyMagnusLiveActivitySessionCommand(approvalSnap, {
			kind: 'answer',
			interactionId: 'tool-9',
			optionId: 'val-a',
			revision: 2,
		}, {
			chatService: {
				getSession: () => approvalModel,
				sendRequest: async () => undefined,
				notifyQuestionCarouselAnswer: () => { notified = true; },
			},
			logService: { info: msg => logs.push(msg) },
		});
		assert.strictEqual(notified, false);
		assert.ok(logs.some(l => l.includes('stale interaction')));
	});
});

function readSessionCommandDispatch(sessionSource: string): string {
	return sessionSource;
}

function readSessionModule(): string {
	return readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivitySession.ts');
}

suite('Magnus Live Activity contribution contracts', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('follow-up uses sendRequest on the snapshot sessionResource and never starts a second session', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		const handleStart = contribution.indexOf('private async _handleCommand');
		const handleEnd = contribution.indexOf('override dispose');
		assert.ok(handleStart >= 0 && handleEnd > handleStart, 'must locate _handleCommand');
		const handle = contribution.slice(handleStart, handleEnd);
		const session = readSessionCommandDispatch(readSessionModule());

		assert.match(handle, /acceptLiveActivityCommand\(snapshot, command\)/);
		assert.match(handle, /if \(!accepted\.ok\)/);
		assert.ok(handle.indexOf('acceptLiveActivityCommand') < handle.indexOf('applyMagnusLiveActivitySessionCommand'), 'fail-closed accept must run before session dispatch');

		assert.match(session, /const sessionResource = URI\.parse\(snapshot\.sessionResource\)/);
		assert.match(session, /deps\.chatService\.sendRequest\(sessionResource, \(command\.text \?\? ''\)\.trim\(\)\)/);
		assert.strictEqual((session.match(/sendRequest\(/g) || []).length, 1, 'follow-up must have exactly one sendRequest');
		assert.ok(session.indexOf("command.kind === 'followUp'") < session.indexOf('deps.chatService.sendRequest'), 'sendRequest is the follow-up path');

		assert.doesNotMatch(contribution, /startNewLocalSession/);
		assert.doesNotMatch(contribution, /vscode\.lm/);
		assert.doesNotMatch(handle, /invokeTool/);
		assert.match(contribution, /prebase\.test\.seedMagnusLiveActivityPending/);
		assert.doesNotMatch(session, /new.*Session/);
		assert.doesNotMatch(session, /URI\.parse\(command\.sessionResource\)/);
		assert.strictEqual((session.match(/sendRequest\(/g) || []).length, 1, 'sendRequest is the only message path');
	});

	test('approvals confirm the same tool invocation and do not invoke tools', () => {
		const session = readSessionCommandDispatch(readSessionModule());
		assert.match(session, /IChatToolInvocation\.confirmWith\(/);
		assert.match(session, /ToolConfirmKind\.UserAction/);
		assert.match(session, /ToolConfirmKind\.Denied/);
		assert.match(session, /toolCallId !== command\.interactionId/);
		assert.match(session, /command failed closed: session mismatch/);
		assert.match(session, /approval failed closed: stale interaction/);
		assert.match(session, /approval failed closed: invocation no longer pending/);
		assert.match(session, /approval failed closed: invocation missing/);
		assert.doesNotMatch(session, /invokeTool/);
		assert.doesNotMatch(session, /lm\.invokeTool/);
	});

	test('question pendingInteraction uses question.id; answers key by that id; destructive only when Red', () => {
		const sessionModule = readSessionModule();
		const extractStart = sessionModule.indexOf('export function extractPending');
		const extractEnd = sessionModule.indexOf('export async function applyMagnusLiveActivitySessionCommand');
		assert.ok(extractStart >= 0 && extractEnd > extractStart, 'must locate extractPending');
		const extract = sessionModule.slice(extractStart, extractEnd);
		assert.match(extract, /interactionId:\s*first\.id/);
		assert.match(extract, /resolveId:\s*part\.resolveId/);
		assert.ok(extract.indexOf('interactionId: first.id') < extract.indexOf('resolveId: part.resolveId'));
		assert.doesNotMatch(extract, /interactionId:\s*part\.resolveId/);
		assert.doesNotMatch(extract, /destructive:\s*false/);
		assert.match(extract, /\.\.\.\(destructive === true \? \{ destructive: true \} : \{\}\)/);
		assert.match(extract, /id:\s*option\.value\s*\|\|\s*option\.id/);

		const session = readSessionCommandDispatch(readSessionModule());
		assert.match(session, /notifyQuestionCarouselAnswer\(/);
		assert.match(session, /pending\.requestId\s*\?\?\s*last\?\.id/);
		assert.match(session, /\{\s*\[pending\.interactionId\]:\s*\{\s*selectedValue:\s*command\.optionId\s*\}\s*\}/);
		assert.match(session, /pending\.resolveId/);
		assert.match(session, /carousel missing\/used/);
		assert.match(session, /answer failed closed: stale interaction/);
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

	test('live activity simulate command is smoke-driver gated at the workbench boundary', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		const simulateStart = contribution.indexOf('id: \'prebase.magnus.liveActivity.simulate\'');
		assert.ok(simulateStart >= 0, 'must register simulate command');
		const simulateEnd = contribution.indexOf('registerAction2(class extends Action2 {', simulateStart + 1);
		const simulateBlock = contribution.slice(simulateStart, simulateEnd > simulateStart ? simulateEnd : contribution.length);
		assert.match(simulateBlock, /requireSmokeTestDriver\(accessor\.get\(IWorkbenchEnvironmentService\)\.enableSmokeTestDriver, 'prebase\.magnus\.liveActivity\.simulate'\)/);
		assert.ok(simulateBlock.indexOf('requireSmokeTestDriver') < simulateBlock.indexOf('simulateAction'), 'smoke guard must run before native simulateAction');
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
		const session = readSessionCommandDispatch(readSessionModule());
		assert.match(session, /deps\.chatService\.getSession\(sessionResource\)/);
		assert.ok(session.indexOf('URI.parse(snapshot.sessionResource)') < session.indexOf('deps.chatService.getSession'), 'approvals use the snapshot session');
		assert.match(contribution, /prebase\.magnus\.liveActivity\.display'\) === 'active' \? 'active' : 'builtin'/);
	});

	test('native connection is fail-closed until getNativeBackend reports native-appkit', () => {
		const contribution = readRepo('src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts');
		assert.match(contribution, /this\._nativeConnected = false/);
		assert.match(contribution, /getNativeBackend\(\)/);
		assert.match(contribution, /this\._nativeConnected = backend === 'native-appkit'/);
		assert.match(contribution, /connected: this\._nativeConnected/);
		assert.doesNotMatch(contribution, /connected:\s*true/);
		assert.match(readSessionModule(), /notifyQuestionCarouselAnswer/);
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
		assert.match(main, /enable-smoke-test-driver/);
		const simulateStart = main.indexOf('async simulateAction');
		const disposeStart = main.indexOf('async disposeNative');
		assert.ok(simulateStart >= 0 && disposeStart > simulateStart, 'must locate simulateAction');
		const simulate = main.slice(simulateStart, disposeStart);
		assert.match(simulate, /if \(!this\.environmentMainService\.args\['enable-smoke-test-driver'\]\)/);
		assert.ok(simulate.indexOf('enable-smoke-test-driver') < simulate.indexOf('this._native?.simulateAction'), 'simulateAction must be smoke-gated');
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
		assert.match(native, /setFrame:win display:YES animate:NO/);
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
		assert.match(target, /ScreenHasPhysicalNotch/);
		assert.match(target, /IsBuiltinScreen\(screen\)/);
		assert.match(native, /CGDisplayIsBuiltin/);
		assert.match(target, /\[NSScreen mainScreen\]/);

		const layout = native.slice(layoutStart, controlsStart);
		assert.match(layout, /screen\.safeAreaInsets/);
		assert.match(layout, /screen\.auxiliaryTopLeftArea/);
		assert.match(layout, /screen\.auxiliaryTopRightArea/);
		assert.match(layout, /topY = NSMaxY\(frame\)/);
		assert.match(layout, /topY - height/);
		assert.match(layout, /hasShadow = !notched/);
		assert.doesNotMatch(layout, /topY - h - 8/);
		assert.doesNotMatch(layout, /NSMaxY\(frame\) - h - 8/);
		assert.match(layout, /ScreenHasPhysicalNotch\(screen\)/);
		assert.match(native, /NSMinX\(auxRight\) > NSMaxX\(auxLeft\)/);
		assert.match(layout, /self\.content\.housingWidth = 0/);
		assert.match(layout, /NSMidX\(frame\) - w \/ 2\.0/);
		assert.match(layout, /LiveActivityWindowLevel/);
		assert.doesNotMatch(layout, /MacBook Pro|MacBookAir|14-inch|16-inch/);
		assert.match(native, /wingPathInRect/);
		assert.match(native, /if \(self\.notched\)/);
	});

	test('non-mac stub exports unavailable and does not create a panel', () => {
		const stub = readRepo('native/prebase-live-activity/src/live_activity_stub.cc');
		assert.match(stub, /exports\.Set\("unavailable"/);
		assert.doesNotMatch(stub, /setSnapshot|setPresentation|NSPanel|AppKit/);
	});
});

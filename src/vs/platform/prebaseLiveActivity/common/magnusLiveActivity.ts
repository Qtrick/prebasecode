/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Projection of the canonical Magnus chat session. Not a second agent. */

export const MAGNUS_LIVE_ACTIVITY_CHANNEL = 'prebaseMagnusLiveActivity';

export const MAGNUS_PARTICIPANT_PREFIX = 'prebase.magnus.';

export type MagnusLiveActivityMode = 'background' | 'alwaysWorking' | 'attentionOnly' | 'off';
export type MagnusLiveActivityDisplay = 'builtin' | 'active';

export type MagnusLiveActivityStatus =
	| 'idle'
	| 'working'
	| 'waiting'
	| 'attention'
	| 'completed'
	| 'failed'
	| 'disconnected';

export type MagnusLiveActivityPanelState =
	| 'hidden'
	| 'collapsed'
	| 'hoverPreview'
	| 'pinned'
	| 'attention'
	| 'completedTransient';

export interface MagnusLiveActivityAction {
	readonly id: string;
	readonly label: string;
	readonly at: number;
}

export interface MagnusLiveActivityPendingInteraction {
	readonly kind: 'approval' | 'question';
	readonly interactionId: string;
	readonly requestId?: string;
	readonly resolveId?: string;
	readonly title: string;
	readonly message: string;
	readonly options?: readonly { id: string; label: string }[];
	readonly destructive?: boolean;
}

export interface MagnusLiveActivityDiffSummary {
	readonly files: number;
	readonly additions?: number;
	readonly deletions?: number;
	/** True only when counts come from Magnus edit events, not a workspace git poll. */
	readonly attributedToMagnus: boolean;
}

export interface MagnusLiveActivitySnapshot {
	readonly revision: number;
	readonly sessionId: string | undefined;
	readonly sessionResource: string | undefined;
	readonly startedAt: number | undefined;
	readonly status: MagnusLiveActivityStatus;
	readonly taskTitle?: string;
	readonly currentActivity?: string;
	readonly recentActions: readonly MagnusLiveActivityAction[];
	readonly latestShortMessage?: string;
	readonly workspaceDiff?: MagnusLiveActivityDiffSummary;
	readonly terminalCount?: number;
	readonly testState?: 'running' | 'passed' | 'failed';
	readonly pendingInteraction?: MagnusLiveActivityPendingInteraction;
	readonly connected: boolean;
	readonly prebaseForeground: boolean;
	readonly screenLocked?: boolean;
	readonly presentationLabel?: string;
}

export const LIVE_ACTIVITY_HOVER_OPEN_DELAY_MS = 150;
export const LIVE_ACTIVITY_EXIT_GRACE_MS = 100;
export const LIVE_ACTIVITY_POINTER_SAMPLE_MS = 50;
export const LIVE_ACTIVITY_COMPLETED_HOLD_MS = 8_000;
export const LIVE_ACTIVITY_MAX_ACTIONS = 4;
export const LIVE_ACTIVITY_MAX_MESSAGE_CHARS = 160;

export interface MagnusLiveActivitySessionInput {
	readonly sessionId: string;
	readonly sessionResource: string;
	readonly startedAt: number;
	readonly title?: string;
	readonly isInProgress: boolean;
	readonly needsInput?: boolean;
	readonly currentActivity?: string;
	readonly recentActions?: readonly MagnusLiveActivityAction[];
	readonly latestShortMessage?: string;
	readonly error?: string;
	readonly completed?: boolean;
	readonly failed?: boolean;
	readonly pendingInteraction?: MagnusLiveActivityPendingInteraction;
	readonly workspaceDiff?: MagnusLiveActivityDiffSummary;
	readonly terminalCount?: number;
	readonly testState?: 'running' | 'passed' | 'failed';
}

const SECRET_PATTERN = /\b(authorization|cookie|set-cookie|token|access[_-]?token|api[_-]?key|client[_-]?secret|secret|password|bearer)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;

export function redactLiveActivityText(value: string | undefined): string {
	if (!value) {
		return '';
	}
	return value
		.replace(SECRET_PATTERN, '$1=[redacted]')
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
		.replace(/\bAIza[A-Za-z0-9_-]{10,}\b/g, '[redacted]')
		.slice(0, LIVE_ACTIVITY_MAX_MESSAGE_CHARS);
}

export function isMagnusParticipantId(agentId: string | undefined): boolean {
	return typeof agentId === 'string' && agentId.startsWith(MAGNUS_PARTICIPANT_PREFIX);
}

/** Primary visible Magnus run: busy session wins, else most recently messaged Magnus session. */
export function selectPrimaryMagnusSession<T extends {
	readonly isMagnus: boolean;
	readonly isBusy: boolean;
	readonly lastMessageDate: number;
}>(sessions: readonly T[]): T | undefined {
	let fallback: T | undefined;
	for (const session of sessions) {
		if (!session.isMagnus) {
			continue;
		}
		if (session.isBusy) {
			return session;
		}
		if (!fallback || session.lastMessageDate > fallback.lastMessageDate) {
			fallback = session;
		}
	}
	return fallback;
}

export function buildMagnusLiveActivitySnapshot(
	input: MagnusLiveActivitySessionInput | undefined,
	options: {
		revision: number;
		prebaseForeground: boolean;
		connected: boolean;
		screenLocked?: boolean;
	},
): MagnusLiveActivitySnapshot {
	if (!options.connected) {
		return {
			revision: options.revision,
			sessionId: input?.sessionId,
			sessionResource: input?.sessionResource,
			startedAt: input?.startedAt,
			status: 'disconnected',
			taskTitle: input?.title,
			recentActions: [],
			connected: false,
			prebaseForeground: options.prebaseForeground,
			screenLocked: options.screenLocked,
			presentationLabel: 'Magnus status unavailable',
		};
	}
	if (!input) {
		return {
			revision: options.revision,
			sessionId: undefined,
			sessionResource: undefined,
			startedAt: undefined,
			status: 'idle',
			recentActions: [],
			connected: true,
			prebaseForeground: options.prebaseForeground,
			screenLocked: options.screenLocked,
			presentationLabel: 'Magnus',
		};
	}

	let status: MagnusLiveActivityStatus = 'idle';
	if (input.failed) {
		status = 'failed';
	} else if (input.pendingInteraction || input.needsInput) {
		status = 'attention';
	} else if (input.isInProgress) {
		status = input.currentActivity ? 'working' : 'waiting';
	} else if (input.completed) {
		status = 'completed';
	}

	const hideDetails = Boolean(options.screenLocked);
	const actions = (input.recentActions ?? []).slice(-LIVE_ACTIVITY_MAX_ACTIONS).map(action => ({
		id: action.id,
		label: redactLiveActivityText(action.label),
		at: action.at,
	}));

	const snapshot: MagnusLiveActivitySnapshot = {
		revision: options.revision,
		sessionId: input.sessionId,
		sessionResource: input.sessionResource,
		startedAt: input.startedAt,
		status,
		taskTitle: hideDetails ? undefined : input.title,
		currentActivity: hideDetails ? undefined : redactLiveActivityText(input.currentActivity),
		recentActions: hideDetails ? [] : actions,
		latestShortMessage: hideDetails ? undefined : redactLiveActivityText(input.latestShortMessage),
		workspaceDiff: input.workspaceDiff,
		terminalCount: input.terminalCount,
		testState: input.testState,
		pendingInteraction: hideDetails ? undefined : input.pendingInteraction && {
			...input.pendingInteraction,
			title: redactLiveActivityText(input.pendingInteraction.title),
			message: redactLiveActivityText(input.pendingInteraction.message),
		},
		connected: true,
		prebaseForeground: options.prebaseForeground,
		screenLocked: options.screenLocked,
		presentationLabel: '',
	};
	return { ...snapshot, presentationLabel: collapsedStatusLabel(snapshot) };
}

export function shouldShowLiveActivity(
	mode: MagnusLiveActivityMode,
	snapshot: MagnusLiveActivitySnapshot,
): boolean {
	if (mode === 'off' || !snapshot.connected) {
		return false;
	}
	if (snapshot.status === 'idle' && !snapshot.sessionId) {
		return false;
	}
	const active = snapshot.status === 'working' || snapshot.status === 'waiting' || snapshot.status === 'attention'
		|| snapshot.status === 'completed' || snapshot.status === 'failed';
	if (!active) {
		return false;
	}
	if (mode === 'attentionOnly') {
		return snapshot.status === 'attention';
	}
	if (mode === 'alwaysWorking') {
		return true;
	}
	return !snapshot.prebaseForeground;
}

export function resolveLiveActivityPanelState(args: {
	visible: boolean;
	hovering: boolean;
	pinned: boolean;
	snapshot: MagnusLiveActivitySnapshot;
	now: number;
	hoverSince?: number;
	lastInsideAt?: number;
	openDelayMs?: number;
	exitGraceMs?: number;
}): MagnusLiveActivityPanelState {
	if (!args.visible) {
		return 'hidden';
	}
	if (args.pinned) {
		return 'pinned';
	}
	if (args.snapshot.status === 'attention') {
		return 'attention';
	}
	if (args.snapshot.status === 'completed' || args.snapshot.status === 'failed') {
		return 'completedTransient';
	}
	const openDelay = args.openDelayMs ?? LIVE_ACTIVITY_HOVER_OPEN_DELAY_MS;
	const exitGrace = args.exitGraceMs ?? LIVE_ACTIVITY_EXIT_GRACE_MS;
	if (args.hovering && args.hoverSince !== undefined && args.now - args.hoverSince >= openDelay) {
		return 'hoverPreview';
	}
	if (!args.hovering && args.lastInsideAt !== undefined && args.now - args.lastInsideAt < exitGrace) {
		return 'hoverPreview';
	}
	return 'collapsed';
}

export type LiveActivityCommandKind = 'followUp' | 'approve' | 'deny' | 'answer' | 'openInPrebase' | 'pin' | 'unpin';

export interface LiveActivityCommand {
	readonly kind: LiveActivityCommandKind;
	readonly sessionId?: string;
	readonly sessionResource?: string;
	readonly revision?: number;
	readonly interactionId?: string;
	readonly text?: string;
	readonly optionId?: string;
}

export type LiveActivityCommandResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: string };

export function acceptLiveActivityCommand(
	snapshot: MagnusLiveActivitySnapshot,
	command: LiveActivityCommand,
): LiveActivityCommandResult {
	if (!snapshot.connected) {
		return { ok: false, reason: 'disconnected' };
	}
	if (command.revision !== undefined && command.revision !== snapshot.revision) {
		return { ok: false, reason: 'stale-revision' };
	}
	if (command.kind === 'openInPrebase' || command.kind === 'pin' || command.kind === 'unpin') {
		if (command.sessionId && snapshot.sessionId && command.sessionId !== snapshot.sessionId) {
			return { ok: false, reason: 'session-mismatch' };
		}
		return { ok: true };
	}
	if (!snapshot.sessionId || !snapshot.sessionResource) {
		return { ok: false, reason: 'no-session' };
	}
	if (command.sessionId && command.sessionId !== snapshot.sessionId) {
		return { ok: false, reason: 'session-mismatch' };
	}
	if (command.sessionResource && command.sessionResource !== snapshot.sessionResource) {
		return { ok: false, reason: 'session-mismatch' };
	}
	if (command.kind === 'followUp') {
		const text = (command.text ?? '').trim();
		if (!text) {
			return { ok: false, reason: 'empty-message' };
		}
		return { ok: true };
	}
	if (command.kind === 'approve' || command.kind === 'deny' || command.kind === 'answer') {
		const pending = snapshot.pendingInteraction;
		if (!pending) {
			return { ok: false, reason: 'no-pending-interaction' };
		}
		if (!command.interactionId || command.interactionId !== pending.interactionId) {
			return { ok: false, reason: 'stale-interaction' };
		}
		if (command.kind === 'answer' && pending.kind !== 'question') {
			return { ok: false, reason: 'not-a-question' };
		}
		if ((command.kind === 'approve' || command.kind === 'deny') && pending.kind !== 'approval') {
			return { ok: false, reason: 'not-an-approval' };
		}
		return { ok: true };
	}
	return { ok: false, reason: 'unknown-command' };
}

export interface LiveActivityScreenMetrics {
	readonly width: number;
	readonly height: number;
	readonly scaleFactor: number;
	readonly safeAreaTop: number;
	readonly auxLeftWidth: number;
	readonly auxRightWidth: number;
	readonly auxLeftHeight: number;
	readonly auxRightHeight: number;
}

export interface LiveActivityGeometry {
	readonly notched: boolean;
	readonly cameraHousingWidth: number;
	readonly cameraHousingHeight: number;
	readonly leftWing: { x: number; y: number; width: number; height: number };
	readonly rightWing: { x: number; y: number; width: number; height: number };
	readonly pill: { x: number; y: number; width: number; height: number };
	readonly hit: { x: number; y: number; width: number; height: number };
}

export function deriveLiveActivityGeometry(screen: LiveActivityScreenMetrics): LiveActivityGeometry {
	const scale = Number.isFinite(screen.scaleFactor) && screen.scaleFactor > 0 ? screen.scaleFactor : 1;
	const width = Math.max(1, screen.width);
	const safeTop = Math.max(0, screen.safeAreaTop);
	const auxLeft = Math.max(0, screen.auxLeftWidth);
	const auxRight = Math.max(0, screen.auxRightWidth);
	const auxLeftH = Math.max(0, screen.auxLeftHeight);
	const auxRightH = Math.max(0, screen.auxRightHeight);
	const notched = safeTop > 8 && auxLeft > 40 && auxRight > 40;
	const collapsedH = 32 / scale;
	if (notched) {
		const housingW = Math.max(24, width - auxLeft - auxRight);
		const housingH = Math.max(safeTop, Math.max(auxLeftH, auxRightH, 32 / scale));
		const leftX = Math.max(0, auxLeft - 118);
		const leftW = Math.max(72, auxLeft - leftX - 4);
		const rightX = auxLeft + housingW + 4;
		const rightW = Math.max(72, Math.min(118, width - rightX - 8));
		const y = 0;
		return {
			notched: true,
			cameraHousingWidth: housingW,
			cameraHousingHeight: housingH,
			leftWing: { x: leftX, y, width: leftW, height: Math.max(collapsedH, housingH) },
			rightWing: { x: rightX, y, width: rightW, height: Math.max(collapsedH, housingH) },
			pill: { x: leftX, y, width: leftW + housingW + rightW, height: Math.max(collapsedH, housingH) },
			hit: { x: leftX, y, width: leftW + 4, height: Math.max(collapsedH, housingH) },
		};
	}
	const pillW = 220;
	const pillH = 28;
	const x = Math.round((width - pillW) / 2);
	return {
		notched: false,
		cameraHousingWidth: 0,
		cameraHousingHeight: 0,
		leftWing: { x: 0, y: 0, width: 0, height: 0 },
		rightWing: { x: 0, y: 0, width: 0, height: 0 },
		pill: { x, y: 6, width: pillW, height: pillH },
		hit: { x, y: 6, width: pillW, height: pillH },
	};
}

export function collapsedStatusLabel(snapshot: MagnusLiveActivitySnapshot, now = Date.now()): string {
	if (snapshot.status === 'disconnected') {
		return 'Magnus status unavailable';
	}
	if (snapshot.status === 'attention') {
		return snapshot.pendingInteraction?.kind === 'question' ? 'Magnus needs an answer' : 'Magnus needs approval';
	}
	if (snapshot.status === 'failed') {
		return snapshot.latestShortMessage ? `Magnus stopped · ${snapshot.latestShortMessage}` : 'Magnus stopped';
	}
	if (snapshot.status === 'completed') {
		const files = snapshot.workspaceDiff?.files;
		return files ? `Finished · ${files} files` : 'Finished';
	}
	const elapsed = snapshot.startedAt ? formatElapsed(now - snapshot.startedAt) : '';
	if (snapshot.testState === 'running') {
		return elapsed ? `Running tests · ${elapsed}` : 'Running tests';
	}
	if (snapshot.currentActivity) {
		return elapsed ? `${snapshot.currentActivity} · ${elapsed}` : snapshot.currentActivity;
	}
	if (elapsed) {
		return elapsed;
	}
	return snapshot.taskTitle || 'Magnus';
}

export function formatElapsed(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) {
		return '';
	}
	const totalSec = Math.floor(ms / 1000);
	const hours = Math.floor(totalSec / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m`;
	}
	return `${Math.max(1, totalSec)}s`;
}

export interface NativeLiveActivityHandle {
	setSnapshot(snapshot: MagnusLiveActivitySnapshot): void;
	setPresentation(state: { visible: boolean; pinned: boolean; reducedMotion: boolean; display: MagnusLiveActivityDisplay }): void;
	dispose(): void;
}

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

/**
 * Canonical Live Activity presentation states (one source of truth).
 * Native AppKit booleans must resolve to one of these semantics.
 *
 * Mapping:
 * - hidden: not shown
 * - compact: collapsed wings / pill (alias: collapsed)
 * - peek: hover dwell preview (alias: hoverPreview)
 * - interactive: sticky expanded composer surface (alias: pinned when user-pinned)
 * - attentionPeek: glanceable attention without full composer
 * - attentionCompact: attention still active after sticky Escape (native activePresentationState)
 * - attentionInteractive: attention content while user remains interactive
 * - completedTransient / failedTransient: brief terminal summary
 */
export type MagnusLiveActivityPanelState =
	| 'hidden'
	| 'compact'
	| 'collapsed' // legacy alias of compact
	| 'peek'
	| 'hoverPreview' // legacy alias of peek
	| 'interactive'
	| 'pinned' // sticky interactive
	| 'attentionPeek'
	| 'attention' // legacy alias of attentionPeek
	| 'attentionCompact'
	| 'attentionInteractive'
	| 'completedTransient'
	| 'failedTransient';

export interface MagnusLiveActivityAction {
	readonly id: string;
	readonly label: string;
	readonly at: number;
	readonly status?: 'running' | 'passed' | 'failed' | 'other';
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
	readonly hideDetails?: boolean;
	readonly presentationLabel?: string;
	/**
	 * Sticky Escape/collapse dismiss for attention. Serialized so native can restore
	 * attentionCompact across controller reload / snapshot republish.
	 */
	readonly userDismissedAttention?: boolean;
}

export const LIVE_ACTIVITY_HOVER_OPEN_DELAY_MS = 180;
export const LIVE_ACTIVITY_EXIT_GRACE_MS = 250;
export const LIVE_ACTIVITY_COMPLETED_HOLD_MS = 8_000;
export const LIVE_ACTIVITY_MAX_ACTIONS = 4;
export const LIVE_ACTIVITY_MAX_MESSAGE_CHARS = 160;

/** Geometry metrics matching native/prebase-live-activity/src/live_activity.mm (authoritative). */
export const LIVE_ACTIVITY_COLLAPSED_HEIGHT = 34;
export const LIVE_ACTIVITY_WING_WIDTH_MIN = 52;
/** Stable compact/peek wing — content must not resize the island. */
export const LIVE_ACTIVITY_WING_WIDTH_DEFAULT = 64;
export const LIVE_ACTIVITY_WING_WIDTH = LIVE_ACTIVITY_WING_WIDTH_DEFAULT;
export const LIVE_ACTIVITY_CAMERA_HOUSING_MIN = 24;
/** Overflow guard — natural height is measured; this is not the default slab. */
export const LIVE_ACTIVITY_EXPANDED_HEIGHT_MIN = 72;
export const LIVE_ACTIVITY_EXPANDED_HEIGHT_MAX = 220;
export const LIVE_ACTIVITY_EXPANDED_HEIGHT = 128;
/** Fixed peek body band below the notch (matches native kPeekBodyHeight). */
export const LIVE_ACTIVITY_PEEK_BODY_HEIGHT = 32;
/** Legacy alias: width pad for option chip rows. Used for contract check parity. */
export const LIVE_ACTIVITY_EXPANDED_WIDTH_PAD = 28;
/** Width pad for STANDARD bucket: working interactive, terminal states. */
export const LIVE_ACTIVITY_EXPANDED_WIDTH_STANDARD_PAD = 36;
/** Width pad for WIDE bucket: approval, question, long content. */
export const LIVE_ACTIVITY_EXPANDED_WIDTH_WIDE_PAD = 84;
export const LIVE_ACTIVITY_EXPANDED_MIN_WIDTH = LIVE_ACTIVITY_WING_WIDTH_DEFAULT * 2 + LIVE_ACTIVITY_CAMERA_HOUSING_MIN;
export const LIVE_ACTIVITY_PILL_WIDTH = 228;
export const LIVE_ACTIVITY_PILL_HEIGHT = 34;
export const LIVE_ACTIVITY_NOTCH_MIN_SAFE_TOP = 8;
export const LIVE_ACTIVITY_NOTCH_MIN_AUX_WIDTH = 40;
/** Compact wing copy budget (~44pt usable at 11pt system font). */
export const LIVE_ACTIVITY_COMPACT_LABEL_MAX_CHARS = 9;

/** Deterministic populated Magnus content for visual acceptance (not production copy). */
export function createMagnusLiveActivityVisualFixture(
	variant: 'working' | 'question' | 'approval' | 'long' | 'completed' | 'failed' | 'waiting',
	options: { revision: number; sessionId?: string; sessionResource?: string },
): MagnusLiveActivitySnapshot {
	const base = {
		revision: options.revision,
		sessionId: options.sessionId ?? 'visual-fixture-session',
		sessionResource: options.sessionResource ?? 'inmemory://magnus-visual-fixture',
		startedAt: Date.now() - 95_000,
		connected: true,
		prebaseForeground: true,
		screenLocked: false,
		hideDetails: false,
		recentActions: [
			{ id: 'a1', label: 'Edited graphEditor.ts', at: Date.now() - 40_000 },
			{ id: 'a2', label: 'Ran graph interaction suites', at: Date.now() - 25_000 },
			{ id: 'a3', label: 'Checked Temporal layout recovery', at: Date.now() - 10_000 },
		] as const,
		taskTitle: 'Improve graph renderer',
		workspaceDiff: { files: 4, additions: 86, deletions: 31, attributedToMagnus: true },
		terminalCount: 1,
	};

	switch (variant) {
		case 'waiting':
			return {
				...base,
				status: 'waiting',
				currentActivity: 'Waiting for input',
				latestShortMessage: 'Magnus needs a layout choice before continuing acceptance.',
				presentationLabel: 'Waiting',
			};
		case 'completed':
			return {
				...base,
				status: 'completed',
				currentActivity: 'Graph acceptance pass complete',
				latestShortMessage: 'All graph interaction suites passed.',
				testState: 'passed',
				presentationLabel: 'Completed',
			};
		case 'failed':
			return {
				...base,
				status: 'failed',
				currentActivity: 'Graph acceptance failed',
				latestShortMessage: 'Temporal layout recovery timed out on the large fixture.',
				testState: 'failed',
				presentationLabel: 'Failed',
			};
		case 'question':
			return {
				...base,
				status: 'attention',
				currentActivity: 'Awaiting layout decision',
				latestShortMessage: 'Choose how Magnus should finish the remaining acceptance cases.',
				presentationLabel: 'Needs input',
				pendingInteraction: {
					kind: 'question',
					interactionId: 'visual-question-1',
					title: 'Which layout should Magnus use for the remaining graph acceptance?',
					message: 'This choice affects Fit View metrics and Temporal Full Map readability checks.',
					options: [
						{ id: 'organic', label: 'Organic' },
						{ id: 'sphere', label: 'Sphere' },
						{ id: 'constellation', label: 'Constellation' },
						{ id: 'clustered', label: 'Clustered' },
					],
				},
			};
		case 'approval':
			return {
				...base,
				status: 'attention',
				currentActivity: 'Awaiting approval',
				latestShortMessage: 'Magnus is ready to run the graph acceptance suite.',
				presentationLabel: 'Approval needed',
				pendingInteraction: {
					kind: 'approval',
					interactionId: 'visual-approval-1',
					title: 'Run the graph acceptance suite?',
					message: 'This will execute the repository\'s graph acceptance tests and update the local evidence artifacts.',
					destructive: false,
				},
			};
		case 'long':
			return {
				...base,
				status: 'working',
				currentActivity: 'Validating long-form graph interaction recovery across Temporal Full Map, Network Fit View, and multi-layout acceptance while preserving viewport readability and idle rotation constraints for large projects',
				latestShortMessage: 'Magnus finished the graph interaction pass and is validating the remaining acceptance cases against organic, sphere, constellation, and clustered layouts with deliberately long diagnostic commentary that must remain inside the island content viewport without pushing footer controls outside the silhouette.',
				presentationLabel: 'Working',
				testState: 'running',
			};
		case 'working':
		default:
			return {
				...base,
				status: 'working',
				currentActivity: 'Running graph interaction tests',
				latestShortMessage: 'Magnus finished the graph interaction pass and is validating the remaining acceptance cases.',
				recentActions: [],
				presentationLabel: 'Working',
				testState: 'running',
			};
	}
}

export function computeLiveActivityExpandedHeight(args: {
	bandHeight: number;
	hasActivity?: boolean;
	actionsCount?: number;
	hasPendingTitle?: boolean;
	hasPendingMessage?: boolean;
	hasLatestMessage?: boolean;
	hasMetrics?: boolean;
	pendingKind?: 'approval' | 'question' | string;
	hasOptions?: boolean;
	/** When known, matches native one-vs-two option row sizing; otherwise assumes two rows. */
	optionsCount?: number;
	pinned?: boolean;
	peekOnly?: boolean;
}): number {
	if (args.peekOnly && !args.pinned) {
		// Native peek uses a fixed body band — message length must not reflow geometry.
		return args.bandHeight + LIVE_ACTIVITY_PEEK_BODY_HEIGHT;
	}
	// Mirror native estimate budgets (native still measures for layout; this is for tests/contracts).
	let h = args.bandHeight + 5;
	h += 15 + 3; // Header row + gap
	const hasPending = Boolean(args.hasPendingTitle || args.hasPendingMessage || args.pendingKind === 'approval' || args.pendingKind === 'question');
	if (args.hasPendingTitle) {
		h += 24;
	}
	if (args.hasPendingMessage) {
		h += 32;
	}
	if (!hasPending) {
		// Native renders current activity OR the latest short message, never both.
		if (args.hasActivity) {
			h += 24;
		} else if (args.hasLatestMessage) {
			h += 22;
		}
		if (args.actionsCount && args.actionsCount > 0) {
			h += Math.min(args.actionsCount, 3) * 14;
		}
		if (args.hasMetrics) {
			h += 12;
		}
	}
	h += 3;
	const hasOptions = args.pendingKind === 'question' && Boolean(args.hasOptions);
	const hasApproval = args.pendingKind === 'approval';
	const showInput = !args.peekOnly && !hasOptions;

	if (hasOptions) {
		const opts = Math.min(Math.max(args.optionsCount ?? 4, 1), 4);
		h += opts > 2 ? 52 : 28;
	}
	if (hasApproval) {
		h += 28;
	}
	if (showInput) {
		h += 30;
	} else if (!hasOptions && !hasApproval) {
		h += 28;
	}
	h += 7;
	return Math.min(LIVE_ACTIVITY_EXPANDED_HEIGHT_MAX, Math.max(LIVE_ACTIVITY_EXPANDED_HEIGHT_MIN, h));
}

/** Wings are fixed for visual stability; text never drives island width. */
export function computeLiveActivityWingWidth(_rawTextWidth?: number): number {
	return LIVE_ACTIVITY_WING_WIDTH;
}

export function calculateNextElapsedBoundaryDelayMs(now: number, startedAt: number | undefined): number | undefined {
	if (!startedAt || !Number.isFinite(startedAt) || startedAt > now) {
		return undefined;
	}
	const elapsedMs = now - startedAt;
	const elapsedSec = Math.floor(elapsedMs / 1000);
	if (elapsedSec < 60) {
		const secInWindow = elapsedSec % 5;
		const nextSec = 5 - secInWindow;
		const msToNext = (nextSec * 1000) - (elapsedMs % 1000);
		return Math.max(250, msToNext);
	}
	const secInMin = elapsedSec % 60;
	const nextMinSec = 60 - secInMin;
	const msToNext = (nextMinSec * 1000) - (elapsedMs % 1000);
	return Math.max(500, msToNext);
}

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
const BEARER_HEADER_PATTERN = /\bbearer\s+[A-Za-z0-9_\-\.]{15,}\b/gi;
const JWT_PATTERN = /\bey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const TOKEN_PREFIX_PATTERN = /\b(gh[pousr]|glpat|xox[baprs])[-_][A-Za-z0-9_-]{10,}\b|\bgithub_pat_[A-Za-z0-9_]{10,}\b|\bsbp_[A-Za-z0-9_-]{20,}\b/g;
const AWS_KEY_PATTERN = /\b(AKIA|ASIA|AROA)[0-9A-Z]{16}\b/g;
const PEM_PATTERN = /-----BEGIN [A-Z\s]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z\s]+ PRIVATE KEY-----/g;

export function redactLiveActivityText(value: string | undefined): string {
	if (!value) {
		return '';
	}
	return value
		.replace(PEM_PATTERN, '[redacted]')
		.replace(SECRET_PATTERN, '$1=[redacted]')
		.replace(BEARER_HEADER_PATTERN, 'Bearer [redacted]')
		.replace(JWT_PATTERN, '[redacted]')
		.replace(TOKEN_PREFIX_PATTERN, '[redacted]')
		.replace(AWS_KEY_PATTERN, '[redacted]')
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
		.replace(/\bAIza[A-Za-z0-9_-]{10,}\b/g, '[redacted]')
		.replace(/\s+/g, ' ')
		.trim()
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
		hideDetails?: boolean;
	},
): MagnusLiveActivitySnapshot {
	if (!options.connected) {
		return {
			revision: options.revision,
			sessionId: input?.sessionId,
			sessionResource: input?.sessionResource,
			startedAt: input?.startedAt,
			status: 'disconnected',
			taskTitle: options.screenLocked || options.hideDetails ? undefined : redactLiveActivityText(input?.title),
			recentActions: [],
			connected: false,
			prebaseForeground: options.prebaseForeground,
			screenLocked: options.screenLocked,
			hideDetails: options.hideDetails,
			presentationLabel: 'Offline',
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
			hideDetails: options.hideDetails,
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

	const hide = Boolean(options.screenLocked || options.hideDetails);
	const actions = (input.recentActions ?? []).slice(-LIVE_ACTIVITY_MAX_ACTIONS).map(action => ({
		id: action.id,
		label: redactLiveActivityText(action.label),
		at: action.at,
		...(action.status ? { status: action.status } : {}),
	}));

	const snapshot: MagnusLiveActivitySnapshot = {
		revision: options.revision,
		sessionId: input.sessionId,
		sessionResource: input.sessionResource,
		startedAt: input.startedAt,
		status,
		taskTitle: hide ? undefined : redactLiveActivityText(input.title),
		currentActivity: hide ? undefined : redactLiveActivityText(input.currentActivity),
		recentActions: hide ? [] : actions,
		latestShortMessage: hide ? undefined : redactLiveActivityText(input.latestShortMessage),
		workspaceDiff: hide ? undefined : input.workspaceDiff,
		terminalCount: hide ? undefined : input.terminalCount,
		testState: hide ? undefined : input.testState,
		pendingInteraction: hide ? undefined : input.pendingInteraction && {
			...input.pendingInteraction,
			title: redactLiveActivityText(input.pendingInteraction.title),
			message: redactLiveActivityText(input.pendingInteraction.message),
			options: input.pendingInteraction.options?.map(option => ({
				...option,
				label: redactLiveActivityText(option.label) || option.id,
			})),
		},
		connected: true,
		prebaseForeground: options.prebaseForeground,
		screenLocked: options.screenLocked,
		hideDetails: options.hideDetails,
		presentationLabel: '',
	};
	// Compact wing uses intentional short tokens — never arbitrary agent prose.
	return { ...snapshot, presentationLabel: compactWingLabel(snapshot) };
}

export function shouldShowLiveActivity(
	mode: MagnusLiveActivityMode,
	snapshot: MagnusLiveActivitySnapshot,
): boolean {
	if (mode === 'off' || !snapshot.connected) {
		return false;
	}
	// Lock screen: hide entirely — redacting text alone is insufficient privacy.
	if (snapshot.screenLocked) {
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
	// Always show when there is attention (approval/question) regardless of foreground state.
	// This ensures users can respond to Magnus requests even while PreBase is active.
	if (snapshot.status === 'attention') {
		return true;
	}
	if (mode === 'alwaysWorking') {
		return true;
	}
	// background mode: show when PreBase is NOT foregrounded, OR when there is an active
	// working/waiting session. This ensures users can access the notch for quick messaging
	// and session monitoring while PreBase is active, without requiring them to switch away.
	return !snapshot.prebaseForeground || snapshot.status === 'working' || snapshot.status === 'waiting';
}

/**
 * Pure resolver for Live Activity presentation.
 * Production diagnostics and native semantic transitions must agree with this model.
 *
 * Attention must NEVER downgrade an active Interactive/pinned surface to Peek.
 */
export function resolveLiveActivityPanelState(args: {
	visible: boolean;
	hovering: boolean;
	pinned: boolean;
	/** True when the panel is already in Interactive (expanded, not peek-only). */
	interactive?: boolean;
	/**
	 * Native Escape/collapse sticky-dismiss for attention: keep compact across
	 * attention snapshot republish until the user clicks Interactive or attention clears.
	 */
	userDismissedAttention?: boolean;
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
	const attention = args.snapshot.status === 'attention';
	const interactive = Boolean(args.pinned || args.interactive);
	if (interactive) {
		return attention ? 'attentionInteractive' : (args.pinned ? 'pinned' : 'interactive');
	}
	if (attention) {
		// Mirror native activePresentationState: sticky Escape is attentionCompact, not peek and not plain compact.
		if (args.userDismissedAttention) {
			return 'attentionCompact';
		}
		return 'attentionPeek';
	}
	if (args.snapshot.status === 'failed') {
		return 'failedTransient';
	}
	if (args.snapshot.status === 'completed') {
		return 'completedTransient';
	}
	const openDelay = args.openDelayMs ?? LIVE_ACTIVITY_HOVER_OPEN_DELAY_MS;
	const exitGrace = args.exitGraceMs ?? LIVE_ACTIVITY_EXIT_GRACE_MS;
	if (args.hovering && args.hoverSince !== undefined && args.now - args.hoverSince >= openDelay) {
		return 'peek';
	}
	if (!args.hovering && args.lastInsideAt !== undefined && args.now - args.lastInsideAt < exitGrace) {
		return 'peek';
	}
	return 'compact';
}

/** Normalize legacy panel-state aliases to the canonical vocabulary. */
export function canonicalizeLiveActivityPanelState(state: MagnusLiveActivityPanelState): MagnusLiveActivityPanelState {
	switch (state) {
		case 'collapsed':
			return 'compact';
		case 'hoverPreview':
			return 'peek';
		case 'attention':
			return 'attentionPeek';
		default:
			return state;
	}
}

export type LiveActivityCommandKind = 'followUp' | 'approve' | 'deny' | 'answer' | 'openInPrebase' | 'pin' | 'unpin' | 'dismissAttention';

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
	// Lock screen: reject all commands — panel is hidden and must not mutate session state.
	if (snapshot.screenLocked) {
		return { ok: false, reason: 'screen-locked' };
	}
	if (command.revision !== undefined && command.revision !== snapshot.revision) {
		const pending = snapshot.pendingInteraction;
		const interactionBound = command.kind === 'approve' || command.kind === 'deny' || command.kind === 'answer';
		const kindMatches = command.kind === 'answer'
			? pending?.kind === 'question'
			: (command.kind === 'approve' || command.kind === 'deny') ? pending?.kind === 'approval' : false;
		if (!interactionBound || !kindMatches || !command.interactionId || command.interactionId !== pending?.interactionId) {
			return { ok: false, reason: 'stale-revision' };
		}
	}
	if (command.kind === 'openInPrebase' || command.kind === 'pin' || command.kind === 'unpin' || command.kind === 'dismissAttention') {
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
		if (command.kind === 'answer') {
			if (pending.kind !== 'question') {
				return { ok: false, reason: 'not-a-question' };
			}
			if (!command.optionId) {
				return { ok: false, reason: 'missing-option' };
			}
			if (pending.options && !pending.options.some(option => option.id === command.optionId)) {
				return { ok: false, reason: 'stale-option' };
			}
			return { ok: true };
		}
		if (pending.kind !== 'approval') {
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
	const housingGap = width - auxLeft - auxRight;
	const notched = safeTop > LIVE_ACTIVITY_NOTCH_MIN_SAFE_TOP
		&& auxLeft > LIVE_ACTIVITY_NOTCH_MIN_AUX_WIDTH
		&& auxRight > LIVE_ACTIVITY_NOTCH_MIN_AUX_WIDTH
		&& housingGap >= LIVE_ACTIVITY_CAMERA_HOUSING_MIN;
	const collapsedH = LIVE_ACTIVITY_COLLAPSED_HEIGHT / scale;
	const wingW = LIVE_ACTIVITY_WING_WIDTH;
	if (notched) {
		const housingW = Math.max(LIVE_ACTIVITY_CAMERA_HOUSING_MIN, width - auxLeft - auxRight);
		const bandH = Math.max(safeTop, collapsedH, auxLeftH, auxRightH);
		const leftX = Math.max(0, auxLeft - wingW);
		const rightX = auxLeft + housingW;
		const y = 0;
		return {
			notched: true,
			cameraHousingWidth: housingW,
			cameraHousingHeight: bandH,
			leftWing: { x: leftX, y, width: wingW, height: bandH },
			rightWing: { x: rightX, y, width: wingW, height: bandH },
			pill: { x: leftX, y, width: wingW + housingW + wingW, height: bandH },
			hit: { x: leftX, y, width: wingW - 8, height: bandH },
		};
	}
	const pillW = LIVE_ACTIVITY_PILL_WIDTH;
	const pillH = LIVE_ACTIVITY_PILL_HEIGHT / scale;
	const x = Math.round((width - pillW) / 2);
	const y = 0;
	return {
		notched: false,
		cameraHousingWidth: 0,
		cameraHousingHeight: 0,
		leftWing: { x: 0, y: 0, width: 0, height: 0 },
		rightWing: { x: 0, y: 0, width: 0, height: 0 },
		pill: { x, y, width: pillW, height: pillH },
		hit: { x, y, width: pillW, height: pillH },
	};
}

/**
 * Glanceable compact-wing token. Must fit ~44pt without ugly truncation.
 * Longer prose belongs in the expanded body, not the wing.
 */
export function compactWingLabel(snapshot: MagnusLiveActivitySnapshot): string {
	switch (snapshot.status) {
		case 'disconnected':
			return 'Offline';
		case 'attention':
			return snapshot.pendingInteraction?.kind === 'question' ? 'Question' : 'Approve';
		case 'failed':
			return 'Failed';
		case 'completed':
			return 'Done';
		case 'waiting':
			return 'Waiting';
		case 'working':
			return snapshot.testState === 'running' ? 'Testing' : 'Working';
		case 'idle':
		default:
			return 'Magnus';
	}
}

/** Compact right-wing metric — elapsed preferred, else a short diff/file cue. */
export function compactMetricsLabel(snapshot: MagnusLiveActivitySnapshot, now = Date.now()): string {
	if (snapshot.status === 'working' || snapshot.status === 'waiting' || snapshot.status === 'attention') {
		if (snapshot.startedAt) {
			const elapsed = formatCompactElapsed(now - snapshot.startedAt);
			if (elapsed) {
				return elapsed;
			}
		}
	}
	const diff = snapshot.workspaceDiff;
	if (diff?.additions !== undefined || diff?.deletions !== undefined) {
		return `+${diff.additions ?? 0}`;
	}
	if (diff?.files && diff.files > 0) {
		return `${diff.files}f`;
	}
	return '';
}

/**
 * Expanded / accessibility status line (may be longer than the wing token).
 * Not used for compact wing chrome.
 */
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
		const diff = formatDiffMetric(snapshot.workspaceDiff);
		return diff ? `Finished · ${diff}` : 'Finished';
	}
	const elapsed = snapshot.startedAt ? formatElapsed(now - snapshot.startedAt) : '';
	if (snapshot.testState === 'running') {
		return elapsed ? `Running tests · ${elapsed}` : 'Running tests';
	}
	const diff = formatDiffMetric(snapshot.workspaceDiff);
	const terminalBit = snapshot.terminalCount && snapshot.terminalCount > 0 ? `${snapshot.terminalCount} task${snapshot.terminalCount === 1 ? '' : 's'}` : '';
	if (snapshot.currentActivity) {
		const extras = [elapsed, diff, terminalBit].filter(Boolean).join(' · ');
		return extras ? `${snapshot.currentActivity} · ${extras}` : snapshot.currentActivity;
	}
	const glance = [elapsed, diff, terminalBit].filter(Boolean).join(' · ');
	if (glance) {
		return glance;
	}
	return redactLiveActivityText(snapshot.taskTitle) || 'Magnus';
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

/** Compact wing elapsed — matches native FormatCompactElapsed (single token, fits ~44pt). */
export function formatCompactElapsed(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) {
		return '';
	}
	const totalSec = Math.floor(ms / 1000);
	const hours = Math.floor(totalSec / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);
	if (hours > 0) {
		return `${hours}h`;
	}
	if (minutes > 0) {
		return `${minutes}m`;
	}
	return `${Math.max(1, totalSec)}s`;
}

/**
 * Build Magnus-attributed workspace diff.
 * Prefer editing-session line stats when present; otherwise unique edited-file URIs only
 * (omit additions/deletions rather than inventing git numbers).
 */
export function summarizeMagnusWorkspaceDiff(args: {
	editedFileUris: readonly string[];
	sessionFileCount?: number;
	additions?: number;
	deletions?: number;
}): MagnusLiveActivityDiffSummary | undefined {
	const uniqueEdited = new Set(args.editedFileUris.filter(Boolean));
	const files = Math.max(uniqueEdited.size, args.sessionFileCount ?? 0);
	const hasLineStats = (args.additions !== undefined && args.additions > 0)
		|| (args.deletions !== undefined && args.deletions > 0);
	if (files <= 0 && !hasLineStats) {
		return undefined;
	}
	return {
		files: files > 0 ? files : 1,
		...(hasLineStats ? {
			additions: args.additions ?? 0,
			deletions: args.deletions ?? 0,
		} : {}),
		attributedToMagnus: true,
	};
}

/** Derive test state only from tool invocations that look like test runs in this session. */
export function deriveMagnusTestStateFromInvocations(
	invocations: readonly { toolId: string; state: 'running' | 'passed' | 'failed' | 'other' }[],
): 'running' | 'passed' | 'failed' | undefined {
	const isTestTool = (toolId: string) => /runTests|testing\.|vscode\.test|test_run|prebase_.*test/i.test(toolId);
	let sawRunning = false;
	let sawFailed = false;
	let sawPassed = false;
	for (const item of invocations) {
		if (!isTestTool(item.toolId)) {
			continue;
		}
		if (item.state === 'running') {
			sawRunning = true;
		} else if (item.state === 'failed') {
			sawFailed = true;
		} else if (item.state === 'passed') {
			sawPassed = true;
		}
	}
	if (sawRunning) {
		return 'running';
	}
	if (sawFailed) {
		return 'failed';
	}
	if (sawPassed) {
		return 'passed';
	}
	return undefined;
}

export function formatDiffMetric(diff: MagnusLiveActivityDiffSummary | undefined): string {
	if (!diff) {
		return '';
	}
	const parts: string[] = [];
	if (diff.additions !== undefined || diff.deletions !== undefined) {
		parts.push(`+${diff.additions ?? 0} -${diff.deletions ?? 0}`);
	}
	if (diff.files > 0) {
		parts.push(`${diff.files} file${diff.files === 1 ? '' : 's'}`);
	}
	return parts.join(' · ');
}

export function isRawActivityId(label?: string): boolean {
	if (!label) {
		return false;
	}
	const trimmed = label.trim();
	if (!trimmed) {
		return false;
	}
	if (/^(activity|task|job|run|session)[ -_#]?\d+$/i.test(trimmed)) {
		return true;
	}
	if (/^#?\d+$/.test(trimmed)) {
		return true;
	}
	return false;
}

export function resolveHumanReadableActivity(activityLabel?: string, latestMessage?: string): string {
	if (activityLabel && !isRawActivityId(activityLabel)) {
		return activityLabel;
	}
	if (latestMessage && !isRawActivityId(latestMessage)) {
		return latestMessage;
	}
	return 'Working with Magnus';
}

export function sanitizeTextForContainment(text?: string): string {
	if (!text) {
		return '';
	}
	const words = text.split(/\s+/);
	let needsSanitization = false;
	for (const word of words) {
		if (word.length > 18 || /[/\\_?&=@#-]/.test(word)) {
			needsSanitization = true;
			break;
		}
	}
	if (!needsSanitization) {
		return text;
	}
	const result: string[] = [];
	let runLength = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		result.push(ch);
		if (/\s/.test(ch)) {
			runLength = 0;
			continue;
		}
		runLength++;
		if (/[/\\?&=_-]/.test(ch) && runLength >= 8) {
			result.push('\u200B');
			runLength = 0;
		} else if (runLength >= 16) {
			result.push('\u200B');
			runLength = 0;
		}
	}
	return result.join('');
}

export interface NativeLiveActivityHandle {
	setSnapshot(snapshot: MagnusLiveActivitySnapshot): void;
	setPresentation(state: { visible: boolean; pinned: boolean; reducedMotion: boolean; display: MagnusLiveActivityDisplay }): void;
	dispose(): void;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Versioned Magnus / Agents task-run model.
 * Stock VS Code chat remains the transport; this shapes progress + migration.
 */

export const MAGNUS_SESSION_SCHEMA_VERSION = 2;

export type MagnusRunStatus =
	| 'queued'
	| 'planning'
	| 'running'
	| 'awaitingApproval'
	| 'awaitingUser'
	| 'completed'
	| 'failed'
	| 'cancelled';

export type MagnusWorkCategory =
	| 'Planning'
	| 'Exploring'
	| 'Searching Code'
	| 'Searching Graph'
	| 'Reading Files'
	| 'Editing'
	| 'Running Commands'
	| 'Testing'
	| 'Inspecting Runtime'
	| 'Reviewing Changes'
	| 'Waiting for Approval'
	| 'Error'
	| 'Previous conversation';

export interface MagnusWorkItem {
	toolId: string;
	title: string;
	summary: string;
	status: MagnusRunStatus;
	detail?: string;
	file?: string;
	command?: string;
	error?: string;
}

export interface MagnusWorkGroup {
	groupId: string;
	category: MagnusWorkCategory;
	title: string;
	summary: string;
	status: MagnusRunStatus;
	items: MagnusWorkItem[];
}

export interface MagnusTaskRun {
	runId: string;
	userTask: string;
	status: MagnusRunStatus;
	submittedAt: number;
	startedAt?: number;
	completedAt?: number;
	workGroups: MagnusWorkGroup[];
	finalResponse?: string;
	error?: string;
	migrated?: boolean;
}

/** Format duration for the active-run header (never hardcode). */
export function formatWorkDuration(startedAt: number, endedAt: number = Date.now()): string {
	const sec = Math.max(0, Math.round((endedAt - startedAt) / 1000));
	if (sec < 60) {
		return `${sec}s`;
	}
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	return s ? `${m}m ${s}s` : `${m}m`;
}

export function runHeaderLabel(run: Pick<MagnusTaskRun, 'status' | 'startedAt' | 'completedAt' | 'submittedAt'>): string {
	const start = run.startedAt ?? run.submittedAt ?? run.completedAt ?? Date.now();
	const end = run.completedAt ?? Date.now();
	const dur = formatWorkDuration(start, end);
	switch (run.status) {
		case 'planning':
		case 'queued':
			return `Planning… ${dur}`;
		case 'running':
			return `Working… ${dur}`;
		case 'completed':
			return `Worked for ${dur}`;
		case 'cancelled':
			return `Cancelled after ${dur}`;
		case 'failed':
			return `Stopped after ${dur}`;
		case 'awaitingApproval':
		case 'awaitingUser':
			return `Waiting… ${dur}`;
		default:
			return dur;
	}
}

/** Legacy chat-turn shape used for one-time migration into a task run. */
export interface LegacyChatTurn {
	role: 'user' | 'assistant' | 'tool' | string;
	content: string;
	timestamp?: number;
}

/**
 * Map old alternating chat turns into a single migrated task run.
 * Idempotent when `schemaVersion >= MAGNUS_SESSION_SCHEMA_VERSION`.
 */
export function migrateLegacyTurnsToTaskRun(
	turns: LegacyChatTurn[],
	opts?: { schemaVersion?: number; runId?: string },
): MagnusTaskRun | undefined {
	if ((opts?.schemaVersion ?? 0) >= MAGNUS_SESSION_SCHEMA_VERSION) {
		return undefined;
	}
	if (!turns.length) {
		return undefined;
	}
	const firstUser = turns.find(t => t.role === 'user');
	const lastAssistant = [...turns].reverse().find(t => t.role === 'assistant');
	const toolish = turns.filter(t => t.role === 'tool' || (t.role === 'assistant' && t !== lastAssistant));
	const submittedAt = firstUser?.timestamp ?? turns[0]?.timestamp ?? Date.now();
	const items: MagnusWorkItem[] = toolish.map((t, i) => ({
		toolId: `migrated-${i}`,
		title: t.role === 'tool' ? 'Tool activity' : 'Intermediate response',
		summary: t.content.slice(0, 200),
		status: 'completed',
		detail: t.content.length > 200 ? t.content : undefined,
	}));
	return {
		runId: opts?.runId ?? `migrated-${submittedAt}`,
		userTask: firstUser?.content ?? '(migrated conversation)',
		status: 'completed',
		submittedAt,
		startedAt: submittedAt,
		completedAt: lastAssistant?.timestamp ?? Date.now(),
		workGroups: items.length
			? [{
				groupId: 'migrated-previous',
				category: 'Previous conversation',
				title: 'Previous conversation',
				summary: `${items.length} preserved item(s)`,
				status: 'completed',
				items,
			}]
			: [],
		finalResponse: lastAssistant?.content,
		migrated: true,
	};
}

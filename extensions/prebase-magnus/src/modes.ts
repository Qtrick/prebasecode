/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/** How Magnus is invoked — mirrors PreBase agent modes. */
export type MagnusAgentMode =
	| 'agent'
	| 'plan'
	| 'ask'
	| 'runtime'
	| 'patch';

export interface MagnusAgentModeOption {
	readonly id: MagnusAgentMode;
	readonly label: string;
	readonly description: string;
}

export const MAGNUS_AGENT_MODES: readonly MagnusAgentModeOption[] = [
	{
		id: 'ask',
		label: 'Ask',
		description: 'Read-only Q&A — no patches or file writes',
	},
	{
		id: 'plan',
		label: 'Plan',
		description: 'Architecture and implementation planning — no edits',
	},
	{
		id: 'patch',
		label: 'Edit',
		description: 'Propose and apply code edits with approval',
	},
	{
		id: 'runtime',
		label: 'Test',
		description: 'Test UI flows with runtime preview evidence',
	},
	{
		id: 'agent',
		label: 'Agent',
		description: 'Full loop — read, edit, and verify',
	},
];

export const DEFAULT_MAGNUS_AGENT_MODE: MagnusAgentMode = 'ask';

export function isMagnusAgentMode(value: string): value is MagnusAgentMode {
	return MAGNUS_AGENT_MODES.some(m => m.id === value);
}

export function modeFromChatParticipantId(participantId: string): MagnusAgentMode {
	if (participantId.includes('.edit')) {
		return 'patch';
	}
	if (participantId.includes('.agent')) {
		return 'agent';
	}
	return 'ask';
}

export function allowsEdits(mode: MagnusAgentMode): boolean {
	return mode === 'patch' || mode === 'agent';
}

export function getAgentModePromptBlock(mode: MagnusAgentMode): string {
	switch (mode) {
		case 'agent':
			return 'MODE: Agent — You may read the workspace, search code, and propose patches (user reviews before apply).';
		case 'plan':
			return 'MODE: Plan — Produce structured plans only. Do NOT propose patches or claim you changed files.';
		case 'ask':
			return 'MODE: Ask — Answer questions read-only. Do NOT propose patches or instruct the user to apply changes.';
		case 'runtime':
			return 'MODE: Test — Focus on runtime / UI verification. Prefer evidence from attached runtime context.';
		case 'patch':
			return 'MODE: Edit — Focus on concrete code changes. Identify target files and describe exact edits.';
		default:
			return '';
	}
}

export function getMagnusPlaceholder(mode: MagnusAgentMode): string {
	switch (mode) {
		case 'ask':
			return 'Ask about this project, file, graph, or runtime…';
		case 'plan':
			return 'Ask Agents to inspect and plan before editing…';
		case 'patch':
			return 'Describe the code change Agents should propose…';
		case 'runtime':
			return 'Tell Agents what page, flow, or UI to test…';
		case 'agent':
			return 'Give Agents a task to plan, edit, test, and verify…';
		default:
			return 'Ask Agents…';
	}
}

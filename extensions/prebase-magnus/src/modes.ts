/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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

const ALL_MAGNUS_MODES: readonly MagnusAgentMode[] = ['ask', 'plan', 'runtime', 'patch', 'agent'];
const WRITE_MAGNUS_MODES: readonly MagnusAgentMode[] = ['patch', 'agent'];
// Test mode can operate only the explicitly selected Runtime Preview surface.
// These tools retain their own Workspace Trust and confirmation checks.
const RUNTIME_TEST_MAGNUS_MODES: readonly MagnusAgentMode[] = ['runtime', 'patch', 'agent'];

/**
 * The capability boundary for every Magnus tool exposed to the language model.
 * Unknown tools are deliberately unavailable: new tools must opt in here rather than relying
 * on a name prefix, which prevents accidental privilege expansion.
 */
const MAGNUS_TOOL_MODE_CAPABILITIES: Readonly<Record<string, readonly MagnusAgentMode[]>> = {
	prebase_web_search: ALL_MAGNUS_MODES,
	prebase_graph_search_nodes: ALL_MAGNUS_MODES,
	prebase_graph_get_node: ALL_MAGNUS_MODES,
	prebase_graph_get_dependencies: ALL_MAGNUS_MODES,
	prebase_graph_get_overview: ALL_MAGNUS_MODES,
	prebase_workspace_read_file: ALL_MAGNUS_MODES,
	prebase_workspace_search_text: ALL_MAGNUS_MODES,
	prebase_workspace_list_files: ALL_MAGNUS_MODES,
	prebase_workspace_search_text_rich: ALL_MAGNUS_MODES,
	prebase_workspace_read_file_range: ALL_MAGNUS_MODES,
	prebase_workspace_search_symbols: ALL_MAGNUS_MODES,
	prebase_workspace_get_definition: ALL_MAGNUS_MODES,
	prebase_workspace_get_references: ALL_MAGNUS_MODES,
	prebase_workspace_get_diagnostics: ALL_MAGNUS_MODES,
	prebase_runtime_get_state: ALL_MAGNUS_MODES,
	prebase_runtime_inspect_page: ALL_MAGNUS_MODES,
	prebase_runtime_get_evidence: ALL_MAGNUS_MODES,
	prebase_terminal_get_project_environment: ALL_MAGNUS_MODES,
	prebase_desktop_list_sessions: ALL_MAGNUS_MODES,
	prebase_desktop_get_session: ALL_MAGNUS_MODES,
	prebase_desktop_inspect_window: ALL_MAGNUS_MODES,
	prebase_desktop_get_process_output: ALL_MAGNUS_MODES,
	prebase_desktop_capture_screenshot: ALL_MAGNUS_MODES,
	prebase_edit_apply_file: WRITE_MAGNUS_MODES,
	prebase_edit_apply: WRITE_MAGNUS_MODES,
	prebase_edit_create_file: WRITE_MAGNUS_MODES,
	prebase_edit_rename_file: WRITE_MAGNUS_MODES,
	prebase_edit_delete_file: WRITE_MAGNUS_MODES,
	prebase_runtime_navigate: RUNTIME_TEST_MAGNUS_MODES,
	prebase_runtime_control_test: RUNTIME_TEST_MAGNUS_MODES,
	prebase_runtime_server: RUNTIME_TEST_MAGNUS_MODES,
	prebase_terminal_install_dependencies: WRITE_MAGNUS_MODES,
	prebase_terminal_run_declared_node_version: WRITE_MAGNUS_MODES,
	prebase_terminal_run_project_script: WRITE_MAGNUS_MODES,
	prebase_desktop_reload_window: WRITE_MAGNUS_MODES,
	prebase_desktop_restart_session: WRITE_MAGNUS_MODES,
	prebase_desktop_stop_session: WRITE_MAGNUS_MODES,
	prebase_desktop_cdp_evaluate: WRITE_MAGNUS_MODES,
};

/** Returns whether a registered tool is available in the selected Magnus agent mode. */
export function isMagnusToolAllowed(mode: MagnusAgentMode, toolName: string): boolean {
	return MAGNUS_TOOL_MODE_CAPABILITIES[toolName]?.includes(mode) ?? false;
}

/** Returns the complete, fail-closed capability registry for registration coverage tests. */
export function getMagnusToolModeCapabilityNames(): readonly string[] {
	return Object.freeze(Object.keys(MAGNUS_TOOL_MODE_CAPABILITIES));
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { suite, test } from 'node:test';
import {
	allowsEdits,
	DEFAULT_MAGNUS_AGENT_MODE,
	getMagnusToolModeCapabilityNames,
	isMagnusAgentMode,
	isMagnusToolAllowed,
	MAGNUS_AGENT_MODES,
	modeFromChatParticipantId,
	type MagnusAgentMode,
} from './modes.ts';

const allModes = MAGNUS_AGENT_MODES.map(option => option.id);
const testExecutionSafeTools = [
	'prebase_terminal_run_project_script',
	'prebase_desktop_restart_session',
	'prebase_desktop_stop_session',
];

const privilegedWriteTools = [
	'prebase_edit_apply_file',
	'prebase_edit_apply',
	'prebase_edit_create_file',
	'prebase_edit_rename_file',
	'prebase_edit_delete_file',
	'prebase_terminal_install_dependencies',
	'prebase_terminal_run_declared_node_version',
	'prebase_desktop_reload_window',
	'prebase_desktop_cdp_evaluate',
];

const runtimeTestTools = [
	'prebase_runtime_navigate',
	'prebase_runtime_control_test',
	'prebase_runtime_server',
];

// Keep this inventory aligned with registerMagnusLanguageModelTools and
// registerMagnusDesktopTools. A newly registered tool must opt into the
// fail-closed capability map before chat can declare or invoke it.
const registeredMagnusTools = [
	'prebase_desktop_cdp_evaluate',
	'prebase_desktop_capture_screenshot',
	'prebase_desktop_get_process_output',
	'prebase_desktop_get_session',
	'prebase_desktop_inspect_window',
	'prebase_desktop_list_sessions',
	'prebase_desktop_reload_window',
	'prebase_desktop_restart_session',
	'prebase_desktop_stop_session',
	'prebase_edit_apply',
	'prebase_edit_apply_file',
	'prebase_edit_create_file',
	'prebase_edit_delete_file',
	'prebase_edit_rename_file',
	'prebase_graph_get_dependencies',
	'prebase_graph_get_node',
	'prebase_graph_get_overview',
	'prebase_graph_search_nodes',
	'prebase_runtime_control_test',
	'prebase_runtime_get_evidence',
	'prebase_runtime_get_state',
	'prebase_runtime_inspect_page',
	'prebase_runtime_navigate',
	'prebase_runtime_server',
	'prebase_terminal_get_project_environment',
	'prebase_terminal_install_dependencies',
	'prebase_terminal_run_declared_node_version',
	'prebase_terminal_run_project_script',
	'prebase_web_search',
	'prebase_workspace_get_definition',
	'prebase_workspace_get_diagnostics',
	'prebase_workspace_get_references',
	'prebase_workspace_list_files',
	'prebase_workspace_read_file',
	'prebase_workspace_read_file_range',
	'prebase_workspace_search_symbols',
	'prebase_workspace_search_text',
	'prebase_workspace_search_text_rich',
];

suite('Magnus mode capability boundary', () => {
	test('recognizes only declared modes and keeps the Ask default', () => {
		assert.strictEqual(DEFAULT_MAGNUS_AGENT_MODE, 'ask');
		for (const mode of allModes) {
			assert.strictEqual(isMagnusAgentMode(mode), true, mode);
		}
		for (const value of ['', 'test', 'edit', 'administrator']) {
			assert.strictEqual(isMagnusAgentMode(value), false, value);
		}
	});

	test('maps participant ids to the least-privileged matching mode', () => {
		assert.strictEqual(modeFromChatParticipantId('prebase.magnus.ask'), 'ask');
		assert.strictEqual(modeFromChatParticipantId('prebase.magnus.edit'), 'patch');
		assert.strictEqual(modeFromChatParticipantId('prebase.magnus.agent'), 'agent');
		assert.strictEqual(modeFromChatParticipantId('prebase.magnus.unknown'), 'ask');
	});

	test('fails closed for unknown tools in every mode', () => {
		for (const mode of allModes) {
			assert.strictEqual(isMagnusToolAllowed(mode, 'prebase_unregistered_tool'), false, mode);
		}
	});

	test('accounts for every registered Magnus tool in the fail-closed capability registry', () => {
		assert.deepStrictEqual([...getMagnusToolModeCapabilityNames()].sort(), [...registeredMagnusTools].sort());
		for (const tool of registeredMagnusTools) {
			assert.strictEqual(allModes.some(mode => isMagnusToolAllowed(mode, tool)), true, tool);
		}
	});

	test('allows Test mode the dedicated Runtime Preview and bounded test-execution surfaces', () => {
		for (const tool of ['prebase_runtime_get_state', 'prebase_runtime_inspect_page', 'prebase_runtime_get_evidence', ...runtimeTestTools]) {
			assert.strictEqual(isMagnusToolAllowed('runtime', tool), true, tool);
		}
		for (const tool of testExecutionSafeTools) {
			assert.strictEqual(isMagnusToolAllowed('runtime', tool), true, tool);
		}
		for (const tool of privilegedWriteTools) {
			assert.strictEqual(isMagnusToolAllowed('runtime', tool), false, tool);
		}
	});

	test('keeps environment mutation and arbitrary runtime evaluation restricted to Edit and Agent modes', () => {
		for (const tool of privilegedWriteTools) {
			for (const mode of allModes) {
				assert.strictEqual(isMagnusToolAllowed(mode, tool), mode === 'patch' || mode === 'agent', `${mode}:${tool}`);
			}
		}
		for (const tool of testExecutionSafeTools) {
			for (const mode of allModes) {
				assert.strictEqual(isMagnusToolAllowed(mode, tool), mode === 'runtime' || mode === 'patch' || mode === 'agent', `${mode}:${tool}`);
			}
		}
		for (const tool of runtimeTestTools) {
			for (const mode of allModes) {
				assert.strictEqual(isMagnusToolAllowed(mode, tool), mode === 'runtime' || mode === 'patch' || mode === 'agent', `${mode}:${tool}`);
			}
		}
		assert.deepStrictEqual(allModes.filter(allowsEdits), ['patch', 'agent'] as MagnusAgentMode[]);
	});
});

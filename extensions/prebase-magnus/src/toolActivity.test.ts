/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { suite, test } from 'node:test';
import { MagnusToolActivityDescriptor, sanitizePath, sanitizeQuery } from './toolActivity';

suite('MagnusToolActivityDescriptor & Privacy Sanitization', () => {
	test('sanitizes paths cleanly', () => {
		assert.strictEqual(sanitizePath(''), 'workspace');
		assert.strictEqual(sanitizePath(undefined), 'workspace');
		assert.strictEqual(sanitizePath('src/components/App.tsx'), 'src/components/App.tsx');
		assert.strictEqual(sanitizePath('/project/root/.env'), '.env');
		assert.strictEqual(sanitizePath('/home/user/.ssh/id_rsa'), 'id_rsa');
	});

	test('bounds query length and masks sensitive tokens in queries', () => {
		const clean = sanitizeQuery('find all usages of authenticationService');
		assert.strictEqual(clean, 'find all usages of authenticationService');

		const multiline = sanitizeQuery('line 1\n\n\tline 2   extra spaces');
		assert.strictEqual(multiline, 'line 1 line 2 extra spaces');

		// Secret token masking
		const tokenQuery = sanitizeQuery('search for AIzaSyB1234567890abcdefghij in settings');
		assert.strictEqual(tokenQuery.includes('AIzaSy'), false);
		assert.strictEqual(tokenQuery.includes('***REDACTED***'), true);

		const bearerQuery = sanitizeQuery('find bearer: abcdef1234567890 in config');
		assert.strictEqual(bearerQuery.includes('***REDACTED***'), true);

		// Long query truncation
		const longQuery = 'a'.repeat(200);
		const truncated = sanitizeQuery(longQuery, 50);
		assert.ok(truncated.length <= 50);
		assert.ok(truncated.endsWith('…'));
	});

	test('formats informative invocation messages for workspace and edit tools', () => {
		const readMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_workspace_read_file', { path: 'src/main.ts' });
		assert.strictEqual(readMsg, 'Reading src/main.ts');

		const rangeMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_workspace_read_file_range', { path: 'src/main.ts', startLine: 10, endLine: 25 });
		assert.strictEqual(rangeMsg, 'Reading src/main.ts (lines 10-25)');

		const searchMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_workspace_search_text', { query: 'export interface' });
		assert.strictEqual(searchMsg, 'Searching code for "export interface"');

		const listMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_workspace_list_files', { include: 'src/**/*.ts' });
		assert.strictEqual(listMsg, 'Listing files matching src/**/*.ts');

		const editMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_edit_apply_file', { path: 'src/a.ts' });
		assert.strictEqual(editMsg, 'Applying edits to src/a.ts');
	});

	test('formats informative invocation messages for graph tools', () => {
		const graphSearch = MagnusToolActivityDescriptor.getInvocationMessage('prebase_graph_search_nodes', { query: 'aiService' });
		assert.strictEqual(graphSearch, 'Searching Code Graph for "aiService"');

		const graphNode = MagnusToolActivityDescriptor.getInvocationMessage('prebase_graph_get_node', { node: 'src/aiService.ts' });
		assert.strictEqual(graphNode, 'Inspecting Code Graph node "src/aiService.ts"');

		const graphDeps = MagnusToolActivityDescriptor.getInvocationMessage('prebase_graph_get_dependencies', { node: 'src/aiService.ts', direction: 'incoming' });
		assert.strictEqual(graphDeps, 'Inspecting incoming dependencies for "src/aiService.ts"');

		const graphOverview = MagnusToolActivityDescriptor.getInvocationMessage('prebase_graph_get_overview', {});
		assert.strictEqual(graphOverview, 'Inspecting Code Graph architecture overview');
	});

	test('formats informative invocation messages for terminal, desktop, web search, and runtime tools', () => {
		const scriptMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_terminal_run_project_script', { script: 'test' });
		assert.strictEqual(scriptMsg, 'Running project script "test"');

		const cmdMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_terminal_run_declared_node_version', { command: 'git status' });
		assert.strictEqual(cmdMsg, 'Running node command "git status"');

		const screenshotMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_desktop_capture_screenshot', {});
		assert.strictEqual(screenshotMsg, 'Capturing desktop window screenshot');

		const webMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_web_search', { query: 'VS Code LM API' });
		assert.strictEqual(webMsg, 'Searching the web for "VS Code LM API"');

		const runtimeMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_runtime_get_state', {});
		assert.strictEqual(runtimeMsg, 'Checking Runtime Preview state');
	});

	test('generates confirmation messages for destructive operations', () => {
		const editConf = MagnusToolActivityDescriptor.getConfirmationMessage('prebase_edit_apply_file', { path: 'src/a.ts' });
		assert.strictEqual(editConf?.title, 'Apply File Edits');
		assert.strictEqual(editConf?.message, 'Apply automated code edits to "src/a.ts"?');

		const createConf = MagnusToolActivityDescriptor.getConfirmationMessage('prebase_edit_create_file', { path: 'src/newFile.ts' });
		assert.strictEqual(createConf?.title, 'Create Workspace File');
		assert.strictEqual(createConf?.message, 'Create new file at "src/newFile.ts"?');

		const deleteConf = MagnusToolActivityDescriptor.getConfirmationMessage('prebase_edit_delete_file', { path: 'src/oldFile.ts' });
		assert.strictEqual(deleteConf?.title, 'Delete Workspace File');
		assert.strictEqual(deleteConf?.message, 'Permanently delete file at "src/oldFile.ts"?');
	});
});

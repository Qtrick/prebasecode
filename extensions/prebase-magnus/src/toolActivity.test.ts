/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { suite, test } from 'node:test';
import { MagnusToolActivityDescriptor, sanitizePath, sanitizeQuery } from './toolActivity.ts';

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

	test('formats informative invocation messages for workspace tools', () => {
		const readMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_workspace_read', { path: 'src/main.ts' });
		assert.strictEqual(readMsg, 'Reading src/main.ts');

		const rangeMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_workspace_read_range', { path: 'src/main.ts', startLine: 10, endLine: 25 });
		assert.strictEqual(rangeMsg, 'Reading src/main.ts (lines 10-25)');

		const searchMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_workspace_search', { query: 'export interface' });
		assert.strictEqual(searchMsg, 'Searching workspace for "export interface"');

		const textSearchMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_workspace_text_search', { query: 'const config =' });
		assert.strictEqual(textSearchMsg, 'Searching code for "const config ="');

		const listMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_workspace_list_files', { include: 'src/**/*.ts' });
		assert.strictEqual(listMsg, 'Listing files in src/**/*.ts');

		const editMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_workspace_apply_edits', { edits: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] });
		assert.strictEqual(editMsg, 'Applying edits across 2 files');
	});

	test('formats informative invocation messages for graph tools', () => {
		const graphSearch = MagnusToolActivityDescriptor.getInvocationMessage('prebase_graph_search', { query: 'aiService' });
		assert.strictEqual(graphSearch, 'Searching Code Graph for "aiService"');

		const graphNode = MagnusToolActivityDescriptor.getInvocationMessage('prebase_graph_node', { node: 'src/aiService.ts' });
		assert.strictEqual(graphNode, 'Inspecting Code Graph node "src/aiService.ts"');

		const graphDeps = MagnusToolActivityDescriptor.getInvocationMessage('prebase_graph_dependencies', { node: 'src/aiService.ts', direction: 'incoming' });
		assert.strictEqual(graphDeps, 'Inspecting incoming dependencies for "src/aiService.ts"');

		const graphOverview = MagnusToolActivityDescriptor.getInvocationMessage('prebase_graph_overview', {});
		assert.strictEqual(graphOverview, 'Inspecting Code Graph architecture overview');
	});

	test('formats informative invocation messages for terminal, web search, and runtime tools', () => {
		const scriptMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_terminal_run_script', { script: 'test' });
		assert.strictEqual(scriptMsg, 'Running project script "test"');

		const cmdMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_terminal_run_command', { command: 'git status' });
		assert.strictEqual(cmdMsg, 'Running command "git status"');

		const webMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_web_search', { query: 'VS Code LM API' });
		assert.strictEqual(webMsg, 'Searching the web for "VS Code LM API"');

		const runtimeMsg = MagnusToolActivityDescriptor.getInvocationMessage('prebase_runtime_status', {});
		assert.strictEqual(runtimeMsg, 'Checking Runtime Preview status');
	});

	test('generates confirmation messages for destructive operations', () => {
		const editConf = MagnusToolActivityDescriptor.getConfirmationMessage('prebase_workspace_apply_edits', { edits: [{ path: 'a.ts' }, { path: 'b.ts' }] });
		assert.strictEqual(editConf?.title, 'Apply Workspace Edits');
		assert.strictEqual(editConf?.message, 'Apply automated code edits across 2 file(s)?');

		const createConf = MagnusToolActivityDescriptor.getConfirmationMessage('prebase_workspace_create_file', { path: 'src/newFile.ts' });
		assert.strictEqual(createConf?.title, 'Create Workspace File');
		assert.strictEqual(createConf?.message, 'Create new file at "src/newFile.ts"?');

		const deleteConf = MagnusToolActivityDescriptor.getConfirmationMessage('prebase_workspace_delete_file', { path: 'src/oldFile.ts' });
		assert.strictEqual(deleteConf?.title, 'Delete Workspace File');
		assert.strictEqual(deleteConf?.message, 'Permanently delete file at "src/oldFile.ts"?');

		const readConf = MagnusToolActivityDescriptor.getConfirmationMessage('prebase_workspace_read', { path: 'src/a.ts' });
		assert.strictEqual(readConf, undefined);
	});
});

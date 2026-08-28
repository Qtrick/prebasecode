/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Sanitizes and normalizes workspace paths into compact, privacy-safe, relative strings.
 */
export function sanitizePath(rawPath: unknown): string {
	if (typeof rawPath !== 'string' || !rawPath.trim()) {
		return 'workspace';
	}
	const clean = rawPath.trim();
	if (clean.includes('.env') || clean.includes('id_rsa') || clean.includes('.pem') || clean.includes('.key')) {
		return clean.split(/[\/\\]/).pop() || clean;
	}
	// Normalize file schema and paths
	let normalized = clean.replace(/^file:\/\//, '');
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && normalized.startsWith(home)) {
		normalized = '~' + normalized.slice(home.length);
	}
	return normalized;
}

/**
 * Bounds text length and strips linebreaks/unnecessary whitespace for tool invocation preview.
 */
export function sanitizeQuery(rawQuery: unknown, maxLength: number = 100): string {
	if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
		return '';
	}
	// Mask secret tokens
	let sanitized = rawQuery
		.replace(/(?:AIza|sk-|ghp_|gho_|xox[baprs]-)[A-Za-z0-9_-]{10,}/g, '***REDACTED***')
		.replace(/(?:key|token|secret|password|bearer)[=:\s]+[A-Za-z0-9_\-.]{8,}/gi, '***REDACTED***');

	sanitized = sanitized.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
	if (sanitized.length > maxLength) {
		return sanitized.slice(0, maxLength - 1) + '…';
	}
	return sanitized;
}

/**
 * Generates human-friendly, sanitized, concise action descriptions for language model tools.
 */
export class MagnusToolActivityDescriptor {
	static describeInvocation(toolName: string, input: Record<string, unknown>): { invocationMessage: string } {
		const msg = this.getInvocationMessage(toolName, input);
		return { invocationMessage: msg };
	}

	static getInvocationMessage(toolName: string, input: Record<string, unknown>): string {
		switch (toolName) {
			// Workspace Tools
			case 'prebase_workspace_read_file': {
				const p = sanitizePath(input.path);
				return `Reading ${p}`;
			}
			case 'prebase_workspace_read_file_range': {
				const p = sanitizePath(input.path);
				const start = input.startLine;
				const end = input.endLine;
				if (typeof start === 'number') {
					return typeof end === 'number' && end !== start
						? `Reading ${p} (lines ${start}-${end})`
						: `Reading ${p} (line ${start})`;
				}
				return `Reading ${p}`;
			}
			case 'prebase_workspace_search_text':
			case 'prebase_workspace_search_text_rich': {
				const q = sanitizeQuery(input.query);
				return q ? `Searching code for "${q}"` : 'Searching workspace code';
			}
			case 'prebase_workspace_list_files': {
				const inc = sanitizeQuery(input.include || input.pattern, 40);
				return inc ? `Listing files matching ${inc}` : 'Listing workspace files';
			}
			case 'prebase_workspace_search_symbols': {
				if (input.path) {
					const p = sanitizePath(input.path);
					return `Finding symbols in ${p}`;
				}
				const q = sanitizeQuery(input.query);
				return q ? `Finding symbols for "${q}"` : 'Finding workspace symbols';
			}
			case 'prebase_workspace_get_definition': {
				const p = sanitizePath(input.path);
				return `Finding definition in ${p}`;
			}
			case 'prebase_workspace_get_references': {
				const p = sanitizePath(input.path);
				return `Finding references in ${p}`;
			}
			case 'prebase_workspace_get_diagnostics': {
				if (input.path) {
					const p = sanitizePath(input.path);
					return `Checking diagnostics for ${p}`;
				}
				return 'Checking workspace diagnostics';
			}

			// Edit Tools
			case 'prebase_edit_apply_file':
			case 'prebase_edit_apply': {
				const p = sanitizePath(input.path);
				return `Applying edits to ${p}`;
			}
			case 'prebase_edit_create_file': {
				const p = sanitizePath(input.path);
				return `Creating ${p}`;
			}
			case 'prebase_edit_rename_file': {
				const oldP = sanitizePath(input.oldPath);
				const newP = sanitizePath(input.newPath);
				return `Renaming ${oldP} to ${newP}`;
			}
			case 'prebase_edit_delete_file': {
				const p = sanitizePath(input.path);
				return `Deleting ${p}`;
			}

			// Terminal Tools
			case 'prebase_terminal_get_project_environment':
				return 'Inspecting project environment';
			case 'prebase_terminal_install_dependencies':
				return 'Installing project dependencies';
			case 'prebase_terminal_run_declared_node_version': {
				const cmd = sanitizeQuery(input.command, 60);
				return cmd ? `Running node command "${cmd}"` : 'Running declared node version';
			}
			case 'prebase_terminal_run_project_script': {
				const s = sanitizeQuery(input.script, 50);
				return s ? `Running project script "${s}"` : 'Running project script';
			}

			// Graph Tools
			case 'prebase_graph_search_nodes': {
				const q = sanitizeQuery(input.query);
				return q ? `Searching Code Graph for "${q}"` : 'Searching Code Graph';
			}
			case 'prebase_graph_get_node': {
				const node = sanitizePath(input.node);
				return `Inspecting Code Graph node "${node}"`;
			}
			case 'prebase_graph_get_dependencies': {
				const node = sanitizePath(input.node);
				const dir = typeof input.direction === 'string' ? input.direction : 'both';
				return `Inspecting ${dir} dependencies for "${node}"`;
			}
			case 'prebase_graph_get_overview':
				return 'Inspecting Code Graph architecture overview';

			// Runtime Tools
			case 'prebase_runtime_get_state':
				return 'Checking Runtime Preview state';
			case 'prebase_runtime_navigate': {
				const p = sanitizeQuery(input.path ?? input.route ?? input.url, 50);
				return p ? `Navigating Runtime Preview to "${p}"` : 'Navigating Runtime Preview';
			}
			case 'prebase_runtime_inspect_page':
				return 'Inspecting Runtime Preview page';
			case 'prebase_runtime_get_evidence':
				return 'Gathering Runtime Preview evidence';
			case 'prebase_runtime_control_test': {
				const act = sanitizeQuery(input.action, 40);
				return act ? `Running test action "${act}"` : 'Controlling runtime test';
			}
			case 'prebase_runtime_server': {
				const act = sanitizeQuery(input.action, 40);
				return act ? `Managing runtime server (${act})` : 'Managing runtime server';
			}

			// Desktop Tools
			case 'prebase_desktop_list_sessions':
				return 'Listing active desktop sessions';
			case 'prebase_desktop_get_session': {
				const s = sanitizeQuery(input.sessionId, 40);
				return s ? `Inspecting desktop session "${s}"` : 'Inspecting desktop session';
			}
			case 'prebase_desktop_inspect_window':
				return 'Inspecting desktop window state';
			case 'prebase_desktop_start_session': {
				const framework = sanitizeQuery(input.framework, 20) || 'desktop';
				const mode = input.mode === 'fullApp' ? 'full app' : 'renderer';
				return `Starting ${framework} ${mode} test session`;
			}
			case 'prebase_desktop_interact': {
				const action = sanitizeQuery(input.action, 20) || 'interact';
				const locator = (input.locator && typeof input.locator === 'object') ? input.locator as Record<string, unknown> : {};
				const name = sanitizeQuery(String(locator.name ?? locator.value ?? ''), 40);
				const secret = /password|passwd|secret|token|api[_-]?key/i.test(`${locator.name ?? ''} ${locator.value ?? ''} ${action}`);
				if (action === 'fill' && secret) {
					return 'Filling a secret field';
				}
				if (action === 'click' && name) {
					return `Clicking "${name}"`;
				}
				if (action === 'fill' && name) {
					return `Filling ${name}`;
				}
				return name ? `Desktop ${action} on "${name}"` : `Desktop ${action}`;
			}
			case 'prebase_desktop_assert': {
				const condition = sanitizeQuery(input.condition, 20) || 'state';
				const expected = sanitizeQuery(String(input.expected ?? ''), 40);
				return expected ? `Asserting ${condition} "${expected}"` : `Asserting ${condition}`;
			}
			case 'prebase_desktop_get_process_output':
				return 'Reading desktop process output';
			case 'prebase_desktop_reload_window':
				return 'Reloading desktop window';
			case 'prebase_desktop_restart_session':
				return 'Restarting desktop session';
			case 'prebase_desktop_stop_session':
				return 'Stopping desktop session';
			case 'prebase_desktop_cdp_evaluate': {
				const expr = sanitizeQuery(input.expression, 50);
				return expr ? `Evaluating CDP expression "${expr}"` : 'Evaluating CDP expression';
			}
			case 'prebase_desktop_capture_screenshot':
				return 'Capturing desktop window screenshot';

			// Web Search Tool
			case 'prebase_web_search': {
				const q = sanitizeQuery(input.query, 80);
				return q ? `Searching the web for "${q}"` : 'Searching the web';
			}
			case 'prebase_web_fetch': {
				const u = sanitizeQuery(typeof input.url === 'string' ? input.url : '', 80);
				return u ? `Fetching web source ${u}` : 'Fetching web source';
			}

			default: {
				const cleanName = toolName.replace(/^prebase_/, '').replace(/_/g, ' ');
				return `Executing ${cleanName}`;
			}
		}
	}

	static getConfirmationMessage(toolName: string, input: Record<string, unknown>): { title: string; message: string } | undefined {
		switch (toolName) {
			case 'prebase_edit_apply_file':
			case 'prebase_edit_apply': {
				const p = sanitizePath(input.path);
				return {
					title: 'Apply File Edits',
					message: `Apply automated code edits to "${p}"?`,
				};
			}
			case 'prebase_edit_create_file': {
				const p = sanitizePath(input.path);
				return {
					title: 'Create Workspace File',
					message: `Create new file at "${p}"?`,
				};
			}
			case 'prebase_edit_rename_file': {
				const oldP = sanitizePath(input.oldPath);
				const newP = sanitizePath(input.newPath);
				return {
					title: 'Rename File',
					message: `Rename "${oldP}" to "${newP}"?`,
				};
			}
			case 'prebase_edit_delete_file': {
				const p = sanitizePath(input.path);
				return {
					title: 'Delete Workspace File',
					message: `Permanently delete file at "${p}"?`,
				};
			}
			case 'prebase_terminal_run_project_script': {
				const s = sanitizeQuery(input.script, 50);
				return {
					title: 'Run Project Script',
					message: `Execute project script "${s}"?`,
				};
			}
			case 'prebase_terminal_run_declared_node_version': {
				const cmd = sanitizeQuery(input.command, 60);
				return {
					title: 'Run Node Command',
					message: `Execute command "${cmd}" in project runtime?`,
				};
			}
			case 'prebase_desktop_start_session': {
				const mode = input.mode === 'fullApp' ? 'full app' : 'renderer';
				return {
					title: 'Start Desktop Test Session',
					message: `Launch the workspace desktop application in ${mode} mode? This executes project code.`,
				};
			}
			case 'prebase_terminal_install_dependencies': {
				return {
					title: 'Install Dependencies',
					message: 'Install project dependencies using configured package manager?',
				};
			}
			default:
				return undefined;
		}
	}
}

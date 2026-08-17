/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
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
	if (clean.includes('.env') || clean.includes('id_rsa') || clean.includes('.pem')) {
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
			case 'prebase_graph_search': {
				const q = sanitizeQuery(input.query);
				return q ? `Searching Code Graph for "${q}"` : 'Searching Code Graph';
			}
			case 'prebase_graph_node': {
				const node = sanitizePath(input.node);
				return `Inspecting Code Graph node "${node}"`;
			}
			case 'prebase_graph_dependencies': {
				const node = sanitizePath(input.node);
				const dir = typeof input.direction === 'string' ? input.direction : 'both';
				return `Inspecting ${dir} dependencies for "${node}"`;
			}
			case 'prebase_graph_overview':
				return 'Inspecting Code Graph architecture overview';

			case 'prebase_workspace_read': {
				const p = sanitizePath(input.path);
				return `Reading ${p}`;
			}
			case 'prebase_workspace_read_range': {
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
			case 'prebase_workspace_search': {
				const q = sanitizeQuery(input.query);
				return q ? `Searching workspace for "${q}"` : 'Searching workspace';
			}
			case 'prebase_workspace_text_search': {
				const q = sanitizeQuery(input.query);
				return q ? `Searching code for "${q}"` : 'Searching code';
			}
			case 'prebase_workspace_list_files': {
				const inc = sanitizeQuery(input.include, 40);
				return inc ? `Listing files in ${inc}` : 'Listing workspace files';
			}
			case 'prebase_workspace_symbols': {
				if (input.path) {
					const p = sanitizePath(input.path);
					return `Finding symbols in ${p}`;
				}
				const q = sanitizeQuery(input.query);
				return q ? `Finding symbols for "${q}"` : 'Finding workspace symbols';
			}
			case 'prebase_workspace_definition': {
				const p = sanitizePath(input.path);
				return `Finding definition in ${p}`;
			}
			case 'prebase_workspace_references': {
				const p = sanitizePath(input.path);
				return `Finding references in ${p}`;
			}
			case 'prebase_workspace_diagnostics': {
				if (input.path) {
					const p = sanitizePath(input.path);
					return `Checking diagnostics for ${p}`;
				}
				return 'Checking workspace diagnostics';
			}
			case 'prebase_workspace_apply_edits': {
				const edits = input.edits;
				const count = Array.isArray(edits) ? edits.length : 1;
				const firstPath = Array.isArray(edits) && edits[0]?.path ? sanitizePath(edits[0].path) : undefined;
				if (count === 1 && firstPath) {
					return `Applying edits to ${firstPath}`;
				}
				return `Applying edits across ${count} file${count === 1 ? '' : 's'}`;
			}
			case 'prebase_workspace_create_file': {
				const p = sanitizePath(input.path);
				return `Creating ${p}`;
			}
			case 'prebase_workspace_delete_file': {
				const p = sanitizePath(input.path);
				return `Deleting ${p}`;
			}
			case 'prebase_terminal_run_script': {
				const s = sanitizeQuery(input.script, 50);
				return s ? `Running project script "${s}"` : 'Running project script';
			}
			case 'prebase_terminal_run_command': {
				const cmd = sanitizeQuery(input.command, 60);
				return cmd ? `Running command "${cmd}"` : 'Running terminal command';
			}
			case 'prebase_terminal_read_output':
				return 'Reading terminal output';

			case 'prebase_runtime_status':
				return 'Checking Runtime Preview status';
			case 'prebase_runtime_preview_diagnose':
				return 'Diagnosing Runtime Preview';
			case 'prebase_runtime_preview_navigate': {
				const p = sanitizeQuery(input.path ?? input.route, 50);
				return p ? `Navigating Runtime Preview to "${p}"` : 'Navigating Runtime Preview';
			}
			case 'prebase_web_search': {
				const q = sanitizeQuery(input.query, 80);
				return q ? `Searching the web for "${q}"` : 'Searching the web';
			}
			case 'prebase_model_diagnostics':
				return 'Diagnosing AI model catalog';

			default: {
				const cleanName = toolName.replace(/^prebase_/, '').replace(/_/g, ' ');
				return `Executing ${cleanName}`;
			}
		}
	}

	static getConfirmationMessage(toolName: string, input: Record<string, unknown>): { title: string; message: string } | undefined {
		switch (toolName) {
			case 'prebase_workspace_apply_edits': {
				const edits = input.edits;
				const count = Array.isArray(edits) ? edits.length : 1;
				return {
					title: 'Apply Workspace Edits',
					message: `Apply automated code edits across ${count} file(s)?`,
				};
			}
			case 'prebase_workspace_create_file': {
				const p = sanitizePath(input.path);
				return {
					title: 'Create Workspace File',
					message: `Create new file at "${p}"?`,
				};
			}
			case 'prebase_workspace_delete_file': {
				const p = sanitizePath(input.path);
				return {
					title: 'Delete Workspace File',
					message: `Permanently delete file at "${p}"?`,
				};
			}
			case 'prebase_terminal_run_command': {
				const cmd = sanitizeQuery(input.command, 80);
				return {
					title: 'Run Terminal Command',
					message: `Execute shell command "${cmd}"?`,
				};
			}
			case 'prebase_terminal_run_script': {
				const s = sanitizeQuery(input.script, 50);
				return {
					title: 'Run Project Script',
					message: `Execute project script "${s}"?`,
				};
			}
			default:
				return undefined;
		}
	}
}

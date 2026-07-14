/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';

const SECRET_BASENAMES = new Set([
	'.env',
	'.env.local',
	'.env.development',
	'.env.production',
	'.env.test',
	'credentials.json',
	'secrets.json',
	'.npmrc',
]);

export interface ToolResult {
	ok: boolean;
	output: string;
}

function workspaceRoots(): vscode.Uri[] {
	return vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
}

function isUnderWorkspace(uri: vscode.Uri): boolean {
	const roots = workspaceRoots();
	if (roots.length === 0) {
		return false;
	}
	const fsPath = uri.fsPath;
	return roots.some(root => {
		const rootPath = root.fsPath;
		return fsPath === rootPath || fsPath.startsWith(rootPath + path.sep);
	});
}

function isSecretPath(uri: vscode.Uri): boolean {
	const base = path.basename(uri.fsPath).toLowerCase();
	if (SECRET_BASENAMES.has(base)) {
		return true;
	}
	if (base.startsWith('.env.')) {
		return true;
	}
	if (base === 'id_rsa' || base === 'id_ed25519' || base.endsWith('.pem') || base.endsWith('.key')) {
		return true;
	}
	const rel = vscode.workspace.asRelativePath(uri).toLowerCase().replace(/\\/g, '/');
	if (rel.includes('/.ssh/') || rel.includes('/secrets/') || rel.includes('/.aws/')) {
		return true;
	}
	return false;
}

function resolveWorkspaceUri(relativeOrAbsolute: string): vscode.Uri | undefined {
	const roots = workspaceRoots();
	if (roots.length === 0) {
		return undefined;
	}
	const cleaned = relativeOrAbsolute.trim().replace(/\\/g, '/');
	if (!cleaned || cleaned.includes('\0')) {
		return undefined;
	}
	if (path.isAbsolute(cleaned) || /^[A-Za-z]:\//.test(cleaned)) {
		return vscode.Uri.file(cleaned);
	}
	// Reject path traversal outside the workspace root.
	const segments = cleaned.split('/');
	if (segments.some(s => s === '..')) {
		const joined = path.normalize(path.join(roots[0].fsPath, cleaned));
		const candidate = vscode.Uri.file(joined);
		return isUnderWorkspace(candidate) ? candidate : undefined;
	}
	return vscode.Uri.joinPath(roots[0], cleaned);
}

export class MagnusWorkspaceTools {
	constructor(
		private readonly maxIterations: number,
		private readonly requireEditApproval: boolean,
	) { }

	get maxToolIterations(): number {
		return this.maxIterations;
	}

	async readFile(relativePath: string, token: vscode.CancellationToken): Promise<ToolResult> {
		if (token.isCancellationRequested) {
			return { ok: false, output: 'Cancelled' };
		}
		const uri = resolveWorkspaceUri(relativePath);
		if (!uri || !isUnderWorkspace(uri)) {
			return { ok: false, output: 'Path is outside the workspace.' };
		}
		if (isSecretPath(uri)) {
			return { ok: false, output: 'Refusing to read secret/credential files.' };
		}
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const text = Buffer.from(bytes).toString('utf8');
			const capped = text.length > 80_000 ? text.slice(0, 80_000) + '\n…[truncated]' : text;
			return { ok: true, output: capped };
		} catch (err) {
			return { ok: false, output: `Failed to read: ${err instanceof Error ? err.message : String(err)}` };
		}
	}

	async searchWorkspace(query: string, token: vscode.CancellationToken): Promise<ToolResult> {
		if (token.isCancellationRequested) {
			return { ok: false, output: 'Cancelled' };
		}
		if (!query.trim()) {
			return { ok: false, output: 'Empty search query.' };
		}
		try {
			const results = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 200, token);
			const matches: string[] = [];
			const lower = query.toLowerCase();
			for (const uri of results) {
				if (token.isCancellationRequested) {
					break;
				}
				if (isSecretPath(uri)) {
					continue;
				}
				const rel = vscode.workspace.asRelativePath(uri);
				if (rel.toLowerCase().includes(lower)) {
					matches.push(rel);
					if (matches.length >= 40) {
						break;
					}
				}
			}
			// Content search via findTextInFiles is proposed; use path matches + sample read of first few.
			if (matches.length === 0) {
				for (const uri of results.slice(0, 80)) {
					if (token.isCancellationRequested) {
						break;
					}
					if (isSecretPath(uri) || !isUnderWorkspace(uri)) {
						continue;
					}
					try {
						const bytes = await vscode.workspace.fs.readFile(uri);
						const text = Buffer.from(bytes).toString('utf8');
						if (text.toLowerCase().includes(lower)) {
							matches.push(vscode.workspace.asRelativePath(uri));
							if (matches.length >= 40) {
								break;
							}
						}
					} catch {
						// skip unreadable
					}
				}
			}
			return {
				ok: true,
				output: matches.length
					? matches.join('\n')
					: 'No matches found.',
			};
		} catch (err) {
			return { ok: false, output: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
		}
	}

	async applyEdit(
		relativePath: string,
		newContent: string,
		token: vscode.CancellationToken,
	): Promise<ToolResult> {
		if (token.isCancellationRequested) {
			return { ok: false, output: 'Cancelled' };
		}
		const uri = resolveWorkspaceUri(relativePath);
		if (!uri || !isUnderWorkspace(uri)) {
			return { ok: false, output: 'Path is outside the workspace.' };
		}
		if (isSecretPath(uri)) {
			return { ok: false, output: 'Refusing to edit secret/credential files.' };
		}

		if (this.requireEditApproval) {
			const choice = await vscode.window.showWarningMessage(
				`Magnus wants to write ${vscode.workspace.asRelativePath(uri)}. Allow?`,
				{ modal: true },
				'Allow',
				'Deny',
			);
			if (choice !== 'Allow') {
				return { ok: false, output: 'User denied the edit.' };
			}
		}

		try {
			const edit = new vscode.WorkspaceEdit();
			let exists = true;
			try {
				await vscode.workspace.fs.stat(uri);
			} catch {
				exists = false;
			}

			if (!exists) {
				edit.createFile(uri, { ignoreIfExists: true });
				edit.insert(uri, new vscode.Position(0, 0), newContent);
			} else {
				const doc = await vscode.workspace.openTextDocument(uri);
				const fullRange = new vscode.Range(
					doc.positionAt(0),
					doc.positionAt(doc.getText().length),
				);
				edit.replace(uri, fullRange, newContent);
			}

			const applied = await vscode.workspace.applyEdit(edit);
			return applied
				? { ok: true, output: `Updated ${vscode.workspace.asRelativePath(uri)}` }
				: { ok: false, output: 'applyEdit returned false.' };
		} catch (err) {
			return { ok: false, output: `Edit failed: ${err instanceof Error ? err.message : String(err)}` };
		}
	}

	/**
	 * Parse simple tool directives from model output:
	 * ```tool read path/to/file.ts```
	 * ```tool search query text```
	 * ```tool edit path/to/file.ts\n...content...```
	 */
	parseToolCalls(text: string): Array<{ kind: 'read' | 'search' | 'edit'; arg: string; body?: string }> {
		const calls: Array<{ kind: 'read' | 'search' | 'edit'; arg: string; body?: string }> = [];
		const blockRe = /```tool\s+(read|search|edit)\s+([^\n]+)(?:\n([\s\S]*?))?```/gi;
		let match: RegExpExecArray | null;
		while ((match = blockRe.exec(text)) !== null) {
			const kind = match[1].toLowerCase() as 'read' | 'search' | 'edit';
			const arg = match[2].trim();
			const body = match[3]?.trim();
			calls.push({ kind, arg, body });
		}
		return calls;
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectSafetyService } from './projectSafetyService';

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

export function isUnderWorkspace(uri: vscode.Uri): boolean {
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

export function isSecretPath(uri: vscode.Uri): boolean {
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

export function resolveWorkspaceUri(relativeOrAbsolute: string): vscode.Uri | undefined {
	const roots = workspaceRoots();
	if (roots.length === 0) {
		return undefined;
	}
	if (typeof relativeOrAbsolute !== 'string') {
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
		if (typeof query !== 'string' || !query.trim() || query.length > 512) {
			return { ok: false, output: 'Search query must contain 1 to 512 characters.' };
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
		if (isSecretPath(uri) || ProjectSafetyService.instance.isSensitivePath(uri)) {
			return { ok: false, output: 'Refusing to edit secret/credential files.' };
		}
		if (typeof newContent !== 'string' || newContent.length > 1_000_000) {
			return { ok: false, output: 'Edit content must be text no larger than 1 MB.' };
		}
		const perm = await ProjectSafetyService.instance.checkPermission({
			category: 'write',
			targetPath: uri,
			description: `Write ${vscode.workspace.asRelativePath(uri)}`,
		});
		if (!perm.allowed) {
			return { ok: false, output: perm.reason || 'File edit denied by Project Safety.' };
		}
		if (this.requireEditApproval) {
			const choice = await vscode.window.showWarningMessage(
				`Agents wants to write ${vscode.workspace.asRelativePath(uri)}. Allow?`,
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
			let existingDocument: vscode.TextDocument | undefined;
			let expectedVersion: number | undefined;
			let exists = true;
			try {
				await vscode.workspace.fs.stat(uri);
			} catch {
				exists = false;
			}

			if (!exists) {
				edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
				edit.insert(uri, new vscode.Position(0, 0), newContent);
			} else {
				const doc = await vscode.workspace.openTextDocument(uri);
				if (token.isCancellationRequested) {
					return { ok: false, output: 'Cancelled' };
				}
				if (doc.isDirty) {
					return { ok: false, output: 'Refusing to overwrite unsaved editor changes.' };
				}
				existingDocument = doc;
				expectedVersion = doc.version;
				const fullRange = new vscode.Range(
					doc.positionAt(0),
					doc.positionAt(doc.getText().length),
				);
				edit.replace(uri, fullRange, newContent);
			}

			if (token.isCancellationRequested) {
				return { ok: false, output: 'Cancelled' };
			}
			if (existingDocument && (existingDocument.isDirty || existingDocument.version !== expectedVersion)) {
				return { ok: false, output: 'Refusing to overwrite changes made after the file was read.' };
			}
			const applied = await vscode.workspace.applyEdit(edit);
			return applied
				? { ok: true, output: `Updated ${vscode.workspace.asRelativePath(uri)}` }
				: { ok: false, output: 'applyEdit returned false.' };
		} catch (err) {
			return { ok: false, output: `Edit failed: ${err instanceof Error ? err.message : String(err)}` };
		}
	}

}

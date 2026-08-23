/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import type * as vscodeTypes from 'vscode';

export type ProjectSafetyMode = 'standard' | 'strict';

export type ActionCategory =
	| 'read'
	| 'write'
	| 'workspaceRead'
	| 'workspaceWrite'
	| 'fileDelete'
	| 'fileMove'
	| 'terminal'
	| 'gitMutation'
	| 'network'
	| 'browser'
	| 'MCP'
	| 'externalFileRead'
	| 'externalFileWrite'
	| 'dependencyMutation'
	| 'runtime'
	| 'sensitiveFileRead'
	| 'sensitiveFileWrite';

export interface IActionPermissionRequest {
	readonly category: ActionCategory;
	readonly targetPath?: string | vscodeTypes.Uri;
	readonly sourcePath?: string | vscodeTypes.Uri;
	readonly command?: string;
	readonly url?: string;
	readonly mcpServer?: string;
	readonly mcpTool?: string;
	readonly description?: string;
}

export interface IActionPermissionResult {
	readonly allowed: boolean;
	readonly reason?: string;
}

let _cachedVsCode: typeof import('vscode') | undefined;
function getVsCode(): typeof import('vscode') | undefined {
	if (_cachedVsCode) {
		return _cachedVsCode;
	}
	try {
		const g = globalThis as any;
		if (g.vscode) {
			_cachedVsCode = g.vscode;
		} else if (typeof require === 'function') {
			_cachedVsCode = require('vscode');
		}
	} catch {
		// Environment outside extension host
	}
	return _cachedVsCode;
}

const SENSITIVE_BASENAMES = new Set([
	'.env',
	'.env.local',
	'.env.development',
	'.env.production',
	'.env.test',
	'.env.staging',
	'credentials.json',
	'secrets.json',
	'.npmrc',
	'.pypirc',
	'id_rsa',
	'id_ed25519',
	'id_ecdsa',
	'id_dsa',
]);

const SAFE_TERMINAL_COMMANDS = /^\s*(git\s+(status|log|diff|show|branch|rev-parse|tag|remote)|ls|pwd|cat|head|tail|echo|which|grep|rg|find|test|node\s+-v|npm\s+-v|python\s+--version|tsc\s+--version)\b/;

const TRUSTED_NETWORK_HOSTS = new Set([
	'github.com',
	'api.github.com',
	'registry.npmjs.org',
	'raw.githubusercontent.com',
	'vscode.blob.core.windows.net',
	'update.code.visualstudio.com',
	'localhost',
	'127.0.0.1',
]);

export class ProjectSafetyService {
	private static _instance: ProjectSafetyService | undefined;

	static get instance(): ProjectSafetyService {
		if (!this._instance) {
			this._instance = new ProjectSafetyService();
		}
		return this._instance;
	}

	get mode(): ProjectSafetyMode {
		const vsc = getVsCode();
		if (!vsc) {
			return 'standard';
		}
		const cfg = vsc.workspace.getConfiguration('prebase.projectSafety');
		return cfg.get<ProjectSafetyMode>('mode', 'standard');
	}

	get requireTerminalApproval(): boolean {
		const vsc = getVsCode();
		if (!vsc) {
			return true;
		}
		const magnusCfg = vsc.workspace.getConfiguration('prebase.magnus');
		return magnusCfg.get<boolean>('requireTerminalApproval', true);
	}

	get requireEditApproval(): boolean {
		const vsc = getVsCode();
		if (!vsc) {
			return true;
		}
		const magnusCfg = vsc.workspace.getConfiguration('prebase.magnus');
		return magnusCfg.get<boolean>('requireEditApproval', true);
	}

	isSensitivePath(uriOrPath: vscodeTypes.Uri | string): boolean {
		const fsPath = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath;
		const base = path.basename(fsPath).toLowerCase();

		if (SENSITIVE_BASENAMES.has(base)) {
			return true;
		}
		if (base.startsWith('.env.')) {
			return true;
		}
		if (base.endsWith('.pem') || base.endsWith('.key') || base.endsWith('.pfx') || base.endsWith('.p12')) {
			return true;
		}

		const normalized = fsPath.replace(/\\/g, '/').toLowerCase();
		if (
			normalized.includes('/.git/config') ||
			normalized.includes('/.ssh/') ||
			normalized.includes('/.aws/') ||
			normalized.includes('/.gnupg/') ||
			normalized.includes('/secrets/')
		) {
			return true;
		}

		return false;
	}

	isInsideWorkspace(uriOrPath: vscodeTypes.Uri | string): boolean {
		const vsc = getVsCode();
		const fsPath = path.normalize(typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath);
		if (!vsc || !vsc.workspace.workspaceFolders || vsc.workspace.workspaceFolders.length === 0) {
			return true;
		}
		return vsc.workspace.workspaceFolders.some(folder => {
			const folderPath = path.normalize(folder.uri.fsPath);
			const rel = path.relative(folderPath, fsPath);
			return !rel.startsWith('..') && !path.isAbsolute(rel);
		});
	}

	async checkPermission(request: IActionPermissionRequest): Promise<IActionPermissionResult> {
		const vsc = getVsCode();
		const isStrict = this.mode === 'strict';

		// 1. Sensitive Path Interception
		if (request.targetPath && this.isSensitivePath(request.targetPath)) {
			return {
				allowed: false,
				reason: `Access to sensitive credential path '${typeof request.targetPath === 'string' ? request.targetPath : request.targetPath.fsPath}' is restricted by PreBase Project Safety.`,
			};
		}
		if (request.sourcePath && this.isSensitivePath(request.sourcePath)) {
			return {
				allowed: false,
				reason: `Access to sensitive credential path '${typeof request.sourcePath === 'string' ? request.sourcePath : request.sourcePath.fsPath}' is restricted by PreBase Project Safety.`,
			};
		}

		// 2. Sensitive File Read / Write explicit categories
		if (request.category === 'sensitiveFileRead' || request.category === 'sensitiveFileWrite') {
			return {
				allowed: false,
				reason: 'Direct programmatic access to sensitive credential files is restricted by PreBase Project Safety policy.',
			};
		}

		// 3. Workspace Read / Read
		if (request.category === 'read' || request.category === 'workspaceRead') {
			if (request.targetPath && !this.isInsideWorkspace(request.targetPath)) {
				return this._promptExternalAccess(request.targetPath, 'read');
			}
			return { allowed: true };
		}

		// 4. External File Read / Write
		if (request.category === 'externalFileRead') {
			if (!request.targetPath) {
				return { allowed: false, reason: 'Target path required for external file read.' };
			}
			return this._promptExternalAccess(request.targetPath, 'read');
		}

		if (request.category === 'externalFileWrite') {
			if (!request.targetPath) {
				return { allowed: false, reason: 'Target path required for external file write.' };
			}
			if (isStrict) {
				return { allowed: false, reason: 'External file writes are prohibited in Strict Project Safety mode.' };
			}
			return this._promptExternalAccess(request.targetPath, 'modify');
		}

		// 5. Workspace Write / Write
		if (request.category === 'write' || request.category === 'workspaceWrite') {
			if (request.targetPath && !this.isInsideWorkspace(request.targetPath)) {
				return this._promptExternalAccess(request.targetPath, 'modify');
			}
			if (isStrict || this.requireEditApproval) {
				if (vsc) {
					const displayPath = request.targetPath
						? (typeof request.targetPath === 'string' ? request.targetPath : vsc.workspace.asRelativePath(request.targetPath))
						: 'file';
					const choice = await vsc.window.showWarningMessage(
						`Agents wants to modify ${displayPath}. Allow?`,
						{ modal: true },
						'Allow',
						'Deny'
					);
					if (choice !== 'Allow') {
						return { allowed: false, reason: 'User denied file modification.' };
					}
				}
			}
			return { allowed: true };
		}

		// 6. File Delete / Move
		if (request.category === 'fileDelete') {
			if (vsc) {
				const displayPath = request.targetPath
					? (typeof request.targetPath === 'string' ? request.targetPath : vsc.workspace.asRelativePath(request.targetPath))
					: 'file';
				const choice = await vsc.window.showWarningMessage(
					`Agents wants to delete ${displayPath}. Allow?`,
					{ modal: true },
					'Delete',
					'Cancel'
				);
				if (choice !== 'Delete') {
					return { allowed: false, reason: 'User denied file deletion.' };
				}
			}
			return { allowed: true };
		}

		if (request.category === 'fileMove') {
			if (isStrict) {
				if (vsc) {
					const src = request.sourcePath ? (typeof request.sourcePath === 'string' ? request.sourcePath : vsc.workspace.asRelativePath(request.sourcePath)) : 'source';
					const dst = request.targetPath ? (typeof request.targetPath === 'string' ? request.targetPath : vsc.workspace.asRelativePath(request.targetPath)) : 'destination';
					const choice = await vsc.window.showWarningMessage(
						`Agents wants to move ${src} -> ${dst}. Allow?`,
						{ modal: true },
						'Allow',
						'Deny'
					);
					if (choice !== 'Allow') {
						return { allowed: false, reason: 'User denied file move.' };
					}
				}
			}
			return { allowed: true };
		}

		// 7. Terminal execution
		if (request.category === 'terminal') {
			if (vsc) {
				const termPolicy = vsc.workspace.getConfiguration('prebase.projectSafety').get<string>('terminalPolicy', 'prompt');
				if (termPolicy === 'deny') {
					return {
						allowed: false,
						reason: 'Terminal execution is disabled by PreBase Project Safety policy (prebase.projectSafety.terminalPolicy = "deny").',
					};
				}

				if (termPolicy === 'auto-safe' && request.command && SAFE_TERMINAL_COMMANDS.test(request.command)) {
					return { allowed: true };
				}

				if (this.requireTerminalApproval || isStrict) {
					const cmd = request.command || 'terminal command';
					const choice = await vsc.window.showWarningMessage(
						`Agents wants to execute command in terminal:\n${cmd}\n\nAllow execution?`,
						{ modal: true },
						'Allow',
						'Deny'
					);
					if (choice !== 'Allow') {
						return { allowed: false, reason: 'User denied terminal execution.' };
					}
				}
			}
			return { allowed: true };
		}

		// 8. Git Mutation & Dependency Mutation
		if (request.category === 'gitMutation' || request.category === 'dependencyMutation') {
			if (isStrict) {
				if (vsc) {
					const choice = await vsc.window.showWarningMessage(
						`Agents wants to execute ${request.category === 'gitMutation' ? 'Git repository mutation' : 'dependency mutation'}: ${request.command || request.description || ''}. Allow?`,
						{ modal: true },
						'Allow',
						'Deny'
					);
					if (choice !== 'Allow') {
						return { allowed: false, reason: `User denied ${request.category}.` };
					}
				}
			}
			return { allowed: true };
		}

		// 9. Network & Browser
		if (request.category === 'network') {
			if (request.url) {
				try {
					const parsed = new URL(request.url);
					if (TRUSTED_NETWORK_HOSTS.has(parsed.hostname)) {
						return { allowed: true };
					}
				} catch {
					// invalid url
				}
			}
			if (isStrict) {
				if (vsc) {
					const choice = await vsc.window.showWarningMessage(
						`Agents wants to make external network request to ${request.url || 'remote endpoint'}. Allow?`,
						{ modal: true },
						'Allow',
						'Deny'
					);
					if (choice !== 'Allow') {
						return { allowed: false, reason: 'User denied external network request.' };
					}
				}
			}
			return { allowed: true };
		}

		if (request.category === 'browser') {
			return { allowed: true };
		}

		// 10. MCP Tool Execution
		if (request.category === 'MCP') {
			if (isStrict) {
				if (vsc) {
					const choice = await vsc.window.showWarningMessage(
						`Agents wants to call MCP tool '${request.mcpServer ? `${request.mcpServer}:${request.mcpTool}` : (request.mcpTool || 'tool')}'. Allow?`,
						{ modal: true },
						'Allow',
						'Deny'
					);
					if (choice !== 'Allow') {
						return { allowed: false, reason: 'User denied MCP tool invocation.' };
					}
				}
			}
			return { allowed: true };
		}

		// 11. Runtime category
		if (request.category === 'runtime') {
			return { allowed: true };
		}

		return { allowed: true };
	}

	private async _promptExternalAccess(targetPath: string | vscodeTypes.Uri, action: 'read' | 'modify'): Promise<IActionPermissionResult> {
		const vsc = getVsCode();
		const p = typeof targetPath === 'string' ? targetPath : targetPath.fsPath;
		if (vsc) {
			const choice = await vsc.window.showWarningMessage(
				`Agents wants to ${action} file outside active workspace: ${p}. Allow external access?`,
				{ modal: true },
				'Allow',
				'Deny'
			);
			if (choice !== 'Allow') {
				return { allowed: false, reason: `User denied access to external file '${p}'.` };
			}
		}
		return { allowed: true };
	}
}

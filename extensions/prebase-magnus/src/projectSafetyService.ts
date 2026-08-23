/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import type * as vscodeTypes from 'vscode';

export type ProjectSafetyMode = 'standard' | 'strict';

export interface IActionPermissionRequest {
	readonly category: 'read' | 'write' | 'terminal' | 'network' | 'runtime';
	readonly targetPath?: string | vscodeTypes.Uri;
	readonly command?: string;
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

	async checkPermission(request: IActionPermissionRequest): Promise<IActionPermissionResult> {
		// 1. Target path sensitive checks
		if (request.targetPath) {
			if (this.isSensitivePath(request.targetPath)) {
				return {
					allowed: false,
					reason: `Access to sensitive credential path '${typeof request.targetPath === 'string' ? request.targetPath : request.targetPath.fsPath}' is restricted by PreBase Project Safety.`,
				};
			}
		}

		// 2. Read category: always allowed for non-sensitive workspace files
		if (request.category === 'read') {
			return { allowed: true };
		}

		// 3. Write category
		if (request.category === 'write') {
			if (this.mode === 'strict' || this.requireEditApproval) {
				const vsc = getVsCode();
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

		// 4. Terminal execution category
		if (request.category === 'terminal') {
			const vsc = getVsCode();
			if (vsc) {
				const termPolicy = vsc.workspace.getConfiguration('prebase.projectSafety').get<string>('terminalPolicy', 'prompt');
				if (termPolicy === 'deny') {
					return {
						allowed: false,
						reason: 'Terminal execution is disabled by PreBase Project Safety policy (prebase.projectSafety.terminalPolicy = "deny").',
					};
				}
				if (this.requireTerminalApproval || this.mode === 'strict') {
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

		// 5. Network / Runtime category
		if (request.category === 'network' || request.category === 'runtime') {
			return { allowed: true };
		}

		return { allowed: true };
	}
}

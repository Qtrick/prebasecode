/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ExternalLaunchRequest } from './prebaseDesktopTypes.js';

const ALLOWED_LAUNCH_COMMANDS = new Set(['npm', 'electron', 'cargo']);

/** Rejects arbitrary argv so desktop spawn cannot become a generic command runner. */
export function assertExternalLaunchRequest(request: ExternalLaunchRequest): void {
	if (!ALLOWED_LAUNCH_COMMANDS.has(request.command)) {
		throw new Error('Unsupported desktop launch command.');
	}
	if (request.args.some(arg => arg.includes('\0'))) {
		throw new Error('Invalid external launch command.');
	}
	if (request.command === 'npm') {
		const script = request.args[1];
		if (request.args[0] !== 'run' || typeof script !== 'string' || !script.trim() || request.args[2] !== '--') {
			throw new Error('npm launch is limited to `npm run <script> --`.');
		}
		if (script.includes('..') || script.includes('/') || script.includes('\\')) {
			throw new Error('npm launch script must be a package.json script name.');
		}
		if (request.args.length === 3) {
			return;
		}
		if (request.args.length === 5 && request.args[3] === '--features' && request.args[4] === 'prebase-testing') {
			return;
		}
		throw new Error('npm launch extra args are limited to `--features prebase-testing`.');
	}
	if (request.command === 'cargo') {
		if (request.args[0] !== 'tauri' || request.args[1] !== 'dev') {
			throw new Error('Cargo launch is limited to `tauri dev`.');
		}
		if (request.args.length === 2) {
			return;
		}
		if (request.args.length === 4 && request.args[2] === '--features' && request.args[3] === 'prebase-testing') {
			return;
		}
		throw new Error('Cargo launch is limited to `tauri dev` with optional `--features prebase-testing`.');
	}
	const entry = request.args[0];
	if (request.args.length !== 1 || typeof entry !== 'string' || !entry.trim() || entry.includes('..') || entry.startsWith('/') || entry.startsWith('~') || /^[A-Za-z]:[\\/]/.test(entry)) {
		throw new Error('Electron launch is limited to a workspace-relative main entry.');
	}
}

/** Resolves logical PreBase launch commands without relying on a shell-managed PATH. */
export function resolveExternalLaunchCommand(
	request: ExternalLaunchRequest,
	cwd: string,
	platform: NodeJS.Platform = process.platform,
	exists?: (path: string) => boolean,
): string {
	assertExternalLaunchRequest(request);
	if (request.command === 'npm') {
		return platform === 'win32' ? 'npm.cmd' : 'npm';
	}
	if (request.command === 'cargo') {
		return platform === 'win32' ? 'cargo.exe' : 'cargo';
	}
	const separator = platform === 'win32' ? '\\' : '/';
	const bin = platform === 'win32' ? 'electron.cmd' : 'electron';
	let dir = cwd.replace(/[\\/]+$/, '');
	const fallback = `${dir}${separator}node_modules${separator}.bin${separator}${bin}`;
	if (exists) {
		for (let i = 0; i < 8; i++) {
			const candidate = `${dir}${separator}node_modules${separator}.bin${separator}${bin}`;
			if (exists(candidate)) {
				return candidate;
			}
			const cut = dir.lastIndexOf(separator);
			if (cut <= 0) {
				break;
			}
			dir = dir.slice(0, cut);
		}
	}
	return fallback;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DetectedDevScript, PackageManager } from './types.js';

/** True when a package script would open a real Electron BrowserWindow (not renderer-only). */
export function scriptLaunchesElectronApp(scriptBody: string): boolean {
	const body = scriptBody.toLowerCase();
	if (body.includes('--rendereronly') || body.includes('--renderer-only')) {
		return false;
	}
	if (body.includes('electron-vite')) {
		return true;
	}
	if (body.includes('electron-forge') || body.includes('electron-builder')) {
		return true;
	}
	// `electron .` / `electron .` / path to electron binary — not plain "vite"
	return /(?:^|[\s"'`;&|])electron(?:\s|\.|$)/.test(body);
}

function runPrefix(pm: PackageManager): string {
	switch (pm) {
		case 'pnpm':
			return 'pnpm exec';
		case 'yarn':
			return 'yarn';
		case 'bun':
			return 'bunx';
		default:
			return 'npx';
	}
}

/**
 * For managed "Open through PreBase", never spawn the project's Electron main.
 * Rewrite electron-vite / electron scripts to a renderer-only server command.
 */
export function managedRendererDevCommand(script: DetectedDevScript): string | undefined {
	const body = script.scriptBody.trim();
	const lower = body.toLowerCase();
	const prefix = runPrefix(script.packageManager);

	if (!scriptLaunchesElectronApp(body)) {
		return script.command;
	}

	if (lower.includes('electron-vite')) {
		// electron-vite --rendererOnly starts Vite only (no Electron window).
		return `${prefix} electron-vite --rendererOnly`;
	}

	// Plain Electron entry with no separate renderer server — managed mode cannot
	// host main/preload; caller should wait for an existing URL or fail honestly.
	return undefined;
}

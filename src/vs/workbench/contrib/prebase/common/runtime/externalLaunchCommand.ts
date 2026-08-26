/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ExternalLaunchRequest } from './desktopTypes.js';

/** Builds the standard Electron project launch without passing project text through a shell. */
export function buildNpmExternalLaunchRequest(scriptName: string): ExternalLaunchRequest {
	return { command: 'npm', args: ['run', scriptName, '--'] };
}

/** Builds a direct invocation for Electron projects that declare a main entry but no script. */
export function buildElectronExternalLaunchRequest(mainEntry: string): ExternalLaunchRequest {
	return { command: 'electron', args: [mainEntry] };
}

/** Builds a shell-free Tauri launch. Prefer a declared npm script, otherwise cargo tauri dev. */
export function buildTauriExternalLaunchRequest(scriptName?: string, testingFeature = false): ExternalLaunchRequest {
	const testingArgs = testingFeature ? ['--features', 'prebase-testing'] as const : [];
	if (scriptName) {
		return { command: 'npm', args: ['run', scriptName, '--', ...testingArgs] };
	}
	return { command: 'cargo', args: ['tauri', 'dev', ...testingArgs] };
}

/** Cargo/tauri must run in the crate directory (often src-tauri), not the workspace folder. */
export function tauriLaunchCwd(workspaceRoot: string, cargoTomlPath?: string): string {
	if (!cargoTomlPath) {
		return workspaceRoot;
	}
	const normalized = cargoTomlPath.replace(/\\/g, '/');
	const dir = normalized.replace(/\/Cargo\.toml$/i, '');
	if (dir === normalized) {
		return workspaceRoot;
	}
	if (dir.startsWith('/') || /^[A-Za-z]:\//.test(dir)) {
		return dir;
	}
	return `${workspaceRoot.replace(/[\\/]+$/, '')}/${dir}`;
}

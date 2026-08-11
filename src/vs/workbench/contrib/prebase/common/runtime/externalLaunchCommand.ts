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

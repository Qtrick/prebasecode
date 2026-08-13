/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ExternalLaunchRequest } from './prebaseDesktopTypes.js';

/** Resolves logical PreBase launch commands without relying on a shell-managed PATH. */
export function resolveExternalLaunchCommand(request: ExternalLaunchRequest, cwd: string, platform: NodeJS.Platform = process.platform): string {
	if (request.command === 'npm') {
		return platform === 'win32' ? 'npm.cmd' : 'npm';
	}
	if (request.command === 'electron') {
		const separator = platform === 'win32' ? '\\' : '/';
		const root = cwd.replace(/[\\/]+$/, '');
		return `${root}${separator}node_modules${separator}.bin${separator}${platform === 'win32' ? 'electron.cmd' : 'electron'}`;
	}
	return request.command;
}

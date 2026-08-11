/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type DesktopLaunchMode = 'managed' | 'external';

/** A shell-free command invocation owned by the desktop runtime. */
export interface ExternalLaunchRequest {
	command: string;
	args: string[];
}

export interface DesktopLaunchRequest {
	sessionId: string;
	workspaceRoot: string;
	launchMode: DesktopLaunchMode;
	rendererUrl: string;
	title: string;
	command?: ExternalLaunchRequest;
	cwd?: string;
	debugPort?: number;
	showManagementBar: boolean;
}

export interface ManagedWindowState {
	sessionId: string;
	windowId: number;
	rendererUrl: string;
	title: string;
}

export interface IPreBaseDesktopSpawnResult {
	pid: number;
	debugPort?: number;
}

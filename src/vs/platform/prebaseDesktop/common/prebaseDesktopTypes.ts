/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type DesktopLaunchMode = 'managed' | 'external';

export interface DesktopLaunchRequest {
	sessionId: string;
	workspaceRoot: string;
	launchMode: DesktopLaunchMode;
	rendererUrl: string;
	title: string;
	command?: string;
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

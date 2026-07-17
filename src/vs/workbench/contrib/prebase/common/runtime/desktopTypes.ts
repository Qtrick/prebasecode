/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type { DesktopLaunchMode, DesktopLaunchRequest, ManagedWindowState } from '../../../../../platform/prebaseDesktop/common/prebaseDesktopTypes.js';
import type { DesktopLaunchMode } from '../../../../../platform/prebaseDesktop/common/prebaseDesktopTypes.js';

export type DesktopSessionState =
	| 'idle'
	| 'starting'
	| 'running'
	| 'stopping'
	| 'stopped'
	| 'error';

export type ElectronDetectionConfidence = 'none' | 'low' | 'medium' | 'high';

export interface DesktopCapabilities {
	supportsManagedLaunch: boolean;
	supportsExternalLaunch: boolean;
	supportsCdpAttach: boolean;
	supportsDevServerAutostart: boolean;
	supportsDOMInspection: boolean;
	supportsConsoleCapture: boolean;
	supportsNetworkCapture: boolean;
	supportsScreenshots: boolean;
	supportsInputAutomation: boolean;
	supportsWindowManagement: boolean;
	requiresPreload: boolean;
	requiresMainProcess: boolean;
	/** Honest limits shown in UI / tool results. */
	limitations: string[];
	managedLaunchBlockers: string[];
}

export interface ElectronProjectPaths {
	main?: string;
	preload?: string;
	renderer?: string;
}

export interface ElectronProjectProfile {
	isElectron: boolean;
	confidence: ElectronDetectionConfidence;
	label: string;
	paths: ElectronProjectPaths;
	capabilities: DesktopCapabilities;
	electronScriptName?: string;
	rendererUrlHint?: string;
	likelyDevPort: number;
	reasons: string[];
}

export interface CdpTarget {
	id: string;
	type: string;
	title: string;
	url: string;
	webSocketDebuggerUrl?: string;
}

export interface PreBaseDesktopSession {
	id: string;
	workspaceRoot: string;
	launchMode: DesktopLaunchMode;
	state: DesktopSessionState;
	profile: ElectronProjectProfile;
	rendererUrl?: string;
	debugPort?: number;
	pid?: number;
	managedWindowId?: number;
	cdpTargets: CdpTarget[];
	errorMessage?: string;
	startedAt?: number;
	ownedByPreBase: boolean;
}

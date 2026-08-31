/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type { DesktopLaunchMode, DesktopLaunchRequest, ExternalLaunchRequest, ManagedWindowState } from '../../../../../platform/prebaseDesktop/common/prebaseDesktopTypes.js';
import type { DesktopLaunchMode } from '../../../../../platform/prebaseDesktop/common/prebaseDesktopTypes.js';
import type { PackageManager } from './types.js';
import type { TauriTestingSetupState } from './tauriTestingSetup.js';

export type DesktopSessionState =
	| 'idle'
	| 'starting'
	| 'running'
	| 'testing'
	| 'stopping'
	| 'stopped'
	| 'error'
	| 'setupRequired';

export type DesktopFramework = 'electron' | 'tauri';
export type DesktopDetectionConfidence = 'none' | 'low' | 'medium' | 'high';
export type DesktopSessionPurpose = 'preview' | 'test';
export type DesktopAutomationBackend = 'cdp' | 'webdriver' | 'none';

/** User-facing launch mode. Internally mapped onto managed (renderer) vs external (full app). */
export type DesktopUiMode = 'renderer' | 'fullApp';

export interface DesktopCapabilities {
	supportsManagedLaunch: boolean;
	supportsExternalLaunch: boolean;
	supportsCdpAttach: boolean;
	supportsDevServerAutostart: boolean;
	supportsDOMInspection: boolean;
	supportsSemanticLocators: boolean;
	supportsConsoleCapture: boolean;
	supportsNetworkCapture: boolean;
	supportsScreenshots: boolean;
	supportsInputAutomation: boolean;
	supportsWindowManagement: boolean;
	supportsRendererAutomation: boolean;
	supportsFullNativeAutomation: boolean;
	supportsBackendApiAccess: boolean;
	supportsMainProcessAccess: boolean;
	supportsNativeDialogAutomation: boolean;
	requiresPreload: boolean;
	requiresMainProcess: boolean;
	fullNativeSetupRequired: boolean;
	fullNativeSetupReason?: string;
	/** Honest limits shown in UI / tool results. */
	limitations: string[];
	managedLaunchBlockers: string[];
}

export interface DesktopProjectProfileBase {
	framework: DesktopFramework;
	label: string;
	confidence: DesktopDetectionConfidence;
	capabilities: DesktopCapabilities;
	reasons: string[];
	rendererUrlHint?: string;
	likelyDevPort: number;
	appRoot?: string;
	packageManager: PackageManager;
}

export interface ElectronProjectPaths {
	main?: string;
	preload?: string;
	renderer?: string;
}

export interface ElectronProjectProfile extends DesktopProjectProfileBase {
	framework: 'electron';
	paths: ElectronProjectPaths;
	electronScriptName?: string;
}

export interface TauriProjectProfile extends DesktopProjectProfileBase {
	framework: 'tauri';
	configPath?: string;
	cargoTomlPath?: string;
	identifier?: string;
	productName?: string;
	beforeDevCommand?: string;
	tauriScriptName?: string;
	hasWdioPlugin: boolean;
	hasWdioWebdriverPlugin: boolean;
	testingCargoFeature: boolean;
	testingSetup: TauriTestingSetupState;
	isRustOnly: boolean;
}

export type DesktopProjectProfile = ElectronProjectProfile | TauriProjectProfile;

export function isElectronProfile(profile: DesktopProjectProfile | undefined | null): profile is ElectronProjectProfile {
	return profile?.framework === 'electron';
}

export function isTauriProfile(profile: DesktopProjectProfile | undefined | null): profile is TauriProjectProfile {
	return profile?.framework === 'tauri';
}

export function isRecognizedDesktopApp(profile: DesktopProjectProfile | undefined | null): profile is DesktopProjectProfile {
	return profile?.confidence === 'high' || profile?.confidence === 'medium';
}

export function desktopUiModeFromLaunch(mode: DesktopLaunchMode): DesktopUiMode {
	return mode === 'external' ? 'fullApp' : 'renderer';
}

export function desktopLaunchFromUiMode(mode: DesktopUiMode): DesktopLaunchMode {
	return mode === 'fullApp' ? 'external' : 'managed';
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
	profile: DesktopProjectProfile;
	purpose: DesktopSessionPurpose;
	automationBackend: DesktopAutomationBackend;
	rendererUrl?: string;
	debugPort?: number;
	webDriverPort?: number;
	pid?: number;
	managedWindowId?: number;
	cdpTargets: CdpTarget[];
	errorMessage?: string;
	startedAt?: number;
	ownedByPreBase: boolean;
	testRunId?: string;
}

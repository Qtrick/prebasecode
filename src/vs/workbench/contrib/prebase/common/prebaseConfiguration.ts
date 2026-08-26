/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerPreBaseGraphConfiguration } from '../graphs/host/workbench/graphConfigurationContribution.js';
import { PREBASE_GRAPH_RESETTABLE_CONFIG_KEYS } from '../graphs/common/configuration/graphConfigKeys.js';
import { PreBaseCloudConfigKeys, registerPreBaseCloudConfiguration } from './cloud/cloudConfiguration.js';

export {
	PREBASE_GRAPH_CHANNEL_ID,
	PREBASE_GRAPH_CHANNEL_LABEL,
	PreBaseGraphConfigKeys,
} from '../graphs/common/configuration/graphConfigKeys.js';

export const PREBASE_RUNTIME_CHANNEL_ID = 'prebaseRuntime';
export const PREBASE_RUNTIME_CHANNEL_LABEL = localize('prebase.runtime.channel', "PreBase Runtime");

export enum PreBaseConfigKeys {
	// Appearance / UI
	UiDensity = 'prebase.ui.density',
	UiMagnusDisplay = 'prebase.ui.magnusDisplay',
	UiCompactGraphControls = 'prebase.ui.compactGraphControls',
	UiCollapseLongSections = 'prebase.ui.collapseLongSections',
	UiShowStatusItems = 'prebase.ui.showStatusItems',
	UiSidebarMinWidth = 'prebase.ui.sidebarMinWidth',
	UiSidebarMaxWidth = 'prebase.ui.sidebarMaxWidth',
	UiSidebarLeftWidth = 'prebase.ui.sidebarLeftWidth',
	UiSidebarCollapsedWidth = 'prebase.ui.sidebarCollapsedWidth',
	UiSidebarInspectorWidth = 'prebase.ui.sidebarInspectorWidth',

	// Interaction (workbench shell — graph canvas keys live in PreBaseGraphConfigKeys)
	InteractionTerminalVisibilityGraph = 'prebase.interaction.terminalVisibility.graph',
	InteractionTerminalVisibilityRuntime = 'prebase.interaction.terminalVisibility.runtime',
	InteractionTerminalVisibilitySettings = 'prebase.interaction.terminalVisibility.settings',

	// Home / recent projects (history is IWorkspacesService — these keys configure Home UI only)
	HomeOpenWhenEditorsEmpty = 'prebase.home.openWhenEditorsEmpty',

	// Account (API optional — unconfigured disables credential POST)
	AccountApiBaseUrl = 'prebase.account.apiBaseUrl',

	// Runtime
	RuntimeAutoDetect = 'prebase.runtime.autoDetect',
	RuntimeAutoOpen = 'prebase.runtime.autoOpen',
	RuntimeAutoReload = 'prebase.runtime.autoReload',
	RuntimeDefaultUrl = 'prebase.runtime.defaultUrl',
	RuntimeAllowExternalUrls = 'prebase.runtime.allowExternalUrls',
	RuntimeDefaultViewport = 'prebase.runtime.defaultViewport',
	RuntimeCaptureConsole = 'prebase.runtime.captureConsole',
	RuntimeCaptureNetwork = 'prebase.runtime.captureNetwork',
	RuntimeConfirmCommands = 'prebase.runtime.confirmCommands',
	RuntimePreserveSession = 'prebase.runtime.preserveSession',
	RuntimeReportHistoryLimit = 'prebase.runtime.reportHistoryLimit',

	// Desktop runtime
	RuntimeDesktopLaunchMode = 'prebase.runtime.desktopLaunchMode',
	RuntimeRememberDesktopLaunchMode = 'prebase.runtime.rememberDesktopLaunchMode',
	RuntimeStopManagedAppsOnExit = 'prebase.runtime.stopManagedAppsOnExit',
	RuntimeStopExternalAppsOnExit = 'prebase.runtime.stopExternalAppsOnExit',
	RuntimeEnableDesktopAutomation = 'prebase.runtime.enableDesktopAutomation',
	RuntimeConfirmApplicationTermination = 'prebase.runtime.confirmApplicationTermination',
	RuntimeManagedApplicationBar = 'prebase.runtime.managedApplicationBar',
}

/** All `prebase.*` keys owned by PreBase settings (for Reset all). Excludes extension-owned `prebase.magnus.*`. */
export const PREBASE_RESETTABLE_CONFIG_KEYS: readonly string[] = [
	...new Set([...Object.values(PreBaseConfigKeys), ...Object.values(PreBaseCloudConfigKeys), ...PREBASE_GRAPH_RESETTABLE_CONFIG_KEYS]),
];

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

registerPreBaseGraphConfiguration();
registerPreBaseCloudConfiguration();

configurationRegistry.registerConfiguration({
	id: 'prebaseAppearance',
	order: 100,
	title: localize('prebaseAppearanceTitle', "PreBase Appearance"),
	type: 'object',
	properties: {
		[PreBaseConfigKeys.UiDensity]: {
			type: 'string',
			enum: ['comfortable', 'compact'],
			enumDescriptions: [
				localize('prebase.ui.density.comfortable', "Standard spacing in sidebars and panels."),
				localize('prebase.ui.density.compact', "Tighter spacing in sidebars and panels."),
			],
			default: 'comfortable',
			description: localize('prebase.ui.density', "UI density for PreBase sidebars and panels. Reserved — Maps/Runtime UI does not read this setting yet."),
		},
		[PreBaseConfigKeys.UiMagnusDisplay]: {
			type: 'string',
			enum: ['float', 'sidebar'],
			enumDescriptions: [
				localize('prebase.ui.magnusDisplay.float', "Float keeps Agents as a draggable bubble."),
				localize('prebase.ui.magnusDisplay.sidebar', "Sidebar pins Agents as a resizable right panel."),
			],
			default: 'sidebar',
			description: localize('prebase.ui.magnusDisplay', "How Agents AI is displayed in the PreBase workbench."),
		},
		[PreBaseConfigKeys.UiCompactGraphControls]: {
			type: 'boolean',
			default: false,
			description: localize('prebase.ui.compactGraphControls', "Use compact controls in PreBase Maps. Reserved — Maps UI does not read this setting yet."),
		},
		[PreBaseConfigKeys.UiShowStatusItems]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.ui.showStatusItems', "Show PreBase status items in the status bar. Reserved — no PreBase status-bar items are registered yet."),
		},
	}
});

configurationRegistry.registerConfiguration({
	id: 'prebaseSidebar',
	order: 102,
	title: localize('prebaseSidebarTitle', "PreBase Sidebar"),
	type: 'object',
	properties: {
		[PreBaseConfigKeys.UiCollapseLongSections]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.ui.collapseLongSections', "Collapse long sections in PreBase sidebars by default. Reserved — Maps UI does not read this setting yet."),
		},
		[PreBaseConfigKeys.UiSidebarMinWidth]: {
			type: 'number',
			default: 180,
			minimum: 160,
			maximum: 280,
			description: localize('prebase.ui.sidebarMinWidth', "Minimum PreBase sidebar width in pixels. Reserved — not applied to the workbench sidebar yet."),
		},
		[PreBaseConfigKeys.UiSidebarMaxWidth]: {
			type: 'number',
			default: 420,
			minimum: 300,
			maximum: 560,
			description: localize('prebase.ui.sidebarMaxWidth', "Maximum PreBase sidebar width in pixels. Reserved — not applied to the workbench sidebar yet."),
		},
		[PreBaseConfigKeys.UiSidebarLeftWidth]: {
			type: 'number',
			default: 224,
			minimum: 160,
			maximum: 560,
			description: localize('prebase.ui.sidebarLeftWidth', "Default left PreBase sidebar width in pixels. Reserved — not applied to the workbench sidebar yet."),
		},
		[PreBaseConfigKeys.UiSidebarCollapsedWidth]: {
			type: 'number',
			default: 36,
			minimum: 32,
			maximum: 56,
			description: localize('prebase.ui.sidebarCollapsedWidth', "Collapsed PreBase sidebar rail width in pixels. Reserved — not applied to the workbench sidebar yet."),
		},
		[PreBaseConfigKeys.UiSidebarInspectorWidth]: {
			type: 'number',
			default: 240,
			minimum: 160,
			maximum: 560,
			description: localize('prebase.ui.sidebarInspectorWidth', "Right inspector panel width in pixels. Reserved — not applied to the workbench sidebar yet."),
		},
	}
});

configurationRegistry.registerConfiguration({
	id: 'prebaseInteraction',
	order: 103,
	title: localize('prebaseInteractionTitle', "PreBase Interaction"),
	type: 'object',
	properties: {
		[PreBaseConfigKeys.InteractionTerminalVisibilityGraph]: {
			type: 'boolean',
			default: false,
			description: localize('prebase.interaction.terminalVisibility.graph', "Show the bottom terminal panel while Graph View is active."),
		},
		[PreBaseConfigKeys.InteractionTerminalVisibilityRuntime]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.interaction.terminalVisibility.runtime', "Show the bottom terminal panel while Runtime Preview is active."),
		},
		[PreBaseConfigKeys.InteractionTerminalVisibilitySettings]: {
			type: 'boolean',
			default: false,
			description: localize('prebase.interaction.terminalVisibility.settings', "Show the bottom terminal panel while PreBase Settings is active."),
		},
	}
});

configurationRegistry.registerConfiguration({
	id: 'prebaseRuntime',
	order: 104,
	title: localize('prebaseRuntimeTitle', "PreBase Runtime"),
	type: 'object',
	properties: {
		[PreBaseConfigKeys.RuntimeAutoDetect]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.runtime.autoDetect', "Automatically detect preview configurations in the workspace."),
		},
		[PreBaseConfigKeys.RuntimeAutoOpen]: {
			type: 'boolean',
			default: false,
			description: localize('prebase.runtime.autoOpen', "Automatically open Runtime Preview when a target is detected."),
		},
		[PreBaseConfigKeys.RuntimeAutoReload]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.runtime.autoReload', "Automatically reload the Runtime Preview when the target URL changes."),
		},
		[PreBaseConfigKeys.RuntimeDefaultUrl]: {
			type: 'string',
			default: 'http://localhost:5173',
			description: localize('prebase.runtime.defaultUrl', "Default URL for Runtime Preview."),
		},
		[PreBaseConfigKeys.RuntimeAllowExternalUrls]: {
			type: 'boolean',
			default: false,
			description: localize('prebase.runtime.allowExternalUrls', "Allow loading non-localhost URLs without confirmation."),
		},
		[PreBaseConfigKeys.RuntimeDefaultViewport]: {
			type: 'string',
			enum: ['responsive', 'desktop', 'laptop', 'tablet', 'mobile'],
			default: 'responsive',
			description: localize('prebase.runtime.defaultViewport', "Default viewport preset for Runtime Preview."),
		},
		[PreBaseConfigKeys.RuntimeCaptureConsole]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.runtime.captureConsole', "Capture console messages from Runtime Preview (stub)."),
		},
		[PreBaseConfigKeys.RuntimeCaptureNetwork]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.runtime.captureNetwork', "Capture network activity from Runtime Preview (stub)."),
		},
		[PreBaseConfigKeys.RuntimeConfirmCommands]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.runtime.confirmCommands', "Confirm before running Runtime Preview commands that may change state."),
		},
		[PreBaseConfigKeys.RuntimePreserveSession]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.runtime.preserveSession', "Preserve Runtime Preview session state across reloads when possible."),
		},
		[PreBaseConfigKeys.RuntimeReportHistoryLimit]: {
			type: 'number',
			default: 20,
			minimum: 1,
			maximum: 200,
			description: localize('prebase.runtime.reportHistoryLimit', "Maximum number of Runtime Preview test reports to keep."),
		},
		[PreBaseConfigKeys.RuntimeDesktopLaunchMode]: {
			type: 'string',
			enum: ['managed', 'external'],
			enumDescriptions: [
				localize('prebase.runtime.desktopLaunchMode.managed', "Renderer mode: host the app frontend in a PreBase window. Electron main/preload and Tauri Rust are not executed."),
				localize('prebase.runtime.desktopLaunchMode.external', "Full app mode: launch the real Electron or Tauri application. Electron uses localhost CDP; Tauri full-native automation may require Enable PreBase Tauri Testing."),
			],
			default: 'managed',
			description: localize('prebase.runtime.desktopLaunchMode', "How PreBase launches detected Electron or Tauri desktop applications."),
		},
		[PreBaseConfigKeys.RuntimeRememberDesktopLaunchMode]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.runtime.rememberDesktopLaunchMode', "Remember the selected desktop launch mode in settings."),
		},
		[PreBaseConfigKeys.RuntimeStopManagedAppsOnExit]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.runtime.stopManagedAppsOnExit', "Close PreBase-managed desktop windows when PreBase exits."),
		},
		[PreBaseConfigKeys.RuntimeStopExternalAppsOnExit]: {
			type: 'boolean',
			default: false,
			description: localize('prebase.runtime.stopExternalAppsOnExit', "Stop externally launched preview desktop processes when PreBase exits. Test-owned sessions always stop."),
		},
		[PreBaseConfigKeys.RuntimeEnableDesktopAutomation]: {
			type: 'boolean',
			default: false,
			description: localize('prebase.runtime.enableDesktopAutomation', "Allow Agents to evaluate JavaScript in PreBase-owned preview desktop sessions. Test-lab interact/assert tools already run after Start Desktop Test Session confirmation."),
		},
		[PreBaseConfigKeys.RuntimeConfirmApplicationTermination]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.runtime.confirmApplicationTermination', "Confirm before stopping a launched desktop application."),
		},
		[PreBaseConfigKeys.RuntimeManagedApplicationBar]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.runtime.managedApplicationBar', "Show the PreBase management strip in managed desktop windows."),
		},
	}
});

configurationRegistry.registerConfiguration({
	id: 'prebaseHome',
	order: 99,
	title: localize('prebaseHomeTitle', "PreBase Home"),
	type: 'object',
	properties: {
		[PreBaseConfigKeys.HomeOpenWhenEditorsEmpty]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.home.openWhenEditorsEmpty', "Automatically open PreBase Home when all editor tabs are closed. Explicitly closing Home during an empty transition will not reopen it until editors are opened again and then emptied."),
		},
		[PreBaseConfigKeys.AccountApiBaseUrl]: {
			type: 'string',
			default: '',
			description: localize('prebase.account.apiBaseUrl', "Deprecated legacy HTTPS account API base URL. Prefer prebase.cloud.url and prebase.cloud.publishableKey for Supabase Auth. When all account settings are empty, credential forms stay disabled and Continue without signing in still works."),
		},
	}
});

configurationRegistry.registerConfiguration({
	id: 'prebaseAgents',
	order: 104,
	title: localize('prebaseAgentsTitle', "PreBase Agents & AI"),
	type: 'object',
	properties: {
		'prebase.magnus.enabled': {
			type: 'boolean',
			default: true,
			description: localize('prebase.magnus.enabled', "Enable or disable PreBase Agents AI features."),
		},
		'prebase.magnus.executionMode': {
			type: 'string',
			enum: ['auto', 'development-env', 'byok', 'hosted'],
			enumDescriptions: [
				localize('prebase.magnus.executionMode.auto', "Automatic: Uses PreBase root .env in source dev, BYOK key if configured, or PreBase Cloud hosted gateway when signed in."),
				localize('prebase.magnus.executionMode.developmentEnv', "Development Environment: Directly uses GEMINI_API_KEY from the authentic PreBase application root .env."),
				localize('prebase.magnus.executionMode.byok', "Bring Your Own Key: Uses API key stored in secure OS SecretStorage."),
				localize('prebase.magnus.executionMode.hosted', "PreBase Hosted: Routes model requests securely through PreBase Cloud authenticated agent-gateway."),
			],
			default: 'auto',
			description: localize('prebase.magnus.executionMode', "Execution mode and credential source for PreBase AI services."),
		},
		'prebase.magnus.provider': {
			type: 'string',
			default: 'gemini',
			description: localize('prebase.magnus.provider', "Active AI model provider for PreBase Agents."),
		},
	}
});


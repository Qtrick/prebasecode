/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

export const PREBASE_GRAPH_CHANNEL_ID = 'prebaseGraph';
export const PREBASE_GRAPH_CHANNEL_LABEL = localize('prebase.graph.channel', "PreBase Graph");

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

	// Graph
	GraphDefaultType = 'prebase.graph.defaultType',
	GraphDefaultArchitectureLayout = 'prebase.graph.defaultArchitectureLayout',
	GraphAutoScan = 'prebase.graph.autoScan',
	GraphShowLegend = 'prebase.graph.showLegend',
	GraphShowMinimap = 'prebase.graph.showMinimap',
	GraphHideLowImportance = 'prebase.graph.hideLowImportance',
	GraphShowEdgeLabels = 'prebase.graph.showEdgeLabels',
	GraphInitialZoom = 'prebase.graph.initialZoom',
	GraphLegendInteractionDim = 'prebase.graph.legendInteractionDim',
	GraphLayoutAnimationDuration = 'prebase.graph.layoutAnimationDuration',
	GraphLayerRadiusScale = 'prebase.graph.layerRadiusScale',
	GraphMaxNodesPerLayer = 'prebase.graph.maxNodesPerLayer',
	GraphLayerGap = 'prebase.graph.layerGap',
	GraphCenterClearance = 'prebase.graph.centerClearance',
	GraphScatterRelaxIterations = 'prebase.graph.scatterRelaxIterations',
	GraphFolderExpansionRadius = 'prebase.graph.folderExpansionRadius',
	GraphVisibleRelatedConnections = 'prebase.graph.visibleRelatedConnections',
	GraphMaxRenderedNodes = 'prebase.graph.maxRenderedNodes',
	GraphMaxRenderedEdges = 'prebase.graph.maxRenderedEdges',
	GraphNetworkForceStrength = 'prebase.graph.networkForceStrength',
	GraphNetworkLinkDistance = 'prebase.graph.networkLinkDistance',
	GraphNetworkCharge = 'prebase.graph.networkCharge',
	GraphNetworkCollisionRadius = 'prebase.graph.networkCollisionRadius',
	GraphNetworkAlphaDecay = 'prebase.graph.networkAlphaDecay',
	GraphNetworkIdleAutoRotate = 'prebase.graph.networkIdleAutoRotate',
	GraphNetworkPhysicsStrength = 'prebase.graph.networkPhysicsStrength',
	GraphNetworkEdgeOpacity = 'prebase.graph.networkEdgeOpacity',
	GraphReduceMotion = 'prebase.graph.reduceMotion',
	GraphQuality = 'prebase.graph.quality',
	GraphRenderThrottleMs = 'prebase.graph.renderThrottleMs',
	GraphNetworkLodNodeThreshold = 'prebase.graph.networkLodNodeThreshold',
	GraphNetworkSimulationTicks = 'prebase.graph.networkSimulationTicks',
	GraphNetworkLayoutMode = 'prebase.graph.networkLayoutMode',
	GraphNetworkSpreadScale = 'prebase.graph.networkSpreadScale',
	GraphArchitectureMode = 'prebase.graph.architectureMode',
	GraphFilter = 'prebase.graph.filter',
	GraphExplorerViewMode = 'prebase.graph.explorerViewMode',

	// Interaction
	InteractionPanSensitivity = 'prebase.interaction.panSensitivity',
	InteractionZoomSensitivity = 'prebase.interaction.zoomSensitivity',
	InteractionNetworkDragDirection = 'prebase.interaction.networkDragDirection',
	InteractionNodeDragDelayMs = 'prebase.interaction.nodeDragDelayMs',
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
}

/** All `prebase.*` keys owned by PreBase settings (for Reset all). Excludes extension-owned `prebase.magnus.*`. */
export const PREBASE_RESETTABLE_CONFIG_KEYS: readonly string[] = Object.values(PreBaseConfigKeys);

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

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
		[PreBaseConfigKeys.GraphReduceMotion]: {
			type: 'boolean',
			default: false,
			description: localize('prebase.graph.reduceMotion', "Reduce motion in PreBase graph and UI animations."),
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
	id: 'prebaseGraph',
	order: 101,
	title: localize('prebaseGraphTitle', "PreBase Graph"),
	type: 'object',
	properties: {
		[PreBaseConfigKeys.GraphDefaultType]: {
			type: 'string',
			enum: ['architecture', 'network'],
			default: 'architecture',
			description: localize('prebase.graph.defaultType', "Default PreBase graph type to open."),
			scope: ConfigurationScope.RESOURCE
		},
		[PreBaseConfigKeys.GraphDefaultArchitectureLayout]: {
			type: 'string',
			enum: ['hierarchy', 'pyramid', 'scattered'],
			default: 'hierarchy',
			description: localize('prebase.graph.defaultArchitectureLayout', "Default architecture graph layout."),
			scope: ConfigurationScope.RESOURCE
		},
		[PreBaseConfigKeys.GraphAutoScan]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.graph.autoScan', "Automatically scan the workspace when opening PreBase Maps."),
			scope: ConfigurationScope.RESOURCE
		},
		[PreBaseConfigKeys.GraphShowLegend]: {
			type: 'boolean',
			default: true,
			description: localize('prebase.graph.showLegend', "Show the graph legend."),
		},
		[PreBaseConfigKeys.GraphShowMinimap]: {
			type: 'boolean',
			default: false,
			description: localize('prebase.graph.showMinimap', "Show the graph minimap. Not available yet — this setting has no effect until minimap rendering ships."),
		},
		[PreBaseConfigKeys.GraphHideLowImportance]: {
			type: 'boolean',
			default: false,
			description: localize('prebase.graph.hideLowImportance', "Hide low-importance nodes from the rendered graph."),
		},
		[PreBaseConfigKeys.GraphShowEdgeLabels]: {
			type: 'boolean',
			default: false,
			description: localize('prebase.graph.showEdgeLabels', "Show import paths on dependency edges."),
		},
		[PreBaseConfigKeys.GraphInitialZoom]: {
			type: 'number',
			default: 0.92,
			minimum: 0.5,
			maximum: 1.4,
			description: localize('prebase.graph.initialZoom', "Camera zoom when a project first loads."),
		},
		[PreBaseConfigKeys.GraphLegendInteractionDim]: {
			type: 'number',
			default: 40,
			minimum: 0,
			maximum: 80,
			description: localize('prebase.graph.legendInteractionDim', "How much the architecture legend fades while panning, zooming, or selecting (0–80%)."),
		},
		[PreBaseConfigKeys.GraphLayoutAnimationDuration]: {
			type: 'number',
			default: 750,
			minimum: 0,
			maximum: 2000,
			description: localize('prebase.graph.layoutAnimationDuration', "Fit-view / layout animation duration in milliseconds."),
		},
		[PreBaseConfigKeys.GraphLayerRadiusScale]: {
			type: 'number',
			default: 1,
			minimum: 0.7,
			maximum: 1.4,
			description: localize('prebase.graph.layerRadiusScale', "Scales concentric ring radii for architecture layouts."),
		},
		[PreBaseConfigKeys.GraphMaxNodesPerLayer]: {
			type: 'number',
			default: 24,
			minimum: 8,
			maximum: 48,
			description: localize('prebase.graph.maxNodesPerLayer', "Maximum nodes per layer before an overflow sub-ring is added."),
		},
		[PreBaseConfigKeys.GraphLayerGap]: {
			type: 'number',
			default: 96,
			minimum: 80,
			maximum: 200,
			description: localize('prebase.graph.layerGap', "Distance between dependency rings."),
		},
		[PreBaseConfigKeys.GraphCenterClearance]: {
			type: 'number',
			default: 80,
			minimum: 64,
			maximum: 160,
			description: localize('prebase.graph.centerClearance', "Radius of the innermost ring."),
		},
		[PreBaseConfigKeys.GraphScatterRelaxIterations]: {
			type: 'number',
			default: 10,
			minimum: 4,
			maximum: 24,
			description: localize('prebase.graph.scatterRelaxIterations', "Spacing relaxation iterations for scattered layout."),
		},
		[PreBaseConfigKeys.GraphFolderExpansionRadius]: {
			type: 'number',
			default: 82,
			minimum: 48,
			maximum: 160,
			description: localize('prebase.graph.folderExpansionRadius', "Tree mode radial child layout radius."),
		},
		[PreBaseConfigKeys.GraphVisibleRelatedConnections]: {
			type: 'number',
			default: 1,
			minimum: 0,
			maximum: 2,
			description: localize('prebase.graph.visibleRelatedConnections', "Extra ranked related links per file beyond the root link (0–2)."),
		},
		[PreBaseConfigKeys.GraphMaxRenderedNodes]: {
			type: 'number',
			default: 280,
			minimum: 50,
			maximum: 2000,
			description: localize('prebase.graph.maxRenderedNodes', "Maximum number of nodes to render (lower is smoother)."),
		},
		[PreBaseConfigKeys.GraphMaxRenderedEdges]: {
			type: 'number',
			default: 420,
			minimum: 50,
			maximum: 4000,
			description: localize('prebase.graph.maxRenderedEdges', "Maximum number of edges to render (lower is smoother)."),
		},
		[PreBaseConfigKeys.GraphNetworkForceStrength]: {
			type: 'number',
			default: 0.35,
			description: localize('prebase.graph.networkForceStrength', "Force strength for network layout."),
		},
		[PreBaseConfigKeys.GraphNetworkLinkDistance]: {
			type: 'number',
			default: 80,
			description: localize('prebase.graph.networkLinkDistance', "Preferred link distance for network layout."),
		},
		[PreBaseConfigKeys.GraphNetworkCharge]: {
			type: 'number',
			default: -120,
			description: localize('prebase.graph.networkCharge', "Charge strength for network layout. Reserved — not applied by the current layout engine (use networkForceStrength / networkLinkDistance)."),
		},
		[PreBaseConfigKeys.GraphNetworkCollisionRadius]: {
			type: 'number',
			default: 24,
			description: localize('prebase.graph.networkCollisionRadius', "Collision radius for network layout. Reserved — not applied by the current layout engine."),
		},
		[PreBaseConfigKeys.GraphNetworkAlphaDecay]: {
			type: 'number',
			default: 0.02,
			description: localize('prebase.graph.networkAlphaDecay', "Alpha decay for network layout simulation. Reserved — changing it retriggers layout but the value is not consumed yet."),
		},
		[PreBaseConfigKeys.GraphNetworkIdleAutoRotate]: {
			type: 'boolean',
			default: false,
			description: localize('prebase.graph.networkIdleAutoRotate', "Slowly auto-rotate the Network graph when idle. Off by default until idle interaction is stable."),
		},
		[PreBaseConfigKeys.GraphNetworkPhysicsStrength]: {
			type: 'number',
			default: 1,
			minimum: 0.5,
			maximum: 2,
			description: localize('prebase.graph.networkPhysicsStrength', "Scales repulsion and centering forces in the network view."),
		},
		[PreBaseConfigKeys.GraphNetworkEdgeOpacity]: {
			type: 'number',
			default: 0.55,
			minimum: 0.2,
			maximum: 0.9,
			description: localize('prebase.graph.networkEdgeOpacity', "Network link visibility. Higher is more readable."),
		},
		[PreBaseConfigKeys.GraphQuality]: {
			type: 'string',
			enum: ['balanced', 'auto', 'performance', 'quality'],
			enumDescriptions: [
				localize('prebase.graph.quality.balanced', "Balanced quality and performance (same as auto)."),
				localize('prebase.graph.quality.auto', "Automatically balance quality and performance."),
				localize('prebase.graph.quality.performance', "Prefer smoother interaction; reduces edge animation."),
				localize('prebase.graph.quality.quality', "Prefer visual fidelity."),
			],
			default: 'balanced',
			description: localize('prebase.graph.quality', "Rendering quality preference for PreBase graphs."),
		},
		[PreBaseConfigKeys.GraphRenderThrottleMs]: {
			type: 'number',
			default: 0,
			minimum: 0,
			maximum: 100,
			description: localize('prebase.graph.renderThrottleMs', "Delays graph node/edge sync (milliseconds)."),
		},
		[PreBaseConfigKeys.GraphNetworkLodNodeThreshold]: {
			type: 'number',
			default: 900,
			minimum: 400,
			maximum: 3000,
			description: localize('prebase.graph.networkLodNodeThreshold', "Above this node count, network view uses performance mode."),
		},
		[PreBaseConfigKeys.GraphNetworkSimulationTicks]: {
			type: 'number',
			default: 80,
			minimum: 20,
			maximum: 200,
			description: localize('prebase.graph.networkSimulationTicks', "Force layout warmup/cooldown scale for the network view."),
		},
		[PreBaseConfigKeys.GraphNetworkLayoutMode]: {
			type: 'string',
			enum: ['organic', 'sphere', 'constellation', 'clustered', 'radial'],
			enumDescriptions: [
				localize('prebase.graph.networkLayoutMode.organic', "Balanced 3D cloud."),
				localize('prebase.graph.networkLayoutMode.sphere', "Even Fibonacci sphere shell."),
				localize('prebase.graph.networkLayoutMode.constellation', "Connected files pull closer in 3D."),
				localize('prebase.graph.networkLayoutMode.clustered', "Clusters by file type."),
				localize('prebase.graph.networkLayoutMode.radial', "Important files nearer the center."),
			],
			default: 'organic',
			description: localize('prebase.graph.networkLayoutMode', "Layout algorithm for the Network Graph."),
		},
		[PreBaseConfigKeys.GraphNetworkSpreadScale]: {
			type: 'number',
			default: 1.2,
			minimum: 0.4,
			maximum: 2.5,
			description: localize('prebase.graph.networkSpreadScale', "Overall spread scale for Network Graph layouts."),
		},
		[PreBaseConfigKeys.GraphArchitectureMode]: {
			type: 'string',
			enum: ['product', 'file', 'dependency', 'state', 'infrastructure', 'overview'],
			default: 'product',
			description: localize('prebase.graph.architectureMode', "Architecture slice for the Architecture graph: filters rendered nodes by layer (product/state/infrastructure) or connectivity (dependency). Overview shows all layers. Does not recompute layout geometry."),
			scope: ConfigurationScope.RESOURCE
		},
		[PreBaseConfigKeys.GraphFilter]: {
			type: 'string',
			enum: ['all', 'files', 'components', 'dependencies'],
			default: 'all',
			description: localize('prebase.graph.filter', "Filter applied to the PreBase Maps project explorer."),
			scope: ConfigurationScope.RESOURCE
		},
		[PreBaseConfigKeys.GraphExplorerViewMode]: {
			type: 'string',
			enum: ['flat', 'tree'],
			default: 'tree',
			description: localize('prebase.graph.explorerViewMode', "Project explorer layout in PreBase Maps (flat list or folder tree)."),
			scope: ConfigurationScope.RESOURCE
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
		[PreBaseConfigKeys.InteractionPanSensitivity]: {
			type: 'number',
			default: 1,
			minimum: 0.5,
			maximum: 2,
			description: localize('prebase.interaction.panSensitivity', "Pan sensitivity for PreBase graphs."),
		},
		[PreBaseConfigKeys.InteractionZoomSensitivity]: {
			type: 'number',
			default: 1,
			minimum: 0.5,
			maximum: 2,
			description: localize('prebase.interaction.zoomSensitivity', "Zoom sensitivity for PreBase graphs."),
		},
		[PreBaseConfigKeys.InteractionNetworkDragDirection]: {
			type: 'string',
			enum: ['natural', 'inverted'],
			enumDescriptions: [
				localize('prebase.interaction.networkDragDirection.natural', "Natural follows cursor drag like grabbing the sphere."),
				localize('prebase.interaction.networkDragDirection.inverted', "Inverted rotates opposite to cursor."),
			],
			default: 'natural',
			description: localize('prebase.interaction.networkDragDirection', "Network graph empty-space drag direction."),
		},
		[PreBaseConfigKeys.InteractionNodeDragDelayMs]: {
			type: 'number',
			default: 200,
			minimum: 80,
			maximum: 400,
			description: localize('prebase.interaction.nodeDragDelayMs', "Hover delay (ms) before a graph node becomes draggable. Unrelated to Agents chat modes."),
		},
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
			description: localize('prebase.account.apiBaseUrl', "HTTPS base URL for PreBase account sign-in/sign-up. When empty, account credential forms stay disabled and Continue without signing in still works."),
		},
	}
});

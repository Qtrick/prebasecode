/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../../platform/registry/common/platform.js';
import { PreBaseGraphConfigKeys } from '../../common/configuration/graphConfigKeys.js';

export function registerPreBaseGraphConfiguration(): void {
	const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

	configurationRegistry.registerConfiguration({
		id: 'prebaseGraph',
		order: 101,
		title: localize('prebaseGraphTitle', "PreBase Graph"),
		type: 'object',
		properties: {
			[PreBaseGraphConfigKeys.GraphReduceMotion]: {
				type: 'boolean',
				default: false,
				description: localize('prebase.graph.reduceMotion', "Reduce motion in PreBase graph and UI animations."),
			},
			[PreBaseGraphConfigKeys.GraphAutoScan]: {
				type: 'boolean',
				default: true,
				description: localize('prebase.graph.autoScan', "Automatically scan the workspace when opening PreBase Maps."),
				scope: ConfigurationScope.RESOURCE
			},
			[PreBaseGraphConfigKeys.GraphShowLegend]: {
				type: 'boolean',
				default: true,
				description: localize('prebase.graph.showLegend', "Show the graph legend."),
			},
			[PreBaseGraphConfigKeys.GraphShowMinimap]: {
				type: 'boolean',
				default: false,
				deprecationMessage: localize('prebase.graph.showMinimap.deprecated', "Graph minimap is not implemented yet (BETA-020). This key is ignored until minimap rendering ships."),
				description: localize('prebase.graph.showMinimap', "Reserved for a future graph minimap. Hidden from Settings UI until implemented."),
			},
			[PreBaseGraphConfigKeys.GraphHideLowImportance]: {
				type: 'boolean',
				default: false,
				description: localize('prebase.graph.hideLowImportance', "Hide low-importance nodes from the rendered graph."),
			},
			[PreBaseGraphConfigKeys.GraphShowEdgeLabels]: {
				type: 'boolean',
				default: false,
				description: localize('prebase.graph.showEdgeLabels', "Show import paths on dependency edges."),
			},
			[PreBaseGraphConfigKeys.GraphInitialZoom]: {
				type: 'number',
				default: 0.92,
				minimum: 0.5,
				maximum: 1.4,
				description: localize('prebase.graph.initialZoom', "Camera zoom when a project first loads."),
			},
			[PreBaseGraphConfigKeys.GraphLayoutAnimationDuration]: {
				type: 'number',
				default: 750,
				minimum: 0,
				maximum: 2000,
				description: localize('prebase.graph.layoutAnimationDuration', "Fit-view / layout animation duration in milliseconds."),
			},
			[PreBaseGraphConfigKeys.GraphFolderExpansionRadius]: {
				type: 'number',
				default: 82,
				minimum: 48,
				maximum: 160,
				description: localize('prebase.graph.folderExpansionRadius', "Tree mode radial child layout radius."),
			},
			[PreBaseGraphConfigKeys.GraphVisibleRelatedConnections]: {
				type: 'number',
				default: 1,
				minimum: 0,
				maximum: 2,
				description: localize('prebase.graph.visibleRelatedConnections', "Extra ranked related links per file beyond the root link (0–2)."),
			},
			[PreBaseGraphConfigKeys.GraphMaxRenderedNodes]: {
				type: 'number',
				default: 280,
				minimum: 50,
				maximum: 2000,
				description: localize('prebase.graph.maxRenderedNodes', "Maximum number of nodes to render (lower is smoother)."),
			},
			[PreBaseGraphConfigKeys.GraphMaxRenderedEdges]: {
				type: 'number',
				default: 420,
				minimum: 50,
				maximum: 4000,
				description: localize('prebase.graph.maxRenderedEdges', "Maximum number of edges to render (lower is smoother)."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkForceStrength]: {
				type: 'number',
				default: 0.35,
				description: localize('prebase.graph.networkForceStrength', "Force strength for network layout."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkLinkDistance]: {
				type: 'number',
				default: 80,
				description: localize('prebase.graph.networkLinkDistance', "Preferred link distance for network layout."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkCharge]: {
				type: 'number',
				default: -120,
				description: localize('prebase.graph.networkCharge', "Charge strength for network layout. Reserved — not applied by the current layout engine (use networkForceStrength / networkLinkDistance)."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkCollisionRadius]: {
				type: 'number',
				default: 24,
				description: localize('prebase.graph.networkCollisionRadius', "Collision radius for network layout. Reserved — not applied by the current layout engine."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkAlphaDecay]: {
				type: 'number',
				default: 0.02,
				description: localize('prebase.graph.networkAlphaDecay', "Alpha decay for network layout simulation. Reserved — changing it retriggers layout but the value is not consumed yet."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate]: {
				type: 'boolean',
				default: false,
				description: localize('prebase.graph.networkIdleAutoRotate', "Slowly auto-rotate the Network graph when idle. Off by default until idle interaction is stable."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkPhysicsStrength]: {
				type: 'number',
				default: 1,
				minimum: 0.5,
				maximum: 2,
				description: localize('prebase.graph.networkPhysicsStrength', "Scales repulsion and centering forces in the network view. Reserved — not applied by the current layout engine (use networkForceStrength / networkLinkDistance)."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkEdgeOpacity]: {
				type: 'number',
				default: 0.55,
				minimum: 0.2,
				maximum: 0.9,
				description: localize('prebase.graph.networkEdgeOpacity', "Network link visibility. Reserved — not applied by the graph webview yet."),
			},
			[PreBaseGraphConfigKeys.GraphQuality]: {
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
			[PreBaseGraphConfigKeys.GraphRenderThrottleMs]: {
				type: 'number',
				default: 0,
				minimum: 0,
				maximum: 100,
				description: localize('prebase.graph.renderThrottleMs', "Delays graph node/edge sync (milliseconds). Reserved — not read by the graph webview yet."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkLodNodeThreshold]: {
				type: 'number',
				default: 900,
				minimum: 400,
				maximum: 3000,
				description: localize('prebase.graph.networkLodNodeThreshold', "Above this node count, network view uses performance mode. Reserved — not read by the graph webview yet."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkSimulationTicks]: {
				type: 'number',
				default: 80,
				minimum: 20,
				maximum: 200,
				description: localize('prebase.graph.networkSimulationTicks', "Force layout warmup/cooldown scale for the network view. Reserved — not applied by the current layout engine."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkLayoutMode]: {
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
			[PreBaseGraphConfigKeys.GraphNetworkSpreadScale]: {
				type: 'number',
				default: 1.2,
				minimum: 0.4,
				maximum: 2.5,
				description: localize('prebase.graph.networkSpreadScale', "Overall spread scale for Network Graph layouts."),
			},
			[PreBaseGraphConfigKeys.GraphFilter]: {
				type: 'string',
				enum: ['all', 'files', 'components', 'dependencies'],
				default: 'all',
				description: localize('prebase.graph.filter', "Filter applied to the PreBase Maps project explorer."),
				scope: ConfigurationScope.RESOURCE
			},
			[PreBaseGraphConfigKeys.GraphExplorerViewMode]: {
				type: 'string',
				enum: ['flat', 'tree'],
				default: 'tree',
				description: localize('prebase.graph.explorerViewMode', "Project explorer layout in PreBase Maps (flat list or folder tree)."),
				scope: ConfigurationScope.RESOURCE
			},
			[PreBaseGraphConfigKeys.InteractionPanSensitivity]: {
				type: 'number',
				default: 1,
				minimum: 0.5,
				maximum: 2,
				description: localize('prebase.interaction.panSensitivity', "Pan sensitivity for PreBase graphs. Reserved — not read by the graph webview yet."),
			},
			[PreBaseGraphConfigKeys.InteractionZoomSensitivity]: {
				type: 'number',
				default: 1,
				minimum: 0.5,
				maximum: 2,
				description: localize('prebase.interaction.zoomSensitivity', "Zoom sensitivity for PreBase graphs. Reserved — not read by the graph webview yet."),
			},
			[PreBaseGraphConfigKeys.InteractionNetworkDragDirection]: {
				type: 'string',
				enum: ['natural', 'inverted'],
				enumDescriptions: [
					localize('prebase.interaction.networkDragDirection.natural', "Natural follows cursor drag like grabbing the sphere."),
					localize('prebase.interaction.networkDragDirection.inverted', "Inverted rotates opposite to cursor."),
				],
				default: 'natural',
				description: localize('prebase.interaction.networkDragDirection', "Network graph empty-space drag direction."),
			},
			[PreBaseGraphConfigKeys.InteractionNodeDragDelayMs]: {
				type: 'number',
				default: 200,
				minimum: 80,
				maximum: 400,
				description: localize('prebase.interaction.nodeDragDelayMs', "Hover delay (ms) before a graph node becomes draggable. Reserved — not read by the graph webview yet. Unrelated to Agents chat modes."),
			},
		}
	});
}

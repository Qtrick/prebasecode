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
			[PreBaseGraphConfigKeys.GraphRespectGitIgnore]: {
				type: 'boolean',
				default: true,
				description: localize('prebase.graph.respectGitIgnore', "Exclude files ignored by Git from Code Graph scanning."),
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
				deprecationMessage: localize('prebase.graph.showEdgeLabels.deprecated', "Edge import labels are not rendered by the current Code Graph. This setting is ignored."),
				description: localize('prebase.graph.showEdgeLabels', "Reserved for future edge label rendering. Currently ignored."),
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
				deprecationMessage: localize('prebase.graph.folderExpansionRadius.deprecated', "Folder expansion radius belongs to the dormant Architecture Graph and is not applied by the active Code Graph."),
				description: localize('prebase.graph.folderExpansionRadius', "Reserved for the dormant Architecture Graph. Currently ignored."),
			},
			[PreBaseGraphConfigKeys.GraphVisibleRelatedConnections]: {
				type: 'number',
				default: 1,
				minimum: 0,
				maximum: 2,
				deprecationMessage: localize('prebase.graph.visibleRelatedConnections.deprecated', "Extra related links belong to the dormant Architecture Graph and are not applied by the active Code Graph."),
				description: localize('prebase.graph.visibleRelatedConnections', "Reserved for the dormant Architecture Graph. Currently ignored."),
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
				minimum: 0,
				maximum: 2,
				description: localize('prebase.graph.networkForceStrength', "Strength of bounded link springs in Network Graph layouts."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkLinkDistance]: {
				type: 'number',
				default: 80,
				minimum: 4,
				maximum: 600,
				description: localize('prebase.graph.networkLinkDistance', "Preferred center-to-center link length in Network Graph layouts."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkCharge]: {
				type: 'number',
				default: -120,
				deprecationMessage: localize('prebase.graph.networkCharge.deprecated', "Classic force charge belongs to the dormant Architecture Graph. The active Code Graph uses bounded link relaxation (networkForceStrength / networkLinkDistance)."),
				description: localize('prebase.graph.networkCharge', "Reserved — not applied by the current layout engine (use networkForceStrength / networkLinkDistance)."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkCollisionRadius]: {
				type: 'number',
				default: 24,
				minimum: 2,
				maximum: 120,
				description: localize('prebase.graph.networkCollisionRadius', "Node spacing radius for Network Graph layouts. Nodes keep approximately twice this center-to-center distance."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkAlphaDecay]: {
				type: 'number',
				default: 0.02,
				deprecationMessage: localize('prebase.graph.networkAlphaDecay.deprecated', "Simulated-annealing alpha decay is not used by the deterministic layout engines. This setting is ignored."),
				description: localize('prebase.graph.networkAlphaDecay', "Reserved — not applied by the current layout engine."),
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
				description: localize('prebase.graph.networkPhysicsStrength', "Scales the overall layout spread of the Network Graph together with node spacing."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkEdgeOpacity]: {
				type: 'number',
				default: 0.55,
				minimum: 0.2,
				maximum: 0.9,
				description: localize('prebase.graph.networkEdgeOpacity', "Network link opacity scale multiplier."),
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
				deprecationMessage: localize('prebase.graph.renderThrottleMs.deprecated', "The graph renderer uses a dirty-frame loop and does not throttle. This setting is ignored."),
				description: localize('prebase.graph.renderThrottleMs', "Reserved — not read by the graph webview."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkLodNodeThreshold]: {
				type: 'number',
				default: 900,
				minimum: 400,
				maximum: 3000,
				deprecationMessage: localize('prebase.graph.networkLodNodeThreshold.deprecated', "LOD is derived from zoom and edge semantics, not a node-count threshold. This setting is ignored."),
				description: localize('prebase.graph.networkLodNodeThreshold', "Reserved — not read by the graph webview."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkSimulationTicks]: {
				type: 'number',
				default: 80,
				minimum: 20,
				maximum: 200,
				deprecationMessage: localize('prebase.graph.networkSimulationTicks.deprecated', "The deterministic layouts use fixed iteration counts, not configurable ticks. This setting is ignored."),
				description: localize('prebase.graph.networkSimulationTicks', "Reserved — not applied by the current layout engine."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkLayoutMode]: {
				type: 'string',
				enum: ['organic', 'sphere', 'constellation', 'clustered'],
				enumDescriptions: [
					localize('prebase.graph.networkLayoutMode.organic', "Balanced 3D cloud."),
					localize('prebase.graph.networkLayoutMode.sphere', "Even Fibonacci sphere shell."),
					localize('prebase.graph.networkLayoutMode.constellation', "Connected files pull closer in 3D."),
					localize('prebase.graph.networkLayoutMode.clustered', "Groups files by architectural role and module."),
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
				description: localize('prebase.interaction.panSensitivity', "Pan sensitivity for PreBase graphs."),
			},
			[PreBaseGraphConfigKeys.InteractionZoomSensitivity]: {
				type: 'number',
				default: 1,
				minimum: 0.5,
				maximum: 2,
				description: localize('prebase.interaction.zoomSensitivity', "Zoom sensitivity for PreBase graphs (smooth wheel, trackpad, and gestures)."),
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
				deprecationMessage: localize('prebase.interaction.nodeDragDelayMs.deprecated', "Node dragging uses a movement threshold, not a hover delay. This setting is ignored."),
				description: localize('prebase.interaction.nodeDragDelayMs', "Reserved — not read by the graph webview. Unrelated to Agents chat modes."),
			},
			[PreBaseGraphConfigKeys.InteractionKeepGraphCentered]: {
				type: 'boolean',
				default: false,
				description: localize('prebase.interaction.keepGraphCentered', "Keep the visible graph centered in the viewport during interaction and rotation."),
			},
		}
	});
}

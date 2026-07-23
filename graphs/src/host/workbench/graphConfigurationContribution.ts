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
			[PreBaseGraphConfigKeys.GraphDefaultType]: {
				type: 'string',
				enum: ['code', 'architecture', 'network'],
				enumDescriptions: [
					localize('prebase.graph.defaultType.code', "Code Graph (canonical)."),
					localize('prebase.graph.defaultType.architecture', "Deprecated — coerced to Code Graph."),
					localize('prebase.graph.defaultType.network', "Deprecated — coerced to Code Graph."),
				],
				default: 'code',
				included: false,
				deprecationMessage: localize('prebase.graph.defaultType.deprecated', "PreBase opens a single Code Graph; architecture/network values coerce to code."),
				description: localize('prebase.graph.defaultType', "Deprecated. PreBase opens a single Code Graph; architecture/network values coerce to code."),
				scope: ConfigurationScope.RESOURCE
			},
			[PreBaseGraphConfigKeys.GraphDefaultArchitectureLayout]: {
				type: 'string',
				enum: ['hierarchy', 'pyramid', 'scattered'],
				default: 'hierarchy',
				included: false,
				deprecationMessage: localize('prebase.graph.defaultArchitectureLayout.deprecated', "Architecture layouts removed from product Settings. Code Graph uses networkLayoutMode."),
				description: localize('prebase.graph.defaultArchitectureLayout', "Deprecated. Legacy architecture layout default (hierarchy/pyramid/scattered). Code Graph uses networkLayoutMode."),
				scope: ConfigurationScope.RESOURCE
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
				included: false,
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
				included: false,
				deprecationMessage: localize('prebase.graph.showEdgeLabels.deprecated', "Edge import labels are not rendered by the Code Graph webview yet. Key retained for migration."),
				description: localize('prebase.graph.showEdgeLabels', "Reserved. Show import paths on dependency edges — not applied by the Code Graph webview yet."),
			},
			[PreBaseGraphConfigKeys.GraphInitialZoom]: {
				type: 'number',
				default: 0.92,
				minimum: 0.5,
				maximum: 1.4,
				description: localize('prebase.graph.initialZoom', "Camera zoom when a project first loads."),
			},
			[PreBaseGraphConfigKeys.GraphLegendInteractionDim]: {
				type: 'number',
				default: 40,
				minimum: 0,
				maximum: 80,
				included: false,
				deprecationMessage: localize('prebase.graph.legendInteractionDim.deprecated', "Legend interaction dim is not consumed by the Code Graph webview yet. Key retained for migration."),
				description: localize('prebase.graph.legendInteractionDim', "Reserved. How much the Code Graph legend fades while interacting — not applied by the webview yet."),
			},
			[PreBaseGraphConfigKeys.GraphLayoutAnimationDuration]: {
				type: 'number',
				default: 750,
				minimum: 0,
				maximum: 2000,
				description: localize('prebase.graph.layoutAnimationDuration', "Fit-view / layout animation duration in milliseconds."),
			},
			[PreBaseGraphConfigKeys.GraphLayerRadiusScale]: {
				type: 'number',
				default: 1,
				minimum: 0.7,
				maximum: 1.4,
				included: false,
				deprecationMessage: localize('prebase.graph.layerRadiusScale.deprecated', "Architecture layout tuning — hidden from Settings; Code Graph uses network layouts."),
				description: localize('prebase.graph.layerRadiusScale', "Deprecated. Scales concentric ring radii for legacy architecture layouts."),
			},
			[PreBaseGraphConfigKeys.GraphMaxNodesPerLayer]: {
				type: 'number',
				default: 24,
				minimum: 8,
				maximum: 48,
				included: false,
				deprecationMessage: localize('prebase.graph.maxNodesPerLayer.deprecated', "Architecture layout tuning — hidden from Settings."),
				description: localize('prebase.graph.maxNodesPerLayer', "Deprecated. Maximum nodes per layer before an overflow sub-ring is added."),
			},
			[PreBaseGraphConfigKeys.GraphLayerGap]: {
				type: 'number',
				default: 96,
				minimum: 80,
				maximum: 200,
				included: false,
				deprecationMessage: localize('prebase.graph.layerGap.deprecated', "Architecture layout tuning — hidden from Settings."),
				description: localize('prebase.graph.layerGap', "Deprecated. Distance between dependency rings."),
			},
			[PreBaseGraphConfigKeys.GraphCenterClearance]: {
				type: 'number',
				default: 80,
				minimum: 64,
				maximum: 160,
				included: false,
				deprecationMessage: localize('prebase.graph.centerClearance.deprecated', "Architecture layout tuning — hidden from Settings."),
				description: localize('prebase.graph.centerClearance', "Deprecated. Radius of the innermost ring."),
			},
			[PreBaseGraphConfigKeys.GraphScatterRelaxIterations]: {
				type: 'number',
				default: 10,
				minimum: 4,
				maximum: 24,
				included: false,
				deprecationMessage: localize('prebase.graph.scatterRelaxIterations.deprecated', "Architecture layout tuning — hidden from Settings."),
				description: localize('prebase.graph.scatterRelaxIterations', "Deprecated. Spacing relaxation iterations for scattered layout."),
			},
			[PreBaseGraphConfigKeys.GraphFolderExpansionRadius]: {
				type: 'number',
				default: 82,
				minimum: 48,
				maximum: 160,
				included: false,
				deprecationMessage: localize('prebase.graph.folderExpansionRadius.deprecated', "Architecture layout tuning — hidden from Settings."),
				description: localize('prebase.graph.folderExpansionRadius', "Deprecated. Tree mode radial child layout radius."),
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
				included: false,
				description: localize('prebase.graph.networkForceStrength', "Reserved. Force strength for Code Graph layout — not consumed by the current layout engine."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkLinkDistance]: {
				type: 'number',
				default: 80,
				included: false,
				description: localize('prebase.graph.networkLinkDistance', "Reserved. Preferred link distance for Code Graph layout — not consumed by the current layout engine."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkCharge]: {
				type: 'number',
				default: -120,
				included: false,
				description: localize('prebase.graph.networkCharge', "Reserved. Charge strength for Code Graph layout — not applied by the current layout engine."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkCollisionRadius]: {
				type: 'number',
				default: 24,
				included: false,
				description: localize('prebase.graph.networkCollisionRadius', "Reserved. Collision radius for Code Graph layout — not applied by the current layout engine."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkAlphaDecay]: {
				type: 'number',
				default: 0.02,
				included: false,
				description: localize('prebase.graph.networkAlphaDecay', "Reserved. Alpha decay for Code Graph layout simulation — not consumed by the current layout engine."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate]: {
				type: 'boolean',
				default: false,
				description: localize('prebase.graph.networkIdleAutoRotate', "Slowly auto-rotate the Code Graph when idle. Off by default until idle interaction is stable."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkPhysicsStrength]: {
				type: 'number',
				default: 1,
				minimum: 0.5,
				maximum: 2,
				included: false,
				description: localize('prebase.graph.networkPhysicsStrength', "Reserved. Scales repulsion and centering forces in the Code Graph — not applied by the current layout engine."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkEdgeOpacity]: {
				type: 'number',
				default: 0.55,
				minimum: 0.2,
				maximum: 0.9,
				included: false,
				description: localize('prebase.graph.networkEdgeOpacity', "Reserved. Code Graph link visibility — not applied by the graph webview yet."),
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
				included: false,
				description: localize('prebase.graph.renderThrottleMs', "Reserved. Delays graph node/edge sync (milliseconds) — not read by the graph webview yet."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkLodNodeThreshold]: {
				type: 'number',
				default: 900,
				minimum: 400,
				maximum: 3000,
				included: false,
				description: localize('prebase.graph.networkLodNodeThreshold', "Reserved. Above this node count, network view uses performance mode — not read by the graph webview yet."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkSimulationTicks]: {
				type: 'number',
				default: 80,
				minimum: 20,
				maximum: 200,
				included: false,
				description: localize('prebase.graph.networkSimulationTicks', "Reserved. Force layout warmup/cooldown scale — not applied by the current layout engine."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkLayoutMode]: {
				type: 'string',
				enum: ['community', 'organic', 'sphere', 'constellation', 'clustered', 'radial'],
				enumDescriptions: [
					localize('prebase.graph.networkLayoutMode.community', "Community Force — groups detected communities into 3D clusters."),
					localize('prebase.graph.networkLayoutMode.organic', "Balanced 3D cloud."),
					localize('prebase.graph.networkLayoutMode.sphere', "Even Fibonacci sphere shell."),
					localize('prebase.graph.networkLayoutMode.constellation', "Connected files pull closer in 3D."),
					localize('prebase.graph.networkLayoutMode.clustered', "Clusters by file type."),
					localize('prebase.graph.networkLayoutMode.radial', "Important files nearer the center."),
				],
				// Schema default only — never rewrite a stored user preference (e.g. organic).
				default: 'community',
				description: localize('prebase.graph.networkLayoutMode', "Layout algorithm for the Code Graph."),
			},
			[PreBaseGraphConfigKeys.GraphNetworkSpreadScale]: {
				type: 'number',
				default: 1.2,
				minimum: 0.4,
				maximum: 2.5,
				description: localize('prebase.graph.networkSpreadScale', "Overall spread scale for Code Graph layouts."),
			},
			[PreBaseGraphConfigKeys.GraphArchitectureMode]: {
				type: 'string',
				enum: ['product', 'file', 'dependency', 'state', 'infrastructure', 'overview'],
				default: 'product',
				included: false,
				deprecationMessage: localize('prebase.graph.architectureMode.deprecated', "Architecture Graph product removed; mode filter kept for migration only."),
				description: localize('prebase.graph.architectureMode', "Deprecated. Architecture slice filter for the removed Architecture Graph product. Kept for migration only."),
				scope: ConfigurationScope.RESOURCE
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
				included: false,
				description: localize('prebase.interaction.panSensitivity', "Reserved. Pan sensitivity for PreBase graphs — not read by the graph webview yet."),
			},
			[PreBaseGraphConfigKeys.InteractionZoomSensitivity]: {
				type: 'number',
				default: 1,
				minimum: 0.5,
				maximum: 2,
				included: false,
				description: localize('prebase.interaction.zoomSensitivity', "Reserved. Zoom sensitivity for PreBase graphs — not read by the graph webview yet."),
			},
			[PreBaseGraphConfigKeys.InteractionNetworkDragDirection]: {
				type: 'string',
				enum: ['natural', 'inverted'],
				enumDescriptions: [
					localize('prebase.interaction.networkDragDirection.natural', "Natural follows cursor drag like grabbing the sphere."),
					localize('prebase.interaction.networkDragDirection.inverted', "Inverted rotates opposite to cursor."),
				],
				default: 'natural',
				description: localize('prebase.interaction.networkDragDirection', "Code Graph empty-space drag direction."),
			},
			[PreBaseGraphConfigKeys.InteractionNodeDragDelayMs]: {
				type: 'number',
				default: 200,
				minimum: 80,
				maximum: 400,
				included: false,
				description: localize('prebase.interaction.nodeDragDelayMs', "Reserved. Hover delay (ms) before a graph node becomes draggable — not read by the graph webview yet. Unrelated to Agents chat modes."),
			},
		}
	});
}

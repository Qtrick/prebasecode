/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../nls.js';

export const PREBASE_GRAPH_CHANNEL_ID = 'prebaseGraph';
export const PREBASE_GRAPH_CHANNEL_LABEL = localize('prebase.graph.channel', "PreBase Graph");

export enum PreBaseGraphConfigKeys {
	GraphAutoScan = 'prebase.graph.autoScan',
	GraphShowLegend = 'prebase.graph.showLegend',
	GraphShowMinimap = 'prebase.graph.showMinimap',
	GraphHideLowImportance = 'prebase.graph.hideLowImportance',
	GraphShowEdgeLabels = 'prebase.graph.showEdgeLabels',
	GraphInitialZoom = 'prebase.graph.initialZoom',
	GraphLayoutAnimationDuration = 'prebase.graph.layoutAnimationDuration',
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
	GraphFilter = 'prebase.graph.filter',
	GraphExplorerViewMode = 'prebase.graph.explorerViewMode',

	InteractionPanSensitivity = 'prebase.interaction.panSensitivity',
	InteractionZoomSensitivity = 'prebase.interaction.zoomSensitivity',
	InteractionNetworkDragDirection = 'prebase.interaction.networkDragDirection',
	InteractionNodeDragDelayMs = 'prebase.interaction.nodeDragDelayMs',
}

/** Graph-owned `prebase.graph.*` and graph interaction keys (for Reset all). */
export const PREBASE_GRAPH_RESETTABLE_CONFIG_KEYS: readonly string[] = Object.values(PreBaseGraphConfigKeys);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/** Stable workbench command IDs for PreBase graph actions (do not change string values). */
export const PreBaseGraphCommandIds = {
	clearDescriptionCache: 'prebase.graph.clearDescriptionCache',
	regenerateDescription: 'prebase.graph.regenerateDescription',
	openNetwork: 'prebase.graph.openNetwork',
	openTemporal: 'prebase.graph.openTemporal',
	scanWorkspace: 'prebase.graph.scanWorkspace',
	rescanWorkspace: 'prebase.graph.rescanWorkspace',
	cancelScan: 'prebase.graph.cancelScan',
	fitView: 'prebase.graph.fitView',
	resetView: 'prebase.graph.resetView',
	toggleLegend: 'prebase.graph.toggleLegend',
	toggleMinimap: 'prebase.graph.toggleMinimap',
	showDiagnostics: 'prebase.graph.showDiagnostics',
	clearCache: 'prebase.graph.clearCache',
	focusCurrentFile: 'prebase.graph.focusCurrentFile',
	clearSelection: 'prebase.graph.clearSelection',
	openSelectedNode: 'prebase.graph.openSelectedNode',
	focusSelectedNode: 'prebase.graph.focusSelectedNode',
	getSelectionForMagnus: 'prebase.graph.getSelectionForMagnus',
	searchForMagnus: 'prebase.graph.searchForMagnus',
	getNodeForMagnus: 'prebase.graph.getNodeForMagnus',
	getDependenciesForMagnus: 'prebase.graph.getDependenciesForMagnus',
	getOverviewForMagnus: 'prebase.graph.getOverviewForMagnus',
	focusForMagnus: 'prebase.graph.focusForMagnus',
	attachSelectionToMagnus: 'prebase.graph.attachSelectionToMagnus',
	diagnoseCanonicalGraph: 'prebase.graph.diagnoseCanonicalGraph',
	buildCanonicalGraphAtRef: 'prebase.graph.buildCanonicalGraphAtRef',
	compareCanonicalGraphRefs: 'prebase.graph.compareCanonicalGraphRefs',
} as const;

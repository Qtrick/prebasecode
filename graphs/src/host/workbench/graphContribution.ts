/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../../nls.js';
import { URI } from '../../../../../../base/common/uri.js';
import { SyncDescriptor } from '../../../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../../../browser/parts/views/viewPaneContainer.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../../../common/views.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../../../common/editor.js';
import { EditorInput } from '../../../../../common/editor/editorInput.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { Action2, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IOutputService } from '../../../../../services/output/common/output.js';
import { IOutputChannelRegistry, Extensions as OutputExtensions } from '../../../../../services/output/common/output.js';
import { prebaseMapsViewIcon } from '../../../browser/prebaseIcons.js';
import { PREBASE_GRAPH_CHANNEL_ID, PREBASE_GRAPH_CHANNEL_LABEL, PreBaseGraphConfigKeys } from '../../common/configuration/graphConfigKeys.js';
import { PreBaseGraphCommandIds } from '../../commands/graphCommandIds.js';
import { PreBaseGraphEditor } from './graphEditor.js';
import { PreBaseGraphEditorInput } from './graphEditorInput.js';
import { IPreBaseGraphDescriptionService, PreBaseGraphDescriptionService } from './prebaseGraphDescriptionService.js';
import { IPreBaseGraphService, PreBaseGraphService } from './prebaseGraphService.js';
import { IPreBaseCanonicalParseService, WorkbenchCanonicalParseService } from './workbenchCanonicalParseService.js';
import { PreBaseMapsViewPane } from './prebaseMapsView.js';

import { IWorkbenchGitHistoryService, WorkbenchGitHistoryService } from './workbenchGitHistoryService.js';
import { IPreBaseTemporalGraphService, WorkbenchTemporalGraphService } from './workbenchTemporalGraphService.js';
import { IPreBaseTemporalViewService } from '../../temporal/view/temporalViewTypes.js';
import { WorkbenchTemporalViewService } from './temporal/workbenchTemporalViewService.js';

export const PREBASE_MAPS_VIEW_CONTAINER_ID = 'workbench.view.prebase.maps';

async function openGraphEditor(accessor: ServicesAccessor): Promise<void> {
	const editorService = accessor.get(IEditorService);
	const graphService = accessor.get(IPreBaseGraphService);
	await graphService.setGraphType('network');
	await editorService.openEditor(PreBaseGraphEditorInput.create('network'), { pinned: true, revealIfOpened: true, revealIfVisible: true });
}

async function openTemporalGraphEditor(accessor: ServicesAccessor): Promise<void> {
	const editorService = accessor.get(IEditorService);
	const graphService = accessor.get(IPreBaseGraphService);
	await graphService.setGraphType('temporal');
	await editorService.openEditor(PreBaseGraphEditorInput.create('temporal'), { pinned: true, revealIfOpened: true, revealIfVisible: true });
}

function isSupportedGraphType(value: unknown): value is 'network' | 'temporal' {
	return value === 'network' || value === 'temporal';
}

class PreBaseGraphEditorInputSerializer implements IEditorSerializer {
	canSerialize(editor: EditorInput): boolean {
		return editor instanceof PreBaseGraphEditorInput;
	}
	serialize(editor: EditorInput): string {
		return JSON.stringify({ graphType: (editor as PreBaseGraphEditorInput).graphType });
	}
	deserialize(instantiationService: IInstantiationService, raw: string): EditorInput | undefined {
		try {
			const data = JSON.parse(raw) as { graphType?: unknown };
			return PreBaseGraphEditorInput.create(isSupportedGraphType(data.graphType) ? data.graphType : 'network');
		} catch {
			return undefined;
		}
	}
}

function registerGraphSingletons(): void {
	registerSingleton(IWorkbenchGitHistoryService, WorkbenchGitHistoryService, InstantiationType.Delayed);
	registerSingleton(IPreBaseCanonicalParseService, WorkbenchCanonicalParseService, InstantiationType.Delayed);
	registerSingleton(IPreBaseGraphService, PreBaseGraphService, InstantiationType.Delayed);
	registerSingleton(IPreBaseGraphDescriptionService, PreBaseGraphDescriptionService, InstantiationType.Delayed);
	registerSingleton(IPreBaseTemporalGraphService, WorkbenchTemporalGraphService, InstantiationType.Delayed);
	registerSingleton(IPreBaseTemporalViewService, WorkbenchTemporalViewService, InstantiationType.Delayed);
}

function registerGraphOutputChannel(): void {
	Registry.as<IOutputChannelRegistry>(OutputExtensions.OutputChannels).registerChannel({
		id: PREBASE_GRAPH_CHANNEL_ID,
		label: PREBASE_GRAPH_CHANNEL_LABEL,
		log: false
	});
}

function registerMapsViewContainer(): void {
	const mapsContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
		id: PREBASE_MAPS_VIEW_CONTAINER_ID,
		title: localize2('prebase.maps.container', "PreBase Maps"),
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [PREBASE_MAPS_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
		icon: prebaseMapsViewIcon,
		order: 8,
		hideIfEmpty: false,
	}, ViewContainerLocation.Sidebar, { isDefault: false });

	Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
		id: PreBaseMapsViewPane.ID,
		name: PreBaseMapsViewPane.LABEL,
		containerIcon: prebaseMapsViewIcon,
		ctorDescriptor: new SyncDescriptor(PreBaseMapsViewPane),
		canToggleVisibility: false,
		canMoveView: true,
		order: 1,
	}], mapsContainer);
}

function registerGraphEditorPane(): void {
	Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
		EditorPaneDescriptor.create(
			PreBaseGraphEditor,
			PreBaseGraphEditor.ID,
			localize('prebase.graph.editor', "PreBase Graph")
		),
		[new SyncDescriptor(PreBaseGraphEditorInput)]
	);

	Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
		PreBaseGraphEditorInput.TypeID,
		PreBaseGraphEditorInputSerializer
	);
}

function registerGraphActions(): void {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: PreBaseGraphCommandIds.clearDescriptionCache,
				title: localize2('prebase.graph.clearDescriptionCache', "Clear Graph Description Cache"),
				category: localize2('prebase.category', "PreBase"),
				f1: true
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(IPreBaseGraphDescriptionService).clearCache();
			accessor.get(INotificationService).info(localize('prebase.graph.descriptionCacheCleared', "Graph description cache cleared."));
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: PreBaseGraphCommandIds.regenerateDescription,
				title: localize2('prebase.graph.regenerateDescription', "Regenerate Selected Node Description"),
				category: localize2('prebase.category', "PreBase"),
				f1: true
			});
		}
		async run(accessor: ServicesAccessor) {
			const graph = accessor.get(IPreBaseGraphService);
			const desc = accessor.get(IPreBaseGraphDescriptionService);
			const notify = accessor.get(INotificationService);
			const id = graph.getSelectedNodeId();
			const node = graph.getSnapshot()?.nodes.find(n => n.id === id);
			if (!node) {
				notify.info(localize('prebase.graph.noNodeForDesc', "Select a graph node first."));
				return;
			}
			const result = await desc.describeNode(node, undefined, { force: true });
			notify.info(result.aiDescription || result.overview);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.openNetwork, title: localize2('prebase.graph.openNetwork', "Open Code Graph"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		run(accessor: ServicesAccessor) { return openGraphEditor(accessor); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.openTemporal, title: localize2('prebase.graph.openTemporal', "Open Temporal Graph"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		run(accessor: ServicesAccessor) { return openTemporalGraphEditor(accessor); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.scanWorkspace, title: localize2('prebase.graph.scanWorkspace', "Scan Workspace"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		run(accessor: ServicesAccessor) { return accessor.get(IPreBaseGraphService).scanWorkspace(); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.rescanWorkspace, title: localize2('prebase.graph.rescanWorkspace', "Rescan Workspace"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		run(accessor: ServicesAccessor) { return accessor.get(IPreBaseGraphService).rescanWorkspace(); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.cancelScan, title: localize2('prebase.graph.cancelScan', "Cancel Graph Scan"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		run(accessor: ServicesAccessor) { accessor.get(IPreBaseGraphService).cancelScan(); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.fitView, title: localize2('prebase.graph.fitView', "Fit Graph View"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		run(accessor: ServicesAccessor) { accessor.get(IPreBaseGraphService).requestFitView(); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.resetView, title: localize2('prebase.graph.resetView', "Reset Graph View"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		run(accessor: ServicesAccessor) { accessor.get(IPreBaseGraphService).requestResetView(); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.toggleLegend, title: localize2('prebase.graph.toggleLegend', "Toggle Graph Legend"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		async run(accessor: ServicesAccessor) {
			const config = accessor.get(IConfigurationService);
			const current = config.getValue<boolean>(PreBaseGraphConfigKeys.GraphShowLegend) !== false;
			await config.updateValue(PreBaseGraphConfigKeys.GraphShowLegend, !current);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.toggleMinimap, title: localize2('prebase.graph.toggleMinimap', "Toggle Graph Minimap"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		async run(accessor: ServicesAccessor) {
			accessor.get(INotificationService).info(localize('prebase.graph.minimapUnavailable', "Graph minimap is not available yet."));
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.showDiagnostics, title: localize2('prebase.graph.showDiagnostics', "Show Graph Diagnostics"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		async run(accessor: ServicesAccessor) {
			const diag = accessor.get(IPreBaseGraphService).getDiagnostics();
			const output = accessor.get(IOutputService);
			await output.showChannel(PREBASE_GRAPH_CHANNEL_ID);
			accessor.get(INotificationService).info(diag.message || localize('prebase.graph.diagFallback', "Status: {0}", diag.status));
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.diagnoseCanonicalGraph, title: localize2('prebase.graph.diagnoseCanonicalGraph', "Diagnose Canonical Graph"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		async run(accessor: ServicesAccessor) {
			const graphService = accessor.get(IPreBaseGraphService);
			const canonical = graphService.getCanonicalSnapshot();
			const output = accessor.get(IOutputService);
			const channel = output.getChannel(PREBASE_GRAPH_CHANNEL_ID);
			await output.showChannel(PREBASE_GRAPH_CHANNEL_ID);

			if (!canonical) {
				accessor.get(INotificationService).info(localize('prebase.graph.canonicalNotAnalyzed', "Canonical graph has not been analyzed yet. Run a workspace scan first."));
				return;
			}

			const summary = [
				`[Canonical Graph Diagnostics]`,
				`Project: ${canonical.projectName} (${canonical.projectPath})`,
				`Source Identity: ${canonical.sourceIdentity}`,
				`Structural Digest: ${canonical.digest}`,
				`Schema Version: ${canonical.versions.graphSchemaVersion}`,
				`Analyzer Version: ${canonical.versions.analyzerVersion}`,
				`Canonical Nodes: ${canonical.nodes.length}`,
				`Canonical Edges: ${canonical.edges.length}`,
				`Analyzed Files: ${canonical.completeness.analyzedFileCount}`,
				`Excluded Files: ${canonical.completeness.excludedFileCount}`,
				`Complete: ${canonical.completeness.isComplete}`,
			].join('\n');

			channel?.append(`${summary}\n`);
			accessor.get(INotificationService).info(localize('prebase.graph.canonicalSummary', "Canonical graph: {0} nodes, {1} edges (digest: {2})", canonical.nodes.length, canonical.edges.length, canonical.digest.slice(0, 8)));
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.buildCanonicalGraphAtRef, title: localize2('prebase.graph.buildCanonicalGraphAtRef', "Build Canonical Graph at Git Ref"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		async run(accessor: ServicesAccessor, ref = 'HEAD') {
			const graphService = accessor.get(IPreBaseGraphService);
			const notify = accessor.get(INotificationService);
			const output = accessor.get(IOutputService);
			const channel = output.getChannel(PREBASE_GRAPH_CHANNEL_ID);

			notify.info(localize('prebase.graph.buildingAtRef', "Building canonical graph at ref: {0}…", ref));
			const snapshot = await graphService.buildCanonicalGraphAtRef(ref);
			if (!snapshot) {
				notify.error(localize('prebase.graph.buildAtRefFailed', "Failed to build canonical graph at ref: {0}", ref));
				return;
			}

			await output.showChannel(PREBASE_GRAPH_CHANNEL_ID);
			channel?.append(`[Canonical Graph at ${ref}]\nNodes: ${snapshot.nodes.length}, Edges: ${snapshot.edges.length}, Digest: ${snapshot.digest}\n`);
			notify.info(localize('prebase.graph.buildAtRefSuccess', "Canonical graph at {0}: {1} nodes, {2} edges", ref, snapshot.nodes.length, snapshot.edges.length));
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.compareCanonicalGraphRefs, title: localize2('prebase.graph.compareCanonicalGraphRefs', "Compare Canonical Graph Refs"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		async run(accessor: ServicesAccessor, refA = 'HEAD~1', refB = 'HEAD') {
			const graphService = accessor.get(IPreBaseGraphService);
			const notify = accessor.get(INotificationService);
			const output = accessor.get(IOutputService);
			const channel = output.getChannel(PREBASE_GRAPH_CHANNEL_ID);

			notify.info(localize('prebase.graph.comparingRefs', "Comparing canonical graph {0} ↔ {1}…", refA, refB));
			const result = await graphService.compareCanonicalGraphRefs(refA, refB);
			if (!result) {
				notify.error(localize('prebase.graph.compareRefsFailed', "Failed to compare canonical graphs for {0} and {1}", refA, refB));
				return;
			}

			const { diff, snapshotA, snapshotB } = result;
			await output.showChannel(PREBASE_GRAPH_CHANNEL_ID);
			const summary = [
				`[Canonical Graph Comparison: ${refA} ↔ ${refB}]`,
				`Snapshot A (${refA}): ${snapshotA.nodes.length} nodes, ${snapshotA.edges.length} edges (digest: ${snapshotA.digest.slice(0, 8)})`,
				`Snapshot B (${refB}): ${snapshotB.nodes.length} nodes, ${snapshotB.edges.length} edges (digest: ${snapshotB.digest.slice(0, 8)})`,
				`Identical: ${diff.isIdentical}`,
				`Added Nodes: ${diff.addedNodes.length}`,
				`Removed Nodes: ${diff.removedNodeIds.length}`,
				`Updated Nodes: ${diff.updatedNodes.length}`,
				`Added Edges: ${diff.addedEdges.length}`,
				`Removed Edges: ${diff.removedEdgeIds.length}`,
				`Updated Edges: ${diff.updatedEdges.length}`,
			].join('\n');

			channel?.append(`${summary}\n`);
			notify.info(localize('prebase.graph.compareSuccess', "Comparison: +{0}/-{1} nodes, +{2}/-{3} edges", diff.addedNodes.length, diff.removedNodeIds.length, diff.addedEdges.length, diff.removedEdgeIds.length));
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.clearCache, title: localize2('prebase.graph.clearCache', "Clear Graph Cache"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		run(accessor: ServicesAccessor) { accessor.get(IPreBaseGraphService).clearCache(); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.focusCurrentFile, title: localize2('prebase.graph.focusCurrentFile', "Focus Current File in Graph"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		run(accessor: ServicesAccessor) {
			const editor = accessor.get(IEditorService).activeEditor;
			const resource = editor?.resource;
			const graph = accessor.get(IPreBaseGraphService);
			const snapshot = graph.getSnapshot();
			if (!resource || !snapshot) {
				accessor.get(INotificationService).info(localize('prebase.graph.focusNone', "No active file to focus."));
				return;
			}
			const folder = snapshot.projectPath;
			const rel = folder && resource.scheme === 'file'
				? resource.fsPath.replace(/\\/g, '/').replace(folder.replace(/\\/g, '/').replace(/\/$/, '') + '/', '')
				: resource.path.replace(/^\//, '');
			const node = snapshot.nodes.find(n => n.path === rel || n.id === `file:${rel}` || n.path === resource.fsPath);
			if (node) {
				graph.setSelectedNodeId(node.id);
				accessor.get(INotificationService).info(localize('prebase.graph.focusFile', "Focus requested for {0}", node.label || rel));
			} else {
				accessor.get(INotificationService).info(localize('prebase.graph.focusMissing', "File not found in graph: {0}", rel));
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.clearSelection, title: localize2('prebase.graph.clearSelection', "Clear Graph Selection"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		run(accessor: ServicesAccessor) {
			accessor.get(IPreBaseGraphService).setSelectedNodeId(undefined);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.openSelectedNode, title: localize2('prebase.graph.openSelectedNode', "Open Selected Graph Node"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		async run(accessor: ServicesAccessor) {
			const graph = accessor.get(IPreBaseGraphService);
			const notify = accessor.get(INotificationService);
			const id = graph.getSelectedNodeId();
			const snapshot = graph.getSnapshot();
			const node = id && snapshot ? snapshot.nodes.find(n => n.id === id) : undefined;
			if (!node) {
				notify.info(localize('prebase.graph.noSelectedNode', "No graph node selected."));
				return;
			}
			const path = (node.path || node.id.replace(/^file:/, '')).replace(/\\/g, '/');
			if (!path) {
				notify.info(localize('prebase.graph.noSelectedNodePath', "Selected graph node has no file path."));
				return;
			}
			const folder = snapshot!.projectPath
				|| accessor.get(IWorkspaceContextService).getWorkspace().folders[0]?.uri.fsPath;
			let uri: URI;
			if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
				uri = URI.file(path);
			} else if (folder) {
				uri = URI.joinPath(URI.file(folder), path);
			} else {
				notify.info(localize('prebase.graph.noSelectedNodePath', "Selected graph node has no file path."));
				return;
			}
			try {
				await accessor.get(IEditorService).openEditor({ resource: uri, options: { pinned: false } });
			} catch {
				// ignore missing files
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.focusSelectedNode, title: localize2('prebase.graph.focusSelectedNode', "Focus Selected Graph Node"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		run(accessor: ServicesAccessor) {
			const graph = accessor.get(IPreBaseGraphService);
			const id = graph.getSelectedNodeId();
			const node = id ? graph.getSnapshot()?.nodes.find(n => n.id === id) : undefined;
			if (!node) {
				accessor.get(INotificationService).info(localize('prebase.graph.noSelectedNode', "No graph node selected."));
				return;
			}
			graph.setSelectedNodeId(undefined);
			graph.setSelectedNodeId(node.id);
			graph.requestFitView();
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.getSelectionForMagnus, title: localize2('prebase.graph.getSelectionForMagnus', "Get Graph Selection for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor) {
			return accessor.get(IPreBaseGraphService).getSelectionSummaryForMagnus();
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.searchForMagnus, title: localize2('prebase.graph.searchForMagnus', "Search Graph for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor, query: string, maximumResults?: number) {
			return accessor.get(IPreBaseGraphService).searchForMagnus(query, maximumResults);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.getNodeForMagnus, title: localize2('prebase.graph.getNodeForMagnus', "Get Graph Node for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor, nodeIdOrPath: string) {
			return accessor.get(IPreBaseGraphService).getNodeDetailsForMagnus(nodeIdOrPath);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.getDependenciesForMagnus, title: localize2('prebase.graph.getDependenciesForMagnus', "Get Graph Dependencies for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor, nodeIdOrPath: string, direction?: 'incoming' | 'outgoing' | 'both', depth?: number, maximumNodes?: number) {
			return accessor.get(IPreBaseGraphService).getDependenciesForMagnus(nodeIdOrPath, direction, depth, maximumNodes);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.getOverviewForMagnus, title: localize2('prebase.graph.getOverviewForMagnus', "Get Graph Overview for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor) {
			return accessor.get(IPreBaseGraphService).getOverviewForMagnus();
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.focusForMagnus, title: localize2('prebase.graph.focusForMagnus', "Focus Graph Node for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor, nodeIdOrPath: string) {
			return accessor.get(IPreBaseGraphService).focusNodeForMagnus(nodeIdOrPath);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.attachSelectionToMagnus, title: localize2('prebase.graph.attachSelectionToMagnus', "Attach Graph Selection to Agents"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		async run(accessor: ServicesAccessor) {
			const summary = accessor.get(IPreBaseGraphService).getSelectionSummaryForMagnus();
			if (!summary) {
				accessor.get(INotificationService).info(localize('prebase.graph.noSelection', "Select a node in the graph first."));
				return;
			}
			await accessor.get(ICommandService).executeCommand('prebase.magnus.attachGraphSelection', summary);
		}
	});
}

/** Registers graph services, views, editors, output channel, and commands (idempotent at module load). */
export function registerPreBaseGraphContribution(): void {
	registerGraphSingletons();
	registerGraphOutputChannel();
	registerMapsViewContainer();
	registerGraphEditorPane();
	registerGraphActions();
}

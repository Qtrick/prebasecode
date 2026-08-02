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
import { normalizeToCodeGraphType, type PreBaseGraphType } from '../../common/types/graphProduct.js';
import { IPreBaseGraphService, PreBaseGraphService } from './prebaseGraphService.js';
import { PreBaseMapsViewPane } from './prebaseMapsView.js';
import { NETWORK_LAYOUT_OPTIONS, type NetworkLayoutMode } from '../../layouts/network/index.js';

export const PREBASE_MAPS_VIEW_CONTAINER_ID = 'workbench.view.prebase.maps';

/** Write analysis lines to the PreBase Graph output channel (channel must already be shown). */
function appendGraphChannel(output: IOutputService, header: string, lines: string[]): void {
	const channel = output.getChannel(PREBASE_GRAPH_CHANNEL_ID);
	if (!channel) {
		return;
	}
	channel.append(`[PreBase] ${header}\n`);
	if (!lines.length) {
		channel.append('  (none)\n');
		return;
	}
	for (const line of lines) {
		channel.append(`  ${line}\n`);
	}
}

async function openGraphEditor(accessor: ServicesAccessor, _graphType?: PreBaseGraphType): Promise<void> {
	const editorService = accessor.get(IEditorService);
	const graphService = accessor.get(IPreBaseGraphService);
	await graphService.setGraphType('code');
	await editorService.openEditor(PreBaseGraphEditorInput.create('code'), { pinned: true });
}

class PreBaseGraphEditorInputSerializer implements IEditorSerializer {
	canSerialize(editor: EditorInput): boolean {
		return editor instanceof PreBaseGraphEditorInput;
	}
	serialize(editor: EditorInput): string {
		return JSON.stringify({ graphType: normalizeToCodeGraphType((editor as PreBaseGraphEditorInput).graphType) });
	}
	deserialize(_instantiationService: IInstantiationService, raw: string): EditorInput | undefined {
		try {
			const data = JSON.parse(raw) as { graphType?: unknown };
			// Legacy architecture|network|code|missing → Code Graph.
			return PreBaseGraphEditorInput.create(normalizeToCodeGraphType(data.graphType));
		} catch {
			// Corrupt memento: still restore a Code Graph tab rather than dropping the editor.
			return PreBaseGraphEditorInput.create('code');
		}
	}
}

function registerGraphSingletons(): void {
	registerSingleton(IPreBaseGraphService, PreBaseGraphService, InstantiationType.Delayed);
	registerSingleton(IPreBaseGraphDescriptionService, PreBaseGraphDescriptionService, InstantiationType.Delayed);
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
			super({ id: PreBaseGraphCommandIds.open, title: localize2('prebase.graph.open', "Open Code Graph"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		run(accessor: ServicesAccessor) { return openGraphEditor(accessor); }
	});

	// Legacy aliases — hidden from F1; both open Code Graph.
	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.openArchitecture, title: localize2('prebase.graph.openArchitecture', "Open Code Graph"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor) { return openGraphEditor(accessor); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.openNetwork, title: localize2('prebase.graph.openNetwork', "Open Code Graph"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor) { return openGraphEditor(accessor); }
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
			super({ id: PreBaseGraphCommandIds.switchType, title: localize2('prebase.graph.switchType', "Open Code Graph"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		async run(accessor: ServicesAccessor) {
			// Deprecated: dual Architecture/Network product removed — open Code Graph.
			await openGraphEditor(accessor);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.switchLayout, title: localize2('prebase.graph.switchLayout', "Switch Graph Layout"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		async run(accessor: ServicesAccessor, layoutMode?: NetworkLayoutMode | string) {
			const config = accessor.get(IConfigurationService);
			const order = NETWORK_LAYOUT_OPTIONS.map(o => o.id);
			const current = (config.getValue<string>(PreBaseGraphConfigKeys.GraphNetworkLayoutMode) || 'community') as NetworkLayoutMode;
			const asNetwork = typeof layoutMode === 'string' && order.includes(layoutMode as NetworkLayoutMode)
				? layoutMode as NetworkLayoutMode
				: undefined;
			const next = asNetwork ?? order[(Math.max(0, order.indexOf(current)) + 1) % order.length];
			await config.updateValue(PreBaseGraphConfigKeys.GraphNetworkLayoutMode, next);
			await openGraphEditor(accessor);
		}
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
			super({ id: PreBaseGraphCommandIds.findPathForMagnus, title: localize2('prebase.graph.findPathForMagnus', "Find Graph Path for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor, fromIdOrPath: string, toIdOrPath: string) {
			return accessor.get(IPreBaseGraphService).findPathForMagnus(fromIdOrPath, toIdOrPath);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.getAffectedForMagnus, title: localize2('prebase.graph.getAffectedForMagnus', "Get Affected Graph Nodes for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor, nodeIdOrPath: string, maximumNodes?: number) {
			return accessor.get(IPreBaseGraphService).getAffectedForMagnus(nodeIdOrPath, maximumNodes);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.explainSelectedNode, title: localize2('prebase.graph.explainSelectedNode', "Explain Selected Graph Node"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		async run(accessor: ServicesAccessor) {
			const graph = accessor.get(IPreBaseGraphService);
			const notify = accessor.get(INotificationService);
			const output = accessor.get(IOutputService);
			const raw = graph.explainSelectedForMagnus();
			if (!raw) {
				notify.info(localize('prebase.graph.noSelectedNode', "No graph node selected."));
				return;
			}
			await output.showChannel(PREBASE_GRAPH_CHANNEL_ID);
			try {
				const parsed = JSON.parse(raw) as {
					label?: string;
					communityLabel?: string;
					degrees?: { degree?: number };
					important?: { rank?: number };
					confidence?: { EXTRACTED?: number; INFERRED?: number; AMBIGUOUS?: number; unknown?: number };
				};
				const conf = parsed.confidence;
				const bits = [
					parsed.label || 'node',
					parsed.communityLabel ? `community ${parsed.communityLabel}` : undefined,
					typeof parsed.degrees?.degree === 'number' ? `degree ${parsed.degrees.degree}` : undefined,
					parsed.important?.rank ? `important #${parsed.important.rank}` : undefined,
					conf
						? `confidence EXTRACTED ${conf.EXTRACTED ?? 0} · INFERRED ${conf.INFERRED ?? 0} · AMBIGUOUS ${conf.AMBIGUOUS ?? 0} · unknown ${conf.unknown ?? 0}`
						: undefined,
				].filter(Boolean);
				appendGraphChannel(output, `Explain ${parsed.label || 'node'}`, [
					bits.join(' · '),
					raw.length > 4_000 ? `${raw.slice(0, 4_000)}…` : raw,
				]);
				notify.info(localize('prebase.graph.explainSummary', "Explain: {0}", bits.join(' · ')));
			} catch {
				notify.info(localize('prebase.graph.explainReady', "Node explanation ready (see PreBase Graph output)."));
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.showImportantNodes, title: localize2('prebase.graph.showImportantNodes', "Show Important Graph Nodes"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		async run(accessor: ServicesAccessor) {
			const output = accessor.get(IOutputService);
			const raw = accessor.get(IPreBaseGraphService).getImportantNodesForMagnus(10);
			await output.showChannel(PREBASE_GRAPH_CHANNEL_ID);
			try {
				const parsed = JSON.parse(raw) as { nodes?: Array<{ label?: string; id?: string; degree?: number }>; notice?: string };
				const nodeCount = parsed.nodes?.length ?? 0;
				const lines = (parsed.nodes ?? []).slice(0, 10).map((n, i) => `${i + 1}. ${n.label || n.id} (degree ${n.degree ?? 0})`);
				if (parsed.notice) {
					lines.push(parsed.notice);
				}
				appendGraphChannel(output, `Important nodes (${nodeCount})`, lines);
				accessor.get(INotificationService).info(
					nodeCount
						? localize('prebase.graph.importantSummary', "Important nodes:\n{0}", lines.join('\n'))
						: localize('prebase.graph.importantEmpty', "No important nodes yet — scan the Code Graph first.")
				);
			} catch {
				accessor.get(INotificationService).info(localize('prebase.graph.importantEmpty', "No important nodes yet — scan the Code Graph first."));
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.showBridgeNodes, title: localize2('prebase.graph.showBridgeNodes', "Show Bridge Graph Nodes"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		async run(accessor: ServicesAccessor) {
			const output = accessor.get(IOutputService);
			const raw = accessor.get(IPreBaseGraphService).getBridgeNodesForMagnus(10);
			await output.showChannel(PREBASE_GRAPH_CHANNEL_ID);
			try {
				const parsed = JSON.parse(raw) as { nodes?: Array<{ label?: string; id?: string; crossEdgeCount?: number; communities?: number[] }>; notice?: string };
				const nodeCount = parsed.nodes?.length ?? 0;
				const lines = (parsed.nodes ?? []).slice(0, 10).map((n, i) => {
					const communities = (n.communities ?? []).join(',');
					return `${i + 1}. ${n.label || n.id} (cross ${n.crossEdgeCount ?? 0}${communities ? `; communities ${communities}` : ''})`;
				});
				if (parsed.notice) {
					lines.push(parsed.notice);
				}
				appendGraphChannel(output, `Bridge nodes (${nodeCount})`, lines);
				accessor.get(INotificationService).info(
					nodeCount
						? localize('prebase.graph.bridgeSummary', "Bridge nodes:\n{0}", lines.join('\n'))
						: localize('prebase.graph.bridgeEmpty', "No bridge nodes yet — scan the Code Graph first.")
				);
			} catch {
				accessor.get(INotificationService).info(localize('prebase.graph.bridgeEmpty', "No bridge nodes yet — scan the Code Graph first."));
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.showCommunities, title: localize2('prebase.graph.showCommunities', "Show Graph Communities"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		async run(accessor: ServicesAccessor) {
			const output = accessor.get(IOutputService);
			const raw = accessor.get(IPreBaseGraphService).getCommunitiesForMagnus(20);
			await output.showChannel(PREBASE_GRAPH_CHANNEL_ID);
			try {
				const parsed = JSON.parse(raw) as { communityCount?: number; communities?: Array<{ id: number; label: string; count: number }>; notice?: string };
				const communityCount = parsed.communityCount ?? parsed.communities?.length ?? 0;
				const lines = (parsed.communities ?? []).slice(0, 12).map(c => `${c.label} (#${c.id}, ${c.count})`);
				if (parsed.notice) {
					lines.push(parsed.notice);
				}
				appendGraphChannel(output, `Communities (${communityCount})`, lines);
				accessor.get(INotificationService).info(
					(parsed.communities?.length ?? 0)
						? localize('prebase.graph.communitiesSummary', "{0} communities:\n{1}", communityCount, lines.join('\n'))
						: localize('prebase.graph.communitiesEmpty', "No communities yet — scan the Code Graph first.")
				);
			} catch {
				accessor.get(INotificationService).info(localize('prebase.graph.communitiesEmpty', "No communities yet — scan the Code Graph first."));
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.explainForMagnus, title: localize2('prebase.graph.explainForMagnus', "Explain Graph Node for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor, nodeIdOrPath?: string) {
			const graph = accessor.get(IPreBaseGraphService);
			if (typeof nodeIdOrPath === 'string' && nodeIdOrPath.trim()) {
				return graph.explainNodeForMagnus(nodeIdOrPath);
			}
			return graph.explainSelectedForMagnus();
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.getImportantForMagnus, title: localize2('prebase.graph.getImportantForMagnus', "Get Important Graph Nodes for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor, limit?: number) {
			return accessor.get(IPreBaseGraphService).getImportantNodesForMagnus(limit);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.getCommunitiesForMagnus, title: localize2('prebase.graph.getCommunitiesForMagnus', "Get Graph Communities for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor, limit?: number) {
			return accessor.get(IPreBaseGraphService).getCommunitiesForMagnus(limit);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.getBridgesForMagnus, title: localize2('prebase.graph.getBridgesForMagnus', "Get Bridge Graph Nodes for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor, limit?: number) {
			return accessor.get(IPreBaseGraphService).getBridgeNodesForMagnus(limit);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.getSurprisingForMagnus, title: localize2('prebase.graph.getSurprisingForMagnus', "Get Surprising Graph Connections for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
		}
		run(accessor: ServicesAccessor, limit?: number) {
			return accessor.get(IPreBaseGraphService).getSurprisingConnectionsForMagnus(limit);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: PreBaseGraphCommandIds.showSurprisingConnections, title: localize2('prebase.graph.showSurprisingConnections', "Show Surprising Graph Connections"), category: localize2('prebase.category', "PreBase"), f1: true });
		}
		async run(accessor: ServicesAccessor) {
			const raw = accessor.get(IPreBaseGraphService).getSurprisingConnectionsForMagnus(10);
			const output = accessor.get(IOutputService);
			await output.showChannel(PREBASE_GRAPH_CHANNEL_ID);
			const channel = output.getChannel(PREBASE_GRAPH_CHANNEL_ID);
			try {
				const parsed = JSON.parse(raw) as {
					edges?: Array<{
						sourceLabel?: string;
						targetLabel?: string;
						sourceCommunity?: number;
						targetCommunity?: number;
						surprise?: number;
						reason?: string;
					}>;
				};
				const edges = parsed.edges ?? [];
				channel?.append(`[PreBase] Cross-community surprising connections (${edges.length}):\n`);
				for (const [i, e] of edges.entries()) {
					channel?.append(
						`  ${i + 1}. ${e.sourceLabel ?? '?'} → ${e.targetLabel ?? '?'} ` +
						`(communities ${e.sourceCommunity}↔${e.targetCommunity}, surprise ${e.surprise ?? 0})\n` +
						`     ${e.reason ?? ''}\n`
					);
				}
				if (edges.length === 0) {
					channel?.append('  (none — scan the Code Graph first, or no cross-community imports)\n');
				}
				accessor.get(INotificationService).info(
					edges.length
						? localize('prebase.graph.surprisingSummary', "Cross-community: {0} surprising connection(s) (see PreBase Graph output).", edges.length)
						: localize('prebase.graph.surprisingEmpty', "No surprising cross-community connections yet — scan the Code Graph first.")
				);
			} catch {
				accessor.get(INotificationService).info(localize('prebase.graph.surprisingEmpty', "No surprising cross-community connections yet — scan the Code Graph first."));
			}
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

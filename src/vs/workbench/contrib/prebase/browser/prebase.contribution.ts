/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IOutputService } from '../../../services/output/common/output.js';
import { IOutputChannelRegistry, Extensions as OutputExtensions } from '../../../services/output/common/output.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import '../common/prebaseConfiguration.js';
import { PREBASE_GRAPH_CHANNEL_ID, PREBASE_GRAPH_CHANNEL_LABEL, PREBASE_RUNTIME_CHANNEL_ID, PREBASE_RUNTIME_CHANNEL_LABEL, PreBaseConfigKeys } from '../common/prebaseConfiguration.js';
import type { LayoutMode } from '../common/graph/types.js';
import type { PreBaseViewportPreset } from '../common/runtime/viewportPresets.js';
import { IPreBaseGraphService, PreBaseGraphService, type PreBaseGraphType } from './prebaseGraphService.js';
import { IPreBaseRuntimeService, PreBaseRuntimeService } from './prebaseRuntimeService.js';
import { IPreBaseAccountService, PreBaseAccountContext, PreBaseAccountService } from './prebaseAccountService.js';
import { IPreBaseGraphDescriptionService, PreBaseGraphDescriptionService } from './prebaseGraphDescriptionService.js';
import { prebaseMapsViewIcon, prebaseRuntimeViewIcon } from './prebaseIcons.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { PreBaseMapsViewPane } from './prebaseMapsView.js';
import { PreBaseRuntimeViewPane } from './prebaseRuntimeView.js';
import { PreBaseGraphEditor } from './graphEditor.js';
import { PreBaseGraphEditorInput } from './graphEditorInput.js';
import { PreBaseRuntimeEditor } from './runtimeEditor.js';
import { PreBaseRuntimeEditorInput } from './runtimeEditorInput.js';
import { PreBaseSettingsEditor } from './prebaseSettingsEditor.js';
import { PreBaseSettingsEditorInput } from './prebaseSettingsEditorInput.js';
import { PreBaseHomeEditor } from './prebaseHomeEditor.js';
import { PreBaseHomeEditorInput } from './prebaseHomeEditorInput.js';
import './prebaseHomeEmptyEditors.js';
// Onboarding editor kept in tree for a later release; not registered in the workbench right now.

// --- services

registerSingleton(IPreBaseGraphService, PreBaseGraphService, InstantiationType.Delayed);
registerSingleton(IPreBaseRuntimeService, PreBaseRuntimeService, InstantiationType.Delayed);
registerSingleton(IPreBaseAccountService, PreBaseAccountService, InstantiationType.Delayed);
registerSingleton(IPreBaseGraphDescriptionService, PreBaseGraphDescriptionService, InstantiationType.Delayed);

// --- output channel

Registry.as<IOutputChannelRegistry>(OutputExtensions.OutputChannels).registerChannel({
	id: PREBASE_GRAPH_CHANNEL_ID,
	label: PREBASE_GRAPH_CHANNEL_LABEL,
	log: false
});

Registry.as<IOutputChannelRegistry>(OutputExtensions.OutputChannels).registerChannel({
	id: PREBASE_RUNTIME_CHANNEL_ID,
	label: PREBASE_RUNTIME_CHANNEL_LABEL,
	log: false
});

// --- view containers

export const PREBASE_MAPS_VIEW_CONTAINER_ID = 'workbench.view.prebase.maps';
export const PREBASE_RUNTIME_VIEW_CONTAINER_ID = 'workbench.view.prebase.runtime';

const mapsContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: PREBASE_MAPS_VIEW_CONTAINER_ID,
	title: localize2('prebase.maps.container', "PreBase Maps"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [PREBASE_MAPS_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: prebaseMapsViewIcon,
	order: 8,
	hideIfEmpty: false,
}, ViewContainerLocation.Sidebar, { isDefault: false });

const runtimeContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: PREBASE_RUNTIME_VIEW_CONTAINER_ID,
	title: localize2('prebase.runtime.container', "Runtime Preview"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [PREBASE_RUNTIME_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: prebaseRuntimeViewIcon,
	order: 9,
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

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: PreBaseRuntimeViewPane.ID,
	name: PreBaseRuntimeViewPane.LABEL,
	containerIcon: prebaseRuntimeViewIcon,
	ctorDescriptor: new SyncDescriptor(PreBaseRuntimeViewPane),
	canToggleVisibility: false,
	canMoveView: true,
	order: 1,
}], runtimeContainer);

// --- editors

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PreBaseGraphEditor,
		PreBaseGraphEditor.ID,
		localize('prebase.graph.editor', "PreBase Graph")
	),
	[new SyncDescriptor(PreBaseGraphEditorInput)]
);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PreBaseRuntimeEditor,
		PreBaseRuntimeEditor.ID,
		localize('prebase.runtime.editor', "PreBase Runtime Preview")
	),
	[new SyncDescriptor(PreBaseRuntimeEditorInput)]
);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PreBaseSettingsEditor,
		PreBaseSettingsEditor.ID,
		localize('prebase.settings.editor', "PreBase Settings")
	),
	[new SyncDescriptor(PreBaseSettingsEditorInput)]
);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PreBaseHomeEditor,
		PreBaseHomeEditor.ID,
		localize('prebase.home.editor', "PreBase Home")
	),
	[new SyncDescriptor(PreBaseHomeEditorInput)]
);

class PreBaseGraphEditorInputSerializer implements IEditorSerializer {
	canSerialize(editor: EditorInput): boolean {
		return editor instanceof PreBaseGraphEditorInput;
	}
	serialize(editor: EditorInput): string {
		return JSON.stringify({ graphType: (editor as PreBaseGraphEditorInput).graphType });
	}
	deserialize(instantiationService: IInstantiationService, raw: string): EditorInput | undefined {
		try {
			const data = JSON.parse(raw) as { graphType: PreBaseGraphType };
			return PreBaseGraphEditorInput.create(data.graphType || 'architecture');
		} catch {
			return undefined;
		}
	}
}

class PreBaseRuntimeEditorInputSerializer implements IEditorSerializer {
	canSerialize(editor: EditorInput): boolean {
		return editor instanceof PreBaseRuntimeEditorInput;
	}
	serialize(): string {
		return '{}';
	}
	deserialize(): EditorInput {
		return new PreBaseRuntimeEditorInput();
	}
}

class PreBaseSettingsEditorInputSerializer implements IEditorSerializer {
	canSerialize(editor: EditorInput): boolean {
		return editor instanceof PreBaseSettingsEditorInput;
	}
	serialize(): string {
		return '{}';
	}
	deserialize(): EditorInput {
		return new PreBaseSettingsEditorInput();
	}
}

class PreBaseHomeEditorInputSerializer implements IEditorSerializer {
	canSerialize(editor: EditorInput): boolean {
		return editor instanceof PreBaseHomeEditorInput;
	}
	serialize(): string {
		return '{}';
	}
	deserialize(): EditorInput {
		return new PreBaseHomeEditorInput();
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PreBaseGraphEditorInput.TypeID,
	PreBaseGraphEditorInputSerializer
);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PreBaseRuntimeEditorInput.TypeID,
	PreBaseRuntimeEditorInputSerializer
);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PreBaseSettingsEditorInput.TypeID,
	PreBaseSettingsEditorInputSerializer
);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PreBaseHomeEditorInput.TypeID,
	PreBaseHomeEditorInputSerializer
);

// --- helpers

async function openGraphEditor(accessor: ServicesAccessor, graphType: PreBaseGraphType): Promise<void> {
	const editorService = accessor.get(IEditorService);
	const graphService = accessor.get(IPreBaseGraphService);
	// Open immediately; the editor pane kicks off scan/relayout without blocking close/UI.
	await graphService.setGraphType(graphType);
	await editorService.openEditor(PreBaseGraphEditorInput.create(graphType), { pinned: true });
}

async function openRuntimeEditor(accessor: ServicesAccessor): Promise<void> {
	const runtimeService = accessor.get(IPreBaseRuntimeService);
	await runtimeService.openPreviewEditor();
}

async function openSettingsEditor(accessor: ServicesAccessor): Promise<void> {
	const editorService = accessor.get(IEditorService);
	await editorService.openEditor(new PreBaseSettingsEditorInput(), { pinned: true });
}

async function openHomeEditor(accessor: ServicesAccessor): Promise<void> {
	const editorService = accessor.get(IEditorService);
	await editorService.openEditor(new PreBaseHomeEditorInput(), { pinned: true, revealIfOpened: true });
}

// --- settings command

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.settings.open',
			title: localize2('prebase.settings.open', "Open PreBase Settings"),
			category: localize2('prebase.category', "PreBase"),
			f1: true
		});
	}
	run(accessor: ServicesAccessor) { return openSettingsEditor(accessor); }
});

// --- home / recent commands

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.home.open',
			title: localize2('prebase.home.open', "Open Home"),
			category: localize2('prebase.category', "PreBase"),
			f1: true
		});
	}
	run(accessor: ServicesAccessor) { return openHomeEditor(accessor); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.home.openRecent',
			title: localize2('prebase.home.openRecent', "Open Recent Project"),
			category: localize2('prebase.category', "PreBase"),
			f1: true
		});
	}
	run(accessor: ServicesAccessor) {
		return accessor.get(ICommandService).executeCommand('workbench.action.openRecent');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.home.clearRecent',
			title: localize2('prebase.home.clearRecent', "Clear Recently Opened"),
			category: localize2('prebase.category', "PreBase"),
			f1: true
		});
	}
	async run(accessor: ServicesAccessor) {
		await accessor.get(IWorkspacesService).clearRecentlyOpened();
	}
});

// --- account menu on the Activity Bar profile / Accounts button (onboarding deferred)

async function promptCredentials(quickInput: IQuickInputService, includeDisplayName: boolean): Promise<{ email: string; password: string; displayName?: string } | undefined> {
	const email = await quickInput.input({
		title: localize('prebase.account.emailTitle', "PreBase Account"),
		prompt: localize('prebase.account.email', "Email"),
		validateInput: async (v) => (!v.includes('@') ? localize('prebase.account.emailInvalid', "Enter a valid email") : undefined),
	});
	if (!email) {
		return undefined;
	}
	let displayName: string | undefined;
	if (includeDisplayName) {
		displayName = await quickInput.input({
			title: localize('prebase.account.displayTitle', "Display name"),
			prompt: localize('prebase.account.display', "Display name (optional)"),
		}) || undefined;
	}
	const password = await quickInput.input({
		title: localize('prebase.account.passwordTitle', "Password"),
		prompt: localize('prebase.account.password', "Password"),
		password: true,
	});
	if (!password) {
		return undefined;
	}
	return { email, password, displayName };
}

async function ensureAccountConfigured(accessor: ServicesAccessor): Promise<boolean> {
	const accounts = accessor.get(IPreBaseAccountService);
	if (accounts.apiConfigured) {
		return true;
	}
	accessor.get(INotificationService).notify({
		severity: Severity.Info,
		message: localize('prebase.account.unconfiguredMenu', "PreBase account service is not configured. Set prebase.account.apiBaseUrl to an https endpoint to enable sign-in."),
	});
	await accessor.get(ICommandService).executeCommand('workbench.action.openSettings', PreBaseConfigKeys.AccountApiBaseUrl);
	return false;
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.account.signIn',
			title: localize2('prebase.account.signIn', "Sign In…"),
			category: localize2('prebase.category', "PreBase"),
			f1: true,
			menu: {
				id: MenuId.AccountsContext,
				group: '0_prebase',
				order: 1,
				when: PreBaseAccountContext.notSignedIn,
			}
		});
	}
	async run(accessor: ServicesAccessor) {
		if (!(await ensureAccountConfigured(accessor))) {
			return;
		}
		const notify = accessor.get(INotificationService);
		const creds = await promptCredentials(accessor.get(IQuickInputService), false);
		if (!creds) {
			return;
		}
		try {
			await accessor.get(IPreBaseAccountService).signIn(creds.email, creds.password);
			notify.info(localize('prebase.account.signedIn', "Signed in to PreBase."));
		} catch (err) {
			notify.error(err instanceof Error ? err.message : String(err));
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.account.signUp',
			title: localize2('prebase.account.signUp', "Create Account…"),
			category: localize2('prebase.category', "PreBase"),
			f1: true,
			menu: {
				id: MenuId.AccountsContext,
				group: '0_prebase',
				order: 2,
				when: PreBaseAccountContext.notSignedIn,
			}
		});
	}
	async run(accessor: ServicesAccessor) {
		if (!(await ensureAccountConfigured(accessor))) {
			return;
		}
		const notify = accessor.get(INotificationService);
		const creds = await promptCredentials(accessor.get(IQuickInputService), true);
		if (!creds) {
			return;
		}
		try {
			await accessor.get(IPreBaseAccountService).signUp(creds.email, creds.password, creds.displayName);
			notify.info(localize('prebase.account.created', "PreBase account created."));
		} catch (err) {
			notify.error(err instanceof Error ? err.message : String(err));
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.account.manage',
			title: localize2('prebase.account.manage', "Manage Account"),
			category: localize2('prebase.category', "PreBase"),
			f1: true,
			precondition: PreBaseAccountContext.signedIn,
			menu: {
				id: MenuId.AccountsContext,
				group: '0_prebase',
				order: 3,
				when: PreBaseAccountContext.signedIn,
			}
		});
	}
	async run(accessor: ServicesAccessor) {
		const accounts = accessor.get(IPreBaseAccountService);
		const notify = accessor.get(INotificationService);
		if (accounts.state === 'signedIn' && accounts.account) {
			notify.info(localize('prebase.account.manageInfo', "{0}{1}", accounts.account.displayName, accounts.account.email ? ` · ${accounts.account.email}` : ''));
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.account.signOut',
			title: localize2('prebase.account.signOut', "Sign Out"),
			category: localize2('prebase.category', "PreBase"),
			f1: true,
			precondition: PreBaseAccountContext.signedIn,
			menu: {
				id: MenuId.AccountsContext,
				group: '0_prebase',
				order: 4,
				when: PreBaseAccountContext.signedIn,
			}
		});
	}
	async run(accessor: ServicesAccessor) {
		await accessor.get(IPreBaseAccountService).signOut();
		accessor.get(INotificationService).info(localize('prebase.account.signedOut', "Signed out of PreBase."));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.account.configureService',
			title: localize2('prebase.account.configureService', "Configure Account Service…"),
			category: localize2('prebase.category', "PreBase"),
			f1: true,
			menu: {
				id: MenuId.AccountsContext,
				group: '0_prebase',
				order: 10,
				when: ContextKeyExpr.and(PreBaseAccountContext.unconfigured, PreBaseAccountContext.notSignedIn),
			}
		});
	}
	async run(accessor: ServicesAccessor) {
		await ensureAccountConfigured(accessor);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.graph.clearDescriptionCache',
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
			id: 'prebase.graph.regenerateDescription',
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

// --- graph commands

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.openArchitecture', title: localize2('prebase.graph.openArchitecture', "Open Architecture Graph"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { return openGraphEditor(accessor, 'architecture'); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.openNetwork', title: localize2('prebase.graph.openNetwork', "Open Network Graph"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { return openGraphEditor(accessor, 'network'); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.scanWorkspace', title: localize2('prebase.graph.scanWorkspace', "Scan Workspace"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { return accessor.get(IPreBaseGraphService).scanWorkspace(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.rescanWorkspace', title: localize2('prebase.graph.rescanWorkspace', "Rescan Workspace"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { return accessor.get(IPreBaseGraphService).rescanWorkspace(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.cancelScan', title: localize2('prebase.graph.cancelScan', "Cancel Graph Scan"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseGraphService).cancelScan(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.switchType', title: localize2('prebase.graph.switchType', "Switch Graph Type"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor, graphType?: PreBaseGraphType) {
		const service = accessor.get(IPreBaseGraphService);
		const next = graphType ?? (service.getViewState().graphType === 'architecture' ? 'network' : 'architecture');
		await openGraphEditor(accessor, next);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.switchLayout', title: localize2('prebase.graph.switchLayout', "Switch Architecture Layout"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor, layoutMode?: LayoutMode) {
		const service = accessor.get(IPreBaseGraphService);
		const current = service.getViewState().layoutMode;
		const order: LayoutMode[] = ['hierarchy', 'pyramid', 'scattered'];
		const next = layoutMode ?? order[(order.indexOf(current) + 1) % order.length];
		await service.setLayoutMode(next);
		await openGraphEditor(accessor, 'architecture');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.fitView', title: localize2('prebase.graph.fitView', "Fit Graph View"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseGraphService).requestFitView(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.resetView', title: localize2('prebase.graph.resetView', "Reset Graph View"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseGraphService).requestResetView(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.toggleLegend', title: localize2('prebase.graph.toggleLegend', "Toggle Graph Legend"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		const config = accessor.get(IConfigurationService);
		const current = config.getValue<boolean>(PreBaseConfigKeys.GraphShowLegend) !== false;
		await config.updateValue(PreBaseConfigKeys.GraphShowLegend, !current);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.toggleMinimap', title: localize2('prebase.graph.toggleMinimap', "Toggle Graph Minimap"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		// Setting is retained for future parity; minimap is not rendered yet — do not flip a no-op boolean.
		accessor.get(INotificationService).info(localize('prebase.graph.minimapUnavailable', "Graph minimap is not available yet."));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.showDiagnostics', title: localize2('prebase.graph.showDiagnostics', "Show Graph Diagnostics"), category: localize2('prebase.category', "PreBase"), f1: true });
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
		super({ id: 'prebase.graph.clearCache', title: localize2('prebase.graph.clearCache', "Clear Graph Cache"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseGraphService).clearCache(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.focusCurrentFile', title: localize2('prebase.graph.focusCurrentFile', "Focus Current File in Graph"), category: localize2('prebase.category', "PreBase"), f1: true });
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

// --- runtime commands

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.open', title: localize2('prebase.runtime.open', "Open Runtime Preview"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { return openRuntimeEditor(accessor); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.openPreview', title: localize2('prebase.runtime.openPreview', "Open Runtime Preview"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { return openRuntimeEditor(accessor); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.getSelectionForMagnus', title: localize2('prebase.graph.getSelectionForMagnus', "Get Graph Selection for Magnus"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor) {
		return accessor.get(IPreBaseGraphService).getSelectionSummaryForMagnus();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.getContextForMagnus', title: localize2('prebase.runtime.getContextForMagnus', "Get Runtime Context for Magnus"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor) {
		return accessor.get(IPreBaseRuntimeService).getContextSummaryForMagnus();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.graph.attachSelectionToMagnus', title: localize2('prebase.graph.attachSelectionToMagnus', "Attach Graph Selection to Magnus"), category: localize2('prebase.category', "PreBase"), f1: true });
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

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.detectConfigurations', title: localize2('prebase.runtime.detectConfigurations', "Detect Runtime Configurations"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		const urls = await accessor.get(IPreBaseRuntimeService).detectConfigurations();
		const output = accessor.get(IOutputService);
		await output.showChannel(PREBASE_RUNTIME_CHANNEL_ID);
		accessor.get(INotificationService).info(localize('prebase.runtime.detectedNotify', "Detected: {0}", urls.join(', ')));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.start', title: localize2('prebase.runtime.startCmd', "Start Runtime Preview"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		await accessor.get(IPreBaseRuntimeService).start();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.stop', title: localize2('prebase.runtime.stopCmd', "Stop Runtime Preview"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		await accessor.get(IPreBaseRuntimeService).stop();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.restart', title: localize2('prebase.runtime.restartCmd', "Restart Runtime Preview"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		await accessor.get(IPreBaseRuntimeService).restart();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.reload', title: localize2('prebase.runtime.reloadCmd', "Reload Runtime Preview"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).reload(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.connect', title: localize2('prebase.runtime.connectCmd', "Connect Runtime Preview URL"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		await accessor.get(IPreBaseRuntimeService).connectUrl();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.goBack', title: localize2('prebase.runtime.goBackCmd', "Runtime Preview Back"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).goBack(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.goForward', title: localize2('prebase.runtime.goForwardCmd', "Runtime Preview Forward"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).goForward(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.openExternal', title: localize2('prebase.runtime.openExternalCmd', "Open Runtime Preview Externally"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		await accessor.get(IPreBaseRuntimeService).openExternal();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.copyUrl', title: localize2('prebase.runtime.copyUrlCmd', "Copy Runtime Preview URL"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		await accessor.get(IPreBaseRuntimeService).copyUrl();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.openTerminal', title: localize2('prebase.runtime.openTerminalCmd', "Open Runtime Preview Terminal"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		await accessor.get(IPreBaseRuntimeService).openTerminal();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.rotateViewport', title: localize2('prebase.runtime.rotateViewportCmd', "Rotate Runtime Viewport"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).rotateViewport(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.setViewport', title: localize2('prebase.runtime.setViewportCmd', "Set Runtime Viewport Preset"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor, preset?: PreBaseViewportPreset) {
		if (preset) {
			accessor.get(IPreBaseRuntimeService).setViewportPreset(preset);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.clearDiagnostics', title: localize2('prebase.runtime.clearDiagnosticsCmd', "Clear Runtime Diagnostics"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).clearDiagnostics(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.inspect', title: localize2('prebase.runtime.inspectCmd', "Inspect Runtime Preview"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).inspect(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.captureScreenshot', title: localize2('prebase.runtime.captureScreenshotCmd', "Capture Runtime Screenshot"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).captureScreenshot(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.startTestSession', title: localize2('prebase.runtime.startTestSessionCmd', "Start Runtime Test Session"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).startTestSession(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.stopTestSession', title: localize2('prebase.runtime.stopTestSessionCmd', "Stop Runtime Test Session"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).stopTestSession(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.replayTest', title: localize2('prebase.runtime.replayTestCmd', "Replay Runtime Test"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).replayTest(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.showReports', title: localize2('prebase.runtime.showReportsCmd', "Show Runtime Reports"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		const reports = accessor.get(IPreBaseRuntimeService).showReports();
		await accessor.get(IOutputService).showChannel(PREBASE_RUNTIME_CHANNEL_ID);
		accessor.get(INotificationService).info(reports.length
			? reports.join('\n')
			: localize('prebase.runtime.noReports', "No runtime reports yet."));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.attachToMagnus', title: localize2('prebase.runtime.attachToMagnusCmd', "Attach Runtime to Magnus"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).attachToMagnus(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.testWithMagnus', title: localize2('prebase.runtime.testWithMagnusCmd', "Test Runtime with Magnus"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).testWithMagnus(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.explainElement', title: localize2('prebase.runtime.explainElementCmd', "Explain Runtime Element with Magnus"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).explainElement(); }
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
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
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IOutputChannelRegistry, IOutputService, Extensions as OutputExtensions } from '../../../services/output/common/output.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
// eslint-disable-next-line local/code-import-patterns -- Graph sources are intentionally mounted here through the graphs ownership symlink.
import { PREBASE_MAPS_VIEW_CONTAINER_ID, registerPreBaseGraphContribution } from '../graphs/host/workbench/graphContribution.js';
import { PREBASE_RUNTIME_CHANNEL_ID, PREBASE_RUNTIME_CHANNEL_LABEL } from '../common/prebaseConfiguration.js';
import type { PreBaseViewportPreset } from '../common/runtime/viewportPresets.js';
import { IPreBaseRuntimeService, PreBaseRuntimeService } from './prebaseRuntimeService.js';
import { IPreBaseDesktopRuntimeService } from './prebaseDesktopRuntimeService.js';
import { stopDesktopSessionForMagnus } from '../common/runtime/desktopStopForMagnus.js';
import type { DesktopLaunchMode } from '../common/runtime/desktopTypes.js';
import { isWeb } from '../../../../base/common/platform.js';
import { IPreBaseCloudService, PreBaseCloudService } from './cloud/prebaseCloudService.js';
import { IPreBaseWebSearchService, PreBaseWebSearchService, type IPreBaseWebSearchRequest } from './prebaseWebSearchService.js';
import { IPreBaseAccountService, PreBaseAccountContext, PreBaseAccountService } from './prebaseAccountService.js';
import { PreBaseCloudConfigKeys } from '../common/cloud/cloudConfiguration.js';
import { prebaseRuntimeViewIcon } from './prebaseIcons.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { PreBaseRuntimeViewPane } from './prebaseRuntimeView.js';
import { PreBaseRuntimeEditor } from './runtimeEditor.js';
import { PreBaseRuntimeEditorInput } from './runtimeEditorInput.js';
import { PreBaseSettingsEditor } from './prebaseSettingsEditor.js';
import { PreBaseSettingsEditorInput } from './prebaseSettingsEditorInput.js';
import { PreBaseHomeEditor } from './prebaseHomeEditor.js';
import { PreBaseHomeEditorInput } from './prebaseHomeEditorInput.js';
import { PreBaseOnboardingEditor } from './prebaseOnboardingEditor.js';
import { PreBaseOnboardingEditorInput } from './prebaseOnboardingEditorInput.js';
import './prebaseRecentHistory.js';
import { PreBaseWorkspaceOpeningEditor } from './prebaseWorkspaceOpeningEditor.js';
import { PreBaseWorkspaceOpeningEditorInput } from './prebaseWorkspaceOpeningEditorInput.js';
import { PreBaseWorkspaceOpenPhase } from './prebaseWorkspaceOpening.js';

registerPreBaseGraphContribution();

// --- services

registerSingleton(IPreBaseRuntimeService, PreBaseRuntimeService, InstantiationType.Delayed);
registerSingleton(IPreBaseCloudService, PreBaseCloudService, InstantiationType.Delayed);
registerSingleton(IPreBaseWebSearchService, PreBaseWebSearchService, InstantiationType.Delayed);
registerSingleton(IPreBaseAccountService, PreBaseAccountService, InstantiationType.Delayed);

// --- output channel

Registry.as<IOutputChannelRegistry>(OutputExtensions.OutputChannels).registerChannel({
	id: PREBASE_RUNTIME_CHANNEL_ID,
	label: PREBASE_RUNTIME_CHANNEL_LABEL,
	log: false
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.webSearch.searchForMagnus', title: localize2('prebase.webSearch.searchForMagnus', "Search the Web for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor, input: IPreBaseWebSearchRequest) {
		return accessor.get(IPreBaseWebSearchService).searchForMagnus(input, CancellationToken.None);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.desktopGetProcessOutputForMagnus', title: localize2('prebase.runtime.desktopGetProcessOutputForMagnus', "Get Desktop Process Output for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor, sessionId?: string) {
		const desktop = getDesktopRuntimeService(accessor);
		return desktop?.getProcessOutputForMagnus(sessionId) ?? { ok: false, reason: 'Desktop runtime unavailable.' };
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.privacy.status', title: localize2('prebase.privacy.status', "PreBase: Privacy Status"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) {
		accessor.get(INotificationService).info(localize('prebase.privacy.statusMessage', 'Privacy Status: telemetry and experiment assignments are disabled. Crash dumps are written locally only when explicitly requested with --crash-reporter-directory; no crash upload endpoint is configured.'));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.getEvidenceForMagnus', title: localize2('prebase.runtime.getEvidenceForMagnus', "Get Runtime Preview Evidence for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor, kind: 'console' | 'network', maximumEntries?: number) {
		return accessor.get(IPreBaseRuntimeService).getEvidenceForMagnus(kind, maximumEntries);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.controlTestForMagnus', title: localize2('prebase.runtime.controlTestForMagnus', "Control Runtime Preview Test for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor, action: 'begin' | 'finalize' | 'replay') {
		return accessor.get(IPreBaseRuntimeService).controlTestForMagnus(action);
	}
});

export { PREBASE_MAPS_VIEW_CONTAINER_ID };

// --- view containers

export const PREBASE_RUNTIME_VIEW_CONTAINER_ID = 'workbench.view.prebase.runtime';

const runtimeContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: PREBASE_RUNTIME_VIEW_CONTAINER_ID,
	title: localize2('prebase.runtime.container', "Runtime Preview"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [PREBASE_RUNTIME_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: prebaseRuntimeViewIcon,
	order: 9,
	hideIfEmpty: false,
}, ViewContainerLocation.Sidebar, { isDefault: false });

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

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PreBaseOnboardingEditor,
		PreBaseOnboardingEditor.ID,
		localize('prebase.onboarding.editor', "Welcome to PreBase")
	),
	[new SyncDescriptor(PreBaseOnboardingEditorInput)]
);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PreBaseWorkspaceOpeningEditor,
		PreBaseWorkspaceOpeningEditor.ID,
		localize('prebase.workspace.opening.editor', "Opening Project")
	),
	[new SyncDescriptor(PreBaseWorkspaceOpeningEditorInput)]
);

// Contributions that open editors / prove AfterRestored must load after pane registration above.
// Onboarding before Home empty editors so first-run yield ordering is deterministic.
import './prebaseWorkbenchReadyContribution.js';
import './prebaseOnboardingContribution.js';
import './prebaseHomeEmptyEditors.js';

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

class PreBaseOnboardingEditorInputSerializer implements IEditorSerializer {
	canSerialize(editor: EditorInput): boolean {
		return editor instanceof PreBaseOnboardingEditorInput;
	}
	serialize(): string {
		return '{}';
	}
	deserialize(): EditorInput {
		return new PreBaseOnboardingEditorInput();
	}
}

class PreBaseWorkspaceOpeningEditorInputSerializer implements IEditorSerializer {
	canSerialize(editor: EditorInput): boolean {
		return editor instanceof PreBaseWorkspaceOpeningEditorInput;
	}
	serialize(editor: EditorInput): string {
		const input = editor as PreBaseWorkspaceOpeningEditorInput;
		return JSON.stringify({
			projectLabel: input.projectLabel,
			resourceUri: input.resourceUri?.toString(),
			phase: input.phase,
		});
	}
	deserialize(_instantiationService: IInstantiationService, raw: string): EditorInput | undefined {
		try {
			const data = JSON.parse(raw) as { projectLabel?: string; resourceUri?: string; phase?: string };
			return new PreBaseWorkspaceOpeningEditorInput(
				data.projectLabel ?? '',
				data.resourceUri ? URI.parse(data.resourceUri) : undefined,
				(data.phase as PreBaseWorkspaceOpenPhase | undefined) ?? 'restoringWorkbench',
			);
		} catch {
			return undefined;
		}
	}
}

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
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PreBaseOnboardingEditorInput.TypeID,
	PreBaseOnboardingEditorInputSerializer
);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PreBaseWorkspaceOpeningEditorInput.TypeID,
	PreBaseWorkspaceOpeningEditorInputSerializer
);

// --- helpers

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

async function openOnboardingEditor(accessor: ServicesAccessor): Promise<void> {
	const editorService = accessor.get(IEditorService);
	await editorService.openEditor(new PreBaseOnboardingEditorInput(), { pinned: true, revealIfOpened: true });
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
			id: 'prebase.onboarding.open',
			title: localize2('prebase.onboarding.open', "Open Welcome / Onboarding"),
			category: localize2('prebase.category', "PreBase"),
			f1: true
		});
	}
	run(accessor: ServicesAccessor) { return openOnboardingEditor(accessor); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'prebase.onboarding.reset',
			title: localize2('prebase.onboarding.reset', "Reset Welcome / Onboarding"),
			category: localize2('prebase.category', "PreBase"),
			f1: true
		});
	}
	run(accessor: ServicesAccessor) {
		accessor.get(IPreBaseAccountService).resetOnboarding();
		return openOnboardingEditor(accessor);
	}
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

// --- account menu on the Activity Bar profile / Accounts button

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

async function ensureAccountConfigured(accounts: IPreBaseAccountService, notificationService: INotificationService, commandService: ICommandService): Promise<boolean> {
	if (accounts.apiConfigured) {
		return true;
	}
	notificationService.notify({
		severity: Severity.Info,
		message: localize('prebase.account.unconfiguredMenu', "PreBase account service is not configured. Set prebase.cloud.url and prebase.cloud.publishableKey (Supabase) or the deprecated prebase.account.apiBaseUrl to enable sign-in."),
	});
	await commandService.executeCommand('workbench.action.openSettings', PreBaseCloudConfigKeys.Url);
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
		const accountService = accessor.get(IPreBaseAccountService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);
		const commandService = accessor.get(ICommandService);
		if (!(await ensureAccountConfigured(accountService, notificationService, commandService))) {
			return;
		}
		const creds = await promptCredentials(quickInputService, false);
		if (!creds) {
			return;
		}
		try {
			await accountService.signIn(creds.email, creds.password);
			notificationService.info(localize('prebase.account.signedIn', "Signed in to PreBase."));
		} catch (err) {
			notificationService.error(err instanceof Error ? err.message : String(err));
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
		const accountService = accessor.get(IPreBaseAccountService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);
		const commandService = accessor.get(ICommandService);
		if (!(await ensureAccountConfigured(accountService, notificationService, commandService))) {
			return;
		}
		const creds = await promptCredentials(quickInputService, true);
		if (!creds) {
			return;
		}
		try {
			await accountService.signUp(creds.email, creds.password, creds.displayName);
			notificationService.info(localize('prebase.account.created', "PreBase account created."));
		} catch (err) {
			notificationService.error(err instanceof Error ? err.message : String(err));
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
		const accountService = accessor.get(IPreBaseAccountService);
		const notificationService = accessor.get(INotificationService);
		await accountService.signOut();
		notificationService.info(localize('prebase.account.signedOut', "Signed out of PreBase."));
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
		await ensureAccountConfigured(
			accessor.get(IPreBaseAccountService),
			accessor.get(INotificationService),
			accessor.get(ICommandService),
		);
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
		super({ id: 'prebase.runtime.getContextForMagnus', title: localize2('prebase.runtime.getContextForMagnus', "Get Runtime Context for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor) {
		return accessor.get(IPreBaseRuntimeService).getStateForMagnus();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.controlForMagnus', title: localize2('prebase.runtime.controlForMagnus', "Control Runtime Preview for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor, action: 'start' | 'stop' | 'restart') {
		return accessor.get(IPreBaseRuntimeService).controlServerForMagnus(action);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.navigateForMagnus', title: localize2('prebase.runtime.navigateForMagnus', "Navigate Runtime Preview for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor, url: string) {
		return accessor.get(IPreBaseRuntimeService).navigateForMagnus(url);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.inspectForMagnus', title: localize2('prebase.runtime.inspectForMagnus', "Inspect Runtime Preview for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor, token?: CancellationToken) {
		return accessor.get(IPreBaseRuntimeService).inspectPageForMagnus(token);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.detectConfigurations', title: localize2('prebase.runtime.detectConfigurations', "Detect Runtime Configurations"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		const runtimeService = accessor.get(IPreBaseRuntimeService);
		const output = accessor.get(IOutputService);
		const notificationService = accessor.get(INotificationService);
		const urls = await runtimeService.detectConfigurations();
		await output.showChannel(PREBASE_RUNTIME_CHANNEL_ID);
		notificationService.info(localize('prebase.runtime.detectedNotify', "Detected: {0}", urls.join(', ')));
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
		const runtimeService = accessor.get(IPreBaseRuntimeService);
		const output = accessor.get(IOutputService);
		const notificationService = accessor.get(INotificationService);
		const reports = runtimeService.showReports();
		await output.showChannel(PREBASE_RUNTIME_CHANNEL_ID);
		notificationService.info(reports.length
			? reports.join('\n')
			: localize('prebase.runtime.noReports', "No runtime reports yet."));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.attachToMagnus', title: localize2('prebase.runtime.attachToMagnusCmd', "Attach Runtime to Agents"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).attachToMagnus(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.testWithMagnus', title: localize2('prebase.runtime.testWithMagnusCmd', "Test Runtime with Agents"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).testWithMagnus(); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.explainElement', title: localize2('prebase.runtime.explainElementCmd', "Explain Runtime Element with Agents"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) { accessor.get(IPreBaseRuntimeService).explainElement(); }
});

function getDesktopRuntimeService(accessor: ServicesAccessor): IPreBaseDesktopRuntimeService | undefined {
	if (isWeb) {
		return undefined;
	}
	try {
		return accessor.get(IPreBaseDesktopRuntimeService);
	} catch {
		return undefined;
	}
}

async function ensureDesktopDetected(runtimeService: IPreBaseRuntimeService, desktop: IPreBaseDesktopRuntimeService): Promise<boolean> {
	if (desktop.getProfile()?.isElectron) {
		return true;
	}
	await runtimeService.detectConfigurations();
	return Boolean(desktop.getProfile()?.isElectron);
}

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.startDesktop', title: localize2('prebase.runtime.startDesktopCmd', "Start Desktop Application"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		const desktop = getDesktopRuntimeService(accessor);
		const runtimeService = accessor.get(IPreBaseRuntimeService);
		if (desktop) {
			if (!(await ensureDesktopDetected(runtimeService, desktop))) {
				return undefined;
			}
			return desktop.start();
		}
		return runtimeService.start();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.stopDesktop', title: localize2('prebase.runtime.stopDesktopCmd', "Stop Desktop Application"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) {
		const desktop = getDesktopRuntimeService(accessor);
		if (desktop) {
			return desktop.stop();
		}
		return accessor.get(IPreBaseRuntimeService).stop();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.restartDesktop', title: localize2('prebase.runtime.restartDesktopCmd', "Restart Desktop Application"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	async run(accessor: ServicesAccessor) {
		const desktop = getDesktopRuntimeService(accessor);
		const runtimeService = accessor.get(IPreBaseRuntimeService);
		if (desktop) {
			if (!(await ensureDesktopDetected(runtimeService, desktop))) {
				return undefined;
			}
			return desktop.restart();
		}
		return runtimeService.restart();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.killDesktopSession', title: localize2('prebase.runtime.killDesktopSessionCmd', "Kill Desktop Session"), category: localize2('prebase.category', "PreBase"), f1: true });
	}
	run(accessor: ServicesAccessor) {
		return getDesktopRuntimeService(accessor)?.kill();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.selectDesktopLaunchMode', title: localize2('prebase.runtime.selectDesktopLaunchModeCmd', "Select Desktop Launch Mode"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor, mode: DesktopLaunchMode) {
		if (mode !== 'managed' && mode !== 'external') {
			return;
		}
		const runtime = accessor.get(IPreBaseRuntimeService);
		return runtime.setDesktopLaunchMode(mode);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.desktopListSessionsForMagnus', title: localize2('prebase.runtime.desktopListSessionsForMagnus', "List Desktop Sessions for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor) {
		const desktop = getDesktopRuntimeService(accessor);
		if (!desktop) {
			return { ok: false, reason: 'Desktop runtime unavailable in this host.' };
		}
		return { ok: true, sessions: desktop.getSessions().map(s => desktop.getSessionSummaryForMagnus(s.id)) };
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.desktopGetSessionForMagnus', title: localize2('prebase.runtime.desktopGetSessionForMagnus', "Get Desktop Session for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor, sessionId?: string) {
		return getDesktopRuntimeService(accessor)?.getSessionSummaryForMagnus(sessionId) ?? { ok: false, reason: 'Desktop runtime unavailable.' };
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.desktopInspectForMagnus', title: localize2('prebase.runtime.desktopInspectForMagnus', "Inspect Desktop Window for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor, sessionId?: string) {
		return getDesktopRuntimeService(accessor)?.inspectForMagnus(sessionId) ?? { ok: false, reason: 'Desktop runtime unavailable.' };
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.desktopReloadForMagnus', title: localize2('prebase.runtime.desktopReloadForMagnus', "Reload Desktop Window for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	async run(accessor: ServicesAccessor, _sessionId?: string) {
		const desktop = getDesktopRuntimeService(accessor);
		if (!desktop) {
			return { ok: false, reason: 'Desktop runtime unavailable.' };
		}
		const reloaded = await desktop.reload();
		if (!reloaded) {
			return { ok: false, reason: 'Reload is only supported for managed desktop sessions.' };
		}
		return { ok: true };
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.desktopRestartForMagnus', title: localize2('prebase.runtime.desktopRestartForMagnus', "Restart Desktop Session for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	async run(accessor: ServicesAccessor, _sessionId?: string) {
		const desktop = getDesktopRuntimeService(accessor);
		if (!desktop) {
			return { ok: false, reason: 'Desktop runtime unavailable.' };
		}
		await desktop.restart();
		return { ok: true, session: desktop.getSessionSummaryForMagnus() };
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.desktopStopForMagnus', title: localize2('prebase.runtime.desktopStopForMagnus', "Stop Desktop Session for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	async run(accessor: ServicesAccessor, _sessionId?: string) {
		const desktop = getDesktopRuntimeService(accessor);
		if (!desktop) {
			return { ok: false, reason: 'Desktop runtime unavailable.' };
		}
		await stopDesktopSessionForMagnus(desktop);
		return { ok: true };
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'prebase.runtime.desktopCdpEvaluateForMagnus', title: localize2('prebase.runtime.desktopCdpEvaluateForMagnus', "Evaluate in Desktop Session for Agents"), category: localize2('prebase.category', "PreBase"), f1: false });
	}
	run(accessor: ServicesAccessor, sessionId: string | undefined, expression: string) {
		return getDesktopRuntimeService(accessor)?.evaluateForMagnus(sessionId, expression) ?? { ok: false, reason: 'Desktop runtime unavailable.' };
	}
});

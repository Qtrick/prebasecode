/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel, type IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { PREBASE_DESKTOP_CHANNEL_NAME, type IPreBaseDesktopMainService } from '../../../../platform/prebaseDesktop/common/prebaseDesktop.js';
import { PreBaseConfigKeys } from '../common/prebaseConfiguration.js';
import type { CdpTarget, DesktopFramework, DesktopLaunchMode, DesktopProjectProfile, ExternalLaunchRequest, PreBaseDesktopSession } from '../common/runtime/desktopTypes.js';
import { desktopUiModeFromLaunch, isElectronProfile, isRecognizedDesktopApp, isTauriProfile } from '../common/runtime/desktopTypes.js';
import { detectDesktopProjects, selectDesktopProfile } from '../common/runtime/desktopDetector.js';
import { detectElectronProject } from '../common/runtime/electronDetector.js';
import { buildElectronExternalLaunchRequest, buildPackageScriptExternalLaunchRequest, buildTauriExternalLaunchRequest, tauriLaunchCwd } from '../common/runtime/externalLaunchCommand.js';
import { assertDesktop, formatDesktopFailure, interactDesktop, runDesktopDomCommand, type DesktopEvaluateFn } from '../common/runtime/desktopAutomationHost.js';
import { DEFAULT_ELECTRON_STARTUP_TIMEOUT_MS, DEFAULT_TAURI_STARTUP_TIMEOUT_MS, describeLocator, parseDesktopLocator, redactSecretText, validatePressKey, type DesktopAssertCondition, type DesktopInteractAction } from '../common/runtime/desktopLocators.js';
import { createDesktopTestRun, recordDesktopTestStep, summarizeDesktopTestRun, type DesktopTestRun } from '../common/runtime/desktopTestModel.js';
import { DesktopWebDriverClient, webDriverBaseUrl } from '../common/runtime/desktopWebDriver.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import type { IPreBaseRuntimeAdapter, PreBaseDesktopLaunchOptions } from '../common/runtime/runtimeAdapter.js';
import type { ProjectProbe } from '../common/runtime/types.js';
import { validatePreviewUrl } from '../common/runtime/permissionClassifier.js';

export const IPreBaseDesktopRuntimeService = createDecorator<IPreBaseDesktopRuntimeService>('prebaseDesktopRuntimeService');

export interface IPreBaseDesktopRuntimeService extends IPreBaseRuntimeAdapter {
	readonly _serviceBrand: undefined;
	readonly onDidChangeSessions: Event<readonly PreBaseDesktopSession[]>;
	getSessions(): readonly PreBaseDesktopSession[];
	getDetectedProfiles(): readonly DesktopProjectProfile[];
	setPreferredFramework(framework: DesktopFramework): void;
	getSessionSummaryForMagnus(sessionId?: string): Record<string, unknown>;
	startForMagnus(input?: { framework?: DesktopFramework; mode?: string; rendererUrl?: string; testing?: boolean }): Promise<Record<string, unknown>>;
	cancelActiveAction(): void;
	inspectForMagnus(sessionId?: string, token?: CancellationToken): Promise<Record<string, unknown>>;
	interactForMagnus(input: { sessionId?: string; action: DesktopInteractAction; locator: unknown; value?: string; timeoutMs?: number }, token?: CancellationToken): Promise<Record<string, unknown>>;
	assertForMagnus(input: { sessionId?: string; condition: DesktopAssertCondition; locator?: unknown; expected?: string | number; timeoutMs?: number }, token?: CancellationToken): Promise<Record<string, unknown>>;
	getProcessOutputForMagnus(sessionId?: string): Promise<Record<string, unknown>>;
	evaluateForMagnus(sessionId: string | undefined, expression: string): Promise<Record<string, unknown>>;
	captureScreenshotForMagnus(sessionId?: string): Promise<Record<string, unknown>>;
}

/**
 * Checks that a renderer URL can be reached without allowing the initial URL to
 * redirect the workbench to an unvalidated destination.
 */
export async function probeDesktopRendererUrl(requestService: IRequestService, url: string): Promise<boolean> {
	try {
		const context = await requestService.request({
			type: 'GET',
			url,
			timeout: 2500,
			// The candidate is validated before probing. Following redirects here would
			// let an allowed URL make the workbench request an unvalidated target.
			followRedirects: 0,
			callSite: 'PreBaseDesktopRuntimeService._probeUrl',
		}, CancellationToken.None);
		const status = context.res.statusCode ?? 0;
		return status > 0 && status < 500;
	} catch {
		return false;
	}
}

export class PreBaseDesktopRuntimeService extends Disposable implements IPreBaseDesktopRuntimeService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSession = this._register(new Emitter<PreBaseDesktopSession | undefined>());
	readonly onDidChangeSession = this._onDidChangeSession.event;

	private readonly _onDidChangeSessions = this._register(new Emitter<readonly PreBaseDesktopSession[]>());
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private readonly _main: IPreBaseDesktopMainService;
	private readonly _channel: IChannel;

	private _profile: DesktopProjectProfile | undefined;
	private _session: PreBaseDesktopSession | undefined;
	private _lastRequest: { rendererUrl: string; command?: ExternalLaunchRequest; cwd: string; title: string } | undefined;
	private _launchModeOverride: DesktopLaunchMode | undefined;
	private _preferredFramework: DesktopFramework | undefined;
	private _lastProbe: ProjectProbe | undefined;
	private _detectedProfiles: DesktopProjectProfile[] = [];
	private _testRun: DesktopTestRun | undefined;
	private _testRunToContinue: DesktopTestRun | undefined;
	private _webDriver: DesktopWebDriverClient | undefined;
	private _webDriverSession: { sessionId: string; baseUrl: string } | undefined;
	private _launchCts: CancellationTokenSource | undefined;
	private _actionCts: CancellationTokenSource | undefined;
	private _startTail: Promise<unknown> = Promise.resolve();

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IRequestService private readonly requestService: IRequestService,
		@IDialogService private readonly dialogService: IDialogService,
		@IWorkspaceTrustManagementService private readonly workspaceTrust: IWorkspaceTrustManagementService,
	) {
		super();
		this._channel = mainProcessService.getChannel(PREBASE_DESKTOP_CHANNEL_NAME);
		this._main = ProxyChannel.toService<IPreBaseDesktopMainService>(this._channel);

		this._register(this._main.onDidCloseManagedWindow(({ sessionId }) => {
			if (this._session?.id === sessionId) {
				this._updateSession({ state: 'stopped', ownedByPreBase: false });
			}
		}));
		this._register(this._main.onDidStripAction(({ sessionId, action }) => {
			if (this._session?.id !== sessionId) {
				return;
			}
			if (action === 'reload') {
				void this.reload();
			} else if (action === 'restart') {
				void this.restart();
			} else if (action === 'inspect') {
				void this.inspect();
			} else if (action === 'kill') {
				void this.kill();
			}
		}));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(PreBaseConfigKeys.RuntimeDesktopLaunchMode)) {
				this._launchModeOverride = undefined;
				this._fire();
			}
		}));
	}

	getSessions(): readonly PreBaseDesktopSession[] {
		return this._session ? [this._session] : [];
	}

	detect(probe: ProjectProbe): DesktopProjectProfile {
		this._lastProbe = probe;
		this._detectedProfiles = detectDesktopProjects(probe);
		this._profile = selectDesktopProfile(this._detectedProfiles, this._preferredFramework) ?? detectElectronProject(probe);
		return this._profile;
	}

	getProfile(): DesktopProjectProfile | undefined {
		return this._profile;
	}

	getDetectedProfiles(): readonly DesktopProjectProfile[] {
		return this._detectedProfiles;
	}

	setPreferredFramework(framework: DesktopFramework): void {
		this._preferredFramework = framework;
		if (this._lastProbe) {
			this.detect(this._lastProbe);
		}
	}

	getSession(): PreBaseDesktopSession | undefined {
		return this._session;
	}

	getLaunchMode(): DesktopLaunchMode {
		return this._launchModeOverride
			?? this.configurationService.getValue<DesktopLaunchMode>(PreBaseConfigKeys.RuntimeDesktopLaunchMode)
			?? 'managed';
	}

	async setLaunchMode(mode: DesktopLaunchMode, remember?: boolean): Promise<void> {
		const shouldRemember = remember ?? this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeRememberDesktopLaunchMode) ?? true;
		if (shouldRemember) {
			await this.configurationService.updateValue(PreBaseConfigKeys.RuntimeDesktopLaunchMode, mode);
			this._launchModeOverride = undefined;
		} else {
			this._launchModeOverride = mode;
		}
		this._fire();
	}

	async start(options: PreBaseDesktopLaunchOptions = {}): Promise<PreBaseDesktopSession | undefined> {
		const queued = this._startTail.then(() => this._doStart(options));
		this._startTail = queued.then(() => undefined, () => undefined);
		return queued;
	}

	private async _doStart(options: PreBaseDesktopLaunchOptions = {}): Promise<PreBaseDesktopSession | undefined> {
		if (options.framework) {
			this.setPreferredFramework(options.framework);
		}
		const profile = this._profile;
		if (!isRecognizedDesktopApp(profile)) {
			await this.dialogService.info(
				localize('prebase.desktop.notDesktop', "Not an Electron or Tauri project"),
				localize('prebase.desktop.notDesktopDetail', "PreBase did not detect an Electron or Tauri app in this workspace.")
			);
			return undefined;
		}

		if (!this.workspaceTrust.isWorkspaceTrusted()) {
			await this.dialogService.info(
				localize('prebase.desktop.untrusted', "Workspace Restricted"),
				localize('prebase.desktop.untrustedDetail', "Desktop testing executes project code and is unavailable in Restricted Mode.")
			);
			return undefined;
		}

		const launchMode = options.launchMode ?? this.getLaunchMode();
		const workspaceRoot = profile.appRoot ?? this.workspaceService.getWorkspace().folders[0]?.uri.fsPath;
		if (!workspaceRoot) {
			await this.dialogService.info(localize('prebase.desktop.noWorkspace', "No workspace"), localize('prebase.desktop.noWorkspaceDetail', "Open a workspace folder before launching a desktop app."));
			return undefined;
		}

		if (this._session && this._session.state !== 'stopped' && this._session.state !== 'idle' && this._session.state !== 'setupRequired') {
			await this.stop();
		}

		const purpose = options.purpose ?? (options.testing ? 'test' : 'preview');
		const wantsNativeAutomation = purpose === 'test' && launchMode === 'external';
		if (isTauriProfile(profile) && wantsNativeAutomation && profile.capabilities.fullNativeSetupRequired) {
			this._testRun = undefined;
			this._testRunToContinue = undefined;
			this._session = {
				id: generateUuid(),
				workspaceRoot,
				launchMode,
				state: 'setupRequired',
				profile,
				purpose,
				automationBackend: 'none',
				cdpTargets: [],
				ownedByPreBase: false,
				startedAt: Date.now(),
				errorMessage: profile.capabilities.fullNativeSetupReason,
			};
			this._fire();
			return this._session;
		}

		const rendererUrl = await this._resolveRendererUrl(options.rendererUrl ?? profile.rendererUrlHint);
		if (launchMode === 'managed' && !rendererUrl) {
			await this.dialogService.info(
				localize('prebase.desktop.noRenderer', "Renderer URL required"),
				localize('prebase.desktop.noRendererDetail', "Start the renderer dev server or provide a reachable local URL before launching.")
			);
			return undefined;
		}

		const tauriWebDriver = isTauriProfile(profile) && wantsNativeAutomation && profile.hasWdioWebdriverPlugin;
		const sessionId = generateUuid();
		const title = this.workspaceService.getWorkspace().folders[0]?.name || profile.label;
		const automationBackend = tauriWebDriver ? 'webdriver' : (isTauriProfile(profile) && launchMode === 'external' ? 'none' : 'cdp');
		this._session = {
			id: sessionId,
			workspaceRoot,
			launchMode,
			state: 'starting',
			profile,
			purpose,
			automationBackend,
			rendererUrl,
			cdpTargets: [],
			ownedByPreBase: true,
			startedAt: Date.now(),
		};
		this._testRun = purpose === 'test' ? this._testRunToContinue : undefined;
		this._testRunToContinue = undefined;
		if (purpose === 'test') {
			if (this._testRun) {
				this._testRun.endedAt = undefined;
				this._testRun.cleanup = undefined;
			} else {
				this._testRun = createDesktopTestRun({
					id: sessionId,
					framework: profile.framework,
					mode: desktopUiModeFromLaunch(launchMode),
					backend: this._session.automationBackend,
					workspaceRoot,
				});
			}
			this._session.testRunId = this._testRun.id;
		}
		this._lastRequest = { rendererUrl: rendererUrl ?? '', command: options.command, cwd: workspaceRoot, title };
		this._fire();

		const launchToken = this._beginLaunch();
		try {
			if (launchMode === 'managed') {
				if (!profile.capabilities.supportsManagedLaunch) {
					const blockers = profile.capabilities.managedLaunchBlockers.join('\n');
					await this.dialogService.info(
						localize('prebase.desktop.managedUnsupported', "Managed launch unavailable"),
						blockers || localize('prebase.desktop.managedUnsupportedDetail', "This Electron project cannot be opened through PreBase managed windows yet.")
					);
					this._updateSession({ state: 'error', errorMessage: blockers || 'Managed launch unsupported' });
					return this._session;
				}
				const showBar = this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeManagedApplicationBar) ?? true;
				const managed = await this._main.openManagedWindow({
					sessionId,
					workspaceRoot,
					launchMode,
					rendererUrl: rendererUrl!,
					title,
					showManagementBar: showBar,
					purpose,
				});
				this._updateSession({
					state: purpose === 'test' ? 'testing' : 'running',
					managedWindowId: managed.windowId,
					errorMessage: undefined,
				});
			} else {
				if (!profile.capabilities.supportsExternalLaunch) {
					await this.dialogService.info(
						localize('prebase.desktop.externalUnsupported', "External launch unavailable"),
						localize('prebase.desktop.externalUnsupportedDetail', "No Electron start script or main entry was detected.")
					);
					this._updateSession({ state: 'error', errorMessage: 'External launch unsupported' });
					return this._session;
				}
				const command = options.command ?? this._buildExternalCommand(profile, tauriWebDriver);
				this._lastRequest = { ...this._lastRequest!, command };
				if (isTauriProfile(profile)) {
					const spawned = await this._main.spawnExternal(command, tauriLaunchCwd(workspaceRoot, profile.cargoTomlPath), 0, {}, { purpose, electronCdp: false, webDriver: tauriWebDriver });
					this._updateSession({ pid: spawned.pid, webDriverPort: spawned.webDriverPort });
					if (tauriWebDriver) {
						if (!spawned.webDriverPort) {
							throw new Error('Tauri process did not receive a loopback WebDriver port.');
						}
						this._webDriver = new DesktopWebDriverClient(webDriverBaseUrl(spawned.webDriverPort));
						await this._webDriver.waitUntilReady(DEFAULT_TAURI_STARTUP_TIMEOUT_MS, launchToken);
						this._webDriverSession = await this._webDriver.newSession(launchToken);
					}
					this._updateSession({
						state: purpose === 'test' ? 'testing' : 'running',
						errorMessage: undefined,
					});
				} else {
					const spawned = await this._main.spawnExternal(command, workspaceRoot, 0, {}, { purpose, electronCdp: true });
					const debugPort = spawned.debugPort;
					this._updateSession({ pid: spawned.pid, debugPort });
					if (!debugPort) {
						throw new Error('External Electron process did not receive a localhost debugging port.');
					}
					const targets = await this._discoverCdpTargets(debugPort);
					if (!targets.length) {
						throw new Error('External Electron application started without an inspectable CDP target. Verify that its launch script accepts --remote-debugging-port.');
					}
					this._updateSession({
						state: purpose === 'test' ? 'testing' : 'running',
						cdpTargets: targets,
						errorMessage: undefined,
					});
				}
			}
		} catch (err) {
			const cancelled = launchToken.isCancellationRequested || this._session?.state === 'stopping' || this._session?.state === 'stopped';
			const pid = this._session?.pid;
			await this._disposeAutomation();
			if (pid) {
				try {
					await this._main.killOwnedProcess(pid);
				} catch {
					// process may already have exited
				}
			}
			if (cancelled) {
				this._updateSession({ state: 'stopped', pid: undefined, debugPort: undefined, webDriverPort: undefined });
				return this._session;
			}
			const message = err instanceof Error ? err.message : String(err);
			this._updateSession({ state: 'error', errorMessage: message, pid: undefined, debugPort: undefined, webDriverPort: undefined });
		} finally {
			if (this._session?.state !== 'starting') {
				this._launchCts?.dispose();
				this._launchCts = undefined;
			}
		}
		return this._session;
	}

	async startForMagnus(input: { framework?: DesktopFramework; mode?: string; rendererUrl?: string; testing?: boolean } = {}): Promise<Record<string, unknown>> {
		if (!this.workspaceTrust.isWorkspaceTrusted()) {
			return { ok: false, reason: 'Desktop testing executes project code and is unavailable in Restricted Mode.', workspaceTrust: false };
		}
		const launchMode = input.mode === 'fullApp' || input.mode === 'external'
			? 'external'
			: input.mode === 'renderer' || input.mode === 'managed'
				? 'managed'
				: undefined;
		const session = await this.start({
			launchMode,
			rendererUrl: input.rendererUrl,
			testing: true,
			framework: input.framework,
			purpose: 'test',
		});
		if (!session) {
			return { ok: false, reason: 'Desktop session did not start.' };
		}
		return this.getSessionSummaryForMagnus(session.id);
	}

	cancelActiveAction(): void {
		this._actionCts?.cancel();
		this._launchCts?.cancel();
	}

	async stop(): Promise<void> {
		if (!this._session) {
			return;
		}
		this._cancelLaunch();
		this.cancelActiveAction();
		this._updateSession({ state: 'stopping' });
		await this._disposeAutomation();
		if (this._session.launchMode === 'managed') {
			await this._main.closeManagedWindow(this._session.id);
		} else if (this._session.pid) {
			await this._main.killOwnedProcess(this._session.pid);
		}
		if (this._testRun) {
			this._testRun.endedAt = Date.now();
			this._testRun.cleanup = 'clean';
		}
		this._updateSession({ state: 'stopped', pid: undefined, managedWindowId: undefined, cdpTargets: [], webDriverPort: undefined });
	}

	async restart(): Promise<void> {
		const mode = this._session?.launchMode ?? this.getLaunchMode();
		const purpose = this._session?.purpose ?? 'preview';
		const framework = this._session?.profile.framework;
		const startedAt = Date.now();
		if (mode === 'managed' && this._session && this._lastRequest) {
			const showBar = this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeManagedApplicationBar) ?? true;
			const rendererUrl = this._session.rendererUrl ?? this._lastRequest.rendererUrl;
			try {
				this._updateSession({ state: 'starting', errorMessage: undefined });
				const managed = await this._main.restartManagedWindow(this._session.id, {
					sessionId: this._session.id,
					workspaceRoot: this._session.workspaceRoot,
					launchMode: 'managed',
					rendererUrl,
					title: this._lastRequest.title,
					showManagementBar: showBar,
					purpose: this._session.purpose,
				});
				this._lastRequest = { ...this._lastRequest, rendererUrl };
				this._updateSession({
					state: purpose === 'test' ? 'testing' : 'running',
					rendererUrl,
					managedWindowId: managed.windowId,
					testRunId: this._testRun?.id,
					errorMessage: undefined,
				});
				this._recordStep({ kind: 'restart', action: 'restart', startedAt, durationMs: Date.now() - startedAt, ok: true });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this._updateSession({ state: 'error', errorMessage: message });
				this._recordStep({ kind: 'restart', action: 'restart', startedAt, durationMs: Date.now() - startedAt, ok: false, failure: message });
			}
			return;
		}

		const rendererUrl = this._session?.rendererUrl ?? this._lastRequest?.rendererUrl;
		const command = this._lastRequest?.command;
		const continuedTestRun = purpose === 'test' ? this._testRun : undefined;
		await this.stop();
		this._testRunToContinue = continuedTestRun;
		let restarted: PreBaseDesktopSession | undefined;
		try {
			restarted = await this.start({ launchMode: mode, rendererUrl, command, purpose, framework, testing: purpose === 'test' });
		} finally {
			this._testRunToContinue = undefined;
		}
		const ok = restarted?.state === (purpose === 'test' ? 'testing' : 'running');
		this._recordStep({
			kind: 'restart',
			action: 'restart',
			startedAt,
			durationMs: Date.now() - startedAt,
			ok,
			failure: ok ? undefined : restarted?.errorMessage ?? 'Desktop session did not restart.',
		});
	}

	async reload(): Promise<boolean> {
		if (!this._session || this._session.launchMode !== 'managed') {
			return false;
		}
		await this._main.reloadManagedWindow(this._session.id);
		return true;
	}

	async inspect(): Promise<void> {
		if (!this._session) {
			return;
		}
		if (this._session.launchMode === 'managed') {
			await this._main.inspectManagedWindow(this._session.id);
			return;
		}
		if (this._session.debugPort) {
			const targets = await this._discoverCdpTargets(this._session.debugPort);
			this._updateSession({ cdpTargets: targets });
		}
	}

	async kill(): Promise<void> {
		const confirm = this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeConfirmApplicationTermination) ?? true;
		if (confirm) {
			const result = await this.dialogService.confirm({
				message: localize('prebase.desktop.killConfirm', "Stop desktop application?"),
				detail: localize('prebase.desktop.killConfirmDetail', "PreBase will close the application it launched for this session."),
				primaryButton: localize('prebase.desktop.killConfirmBtn', "Stop")
			});
			if (!result.confirmed) {
				return;
			}
		}
		await this.stop();
	}

	getSessionSummaryForMagnus(sessionId?: string): Record<string, unknown> {
		const session = this._resolveSession(sessionId);
		if (!session) {
			return { ok: false, reason: 'No owned desktop session.' };
		}
		return {
			ok: true,
			sessionId: session.id,
			framework: session.profile.framework,
			mode: desktopUiModeFromLaunch(session.launchMode),
			state: session.state,
			purpose: session.purpose,
			backend: session.automationBackend,
			ownedByPreBase: session.ownedByPreBase,
			setupRequired: session.state === 'setupRequired',
			rendererUrl: session.rendererUrl,
			limitations: session.profile.capabilities.limitations,
			errorMessage: session.errorMessage,
			test: this._testRun ? summarizeDesktopTestRun(this._testRun) : undefined,
		};
	}

	async inspectForMagnus(sessionId?: string, token: CancellationToken = CancellationToken.None): Promise<Record<string, unknown>> {
		const session = this._resolveSession(sessionId);
		if (!session) {
			return { ok: false, reason: 'No owned desktop session.' };
		}
		if (session.state === 'setupRequired' || session.automationBackend === 'none') {
			return { ok: false, setupRequired: session.state === 'setupRequired' || session.profile.capabilities.fullNativeSetupRequired, reason: session.errorMessage ?? 'Full-app automation is not connected. Use Renderer mode, or Enable PreBase Tauri Testing for native WebDriver.', rendererAvailable: session.profile.capabilities.supportsRendererAutomation };
		}
		if (!this._automationAllowed(session)) {
			return { ok: false, reason: 'Desktop automation is disabled in settings.' };
		}
		try {
			const started = Date.now();
			const snapshot = await runDesktopDomCommand(this._pageEvaluate(session), { op: 'snapshot' }, this._linkedActionToken(token));
			this._recordStep({ kind: 'inspect', action: 'snapshot', startedAt: started, durationMs: Date.now() - started, ok: snapshot.ok, failure: snapshot.ok ? undefined : snapshot.code });
			const windows = session.cdpTargets.length || (session.managedWindowId ? 1 : 0) || (session.webDriverPort ? 1 : 0);
			return {
				ok: snapshot.ok,
				framework: session.profile.framework,
				mode: desktopUiModeFromLaunch(session.launchMode),
				backend: session.automationBackend,
				title: snapshot.title,
				url: snapshot.url,
				windowCount: windows,
				windows: session.cdpTargets.map(target => ({ id: target.id, title: target.title, url: target.url, type: target.type })),
				visibleText: snapshot.visibleText ? redactSecretText(snapshot.visibleText) : snapshot.visibleText,
				interactive: snapshot.interactive,
				console: (snapshot.console ?? []).map(entry => ({ ...entry, text: redactSecretText(entry.text) })),
				limitations: session.profile.capabilities.limitations,
				unsupported: ['native file picker', 'system menu bar', 'OS permission dialogs', 'native window controls'],
			};
		} catch (err) {
			return { ok: false, reason: err instanceof Error ? err.message : String(err) };
		}
	}

	async interactForMagnus(input: { sessionId?: string; action: DesktopInteractAction; locator: unknown; value?: string; timeoutMs?: number }, token: CancellationToken = CancellationToken.None): Promise<Record<string, unknown>> {
		const session = this._resolveSession(input.sessionId);
		if (!session) {
			return { ok: false, reason: 'No owned desktop session.' };
		}
		if (!this._automationAllowed(session)) {
			return { ok: false, reason: 'Desktop automation is disabled in settings.' };
		}
		if (session.automationBackend === 'none') {
			return { ok: false, reason: 'This desktop session has no automation backend. Start a test session in Renderer mode, or Enable PreBase Tauri Testing for full-app automation.' };
		}
		const locator = parseDesktopLocator(input.locator);
		if ('error' in locator) {
			return { ok: false, reason: locator.error };
		}
		if (input.action === 'press') {
			const keyError = validatePressKey(String(input.value ?? ''));
			if (keyError) {
				return { ok: false, reason: keyError };
			}
		}
		const started = Date.now();
		try {
			this._updateSession({ state: session.purpose === 'test' ? 'testing' : session.state });
			const result = await interactDesktop(this._pageEvaluate(session), input.action, locator, input.value, input.timeoutMs, this._linkedActionToken(token));
			const duration = Date.now() - started;
			const failure = result.ok ? undefined : formatDesktopFailure(result, locator);
			this._recordStep({ kind: 'interact', action: input.action, locator, resolvedTarget: input.value, startedAt: started, durationMs: duration, ok: result.ok, failure });
			if (!result.ok) {
				return { ok: false, action: input.action, locator: describeLocator(locator), reason: failure, matchCount: result.count, matches: result.matches, title: result.title, url: result.url, console: result.console, duration, framework: session.profile.framework, backend: session.automationBackend };
			}
			return { ok: true, action: input.action, locator: describeLocator(locator), match: result.match, title: result.title, url: result.url, duration, framework: session.profile.framework, backend: session.automationBackend };
		} catch (err) {
			return { ok: false, reason: err instanceof Error ? err.message : String(err) };
		}
	}

	async assertForMagnus(input: { sessionId?: string; condition: DesktopAssertCondition; locator?: unknown; expected?: string | number; timeoutMs?: number }, token: CancellationToken = CancellationToken.None): Promise<Record<string, unknown>> {
		const session = this._resolveSession(input.sessionId);
		if (!session) {
			return { ok: false, reason: 'No owned desktop session.' };
		}
		if (!this._automationAllowed(session)) {
			return { ok: false, reason: 'Desktop automation is disabled in settings.' };
		}
		if (session.automationBackend === 'none') {
			return { ok: false, reason: 'This desktop session has no automation backend. Start a test session in Renderer mode, or Enable PreBase Tauri Testing for full-app automation.' };
		}
		const locator = input.locator ? parseDesktopLocator(input.locator) : undefined;
		if (locator && 'error' in locator) {
			return { ok: false, reason: locator.error };
		}
		const started = Date.now();
		try {
			const asserted = await assertDesktop(this._pageEvaluate(session), input.condition, locator && !('error' in locator) ? locator : undefined, input.expected, input.timeoutMs, this._linkedActionToken(token));
			this._recordStep({ kind: 'assert', action: input.condition, locator: locator && !('error' in locator) ? locator : undefined, startedAt: started, durationMs: asserted.duration, ok: asserted.ok, failure: asserted.ok ? undefined : formatDesktopFailure(asserted.result, locator && !('error' in locator) ? locator : undefined) });
			if (!asserted.ok) {
				const console = asserted.result.console?.map(entry => ({ ...entry, text: redactSecretText(entry.text) }));
				return { ok: false, condition: input.condition, actual: asserted.actual, expected: asserted.expected, duration: asserted.duration, console, framework: session.profile.framework, backend: session.automationBackend, title: asserted.result.title, url: asserted.result.url };
			}
			return { ok: true, condition: input.condition, actual: asserted.actual, expected: asserted.expected, duration: asserted.duration, framework: session.profile.framework, backend: session.automationBackend };
		} catch (err) {
			return { ok: false, reason: err instanceof Error ? err.message : String(err) };
		}
	}

	async getProcessOutputForMagnus(sessionId?: string): Promise<Record<string, unknown>> {
		const session = this._resolveSession(sessionId);
		if (!session) {
			return { ok: false, reason: 'No owned desktop session.' };
		}
		if (session.launchMode !== 'external' || !session.pid) {
			return { ok: false, reason: 'Process output is available only for PreBase-owned external desktop sessions.' };
		}
		const output = await this._main.getOwnedProcessOutput(session.pid, 10);
		return {
			ok: true,
			pid: session.pid,
			entries: output.entries,
			truncated: output.truncated,
			droppedCount: output.droppedCount,
			limitation: 'Output is bounded and redacted in the Electron main process.',
		};
	}

	async evaluateForMagnus(sessionId: string | undefined, expression: string): Promise<Record<string, unknown>> {
		const session = this._resolveSession(sessionId);
		if (!session) {
			return { ok: false, reason: 'No owned desktop session.' };
		}
		if (session.automationBackend === 'webdriver') {
			return { ok: false, reason: 'Arbitrary JavaScript evaluation is not available for Tauri WebDriver sessions. Use interact or assert.' };
		}
		if (!(this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeEnableDesktopAutomation) ?? false)) {
			return { ok: false, reason: 'Desktop automation is disabled in settings.' };
		}
		try {
			if (session.launchMode === 'managed') {
				const value = await this._main.evaluateInManagedWindow(session.id, expression);
				return { ok: true, value, limitations: session.profile.capabilities.limitations };
			}
			if (!session.debugPort) {
				return { ok: false, reason: 'External session has no debugging endpoint.' };
			}
			const value = await this._main.evaluateViaCdp(session.debugPort, expression);
			return { ok: true, value, limitations: session.profile.capabilities.limitations };
		} catch (err) {
			return { ok: false, reason: err instanceof Error ? err.message : String(err) };
		}
	}

	async captureScreenshotForMagnus(sessionId?: string): Promise<Record<string, unknown>> {
		const session = this._resolveSession(sessionId);
		if (!session) {
			return { ok: false, reason: 'No owned desktop session.' };
		}
		try {
			if (session.launchMode === 'managed') {
				const pngBase64 = await this._main.captureManagedScreenshot(session.id);
				return { ok: true, mimeType: 'image/png', pngBase64, scope: 'application-content-only', framework: session.profile.framework, mode: desktopUiModeFromLaunch(session.launchMode), timestamp: Date.now() };
			}
			if (session.webDriverPort && this._webDriver && this._webDriverSession) {
				const pngBase64 = await this._webDriver.screenshot(this._webDriverSession);
				return { ok: true, mimeType: 'image/png', pngBase64, scope: 'tauri-webview', framework: 'tauri', mode: desktopUiModeFromLaunch(session.launchMode), timestamp: Date.now() };
			}
			if (!session.debugPort) {
				return { ok: false, reason: 'External session has no owned debugging endpoint.' };
			}
			const pngBase64 = await this._main.captureScreenshotViaCdp(session.debugPort);
			return { ok: true, mimeType: 'image/png', pngBase64, scope: 'external-renderer-page-only', limitations: session.profile.capabilities.limitations };
		} catch (err) {
			return { ok: false, reason: err instanceof Error ? err.message : String(err) };
		}
	}

	private _resolveSession(sessionId?: string): PreBaseDesktopSession | undefined {
		if (!this._session) {
			return undefined;
		}
		if (sessionId && this._session.id !== sessionId) {
			return undefined;
		}
		return this._session;
	}

	override dispose(): void {
		this._cancelLaunch();
		this.cancelActiveAction();
		this._actionCts?.dispose();
		void this._disposeAutomation();
		const stopManaged = this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeStopManagedAppsOnExit) ?? true;
		const stopExternal = this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeStopExternalAppsOnExit) ?? false;
		if (this._session?.ownedByPreBase) {
			const testOwned = this._session.purpose === 'test';
			if (this._session.launchMode === 'managed' && (stopManaged || testOwned)) {
				void this._main.closeManagedWindow(this._session.id);
			}
			if (this._session.launchMode === 'external' && this._session.pid && (stopExternal || testOwned)) {
				void this._main.killOwnedProcess(this._session.pid);
			}
		}
		super.dispose();
	}

	private _buildExternalCommand(profile: DesktopProjectProfile, enableTauriTestingFeature = false): ExternalLaunchRequest {
		if (isTauriProfile(profile)) {
			return buildTauriExternalLaunchRequest(profile.tauriScriptName, enableTauriTestingFeature && profile.testingCargoFeature, profile.packageManager);
		}
		if (isElectronProfile(profile)) {
			if (profile.electronScriptName) {
				return buildPackageScriptExternalLaunchRequest(profile.packageManager, profile.electronScriptName);
			}
			if (profile.paths.main) {
				return buildElectronExternalLaunchRequest(profile.paths.main);
			}
		}
		throw new Error('Desktop project has no launch script or main entry.');
	}

	private _automationAllowed(session: PreBaseDesktopSession): boolean {
		return session.purpose === 'test' || (this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeEnableDesktopAutomation) ?? false);
	}

	private _beginLaunch(): CancellationToken {
		this._cancelLaunch();
		this._launchCts = new CancellationTokenSource();
		return this._launchCts.token;
	}

	private _cancelLaunch(): void {
		this._launchCts?.cancel();
		this._launchCts?.dispose();
		this._launchCts = undefined;
	}

	private _linkedActionToken(external: CancellationToken): CancellationToken {
		this._actionCts?.dispose(true);
		this._actionCts = new CancellationTokenSource();
		if (external !== CancellationToken.None) {
			const sub = external.onCancellationRequested(() => this._actionCts?.cancel());
			this._actionCts.token.onCancellationRequested(() => sub.dispose());
		}
		return this._actionCts.token;
	}

	private _pageEvaluate(session: PreBaseDesktopSession): DesktopEvaluateFn {
		return async (expression, token) => {
			if (token?.isCancellationRequested) {
				throw new Error('Cancelled');
			}
			if (session.launchMode === 'managed') {
				return this._main.evaluateInManagedWindow(session.id, expression);
			}
			if (session.webDriverPort && this._webDriver && this._webDriverSession) {
				return this._webDriver.execute(this._webDriverSession, `return (${expression});`, token);
			}
			if (!session.debugPort) {
				throw new Error('Session has no renderer evaluation endpoint.');
			}
			return this._main.evaluateViaCdp(session.debugPort, expression);
		};
	}

	private async _disposeAutomation(): Promise<void> {
		if (this._webDriver && this._webDriverSession) {
			try {
				await this._webDriver.deleteSession(this._webDriverSession);
			} catch {
				// session may already be gone with the app
			}
		}
		this._webDriver = undefined;
		this._webDriverSession = undefined;
	}

	private _recordStep(step: Parameters<typeof recordDesktopTestStep>[1]): void {
		if (this._testRun) {
			recordDesktopTestStep(this._testRun, step);
		}
	}

	private async _resolveRendererUrl(candidate?: string): Promise<string | undefined> {
		if (!candidate) {
			return undefined;
		}
		const validated = validatePreviewUrl(candidate);
		if (!validated.ok) {
			return undefined;
		}
		if (await this._probeUrl(validated.url)) {
			return validated.url;
		}
		return validated.isLocal ? validated.url : undefined;
	}

	private async _probeUrl(url: string): Promise<boolean> {
		return probeDesktopRendererUrl(this.requestService, url);
	}

	private async _discoverCdpTargets(port: number): Promise<CdpTarget[]> {
		const token = this._launchCts?.token ?? CancellationToken.None;
		const deadline = Date.now() + DEFAULT_ELECTRON_STARTUP_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (token.isCancellationRequested) {
				return [];
			}
			try {
				const context = await this.requestService.request({
					type: 'GET',
					url: `http://127.0.0.1:${port}/json`,
					timeout: 1500,
					callSite: 'PreBaseDesktopRuntimeService._discoverCdpTargets',
				}, token);
				const body = await asJson<CdpTarget[]>(context);
				if (Array.isArray(body) && body.length) {
					return body;
				}
			} catch {
				// retry while Electron boots
			}
			if (token.isCancellationRequested) {
				return [];
			}
			await new Promise<void>(resolve => {
				const timer = setTimeout(() => {
					sub.dispose();
					resolve();
				}, 500);
				const sub = token.onCancellationRequested(() => {
					clearTimeout(timer);
					resolve();
				});
			});
		}
		return [];
	}

	private _updateSession(patch: Partial<PreBaseDesktopSession>): void {
		if (!this._session) {
			return;
		}
		this._session = { ...this._session, ...patch };
		this._fire();
	}

	private _fire(): void {
		this._onDidChangeSession.fire(this._session);
		this._onDidChangeSessions.fire(this.getSessions());
	}
}

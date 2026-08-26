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
import type { CdpTarget, DesktopLaunchMode, ElectronProjectProfile, ExternalLaunchRequest, PreBaseDesktopSession } from '../common/runtime/desktopTypes.js';
import { detectElectronProject } from '../common/runtime/electronDetector.js';
import { buildElectronExternalLaunchRequest, buildNpmExternalLaunchRequest } from '../common/runtime/externalLaunchCommand.js';
import type { IPreBaseRuntimeAdapter, PreBaseDesktopLaunchOptions } from '../common/runtime/runtimeAdapter.js';
import type { ProjectProbe } from '../common/runtime/types.js';
import { validatePreviewUrl } from '../common/runtime/permissionClassifier.js';

export const IPreBaseDesktopRuntimeService = createDecorator<IPreBaseDesktopRuntimeService>('prebaseDesktopRuntimeService');

export interface IPreBaseDesktopRuntimeService extends IPreBaseRuntimeAdapter {
	readonly _serviceBrand: undefined;
	readonly onDidChangeSessions: Event<readonly PreBaseDesktopSession[]>;
	getSessions(): readonly PreBaseDesktopSession[];
	getSessionSummaryForMagnus(sessionId?: string): Record<string, unknown>;
	inspectForMagnus(sessionId?: string): Promise<Record<string, unknown>>;
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

	private _profile: ElectronProjectProfile | undefined;
	private _session: PreBaseDesktopSession | undefined;
	private _lastRequest: { rendererUrl: string; command?: ExternalLaunchRequest; cwd: string; title: string } | undefined;
	private _launchModeOverride: DesktopLaunchMode | undefined;
	private readonly _lifecycleCts = this._register(new CancellationTokenSource());

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IRequestService private readonly requestService: IRequestService,
		@IDialogService private readonly dialogService: IDialogService,
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

	detect(probe: ProjectProbe): ElectronProjectProfile {
		this._profile = detectElectronProject(probe);
		return this._profile;
	}

	getProfile(): ElectronProjectProfile | undefined {
		return this._profile;
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
		const profile = this._profile;
		if (!profile?.isElectron) {
			await this.dialogService.info(
				localize('prebase.desktop.notElectron', "Not an Electron project"),
				localize('prebase.desktop.notElectronDetail', "PreBase did not detect a direct Electron dependency or start script in this workspace.")
			);
			return undefined;
		}

		const launchMode = options.launchMode ?? this.getLaunchMode();
		const workspaceRoot = this.workspaceService.getWorkspace().folders[0]?.uri.fsPath;
		if (!workspaceRoot) {
			await this.dialogService.info(localize('prebase.desktop.noWorkspace', "No workspace"), localize('prebase.desktop.noWorkspaceDetail', "Open a workspace folder before launching a desktop app."));
			return undefined;
		}

		const rendererUrl = await this._resolveRendererUrl(options.rendererUrl ?? profile.rendererUrlHint);
		if (!rendererUrl) {
			await this.dialogService.info(
				localize('prebase.desktop.noRenderer', "Renderer URL required"),
				localize('prebase.desktop.noRendererDetail', "Start the renderer dev server or provide a reachable local URL before launching.")
			);
			return undefined;
		}

		const sessionId = generateUuid();
		const title = this.workspaceService.getWorkspace().folders[0]?.name || 'Electron App';
		this._session = {
			id: sessionId,
			workspaceRoot,
			launchMode,
			state: 'starting',
			profile,
			rendererUrl,
			cdpTargets: [],
			ownedByPreBase: true,
			startedAt: Date.now(),
		};
		this._lastRequest = { rendererUrl, command: options.command, cwd: workspaceRoot, title };
		this._fire();

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
					rendererUrl,
					title,
					showManagementBar: showBar,
				});
				this._updateSession({
					state: 'running',
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
				const command = options.command ?? this._buildExternalCommand(profile);
				// Main process allocates an ephemeral localhost CDP port when debugPort is 0.
				const spawned = await this._main.spawnExternal(command, workspaceRoot, 0);
				const debugPort = spawned.debugPort;
				if (!debugPort) {
					throw new Error('External Electron process did not receive a localhost debugging port.');
				}
				const targets = await this._discoverCdpTargets(debugPort);
				if (!targets.length) {
					throw new Error('External Electron application started without an inspectable CDP target. Verify that its launch script accepts --remote-debugging-port.');
				}
				this._updateSession({
					state: 'running',
					debugPort,
					pid: spawned.pid,
					cdpTargets: targets,
					errorMessage: undefined,
				});
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._updateSession({ state: 'error', errorMessage: message });
		}
		return this._session;
	}

	async stop(): Promise<void> {
		if (!this._session) {
			return;
		}
		this._updateSession({ state: 'stopping' });
		if (this._session.launchMode === 'managed') {
			await this._main.closeManagedWindow(this._session.id);
		} else if (this._session.pid) {
			await this._main.killOwnedProcess(this._session.pid);
		}
		this._updateSession({ state: 'stopped', pid: undefined, managedWindowId: undefined, cdpTargets: [] });
	}

	async restart(): Promise<void> {
		const mode = this._session?.launchMode ?? this.getLaunchMode();
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
				});
				this._lastRequest = { ...this._lastRequest, rendererUrl };
				this._updateSession({
					state: 'running',
					rendererUrl,
					managedWindowId: managed.windowId,
					errorMessage: undefined,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this._updateSession({ state: 'error', errorMessage: message });
			}
			return;
		}

		const rendererUrl = this._session?.rendererUrl ?? this._lastRequest?.rendererUrl;
		const command = this._lastRequest?.command;
		await this.stop();
		await this.start({ launchMode: mode, rendererUrl, command });
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
			launchMode: session.launchMode,
			state: session.state,
			pid: session.pid,
			debugPort: session.debugPort,
			rendererUrl: session.rendererUrl,
			managedWindowId: session.managedWindowId,
			ownedByPreBase: session.ownedByPreBase,
			cdpTargetCount: session.cdpTargets.length,
			capabilities: session.profile.capabilities,
			limitations: session.profile.capabilities.limitations,
			errorMessage: session.errorMessage,
		};
	}

	async inspectForMagnus(sessionId?: string): Promise<Record<string, unknown>> {
		const session = this._resolveSession(sessionId);
		if (!session) {
			return { ok: false, reason: 'No owned desktop session.' };
		}
		if (!(this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeEnableDesktopAutomation) ?? false)) {
			return { ok: false, reason: 'Desktop automation is disabled in settings.' };
		}
		try {
			if (session.launchMode === 'managed') {
				const outline = await this._main.evaluateInManagedWindow(session.id, `(() => ({
					title: document.title,
					url: location.href,
					visibleText: (document.body?.innerText || '').slice(0, 4000),
					buttons: Array.from(document.querySelectorAll('button,[role="button"],a')).slice(0, 40).map(el => ({
						tag: el.tagName.toLowerCase(),
						text: (el.textContent || '').trim().slice(0, 80),
						id: el.id || undefined,
					})),
				}))()`);
				return {
					ok: true,
					launchMode: 'managed',
					outline,
					limitations: session.profile.capabilities.limitations,
					unsupported: ['project main process', 'project preload', 'native IPC bridge'],
				};
			}
			if (!session.debugPort) {
				return { ok: false, reason: 'External session has no debugging endpoint.' };
			}
			const targets = await this._discoverCdpTargets(session.debugPort);
			this._updateSession({ cdpTargets: targets });
			const outline = await this._main.evaluateViaCdp(session.debugPort, `(() => ({
				title: document.title,
				url: location.href,
				visibleText: (document.body?.innerText || '').slice(0, 4000),
				buttons: Array.from(document.querySelectorAll('button,[role="button"],a')).slice(0, 40).map(el => ({
					tag: el.tagName.toLowerCase(),
					text: (el.textContent || '').trim().slice(0, 80),
					id: el.id || undefined,
				})),
			}))()`);
			return {
				ok: true,
				launchMode: 'external',
				targets: targets.map(t => ({ id: t.id, type: t.type, title: t.title, url: t.url })),
				outline,
				limitations: session.profile.capabilities.limitations,
				unsupported: ['native file picker', 'system menu bar', 'OS permission dialogs', 'native window controls'],
			};
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
				return { ok: true, mimeType: 'image/png', pngBase64, scope: 'application-content-only' };
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
		this._lifecycleCts.cancel();
		const stopManaged = this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeStopManagedAppsOnExit) ?? true;
		const stopExternal = this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeStopExternalAppsOnExit) ?? false;
		if (this._session?.ownedByPreBase) {
			if (this._session.launchMode === 'managed' && stopManaged) {
				void this._main.closeManagedWindow(this._session.id);
			}
			if (this._session.launchMode === 'external' && stopExternal && this._session.pid) {
				void this._main.killOwnedProcess(this._session.pid);
			}
		}
		super.dispose();
	}

	private _buildExternalCommand(profile: ElectronProjectProfile): ExternalLaunchRequest {
		if (profile.electronScriptName) {
			return buildNpmExternalLaunchRequest(profile.electronScriptName);
		}
		if (profile.paths.main) {
			return buildElectronExternalLaunchRequest(profile.paths.main);
		}
		throw new Error('Electron project has no launch script or main entry.');
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
		const token = this._lifecycleCts.token;
		for (let attempt = 0; attempt < 20; attempt++) {
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

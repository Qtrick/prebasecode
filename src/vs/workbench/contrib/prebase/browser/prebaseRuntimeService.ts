/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { isWeb } from '../../../../base/common/platform.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { asTextOrError, IRequestService } from '../../../../platform/request/common/request.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IOutputService } from '../../../services/output/common/output.js';
import { ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { latestDevServerUrl } from '../common/runtime/devServerUrlParser.js';
import { detectFramework } from '../common/runtime/frameworkDetector.js';
import { detectElectronProject } from '../common/runtime/electronDetector.js';
import type { DesktopLaunchMode, ElectronProjectProfile } from '../common/runtime/desktopTypes.js';
import { classifyNavigateUrl, classifyTerminalCommand, validatePreviewUrl } from '../common/runtime/permissionClassifier.js';
import { detectDevScripts, selectDefaultScript } from '../common/runtime/scriptDetector.js';
import { managedRendererDevCommand, scriptLaunchesElectronApp } from '../common/runtime/managedRendererCommand.js';
import type { DetectedDevScript, FrameworkProfile, PackageJsonShape, PackageManager, ProjectProbe } from '../common/runtime/types.js';
import { type PreBaseViewportPreset, resolveViewportSize, VIEWPORT_PRESET_SIZES } from '../common/runtime/viewportPresets.js';
import { PREBASE_RUNTIME_CHANNEL_ID, PreBaseConfigKeys } from '../common/prebaseConfiguration.js';
import { PreBaseRuntimeEditorInput } from './runtimeEditorInput.js';
import { IPreBaseDesktopRuntimeService } from './prebaseDesktopRuntimeService.js';

export type { PreBaseViewportPreset };

export interface PreBaseRuntimeViewportState {
	preset: PreBaseViewportPreset;
	width: number;
	height: number;
	zoom: number;
	rotated: boolean;
}

export interface PreBaseRuntimeSession {
	url: string;
	running: boolean;
	serverRunning: boolean;
	previewConnected: boolean;
	viewport: PreBaseRuntimeViewportState;
	consoleCapture: boolean;
	networkCapture: boolean;
	consoleEntries: string[];
	consoleErrorCount: number;
	networkEntries: string[];
	magnusAttached: boolean;
	testSessionActive: boolean;
	testSessionStartedAt: number | null;
	reports: string[];
	detectedUrls: string[];
	framework: FrameworkProfile | null;
	workspaceRoot: string;
	scripts: DetectedDevScript[];
	selectedScriptName: string | undefined;
	packageManager: PackageManager | undefined;
	terminalInstanceId: number | undefined;
	electronProfile: ElectronProjectProfile | null;
	desktopLaunchMode: DesktopLaunchMode;
	desktopSessionActive: boolean;
	desktopSessionState?: string;
	desktopSessionPid?: number;
}

export const IPreBaseRuntimeService = createDecorator<IPreBaseRuntimeService>('prebaseRuntimeService');

export interface IPreBaseRuntimeService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeSession: Event<PreBaseRuntimeSession>;
	readonly onDidRequestNavigation: Event<'back' | 'forward' | 'reload'>;

	getSession(): PreBaseRuntimeSession;
	setUrl(url: string): Promise<boolean>;
	connectUrl(url?: string): Promise<boolean>;
	setViewportPreset(preset: PreBaseViewportPreset): void;
	setViewportSize(width: number, height: number): void;
	setZoom(zoom: number): void;
	rotateViewport(): void;
	selectScript(scriptName: string): void;
	setDesktopLaunchMode(mode: DesktopLaunchMode): Promise<void>;
	detectConfigurations(): Promise<string[]>;
	start(): Promise<void>;
	stop(): Promise<void>;
	restart(): Promise<void>;
	reload(): void;
	goBack(): void;
	goForward(): void;
	openExternal(): Promise<void>;
	copyUrl(): Promise<void>;
	openTerminal(): Promise<void>;
	clearDiagnostics(): void;
	inspect(): void;
	captureScreenshot(): void;
	startTestSession(): void;
	stopTestSession(): void;
	replayTest(): void;
	showReports(): string[];
	attachToMagnus(): void;
	testWithMagnus(): void;
	explainElement(): void;
	getContextSummaryForMagnus(): string;
	getStateForMagnus(): Record<string, unknown>;
	controlServerForMagnus(action: 'start' | 'stop' | 'restart'): Promise<Record<string, unknown>>;
	navigateForMagnus(url: string): Promise<Record<string, unknown>>;
	inspectPageForMagnus(token?: CancellationToken): Promise<Record<string, unknown>>;
	getEvidenceForMagnus(kind: 'console' | 'network', maximumEntries?: number): Record<string, unknown>;
	controlTestForMagnus(action: 'begin' | 'finalize' | 'replay'): Record<string, unknown>;
	openPreviewEditor(): Promise<void>;
	recordConsoleError(message: string): void;
	/** Called by the preview webview after iframe load/error. */
	markPreviewLoaded(url: string, ok: boolean, detail?: string): void;
}

const PROBE_PATHS = [
	'package.json',
	'pnpm-lock.yaml',
	'yarn.lock',
	'bun.lockb',
	'bun.lock',
	'pnpm-workspace.yaml',
	'vite.config.ts',
	'vite.config.js',
	'vite.config.mjs',
	'next.config.js',
	'next.config.mjs',
	'next.config.ts',
	'packages',
	'apps',
	'apps/web',
	'apps/frontend',
	'apps/client',
	'packages/web',
];

function redactRuntimeEvidence(value: string): string {
	return value
		.replace(/\b(authorization|cookie|set-cookie)\b\s*[:=]\s*[^\r\n]*/gi, '$1=[redacted]')
		.replace(/\b(token|access[_-]?token|id[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|secret|password)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1=[redacted]')
		.replace(/([?&](?:token|access_token|id_token|refresh_token|key|code|password|secret)=)[^&#\s]+/gi, '$1[redacted]');
}

function pageOutline(html: string): { title: string | undefined; visibleText: string; elements: Array<Record<string, string | undefined>> } {
	const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
	const visibleText = redactRuntimeEvidence(html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 8_000));
	const elements: Array<Record<string, string | undefined>> = [];
	const matcher = /<(button|a|input|select|textarea|summary|details|label)\b([^>]*)>([\s\S]*?)<\/\1>|<(input|textarea|select)\b([^>]*)\/?>(?!<\/\4>)/gi;
	for (let match = matcher.exec(html); match && elements.length < 100; match = matcher.exec(html)) {
		const tag = (match[1] ?? match[4]).toLowerCase();
		const attributes = match[2] ?? match[5] ?? '';
		const text = redactRuntimeEvidence((match[3] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 300);
		const attribute = (name: string) => {
			const value = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
			return value === undefined ? undefined : redactRuntimeEvidence(value);
		};
		const inputType = attribute('type');
		elements.push({ tag, text: text || undefined, role: attribute('role'), label: attribute('aria-label') ?? attribute('name'), testId: attribute('data-testid'), placeholder: inputType === 'password' ? undefined : attribute('placeholder'), type: inputType });
	}
	return { title: title === undefined ? undefined : redactRuntimeEvidence(title), visibleText, elements };
}

export class PreBaseRuntimeService extends Disposable implements IPreBaseRuntimeService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSession = this._register(new Emitter<PreBaseRuntimeSession>());
	readonly onDidChangeSession = this._onDidChangeSession.event;

	private readonly _onDidRequestNavigation = this._register(new Emitter<'back' | 'forward' | 'reload'>());
	readonly onDidRequestNavigation = this._onDidRequestNavigation.event;

	private _session: PreBaseRuntimeSession;
	private _devTerminal: ITerminalInstance | undefined;
	/** Terminal opened by "Open Terminal" with no dev server running. */
	private _idleTerminal: ITerminalInstance | undefined;
	private readonly _terminalListeners = this._register(new MutableDisposable<DisposableStore>());
	private _terminalBuffer = '';
	private _urlAutoApplied = false;
	private _workspaceFolderUri: URI | undefined;
	private _startInFlight: Promise<void> | undefined;
	/**
	 * Start can wait up to 45s for a renderer. Without this, a Stop issued in
	 * that window would tear down the terminal and then have a managed Electron
	 * window opened behind it by the start that was still running.
	 */
	private _startCts: CancellationTokenSource | undefined;
	private _detectInFlight: Promise<string[]> | undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@ICommandService private readonly commandService: ICommandService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IOutputService private readonly outputService: IOutputService,
		@IEditorService private readonly editorService: IEditorService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IRequestService private readonly requestService: IRequestService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		const defaultUrl = this.configurationService.getValue<string>(PreBaseConfigKeys.RuntimeDefaultUrl) || 'http://localhost:5173';
		const preset = (this.configurationService.getValue<PreBaseViewportPreset>(PreBaseConfigKeys.RuntimeDefaultViewport) || 'responsive') as PreBaseViewportPreset;
		const size = resolveViewportSize(preset) ?? VIEWPORT_PRESET_SIZES.desktop;
		this._session = {
			url: defaultUrl,
			running: false,
			serverRunning: false,
			previewConnected: false,
			viewport: {
				preset,
				width: size.width,
				height: size.height,
				zoom: 1,
				rotated: false
			},
			consoleCapture: this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeCaptureConsole) ?? true,
			networkCapture: this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeCaptureNetwork) ?? true,
			consoleEntries: [],
			consoleErrorCount: 0,
			networkEntries: [],
			magnusAttached: false,
			testSessionActive: false,
			testSessionStartedAt: null,
			reports: [],
			detectedUrls: [],
			framework: null,
			workspaceRoot: '',
			scripts: [],
			selectedScriptName: undefined,
			packageManager: undefined,
			terminalInstanceId: undefined,
			electronProfile: null,
			desktopLaunchMode: (this.configurationService.getValue<DesktopLaunchMode>(PreBaseConfigKeys.RuntimeDesktopLaunchMode) ?? 'managed'),
			desktopSessionActive: false,
		};

		this._register(this.terminalService.onDidDisposeInstance(instance => {
			if (this._devTerminal && instance.instanceId === this._devTerminal.instanceId) {
				this._detachTerminal(false);
				this._session = { ...this._session, serverRunning: false, running: false, terminalInstanceId: undefined };
				this._log(localize('prebase.runtime.terminalDisposed', "Dev server terminal disposed."));
				this._fire();
			}
		}));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(PreBaseConfigKeys.RuntimeCaptureConsole)) {
				this._session = {
					...this._session,
					consoleCapture: this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeCaptureConsole) ?? true
				};
				this._fire();
			}
			if (e.affectsConfiguration(PreBaseConfigKeys.RuntimeCaptureNetwork)) {
				this._session = {
					...this._session,
					networkCapture: this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeCaptureNetwork) ?? true
				};
				this._fire();
			}
			if (e.affectsConfiguration(PreBaseConfigKeys.RuntimeDesktopLaunchMode)) {
				const mode = this.configurationService.getValue<DesktopLaunchMode>(PreBaseConfigKeys.RuntimeDesktopLaunchMode) ?? 'managed';
				this._session = { ...this._session, desktopLaunchMode: mode };
				this._fire();
			}
		}));

		if (this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeAutoDetect)) {
			void this.detectConfigurations();
		}
		this._registerDesktopSessionSync();
	}

	private _registerDesktopSessionSync(): void {
		const desktop = this._desktopService();
		if (!desktop) {
			return;
		}
		this._register(desktop.onDidChangeSession(session => {
			this._session = {
				...this._session,
				desktopSessionActive: session?.state === 'running',
				desktopSessionState: session?.state,
				desktopSessionPid: session?.pid,
				desktopLaunchMode: session?.launchMode ?? this._session.desktopLaunchMode,
			};
			this._fire();
		}));
	}

	getSession(): PreBaseRuntimeSession {
		return this._session;
	}

	async setUrl(url: string): Promise<boolean> {
		return this.connectUrl(url);
	}

	async connectUrl(url?: string): Promise<boolean> {
		const candidate = (url ?? this._session.url).trim();
		if (!(await this._allowUrl(candidate))) {
			return false;
		}
		const validated = validatePreviewUrl(candidate);
		if (!validated.ok) {
			this._log(validated.reason);
			return false;
		}
		const reachable = await this._probeUrl(validated.url);
		this._session = {
			...this._session,
			url: validated.url,
			// Keep the preview session active so the webview can load / retry.
			running: true,
			// Only claim "connected" when something is actually listening.
			previewConnected: reachable
		};
		if (this._session.networkCapture) {
			this._pushNetwork(reachable
				? localize('prebase.runtime.networkConnect', "GET {0}", validated.url)
				: localize('prebase.runtime.networkUnreachable', "Unreachable {0}", validated.url));
		}
		if (!reachable) {
			this._log(localize(
				'prebase.runtime.connectWaiting',
				"Nothing listening at {0}. Start the preview server, or fix the URL.",
				validated.url
			));
			this._pushConsole(localize(
				'prebase.runtime.connectWaitingConsole',
				"Waiting for {0} — use Start if you have not launched the dev server yet.",
				validated.url
			));
		} else {
			this._log(localize('prebase.runtime.connectOk', "Connected to {0}", validated.url));
		}
		this._fire();
		await this.openPreviewEditor();
		return true;
	}

	markPreviewLoaded(url: string, ok: boolean, detail?: string): void {
		const validated = validatePreviewUrl(url);
		if (!validated.ok || validated.url !== this._session.url) {
			return;
		}
		// Iframe onload also fires for browser error pages, so connectivity stays probe-owned.
		if (ok) {
			if (!this._session.previewConnected) {
				// Soft upgrade after Start when the page becomes reachable later.
				void this._probeUrl(validated.url).then(reachable => {
					if (!reachable || validated.url !== this._session.url || this._session.previewConnected) {
						return;
					}
					this._session = { ...this._session, previewConnected: true };
					this._log(localize('prebase.runtime.iframeLoaded', "Preview loaded {0}", validated.url));
					this._fire();
				});
			}
			return;
		}
		if (!this._session.previewConnected) {
			this._log(localize('prebase.runtime.iframeFailed', "Preview failed for {0}{1}", validated.url, detail ? `: ${detail}` : ''));
			return;
		}
		this._session = { ...this._session, previewConnected: false };
		this._log(localize('prebase.runtime.iframeFailed', "Preview failed for {0}{1}", validated.url, detail ? `: ${detail}` : ''));
		this._fire();
	}

	private async _probeUrl(url: string): Promise<boolean> {
		try {
			const context = await this.requestService.request({
				type: 'GET',
				url,
				timeout: 2500,
				followRedirects: 3,
				callSite: 'PreBaseRuntimeService._probeUrl',
			}, CancellationToken.None);
			const status = context.res.statusCode ?? 0;
			return status > 0 && status < 500;
		} catch {
			return false;
		}
	}

	setViewportPreset(preset: PreBaseViewportPreset): void {
		const size = resolveViewportSize(preset, undefined, undefined, this._session.viewport.rotated)
			?? { width: this._session.viewport.width, height: this._session.viewport.height };
		this._session = {
			...this._session,
			viewport: {
				...this._session.viewport,
				preset,
				width: size.width,
				height: size.height
			}
		};
		this._fire();
	}

	setViewportSize(width: number, height: number): void {
		const w = Math.max(100, Math.min(4000, Math.round(width)));
		const h = Math.max(100, Math.min(4000, Math.round(height)));
		this._session = {
			...this._session,
			viewport: {
				...this._session.viewport,
				preset: 'responsive',
				width: w,
				height: h
			}
		};
		this._fire();
	}

	setZoom(zoom: number): void {
		const z = Math.max(0.25, Math.min(3, Math.round(zoom * 100) / 100));
		this._session = {
			...this._session,
			viewport: { ...this._session.viewport, zoom: z }
		};
		this._fire();
	}

	rotateViewport(): void {
		const { width, height, rotated } = this._session.viewport;
		this._session = {
			...this._session,
			viewport: {
				...this._session.viewport,
				width: height,
				height: width,
				rotated: !rotated
			}
		};
		this._fire();
	}

	selectScript(scriptName: string): void {
		const script = this._session.scripts.find(s => s.scriptName === scriptName);
		if (!script) {
			return;
		}
		const suggestedRaw = script.suggestedUrls[0] ?? this._session.url;
		const suggestedValidated = validatePreviewUrl(suggestedRaw);
		const suggested = suggestedValidated.ok && suggestedValidated.isLocal
			? suggestedValidated.url
			: this._session.url;
		this._session = {
			...this._session,
			selectedScriptName: script.scriptName,
			packageManager: script.packageManager,
			url: this._session.previewConnected ? this._session.url : suggested,
			detectedUrls: [...new Set([
				...script.suggestedUrls.filter(u => {
					const v = validatePreviewUrl(u);
					return v.ok && v.isLocal;
				}),
				...this._session.detectedUrls
			])]
		};
		this._fire();
	}

	async detectConfigurations(): Promise<string[]> {
		if (this._detectInFlight) {
			return this._detectInFlight;
		}
		this._detectInFlight = this._detectConfigurationsImpl();
		try {
			return await this._detectInFlight;
		} finally {
			this._detectInFlight = undefined;
		}
	}

	private async _detectConfigurationsImpl(): Promise<string[]> {
		const folder = this.workspaceService.getWorkspace().folders[0];
		if (!folder) {
			this._log(localize('prebase.runtime.noWorkspace', "No workspace folder open."));
			this._fire();
			return this._session.detectedUrls;
		}
		this._workspaceFolderUri = folder.uri;

		const existsMap = new Map<string, boolean>();
		await Promise.all(PROBE_PATHS.map(async rel => {
			existsMap.set(rel, await this.fileService.exists(URI.joinPath(folder.uri, rel)));
		}));

		let packageJson: PackageJsonShape | undefined;
		if (existsMap.get('package.json')) {
			try {
				const raw = (await this.fileService.readFile(URI.joinPath(folder.uri, 'package.json'))).value.toString();
				packageJson = JSON.parse(raw) as PackageJsonShape;
			} catch (err) {
				this._log(localize('prebase.runtime.pkgParseFail', "Failed to parse package.json: {0}", String(err)));
			}
		}

		const probe: ProjectProbe = {
			exists: rel => existsMap.get(rel) === true,
			packageJson,
			rootLabel: folder.name || folder.uri.path
		};

		const framework = detectFramework(probe);
		const electronProfile = this._desktopService()?.detect(probe) ?? detectElectronProject(probe);
		const scripts = detectDevScripts(probe);
		const selected = selectDefaultScript(scripts);
		const defaultUrl = this.configurationService.getValue<string>(PreBaseConfigKeys.RuntimeDefaultUrl) || 'http://localhost:5173';
		// Prefer framework likely port before generic script suggestions (Vite → 5173, not 3000).
		const candidates = [
			`http://localhost:${framework.likelyDevPort}`,
			...(selected?.suggestedUrls ?? []),
			...scripts.flatMap(s => s.suggestedUrls),
			defaultUrl
		];
		const detectedUrls = [...new Set(
			candidates
				.map(u => validatePreviewUrl(u))
				.filter((v): v is { ok: true; url: string; isLocal: boolean } => v.ok && v.isLocal)
				.map(v => v.url)
		)];

		const nextUrl = this._session.previewConnected || this._session.serverRunning
			? this._session.url
			: (detectedUrls[0] ?? this._session.url);

		this._session = {
			...this._session,
			framework,
			electronProfile,
			desktopLaunchMode: this.configurationService.getValue<DesktopLaunchMode>(PreBaseConfigKeys.RuntimeDesktopLaunchMode) ?? 'managed',
			workspaceRoot: folder.uri.fsPath || folder.uri.path,
			scripts,
			selectedScriptName: selected?.scriptName,
			packageManager: selected?.packageManager,
			detectedUrls,
			url: nextUrl
		};

		this._log(localize(
			'prebase.runtime.detectedSummary',
			"Detected {0} · {1} script(s) · default {2}{3}",
			framework.label,
			scripts.length,
			selected?.scriptName ?? 'none',
			electronProfile.isElectron ? ` · Electron (${electronProfile.confidence})` : ''
		));
		this._fire();

		if (this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeAutoOpen) && detectedUrls.length) {
			void this.openPreviewEditor();
		}
		return detectedUrls;
	}

	async start(): Promise<void> {
		const inFlight = this._startInFlight;
		if (inFlight && !this._startCts?.token.isCancellationRequested) {
			return inFlight;
		}
		const cts = new CancellationTokenSource();
		this._startCts = cts;
		// Restart cancels the in-flight start and immediately starts again.
		// Joining the cancelled one would hand the caller a start that is
		// guaranteed to return without launching anything, so chain the fresh
		// start onto its unwind instead. The chained promise is published
		// synchronously so a caller arriving mid-unwind joins it rather than
		// racing a second launch past the "already running" checks.
		const started = inFlight
			? inFlight.catch(() => undefined).then(() => this._startImpl(cts.token))
			: this._startImpl(cts.token);
		this._startInFlight = started;
		try {
			await started;
		} finally {
			if (this._startInFlight === started) {
				this._startInFlight = undefined;
			}
			if (this._startCts === cts) {
				this._startCts = undefined;
			}
			cts.dispose();
		}
	}

	private async _startImpl(token: CancellationToken): Promise<void> {
		try {
			// A start chained behind a cancelled one is published before it runs,
			// so a stop arriving in that window has already cancelled this token.
			if (token.isCancellationRequested) {
				return;
			}
			if (!this._session.scripts.length) {
				await this.detectConfigurations();
			}
			if (token.isCancellationRequested) {
				return;
			}

			const electronProfile = this._session.electronProfile;
			const launchMode = this._session.desktopLaunchMode;
			const desktop = this._desktopService();
			if (electronProfile?.isElectron && desktop) {
				if (launchMode === 'managed') {
					const script = this._session.scripts.find(s => s.scriptName === this._session.selectedScriptName)
						?? selectDefaultScript(this._session.scripts);
					if (script) {
						const rendererCommand = managedRendererDevCommand(script);
						if (!rendererCommand) {
							this._log(localize(
								'prebase.runtime.managedNoRendererServer',
								"Managed launch needs a renderer dev server. The selected script opens Electron directly; start a Vite/renderer server first, or use Open externally."
							));
							this._fire();
							return;
						}
						// If a previous Start launched full Electron, kill it before renderer-only.
						if (this._session.serverRunning && this._devTerminal && !this._devTerminal.isDisposed) {
							const prior = (this._session.selectedScriptName && this._session.scripts.find(s => s.scriptName === this._session.selectedScriptName)?.scriptBody) || '';
							if (scriptLaunchesElectronApp(prior) || scriptLaunchesElectronApp(script.scriptBody)) {
								this._log(localize(
									'prebase.runtime.managedRestartRendererOnly',
									"Stopping Electron-launching server so managed mode can start renderer-only."
								));
								await this._stopTerminal();
								this._session = { ...this._session, serverRunning: false, terminalInstanceId: undefined };
							}
						}
						if (!this._session.serverRunning) {
							if (scriptLaunchesElectronApp(script.scriptBody)) {
								this._log(localize(
									'prebase.runtime.managedRendererOnly',
									"Managed mode starts the renderer only (no Electron window): {0}",
									rendererCommand
								));
							}
							await this._startDevServerOnly({
								...script,
								command: rendererCommand,
								scriptBody: rendererCommand,
								label: `${script.scriptName} (renderer only)`,
							});
						}
					}
					const rendererUrl = this._session.url || electronProfile.rendererUrlHint || `http://localhost:${electronProfile.likelyDevPort}`;
					const ready = await this._waitForUrl(rendererUrl, 45_000, token);
					if (token.isCancellationRequested) {
						return;
					}
					if (!ready) {
						this._log(localize(
							'prebase.runtime.managedWaitFailed',
							"Timed out waiting for renderer at {0}. Managed window will still open; use Reload once the server is ready.",
							rendererUrl
						));
					}
					const session = await desktop.start({ launchMode: 'managed', rendererUrl });
					if (token.isCancellationRequested) {
						await desktop.stop();
						return;
					}
					this._session = {
						...this._session,
						url: rendererUrl,
						desktopSessionActive: Boolean(session && session.state === 'running'),
						running: Boolean(session && session.state === 'running'),
					};
					this._fire();
					return;
				}
				if (launchMode === 'external') {
					const script = this._session.scripts.find(s => s.scriptName === this._session.selectedScriptName)
						?? selectDefaultScript(this._session.scripts);
					const session = await desktop.start({
						launchMode: 'external',
						rendererUrl: this._session.url,
						command: script?.command,
					});
					if (token.isCancellationRequested) {
						await desktop.stop();
						return;
					}
					this._session = {
						...this._session,
						desktopSessionActive: Boolean(session && session.state === 'running'),
						running: Boolean(session && session.state === 'running'),
					};
					this._fire();
					return;
				}
			}

			const script = this._session.scripts.find(s => s.scriptName === this._session.selectedScriptName)
				?? selectDefaultScript(this._session.scripts);

			if (!script) {
				// No package scripts — connect to configured URL only.
				this._log(localize('prebase.runtime.noScripts', "No dev scripts found; connecting to {0}", this._session.url));
				await this.connectUrl(this._session.url);
				return;
			}

			if (this._devTerminal && !this._devTerminal.isDisposed) {
				this._log(localize('prebase.runtime.alreadyRunning', "Dev server terminal already running."));
				this._session = { ...this._session, serverRunning: true, running: true };
				this._fire();
				await this.openPreviewEditor();
				return;
			}

			const check = classifyTerminalCommand(script.command);
			if (check.blocked) {
				this._log(check.reason);
				return;
			}
			const confirmCommands = this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeConfirmCommands);
			if (confirmCommands && check.risk !== 'low') {
				const result = await this.dialogService.confirm({
					message: localize('prebase.runtime.confirmRun', "Start preview server?"),
					detail: localize('prebase.runtime.confirmRunDetail', "PreBase will run:\n{0}\n\n{1}", script.command, check.reason),
					primaryButton: localize('prebase.runtime.confirmRunBtn', "Start")
				});
				if (!result.confirmed || token.isCancellationRequested) {
					return;
				}
			}

			// Re-check after async confirm — another start may have won.
			if (this._devTerminal && !this._devTerminal.isDisposed) {
				this._log(localize('prebase.runtime.alreadyRunning', "Dev server terminal already running."));
				this._session = { ...this._session, serverRunning: true, running: true };
				this._fire();
				await this.openPreviewEditor();
				return;
			}

			if (token.isCancellationRequested) {
				return;
			}

			const cwd = this._workspaceFolderUri ?? this.workspaceService.getWorkspace().folders[0]?.uri;
			this._urlAutoApplied = false;
			this._terminalBuffer = '';

			const instance = await this.terminalService.createTerminal({
				config: {
					name: localize('prebase.runtime.terminalName', "PreBase Dev Server"),
					cwd,
				},
				cwd
			});
			this._devTerminal = instance;
			this._attachTerminal(instance);

			await this.terminalService.setActiveInstance(instance);
			await this.terminalService.revealActiveTerminal();
			await instance.sendText(script.command, true);

			this._session = {
				...this._session,
				serverRunning: true,
				running: true,
				selectedScriptName: script.scriptName,
				packageManager: script.packageManager,
				terminalInstanceId: instance.instanceId,
				consoleEntries: this._session.consoleCapture
					? [...this._session.consoleEntries, localize('prebase.runtime.consoleStarted', "Started `{0}`", script.command)]
					: this._session.consoleEntries
			};
			this._log(localize('prebase.runtime.startedCmd', "Running {0}", script.command));
			this._fire();
			await this.openPreviewEditor();
		} catch (err) {
			this._detachTerminal(true);
			this._devTerminal = undefined;
			this._session = {
				...this._session,
				serverRunning: false,
				running: false,
				terminalInstanceId: undefined
			};
			const message = err instanceof Error ? err.message : String(err);
			this._log(localize('prebase.runtime.startFailed', "Start failed: {0}", message));
			this._pushConsole(localize('prebase.runtime.startFailedConsole', "Start failed: {0}", message));
			this._fire();
		}
	}

	async stop(): Promise<void> {
		// Abandon a start that is still waiting for the renderer, otherwise it
		// opens a window after the user asked to stop.
		this._startCts?.cancel();
		if (this._session.desktopSessionActive) {
			await this._desktopService()?.stop();
			this._session = {
				...this._session,
				desktopSessionActive: false,
			};
		}
		await this._stopTerminal();
		this._session = {
			...this._session,
			running: false,
			serverRunning: false,
			previewConnected: false,
			terminalInstanceId: undefined
		};
		this._log(localize('prebase.runtime.stopped', "Preview stopped."));
		this._fire();
	}

	async restart(): Promise<void> {
		await this.stop();
		await this.start();
	}

	reload(): void {
		if (!this._session.running && !this._session.previewConnected) {
			void this.connectUrl(this._session.url);
			return;
		}
		if (this._session.consoleCapture) {
			this._pushConsole(localize('prebase.runtime.reloaded', "Reloaded preview"));
		}
		this._onDidRequestNavigation.fire('reload');
		this._fire();
	}

	goBack(): void {
		this._onDidRequestNavigation.fire('back');
	}

	goForward(): void {
		this._onDidRequestNavigation.fire('forward');
	}

	async openExternal(): Promise<void> {
		if (!(await this._allowUrl(this._session.url))) {
			return;
		}
		await this.openerService.open(this._session.url, { openExternal: true });
	}

	async copyUrl(): Promise<void> {
		await this.clipboardService.writeText(this._session.url);
		this._log(localize('prebase.runtime.copied', "Copied {0}", this._session.url));
	}

	async openTerminal(): Promise<void> {
		const existing = (this._devTerminal && !this._devTerminal.isDisposed)
			? this._devTerminal
			: (this._idleTerminal && !this._idleTerminal.isDisposed ? this._idleTerminal : undefined);
		if (existing) {
			await this.terminalService.setActiveInstance(existing);
			await this.terminalService.revealActiveTerminal();
			return;
		}
		const cwd = this._workspaceFolderUri ?? this.workspaceService.getWorkspace().folders[0]?.uri;
		const instance = await this.terminalService.createTerminal({
			config: {
				name: localize('prebase.runtime.terminalNameIdle', "PreBase Terminal"),
				cwd
			},
			cwd
		});
		// Tracked so repeated clicks reuse one terminal instead of leaking a new
		// one each time, and so dispose() can clean it up.
		this._idleTerminal = instance;
		await this.terminalService.setActiveInstance(instance);
		await this.terminalService.revealActiveTerminal();
	}

	clearDiagnostics(): void {
		this._session = {
			...this._session,
			consoleEntries: [],
			consoleErrorCount: 0,
			networkEntries: []
		};
		this._fire();
	}

	inspect(): void {
		this._pushConsole(localize('prebase.runtime.inspect', "Inspect requested — open browser DevTools on the preview frame (limited in-workbench capture)."));
		this._fire();
	}

	captureScreenshot(): void {
		this._pushConsole(localize('prebase.runtime.screenshot', "Screenshot capture is limited (no native capture pipeline yet)."));
		this._fire();
	}

	startTestSession(): void {
		const startedAt = Date.now();
		this._session = {
			...this._session,
			testSessionActive: true,
			testSessionStartedAt: startedAt,
			consoleEntries: [
				...this._session.consoleEntries,
				localize('prebase.runtime.testStart', "Test session started")
			]
		};
		this._log(localize('prebase.runtime.testStartLog', "Test session active."));
		this._fire();
	}

	stopTestSession(): void {
		if (!this._session.testSessionActive) {
			return;
		}
		const started = this._session.testSessionStartedAt ?? Date.now();
		const report = localize(
			'prebase.runtime.testEndReport',
			"Test session {0} · {1}ms · errors={2}",
			new Date(started).toLocaleTimeString(),
			Date.now() - started,
			this._session.consoleErrorCount
		);
		const limit = this.configurationService.getValue<number>(PreBaseConfigKeys.RuntimeReportHistoryLimit) || 20;
		this._session = {
			...this._session,
			testSessionActive: false,
			testSessionStartedAt: null,
			reports: [report, ...this._session.reports].slice(0, limit),
			consoleEntries: [...this._session.consoleEntries, report]
		};
		this._fire();
	}

	replayTest(): void {
		const limit = this.configurationService.getValue<number>(PreBaseConfigKeys.RuntimeReportHistoryLimit) || 20;
		const report = localize('prebase.runtime.testReplay', "Replay at {0} · {1}", new Date().toLocaleTimeString(), this._session.url);
		this._session = {
			...this._session,
			reports: [report, ...this._session.reports].slice(0, limit),
			consoleEntries: [...this._session.consoleEntries, report]
		};
		this._fire();
	}

	showReports(): string[] {
		return this._session.reports;
	}

	attachToMagnus(): void {
		const summary = this.getContextSummaryForMagnus();
		this._session = {
			...this._session,
			magnusAttached: true,
			consoleEntries: [
				...this._session.consoleEntries,
				localize('prebase.runtime.magnus', "Attached runtime context to Agents")
			]
		};
		this._fire();
		void this.commandService.executeCommand('prebase.magnus.attachRuntimeContext', summary);
		void this.commandService.executeCommand('prebase.magnus.open');
	}

	testWithMagnus(): void {
		const summary = [
			this.getContextSummaryForMagnus(),
			'',
			'Task: Propose and run a focused UI test plan against this Runtime Preview session.'
		].join('\n');
		this._session = { ...this._session, magnusAttached: true };
		this._fire();
		void this.commandService.executeCommand('prebase.magnus.attachRuntimeContext', summary);
		void this.commandService.executeCommand('prebase.magnus.open');
	}

	explainElement(): void {
		const summary = [
			this.getContextSummaryForMagnus(),
			'',
			'Task: Explain the currently selected / focused UI element in the Runtime Preview and suggest related source files.'
		].join('\n');
		this._session = { ...this._session, magnusAttached: true };
		this._fire();
		void this.commandService.executeCommand('prebase.magnus.attachRuntimeContext', summary);
		void this.commandService.executeCommand('prebase.magnus.open');
	}

	getContextSummaryForMagnus(): string {
		const s = this._session;
		return [
			`Runtime URL: ${s.url}`,
			`Preview connected: ${s.previewConnected ? 'yes' : 'no'}`,
			`Server running: ${s.serverRunning ? 'yes' : 'no'}`,
			`Framework: ${s.framework?.label ?? 'unknown'}`,
			`Root: ${s.workspaceRoot || '(none)'}`,
			`Script: ${s.selectedScriptName ?? '(none)'} (${s.packageManager ?? 'n/a'})`,
			`Viewport: ${s.viewport.preset} ${s.viewport.width}x${s.viewport.height} @${s.viewport.zoom}x${s.viewport.rotated ? ' rotated' : ''}`,
			`Console errors: ${s.consoleErrorCount}`,
			`Test session: ${s.testSessionActive ? 'active' : 'idle'}`,
			`Console:`,
			...(s.consoleEntries.slice(-20).map(line => `  ${line}`)),
			`Network:`,
			...(s.networkEntries.slice(-20).map(line => `  ${line}`)),
			s.reports.length ? `Reports:\n${s.reports.slice(0, 5).map(r => `  ${r}`).join('\n')}` : ''
		].filter(Boolean).join('\n');
	}

	getStateForMagnus(): Record<string, unknown> {
		const s = this._session;
		const ownsServer = !!this._devTerminal && !this._devTerminal.isDisposed;
		return {
			url: redactRuntimeEvidence(s.url),
			previewConnected: s.previewConnected,
			serverRunning: s.serverRunning,
			serverOwnedByPreBase: ownsServer,
			framework: s.framework?.label ?? 'unknown',
			workspaceRoot: s.workspaceRoot || undefined,
			script: s.selectedScriptName,
			packageManager: s.packageManager,
			viewport: s.viewport,
			consoleCapture: s.consoleCapture,
			networkCapture: s.networkCapture,
			consoleErrorCount: s.consoleErrorCount,
			testSession: s.testSessionActive ? 'active' : 'idle',
		};
	}

	async controlServerForMagnus(action: 'start' | 'stop' | 'restart'): Promise<Record<string, unknown>> {
		if (action !== 'start' && action !== 'stop' && action !== 'restart') {
			return { ok: false, action, reason: 'Unsupported Runtime Preview action.', state: this.getStateForMagnus() };
		}
		if (action === 'stop' || action === 'restart') {
			if (!this._devTerminal || this._devTerminal.isDisposed) {
				return { ok: false, action, reason: 'No PreBase-owned Runtime Preview server is running; no process was stopped.', state: this.getStateForMagnus() };
			}
			// stop() also tears down a managed Electron session. An agent asking to
			// stop the dev server must not silently close the user's app window.
			if (this._session.desktopSessionActive) {
				return {
					ok: false,
					action,
					reason: 'A managed desktop session is running; stopping the dev server would also close that window. Stop it from Runtime Preview instead.',
					state: this.getStateForMagnus()
				};
			}
		}

		if (action === 'start') {
			await this.start();
		} else if (action === 'stop') {
			await this.stop();
		} else {
			await this.restart();
		}
		const state = this.getStateForMagnus();
		if (action === 'start' && state.serverOwnedByPreBase !== true) {
			return { ok: false, action, reason: 'Runtime Preview did not start a PreBase-owned dev server.', state };
		}
		return { ok: true, action, state };
	}

	async navigateForMagnus(url: string): Promise<Record<string, unknown>> {
		if (typeof url !== 'string' || !url.trim()) {
			return { ok: false, reason: 'A preview URL or path is required.', state: this.getStateForMagnus() };
		}
		let target = url.trim();
		if (target.startsWith('/')) {
			try {
				target = new URL(target, this._session.url).toString();
			} catch {
				return { ok: false, reason: 'The relative preview path is not valid.', state: this.getStateForMagnus() };
			}
		}
		const allowed = await this.connectUrl(target);
		const state = this.getStateForMagnus();
		if (!allowed) {
			return { ok: false, reason: 'Runtime Preview rejected that URL.', state };
		}
		// connectUrl keeps the preview open so the user can retry, but an agent
		// must not be told navigation succeeded when nothing is listening.
		return state.previewConnected === true
			? { ok: true, state }
			: { ok: false, reason: 'Runtime Preview accepted the URL but nothing is listening at it yet.', state };
	}

	async inspectPageForMagnus(token: CancellationToken = CancellationToken.None): Promise<Record<string, unknown>> {
		if (token.isCancellationRequested) {
			return { ok: false, reason: 'Cancelled', state: this.getStateForMagnus() };
		}
		const session = this._session;
		if (!session.previewConnected) {
			return { ok: false, reason: 'Runtime Preview is not connected.', state: this.getStateForMagnus() };
		}
		const validated = validatePreviewUrl(session.url);
		if (!validated.ok) {
			return { ok: false, reason: validated.reason, state: this.getStateForMagnus() };
		}
		if (!validated.isLocal) {
			return { ok: false, reason: 'Page inspection is restricted to local Runtime Preview origins.', state: this.getStateForMagnus() };
		}
		try {
			const context = await this.requestService.request({ type: 'GET', url: validated.url, timeout: 5000, followRedirects: 0, callSite: 'PreBaseRuntimeService.inspectPageForMagnus' }, token);
			const statusCode = context.res.statusCode ?? 0;
			if (statusCode < 200 || statusCode >= 300) {
				return { ok: false, reason: `Runtime Preview returned HTTP ${statusCode}; redirects and error responses are not inspected.`, state: this.getStateForMagnus() };
			}
			const response = (await asTextOrError(context) ?? '').slice(0, 200_000);
			if (token.isCancellationRequested) {
				return { ok: false, reason: 'Cancelled', state: this.getStateForMagnus() };
			}
			const outline = pageOutline(response);
			return {
				ok: true,
				url: redactRuntimeEvidence(validated.url),
				title: outline.title,
				visibleText: outline.visibleText,
				interactiveElements: outline.elements,
				viewport: session.viewport,
				console: session.consoleEntries.slice(-20).map(redactRuntimeEvidence),
				network: session.networkEntries.slice(-20).map(redactRuntimeEvidence),
				consoleErrorCount: session.consoleErrorCount,
				limitation: 'Inspection reads the current preview response. Cross-origin iframe DOM actions are intentionally unavailable without a page-side automation bridge.',
			};
		} catch (error) {
			return { ok: false, reason: error instanceof Error ? error.message : String(error), state: this.getStateForMagnus() };
		}
	}

	getEvidenceForMagnus(kind: 'console' | 'network', maximumEntries = 50): Record<string, unknown> {
		if (kind !== 'console' && kind !== 'network') {
			return { ok: false, reason: 'Unsupported Runtime Preview evidence kind.' };
		}
		const requestedMaximum = typeof maximumEntries === 'number' && Number.isFinite(maximumEntries) ? maximumEntries : 50;
		const maximum = Math.max(1, Math.min(100, Math.floor(requestedMaximum)));
		const entries = kind === 'console' ? this._session.consoleEntries : this._session.networkEntries;
		return {
			kind,
			entries: entries.slice(-maximum).map(redactRuntimeEvidence),
			consoleErrorCount: this._session.consoleErrorCount,
			truncated: entries.length > maximum,
		};
	}

	controlTestForMagnus(action: 'begin' | 'finalize' | 'replay'): Record<string, unknown> {
		if (action === 'begin') {
			this.startTestSession();
		} else if (action === 'finalize') {
			this.stopTestSession();
		} else if (action === 'replay') {
			this.replayTest();
		} else {
			return { ok: false, reason: 'Unsupported Runtime Preview test action.' };
		}
		return { ok: true, action, testSession: this._session.testSessionActive ? 'active' : 'idle', reports: this._session.reports.slice(0, 10).map(redactRuntimeEvidence), consoleErrorCount: this._session.consoleErrorCount };
	}

	async openPreviewEditor(): Promise<void> {
		await this.editorService.openEditor(new PreBaseRuntimeEditorInput(), { pinned: true });
	}

	recordConsoleError(message: string): void {
		this._session = {
			...this._session,
			consoleErrorCount: this._session.consoleErrorCount + 1,
			consoleEntries: [...this._session.consoleEntries, `[error] ${message}`]
		};
		this._fire();
	}

	async setDesktopLaunchMode(mode: DesktopLaunchMode): Promise<void> {
		await this._desktopService()?.setLaunchMode(mode);
		this._session = { ...this._session, desktopLaunchMode: mode };
		this._fire();
	}

	private _desktopService(): IPreBaseDesktopRuntimeService | undefined {
		if (isWeb) {
			return undefined;
		}
		try {
			return this.instantiationService.invokeFunction(accessor => accessor.get(IPreBaseDesktopRuntimeService));
		} catch {
			return undefined;
		}
	}

	private async _startDevServerOnly(script: DetectedDevScript): Promise<void> {
		if (this._devTerminal && !this._devTerminal.isDisposed) {
			this._session = { ...this._session, serverRunning: true };
			return;
		}
		const cwd = this._workspaceFolderUri ?? this.workspaceService.getWorkspace().folders[0]?.uri;
		const instance = await this.terminalService.createTerminal({
			config: { name: localize('prebase.runtime.terminalName', "PreBase Dev Server"), cwd },
			cwd,
		});
		this._devTerminal = instance;
		this._attachTerminal(instance);
		await instance.sendText(script.command, true);
		this._session = {
			...this._session,
			serverRunning: true,
			selectedScriptName: script.scriptName,
			packageManager: script.packageManager,
			terminalInstanceId: instance.instanceId,
		};
	}

	/** Poll until the renderer URL responds or timeout (managed launch must not race Electron). */
	private async _waitForUrl(url: string, timeoutMs: number, token: CancellationToken): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline && !token.isCancellationRequested) {
			try {
				const context = await this.requestService.request({
					type: 'GET',
					url,
					timeout: 2000,
					followRedirects: 3,
					callSite: 'PreBaseRuntimeService._waitForUrl',
				}, token);
				const status = context.res.statusCode ?? 0;
				if (status > 0 && status < 500) {
					return true;
				}
			} catch {
				// keep waiting
			}
			await timeout(500, token).catch(() => undefined);
		}
		return false;
	}

	private async _stopTerminal(): Promise<void> {
		const term = this._devTerminal;
		if (!term || term.isDisposed) {
			this._detachTerminal(false);
			this._devTerminal = undefined;
			return;
		}
		try {
			// Prefer Ctrl+C so we only interrupt our PreBase terminal, not unrelated sessions.
			await term.sendText('\u0003', false);
			await new Promise(resolve => setTimeout(resolve, 400));
			if (!term.isDisposed) {
				term.dispose();
			}
		} catch {
			try {
				term.dispose();
			} catch {
				// ignore
			}
		}
		this._detachTerminal(false);
		this._devTerminal = undefined;
	}

	private _attachTerminal(instance: ITerminalInstance): void {
		const store = new DisposableStore();
		this._terminalListeners.value = store;
		store.add(instance.onData(data => {
			const cleaned = removeAnsiEscapeCodes(data);
			this._terminalBuffer = (this._terminalBuffer + cleaned).slice(-12000);
			this._maybeApplyDetectedUrl();
		}));
		store.add(instance.onExit(() => {
			if (this._devTerminal?.instanceId === instance.instanceId) {
				this._detachTerminal(false);
				this._devTerminal = undefined;
				this._session = { ...this._session, serverRunning: false, terminalInstanceId: undefined };
				this._log(localize('prebase.runtime.serverExited', "Dev server process exited."));
				this._fire();
			}
		}));
	}

	private _detachTerminal(clearBuffer: boolean): void {
		this._terminalListeners.clear();
		if (clearBuffer) {
			this._terminalBuffer = '';
		}
	}

	private _maybeApplyDetectedUrl(): void {
		if (this._urlAutoApplied) {
			return;
		}
		const url = latestDevServerUrl(this._terminalBuffer);
		if (!url) {
			return;
		}
		this._urlAutoApplied = true;
		void this._applyDetectedUrl(url);
	}

	private async _applyDetectedUrl(url: string): Promise<void> {
		if (!(await this._allowUrl(url))) {
			// Allow a later local URL from the same terminal stream to be considered.
			this._urlAutoApplied = false;
			return;
		}
		const validated = validatePreviewUrl(url);
		if (!validated.ok) {
			this._urlAutoApplied = false;
			return;
		}
		const reachable = await this._probeUrl(validated.url);
		this._session = {
			...this._session,
			url: validated.url,
			previewConnected: reachable,
			running: true,
			detectedUrls: [...new Set([validated.url, ...this._session.detectedUrls])]
		};
		if (this._session.networkCapture) {
			this._pushNetwork(localize('prebase.runtime.networkDetected', "Detected {0}", validated.url));
		}
		this._log(localize('prebase.runtime.urlDetected', "Detected preview URL {0}", validated.url));
		this._fire();
		await this.openPreviewEditor();
	}

	private async _allowUrl(url: string): Promise<boolean> {
		const allowExternal = this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeAllowExternalUrls);
		const check = classifyNavigateUrl(url, !!allowExternal);
		if (check.blocked && !check.requiresApproval) {
			await this.dialogService.info(localize('prebase.runtime.invalidUrl', "Invalid preview URL"), check.reason);
			return false;
		}
		if (check.allowed) {
			return true;
		}
		if (check.requiresApproval) {
			const result = await this.dialogService.confirm({
				message: localize('prebase.runtime.externalConfirm', "Load external URL?"),
				detail: localize('prebase.runtime.externalDetail', "PreBase Runtime Preview wants to open:\n{0}", url),
				primaryButton: localize('prebase.runtime.externalAllow', "Allow")
			});
			return result.confirmed;
		}
		return false;
	}

	private _pushConsole(line: string): void {
		this._session = {
			...this._session,
			consoleEntries: [...this._session.consoleEntries, line]
		};
	}

	private _pushNetwork(line: string): void {
		this._session = {
			...this._session,
			networkEntries: [...this._session.networkEntries, line]
		};
	}

	private _log(message: string): void {
		const channel = this.outputService.getChannel(PREBASE_RUNTIME_CHANNEL_ID);
		channel?.append(`[PreBase Runtime] ${message}\n`);
	}

	private _fire(): void {
		this._onDidChangeSession.fire(this._session);
	}

	override dispose(): void {
		this._startCts?.cancel();
		this._detachTerminal(true);
		for (const terminal of [this._devTerminal, this._idleTerminal]) {
			if (terminal && !terminal.isDisposed) {
				try {
					terminal.dispose();
				} catch {
					// ignore
				}
			}
		}
		this._devTerminal = undefined;
		this._idleTerminal = undefined;
		super.dispose();
	}
}

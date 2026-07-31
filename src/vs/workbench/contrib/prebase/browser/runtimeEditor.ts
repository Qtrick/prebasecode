/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IWebviewElement, IWebviewService } from '../../webview/browser/webview.js';
import { PreBaseConfigKeys } from '../common/prebaseConfiguration.js';
import { validatePreviewUrl } from '../common/runtime/permissionClassifier.js';
import { PreBaseRuntimeEditorInput } from './runtimeEditorInput.js';
import { IPreBaseRuntimeService } from './prebaseRuntimeService.js';
import { PreBaseBorder, PreBaseControl, PreBaseForeground, PreBaseSurface } from './prebaseSurfaces.js';

/**
 * Runtime Preview surfaces localhost HTTP inside a workbench webview iframe.
 * A bare workbench `<iframe>` often stays blank for http://localhost; the webview
 * CSP allows `frame-src *` the same way Simple Browser does.
 */
export class PreBaseRuntimeEditor extends EditorPane {
	static readonly ID = 'workbench.editor.prebaseRuntime';

	private _root: HTMLElement | undefined;
	private _toolbar: HTMLElement | undefined;
	private _urlInput: HTMLInputElement | undefined;
	private _statusBadge: HTMLElement | undefined;
	private _frameHost: HTMLElement | undefined;
	private _frameShell: HTMLElement | undefined;
	private _sidePanel: HTMLElement | undefined;
	private _previewWebview: IWebviewElement | undefined;
	private readonly _sessionDisposables = this._register(new DisposableStore());
	private _loadedUrl: string | undefined;
	private _webviewReady = false;
	private _hostResizeObserver: ResizeObserver | undefined;
	private _responsiveSyncTimer: number | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IPreBaseRuntimeService private readonly runtimeService: IPreBaseRuntimeService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super(PreBaseRuntimeEditor.ID, group, telemetryService, themeService, storageService);
		this._register(this.runtimeService.onDidChangeSession(() => {
			this._renderSession();
			this._loadUrl(false);
		}));
		this._register(this.runtimeService.onDidRequestNavigation(action => {
			if (!this._previewWebview || !this._webviewReady) {
				if (action === 'reload') {
					this._loadUrl(true);
				}
				return;
			}
			this._previewWebview.postMessage({ type: action });
			if (action === 'reload') {
				this._loadUrl(true);
			}
		}));
	}

	protected createEditor(parent: HTMLElement): void {
		this._root = DOM.append(parent, DOM.$('.prebase-runtime-editor'));
		this._root.style.display = 'flex';
		this._root.style.flexDirection = 'column';
		this._root.style.height = '100%';
		this._root.style.minWidth = '0';
		this._root.style.minHeight = '0';
		this._root.style.background = PreBaseSurface.deep;
		this._root.style.color = PreBaseForeground.primary;

		this._toolbar = DOM.append(this._root, DOM.$('.prebase-runtime-toolbar'));
		this._toolbar.style.display = 'flex';
		this._toolbar.style.gap = '6px';
		this._toolbar.style.padding = '8px';
		this._toolbar.style.borderBottom = `1px solid ${PreBaseBorder.subtle}`;
		this._toolbar.style.background = PreBaseSurface.chrome;
		this._toolbar.style.alignItems = 'center';
		this._toolbar.style.flexShrink = '0';

		const mkBtn = (label: string, onClick: () => void) => {
			const btn = DOM.append(this._toolbar!, DOM.$('button')) as HTMLButtonElement;
			btn.textContent = label;
			btn.style.background = PreBaseControl.secondaryBackground;
			btn.style.color = PreBaseControl.secondaryForeground;
			btn.style.border = `1px solid ${PreBaseBorder.subtle}`;
			btn.style.borderRadius = '6px';
			btn.style.padding = '4px 10px';
			btn.style.cursor = 'pointer';
			this._register(DOM.addDisposableListener(btn, 'click', onClick));
			return btn;
		};

		mkBtn(localize('prebase.runtime.back', "Back"), () => this.runtimeService.goBack());
		mkBtn(localize('prebase.runtime.forward', "Forward"), () => this.runtimeService.goForward());
		mkBtn(localize('prebase.runtime.reloadBtn', "Reload"), () => this.runtimeService.reload());
		mkBtn(localize('prebase.runtime.openExternalBtn', "External"), () => void this.runtimeService.openExternal());
		mkBtn(localize('prebase.runtime.copyUrlBtn', "Copy"), () => void this.runtimeService.copyUrl());

		this._urlInput = DOM.append(this._toolbar, DOM.$('input')) as HTMLInputElement;
		this._urlInput.type = 'text';
		this._urlInput.style.flex = '1';
		this._urlInput.style.minWidth = '0';
		this._urlInput.style.background = PreBaseControl.inputBackground;
		this._urlInput.style.color = PreBaseControl.inputForeground;
		this._urlInput.style.border = `1px solid ${PreBaseControl.inputBorder}`;
		this._urlInput.style.borderRadius = '6px';
		this._urlInput.style.padding = '6px 8px';
		this._register(DOM.addDisposableListener(this._urlInput, 'keydown', async (e) => {
			if (e.key === 'Enter' && this._urlInput) {
				await this.runtimeService.connectUrl(this._urlInput.value);
			}
		}));

		this._statusBadge = DOM.append(this._toolbar, DOM.$('span'));
		this._statusBadge.style.fontSize = '11px';
		this._statusBadge.style.opacity = '0.85';
		this._statusBadge.style.whiteSpace = 'nowrap';

		const body = DOM.append(this._root, DOM.$('.prebase-runtime-body'));
		body.style.display = 'flex';
		body.style.flex = '1';
		body.style.minHeight = '0';
		body.style.minWidth = '0';

		this._frameHost = DOM.append(body, DOM.$('.prebase-runtime-frame-host'));
		this._frameHost.style.flex = '1';
		this._frameHost.style.display = 'flex';
		this._frameHost.style.alignItems = 'center';
		this._frameHost.style.justifyContent = 'center';
		this._frameHost.style.overflow = 'hidden';
		this._frameHost.style.minWidth = '0';
		this._frameHost.style.minHeight = '0';
		this._frameHost.style.padding = '0';
		this._frameHost.style.boxSizing = 'border-box';
		this._frameHost.style.background = PreBaseSurface.chrome;

		this._frameShell = DOM.append(this._frameHost, DOM.$('.prebase-runtime-frame-shell'));
		this._frameShell.style.background = PreBaseSurface.deep;
		this._frameShell.style.border = '0';
		this._frameShell.style.boxShadow = 'none';
		this._frameShell.style.overflow = 'hidden';
		this._frameShell.style.transformOrigin = 'center center';
		this._frameShell.style.position = 'relative';
		this._frameShell.style.minWidth = '0';
		this._frameShell.style.minHeight = '0';
		this._frameShell.style.boxSizing = 'border-box';

		this._sidePanel = DOM.append(body, DOM.$('.prebase-runtime-side'));
		this._sidePanel.style.width = '260px';
		this._sidePanel.style.flexShrink = '0';
		this._sidePanel.style.borderLeft = `1px solid ${PreBaseBorder.subtle}`;
		this._sidePanel.style.padding = '10px';
		this._sidePanel.style.overflow = 'auto';
		this._sidePanel.style.fontSize = '12px';
		this._sidePanel.style.background = PreBaseSurface.chrome;

		if (typeof ResizeObserver !== 'undefined') {
			this._hostResizeObserver = new ResizeObserver(() => this._scheduleResponsiveSync());
			this._hostResizeObserver.observe(this._frameHost);
		}
		this._register({
			dispose: () => {
				this._hostResizeObserver?.disconnect();
				this._hostResizeObserver = undefined;
				if (this._responsiveSyncTimer !== undefined) {
					DOM.getWindow(this._root).clearTimeout(this._responsiveSyncTimer);
					this._responsiveSyncTimer = undefined;
				}
			}
		});
	}

	override async setInput(input: PreBaseRuntimeEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested) {
			return;
		}
		this._ensurePreviewWebview();
		this._renderSession();
		this._loadUrl(true);
	}

	override clearInput(): void {
		this._sessionDisposables.clear();
		this._previewWebview = undefined;
		this._webviewReady = false;
		this._loadedUrl = undefined;
		super.clearInput();
	}

	override layout(dimension: DOM.Dimension): void {
		if (this._root) {
			this._root.style.width = `${dimension.width}px`;
			this._root.style.height = `${dimension.height}px`;
		}
		this._scheduleResponsiveSync();
		this._applyViewportChrome();
	}

	private _scheduleResponsiveSync(): void {
		const targetWindow = DOM.getWindow(this._root);
		if (this._responsiveSyncTimer !== undefined) {
			targetWindow.clearTimeout(this._responsiveSyncTimer);
		}
		this._responsiveSyncTimer = targetWindow.setTimeout(() => {
			this._responsiveSyncTimer = undefined;
			this._syncResponsiveViewportFromHost();
			this._applyViewportChrome();
		}, 50);
	}

	private _syncResponsiveViewportFromHost(): void {
		if (!this._frameHost) {
			return;
		}
		const session = this.runtimeService.getSession();
		if (session.viewport.preset !== 'responsive' || session.viewport.rotated) {
			return;
		}
		const w = Math.max(1, Math.round(this._frameHost.clientWidth));
		const h = Math.max(1, Math.round(this._frameHost.clientHeight));
		// Mirror setViewportSize clamp [100,4000] so tiny hosts don't re-fire forever.
		const clampedW = Math.max(100, Math.min(4000, w));
		const clampedH = Math.max(100, Math.min(4000, h));
		if (Math.abs(clampedW - session.viewport.width) > 1 || Math.abs(clampedH - session.viewport.height) > 1) {
			this.runtimeService.setViewportSize(clampedW, clampedH);
		}
	}

	private _applyViewportChrome(): void {
		if (!this._frameShell || !this._frameHost) {
			return;
		}
		const session = this.runtimeService.getSession();
		const { width, height, zoom, preset } = session.viewport;
		const responsive = preset === 'responsive' && !session.viewport.rotated;
		if (responsive) {
			this._frameHost.style.padding = '0';
			this._frameHost.style.overflow = 'hidden';
			this._frameShell.style.width = '100%';
			this._frameShell.style.height = '100%';
			this._frameShell.style.border = '0';
			this._frameShell.style.boxShadow = 'none';
			this._frameShell.style.maxWidth = 'none';
			this._frameShell.style.maxHeight = 'none';
		} else {
			// Fixed device: themed letterbox (editor background), not white gutters.
			this._frameHost.style.padding = '12px';
			this._frameHost.style.overflow = 'auto';
			this._frameShell.style.width = `${width}px`;
			this._frameShell.style.height = `${height}px`;
			this._frameShell.style.border = `1px solid ${PreBaseBorder.subtle}`;
			this._frameShell.style.boxShadow = `0 8px 24px ${PreBaseControl.shadow}`;
		}
		this._frameShell.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
	}

	private _renderSession(): void {
		const session = this.runtimeService.getSession();
		if (this._urlInput && this._urlInput !== DOM.getActiveElement()) {
			this._urlInput.value = session.url;
		}
		if (this._statusBadge) {
			this._statusBadge.textContent = [
				session.serverRunning ? 'server' : 'idle',
				session.previewConnected ? 'connected' : 'disconnected',
				`${session.viewport.width}×${session.viewport.height}`,
				session.consoleErrorCount ? `err:${session.consoleErrorCount}` : ''
			].filter(Boolean).join(' · ');
		}

		this._applyViewportChrome();

		if (this._sidePanel) {
			this._sidePanel.innerText = '';
			const addSection = (title: string, lines: string[]) => {
				const h = DOM.append(this._sidePanel!, DOM.$('div'));
				h.textContent = title;
				h.style.fontWeight = '600';
				h.style.margin = '8px 0 4px';
				for (const line of lines.slice(-12)) {
					const p = DOM.append(this._sidePanel!, DOM.$('div'));
					p.textContent = line;
					p.style.opacity = '0.85';
					p.style.marginBottom = '2px';
				}
			};
			addSection(localize('prebase.runtime.diagConsole', "Console Capture"), session.consoleEntries.length ? session.consoleEntries : [localize('prebase.runtime.none', "None")]);
			addSection(localize('prebase.runtime.diagNetwork', "Network Capture"), session.networkEntries.length ? session.networkEntries : [localize('prebase.runtime.none', "None")]);
			addSection(localize('prebase.runtime.diagSession', "Session"), [
				localize('prebase.runtime.runningState', "Server: {0}", session.serverRunning ? 'yes' : 'no'),
				localize('prebase.runtime.connectedState', "Connected: {0}", session.previewConnected ? 'yes' : 'no'),
				localize('prebase.runtime.frameworkState', "Framework: {0}", session.framework?.label ?? '—'),
				localize('prebase.runtime.viewportStateSide', "Viewport: {0} {1}×{2}", session.viewport.preset, session.viewport.width, session.viewport.height),
				localize('prebase.runtime.errorsState', "Errors: {0}", session.consoleErrorCount),
				localize('prebase.runtime.magnusState', "Agents: {0}", session.magnusAttached ? 'attached' : 'idle')
			]);
		}
	}

	private _ensurePreviewWebview(): void {
		if (this._previewWebview || !this._frameShell) {
			return;
		}
		const webview = this._sessionDisposables.add(this.webviewService.createWebviewElement({
			title: localize('prebase.runtime.previewTitle', "PreBase Runtime Preview"),
			options: { retainContextWhenHidden: true },
			contentOptions: {
				allowScripts: true,
				localResourceRoots: []
			},
			extension: undefined
		}));
		webview.mountTo(this._frameShell, this.window);
		webview.setHtml(this._buildPreviewHtml());
		this._sessionDisposables.add(webview.onMessage(e => {
			const msg = e.message as { type?: string; url?: string; detail?: string } | undefined;
			if (!msg?.type) {
				return;
			}
			if (msg.type === 'ready') {
				this._webviewReady = true;
				this._loadUrl(true);
				return;
			}
			if (msg.type === 'load' && msg.url) {
				this.runtimeService.markPreviewLoaded(msg.url, true);
				return;
			}
			if (msg.type === 'error' && msg.url) {
				this.runtimeService.markPreviewLoaded(msg.url, false, msg.detail);
			}
		}));
		this._previewWebview = webview;
	}

	private _loadUrl(force: boolean): void {
		const session = this.runtimeService.getSession();
		if (!this._previewWebview || !this._webviewReady) {
			return;
		}
		if (!(session.running || session.previewConnected || session.serverRunning)) {
			this._previewWebview.postMessage({ type: 'clear' });
			this._loadedUrl = undefined;
			return;
		}
		if (!force && this._loadedUrl === session.url) {
			return;
		}
		const autoReload = this.configurationService.getValue<boolean>(PreBaseConfigKeys.RuntimeAutoReload) !== false;
		if (!force && this._loadedUrl !== undefined && !autoReload) {
			return;
		}

		const validated = validatePreviewUrl(session.url);
		if (!validated.ok) {
			this._previewWebview.postMessage({ type: 'clear', reason: validated.reason });
			this._loadedUrl = undefined;
			return;
		}

		this._loadedUrl = validated.url;
		this._previewWebview.postMessage({ type: 'setUrl', url: validated.url });
	}

	private _buildPreviewHtml(): string {
		const nonce = generateUuid();
		return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; frame-src * http: https:;">
<style nonce="${nonce}">
html, body { margin:0; height:100%; width:100%; background:transparent; overflow:hidden; font-family: ui-sans-serif, system-ui, sans-serif; }
#frame { border:0; width:100%; height:100%; display:block; margin:0; padding:0; background:transparent; }
#overlay {
	position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
	padding:24px; text-align:center; color:var(--vscode-descriptionForeground);
	background:var(--vscode-editor-background); font-size:14px; line-height:1.45;
}
#overlay.hidden { display:none; }
</style>
</head>
<body>
<div id="overlay">Start the preview server or Connect to a local URL.</div>
<iframe id="frame" sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-modals allow-popups" referrerpolicy="no-referrer"></iframe>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const iframe = document.getElementById('frame');
const overlay = document.getElementById('overlay');
let currentUrl = '';
let loadTimer = null;
const LOAD_TIMEOUT_MS = 15000;

function clearLoadTimer() {
	if (loadTimer) {
		clearTimeout(loadTimer);
		loadTimer = null;
	}
}

function showOverlay(text) {
	overlay.textContent = text;
	overlay.classList.remove('hidden');
}
function hideOverlay() {
	overlay.classList.add('hidden');
}

window.addEventListener('message', function (event) {
	const msg = event.data;
	if (!msg || !msg.type) return;
	if (msg.type === 'setUrl' && msg.url) {
		currentUrl = msg.url;
		showOverlay('Loading ' + msg.url + '…');
		clearLoadTimer();
		const url = msg.url;
		// A refused connection frequently never fires load or error, which used
		// to leave the overlay on "Loading…" with no way out.
		loadTimer = setTimeout(function () {
			loadTimer = null;
			if (currentUrl !== url) return;
			showOverlay('No response from ' + url + '. Start the dev server, then Reload.');
			vscode.postMessage({ type: 'error', url: url, detail: 'timeout' });
		}, LOAD_TIMEOUT_MS);
		iframe.onload = function () {
			clearLoadTimer();
			hideOverlay();
			vscode.postMessage({ type: 'load', url: currentUrl });
		};
		iframe.onerror = function () {
			clearLoadTimer();
			showOverlay('Failed to load ' + url);
			vscode.postMessage({ type: 'error', url: url, detail: 'load-error' });
		};
		try {
			iframe.src = msg.url;
		} catch (err) {
			clearLoadTimer();
			showOverlay('Failed to navigate to ' + msg.url);
			vscode.postMessage({ type: 'error', url: currentUrl, detail: String(err) });
		}
		return;
	}
	if (msg.type === 'clear') {
		currentUrl = '';
		clearLoadTimer();
		iframe.removeAttribute('src');
		showOverlay(msg.reason || 'Start the preview server or Connect to a local URL.');
		return;
	}
	if (msg.type === 'back') {
		try { iframe.contentWindow && iframe.contentWindow.history.back(); } catch (e) {}
		return;
	}
	if (msg.type === 'forward') {
		try { iframe.contentWindow && iframe.contentWindow.history.forward(); } catch (e) {}
		return;
	}
	if (msg.type === 'reload') {
		try {
			if (iframe.contentWindow) { iframe.contentWindow.location.reload(); }
			else if (currentUrl) { iframe.src = currentUrl; }
		} catch (e) {
			if (currentUrl) { iframe.src = currentUrl; }
		}
	}
});

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
	}
}

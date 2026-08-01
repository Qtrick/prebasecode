/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../../base/browser/dom.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { localize } from '../../../../../../nls.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IEditorOptions } from '../../../../../../platform/editor/common/editor.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../../common/editor.js';
import { IEditorGroup } from '../../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { IWebviewElement, IWebviewService } from '../../../../webview/browser/webview.js';
import { PreBaseGraphConfigKeys } from '../../common/configuration/graphConfigKeys.js';
import { PreBaseGraphEditorInput } from './graphEditorInput.js';
import { IPreBaseGraphDescriptionService } from './prebaseGraphDescriptionService.js';
import { IPreBaseGraphService } from './prebaseGraphService.js';
import { isCodeGraphCanvas, type PreBaseGraphType } from '../../common/types/graphProduct.js';

interface IBridgeRequest {
	requestId: string;
	type: string;
	payload?: unknown;
}

export class PreBaseGraphEditor extends EditorPane {
	static readonly ID = 'workbench.editor.prebaseGraph';

	private _container: HTMLElement | undefined;
	private _webview: IWebviewElement | undefined;
	private readonly _webviewDisposables = this._register(new DisposableStore());
	private _inputType: PreBaseGraphType = 'code';
	private _scanKickoff = false;
	private _descriptionCts: CancellationTokenSource | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IPreBaseGraphService private readonly graphService: IPreBaseGraphService,
		@IPreBaseGraphDescriptionService private readonly descriptionService: IPreBaseGraphDescriptionService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(PreBaseGraphEditor.ID, group, telemetryService, themeService, storageService);
		this._register(this.graphService.onDidChangeSnapshot(() => this._pushSnapshot()));
		this._register(this.graphService.onDidChangeViewState(() => this._pushSnapshot()));
		this._register(this.graphService.onDidChangeDiagnostics(() => this._pushSnapshot()));
		this._register(this.graphService.onDidChangeHiddenCommunities(() => this._pushSnapshot()));
		this._register(this.graphService.onDidRequestCameraAction(action => {
			// Shared graph service — only the matching input may react (legacy dual-tab safety).
			if (!this._ownsActiveGraphType()) {
				return;
			}
			this._webview?.postMessage({ type: action === 'reset' ? 'resetView' : 'fitView' });
		}));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('prebase.graph') || e.affectsConfiguration('prebase.interaction')) {
				this._pushSnapshot();
			}
		}));
	}

	/** True when this editor input matches the singleton service graph type. */
	private _ownsActiveGraphType(): boolean {
		const serviceType = this.graphService.getViewState().graphType;
		// Code and legacy network share the canvas path; treat them as matching for ownership.
		if (isCodeGraphCanvas(this._inputType) && isCodeGraphCanvas(serviceType)) {
			return true;
		}
		return this._inputType === serviceType;
	}

	protected createEditor(parent: HTMLElement): void {
		this._container = DOM.append(parent, DOM.$('.prebase-graph-editor'));
		this._container.style.width = '100%';
		this._container.style.height = '100%';
		this._container.style.position = 'relative';
	}

	override async setInput(input: PreBaseGraphEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested || !(input instanceof PreBaseGraphEditorInput) || !this._container) {
			return;
		}
		this._inputType = input.graphType;
		// Never await scan/layout here — that freezes the workbench and prevents tab close.
		void this.graphService.setGraphType(input.graphType);
		this._ensureWebview();
		this._pushSnapshot();

		if (!this.graphService.getSnapshot()) {
			const status = this.graphService.getDiagnostics().status;
			if (status !== 'scanning' && !this._scanKickoff) {
				this._scanKickoff = true;
				void this.graphService.scanWorkspace().finally(() => {
					this._scanKickoff = false;
				});
			}
		}
	}

	override clearInput(): void {
		this._scanKickoff = false;
		this._cancelDescription();
		this._webviewDisposables.clear();
		this._webview = undefined;
		if (this._container) {
			DOM.clearNode(this._container);
		}
		super.clearInput();
	}

	override dispose(): void {
		this._cancelDescription();
		super.dispose();
	}

	private _cancelDescription(): void {
		this._descriptionCts?.cancel();
		this._descriptionCts?.dispose();
		this._descriptionCts = undefined;
	}

	/** Resolve open/reveal targets only against known graph nodes (webview messages are untrusted). */
	private _resolveNodeResource(path: string | undefined): URI | undefined {
		if (!path) {
			return undefined;
		}
		const snapshot = this.graphService.getSnapshot();
		if (!snapshot) {
			return undefined;
		}
		const node = snapshot.nodes.find(n =>
			n.id === path
			|| n.path === path
			|| n.id === `file:${path}`
			|| (!!n.path && `file:${n.path}` === path)
		);
		if (!node) {
			return undefined;
		}
		const relative = (node.path || node.id.replace(/^file:/, '')).replace(/\\/g, '/');
		if (!relative || relative.startsWith('/') || /^[A-Za-z]:/.test(relative) || relative.split('/').includes('..')) {
			return undefined;
		}
		const projectPath = snapshot.projectPath;
		if (!projectPath) {
			return undefined;
		}
		return URI.joinPath(URI.file(projectPath), relative);
	}

	override layout(dimension: DOM.Dimension): void {
		if (this._container) {
			this._container.style.width = `${dimension.width}px`;
			this._container.style.height = `${dimension.height}px`;
		}
	}

	private _ensureWebview(): void {
		if (!this._container || this._webview) {
			return;
		}
		this._webviewDisposables.clear();
		const webview = this._webviewDisposables.add(this.webviewService.createWebviewElement({
			title: localize('prebase.graph.webviewTitle', "Code Graph"),
			// Release GPU/CPU when the tab is hidden so the window stays closable.
			options: { retainContextWhenHidden: false },
			contentOptions: {
				allowScripts: true,
				localResourceRoots: []
			},
			extension: undefined
		}));
		webview.mountTo(this._container, this.window);
		webview.setHtml(this._buildHtml());
		this._webviewDisposables.add(webview.onMessage(e => { void this._onMessage(e.message as IBridgeRequest); }));
		this._webview = webview;
	}

	private _graphSettings() {
		const quality = this.configurationService.getValue<string>(PreBaseGraphConfigKeys.GraphQuality) || 'auto';
		const maxNodes = this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphMaxRenderedNodes) || 280;
		const maxEdges = this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphMaxRenderedEdges) || 420;
		const networkDragDirection = this.configurationService.getValue<string>(PreBaseGraphConfigKeys.InteractionNetworkDragDirection) === 'inverted'
			? 'inverted'
			: 'natural';
		return {
			showLegend: this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphShowLegend) !== false,
			initialZoom: this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphInitialZoom) || 1,
			reduceMotion: this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphReduceMotion) === true,
			networkIdleAutoRotate: !!this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate),
			networkDragDirection,
			maxRenderedEdges: quality === 'performance' ? Math.min(280, maxEdges) : maxEdges,
			maxRenderedNodes: (quality === 'performance') ? Math.min(180, maxNodes) : maxNodes,
			quality
		};
	}

	private _pushSnapshot(): void {
		if (!this._webview || !this._ownsActiveGraphType()) {
			return;
		}
		const snapshot = this.graphService.getSnapshot();
		const diagnostics = this.graphService.getDiagnostics();
		this._webview.postMessage({
			type: 'snapshot',
			payload: {
				snapshot,
				diagnostics,
				settings: this._graphSettings(),
				graphType: this._inputType,
				// Always send string|null (never undefined) so webview can clear selection.
				selectedNodeId: this.graphService.getSelectedNodeId() ?? null,
				hiddenCommunityIds: this.graphService.getHiddenCommunityIds()
			}
		});
	}

	private async _onMessage(message: IBridgeRequest): Promise<void> {
		if (!message || !message.type) {
			return;
		}
		const reply = async (payload: unknown) => {
			this._webview?.postMessage({ type: 'response', requestId: message.requestId, payload });
		};
		try {
			await this._handleMessage(message, reply);
		} catch (err) {
			// The webview keeps an unsettled promise per request, so a handler that
			// throws would leave its popup stuck on a loading state forever.
			await reply({ error: err instanceof Error ? err.message : String(err) });
		}
	}

	private async _handleMessage(message: IBridgeRequest, reply: (payload: unknown) => Promise<void>): Promise<void> {
		switch (message.type) {
			case 'getSnapshot':
				await reply({
					snapshot: this.graphService.getSnapshot(),
					diagnostics: this.graphService.getDiagnostics(),
					viewState: this.graphService.getViewState(),
					selectedNodeId: this.graphService.getSelectedNodeId() ?? null,
					hiddenCommunityIds: this.graphService.getHiddenCommunityIds(),
					settings: this._graphSettings()
				});
				break;
			case 'selectNode': {
				// Selection must never keep a prior AI describe in flight (privacy).
				this._cancelDescription();
				// Webview messages are untrusted — only accept ids present in the current snapshot.
				const rawId = (message.payload as { nodeId?: string | null } | undefined)?.nodeId;
				if (!rawId) {
					this.graphService.setSelectedNodeId(undefined);
					await reply({ ok: true });
					break;
				}
				const snapshot = this.graphService.getSnapshot();
				const node = snapshot?.nodes.find(n => n.id === rawId);
				// setSelectedNodeId also rejects hidden-community nodes.
				const ok = !!node;
				this.graphService.setSelectedNodeId(ok ? rawId : undefined);
				await reply({ ok: ok && this.graphService.getSelectedNodeId() === rawId });
				break;
			}
			case 'describeNode': {
				const nodeId = (message.payload as { nodeId?: string } | undefined)?.nodeId;
				const snapshot = this.graphService.getSnapshot();
				const node = snapshot?.nodes.find(n => n.id === nodeId);
				if (!node) {
					await reply({ overview: '', aiStatus: 'unavailable' });
					break;
				}
				this._cancelDescription();
				this._descriptionCts = new CancellationTokenSource();
				const result = await this.descriptionService.describeNode(node, this._descriptionCts.token);
				await reply(result);
				break;
			}
			case 'explainNode': {
				// Local deterministic explain — never triggers AI.
				const nodeId = (message.payload as { nodeId?: string } | undefined)?.nodeId;
				if (!nodeId) {
					await reply({ found: false });
					break;
				}
				const raw = this.graphService.explainNodeForMagnus(nodeId);
				if (!raw) {
					await reply({ found: false, nodeId });
					break;
				}
				try {
					await reply(JSON.parse(raw));
				} catch {
					await reply({ found: false, nodeId });
				}
				break;
			}
			case 'openFile':
			case 'revealFile': {
				const path = (message.payload as { path?: string } | undefined)?.path;
				const uri = this._resolveNodeResource(path);
				if (uri) {
					try {
						await this.editorService.openEditor({ resource: uri, options: { pinned: false } });
					} catch {
						// ignore missing files
					}
				}
				await reply({ ok: !!uri });
				break;
			}
			case 'setNetworkIdleAutoRotate': {
				const enabled = !!(message.payload as { enabled?: boolean } | undefined)?.enabled;
				await this.configurationService.updateValue(PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate, enabled);
				await reply({ ok: true });
				break;
			}
			case 'attachToMagnus': {
				const summary = this.graphService.getSelectionSummaryForMagnus();
				if (summary) {
					await this.commandService.executeCommand('prebase.magnus.attachGraphSelection', summary);
				}
				await reply({
					ok: !!summary,
					message: summary
						? localize('prebase.graph.magnusAttached', "Graph selection attached to Agents.")
						: localize('prebase.graph.magnusNoSelection', "Select a node first.")
				});
				break;
			}
			default:
				await reply({ ok: false });
				break;
		}
	}

	private _buildHtml(): string {
		const nonce = generateUuid();
		return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
/* Surfaces come from the workbench theme (webviews receive --vscode-* variables),
   so the graph follows PreBase's dark surface roles, user colour customizations
   and High Contrast themes instead of a private palette. */
html, body { margin:0; height:100%; background:var(--vscode-editor-background); color:var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); overflow:hidden; }
#stage { position:absolute; inset:0; }
#netCanvas { position:absolute; inset:0; width:100%; height:100%; display:none; touch-action:none; cursor:grab; }
#netCanvas.dragging { cursor:grabbing; }
:focus-visible { outline:1px solid var(--vscode-focusBorder); outline-offset:1px; }
#toolbar { position:absolute; left:12px; bottom:56px; z-index:4; display:flex; gap:4px; align-items:center; background:var(--vscode-editorWidget-background); border:1px solid var(--vscode-editorWidget-border); border-radius:8px; padding:4px; box-shadow:0 2px 8px var(--vscode-widget-shadow, transparent); }
#toolbar button, #toolbar label { background:transparent; color:var(--vscode-foreground); border:0; border-radius:6px; padding:6px 8px; cursor:pointer; font-size:12px; }
#toolbar button:hover { background:var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
/* More specific than #toolbar label so Idle stays hidden before script runs. */
#toolbar label { gap:4px; align-items:center; user-select:none; opacity:.9; }
#toolbar label#idleToggleWrap { display:none; }
#toolbar label#idleToggleWrap.is-visible { display:flex; }
#status { position:absolute; left:50%; transform:translateX(-50%); bottom:14px; z-index:4; font-size:12px; background:var(--vscode-editorWidget-background); border:1px solid var(--vscode-editorWidget-border); border-radius:999px; padding:6px 14px; white-space:nowrap; max-width:90%; overflow:hidden; text-overflow:ellipsis; }
#legend { position:absolute; left:12px; bottom:100px; z-index:4; background:var(--vscode-editorWidget-background); border:1px solid var(--vscode-editorWidget-border); border-radius:10px; padding:10px 12px; font-size:11px; min-width:140px; max-width:220px; }
#legend .title { font-weight:700; margin-bottom:6px; letter-spacing:.02em; text-transform:uppercase; opacity:.75; font-size:10px; }
#legend .row { display:flex; align-items:center; gap:8px; margin:3px 0; }
#legend .swatch { width:10px; height:10px; border-radius:2px; flex:0 0 auto; }
#legend .swatch.circle { border-radius:50%; }
#legend .swatch.line { height:2px; width:16px; border-radius:1px; }
#legend .swatch.line.dashed { background:transparent; height:0; border-radius:0; border-top:2px dashed var(--prebase-edge-line); }
#legend .swatch.line.dotted { background:transparent; height:0; border-radius:0; border-top:2px dotted var(--prebase-edge-line); }
#empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:2; text-align:center; padding:24px; color:var(--vscode-descriptionForeground); font-size:14px; line-height:1.5; }
/* The inspector floats above the canvas, so it uses the most elevated surface role. */
#popup { position:absolute; z-index:6; width:min(320px, calc(100% - 24px)); max-height:min(420px, calc(100% - 48px)); overflow:auto; display:none; background:var(--vscode-editorHoverWidget-background); border:1px solid var(--vscode-editorHoverWidget-border); border-radius:12px; padding:12px; box-shadow:0 16px 40px var(--vscode-widget-shadow, transparent); }
#popup h3 { margin:0 0 4px; font-size:13px; }
#popup .meta { color:var(--vscode-descriptionForeground); font-size:11px; margin-bottom:8px; word-break:break-word; }
#popup .label { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--vscode-descriptionForeground); margin:10px 0 4px; }
#popup p { margin:0; font-size:12px; line-height:1.45; color:var(--vscode-foreground); white-space:pre-wrap; }
#popup .actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
#popup button { font-size:11px; border-radius:7px; border:1px solid var(--vscode-editorWidget-border); background:var(--vscode-button-secondaryBackground, transparent); color:var(--vscode-button-secondaryForeground); padding:5px 8px; cursor:pointer; }
#popup button:hover { background:var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
#popup button.primary { border-color:var(--vscode-button-border, transparent); color:var(--vscode-button-foreground); background:var(--vscode-button-background); }
#popup button.primary:hover { background:var(--vscode-button-hoverBackground); }
#popup #popupClose { float:right; border:0; background:transparent; color:var(--vscode-descriptionForeground); font-size:16px; }
</style>
</head>
<body>
<div id="stage">
	<div id="empty">Preparing graph…</div>
	<canvas id="netCanvas" role="img" aria-label="Code Graph canvas"></canvas>
</div>
<div id="legend" style="display:none"></div>
<div id="popup" role="dialog" aria-modal="false" aria-label="Node details">
	<button id="popupClose" type="button" title="Close" aria-label="Close node details">×</button>
	<h3 id="popupTitle"></h3>
	<div class="meta" id="popupMeta"></div>
	<div class="label">Structure (local)</div>
	<p id="popupOverview" style="white-space:pre-wrap"></p>
	<div class="label">AI description (explicit only)</div>
	<p id="popupAi"></p>
	<div class="actions">
		<button class="primary" id="popupOpen" type="button">Open File</button>
		<button id="popupReveal" type="button">Reveal</button>
		<button id="popupExplainAi" type="button">Request AI description</button>
		<button id="popupMagnus" type="button">Attach to Agents</button>
	</div>
</div>
<div id="toolbar">
	<button id="zoomIn" title="Zoom in">+</button>
	<button id="zoomOut" title="Zoom out">−</button>
	<button id="fit" title="Fit">⛶</button>
	<button id="reset" title="Reset">↻</button>
	<label id="idleToggleWrap"><input type="checkbox" id="idleToggle"> Idle</label>
</div>
<div id="status">Scanning…</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const netCanvas = document.getElementById('netCanvas');
const ctx = netCanvas.getContext('2d', { alpha: true });
const status = document.getElementById('status');
const legend = document.getElementById('legend');
const empty = document.getElementById('empty');
const idleToggle = document.getElementById('idleToggle');
const idleToggleWrap = document.getElementById('idleToggleWrap');
const popup = document.getElementById('popup');
const popupTitle = document.getElementById('popupTitle');
const popupMeta = document.getElementById('popupMeta');
const popupOverview = document.getElementById('popupOverview');
const popupAi = document.getElementById('popupAi');
let popupNode = null;
let pointerDownNode = null;
let pointerDownX = 0, pointerDownY = 0;
let interactionState = 'idle';
let dragThreshold = 4;
const NODE_SCALE = 1;

const FOCAL = 640;
const IDLE_YAW = 0.08;
const IDLE_RESUME_MS = 1400;
const ENTRY = '#e8b84a';
// Edge colours are shared by the canvas renderer and the legend so the two cannot drift.
const EDGE_IMPORT_RGB = '125,170,220';
const EDGE_CONTAINS_RGB = '167,139,250';
const EDGE_IMPORT = 'rgb(' + EDGE_IMPORT_RGB + ')';
const EDGE_CONTAINS = 'rgb(' + EDGE_CONTAINS_RGB + ')';
document.documentElement.style.setProperty('--prebase-edge-line', EDGE_IMPORT);
const FILE_COLORS = {
	typescript:'#3178c6', javascript:'#f1e05a', css:'#a371f7', html:'#e34c26',
	markdown:'#519aba', image:'#c678dd', config:'#6b7280', other:'#71717a'
};

let transform = { x: 0, y: 0, k: 1 };
let rotation = { yaw: 0.55, pitch: 0.28 };
let snapshot = null;
let diagnostics = null;
let selectedNodeId = null;
let hiddenCommunityLookup = Object.create(null);
let settings = { showLegend:true, reduceMotion:false, networkIdleAutoRotate:false, networkDragDirection:'natural', maxRenderedEdges:420, maxRenderedNodes:280, quality:'auto' };
let graphType = 'code';
let dragging = false, panning = false, rotating = false;
let lastX = 0, lastY = 0, moved = false;
let activePointerId = null, activePointerHost = null;
let layoutKey = '';
let base3d = Object.create(null);
let centroid = { x:0, y:0 };
let projected = Object.create(null);
let idlePaused = true;
let idleResumeTimer = null;
let lastRafTs = 0;
let dirty = true;
let rafHandle = 0;
let dpr = Math.min(2, window.devicePixelRatio || 1);
const pending = new Map();

// The render loop parks itself when the scene is static so an open, idle graph
// tab does not keep the compositor awake at 60Hz. Anything that invalidates the
// scene must go through markDirty() so the loop is restarted.
function wakeRaf() {
	if (rafHandle) return;
	lastRafTs = 0;
	rafHandle = requestAnimationFrame(rafLoop);
}
function markDirty() {
	dirty = true;
	wakeRaf();
}

// If the host never answers (editor disposed mid-request, handler crash) the
// caller must still settle, otherwise the UI waiting on it stays on a spinner.
const REQUEST_TIMEOUT_MS = 20000;
function request(type, payload) {
	const requestId = Math.random().toString(36).slice(2);
	return new Promise(function (resolve) {
		const timer = setTimeout(function () {
			if (pending.delete(requestId)) resolve({ error: 'timeout' });
		}, REQUEST_TIMEOUT_MS);
		pending.set(requestId, function (value) {
			clearTimeout(timer);
			resolve(value);
		});
		vscode.postMessage({ requestId: requestId, type: type, payload: payload });
	});
}

function setHiddenCommunityIds(ids) {
	hiddenCommunityLookup = Object.create(null);
	const list = Array.isArray(ids) ? ids : [];
	for (let i = 0; i < list.length; i++) {
		const id = list[i];
		if (typeof id === 'number' && isFinite(id)) hiddenCommunityLookup[id] = true;
	}
}

function isNodeHiddenByCommunity(node) {
	if (!node || !node.meta || typeof node.meta.communityId !== 'number') return false;
	return !!hiddenCommunityLookup[node.meta.communityId];
}

function thresholdForPointer(pointerType) {
	if (pointerType === 'touch') return 8;
	if (pointerType === 'pen') return 6;
	return 4;
}

// Screen Y increases downward. The graph is grabbed directly: dragging right
// brings its left side forward, while dragging down rolls the graph upward.
// The inverted setting flips this single mapping for both axes.
function mapPointerDeltaToGraphRotation(dx, dy) {
	const direction = settings.networkDragDirection === 'inverted' ? -1 : 1;
	const sensitivity = 0.005 * direction;
	return { yaw: -dx * sensitivity, pitch: dy * sensitivity };
}

function wrapRotationAngle(angle) {
	const fullTurn = Math.PI * 2;
	return ((angle + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

function fileType(path) {
	if (!path) return { id:'other', name:'Other', color:FILE_COLORS.other };
	const base = String(path).split(/[/\\\\]/).pop() || path;
	const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
	if (ext === 'ts' || ext === 'tsx' || ext === 'mts' || ext === 'cts') return { id:'typescript', name:'TypeScript', color:FILE_COLORS.typescript };
	if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return { id:'javascript', name:'JavaScript', color:FILE_COLORS.javascript };
	if (ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') return { id:'css', name:'CSS/SCSS', color:FILE_COLORS.css };
	if (ext === 'html' || ext === 'htm') return { id:'html', name:'HTML', color:FILE_COLORS.html };
	if (ext === 'md' || ext === 'mdx') return { id:'markdown', name:'Markdown', color:FILE_COLORS.markdown };
	if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp' || ext === 'svg' || ext === 'ico') return { id:'image', name:'Image', color:FILE_COLORS.image };
	if (ext === 'json' || ext === 'yaml' || ext === 'yml' || ext === 'toml' || ext === 'env' || ext === 'ini' || base.startsWith('.')) return { id:'config', name:'Config', color:FILE_COLORS.config };
	return { id:'other', name: ext ? ext.toUpperCase() : 'Other', color:FILE_COLORS.other };
}

function communityColor(communityId) {
	const hue = (Math.abs(communityId) * 47) % 360;
	return 'hsl(' + hue + ' 62% 52%)';
}

function nodeColor(node, entryId) {
	if (node.id === entryId || node.isEntry) return ENTRY;
	// Default: community (Graphify-inspired clusters); fall back to file type.
	const cid = node.meta && typeof node.meta.communityId === 'number' ? node.meta.communityId : null;
	if (cid !== null && isFinite(cid)) {
		return communityColor(cid);
	}
	return fileType(node.path || node.label).color;
}

function edgeDashForConfidence(confidence) {
	if (confidence === 'INFERRED') return [6, 4];
	if (confidence === 'AMBIGUOUS') return [2, 3];
	return null; // EXTRACTED / unknown → solid
}

function projectPoint(x, y, z, yaw, pitch) {
	const cp = Math.cos(pitch), sp = Math.sin(pitch);
	const y1 = y * cp - z * sp;
	const z1 = y * sp + z * cp;
	const cy = Math.cos(yaw), sy = Math.sin(yaw);
	const x2 = x * cy + z1 * sy;
	const z2 = -x * sy + z1 * cy;
	const depthScale = FOCAL / Math.max(FOCAL * 0.42, FOCAL + z2);
	return { x: x2 * depthScale, y: y1 * depthScale, z: z2, depthScale: depthScale };
}

function scheduleIdleResume() {
	idlePaused = true;
	markDirty();
	if (idleResumeTimer) clearTimeout(idleResumeTimer);
	idleResumeTimer = null;
	if (!settings.networkIdleAutoRotate || settings.reduceMotion) return;
	idleResumeTimer = setTimeout(function () {
		idleResumeTimer = null;
		if (settings.networkIdleAutoRotate && !settings.reduceMotion && !dragging) {
			idlePaused = false;
			wakeRaf();
		}
	}, IDLE_RESUME_MS);
}

function clearIdleTimers() {
	idlePaused = true;
	if (idleResumeTimer) clearTimeout(idleResumeTimer);
	idleResumeTimer = null;
}

function resetCamera(preserveZoom) {
	rotation = { yaw: 0.55, pitch: 0.28 };
	if (!preserveZoom) transform = { x: 0, y: 0, k: settings.initialZoom || 1 };
	scheduleIdleResume();
	markDirty();
}

function resizeCanvas() {
	const w = netCanvas.clientWidth || window.innerWidth || 800;
	const h = netCanvas.clientHeight || window.innerHeight || 600;
	dpr = Math.min(settings.quality === 'performance' ? 1.25 : 2, window.devicePixelRatio || 1);
	netCanvas.width = Math.max(1, Math.floor(w * dpr));
	netCanvas.height = Math.max(1, Math.floor(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	markDirty();
}

function rebuildBase3d(s) {
	// layoutMode is a legacy Arch field — networkLayoutMode drives Code Graph rebuilds.
	const key = [s.scannedAt, s.networkLayoutMode || '', s.graphType, (s.nodes || []).length, (s.edges || []).length].join('|');
	if (key === layoutKey && Object.keys(base3d).length) return false;
	layoutKey = key;
	base3d = Object.create(null);
	const nodes = s.nodes || [];
	const p3 = s.positions3d || null;

	// Prefer canonical 3D layout from the host. Never invent depth by hashing 2D coords.
	if (p3 && typeof p3 === 'object') {
		let sx = 0, sy = 0, sz = 0, n = 0;
		for (let i = 0; i < nodes.length; i++) {
			const p = p3[nodes[i].id];
			if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
			sx += p.x; sy += p.y; sz += p.z; n++;
		}
		centroid = n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
		const cz = n ? sz / n : 0;
		for (let i = 0; i < nodes.length; i++) {
			const p = p3[nodes[i].id];
			if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
			base3d[nodes[i].id] = { x: p.x - centroid.x, y: p.y - centroid.y, z: p.z - cz };
		}
		return true;
	}

	centroid = { x: 0, y: 0 };
	return true;
}

function projectAll() {
	projected = Object.create(null);
	const ids = Object.keys(base3d);
	for (let i = 0; i < ids.length; i++) {
		const b = base3d[ids[i]];
		const pr = projectPoint(b.x, b.y, b.z, rotation.yaw, rotation.pitch);
		projected[ids[i]] = {
			x: centroid.x + pr.x,
			y: centroid.y + pr.y,
			depthScale: pr.depthScale,
			z: pr.z
		};
	}
}

function screenPos(id) {
	return projected[id] || null;
}

function fitView() {
	if (!snapshot || !(snapshot.nodes || []).length) return;
	const nodes = snapshot.nodes;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let i = 0; i < nodes.length; i++) {
		if (isNodeHiddenByCommunity(nodes[i])) continue;
		const p = screenPos(nodes[i].id);
		if (!p) continue;
		const r = 16;
		minX = Math.min(minX, p.x - r); minY = Math.min(minY, p.y - r);
		maxX = Math.max(maxX, p.x + r); maxY = Math.max(maxY, p.y + r);
	}
	if (!isFinite(minX)) return;
	const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
	const vw = netCanvas.clientWidth || 800, vh = netCanvas.clientHeight || 600;
	const k = Math.min(vw / (bw + 120), vh / (bh + 120), 1.8) * (settings.initialZoom || 1);
	transform = { k: k, x: (vw - bw * k) / 2 - minX * k, y: (vh - bh * k) / 2 - minY * k };
	markDirty();
}

function updateLegend(s, network) {
	if (!settings.showLegend || !s || !(s.nodes || []).length) {
		legend.style.display = 'none';
		return;
	}
	const types = new Map();
	for (let i = 0; i < s.nodes.length; i++) {
		const t = fileType(s.nodes[i].path || s.nodes[i].label);
		if (!types.has(t.id)) types.set(t.id, t);
	}
	// Node fill is community-colored by default; file-type swatches are fallback only.
	let html = '<div class="title">Node color</div>';
	html += '<div class="row"><span class="swatch ' + (network ? 'circle' : '') + '" style="background:hsl(94 62% 52%)"></span>Community (default)</div>';
	html += '<div class="row"><span class="swatch ' + (network ? 'circle' : '') + '" style="background:' + ENTRY + '"></span>Entry</div>';
	html += '<div class="title" style="margin-top:8px">Visible edges</div>';
	html += '<div class="row"><span class="swatch line" style="background:' + EDGE_IMPORT + '"></span>Import / dependency</div>';
	html += '<div class="row"><span class="swatch line" style="background:' + EDGE_CONTAINS + '"></span>Contains</div>';
	html += '<div class="title" style="margin-top:8px">Confidence</div>';
	html += '<div class="row"><span class="swatch line" style="background:' + EDGE_IMPORT + '"></span>EXTRACTED (solid)</div>';
	html += '<div class="row"><span class="swatch line dashed"></span>INFERRED (dashed)</div>';
	html += '<div class="row"><span class="swatch line dotted"></span>AMBIGUOUS (dotted)</div>';
	html += '<div class="title" style="margin-top:8px">File type fallback</div>';
	types.forEach(function (t) {
		html += '<div class="row"><span class="swatch ' + (network ? 'circle' : '') + '" style="background:' + t.color + '"></span>' + t.name + '</div>';
	});
	legend.innerHTML = html;
	legend.style.display = 'block';
}

function drawNetworkFrame() {
	if (!snapshot) return;
	const w = netCanvas.clientWidth || 800;
	const h = netCanvas.clientHeight || 600;
	// Full-buffer clear with identity transform so frames never accumulate.
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	ctx.clearRect(0, 0, netCanvas.width, netCanvas.height);
	ctx.restore();
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, w, h);

	// Subtle grid
	ctx.save();
	ctx.strokeStyle = 'rgba(148,163,184,0.08)';
	ctx.lineWidth = 1;
	const grid = 48;
	const ox = ((transform.x % grid) + grid) % grid;
	const oy = ((transform.y % grid) + grid) % grid;
	for (let x = ox; x < w; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
	for (let y = oy; y < h; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
	ctx.restore();

	projectAll();
	const maxEdges = Math.max(40, settings.maxRenderedEdges || 420);
	const edges = (snapshot.edges || []).slice(0, maxEdges);
	const hiddenNodes = Object.create(null);
	const allNodes = snapshot.nodes || [];
	for (let i = 0; i < allNodes.length; i++) {
		if (isNodeHiddenByCommunity(allNodes[i])) hiddenNodes[allNodes[i].id] = true;
	}
	ctx.save();
	ctx.translate(transform.x, transform.y);
	ctx.scale(transform.k, transform.k);

	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		const a = projected[e.source], b = projected[e.target];
		if (!a || !b) continue;
		if (hiddenNodes[e.source] || hiddenNodes[e.target]) continue;
		const avg = ((a.depthScale || 1) + (b.depthScale || 1)) / 2;
		const conf = e.meta && e.meta.confidence;
		const confMul = conf === 'AMBIGUOUS' ? 0.55 : conf === 'INFERRED' ? 0.78 : 1;
		const edgeAlpha = Math.max(0.14, Math.min(0.78, (0.2 + 0.38 * avg) * confMul));
		ctx.beginPath();
		ctx.strokeStyle = 'rgba(' + (e.kind === 'contains' ? EDGE_CONTAINS_RGB : EDGE_IMPORT_RGB) + ',' + edgeAlpha + ')';
		ctx.lineWidth = (conf === 'EXTRACTED' || !conf ? 1.15 : 1) / transform.k;
		const dash = edgeDashForConfidence(conf);
		if (dash) {
			ctx.setLineDash(dash.map(function (d) { return d / transform.k; }));
		} else {
			ctx.setLineDash([]);
		}
		ctx.moveTo(a.x, a.y);
		ctx.lineTo(b.x, b.y);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	const maxNodes = Math.max(40, settings.maxRenderedNodes || 280);
	const nodes = (snapshot.nodes || []).slice(0, maxNodes).slice().sort(function (a, b) {
		// Far nodes first, then nearer nodes on top for visible occlusion.
		return ((projected[b.id] && projected[b.id].z) || 0) - ((projected[a.id] && projected[a.id].z) || 0);
	});
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (isNodeHiddenByCommunity(node)) continue;
		const p = projected[node.id];
		if (!p) continue;
		const r = networkDrawRadius(node, p.depthScale || 1);
		const color = nodeColor(node, snapshot.entryNodeId);
		const isSelected = node.id === selectedNodeId;
		const isEntry = node.id === snapshot.entryNodeId;
		// Dim non-selected nodes when a node is selected (readability for reselection).
		let alpha = 0.42 + normalizeDepthScale(p.depthScale || 1) * 0.58;
		if (selectedNodeId && !isSelected) {
			alpha *= 0.35;
		}
		if (isSelected || isEntry) {
			ctx.beginPath();
			ctx.fillStyle = isSelected ? 'rgba(45,212,191,0.35)' : 'rgba(232,184,74,0.28)';
			ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.beginPath();
		ctx.fillStyle = color;
		ctx.globalAlpha = alpha;
		ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.lineWidth = 1.25 / transform.k;
		ctx.strokeStyle = isSelected ? '#2dd4bf' : 'rgba(255,255,255,0.22)';
		ctx.stroke();
	}
	ctx.restore();
	dirty = false;
}

function normalizeDepthScale(depthScale) {
	return Math.max(0, Math.min(1, (depthScale - 0.62) / 1.15));
}

function networkNodeVal(node) {
	if (typeof node.val === 'number' && node.val > 0) return node.val;
	const imp = node.meta && typeof node.meta.importance === 'number' ? node.meta.importance : 0;
	if (imp > 0) return Math.max(1.5, 1.2 + Math.sqrt(imp) * 1.4);
	if (node.isEntry) return 10;
	return 1.5;
}

function networkDrawRadius(node, depthScale) {
	const scaleMul = Math.max(0.76, Math.min(1.38, 0.76 + normalizeDepthScale(depthScale) * 0.62));
	return (Math.sqrt(networkNodeVal(node)) * NODE_SCALE * 1.7 + 1.6) * scaleMul;
}

function networkPickRadius(node) {
	return Math.max(18, Math.sqrt(networkNodeVal(node)) * NODE_SCALE * 3.2 + 10);
}

function pickNetworkNode(clientX, clientY) {
	if (!snapshot) return null;
	const rect = netCanvas.getBoundingClientRect();
	const x = (clientX - rect.left - transform.x) / transform.k;
	const y = (clientY - rect.top - transform.y) / transform.k;
	let best = null, bestScore = -Infinity;
	const nodes = snapshot.nodes || [];
	for (let i = 0; i < nodes.length; i++) {
		if (isNodeHiddenByCommunity(nodes[i])) continue;
		const p = projected[nodes[i].id];
		if (!p) continue;
		const d = Math.hypot(p.x - x, p.y - y);
		const r = networkPickRadius(nodes[i]);
		if (d <= r) {
			// Frontmost: prefer smaller projected z (closer to camera), then nearer hit.
			const score = -(typeof p.z === 'number' ? p.z : 0) * 1000 - d;
			if (score > bestScore) { bestScore = score; best = nodes[i]; }
		}
	}
	return best;
}

function graphStatusLine() {
	if (!snapshot) return 'Idle';
	const totalNodes = (snapshot.nodes || []).length;
	const totalEdges = (snapshot.edges || []).length;
	const maxNodes = Math.max(40, settings.maxRenderedNodes || 280);
	const maxEdges = Math.max(40, settings.maxRenderedEdges || 420);
	const renderedNodes = Math.min(totalNodes, maxNodes);
	const renderedEdges = Math.min(totalEdges, maxEdges);
	const omittedN = Math.max(0, totalNodes - renderedNodes);
	const omittedE = Math.max(0, totalEdges - renderedEdges);
	let base = (diagnostics && diagnostics.message)
		|| (totalNodes + ' nodes · ' + totalEdges + ' links');
	if (omittedN || omittedE) {
		base += ' · showing ' + renderedNodes + '/' + totalNodes + ' nodes, '
			+ renderedEdges + '/' + totalEdges + ' edges'
			+ ' (omitted ' + omittedN + ' nodes, ' + omittedE + ' edges)';
	}
	return 'Code Graph · ' + base + ' · drag to rotate · scroll to zoom';
}

function render(full) {
	idleToggleWrap.classList.add('is-visible');
	idleToggle.checked = !!settings.networkIdleAutoRotate;

	if (!snapshot || !(snapshot.nodes || []).length) {
		netCanvas.style.display = 'none';
		legend.style.display = 'none';
		empty.style.display = 'flex';
		const msg = (diagnostics && diagnostics.message) || (diagnostics && diagnostics.status === 'scanning' ? 'Scanning workspace…' : 'No graph data yet. Open a folder and Rescan.');
		empty.textContent = msg;
		status.textContent = (diagnostics && diagnostics.status) ? (diagnostics.status + (diagnostics.message ? ' · ' + diagnostics.message : '')) : 'Idle';
		return;
	}

	empty.style.display = 'none';
	status.textContent = graphStatusLine();
	updateLegend(snapshot, true);

	netCanvas.style.display = 'block';
	rebuildBase3d(snapshot);
	resizeCanvas();
	projectAll();
	markDirty();
	drawNetworkFrame();
}

function onSnapshotMessage(payload) {
	const prevScan = snapshot && snapshot.scannedAt;
	const prevNetLayout = snapshot && snapshot.networkLayoutMode;
	const prevType = snapshot && snapshot.graphType;
	const prevMaxNodes = settings.maxRenderedNodes;
	const prevMaxEdges = settings.maxRenderedEdges;
	snapshot = payload && payload.snapshot;
	diagnostics = payload && payload.diagnostics;
	settings = (payload && payload.settings) || settings;
	if (payload && payload.graphType) graphType = payload.graphType;
	else if (snapshot && snapshot.graphType) graphType = snapshot.graphType;
	// Host clears with null; must apply even when falsy (old !== undefined missed undefined clears).
	if (payload && 'selectedNodeId' in payload) selectedNodeId = payload.selectedNodeId || null;
	if (payload && 'hiddenCommunityIds' in payload) setHiddenCommunityIds(payload.hiddenCommunityIds);
	if (selectedNodeId && snapshot) {
		const sel = (snapshot.nodes || []).find(function (n) { return n.id === selectedNodeId; });
		if (isNodeHiddenByCommunity(sel)) selectedNodeId = null;
	}
	idleToggle.checked = !!settings.networkIdleAutoRotate;
	if (!settings.networkIdleAutoRotate || settings.reduceMotion) idlePaused = true;
	else scheduleIdleResume();

	const nextScan = snapshot && snapshot.scannedAt;
	const nextNetLayout = snapshot && snapshot.networkLayoutMode;
	const nextType = snapshot && snapshot.graphType;
	const layoutChanged = prevScan !== nextScan || prevNetLayout !== nextNetLayout || prevType !== nextType || !prevScan;
	const renderBudgetChanged = prevMaxNodes !== settings.maxRenderedNodes || prevMaxEdges !== settings.maxRenderedEdges;
	if (!layoutChanged && !renderBudgetChanged && snapshot && (snapshot.nodes || []).length) {
		empty.style.display = 'none';
		status.textContent = graphStatusLine();
		updateLegend(snapshot, true);
		markDirty();
		drawNetworkFrame();
		return;
	}
	if (layoutChanged) resetCamera(false);
	render(layoutChanged);
	if (layoutChanged && snapshot && snapshot.nodes && snapshot.nodes.length) fitView();
}

window.addEventListener('message', function (event) {
	const msg = event.data;
	if (!msg) return;
	if (msg.type === 'response' && pending.has(msg.requestId)) {
		pending.get(msg.requestId)(msg.payload);
		pending.delete(msg.requestId);
		return;
	}
	if (msg.type === 'snapshot') { onSnapshotMessage(msg.payload); return; }
	if (msg.type === 'resetView') { resetCamera(false); projectAll(); markDirty(); drawNetworkFrame(); fitView(); return; }
	if (msg.type === 'fitView') { projectAll(); fitView(); markDirty(); drawNetworkFrame(); }
});

function closePopup() {
	popup.style.display = 'none';
	popupNode = null;
	scheduleIdleResume();
}

function placePopupNear(clientX, clientY) {
	const rect = netCanvas.getBoundingClientRect();
	const pw = Math.min(320, rect.width - 24);
	let left = clientX - rect.left + 12;
	let top = clientY - rect.top + 12;
	if (left + pw > rect.width - 8) left = Math.max(8, rect.width - pw - 8);
	if (top + 220 > rect.height - 8) top = Math.max(8, clientY - rect.top - 230);
	popup.style.left = left + 'px';
	popup.style.top = top + 'px';
	popup.style.display = 'block';
}

async function openNodePopup(node, clientX, clientY) {
	if (!node) return;
	clearIdleTimers();
	popupNode = node;
	selectedNodeId = node.id;
	popupTitle.textContent = node.label || node.id;
	const community = node.meta && node.meta.communityLabel
		? node.meta.communityLabel
		: (node.meta && typeof node.meta.communityId === 'number' ? ('Community ' + node.meta.communityId) : '');
	const kindBits = [node.kind, node.path, community, node.meta && node.meta.architectureLayer].filter(Boolean);
	popupMeta.textContent = kindBits.join(' · ');
	popupOverview.textContent = 'Loading structure…';
	popupAi.textContent = 'Not requested. Use “Request AI description” for an optional model summary.';
	placePopupNear(clientX, clientY);
	// selectNode cancels any in-flight AI describe; explainNode is local-only.
	request('selectNode', { nodeId: node.id });
	markDirty(); drawNetworkFrame();

	const explained = await request('explainNode', { nodeId: node.id });
	if (!popupNode || popupNode.id !== node.id) return;
	if (explained && explained.found) {
		const conf = explained.confidence || {};
		const deg = explained.degrees || {};
		const lines = [
			'Kind: ' + (explained.kind || node.kind || '—'),
			'Community: ' + (explained.communityLabel || community || '—'),
			'Degree in/out/total: ' + [deg.inDegree, deg.outDegree, deg.degree].map(function (v) { return v == null ? '—' : v; }).join(' / '),
			'Confidence: EXTRACTED ' + (conf.EXTRACTED || 0)
				+ ' · INFERRED ' + (conf.INFERRED || 0)
				+ ' · AMBIGUOUS ' + (conf.AMBIGUOUS || 0)
				+ ' · unknown ' + (conf.unknown || 0)
		];
		if (explained.important) {
			lines.push('Important: rank ' + explained.important.rank + ' · ' + (explained.important.reason || ''));
		}
		const outKinds = Object.keys(explained.outbound || {}).sort();
		const inKinds = Object.keys(explained.inbound || {}).sort();
		if (outKinds.length) {
			lines.push('Outgoing: ' + outKinds.map(function (k) {
				return k + '×' + ((explained.outbound[k] && explained.outbound[k].length) || 0);
			}).join(', '));
		}
		if (inKinds.length) {
			lines.push('Incoming: ' + inKinds.map(function (k) {
				return k + '×' + ((explained.inbound[k] && explained.inbound[k].length) || 0);
			}).join(', '));
		}
		// Outer TS template eats one backslash level; keep join newline as webview JS escape.
		popupOverview.textContent = lines.join('\\n');
	} else {
		popupOverview.textContent = 'No local structure explanation.';
	}
}

function onPointerDown(e, host) {
	if (!e.isPrimary || (e.button !== 0 && e.button !== 1)) return;
	if (popup.style.display !== 'none') {
		closePopup();
	}
	host.setPointerCapture(e.pointerId);
	activePointerId = e.pointerId;
	activePointerHost = host;
	interactionState = 'pressed';
	dragThreshold = thresholdForPointer(e.pointerType);
	dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY;
	pointerDownX = e.clientX; pointerDownY = e.clientY;
	pointerDownNode = pickNetworkNode(e.clientX, e.clientY);
	const wantPan = e.button === 1 || e.shiftKey;
	panning = wantPan;
	rotating = false;
	host.classList.add('dragging');
	if (panning) {
		host.classList.add('panning');
		scheduleIdleResume();
	}
}
function onPointerUp(e, cancelled) {
	if (e.pointerId !== activePointerId) return;
	const pointerHost = activePointerHost;
	activePointerId = null;
	activePointerHost = null;
	if (pointerHost && pointerHost.hasPointerCapture(e.pointerId)) pointerHost.releasePointerCapture(e.pointerId);
	const wasMoved = moved || cancelled;
	dragging = false; panning = false; rotating = false;
	interactionState = cancelled ? 'cancelled' : 'idle';
	pointerDownNode = null;
	netCanvas.classList.remove('dragging');
	netCanvas.classList.remove('panning');
	const dist = e ? Math.hypot((e.clientX || 0) - pointerDownX, (e.clientY || 0) - pointerDownY) : 99;
	if (e && !wasMoved && dist <= dragThreshold) {
		const node = pickNetworkNode(e.clientX, e.clientY);
		if (node) {
			openNodePopup(node, e.clientX, e.clientY);
			return;
		}
		selectedNodeId = null;
		request('selectNode', { nodeId: null });
		closePopup();
		markDirty(); drawNetworkFrame();
	}
	scheduleIdleResume();
}
function onPointerMove(e) {
	if (!dragging || e.pointerId !== activePointerId) return;
	const dx = e.clientX - lastX, dy = e.clientY - lastY;
	const total = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
	if (total > dragThreshold) moved = true;
	if (interactionState === 'pressed' && !panning && moved) {
		rotating = true;
		interactionState = 'rotating';
		scheduleIdleResume();
	}
	lastX = e.clientX; lastY = e.clientY;
	if (rotating) {
		const mapped = mapPointerDeltaToGraphRotation(dx, dy);
		rotation.yaw = wrapRotationAngle(rotation.yaw + mapped.yaw);
		rotation.pitch = wrapRotationAngle(rotation.pitch + mapped.pitch);
		markDirty();
		return;
	}
	if (!moved) return;
	if (!panning) return;
	interactionState = 'panning';
	transform.x += dx; transform.y += dy;
	markDirty();
}
function onWheel(e) {
	e.preventDefault();
	scheduleIdleResume();
	const factor = e.deltaY < 0 ? 1.1 : 0.9;
	const prev = transform.k;
	transform.k = Math.min(3.5, Math.max(0.15, transform.k * factor));
	const rect = netCanvas.getBoundingClientRect();
	const mx = e.clientX - rect.left, my = e.clientY - rect.top;
	transform.x = mx - (mx - transform.x) * (transform.k / prev);
	transform.y = my - (my - transform.y) * (transform.k / prev);
	// Trackpads emit wheel events far faster than 60Hz; let the render loop coalesce.
	markDirty();
}

netCanvas.addEventListener('pointerdown', function (e) { onPointerDown(e, netCanvas); });
netCanvas.addEventListener('pointermove', onPointerMove);
netCanvas.addEventListener('pointerup', function (e) { onPointerUp(e, false); });
netCanvas.addEventListener('pointercancel', function (e) { onPointerUp(e, true); });
netCanvas.addEventListener('lostpointercapture', function (e) { onPointerUp(e, true); });
netCanvas.addEventListener('dblclick', function (e) {
	const node = pickNetworkNode(e.clientX, e.clientY);
	if (node) request('openFile', { path: node.path || node.id.replace(/^file:/, '') });
});
document.getElementById('popupClose').onclick = function () { closePopup(); };
document.getElementById('popupOpen').onclick = function () {
	if (popupNode) request('openFile', { path: popupNode.path || popupNode.id.replace(/^file:/, '') });
};
document.getElementById('popupReveal').onclick = function () {
	if (popupNode) request('revealFile', { path: popupNode.path || popupNode.id.replace(/^file:/, '') });
};
document.getElementById('popupMagnus').onclick = function () { request('attachToMagnus', {}); };
document.getElementById('popupExplainAi').onclick = async function () {
	if (!popupNode) return;
	const nodeId = popupNode.id;
	popupAi.textContent = 'Requesting AI description…';
	const desc = await request('describeNode', { nodeId: nodeId });
	if (!popupNode || popupNode.id !== nodeId) return;
	if (desc && desc.aiStatus === 'ready' && desc.aiDescription) {
		popupAi.textContent = desc.aiDescription + (desc.cacheHit ? ' (cached)' : '');
	} else {
		popupAi.textContent = (desc && (desc.aiMessage || desc.overview)) || 'AI description unavailable.';
	}
};
window.addEventListener('keydown', function (e) {
	if (e.key === 'Escape') { closePopup(); selectedNodeId = null; request('selectNode', { nodeId: null }); markDirty(); drawNetworkFrame(); }
});
netCanvas.addEventListener('wheel', onWheel, { passive: false });
window.addEventListener('resize', function () { resizeCanvas(); markDirty(); drawNetworkFrame(); });

document.getElementById('zoomIn').onclick = function () {
	transform.k = Math.min(3.5, transform.k * 1.15); markDirty();
	drawNetworkFrame();
};
document.getElementById('zoomOut').onclick = function () {
	transform.k = Math.max(0.15, transform.k / 1.15); markDirty();
	drawNetworkFrame();
};
document.getElementById('fit').onclick = function () { projectAll(); fitView(); markDirty(); drawNetworkFrame(); };
document.getElementById('reset').onclick = function () { resetCamera(false); projectAll(); markDirty(); drawNetworkFrame(); fitView(); };
idleToggle.addEventListener('change', function () {
	settings.networkIdleAutoRotate = !!idleToggle.checked;
	request('setNetworkIdleAutoRotate', { enabled: settings.networkIdleAutoRotate });
	scheduleIdleResume();
});

function rafLoop(ts) {
	rafHandle = 0;
	const dt = Math.min(0.05, Math.max(0, (ts - (lastRafTs || ts)) / 1000));
	lastRafTs = ts;
	const animating = settings.networkIdleAutoRotate && !settings.reduceMotion && !idlePaused && !dragging && !document.hidden && snapshot;
	if (animating) {
		rotation.yaw += IDLE_YAW * dt;
		dirty = true;
	}
	// Without a snapshot there is nothing to draw, so staying awake for a dirty
	// flag we cannot clear would spin at 60Hz forever if getSnapshot never
	// answers. render() marks dirty again once a snapshot arrives.
	if (dirty && snapshot) drawNetworkFrame();
	if (animating || (dirty && snapshot)) wakeRaf();
}
wakeRaf();

window.addEventListener('pagehide', clearIdleTimers);
document.addEventListener('visibilitychange', function () {
	if (document.hidden) idlePaused = true;
	else scheduleIdleResume();
});

request('getSnapshot').then(function (res) {
	snapshot = res && res.snapshot;
	diagnostics = res && res.diagnostics;
	selectedNodeId = (res && res.selectedNodeId) || null;
	if (res && res.settings) settings = res.settings;
	if (snapshot && snapshot.graphType) graphType = snapshot.graphType;
	resetCamera(false);
	render(true);
	if (snapshot && snapshot.nodes && snapshot.nodes.length) fitView();
	scheduleIdleResume();
});
</script>
</body>
</html>`;
	}
}

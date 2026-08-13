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
	private _inputType: 'architecture' | 'network' = 'network';
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
		this._register(this.graphService.onDidRequestCameraAction(action => {
			this._webview?.postMessage({ type: action === 'reset' ? 'resetView' : 'fitView' });
		}));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('prebase.graph') || e.affectsConfiguration('prebase.interaction')) {
				this._pushSnapshot();
			}
		}));
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
		this._inputType = 'network';
		// Never await scan/layout here — that freezes the workbench and prevents tab close.
		void this.graphService.setGraphType('network');
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
			title: localize('prebase.graph.webviewTitle', "PreBase Graph"),
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
		this._webviewDisposables.add(webview.onMessage(e => this._onMessage(e.message as IBridgeRequest)));
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
		if (!this._webview) {
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
				selectedNodeId: this.graphService.getSelectedNodeId() ?? null
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

		switch (message.type) {
			case 'getSnapshot':
				await reply({
					snapshot: this.graphService.getSnapshot(),
					diagnostics: this.graphService.getDiagnostics(),
					viewState: this.graphService.getViewState(),
					selectedNodeId: this.graphService.getSelectedNodeId() ?? null,
					settings: this._graphSettings()
				});
				break;
			case 'selectNode': {
				const nodeId = (message.payload as { nodeId?: string | null } | undefined)?.nodeId;
				this.graphService.setSelectedNodeId(nodeId || undefined);
				await reply({ ok: true });
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
html, body { margin:0; height:100%; background:var(--vscode-editor-background, #1B1C1E); color:var(--vscode-foreground, #f4f4f5); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; overflow:hidden; }
#stage { position:absolute; inset:0; }
#archSvg, #netCanvas { position:absolute; inset:0; width:100%; height:100%; display:none; touch-action:none; }
#archSvg { cursor:grab; }
#archSvg.dragging, #archSvg.panning { cursor:grabbing; }
#netCanvas { cursor:grab; }
#netCanvas.dragging { cursor:grabbing; }
#toolbar { position:absolute; left:12px; bottom:56px; z-index:4; display:flex; gap:4px; align-items:center; background:color-mix(in srgb, var(--vscode-editorWidget-background, #303030) 88%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:8px; padding:4px; }
#toolbar button, #toolbar label { background:transparent; color:var(--vscode-foreground, #f4f4f5); border:0; border-radius:6px; padding:6px 8px; cursor:pointer; font-size:12px; }
#toolbar button:hover { background:var(--vscode-toolbar-hoverBackground, #303030); }
#toolbar label { display:flex; gap:4px; align-items:center; user-select:none; opacity:.9; }
#idleToggleWrap { display:none; }
#status { position:absolute; left:50%; transform:translateX(-50%); bottom:14px; z-index:4; font-size:12px; background:color-mix(in srgb, var(--vscode-editorWidget-background, #303030) 90%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:999px; padding:6px 14px; white-space:nowrap; max-width:90%; overflow:hidden; text-overflow:ellipsis; }
#legend { position:absolute; left:12px; bottom:100px; z-index:4; display:none; background:color-mix(in srgb, var(--vscode-editorWidget-background, #303030) 90%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:10px; padding:10px 12px; font-size:11px; min-width:140px; max-width:220px; }
#legend .title { font-weight:700; margin-bottom:6px; letter-spacing:.02em; text-transform:uppercase; opacity:.75; font-size:10px; }
#legend .row { display:flex; align-items:center; gap:8px; margin:3px 0; }
#legend .swatch { width:10px; height:10px; border-radius:2px; flex:0 0 auto; }
#legend .swatch.circle { border-radius:50%; }
#legend .swatch.line { height:2px; width:16px; border-radius:1px; }
#legend .swatch.ft-typescript { background:#3178c6; }
#legend .swatch.ft-javascript { background:#f1e05a; }
#legend .swatch.ft-css { background:#a371f7; }
#legend .swatch.ft-html { background:#e34c26; }
#legend .swatch.ft-markdown { background:#519aba; }
#legend .swatch.ft-image { background:#c678dd; }
#legend .swatch.ft-config { background:#6b7280; }
#legend .swatch.ft-other { background:#71717a; }
#legend .swatch.entry { background:#e8b84a; }
#legend .swatch.import { background:#94a3b8; }
#legend .swatch.root { background:#e8b84a; border-top:1px dashed #e8b84a; }
#legend .swatch.composition { background:#a78bfa; }
#legend .title.spaced { margin-top:8px; }
#empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:2; text-align:center; padding:24px; color:var(--vscode-descriptionForeground, #a1a1aa); font-size:14px; line-height:1.5; }
#popup { position:absolute; z-index:6; width:min(320px, calc(100% - 24px)); max-height:min(420px, calc(100% - 48px)); overflow:auto; display:none; background:var(--vscode-editorWidget-background, #303030); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:12px; padding:12px; box-shadow:0 16px 40px rgba(0,0,0,.45); }
#popup h3 { margin:0 0 4px; font-size:13px; }
#popup .meta { color:var(--vscode-descriptionForeground, #a1a1aa); font-size:11px; margin-bottom:8px; word-break:break-word; }
#popup .label { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--vscode-disabledForeground, #71717a); margin:10px 0 4px; }
#popup p { margin:0; font-size:12px; line-height:1.45; color:var(--vscode-foreground, #f4f4f5); }
#popup .actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
#popup button { font-size:11px; border-radius:7px; border:1px solid var(--vscode-widget-border, #3C3C3C); background:var(--vscode-input-background, #303030); color:var(--vscode-foreground, #f4f4f5); padding:5px 8px; cursor:pointer; }
#popup button.primary { border-color:var(--vscode-button-background, #2dd4bf); color:var(--vscode-button-foreground, #1B1C1E); background:var(--vscode-button-background, #2dd4bf); }
#popup #popupClose { float:right; border:0; background:transparent; color:var(--vscode-descriptionForeground, #a1a1aa); font-size:16px; }
.ring, .pyramid-band, .edge { pointer-events:none; }
.ring { fill:none; opacity:.55; }
.node-label { fill:var(--vscode-foreground, #ecfeff); font-size:10px; pointer-events:none; }
.edge { fill:none; opacity:.45; }
.arch-node { cursor:pointer; }
.arch-node.is-entry rect.node-face { stroke-width:2.4; }
.arch-node.is-selected rect.node-face { stroke:#2dd4bf; stroke-width:2.6; filter:url(#glow); }
.arch-node rect.node-face { fill:var(--vscode-editor-background, #1B1C1E); }
</style>
</head>
<body>
<div id="stage">
	<div id="empty">Preparing graph…</div>
	<svg id="archSvg"></svg>
	<canvas id="netCanvas"></canvas>
</div>
<div id="legend"></div>
<div id="popup" role="dialog" aria-modal="false" aria-label="Node details">
	<button id="popupClose" type="button" title="Close">×</button>
	<h3 id="popupTitle"></h3>
	<div class="meta" id="popupMeta"></div>
	<div class="label">Overview</div>
	<p id="popupOverview"></p>
	<div class="label">AI Description</div>
	<p id="popupAi"></p>
	<div class="actions">
		<button class="primary" id="popupOpen" type="button">Open File</button>
		<button id="popupReveal" type="button">Reveal</button>
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
const archSvg = document.getElementById('archSvg');
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
// Keep ARCH_* in sync with architecturePick.ts (screen-space hit testing).
const ARCH_W = 28, ARCH_H = 28;
/** Minimum Architecture node hit radius in CSS pixels (screen space), independent of zoom. */
const ARCH_MIN_HIT_PX = 10;
const ENTRY = '#e8b84a';
const FILE_COLORS = {
	typescript:'#3178c6', javascript:'#f1e05a', css:'#a371f7', html:'#e34c26',
	markdown:'#519aba', image:'#c678dd', config:'#6b7280', other:'#71717a'
};

let transform = { x: 0, y: 0, k: 1 };
let rotation = { yaw: 0.55, pitch: 0.28 };
let snapshot = null;
let diagnostics = null;
let selectedNodeId = null;
let settings = { showLegend:true, reduceMotion:false, networkIdleAutoRotate:false, networkDragDirection:'natural', maxRenderedEdges:420, maxRenderedNodes:280, quality:'auto' };
let graphType = 'network';
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
let rafScheduled = false;
let dpr = Math.min(2, window.devicePixelRatio || 1);
const pending = new Map();

function request(type, payload) {
	const requestId = Math.random().toString(36).slice(2);
	return new Promise(function (resolve) {
		pending.set(requestId, resolve);
		vscode.postMessage({ requestId: requestId, type: type, payload: payload });
	});
}

function isNetwork() { return graphType === 'network' || (snapshot && snapshot.graphType === 'network'); }

/** The single authority for automatic camera motion; manual camera controls remain available. */
function canIdleRotate() {
	return !!(isNetwork()
		&& snapshot
		&& settings.networkIdleAutoRotate
		&& !settings.reduceMotion
		&& !document.hidden
		&& !dragging
		&& !panning
		&& !rotating
		&& !selectedNodeId);
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

function nodeColor(node, entryId) {
	if (node.id === entryId || node.isEntry) return ENTRY;
	return fileType(node.path || node.label).color;
}

function hash01(id, salt) {
	let h = salt | 0;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
	return ((h >>> 0) % 1000) / 1000;
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
	dirty = true;
	kickRaf();
	if (idleResumeTimer) clearTimeout(idleResumeTimer);
	idleResumeTimer = null;
	if (!canIdleRotate()) return;
	idleResumeTimer = setTimeout(function () {
		idleResumeTimer = null;
		if (canIdleRotate()) {
			idlePaused = false;
			kickRaf();
		}
	}, IDLE_RESUME_MS);
}

function kickRaf() {
	if (rafScheduled) return;
	rafScheduled = true;
	requestAnimationFrame(rafLoop);
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
	dirty = true;
}

function resizeCanvas() {
	const w = netCanvas.clientWidth || window.innerWidth || 800;
	const h = netCanvas.clientHeight || window.innerHeight || 600;
	dpr = Math.min(settings.quality === 'performance' ? 1.25 : 2, window.devicePixelRatio || 1);
	netCanvas.width = Math.max(1, Math.floor(w * dpr));
	netCanvas.height = Math.max(1, Math.floor(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	dirty = true;
}

function rebuildBase3d(s) {
	const key = [s.scannedAt, s.layoutRevision || 0, s.layoutMode, s.networkLayoutMode || '', s.graphType, (s.nodes || []).length, (s.edges || []).length].join('|');
	if (key === layoutKey && Object.keys(base3d).length) return false;
	layoutKey = key;
	base3d = Object.create(null);
	const nodes = s.nodes || [];
	const p3 = s.positions3d || null;
	const network = s.graphType === 'network' || graphType === 'network';

	// Prefer canonical 3D layout from the host (Network). Never invent depth by hashing 2D coords.
	if (p3 && typeof p3 === 'object') {
		let sx = 0, sy = 0, sz = 0, n = 0;
		for (let i = 0; i < nodes.length; i++) {
			const p = p3[nodes[i].id];
			if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
			sx += p.x; sy += p.y; sz += p.z; n++;
		}
		const preserveSemanticCenter = s.networkLayoutMode === 'radial';
		centroid = preserveSemanticCenter ? { x: 0, y: 0 } : (n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 });
		const cz = n ? sz / n : 0;
		for (let i = 0; i < nodes.length; i++) {
			const p = p3[nodes[i].id];
			if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
			base3d[nodes[i].id] = preserveSemanticCenter
				? { x: p.x, y: p.y, z: p.z }
				: { x: p.x - centroid.x, y: p.y - centroid.y, z: p.z - cz };
		}
		if (n > 0 || network) {
			return true;
		}
	}

	// Network must wait for positions3d — never synthesize Z via hash01.
	if (network) {
		centroid = { x: 0, y: 0 };
		return true;
	}

	const positions = s.positions || {};
	let sx = 0, sy = 0, n = 0, maxR = 1;
	const centers = [];
	for (let i = 0; i < nodes.length; i++) {
		const p = positions[nodes[i].id];
		if (!p) continue;
		const cx = p.x + ARCH_W / 2;
		const cy = p.y + ARCH_H / 2;
		centers.push({ id: nodes[i].id, cx: cx, cy: cy });
		sx += cx; sy += cy; n++;
	}
	centroid = n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
	for (let i = 0; i < centers.length; i++) {
		maxR = Math.max(maxR, Math.hypot(centers[i].cx - centroid.x, centers[i].cy - centroid.y));
	}
	// Architecture fallback only: mild deterministic depth for SVG→canvas ports.
	const zSpread = Math.max(80, maxR * 0.5);
	for (let i = 0; i < centers.length; i++) {
		const c = centers[i];
		base3d[c.id] = {
			x: c.cx - centroid.x,
			y: c.cy - centroid.y,
			z: (hash01(c.id, 5) - 0.5) * zSpread
		};
	}
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
	if (isNetwork() && projected[id]) return projected[id];
	const p = snapshot && snapshot.positions && snapshot.positions[id];
	return p ? { x: p.x + ARCH_W / 2, y: p.y + ARCH_H / 2, depthScale: 1, z: 0 } : null;
}

function fitView() {
	if (!snapshot || !(snapshot.nodes || []).length) return;
	const nodes = snapshot.nodes;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let i = 0; i < nodes.length; i++) {
		const p = screenPos(nodes[i].id);
		if (!p) continue;
		const r = isNetwork() ? 16 : ARCH_W / 2;
		minX = Math.min(minX, p.x - r); minY = Math.min(minY, p.y - r);
		maxX = Math.max(maxX, p.x + r); maxY = Math.max(maxY, p.y + r);
	}
	if (!isFinite(minX)) return;
	const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
	const host = isNetwork() ? netCanvas : archSvg;
	const vw = host.clientWidth || 800, vh = host.clientHeight || 600;
	const k = Math.min(vw / (bw + 120), vh / (bh + 120), 1.8) * (settings.initialZoom || 1);
	transform = { k: k, x: (vw - bw * k) / 2 - minX * k, y: (vh - bh * k) / 2 - minY * k };
	dirty = true;
	if (!isNetwork()) applyArchTransform();
	else kickRaf();
}

function applyArchTransform() {
	const g = archSvg.querySelector('#world');
	if (g) g.setAttribute('transform', 'translate(' + transform.x + ',' + transform.y + ') scale(' + transform.k + ')');
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
	let html = '<div class="title">File types</div>';
		types.forEach(function (t) {
			html += '<div class="row"><span class="swatch ft-' + t.id + ' ' + (network ? 'circle' : '') + '"></span>' + t.name + '</div>';
		});
		html += '<div class="row"><span class="swatch entry ' + (network ? 'circle' : '') + '"></span>Entry</div>';
		html += '<div class="title spaced">' + (network ? 'Visible edges' : 'Edges') + '</div>';
		html += '<div class="row"><span class="swatch line import"></span>Import</div>';
		if (!network) html += '<div class="row"><span class="swatch line root"></span>Root</div>';
		else html += '<div class="row"><span class="swatch line composition"></span>Composition</div>';
	legend.innerHTML = html;
	legend.style.display = 'block';
}

function architectureHitRadiusScreen() {
	// Screen-space radius (CSS px): visual half-diagonal + pad, floored at ARCH_MIN_HIT_PX.
	// Convert to world with (screen / zoom) in pickArchitectureNode — do not use a fixed world radius.
	const visual = Math.hypot(ARCH_W / 2, ARCH_H / 2) * Math.max(0.001, transform.k);
	return Math.max(ARCH_MIN_HIT_PX, visual + 4);
}

function pickArchitectureNode(clientX, clientY) {
	// Mirrors pickArchitectureNodeAt in architecturePick.ts (closest center within screen-space halo).
	if (!snapshot || isNetwork()) return null;
	const rect = archSvg.getBoundingClientRect();
	const sx = clientX - rect.left;
	const sy = clientY - rect.top;
	const k = Math.max(0.001, transform.k);
	const wx = (sx - transform.x) / k;
	const wy = (sy - transform.y) / k;
	const hitWorld = architectureHitRadiusScreen() / k;
	let best = null;
	let bestDist = Infinity;
	const maxNodes = Math.max(40, settings.maxRenderedNodes || 280);
	const nodes = (snapshot.nodes || []).slice(0, maxNodes);
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const p = snapshot.positions[node.id];
		if (!p) continue;
		const cx = p.x + ARCH_W / 2;
		const cy = p.y + ARCH_H / 2;
		const d = Math.hypot(wx - cx, wy - cy);
		if (d <= hitWorld && (d < bestDist || (d === bestDist && best && node.id < best.id))) {
			bestDist = d;
			best = node;
		}
	}
	return best;
}

/** Toggle selection styling only — never rebuild SVG / positions on select. */
function updateArchitectureSelection() {
	if (isNetwork()) return;
	const groups = archSvg.querySelectorAll('.arch-node');
	for (let i = 0; i < groups.length; i++) {
		const g = groups[i];
		const id = g.getAttribute('data-node-id');
		if (id && id === selectedNodeId) g.classList.add('is-selected');
		else g.classList.remove('is-selected');
	}
}

function renderArchitecture(s) {
	archSvg.style.display = 'block';
	netCanvas.style.display = 'none';
	idleToggleWrap.style.display = 'none';
	archSvg.innerHTML = '';
	const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
	const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
	filter.setAttribute('id', 'glow');
	filter.setAttribute('x', '-50%'); filter.setAttribute('y', '-50%');
	filter.setAttribute('width', '200%'); filter.setAttribute('height', '200%');
	const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
	blur.setAttribute('stdDeviation', '2.2'); blur.setAttribute('result', 'coloredBlur');
	const merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
	const m1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
	m1.setAttribute('in', 'coloredBlur');
	const m2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
	m2.setAttribute('in', 'SourceGraphic');
	merge.appendChild(m1); merge.appendChild(m2);
	filter.appendChild(blur); filter.appendChild(merge);
	defs.appendChild(filter);
	archSvg.appendChild(defs);

	const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
	world.setAttribute('id', 'world');
	archSvg.appendChild(world);

	const entry = s.entryNodeId && s.positions[s.entryNodeId] ? s.positions[s.entryNodeId] : null;
	const cx = entry ? entry.x + ARCH_W / 2 : 0;
	const cy = entry ? entry.y + ARCH_H / 2 : 0;

	if (s.layoutMode === 'hierarchy' && Array.isArray(s.ringBands)) {
		for (let i = s.ringBands.length - 1; i >= 0; i--) {
			const band = s.ringBands[i];
			const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			ring.setAttribute('class', 'ring');
			ring.setAttribute('cx', String(cx));
			ring.setAttribute('cy', String(cy));
			ring.setAttribute('r', String((band.innerRadius + band.outerRadius) / 2));
			ring.setAttribute('stroke', band.color || '#22d3ee');
			ring.setAttribute('stroke-width', String(Math.max(10, band.outerRadius - band.innerRadius)));
			world.appendChild(ring);
		}
	}
	if (s.layoutMode === 'pyramid' && Array.isArray(s.pyramidBands)) {
		for (let i = 0; i < s.pyramidBands.length; i++) {
			const band = s.pyramidBands[i];
			const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
			rect.setAttribute('class', 'pyramid-band');
			rect.setAttribute('x', String(band.x));
			rect.setAttribute('y', String(band.y));
			rect.setAttribute('width', String(band.width));
			rect.setAttribute('height', String(band.height));
			rect.setAttribute('rx', '10');
			rect.setAttribute('fill', band.color || '#38bdf8');
			rect.setAttribute('opacity', '0.35');
			world.appendChild(rect);
		}
	}

	const maxEdges = Math.max(40, settings.maxRenderedEdges || 420);
	const edges = (s.edges || []).slice(0, maxEdges);
	for (let i = 0; i < edges.length; i++) {
		const edge = edges[i];
		const a = s.positions[edge.source], b = s.positions[edge.target];
		if (!a || !b) continue;
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('class', 'edge');
		path.setAttribute('stroke', edge.kind === 'contains' ? ENTRY : '#64748b');
		path.setAttribute('stroke-dasharray', edge.kind === 'contains' ? '4 3' : '0');
		path.setAttribute('d', 'M' + (a.x + ARCH_W / 2) + ' ' + (a.y + ARCH_H / 2) + ' L' + (b.x + ARCH_W / 2) + ' ' + (b.y + ARCH_H / 2));
		world.appendChild(path);
	}

	const maxNodes = Math.max(40, settings.maxRenderedNodes || 280);
	const nodes = (s.nodes || []).slice(0, maxNodes);
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const p = s.positions[node.id];
		if (!p) continue;
		const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		let cls = 'arch-node';
		if (node.id === s.entryNodeId) cls += ' is-entry';
		if (node.id === selectedNodeId) cls += ' is-selected';
		g.setAttribute('class', cls);
		g.setAttribute('data-node-id', node.id);
		g.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')');
		const color = nodeColor(node, s.entryNodeId);
		// Visual size stays ARCH_W×ARCH_H; hit testing is screen-space pickArchitectureNode (not DOM discs).
		const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		rect.setAttribute('class', 'node-face');
		rect.setAttribute('width', String(ARCH_W));
		rect.setAttribute('height', String(ARCH_H));
		rect.setAttribute('rx', '4');
		rect.setAttribute('stroke', color);
		rect.setAttribute('stroke-width', '1.4');
		g.appendChild(rect);
		const icon = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		icon.setAttribute('x', '7'); icon.setAttribute('y', '7');
		icon.setAttribute('width', '14'); icon.setAttribute('height', '14');
		icon.setAttribute('rx', '2');
		icon.setAttribute('fill', color);
		icon.setAttribute('opacity', '0.85');
		icon.setAttribute('pointer-events', 'none');
		g.appendChild(icon);
		world.appendChild(g);
	}
	applyArchTransform();
}

function drawNetworkFrame() {
	if (!snapshot || !isNetwork()) return;
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
	ctx.save();
	ctx.translate(transform.x, transform.y);
	ctx.scale(transform.k, transform.k);

	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		const a = projected[e.source], b = projected[e.target];
		if (!a || !b) continue;
		const avg = ((a.depthScale || 1) + (b.depthScale || 1)) / 2;
		const edgeAlpha = Math.max(0.16, Math.min(0.78, 0.2 + 0.38 * avg));
		ctx.beginPath();
		ctx.strokeStyle = e.kind === 'contains'
			? 'rgba(167,139,250,' + edgeAlpha + ')'
			: 'rgba(125,170,220,' + edgeAlpha + ')';
		ctx.lineWidth = 1 / transform.k;
		ctx.moveTo(a.x, a.y);
		ctx.lineTo(b.x, b.y);
		ctx.stroke();
	}

	const maxNodes = Math.max(40, settings.maxRenderedNodes || 280);
	const nodes = (snapshot.nodes || []).slice(0, maxNodes).slice().sort(function (a, b) {
		// Far nodes first, then nearer nodes on top for visible occlusion.
		return ((projected[b.id] && projected[b.id].z) || 0) - ((projected[a.id] && projected[a.id].z) || 0);
	});
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const p = projected[node.id];
		if (!p) continue;
		const r = networkDrawRadius(node, p.depthScale || 1);
		const color = nodeColor(node, snapshot.entryNodeId);
		const isSelected = node.id === selectedNodeId;
		const isEntry = node.id === snapshot.entryNodeId;
		// Dim non-neighbors when a node is selected (easier reselection).
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

function render(full) {
	const network = isNetwork();
	idleToggleWrap.style.display = network ? 'flex' : 'none';
	idleToggle.checked = !!settings.networkIdleAutoRotate;

	if (!snapshot || !(snapshot.nodes || []).length) {
		archSvg.style.display = 'none';
		netCanvas.style.display = 'none';
		legend.style.display = 'none';
		empty.style.display = 'flex';
		const msg = (diagnostics && diagnostics.message) || (diagnostics && diagnostics.status === 'scanning' ? 'Scanning workspace…' : 'No graph data yet. Open a folder and Rescan.');
		empty.textContent = msg;
		status.textContent = (diagnostics && diagnostics.status) ? (diagnostics.status + (diagnostics.message ? ' · ' + diagnostics.message : '')) : 'Idle';
		return;
	}

	empty.style.display = 'none';
	status.textContent = ((diagnostics && diagnostics.message) || (snapshot.nodes.length + ' nodes · ' + (snapshot.edges || []).length + ' links'))
		+ (network ? ' · drag to rotate · scroll to zoom' : '');
	updateLegend(snapshot, network);

	if (network) {
		archSvg.style.display = 'none';
		netCanvas.style.display = 'block';
		rebuildBase3d(snapshot);
		resizeCanvas();
		projectAll();
		dirty = true;
		drawNetworkFrame();
	} else {
		renderArchitecture(snapshot);
	}
}

function onSnapshotMessage(payload) {
	const prevScan = snapshot && snapshot.scannedAt;
	const prevLayoutRevision = snapshot && snapshot.layoutRevision;
	const prevLayout = snapshot && snapshot.layoutMode;
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
	idleToggle.checked = !!settings.networkIdleAutoRotate;
	if (!canIdleRotate()) idlePaused = true;
	else scheduleIdleResume();

	const nextScan = snapshot && snapshot.scannedAt;
	const nextLayoutRevision = snapshot && snapshot.layoutRevision;
	const nextLayout = snapshot && snapshot.layoutMode;
	const nextNetLayout = snapshot && snapshot.networkLayoutMode;
	const nextType = snapshot && snapshot.graphType;
	const layoutChanged = prevScan !== nextScan || prevLayoutRevision !== nextLayoutRevision || prevLayout !== nextLayout || prevNetLayout !== nextNetLayout || prevType !== nextType || !prevScan;
	const renderBudgetChanged = prevMaxNodes !== settings.maxRenderedNodes || prevMaxEdges !== settings.maxRenderedEdges;
	// Selection / diagnostics-only pushes must not rebuild Architecture DOM (no relayout on select).
	if (!layoutChanged && !renderBudgetChanged && snapshot && (snapshot.nodes || []).length) {
		empty.style.display = 'none';
		status.textContent = ((diagnostics && diagnostics.message) || (snapshot.nodes.length + ' nodes · ' + (snapshot.edges || []).length + ' links'))
			+ (isNetwork() ? ' · drag to rotate · scroll to zoom' : '');
		updateLegend(snapshot, isNetwork());
		if (isNetwork()) {
			dirty = true;
			drawNetworkFrame();
		} else {
			updateArchitectureSelection();
		}
		return;
	}
	if (layoutChanged && isNetwork()) resetCamera(false);
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
	if (msg.type === 'resetView') {
		resetCamera(false);
		if (isNetwork()) { projectAll(); fitView(); dirty = true; drawNetworkFrame(); }
		else fitView();
		return;
	}
	if (msg.type === 'fitView') { if (isNetwork()) projectAll(); fitView(); if (isNetwork()) { dirty = true; drawNetworkFrame(); } }
});

function closePopup() {
	popup.style.display = 'none';
	popupNode = null;
	if (isNetwork()) scheduleIdleResume();
}

function placePopupNear(clientX, clientY) {
	const host = isNetwork() ? netCanvas : archSvg;
	const rect = host.getBoundingClientRect();
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
	popupMeta.textContent = (node.path || '') + (node.meta && node.meta.architectureLayer ? ' · ' + node.meta.architectureLayer : '');
	popupOverview.textContent = 'Loading…';
	popupAi.textContent = '…';
	placePopupNear(clientX, clientY);
	request('selectNode', { nodeId: node.id });
	if (isNetwork()) { dirty = true; drawNetworkFrame(); } else updateArchitectureSelection();
	const desc = await request('describeNode', { nodeId: node.id });
	if (!popupNode || popupNode.id !== node.id) return;
	popupOverview.textContent = (desc && desc.overview) || 'No overview.';
	if (desc && desc.aiStatus === 'ready' && desc.aiDescription) {
		popupAi.textContent = desc.aiDescription + (desc.cacheHit ? ' (cached)' : '');
	} else {
		popupAi.textContent = (desc && desc.aiMessage) || 'AI description unavailable.';
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
	pointerDownNode = isNetwork()
		? pickNetworkNode(e.clientX, e.clientY)
		: pickArchitectureNode(e.clientX, e.clientY);
	// Architecture: pan only from background (or middle/shift). Node press must not pan,
	// or tiny moves cancel selection.
	const wantPan = e.button === 1 || e.shiftKey || (!isNetwork() && !pointerDownNode);
	panning = wantPan;
	// Defer rotate until drag exceeds click threshold so node reselection works.
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
	archSvg.classList.remove('dragging'); archSvg.classList.remove('panning');
	netCanvas.classList.remove('dragging');
	const dist = e ? Math.hypot((e.clientX || 0) - pointerDownX, (e.clientY || 0) - pointerDownY) : 99;
	if (e && !wasMoved && dist <= dragThreshold) {
		if (isNetwork()) {
			const node = pickNetworkNode(e.clientX, e.clientY);
			if (node) {
				openNodePopup(node, e.clientX, e.clientY);
				return;
			}
			selectedNodeId = null;
			request('selectNode', { nodeId: null });
			closePopup();
			dirty = true; drawNetworkFrame();
		} else {
			const node = pickArchitectureNode(e.clientX, e.clientY);
			if (node) {
				openNodePopup(node, e.clientX, e.clientY);
				return;
			}
			selectedNodeId = null;
			request('selectNode', { nodeId: null });
			closePopup();
			updateArchitectureSelection();
		}
	}
	if (isNetwork()) scheduleIdleResume();
}
function onPointerMove(e) {
	if (!dragging || e.pointerId !== activePointerId) return;
	const dx = e.clientX - lastX, dy = e.clientY - lastY;
	const total = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
	if (total > dragThreshold) moved = true;
	if (interactionState === 'pressed' && !panning && isNetwork() && moved) {
		rotating = true;
		interactionState = 'rotating';
		scheduleIdleResume();
	}
	lastX = e.clientX; lastY = e.clientY;
	if (rotating && isNetwork()) {
		const mapped = mapPointerDeltaToGraphRotation(dx, dy);
		rotation.yaw = wrapRotationAngle(rotation.yaw + mapped.yaw);
		rotation.pitch = wrapRotationAngle(rotation.pitch + mapped.pitch);
		dirty = true;
		kickRaf();
		return;
	}
	if (!moved) return;
	if (!panning && !isNetwork() && pointerDownNode) {
		// Node gesture exceeded click threshold: treat as cancelled click, do not pan.
		interactionState = 'cancelled';
		return;
	}
	if (!panning) return;
	interactionState = 'panning';
	transform.x += dx; transform.y += dy;
	if (isNetwork()) { dirty = true; kickRaf(); } else applyArchTransform();
}
function onWheel(e) {
	e.preventDefault();
	scheduleIdleResume();
	const factor = e.deltaY < 0 ? 1.1 : 0.9;
	const prev = transform.k;
	transform.k = Math.min(3.5, Math.max(0.15, transform.k * factor));
	const host = isNetwork() ? netCanvas : archSvg;
	const rect = host.getBoundingClientRect();
	const mx = e.clientX - rect.left, my = e.clientY - rect.top;
	transform.x = mx - (mx - transform.x) * (transform.k / prev);
	transform.y = my - (my - transform.y) * (transform.k / prev);
	if (isNetwork()) { dirty = true; drawNetworkFrame(); } else applyArchTransform();
}

archSvg.addEventListener('pointerdown', function (e) { onPointerDown(e, archSvg); });
netCanvas.addEventListener('pointerdown', function (e) { onPointerDown(e, netCanvas); });
archSvg.addEventListener('pointermove', onPointerMove);
netCanvas.addEventListener('pointermove', onPointerMove);
archSvg.addEventListener('pointerup', function (e) { onPointerUp(e, false); });
netCanvas.addEventListener('pointerup', function (e) { onPointerUp(e, false); });
archSvg.addEventListener('pointercancel', function (e) { onPointerUp(e, true); });
netCanvas.addEventListener('pointercancel', function (e) { onPointerUp(e, true); });
archSvg.addEventListener('lostpointercapture', function (e) { onPointerUp(e, true); });
netCanvas.addEventListener('lostpointercapture', function (e) { onPointerUp(e, true); });
archSvg.addEventListener('dblclick', function (e) {
	const node = pickArchitectureNode(e.clientX, e.clientY);
	if (node) request('openFile', { path: node.path || node.id.replace(/^file:/, '') });
});
archSvg.addEventListener('contextmenu', function (e) {
	const node = pickArchitectureNode(e.clientX, e.clientY);
	if (!node) return;
	e.preventDefault();
	openNodePopup(node, e.clientX, e.clientY);
});
netCanvas.addEventListener('dblclick', function (e) {
	const node = pickNetworkNode(e.clientX, e.clientY);
	if (node) request('openFile', { path: node.path || node.id.replace(/^file:/, '') });
});
// Hover cursor for architecture without selecting
archSvg.addEventListener('pointermove', function (e) {
	if (dragging) return;
	const node = pickArchitectureNode(e.clientX, e.clientY);
	archSvg.style.cursor = node ? 'pointer' : 'grab';
});
document.getElementById('popupClose').onclick = function () { closePopup(); };
document.getElementById('popupOpen').onclick = function () {
	if (popupNode) request('openFile', { path: popupNode.path || popupNode.id.replace(/^file:/, '') });
};
document.getElementById('popupReveal').onclick = function () {
	if (popupNode) request('revealFile', { path: popupNode.path || popupNode.id.replace(/^file:/, '') });
};
document.getElementById('popupMagnus').onclick = function () { request('attachToMagnus', {}); };
window.addEventListener('keydown', function (e) {
	if (e.key === 'Escape') { closePopup(); selectedNodeId = null; request('selectNode', { nodeId: null }); if (isNetwork()) { dirty = true; drawNetworkFrame(); } else updateArchitectureSelection(); }
});
archSvg.addEventListener('wheel', onWheel, { passive: false });
netCanvas.addEventListener('wheel', onWheel, { passive: false });
window.addEventListener('resize', function () { if (isNetwork()) { resizeCanvas(); dirty = true; drawNetworkFrame(); } });

document.getElementById('zoomIn').onclick = function () {
	transform.k = Math.min(3.5, transform.k * 1.15); dirty = true;
	if (isNetwork()) drawNetworkFrame(); else applyArchTransform();
};
document.getElementById('zoomOut').onclick = function () {
	transform.k = Math.max(0.15, transform.k / 1.15); dirty = true;
	if (isNetwork()) drawNetworkFrame(); else applyArchTransform();
};
document.getElementById('fit').onclick = function () { if (isNetwork()) projectAll(); fitView(); if (isNetwork()) { dirty = true; drawNetworkFrame(); } };
document.getElementById('reset').onclick = function () {
	resetCamera(false);
	if (isNetwork()) { projectAll(); fitView(); dirty = true; drawNetworkFrame(); }
	else fitView();
};
idleToggle.addEventListener('change', function () {
	settings.networkIdleAutoRotate = !!idleToggle.checked;
	request('setNetworkIdleAutoRotate', { enabled: settings.networkIdleAutoRotate });
	scheduleIdleResume();
});

function rafLoop(ts) {
	rafScheduled = false;
	const dt = Math.min(0.05, Math.max(0, (ts - (lastRafTs || ts)) / 1000));
	lastRafTs = ts;
	const animating = canIdleRotate() && !idlePaused;
	if (animating) {
		rotation.yaw += IDLE_YAW * dt;
		dirty = true;
	}
	if (dirty && isNetwork() && snapshot) drawNetworkFrame();
	// Keep the loop alive only while idle rotation is actively advancing frames.
	if (animating) kickRaf();
}
kickRaf();

window.addEventListener('pagehide', clearIdleTimers);
document.addEventListener('visibilitychange', function () {
	if (document.hidden) idlePaused = true;
	else if (isNetwork()) scheduleIdleResume();
});

request('getSnapshot').then(function (res) {
	snapshot = res && res.snapshot;
	diagnostics = res && res.diagnostics;
	selectedNodeId = (res && res.selectedNodeId) || null;
	if (res && res.settings) settings = res.settings;
	if (snapshot && snapshot.graphType) graphType = snapshot.graphType;
	if (isNetwork()) resetCamera(false);
	render(true);
	if (snapshot && snapshot.nodes && snapshot.nodes.length) fitView();
	scheduleIdleResume();
});
</script>
</body>
</html>`;
	}
}

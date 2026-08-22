/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
import { IPreBaseGraphService, type PreBaseGraphType } from './prebaseGraphService.js';
import {
	IPreBaseTemporalViewService,
	type ITemporalViewState,
	type TemporalStructuralDiff,
	type TemporalCommitSummary,
	type TemporalDisplayMode,
} from '../../temporal/view/temporalViewTypes.js';

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
	private _inputType: PreBaseGraphType = 'network';
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
		@IPreBaseTemporalViewService private readonly temporalViewService: IPreBaseTemporalViewService,
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
		this._register(this.temporalViewService.onDidChangeState(state => this._pushTemporalState(state)));
		this._register(this.temporalViewService.onDidChangeDiff(diff => this._pushTemporalDiff(diff)));
		this._register(this.temporalViewService.onDidChangeTimeline(timeline => this._pushTemporalTimeline(timeline)));
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
		this._inputType = input.graphType === 'temporal' ? 'temporal' : 'network';
		void this.graphService.setGraphType(this._inputType);
		this._ensureWebview();
		this._pushSnapshot();

		if (this._inputType === 'temporal') {
			void this.temporalViewService.initialize();
			this._pushTemporalState(this.temporalViewService.getState());
		} else if (!this.graphService.getSnapshot()) {
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
			maxRenderedNodes: maxNodes,
			maxRenderedEdges: maxEdges,
			quality
		};
	}

	private _pushSnapshot(): void {
		const payload = {
			snapshot: this.graphService.getSnapshot(),
			diagnostics: this.graphService.getDiagnostics(),
			viewState: this.graphService.getViewState(),
			selectedNodeId: this.graphService.getSelectedNodeId() ?? null,
			settings: this._graphSettings(),
			graphType: this._inputType,
			temporalState: this.temporalViewService.getState(),
		};
		this._webview?.postMessage({
			type: 'snapshot',
			payload
		});
	}

	private _pushTemporalState(state: ITemporalViewState): void {
		this._webview?.postMessage({
			type: 'temporalState',
			payload: state
		});
	}

	private _pushTemporalDiff(diff: TemporalStructuralDiff): void {
		this._webview?.postMessage({
			type: 'temporalDiff',
			payload: diff
		});
	}

	private _pushTemporalTimeline(timeline: readonly TemporalCommitSummary[]): void {
		this._webview?.postMessage({
			type: 'temporalTimeline',
			payload: timeline
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
					settings: this._graphSettings(),
					temporalState: this.temporalViewService.getState(),
				});
				break;
			case 'selectNode': {
				const nodeId = (message.payload as { nodeId?: string | null } | undefined)?.nodeId;
				if (this._inputType === 'temporal') {
					this.temporalViewService.selectEntity(nodeId || undefined);
				} else {
					this.graphService.setSelectedNodeId(nodeId || undefined);
				}
				await reply({ ok: true });
				break;
			}
			case 'selectTemporalEntity': {
				const entityId = (message.payload as { entityId?: string | null } | undefined)?.entityId;
				this.temporalViewService.selectEntity(entityId || undefined);
				await reply({ ok: true });
				break;
			}
			case 'peekNodeDescription': {
				const nodeId = (message.payload as { nodeId?: string } | undefined)?.nodeId;
				const snapshot = this.graphService.getSnapshot();
				const node = snapshot?.nodes.find(n => n.id === nodeId);
				if (!node) {
					await reply({ cached: false });
					break;
				}
				const peek = this.descriptionService.peekCachedDescription(node);
				await reply(peek);
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
			case 'openTemporalHistoricalFile': {
				const p = message.payload as { entityId?: string } | undefined;
				if (p?.entityId) {
					await this.temporalViewService.openHistoricalFile(p.entityId);
				}
				await reply({ ok: true });
				break;
			}
			case 'openTemporalSourceDiff': {
				const p = message.payload as { entityId?: string } | undefined;
				if (p?.entityId) {
					await this.temporalViewService.openSourceDiff(p.entityId);
				}
				await reply({ ok: true });
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
			case 'getTemporalState':
				await reply(this.temporalViewService.getState());
				break;
			case 'selectTemporalRef': {
				const ref = (message.payload as { ref?: string } | undefined)?.ref;
				if (ref) {
					await this.temporalViewService.selectRef(ref);
				}
				await reply({ ok: true });
				break;
			}
			case 'selectTemporalCommit': {
				const p = message.payload as { commitSha?: string; compareBaseSha?: string; immediate?: boolean } | undefined;
				if (p?.commitSha) {
					await this.temporalViewService.selectCommit(p.commitSha, { compareBaseSha: p.compareBaseSha, immediate: p.immediate });
				}
				await reply({ ok: true });
				break;
			}
			case 'setTemporalCompareBase': {
				const p = message.payload as { compareBaseSha?: string } | undefined;
				await this.temporalViewService.setCompareBase(p?.compareBaseSha);
				await reply({ ok: true });
				break;
			}
			case 'setTemporalDisplayMode': {
				const p = message.payload as { mode?: TemporalDisplayMode } | undefined;
				if (p?.mode) {
					this.temporalViewService.setDisplayMode(p.mode);
				}
				await reply({ ok: true });
				break;
			}
			case 'setTemporalFollowHead': {
				const p = message.payload as { follow?: boolean } | undefined;
				this.temporalViewService.setFollowHead(Boolean(p?.follow));
				await reply({ ok: true });
				break;
			}
			case 'setTemporalFilter': {
				const p = message.payload as { filter?: string } | undefined;
				this.temporalViewService.setFilterQuery(p?.filter || '');
				await reply({ ok: true });
				break;
			}
			case 'loadMoreTemporalHistory': {
				await this.temporalViewService.loadMoreHistory();
				await reply({ ok: true });
				break;
			}
			case 'switchGraphMode': {
				const mode = (message.payload as { mode?: PreBaseGraphType } | undefined)?.mode;
				if (mode) {
					this._inputType = mode;
					await this.graphService.setGraphType(mode);
					this._pushSnapshot();
				}
				await reply({ ok: true });
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

/* Temporal UI */
#temporalToolbar { position:absolute; top:12px; left:12px; right:12px; z-index:5; display:none; gap:10px; align-items:center; background:color-mix(in srgb, var(--vscode-editorWidget-background, #202122) 94%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:8px; padding:6px 12px; font-size:12px; backdrop-filter:blur(8px); }
#temporalToolbar select, #temporalToolbar input { background:var(--vscode-dropdown-background, #252526); color:var(--vscode-dropdown-foreground, #cccccc); border:1px solid var(--vscode-dropdown-border, #3c3c3c); border-radius:4px; padding:3px 6px; font-size:11px; }
#temporalDisplayModeWrap button { background:transparent; color:var(--vscode-foreground, #cccccc); border:0; border-radius:3px; padding:3px 8px; cursor:pointer; font-size:11px; }
#temporalDisplayModeWrap button.active { background:var(--vscode-button-background, #2dd4bf); color:var(--vscode-button-foreground, #1B1C1E); font-weight:600; }
#temporalScrubberBar { position:absolute; left:12px; right:12px; bottom:12px; z-index:5; display:none; flex-direction:column; gap:6px; background:color-mix(in srgb, var(--vscode-editorWidget-background, #202122) 94%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:8px; padding:8px 12px; font-size:12px; backdrop-filter:blur(8px); }
#temporalScrubberBar .row { display:flex; align-items:center; gap:8px; width:100%; }
#temporalScrubberBar button { background:transparent; color:var(--vscode-foreground, #f4f4f5); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:4px; padding:3px 8px; cursor:pointer; font-size:11px; }
#temporalScrubberBar button:hover { background:var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08)); }
#temporalTimelineStrip { display:flex; align-items:center; gap:4px; height:18px; overflow-x:auto; width:100%; padding:2px 0; }
.commit-marker { width:8px; height:8px; border-radius:50%; background:var(--vscode-descriptionForeground, #71717a); flex:0 0 auto; cursor:pointer; transition:transform 0.1s ease; border:1px solid transparent; }
.commit-marker:hover { transform:scale(1.4); }
.commit-marker.active { background:#2dd4bf; transform:scale(1.5); border-color:#fff; }
.commit-marker.is-merge { border-radius:2px; background:#a371f7; }
#temporalScrubber { flex:1; width:100%; height:4px; accent-color:var(--vscode-button-background, #2dd4bf); cursor:pointer; }
.badge-added { color:var(--vscode-gitDecoration-addedResourceForeground, #3fb950); background:rgba(63,185,80,0.15); padding:1px 6px; border-radius:4px; font-weight:600; }
.badge-removed { color:var(--vscode-gitDecoration-deletedResourceForeground, #f85149); background:rgba(248,81,73,0.15); padding:1px 6px; border-radius:4px; font-weight:600; }
.badge-modified { color:var(--vscode-gitDecoration-modifiedResourceForeground, #d29922); background:rgba(210,153,34,0.15); padding:1px 6px; border-radius:4px; font-weight:600; }
.badge-renamed { color:var(--vscode-gitDecoration-renamedResourceForeground, #58a6ff); background:rgba(88,166,255,0.15); padding:1px 6px; border-radius:4px; font-weight:600; }
.badge-warning { color:var(--vscode-editorWarning-foreground, #e3b341); background:rgba(227,179,65,0.15); padding:1px 6px; border-radius:4px; font-weight:600; display:none; }

#empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:2; text-align:center; padding:24px; color:var(--vscode-descriptionForeground, #a1a1aa); font-size:14px; line-height:1.5; }
#popup { position:absolute; z-index:6; width:min(320px, calc(100% - 24px)); max-height:min(340px, calc(100% - 32px)); overflow:auto; display:none; background:var(--vscode-editorWidget-background, #202122); border:1px solid var(--vscode-widget-border, #2A2B2C); border-radius:9px; padding:10px 12px; box-shadow:0 8px 24px rgba(0,0,0,.28); }
#popup h3 { margin:0 0 2px; font-size:12px; font-weight:600; }
#popup .meta { color:var(--vscode-descriptionForeground, #a1a1aa); font-size:10.5px; margin-bottom:6px; word-break:break-word; }
#popup .label { font-size:9.5px; font-weight:600; text-transform:none; letter-spacing:0; color:var(--vscode-descriptionForeground, #a1a1aa); margin:6px 0 2px; }
#popup p { margin:0; font-size:11.5px; line-height:1.4; color:var(--vscode-foreground, #f4f4f5); }
#popup .actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
#popup button { font-size:11px; border-radius:6px; border:1px solid var(--vscode-widget-border, #2A2B2C); background:var(--vscode-input-background, #242526); color:var(--vscode-foreground, #f4f4f5); padding:4px 8px; cursor:pointer; }
#popup button.primary { border-color:var(--vscode-button-background, #2dd4bf); color:var(--vscode-button-foreground, #1B1C1E); background:var(--vscode-button-background, #2dd4bf); font-weight:500; }
#popup button:disabled { opacity:0.4; cursor:not-allowed; }
#popup #popupClose { float:right; border:0; background:transparent; color:var(--vscode-descriptionForeground, #a1a1aa); font-size:15px; line-height:1; cursor:pointer; padding:2px 4px; border-radius:4px; }
#popup #popupClose:hover { color:var(--vscode-foreground, #f4f4f5); background:rgba(255,255,255,0.08); }
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

<!-- Temporal Toolbar -->
<div id="temporalToolbar">
	<span style="font-weight:600; font-size:12px; color:var(--vscode-foreground, #f4f4f5); display:flex; align-items:center; gap:6px;">
		<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#2dd4bf;"></span>
		Temporal Graph
	</span>
	<label style="display:flex; align-items:center; gap:4px; font-size:11px;">
		Branch / Ref:
		<select id="temporalRefSelect" title="Select Git branch, tag, or HEAD"></select>
	</label>
	<label style="display:flex; align-items:center; gap:4px; font-size:11px;">
		Compare Base:
		<select id="temporalCompareSelect" title="Select comparison base commit"></select>
	</label>
	<div id="temporalDisplayModeWrap" style="display:flex; border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:4px; overflow:hidden;">
		<button id="temporalModeChangesBtn" type="button" class="active" title="Highlight structural differences against comparison base">Changes</button>
		<button id="temporalModeStateBtn" type="button" title="View complete codebase state at selected commit">State</button>
	</div>
	<label style="display:flex; align-items:center; gap:4px; font-size:11px; margin-left:4px;">
		<input type="checkbox" id="temporalFollowHead" checked> Follow HEAD
	</label>
	<div id="temporalDiffBadges" style="display:flex; gap:6px; font-size:11px; margin-left:auto; align-items:center;">
		<span id="badgeAdded" class="badge-added" title="Added nodes">+0</span>
		<span id="badgeRemoved" class="badge-removed" title="Removed nodes">-0</span>
		<span id="badgeModified" class="badge-modified" title="Modified nodes">~0</span>
		<span id="badgeRenamed" class="badge-renamed" title="Renamed nodes">⇄0</span>
		<span id="temporalPartialWarning" class="badge-warning" title="Partial lineage indexing in progress">Partial</span>
	</div>
	<input id="temporalFilterInput" type="search" placeholder="Filter entities…" style="width:130px;" aria-label="Filter temporal entities">
</div>

<!-- Temporal Scrubber Bar -->
<div id="temporalScrubberBar">
	<div id="temporalTimelineStrip" aria-label="Loaded commit history timeline"></div>
	<div class="row">
		<button id="temporalPrevBtn" title="Previous older commit (Left arrow)" aria-label="Previous commit">◀</button>
		<button id="temporalPlayBtn" title="Play timeline (Space)" aria-label="Play timeline">▶</button>
		<button id="temporalNextBtn" title="Next newer commit (Right arrow)" aria-label="Next commit">▶</button>
		<button id="temporalLoadMoreBtn" title="Load more historical commits" aria-label="Load more history" style="display:none;">+More</button>
		<span id="temporalCommitSha" style="font-family:monospace; font-weight:600; color:var(--vscode-textLink-foreground, #58a6ff); font-size:11.5px;"></span>
		<span id="temporalCommitMessage" style="font-size:11px; max-width:440px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></span>
		<span id="temporalCommitAuthor" style="font-size:10.5px; opacity:0.75;"></span>
		<span id="temporalCommitStatus" style="font-size:10px; border-radius:4px; padding:1px 5px; background:rgba(255,255,255,0.08);"></span>
	</div>
	<div class="row">
		<input id="temporalScrubber" type="range" min="0" max="0" value="0" aria-label="Temporal commit history scrubber">
	</div>
</div>

<div id="legend"></div>
<div id="popup" role="dialog" aria-modal="false" aria-label="Node details">
	<button id="popupClose" type="button" title="Close" aria-label="Close details">×</button>
	<h3 id="popupTitle"></h3>
	<div class="meta" id="popupMeta"></div>
	<div class="label">Overview</div>
	<p id="popupOverview"></p>
	<div class="label">AI Summary</div>
	<p id="popupAi"></p>
	<div class="actions">
		<button class="primary" id="popupOpen" type="button" title="Open File" aria-label="Open File">Open File</button>
		<button id="popupHistoricalView" type="button" title="View historical revision at this commit" aria-label="View at Commit" style="display:none;">View at Commit</button>
		<button id="popupSourceDiff" type="button" class="primary" title="View Source Diff against base" aria-label="View Source Diff" style="display:none;">View Source Diff</button>
		<button id="popupReveal" type="button" title="Reveal in Explorer" aria-label="Reveal in Explorer">Reveal</button>
		<button id="popupMagnus" type="button" title="Attach to Agents" aria-label="Attach to Agents">Attach to Agents</button>
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
const toolbar = document.getElementById('toolbar');
const temporalToolbar = document.getElementById('temporalToolbar');
const temporalScrubberBar = document.getElementById('temporalScrubberBar');
const temporalRefSelect = document.getElementById('temporalRefSelect');
const temporalCompareSelect = document.getElementById('temporalCompareSelect');
const temporalFollowHead = document.getElementById('temporalFollowHead');
const temporalFilterInput = document.getElementById('temporalFilterInput');
const temporalModeChangesBtn = document.getElementById('temporalModeChangesBtn');
const temporalModeStateBtn = document.getElementById('temporalModeStateBtn');
const temporalTimelineStrip = document.getElementById('temporalTimelineStrip');
const temporalScrubber = document.getElementById('temporalScrubber');
const temporalPrevBtn = document.getElementById('temporalPrevBtn');
const temporalNextBtn = document.getElementById('temporalNextBtn');
const temporalPlayBtn = document.getElementById('temporalPlayBtn');
const temporalLoadMoreBtn = document.getElementById('temporalLoadMoreBtn');
const temporalCommitSha = document.getElementById('temporalCommitSha');
const temporalCommitMessage = document.getElementById('temporalCommitMessage');
const temporalCommitAuthor = document.getElementById('temporalCommitAuthor');
const temporalCommitStatus = document.getElementById('temporalCommitStatus');
const temporalPartialWarning = document.getElementById('temporalPartialWarning');
const badgeAdded = document.getElementById('badgeAdded');
const badgeRemoved = document.getElementById('badgeRemoved');
const badgeModified = document.getElementById('badgeModified');
const badgeRenamed = document.getElementById('badgeRenamed');

const popup = document.getElementById('popup');
const popupTitle = document.getElementById('popupTitle');
const popupMeta = document.getElementById('popupMeta');
const popupOverview = document.getElementById('popupOverview');
const popupAi = document.getElementById('popupAi');
const popupAiProvenance = document.getElementById('popupAiProvenance');
const popupOpen = document.getElementById('popupOpen');
const popupHistoricalView = document.getElementById('popupHistoricalView');
const popupSourceDiff = document.getElementById('popupSourceDiff');
const popupReveal = document.getElementById('popupReveal');
const popupMagnus = document.getElementById('popupMagnus');

let popupNode = null;
let pointerDownNode = null;
let pointerDownX = 0, pointerDownY = 0;
let interactionState = 'idle';
let dragThreshold = 4;
const NODE_SCALE = 1;

const FOCAL = 640;
const IDLE_YAW = 0.08;
const IDLE_RESUME_MS = 1400;
const ARCH_W = 28, ARCH_H = 28;
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

// Temporal State & 2D Transition Engine
let temporalState = null;
let temporalDiff = null;
let previousTemporalRenderNodes = new Map();
let currentTemporalRenderNodes = new Map();
let animStartTime = 0;
let animDuration = 220;
let isAnimatingTemporal = false;
let isPlayingHistory = false;
let playIntervalTimer = null;
let displayMode = 'changes';

function request(type, payload) {
	const requestId = Math.random().toString(36).slice(2);
	return new Promise(function (resolve) {
		pending.set(requestId, resolve);
		vscode.postMessage({ requestId: requestId, type: type, payload: payload });
	});
}

function isNetwork() { return graphType === 'network'; }
function isTemporal() { return graphType === 'temporal'; }

function getComputedThemeColors() {
	const s = getComputedStyle(document.documentElement);
	return {
		bg: s.getPropertyValue('--vscode-editor-background').trim() || '#1B1C1E',
		fg: s.getPropertyValue('--vscode-foreground').trim() || '#f4f4f5',
		border: s.getPropertyValue('--vscode-widget-border').trim() || '#3C3C3C',
		added: s.getPropertyValue('--vscode-gitDecoration-addedResourceForeground').trim() || '#3fb950',
		deleted: s.getPropertyValue('--vscode-gitDecoration-deletedResourceForeground').trim() || '#f85149',
		modified: s.getPropertyValue('--vscode-gitDecoration-modifiedResourceForeground').trim() || '#d29922',
		renamed: s.getPropertyValue('--vscode-gitDecoration-renamedResourceForeground').trim() || '#58a6ff',
		accent: s.getPropertyValue('--vscode-button-background').trim() || '#2dd4bf',
		isHighContrast: document.body.classList.contains('vscode-high-contrast') || s.getPropertyValue('--vscode-contrastBorder').trim() !== '',
	};
}

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

function projectPoint(x, y, z, yaw, pitch) {
	const cp = Math.cos(pitch), sp = Math.sin(pitch);
	const y1 = y * cp - z * sp;
	const z1 = y * sp + z * cp;

	const cy = Math.cos(yaw), sy = Math.sin(yaw);
	const x2 = x * cy + z1 * sy;
	const z2 = -x * sy + z1 * cy;

	const distance = FOCAL + z2;
	const depthScale = distance > 40 ? FOCAL / distance : 0.05;
	return { x: x2 * depthScale, y: y1 * depthScale, z: z2, depthScale: depthScale };
}

function resizeCanvas() {
	if (!netCanvas) return;
	const w = netCanvas.clientWidth || 800;
	const h = netCanvas.clientHeight || 600;
	if (netCanvas.width !== Math.floor(w * dpr) || netCanvas.height !== Math.floor(h * dpr)) {
		netCanvas.width = Math.floor(w * dpr);
		netCanvas.height = Math.floor(h * dpr);
		ctx.resetTransform();
		ctx.scale(dpr, dpr);
		dirty = true;
	}
}

function kickRaf() {
	if (rafScheduled) return;
	rafScheduled = true;
	requestAnimationFrame(rafLoop);
}

function scheduleIdleResume() {
	if (!settings.networkIdleAutoRotate || settings.reduceMotion) return;
	idlePaused = true;
	if (idleResumeTimer) clearTimeout(idleResumeTimer);
	idleResumeTimer = setTimeout(function () {
		idlePaused = false;
		kickRaf();
	}, IDLE_RESUME_MS);
}

function resetCamera(force) {
	rotation.yaw = 0.55;
	rotation.pitch = 0.28;
	transform = { x: 0, y: 0, k: 1 };
	dirty = true;
	kickRaf();
}

function rebuildBase3d(s) {
	if (!s || !s.nodes) return;
	base3d = Object.create(null);
	const nodes = s.nodes;
	let sumX = 0, sumY = 0;
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		const nx = n.x || 0, ny = n.y || 0, nz = n.z || 0;
		base3d[n.id] = { x: nx, y: ny, z: nz };
		sumX += nx; sumY += ny;
	}
	centroid = { x: sumX / (nodes.length || 1), y: sumY / (nodes.length || 1) };
}

function projectAll() {
	if (!snapshot || !isNetwork()) return;
	const nodes = snapshot.nodes || [];
	projected = Object.create(null);
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const p = base3d[node.id] || { x: node.x || 0, y: node.y || 0, z: node.z || 0 };
		const pr = projectPoint(p.x - centroid.x, p.y - centroid.y, p.z, rotation.yaw, rotation.pitch);
		projected[node.id] = {
			x: pr.x,
			y: pr.y,
			depthScale: pr.depthScale,
			z: pr.z
		};
	}
}

function screenPos(id) {
	if (isNetwork() && projected[id]) return projected[id];
	return null;
}

function fitView() {
	if (isTemporal()) {
		if (!temporalDiff || !temporalDiff.nodes || !temporalDiff.nodes.length) return;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (let i = 0; i < temporalDiff.nodes.length; i++) {
			const n = temporalDiff.nodes[i];
			minX = Math.min(minX, n.x - 20); minY = Math.min(minY, n.y - 20);
			maxX = Math.max(maxX, n.x + 20); maxY = Math.max(maxY, n.y + 20);
		}
		if (!isFinite(minX)) return;
		const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
		const vw = netCanvas.clientWidth || 800, vh = netCanvas.clientHeight || 600;
		const k = Math.min(vw / (bw + 160), vh / (bh + 160), 2.0);
		transform = { k: k, x: (vw - bw * k) / 2 - minX * k, y: (vh - bh * k) / 2 - minY * k };
		dirty = true; kickRaf();
		return;
	}

	if (!snapshot || !(snapshot.nodes || []).length) return;
	const nodes = snapshot.nodes;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let i = 0; i < nodes.length; i++) {
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
	dirty = true; kickRaf();
}

function updateLegend(s, network) {
	if (isTemporal()) {
		let html = '<div class="title">Temporal Transitions</div>';
		html += '<div class="row"><span class="swatch circle" style="background:var(--vscode-gitDecoration-addedResourceForeground, #3fb950)"></span>Added (+)</div>';
		html += '<div class="row"><span class="swatch circle" style="background:var(--vscode-gitDecoration-deletedResourceForeground, #f85149)"></span>Removed (-)</div>';
		html += '<div class="row"><span class="swatch circle" style="background:var(--vscode-gitDecoration-modifiedResourceForeground, #d29922)"></span>Modified (~)</div>';
		html += '<div class="row"><span class="swatch circle" style="background:var(--vscode-gitDecoration-renamedResourceForeground, #58a6ff)"></span>Renamed (⇄)</div>';
		html += '<div class="row"><span class="swatch circle" style="background:var(--vscode-descriptionForeground, #8b949e)"></span>Unchanged</div>';
		legend.innerHTML = html;
		legend.style.display = 'block';
		return;
	}
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
		html += '<div class="row"><span class="swatch ft-' + t.id + ' circle"></span>' + t.name + '</div>';
	});
	html += '<div class="row"><span class="swatch entry circle"></span>Entry</div>';
	html += '<div class="title spaced">Visible edges</div>';
	html += '<div class="row"><span class="swatch line import"></span>Import</div>';
	html += '<div class="row"><span class="swatch line composition"></span>Composition</div>';
	legend.innerHTML = html;
	legend.style.display = 'block';
}

function updateTemporalUI(state, diff) {
	if (!state) return;
	temporalToolbar.style.display = 'flex';
	temporalScrubberBar.style.display = 'flex';
	toolbar.style.display = 'none';
	status.style.display = 'none';

	// Safe DOM Ref Selector population
	const currentRef = state.selectedRef || 'HEAD';
	const refs = state.repositoryRefs || [];
	temporalRefSelect.innerHTML = '';

	const headGroup = document.createElement('optgroup');
	headGroup.label = 'Current / HEAD';
	const headOpt = document.createElement('option');
	headOpt.value = 'HEAD';
	headOpt.textContent = 'HEAD';
	if (currentRef === 'HEAD') headOpt.selected = true;
	headGroup.appendChild(headOpt);
	temporalRefSelect.appendChild(headGroup);

	const localBranches = refs.filter(r => r.kind === 'branch');
	if (localBranches.length > 0) {
		const grp = document.createElement('optgroup');
		grp.label = 'Local Branches';
		for (let i = 0; i < localBranches.length; i++) {
			const b = localBranches[i];
			const opt = document.createElement('option');
			opt.value = b.name;
			opt.textContent = b.name;
			if (b.name === currentRef) opt.selected = true;
			grp.appendChild(opt);
		}
		temporalRefSelect.appendChild(grp);
	}

	const remoteBranches = refs.filter(r => r.kind === 'remote-branch');
	if (remoteBranches.length > 0) {
		const grp = document.createElement('optgroup');
		grp.label = 'Remote Branches';
		for (let i = 0; i < remoteBranches.length; i++) {
			const b = remoteBranches[i];
			const opt = document.createElement('option');
			opt.value = b.name;
			opt.textContent = b.name;
			if (b.name === currentRef) opt.selected = true;
			grp.appendChild(opt);
		}
		temporalRefSelect.appendChild(grp);
	}

	const tags = refs.filter(r => r.kind === 'tag' || r.kind === 'annotated-tag');
	if (tags.length > 0) {
		const grp = document.createElement('optgroup');
		grp.label = 'Tags';
		for (let i = 0; i < tags.length; i++) {
			const t = tags[i];
			const opt = document.createElement('option');
			opt.value = t.name;
			opt.textContent = t.name;
			if (t.name === currentRef) opt.selected = true;
			grp.appendChild(opt);
		}
		temporalRefSelect.appendChild(grp);
	}

	// Safe DOM Compare Base Selector
	temporalCompareSelect.innerHTML = '';
	const timeline = state.pagedTimeline || [];
	const curCommit = timeline.find(c => c.sha === state.selectedCommitSha);
	const curBase = state.compareBaseSha || '';

	const p1Opt = document.createElement('option');
	p1Opt.value = curCommit?.parents?.[0] || '';
	p1Opt.textContent = curCommit?.parents?.[0] ? 'Parent (' + curCommit.parents[0].slice(0, 7) + ')' : 'Initial Commit (No Parent)';
	if (state.comparisonMode === 'first-parent' || curBase === curCommit?.parents?.[0]) p1Opt.selected = true;
	temporalCompareSelect.appendChild(p1Opt);

	if (curCommit?.parents && curCommit.parents.length > 1) {
		const p2Opt = document.createElement('option');
		p2Opt.value = curCommit.parents[1];
		p2Opt.textContent = 'Parent 2 (' + curCommit.parents[1].slice(0, 7) + ')';
		if (curBase === curCommit.parents[1]) p2Opt.selected = true;
		temporalCompareSelect.appendChild(p2Opt);
	}

	if (curBase && curBase !== curCommit?.parents?.[0] && curBase !== curCommit?.parents?.[1]) {
		const customOpt = document.createElement('option');
		customOpt.value = curBase;
		customOpt.textContent = 'Custom (' + curBase.slice(0, 7) + ')';
		customOpt.selected = true;
		temporalCompareSelect.appendChild(customOpt);
	}

	// Display Mode Buttons
	displayMode = state.displayMode || 'changes';
	if (displayMode === 'changes') {
		temporalModeChangesBtn.classList.add('active');
		temporalModeStateBtn.classList.remove('active');
	} else {
		temporalModeChangesBtn.classList.remove('active');
		temporalModeStateBtn.classList.add('active');
	}

	// Follow HEAD
	temporalFollowHead.checked = !!state.followHead;

	// Scrubber slider & Timeline Strip
	const total = timeline.length;
	temporalScrubber.max = String(Math.max(0, total - 1));
	const currentIdx = timeline.findIndex(c => c.sha === state.selectedCommitSha);
	if (currentIdx >= 0) {
		const sliderVal = (total - 1) - currentIdx;
		temporalScrubber.value = String(sliderVal);
		const commit = timeline[currentIdx];
		temporalCommitSha.textContent = commit.shortSha || commit.sha.slice(0, 7);
		temporalCommitMessage.textContent = commit.message || '';
		temporalCommitAuthor.textContent = commit.author ? 'by ' + commit.author : '';
		temporalCommitStatus.textContent = state.isSettled ? 'Settled' : 'Indexing…';
		temporalCommitStatus.style.color = state.isSettled ? 'var(--vscode-gitDecoration-addedResourceForeground, #3fb950)' : 'var(--vscode-gitDecoration-modifiedResourceForeground, #d29922)';
		temporalScrubber.setAttribute('aria-valuetext', 'Commit ' + (commit.shortSha || commit.sha.slice(0, 7)) + ': ' + commit.message + (commit.author ? ', by ' + commit.author : ''));
	}

	// Render interactive timeline markers
	temporalTimelineStrip.innerHTML = '';
	for (let i = timeline.length - 1; i >= 0; i--) {
		const c = timeline[i];
		const dot = document.createElement('div');
		dot.className = 'commit-marker' + (c.sha === state.selectedCommitSha ? ' active' : '') + (c.isMerge ? ' is-merge' : '');
		dot.title = (c.shortSha || c.sha.slice(0, 7)) + ' - ' + c.message + (c.author ? ' (' + c.author + ')' : '');
		dot.onclick = (function (sha) {
			return function () {
				request('selectTemporalCommit', { commitSha: sha, immediate: true });
			};
		})(c.sha);
		temporalTimelineStrip.appendChild(dot);
	}

	// Load more history button
	temporalLoadMoreBtn.style.display = state.historyHasMore ? 'inline-block' : 'none';

	// Partial warning
	temporalPartialWarning.style.display = state.isPartialLineage ? 'inline-block' : 'none';

	// Diff Badges
	if (diff && diff.summary) {
		badgeAdded.textContent = '+' + diff.summary.addedCount;
		badgeRemoved.textContent = '-' + diff.summary.removedCount;
		badgeModified.textContent = '~' + diff.summary.modifiedCount;
		badgeRenamed.textContent = '⇄' + diff.summary.renamedCount;
	}
}

function updateTemporalDiffTransition(diff) {
	if (!diff) return;
	previousTemporalRenderNodes = new Map(currentTemporalRenderNodes);
	const nextMap = new Map();

	// Production Layout: coordinates are authoritatively computed by host TemporalLayoutEngine!
	const nodes = diff.nodes || [];
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		nextMap.set(node.entityId, {
			entityId: node.entityId,
			canonicalNodeId: node.canonicalNodeId,
			path: node.path,
			label: node.label,
			kind: node.kind,
			x: node.x,
			y: node.y,
			changeKind: node.changeKind,
			oldPath: node.oldPath,
			isModified: node.isModified,
			meta: node.meta,
		});
	}

	currentTemporalRenderNodes = nextMap;
	animStartTime = performance.now();
	const prefersReduced = settings.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	animDuration = prefersReduced ? 0 : 220;
	isAnimatingTemporal = !prefersReduced;
	dirty = true;
	kickRaf();
}

function drawTemporalFrame(now) {
	if (!netCanvas) return;
	const w = netCanvas.clientWidth || 800;
	const h = netCanvas.clientHeight || 600;
	ctx.clearRect(0, 0, w, h);

	ctx.save();
	ctx.translate(w / 2 + transform.x, h / 2 + transform.y);
	ctx.scale(transform.k, transform.k);

	const t = animDuration > 0 ? Math.min(1, (now - animStartTime) / animDuration) : 1;
	const ease = 1 - Math.pow(1 - t, 3);
	if (t >= 1) isAnimatingTemporal = false;

	const filterQuery = (temporalFilterInput.value || '').trim().toLowerCase();
	const theme = getComputedThemeColors();

	// Draw edges
	const edges = (temporalDiff && temporalDiff.edges) || [];
	for (let i = 0; i < edges.length; i++) {
		const edge = edges[i];
		const srcNode = currentTemporalRenderNodes.get(edge.sourceEntityId);
		const tgtNode = currentTemporalRenderNodes.get(edge.targetEntityId);
		if (!srcNode || !tgtNode) continue;

		ctx.beginPath();
		ctx.moveTo(srcNode.x, srcNode.y);
		ctx.lineTo(tgtNode.x, tgtNode.y);

		if (displayMode === 'changes') {
			if (edge.changeKind === 'added') {
				ctx.strokeStyle = theme.added;
				ctx.lineWidth = theme.isHighContrast ? 3 : 2;
				ctx.setLineDash([]);
			} else if (edge.changeKind === 'removed') {
				ctx.strokeStyle = theme.deleted;
				ctx.lineWidth = theme.isHighContrast ? 2.5 : 1.5;
				ctx.setLineDash([4, 4]);
			} else if (edge.changeKind === 'modified') {
				ctx.strokeStyle = theme.modified;
				ctx.lineWidth = theme.isHighContrast ? 2.5 : 1.5;
				ctx.setLineDash([2, 2]);
			} else {
				ctx.strokeStyle = 'rgba(139, 148, 158, 0.35)';
				ctx.lineWidth = 1;
				ctx.setLineDash([]);
			}
		} else {
			// State mode: natural edges
			ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
			ctx.lineWidth = 1;
			ctx.setLineDash([]);
		}
		ctx.stroke();
	}
	ctx.setLineDash([]);

	// Draw nodes
	currentTemporalRenderNodes.forEach(function (node) {
		if (filterQuery && !node.path.toLowerCase().includes(filterQuery) && !node.label.toLowerCase().includes(filterQuery)) {
			return;
		}

		let curX = node.x;
		let curY = node.y;
		let curAlpha = 1;
		let curScale = 1;

		const prev = previousTemporalRenderNodes.get(node.entityId);
		if (isAnimatingTemporal && prev) {
			curX = prev.x + (node.x - prev.x) * ease;
			curY = prev.y + (node.y - prev.y) * ease;
		}

		if (node.changeKind === 'added' && isAnimatingTemporal) {
			curAlpha = ease;
			curScale = 0.5 + 0.5 * ease;
		} else if (node.changeKind === 'removed') {
			curAlpha = isAnimatingTemporal ? 1 - 0.7 * ease : 0.35;
		}

		ctx.save();
		ctx.globalAlpha = curAlpha;
		ctx.translate(curX, curY);
		ctx.scale(curScale, curScale);

		const radius = 14;

		// Selection highlight ring
		if (selectedNodeId === node.entityId || selectedNodeId === node.canonicalNodeId) {
			ctx.beginPath();
			ctx.arc(0, 0, radius + 5, 0, 2 * Math.PI);
			ctx.strokeStyle = theme.accent;
			ctx.lineWidth = theme.isHighContrast ? 4 : 3;
			ctx.stroke();
		}

		// Node Body
		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, 2 * Math.PI);
		let fillColor = theme.bg;
		let strokeColor = theme.border;

		if (displayMode === 'changes') {
			if (node.changeKind === 'added') {
				fillColor = 'color-mix(in srgb, ' + theme.added + ' 25%, ' + theme.bg + ')';
				strokeColor = theme.added;
			} else if (node.changeKind === 'removed') {
				fillColor = 'color-mix(in srgb, ' + theme.deleted + ' 25%, ' + theme.bg + ')';
				strokeColor = theme.deleted;
			} else if (node.changeKind === 'modified') {
				fillColor = 'color-mix(in srgb, ' + theme.modified + ' 25%, ' + theme.bg + ')';
				strokeColor = theme.modified;
			} else if (node.changeKind === 'renamed') {
				fillColor = 'color-mix(in srgb, ' + theme.renamed + ' 25%, ' + theme.bg + ')';
				strokeColor = theme.renamed;
			}
		} else {
			// State mode: use file type color
			const ft = fileType(node.path || node.label);
			fillColor = ft.color;
			strokeColor = theme.border;
		}

		ctx.fillStyle = fillColor;
		ctx.fill();
		ctx.lineWidth = (node.changeKind === 'unchanged' || displayMode === 'state') ? 1.5 : (theme.isHighContrast ? 3.5 : 2.5);
		ctx.strokeStyle = strokeColor;
		ctx.stroke();

		// Change Symbol / Badge (only in changes mode)
		if (displayMode === 'changes') {
			let badgeSymbol = '';
			if (node.changeKind === 'added') badgeSymbol = '+';
			else if (node.changeKind === 'removed') badgeSymbol = '−';
			else if (node.changeKind === 'modified') badgeSymbol = '~';
			else if (node.changeKind === 'renamed') badgeSymbol = node.isModified ? '⇄*' : '⇄';

			if (badgeSymbol) {
				ctx.fillStyle = strokeColor;
				ctx.font = 'bold 11px sans-serif';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(badgeSymbol, 0, 0);
			}
		}

		// Label
		ctx.fillStyle = theme.fg;
		ctx.font = '10.5px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		const labelText = node.oldPath && displayMode === 'changes' ? node.label + ' (was ' + getBaseName(node.oldPath) + ')' : node.label;
		ctx.fillText(labelText, 0, radius + 3);

		ctx.restore();
	});

	ctx.restore();

	if (isAnimatingTemporal) {
		dirty = true;
		kickRaf();
	}
}

function pickTemporalNode(clientX, clientY) {
	if (!netCanvas) return null;
	const rect = netCanvas.getBoundingClientRect();
	const sx = clientX - rect.left;
	const sy = clientY - rect.top;
	const w = netCanvas.clientWidth || 800;
	const h = netCanvas.clientHeight || 600;
	const wx = (sx - (w / 2 + transform.x)) / transform.k;
	const wy = (sy - (h / 2 + transform.y)) / transform.k;

	let best = null;
	let bestDist = 24 / transform.k;

	currentTemporalRenderNodes.forEach(function (node) {
		const d = Math.hypot(wx - node.x, wy - node.y);
		if (d <= bestDist) {
			bestDist = d;
			best = node;
		}
	});

	return best;
}

function stepTemporalCommit(delta) {
	if (!temporalState || !temporalState.pagedTimeline || !temporalState.pagedTimeline.length) return;
	const timeline = temporalState.pagedTimeline;
	const curIdx = timeline.findIndex(c => c.sha === temporalState.selectedCommitSha);
	if (curIdx < 0) return;
	const targetIdx = curIdx - delta; // delta +1 means newer (towards HEAD / index 0), -1 means older
	if (targetIdx >= 0 && targetIdx < timeline.length) {
		request('selectTemporalCommit', { commitSha: timeline[targetIdx].sha, immediate: true });
	} else if (delta < 0 && targetIdx >= timeline.length) {
		request('loadMoreTemporalHistory', {});
	}
}

function toggleTemporalPlay() {
	if (isPlayingHistory) {
		clearInterval(playIntervalTimer);
		playIntervalTimer = null;
		isPlayingHistory = false;
		temporalPlayBtn.textContent = '▶';
	} else {
		isPlayingHistory = true;
		temporalPlayBtn.textContent = '❚❚';
		playIntervalTimer = setInterval(function () {
			stepTemporalCommit(1);
			const timeline = temporalState.pagedTimeline || [];
			if (timeline[0] && timeline[0].sha === temporalState.selectedCommitSha) {
				toggleTemporalPlay();
			}
		}, 900);
	}
}

function hashString(str) {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash) + str.charCodeAt(i);
	return Math.abs(hash | 0);
}

function getBaseName(p) {
	const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\\\'));
	return lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
}

function pickNetworkNode(clientX, clientY) {
	if (!snapshot || !isNetwork()) return null;
	const rect = netCanvas.getBoundingClientRect();
	const sx = clientX - rect.left;
	const sy = clientY - rect.top;
	const k = Math.max(0.001, transform.k);
	const wx = (sx - transform.x) / k;
	const wy = (sy - transform.y) / k;
	let best = null;
	let bestDist = Infinity;
	const maxNodes = Math.max(40, settings.maxRenderedNodes || 280);
	const nodes = (snapshot.nodes || []).slice(0, maxNodes);
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const p = screenPos(node.id);
		if (!p) continue;
		const r = 16 * (p.depthScale || 1);
		const d = Math.hypot(wx - p.x, wy - p.y);
		if (d <= r + 8 && (d < bestDist || (d === bestDist && best && node.id < best.id))) {
			bestDist = d;
			best = node;
		}
	}
	return best;
}

function drawNetworkFrame() {
	if (!netCanvas) return;
	const w = netCanvas.clientWidth || 800;
	const h = netCanvas.clientHeight || 600;
	ctx.clearRect(0, 0, w, h);
	projectAll();

	ctx.save();
	ctx.translate(transform.x, transform.y);
	ctx.scale(transform.k, transform.k);

	const nodes = (snapshot && snapshot.nodes) || [];
	const edges = (snapshot && snapshot.edges) || [];
	const entryId = snapshot && snapshot.entryNodeId;

	// Draw Network Edges
	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		const p1 = screenPos(e.source);
		const p2 = screenPos(e.target);
		if (!p1 || !p2) continue;
		ctx.beginPath();
		ctx.moveTo(p1.x, p1.y);
		ctx.lineTo(p2.x, p2.y);
		ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
		ctx.lineWidth = 1;
		ctx.stroke();
	}

	// Draw Network Nodes
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const p = screenPos(node.id);
		if (!p) continue;
		const r = 14 * (p.depthScale || 1);

		if (selectedNodeId === node.id) {
			ctx.beginPath();
			ctx.arc(p.x, p.y, r + 4, 0, 2 * Math.PI);
			ctx.strokeStyle = '#2dd4bf';
			ctx.lineWidth = 2.5;
			ctx.stroke();
		}

		ctx.beginPath();
		ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
		ctx.fillStyle = nodeColor(node, entryId);
		ctx.fill();
		ctx.strokeStyle = '#1B1C1E';
		ctx.lineWidth = 1.5;
		ctx.stroke();

		ctx.fillStyle = '#f4f4f5';
		ctx.font = '10px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(node.label || node.id, p.x, p.y + r + 2);
	}

	ctx.restore();
	dirty = false;
}

function nodeColor(node, entryId) {
	if (node.id === entryId || node.isEntry) return ENTRY;
	return fileType(node.path || node.label).color;
}

function render(first) {
	if (isTemporal()) {
		archSvg.style.display = 'none';
		netCanvas.style.display = 'block';
		empty.style.display = 'none';
		resizeCanvas();
		updateLegend(null, false);
		updateTemporalUI(temporalState, temporalDiff);
		dirty = true;
		kickRaf();
		return;
	}

	temporalToolbar.style.display = 'none';
	temporalScrubberBar.style.display = 'none';
	toolbar.style.display = 'flex';

	if (!snapshot || !snapshot.nodes || !snapshot.nodes.length) {
		archSvg.style.display = 'none';
		netCanvas.style.display = 'none';
		empty.style.display = 'flex';
		empty.textContent = (diagnostics && diagnostics.message) || 'Preparing Code Graph…';
		status.textContent = (diagnostics && diagnostics.status) === 'scanning' ? 'Scanning workspace…' : 'Idle';
		return;
	}

	empty.style.display = 'none';
	archSvg.style.display = 'none';
	netCanvas.style.display = 'block';
	resizeCanvas();
	rebuildBase3d(snapshot);
	updateLegend(snapshot, true);
	status.textContent = snapshot.nodes.length + ' files · ' + (snapshot.edges || []).length + ' edges';
	dirty = true;
	kickRaf();
}

function closePopup() {
	popup.style.display = 'none';
	popupNode = null;
}

function inferOverview(node) {
	if (!node) return 'No file details.';
	if (node.meta && node.meta.overview) return node.meta.overview;
	return 'Source file (' + fileType(node.path || node.label).name + ').';
}

function placePopupNear(clientX, clientY) {
	const pw = 300, ph = 200;
	let left = clientX + 12;
	let top = clientY + 12;
	if (left + pw > window.innerWidth - 12) left = clientX - pw - 12;
	if (top + ph > window.innerHeight - 12) top = clientY - ph - 12;
	popup.style.left = Math.max(12, left) + 'px';
	popup.style.top = Math.max(12, top) + 'px';
	popup.style.display = 'block';
}

let describeTimer = null;
function openNodePopup(node, clientX, clientY) {
	if (describeTimer) {
		clearTimeout(describeTimer);
		describeTimer = null;
	}
	popupNode = node;
	selectedNodeId = node.entityId || node.id;
	popupTitle.textContent = node.label || node.id;
	popupMeta.textContent = (node.path || '') + (node.meta && node.meta.architectureLayer ? ' · ' + node.meta.architectureLayer : '') + (node.changeKind ? ' · ' + node.changeKind.toUpperCase() : '');
	popupOverview.textContent = inferOverview(node);
	popupAi.textContent = '';
	if (popupAiProvenance) { popupAiProvenance.style.display = 'none'; popupAiProvenance.textContent = ''; }

	if (isTemporal()) {
		popupSourceDiff.style.display = 'inline-block';
		popupHistoricalView.style.display = 'inline-block';
		popupOpen.style.display = 'none';
		popupMagnus.disabled = true;
		popupMagnus.title = 'Attach to Agents is available on the live codebase.';
	} else {
		popupSourceDiff.style.display = 'none';
		popupHistoricalView.style.display = 'none';
		popupOpen.style.display = 'inline-block';
		popupMagnus.disabled = false;
		popupMagnus.title = 'Attach to Agents';
	}

	placePopupNear(clientX, clientY);

	if (isTemporal()) {
		request('selectTemporalEntity', { entityId: node.entityId });
		dirty = true; drawTemporalFrame(performance.now());
	} else {
		request('selectNode', { nodeId: selectedNodeId });
		request('peekNodeDescription', { nodeId: node.id }).then(peek => {
			if (!popupNode || popupNode.id !== node.id) return;
			if (peek && peek.cached && peek.description) {
				popupAi.textContent = peek.description;
			} else {
				popupAi.textContent = 'Generating AI description…';
				describeTimer = setTimeout(async () => {
					const desc = await request('describeNode', { nodeId: node.id });
					if (!popupNode || popupNode.id !== node.id) return;
					if (desc && desc.aiStatus === 'ready' && desc.aiDescription) {
						popupAi.textContent = desc.aiDescription;
					} else {
						popupAi.textContent = (desc && desc.aiMessage) || 'AI description unavailable.';
					}
				}, 60);
			}
		});
		dirty = true; drawNetworkFrame();
	}
}

function onPointerDown(e, host) {
	if (!e.isPrimary || (e.button !== 0 && e.button !== 1)) return;
	if (popup.style.display !== 'none') {
		closePopup();
	}
	activePointerId = e.pointerId;
	activePointerHost = host;
	interactionState = 'pressed';
	dragThreshold = thresholdForPointer(e.pointerType);
	dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY;
	pointerDownX = e.clientX; pointerDownY = e.clientY;
	pointerDownNode = isTemporal()
		? pickTemporalNode(e.clientX, e.clientY)
		: pickNetworkNode(e.clientX, e.clientY);

	const wantPan = e.button === 1 || e.shiftKey || isTemporal();
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

	const dist = e ? Math.hypot((e.clientX || 0) - pointerDownX, (e.clientY || 0) - pointerDownY) : 99;
	if (e && !wasMoved && dist <= dragThreshold) {
		if (isTemporal()) {
			const node = pickTemporalNode(e.clientX, e.clientY);
			if (node) {
				openNodePopup(node, e.clientX, e.clientY);
				return;
			}
			selectedNodeId = null;
			request('selectTemporalEntity', { entityId: null });
			closePopup();
			dirty = true; drawTemporalFrame(performance.now());
		} else {
			const node = pickNetworkNode(e.clientX, e.clientY);
			if (node) {
				openNodePopup(node, e.clientX, e.clientY);
				return;
			}
			selectedNodeId = null;
			request('selectNode', { nodeId: null });
			closePopup();
			dirty = true; drawNetworkFrame();
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
	if (!panning) return;
	interactionState = 'panning';
	transform.x += dx; transform.y += dy;
	dirty = true; kickRaf();
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
	dirty = true; kickRaf();
}

netCanvas.addEventListener('pointerdown', function (e) { onPointerDown(e, netCanvas); });
netCanvas.addEventListener('pointermove', onPointerMove);
netCanvas.addEventListener('pointerup', function (e) { onPointerUp(e, false); });
netCanvas.addEventListener('pointercancel', function (e) { onPointerUp(e, true); });
netCanvas.addEventListener('lostpointercapture', function (e) { onPointerUp(e, true); });
netCanvas.addEventListener('wheel', onWheel, { passive: false });

netCanvas.addEventListener('dblclick', function (e) {
	if (isTemporal()) {
		const node = pickTemporalNode(e.clientX, e.clientY);
		if (node) request('openTemporalSourceDiff', { entityId: node.entityId });
	} else {
		const node = pickNetworkNode(e.clientX, e.clientY);
		if (node) request('openFile', { path: node.path || node.id.replace(/^file:/, '') });
	}
});

document.getElementById('popupClose').onclick = function () { closePopup(); };
document.getElementById('popupOpen').onclick = function () {
	if (popupNode) request('openFile', { path: popupNode.path || popupNode.id.replace(/^file:/, '') });
};
document.getElementById('popupHistoricalView').onclick = function () {
	if (popupNode && popupNode.entityId) request('openTemporalHistoricalFile', { entityId: popupNode.entityId });
};
document.getElementById('popupSourceDiff').onclick = function () {
	if (popupNode && popupNode.entityId) request('openTemporalSourceDiff', { entityId: popupNode.entityId });
};
document.getElementById('popupReveal').onclick = function () {
	if (popupNode) request('revealFile', { path: popupNode.path || popupNode.id.replace(/^file:/, '') });
};
document.getElementById('popupMagnus').onclick = function () { request('attachToMagnus', {}); };

temporalRefSelect.addEventListener('change', function () {
	const ref = temporalRefSelect.value;
	if (ref) {
		request('selectTemporalRef', { ref: ref });
	}
});

temporalCompareSelect.addEventListener('change', function () {
	const base = temporalCompareSelect.value || undefined;
	request('setTemporalCompareBase', { compareBaseSha: base });
});

temporalModeChangesBtn.addEventListener('click', function () {
	request('setTemporalDisplayMode', { mode: 'changes' });
});

temporalModeStateBtn.addEventListener('click', function () {
	request('setTemporalDisplayMode', { mode: 'state' });
});

temporalScrubber.addEventListener('input', function () {
	const val = parseInt(temporalScrubber.value, 10);
	const timeline = (temporalState && temporalState.pagedTimeline) || [];
	const total = timeline.length;
	const targetIdx = (total - 1) - val;
	if (timeline[targetIdx]) {
		request('selectTemporalCommit', { commitSha: timeline[targetIdx].sha, immediate: false });
	}
});

temporalScrubber.addEventListener('change', function () {
	const val = parseInt(temporalScrubber.value, 10);
	const timeline = (temporalState && temporalState.pagedTimeline) || [];
	const total = timeline.length;
	const targetIdx = (total - 1) - val;
	if (timeline[targetIdx]) {
		request('selectTemporalCommit', { commitSha: timeline[targetIdx].sha, immediate: true });
	}
});

temporalPrevBtn.addEventListener('click', function () { stepTemporalCommit(-1); });
temporalNextBtn.addEventListener('click', function () { stepTemporalCommit(1); });
temporalPlayBtn.addEventListener('click', toggleTemporalPlay);
temporalLoadMoreBtn.addEventListener('click', function () { request('loadMoreTemporalHistory', {}); });

temporalFilterInput.addEventListener('input', function () {
	dirty = true;
	kickRaf();
});

temporalFollowHead.addEventListener('change', function () {
	request('setTemporalFollowHead', { follow: temporalFollowHead.checked });
});

window.addEventListener('keydown', function (e) {
	if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
	if (e.key === 'Escape') {
		closePopup(); selectedNodeId = null; request('selectNode', { nodeId: null }); dirty = true; kickRaf();
	} else if (isTemporal()) {
		if (e.key === 'ArrowLeft') { e.preventDefault(); stepTemporalCommit(-1); }
		else if (e.key === 'ArrowRight') { e.preventDefault(); stepTemporalCommit(1); }
		else if (e.key === ' ') { e.preventDefault(); toggleTemporalPlay(); }
	}
});

document.getElementById('zoomIn').onclick = function () { transform.k = Math.min(3.5, transform.k * 1.15); dirty = true; kickRaf(); };
document.getElementById('zoomOut').onclick = function () { transform.k = Math.max(0.15, transform.k / 1.15); dirty = true; kickRaf(); };
document.getElementById('fit').onclick = function () { fitView(); };
document.getElementById('reset').onclick = function () {
	resetCamera(false);
	fitView();
};

let lastViewportW = 0;
let lastViewportH = 0;
let resizeRafPending = false;

function onStageResize(newW, newH) {
	if (!newW || !newH) return;
	if (lastViewportW === 0 || lastViewportH === 0) {
		lastViewportW = newW;
		lastViewportH = newH;
		resizeCanvas();
		return;
	}

	const dw = newW - lastViewportW;
	const dh = newH - lastViewportH;
	lastViewportW = newW;
	lastViewportH = newH;

	if (Math.abs(dw) > 0.5 || Math.abs(dh) > 0.5) {
		transform.x += dw / 2;
		transform.y += dh / 2;
		dirty = true;
	}

	resizeCanvas();

	if (popup && popup.style.display !== 'none') {
		const pw = popup.offsetWidth || 320;
		const ph = popup.offsetHeight || 220;
		let left = parseFloat(popup.style.left) || 12;
		let top = parseFloat(popup.style.top) || 12;
		if (left + pw > newW - 8) left = Math.max(8, newW - pw - 8);
		if (top + ph > newH - 8) top = Math.max(8, newH - ph - 8);
		popup.style.left = left + 'px';
		popup.style.top = top + 'px';
	}

	if (dirty) {
		kickRaf();
	}
}

function scheduleResizeCheck() {
	if (resizeRafPending) return;
	resizeRafPending = true;
	requestAnimationFrame(function () {
		resizeRafPending = false;
		const stageEl = document.getElementById('stage') || netCanvas || archSvg;
		if (stageEl) {
			const rect = stageEl.getBoundingClientRect();
			onStageResize(rect.width, rect.height);
		}
	});
}

if (typeof ResizeObserver !== 'undefined') {
	const stageEl = document.getElementById('stage') || document.body;
	const observer = new ResizeObserver(function (entries) {
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			const cr = entry.contentRect;
			if (cr && cr.width > 0 && cr.height > 0) {
				scheduleResizeCheck();
			}
		}
	});
	observer.observe(stageEl);
} else {
	window.addEventListener('resize', scheduleResizeCheck);
}

window.addEventListener('message', function (e) {
	const msg = e.data;
	if (!msg) return;
	if (msg.type === 'response' && pending.has(msg.requestId)) {
		const resolve = pending.get(msg.requestId);
		pending.delete(msg.requestId);
		resolve(msg.payload);
	} else if (msg.type === 'snapshot') {
		snapshot = msg.payload.snapshot;
		diagnostics = msg.payload.diagnostics;
		if (msg.payload.settings) settings = msg.payload.settings;
		if (msg.payload.graphType) graphType = msg.payload.graphType;
		if (msg.payload.temporalState) {
			temporalState = msg.payload.temporalState;
			temporalDiff = temporalState.diff || null;
			updateTemporalDiffTransition(temporalDiff);
		}
		render(false);
	} else if (msg.type === 'temporalState') {
		temporalState = msg.payload;
		if (temporalState.diff) {
			temporalDiff = temporalState.diff;
			updateTemporalDiffTransition(temporalDiff);
		}
		updateTemporalUI(temporalState, temporalDiff);
		render(false);
	} else if (msg.type === 'temporalDiff') {
		temporalDiff = msg.payload;
		updateTemporalDiffTransition(temporalDiff);
		updateTemporalUI(temporalState, temporalDiff);
	} else if (msg.type === 'temporalTimeline') {
		if (temporalState) temporalState = Object.assign({}, temporalState, { pagedTimeline: msg.payload });
		updateTemporalUI(temporalState, temporalDiff);
	} else if (msg.type === 'fitView') {
		fitView();
	} else if (msg.type === 'resetView') {
		resetCamera(false);
		fitView();
	}
});

function rafLoop(ts) {
	rafScheduled = false;
	const dt = Math.min(0.05, Math.max(0, (ts - (lastRafTs || ts)) / 1000));
	lastRafTs = ts;

	if (isTemporal()) {
		if (dirty || isAnimatingTemporal) {
			drawTemporalFrame(ts);
			dirty = false;
		}
	} else {
		const animating = canIdleRotate() && !idlePaused;
		if (animating) {
			rotation.yaw += IDLE_YAW * dt;
			dirty = true;
		}
		if (dirty && isNetwork() && snapshot) drawNetworkFrame();
		if (animating) kickRaf();
	}
}
kickRaf();

request('getSnapshot').then(function (res) {
	snapshot = res && res.snapshot;
	diagnostics = res && res.diagnostics;
	selectedNodeId = (res && res.selectedNodeId) || null;
	if (res && res.settings) settings = res.settings;
	if (res && res.viewState && res.viewState.graphType) graphType = res.viewState.graphType;
	if (res && res.temporalState) {
		temporalState = res.temporalState;
		temporalDiff = temporalState.diff || null;
		if (temporalDiff) updateTemporalDiffTransition(temporalDiff);
	}
	render(true);
	if (isTemporal()) {
		fitView();
	} else {
		resetCamera(false);
		fitView();
		scheduleIdleResume();
	}
});
</script>
</body>
</html>`;
	}
}

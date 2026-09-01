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
import { IQuickInputService, type IQuickPickItem } from '../../../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IWorkbenchGitHistoryService } from './workbenchGitHistoryService.js';
import { PreBaseGraphConfigKeys } from '../../common/configuration/graphConfigKeys.js';
import { serializeNetworkEdgeVisualSource } from './networkEdgeVisualRuntime.js';
import {
	serializeNetworkVisualRadiusSource,
	serializeNetworkPickRadiusSource,
	serializeNetworkFitTransformSource,
	serializeNetworkDepthAlphaSource,
	serializeNetworkLabelWorldFontSizeSource,
} from './networkRenderMathRuntime.js';
import {
	serializeTemporalUnifiedStatusSource,
	serializeTemporalFocusContextSource,
	serializeTemporalVisualRadiusSource,
	serializeTemporalFitTransformSource,
	serializeTemporalCommunityAggregateEdgesSource,
	serializeTemporalEdgeLodStyleSource,
	serializeTemporalAggregateEdgeRouteSource,
	serializeTemporalVisibleLabelsSource,
	serializeTemporalLabelLayoutSource,
	serializeTemporalProjectionSource,
} from './temporalRuntimeContracts.js';
import { PreBaseGraphEditorInput } from './graphEditorInput.js';
import { IPreBaseGraphDescriptionService } from './prebaseGraphDescriptionService.js';
import { IPreBaseGraphService, type PreBaseGraphType } from './prebaseGraphService.js';
import {
	IPreBaseTemporalViewService,
	type ITemporalViewState,
	type TemporalStructuralDiff,
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
	private _webviewGeneration = 0;

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
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkbenchGitHistoryService private readonly gitHistoryService: IWorkbenchGitHistoryService,
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
		this._ensureWebview();
		this._pushSnapshot();

		if (this._inputType === 'temporal') {
			void this.temporalViewService.initialize();
			this._pushTemporalState(this.temporalViewService.getState());
			const diff = this.temporalViewService.getState().diff;
			if (diff) {
				this._pushTemporalDiff(diff);
			}
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
		if (this._inputType === 'temporal') {
			this.temporalViewService.pauseActiveWork();
		}
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
		const generation = ++this._webviewGeneration;
		const webview = this._webviewDisposables.add(this.webviewService.createWebviewElement({
			title: localize('prebase.graph.webviewTitle', "PreBase Graph"),
			options: { retainContextWhenHidden: false },
			contentOptions: {
				allowScripts: true,
				localResourceRoots: []
			},
			extension: undefined
		}));
		this._webview = webview;
		this._webviewDisposables.add(webview.onMessage(e => this._onMessage(e.message as IBridgeRequest, generation)));
		webview.mountTo(this._container, this.window);
		webview.setHtml(this._buildHtml(generation));
	}

	private _graphSettings() {
		const quality = this.configurationService.getValue<string>(PreBaseGraphConfigKeys.GraphQuality) || 'auto';
		const maxNodes = this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphMaxRenderedNodes) || 280;
		const maxEdges = this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphMaxRenderedEdges) || 420;
		const networkDragDirection = this.configurationService.getValue<string>(PreBaseGraphConfigKeys.InteractionNetworkDragDirection) === 'inverted'
			? 'inverted'
			: 'natural';
		const zoomSensitivity = this.configurationService.getValue<number>(PreBaseGraphConfigKeys.InteractionZoomSensitivity) ?? 1.0;
		const panSensitivity = this.configurationService.getValue<number>(PreBaseGraphConfigKeys.InteractionPanSensitivity) ?? 1.0;
		const keepGraphCentered = Boolean(this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.InteractionKeepGraphCentered));
		const networkEdgeOpacity = this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphNetworkEdgeOpacity) ?? 0.55;
		const layoutAnimationDuration = Math.max(0, Math.min(2000, this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphLayoutAnimationDuration) ?? 320));
		return {
			showLegend: this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphShowLegend) !== false,
			initialZoom: this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphInitialZoom) || 1,
			reduceMotion: this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphReduceMotion) === true,
			networkIdleAutoRotate: !!this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate),
			networkDragDirection,
			maxRenderedNodes: maxNodes,
			maxRenderedEdges: maxEdges,
			quality,
			zoomSensitivity,
			panSensitivity,
			keepGraphCentered,
			networkEdgeOpacity,
			layoutAnimationDuration
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

	private async _onMessage(message: IBridgeRequest, generation?: number): Promise<void> {
		if (generation !== undefined && generation !== this._webviewGeneration) {
			return;
		}
		if (!message || !message.type) {
			return;
		}
		const reply = async (payload: unknown) => {
			if (generation === undefined || generation === this._webviewGeneration) {
				this._webview?.postMessage({ type: 'response', requestId: message.requestId, payload });
			}
		};

		switch (message.type) {
			case 'ready': {
				this._pushSnapshot();
				if (this._inputType === 'temporal') {
					this._pushTemporalState(this.temporalViewService.getState());
					const diff = this.temporalViewService.getState().diff;
					if (diff) {
						this._pushTemporalDiff(diff);
					}
				}
				await reply({ ok: true, graphType: this._inputType });
				break;
			}
			case 'getSnapshot':
				await reply({
					snapshot: this.graphService.getSnapshot(),
					diagnostics: this.graphService.getDiagnostics(),
					viewState: this.graphService.getViewState(),
					selectedNodeId: this.graphService.getSelectedNodeId() ?? null,
					settings: this._graphSettings(),
					graphType: this._inputType,
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
				const contentIdentity = this._getContentIdentityForNode(node.path);
				const peek = this.descriptionService.peekCachedDescription(node, { projectRoot: snapshot?.projectPath, contentIdentity });
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
				const contentIdentity = this._getContentIdentityForNode(node.path);
				const result = await this.descriptionService.describeNode(node, this._descriptionCts.token, { projectRoot: snapshot?.projectPath, contentIdentity });
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
				let result: { ok: boolean; message?: string } = { ok: false, message: 'Missing entityId' };
				if (p?.entityId) {
					result = await this.temporalViewService.openHistoricalFile(p.entityId);
				}
				if (!result.ok && result.message) {
					this.notificationService?.warn(result.message);
				}
				await reply(result);
				break;
			}
			case 'openTemporalSourceDiff': {
				const p = message.payload as { entityId?: string } | undefined;
				let result: { ok: boolean; message?: string } = { ok: false, message: 'Missing entityId' };
				if (p?.entityId) {
					result = await this.temporalViewService.openSourceDiff(p.entityId);
				}
				if (!result.ok && result.message) {
					this.notificationService?.warn(result.message);
				}
				await reply(result);
				break;
			}
			case 'setNetworkIdleAutoRotate': {
				const enabled = !!(message.payload as { enabled?: boolean } | undefined)?.enabled;
				await this.configurationService.updateValue(PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate, enabled);
				await reply({ ok: true });
				break;
			}
			case 'updateSetting': {
				const p = message.payload as { key?: string; value?: unknown } | undefined;
				if (p?.key && (p.key.startsWith('prebase.graph.') || p.key.startsWith('prebase.interaction.'))) {
					await this.configurationService.updateValue(p.key, p.value);
				}
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
			case 'switchTemporalRepository': {
				const repoRoot = (message.payload as { repoRoot?: string } | undefined)?.repoRoot;
				if (repoRoot) {
					await this.temporalViewService.switchRepository(repoRoot);
				}
				await reply({ ok: true });
				break;
			}
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
			case 'retryTemporalSelection': {
				await this.temporalViewService.retrySelection();
				await reply({ ok: true });
				break;
			}
			case 'selectTemporalCommitIndex': {
				const p = message.payload as { index?: number; immediate?: boolean } | undefined;
				if (typeof p?.index === 'number') {
					await this.temporalViewService.selectCommitIndex(p.index, { immediate: p.immediate });
				}
				await reply({ ok: true });
				break;
			}
			case 'stepTemporalCommit': {
				const p = message.payload as { delta?: number } | undefined;
				if (typeof p?.delta === 'number') {
					await this.temporalViewService.stepCommit(p.delta);
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
			case 'pickTemporalCompareBase': {
				await this._pickTemporalCompareBase();
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

	private _getContentIdentityForNode(filePath?: string): string | undefined {
		const canonical = this.graphService.getCanonicalSnapshot();
		if (!canonical || !filePath) {
			return undefined;
		}
		const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
		const entries = canonical.manifest?.entries;
		if (Array.isArray(entries)) {
			const entry = entries.find((e: any) => {
				const entryPath = (e.path || e.relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
				return entryPath === normalized;
			});
			if (entry?.contentIdentity) {
				return entry.contentIdentity;
			}
		}
		return undefined;
	}

	private async _pickTemporalCompareBase(): Promise<void> {
		if (!this.quickInputService) {
			return;
		}
		const state = this.temporalViewService.getState();
		const curSha = state.selectedCommitSha;
		const curCommit = state.selectedCommitSummary;
		const timeline = state.pagedTimeline || [];
		const refs = state.repositoryRefs || [];

		interface IComparePickItem extends IQuickPickItem {
			action: 'first-parent' | 'parent-2' | 'reset-parent' | 'pinned-sha' | 'custom-ref';
			sha?: string;
		}

		const items: IComparePickItem[] = [];

		const p1Sha = curCommit?.parents?.[0];
		items.push({
			label: '$(git-commit) First Parent' + (p1Sha ? ` (${p1Sha.slice(0, 7)})` : ''),
			description: 'Dynamic comparison against immediate previous commit',
			action: 'first-parent',
		});

		if (curCommit?.parents && curCommit.parents.length > 1) {
			const p2Sha = curCommit.parents[1];
			items.push({
				label: `$(git-merge) Second Parent (${p2Sha.slice(0, 7)})`,
				description: 'Explicit comparison against merge parent branch',
				action: 'parent-2',
			});
		}

		if (state.comparisonSelection?.mode === 'pinned') {
			items.push({
				label: `$(debug-restart) Reset to First Parent`,
				description: `Currently pinned to ${state.compareBaseSha?.slice(0, 7) || 'custom commit'}`,
				action: 'reset-parent',
			});
		}

		// Local branches
		const localBranches = refs.filter(r => r.kind === 'branch');
		if (localBranches.length > 0) {
			items.push({ type: 'separator', label: 'Local Branches' } as any);
			for (const b of localBranches) {
				items.push({
					label: `$(git-branch) ${b.name}`,
					description: b.targetSha ? b.targetSha.slice(0, 7) : '',
					action: 'pinned-sha',
					sha: b.targetSha,
				});
			}
		}

		// Remote branches
		const remoteBranches = refs.filter(r => r.kind === 'remote-branch');
		if (remoteBranches.length > 0) {
			items.push({ type: 'separator', label: 'Remote Branches' } as any);
			for (const b of remoteBranches) {
				items.push({
					label: `$(cloud) ${b.name}`,
					description: b.targetSha ? b.targetSha.slice(0, 7) : '',
					action: 'pinned-sha',
					sha: b.targetSha,
				});
			}
		}

		// Tags
		const tags = refs.filter(r => r.kind === 'tag');
		if (tags.length > 0) {
			items.push({ type: 'separator', label: 'Tags' } as any);
			for (const t of tags) {
				items.push({
					label: `$(tag) ${t.name}`,
					description: t.targetSha ? t.targetSha.slice(0, 7) : '',
					action: 'pinned-sha',
					sha: t.targetSha,
				});
			}
		}

		items.push({ type: 'separator', label: 'Recent Commits' } as any);
		for (const c of timeline.slice(0, 15)) {
			if (c.sha !== curSha) {
				items.push({
					label: `$(git-commit) ${c.shortSha || c.sha.slice(0, 7)}: ${c.message}`,
					description: c.author ? `by ${c.author}` : '',
					action: 'pinned-sha',
					sha: c.sha,
				});
			}
		}

		items.push({ type: 'separator', label: 'Custom' } as any);
		items.push({
			label: '$(search) Enter custom branch, tag, or SHA…',
			description: 'Resolve symbolic ref or specific commit SHA',
			action: 'custom-ref',
		});

		const selected = await this.quickInputService.pick(items, {
			placeHolder: 'Select commit or ref to compare against',
		});

		if (!selected) {
			return;
		}

		if (selected.action === 'first-parent' || selected.action === 'reset-parent') {
			await this.temporalViewService.setCompareBase({ mode: 'first-parent' });
		} else if (selected.action === 'parent-2') {
			await this.temporalViewService.setCompareBase({ mode: 'parent', parentIndex: 1 });
		} else if (selected.action === 'pinned-sha' && selected.sha) {
			await this.temporalViewService.setCompareBase({ mode: 'pinned', baseSha: selected.sha });
		} else if (selected.action === 'custom-ref') {
			const input = await this.quickInputService.input({
				prompt: 'Enter Git branch, tag, or commit SHA to compare against',
				placeHolder: 'e.g. main, v1.0.0, 3a9f1c2',
			});
			if (input && input.trim()) {
				const trimmed = input.trim();
				const root = state.activeRepositoryRoot;
				if (!root || !this.gitHistoryService) {
					this.notificationService.warn(localize('prebase.temporal.noRepo', "No active repository to resolve ref."));
					return;
				}
				try {
					const resolvedSha = await this.gitHistoryService.resolveRef(root, trimmed);
					if (resolvedSha && /^[0-9a-fA-F]{40,64}$/.test(resolvedSha.trim())) {
						await this.temporalViewService.setCompareBase({ mode: 'pinned', baseSha: resolvedSha.trim() });
					} else {
						this.notificationService.error(localize('prebase.temporal.resolveFailed', 'Could not resolve "{0}" to a commit.', trimmed));
					}
				} catch (err: any) {
					this.notificationService.error(localize('prebase.temporal.resolveFailed', 'Could not resolve "{0}" to a commit.', trimmed));
				}
			}
		}
	}

	private _buildHtml(generation: number): string {
		const nonce = generateUuid();
		const initialGraphType = this._inputType;
		return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' 'unsafe-inline'; style-src-elem 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
html, body { margin:0; height:100%; background:var(--vscode-editor-background, #1B1C1E); color:var(--vscode-foreground, #f4f4f5); font-family: var(--vscode-font-family, ui-sans-serif, system-ui, sans-serif); overflow:hidden; }
#stage { position:absolute; inset:0; }
#archSvg, #netCanvas { position:absolute; inset:0; width:100%; height:100%; display:none; touch-action:none; }
#archSvg { cursor:grab; }
#archSvg.dragging { cursor:grabbing; }
/* Base cursor is managed by updateCanvasCursor() (state-driven); CSS provides the
   manipulation fallback for the brief moment before JS state settles. */
#netCanvas { cursor:grab; }
#toolbar { position:absolute; left:12px; bottom:56px; z-index:4; display:flex; gap:2px; align-items:center; background:color-mix(in srgb, var(--vscode-editorWidget-background, #303030) 88%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:8px; padding:3px; }
#toolbar button, #toolbar label { background:transparent; color:var(--vscode-foreground, #f4f4f5); border:1px solid transparent; border-radius:6px; padding:0; cursor:pointer; font-size:12px; }
#toolbar button { width:26px; height:26px; display:flex; align-items:center; justify-content:center; }
#toolbar button svg { width:16px; height:16px; fill:currentColor; display:block; pointer-events:none; }
#toolbar button:hover { background:var(--vscode-toolbar-hoverBackground, #303030); }
#toolbar button:focus-visible, .commit-marker:focus-visible, #temporalToolbar button:focus-visible,
#temporalScrubberBar button:focus-visible, #popup button:focus-visible, #temporalDetailsClose:focus-visible {
	outline:1px solid var(--vscode-focusBorder, #007fd4); outline-offset:1px;
}
/* Center Lock active state: shape change + outline + accent, never color alone. */
#toolbar button[aria-pressed="true"] { color:var(--vscode-button-background, #2dd4bf); border-color:var(--vscode-button-background, #2dd4bf); background:color-mix(in srgb, var(--vscode-button-background, #2dd4bf) 14%, transparent); }
#toolbar button .icon-pressed { display:none; }
#toolbar button[aria-pressed="true"] .icon-unpressed { display:none; }
#toolbar button[aria-pressed="true"] .icon-pressed { display:block; }
#toolbar label { display:flex; gap:4px; align-items:center; user-select:none; opacity:.9; }
#idleToggleWrap { display:none; }
#status { position:absolute; left:50%; transform:translateX(-50%); bottom:14px; z-index:4; font-size:12px; background:color-mix(in srgb, var(--vscode-editorWidget-background, #303030) 90%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:999px; padding:6px 14px; white-space:nowrap; max-width:90%; overflow:hidden; text-overflow:ellipsis; }
#legend { position:absolute; left:12px; bottom:72px; z-index:4; display:none; background:color-mix(in srgb, var(--vscode-editorWidget-background, #303030) 90%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:8px; padding:8px 10px; font-size:10px; min-width:112px; max-width:168px; }
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
#temporalToolbar { position:absolute; top:12px; left:12px; right:12px; z-index:5; display:none; gap:8px; align-items:center; background:color-mix(in srgb, var(--vscode-editorWidget-background, #202122) 94%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:8px; padding:4px 8px; font-size:11.5px; backdrop-filter:blur(8px); max-width:calc(100% - 24px); box-sizing:border-box; box-shadow:0 4px 16px rgba(0,0,0,0.2); }
#temporalToolbar select, #temporalToolbar input { background:var(--vscode-dropdown-background, #252526); color:var(--vscode-dropdown-foreground, #cccccc); border:1px solid var(--vscode-dropdown-border, #3c3c3c); border-radius:4px; padding:3px 6px; font-size:11px; }
#temporalDisplayModeWrap button { background:transparent; color:var(--vscode-foreground, #cccccc); border:0; border-radius:3px; padding:3px 8px; cursor:pointer; font-size:11px; font-family:inherit; transition:background-color 0.12s ease, color 0.12s ease; }
#temporalDisplayModeWrap button.active { background:var(--vscode-button-background, #2dd4bf); color:var(--vscode-button-foreground, #1B1C1E); font-weight:600; }
#temporalContextModeWrap button { background:transparent; color:var(--vscode-foreground, #cccccc); border:0; border-radius:3px; padding:3px 8px; cursor:pointer; font-size:11px; }
#temporalContextModeWrap button.active { background:var(--vscode-button-background, #2dd4bf); color:var(--vscode-button-foreground, #1B1C1E); font-weight:600; }
#temporalViewportControls button:hover { background:var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1)); }
#temporalViewportControls button:focus-visible { outline:1px solid var(--vscode-focusBorder, #007fd4); outline-offset:1px; }
#temporalCenterLockBtn[aria-pressed="true"] { color:var(--vscode-button-background, #2dd4bf) !important; border-color:var(--vscode-button-background, #2dd4bf) !important; background:color-mix(in srgb, var(--vscode-button-background, #2dd4bf) 16%, transparent) !important; }
#temporalCenterLockBtn .icon-pressed { display:none; }
#temporalCenterLockBtn[aria-pressed="true"] .icon-unpressed { display:none; }
#temporalCenterLockBtn[aria-pressed="true"] .icon-pressed { display:block !important; }
#temporalRetryBtn:hover { background:var(--vscode-button-secondaryHoverBackground, #45494e); }

@media (max-width: 780px) {
	#temporalViewportControls #temporalZoomInBtn,
	#temporalViewportControls #temporalZoomOutBtn,
	#temporalViewportControls #temporalResetBtn {
		display:none !important;
	}
}

@media (max-width: 580px) {
	#temporalBreadcrumbVs,
	#temporalBreadcrumbBase {
		display:none !important;
	}
	#temporalDiffBadges .badge-removed,
	#temporalDiffBadges .badge-renamed {
		display:none !important;
	}
}

#temporalScrubberBar { position:absolute; left:12px; right:12px; bottom:12px; z-index:5; display:none; flex-direction:column; gap:6px; background:color-mix(in srgb, var(--vscode-editorWidget-background, #202122) 94%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:8px; padding:8px 12px; font-size:12px; backdrop-filter:blur(8px); }
#temporalScrubberBar .row { display:flex; align-items:center; width:100%; box-sizing:border-box; }
#temporalScrubberBar .controls-row { display:flex; align-items:center; gap:8px; width:100%; }
#temporalScrubberBar .track-row { display:flex; align-items:center; width:100%; margin-top:2px; }
#temporalScrubberBar button { background:transparent; color:var(--vscode-foreground, #f4f4f5); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:4px; padding:3px 6px; cursor:pointer; font-size:11px; display:inline-flex; align-items:center; justify-content:center; min-width:24px; height:22px; box-sizing:border-box; }
#temporalScrubberBar button svg { width:12px; height:12px; fill:currentColor; display:block; pointer-events:none; }
#temporalScrubberBar button:hover { background:var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08)); }
#temporalTimelineStrip { display:flex; align-items:center; gap:4px; height:20px; overflow-x:auto; width:100%; padding:2px 0; }
.commit-marker { width:10px; height:10px; border-radius:50%; background:var(--vscode-descriptionForeground, #71717a); flex:0 0 auto; cursor:pointer; transition:transform 0.1s ease; border:1px solid transparent; padding:0; }
.commit-marker:hover { transform:scale(1.3); }
.commit-marker:focus-visible { outline:2px solid var(--vscode-focusBorder, #007fd4); outline-offset:2px; }
.commit-marker.active { background:var(--vscode-button-background, #2dd4bf); transform:scale(1.4); border-color:#fff; }
.commit-marker.is-merge { border-radius:2px; background:#a371f7; }
#temporalScrubber { width:100%; height:5px; accent-color:var(--vscode-button-background, #2dd4bf); cursor:pointer; }
.badge-added { color:var(--vscode-gitDecoration-addedResourceForeground, #3fb950); background:rgba(63,185,80,0.15); padding:1px 6px; border-radius:4px; font-weight:600; }
.badge-removed { color:var(--vscode-gitDecoration-deletedResourceForeground, #f85149); background:rgba(248,81,73,0.15); padding:1px 6px; border-radius:4px; font-weight:600; }
.badge-modified { color:var(--vscode-gitDecoration-modifiedResourceForeground, #d29922); background:rgba(210,153,34,0.15); padding:1px 6px; border-radius:4px; font-weight:600; }
.badge-renamed { color:var(--vscode-gitDecoration-renamedResourceForeground, #58a6ff); background:rgba(88,166,255,0.15); padding:1px 6px; border-radius:4px; font-weight:600; }
.badge-warning { color:var(--vscode-editorWarning-foreground, #e3b341); background:rgba(227,179,65,0.15); padding:1px 6px; border-radius:4px; font-weight:600; display:none; }

#temporalDetailsPanel { position:absolute; right:12px; top:52px; bottom:84px; width:min(340px, calc(100vw - 24px)); z-index:5; display:none; flex-direction:column; background:color-mix(in srgb, var(--vscode-editorWidget-background, #202122) 96%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:8px; padding:12px; backdrop-filter:blur(8px); box-shadow:0 8px 24px rgba(0,0,0,0.3); font-size:11.5px; box-sizing:border-box; }
#temporalDetailsPanel .header { display:flex; align-items:center; justify-content:space-between; font-weight:600; font-size:12px; margin-bottom:8px; border-bottom:1px solid var(--vscode-widget-border, #3C3C3C); padding-bottom:6px; }
#temporalDetailsPanel .meta-row { display:flex; flex-direction:column; gap:2px; margin-bottom:6px; }
#temporalDetailsPanel .meta-row label { font-size:10px; text-transform:uppercase; opacity:0.65; font-weight:600; }
#temporalDetailsPanel .delta-summary { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
#temporalDetailsPanel .entity-list { flex:1; overflow-y:auto; border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:4px; padding:4px; margin-top:6px; }
#temporalDetailsPanel .entity-item { display:flex; align-items:center; justify-content:space-between; padding:4px 6px; border-radius:3px; cursor:pointer; font-size:11px; margin-bottom:2px; }
#temporalDetailsPanel .entity-item:hover { background:var(--vscode-list-hoverBackground, rgba(255,255,255,0.06)); }

#empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:2; text-align:center; padding:24px; color:var(--vscode-descriptionForeground, #a1a1aa); font-size:14px; line-height:1.5; }
#popup { position:absolute; z-index:10; width:min(340px, calc(100% - 24px)); max-height:min(420px, calc(100% - 32px)); overflow:auto; display:none; background:color-mix(in srgb, var(--vscode-editorWidget-background, #202122) 96%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:8px; padding:12px; box-shadow:0 10px 30px rgba(0,0,0,0.35); backdrop-filter:blur(10px); font-size:11.5px; color:var(--vscode-foreground, #f4f4f5); }
#popup .popup-header { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px; border-bottom:1px solid var(--vscode-widget-border, rgba(255,255,255,0.08)); padding-bottom:8px; }
#popup .popup-header-main { flex:1; min-width:0; }
#popup .popup-badges { display:flex; gap:4px; align-items:center; margin-bottom:4px; }
#popup .layer-badge { font-size:9.5px; font-weight:600; padding:1px 6px; border-radius:4px; text-transform:uppercase; color:#ffffff; background:#6366f1; }
#popup .change-badge { font-size:9.5px; font-weight:600; padding:1px 6px; border-radius:4px; text-transform:uppercase; }
#popup h3 { margin:0 0 2px; font-size:13px; font-weight:600; color:var(--vscode-editor-foreground, #f4f4f5); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#popup .meta { color:var(--vscode-descriptionForeground, #a1a1aa); font-size:10.5px; word-break:break-all; }
#popup #popupClose { border:0; background:transparent; color:var(--vscode-descriptionForeground, #a1a1aa); border-radius:4px; width:22px; height:22px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:11px; flex-shrink:0; }
#popup #popupClose:hover { background:var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08)); color:var(--vscode-foreground, #f4f4f5); }
#popup .popup-details-list { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }
#popup .detail-row { display:flex; justify-content:space-between; align-items:center; font-size:11px; padding:2px 0; }
#popup .detail-label { color:var(--vscode-descriptionForeground, #a1a1aa); }
#popup .detail-value { font-weight:500; }
#popup .actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; border-top:1px solid var(--vscode-widget-border, rgba(255,255,255,0.08)); padding-top:8px; }
#popup .actions button { background:var(--vscode-button-secondaryBackground, #3a3d41); color:var(--vscode-button-secondaryForeground, #ffffff); border:1px solid transparent; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer; font-weight:500; transition:background 0.1s ease; }
#popup .actions button:hover { background:var(--vscode-button-secondaryHoverBackground, #45494e); }
#popup .actions button.primary { background:var(--vscode-button-background, #2dd4bf); color:var(--vscode-button-foreground, #1B1C1E); font-weight:600; }
#popup .actions button.primary:hover { background:var(--vscode-button-hoverBackground, #14b8a6); }
.no-changes-card { position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); z-index:4; display:none; flex-direction:column; align-items:center; gap:8px; text-align:center; padding:20px 24px; background:color-mix(in srgb, var(--vscode-editorWidget-background, #202122) 94%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:8px; backdrop-filter:blur(8px); box-shadow:0 8px 24px rgba(0,0,0,0.25); max-width:380px; }
.no-changes-card .title { font-size:13px; font-weight:600; color:var(--vscode-foreground, #f4f4f5); }
.no-changes-card .desc { font-size:11.5px; color:var(--vscode-descriptionForeground, #a1a1aa); line-height:1.4; }
.no-changes-card button { background:var(--vscode-button-background, #2dd4bf); color:var(--vscode-button-foreground, #1B1C1E); border:0; border-radius:4px; padding:6px 14px; font-weight:600; font-size:11.5px; cursor:pointer; margin-top:4px; }
#netCanvas:focus-visible { outline:2px solid var(--vscode-focusBorder, #007fd4); outline-offset:-2px; }
.kbd-help { position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); z-index:9; background:color-mix(in srgb, var(--vscode-editorWidget-background, #202122) 97%, transparent); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:8px; padding:14px 18px; font-size:12px; line-height:1.7; box-shadow:0 10px 30px rgba(0,0,0,0.35); pointer-events:none; }
.kbd-help .title { font-weight:700; margin-bottom:6px; }
@media (prefers-reduced-motion: reduce) {
	.commit-marker { transition:none; }
	#popup, .no-changes-card { transition:none; }
}
</style>
</head>
<body>
<div id="stage">
	<div id="empty">Preparing graph…</div>
	<div id="noChangesCard" class="no-changes-card">
		<div class="title">No structural graph changes in this commit</div>
		<div class="desc">Only non-graph modifications (comments, text, or documentation) occurred in this revision.</div>
		<button id="noChangesViewSource" type="button">View Source Changes</button>
	</div>
	<svg id="archSvg"></svg>
	<canvas id="netCanvas" tabindex="0" role="region" aria-roledescription="interactive graph"
		aria-label="Code Graph. Use arrow keys to move between nodes; Enter opens details; press ? for shortcut help."
		aria-describedby="graphKbdHelp"></canvas>
	<div id="graphLiveRegion" role="status" aria-live="polite" style="position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap;"></div>
	<div id="graphKbdHelp" class="kbd-help" hidden>
		<div class="title">Graph keyboard shortcuts</div>
		<div>Arrow keys — move between nodes</div>
		<div>Enter / Space — open node details</div>
		<div>Escape — clear selection / close panels</div>
		<div>+ / − (or =) — zoom in / out · 0 or F — fit view · R — reset view · C — keep centered</div>
		<div>? (or Shift+/) — toggle this shortcut guide</div>
		<div>Tab — leave the canvas to the toolbar and page controls</div>
	</div>
	<div id="temporalDetailsPanel" role="region" aria-label="Commit details and structural delta">
		<div class="header">
			<span>Commit Details & Structural Delta</span>
			<button id="temporalDetailsClose" type="button" title="Close inspector (Esc)" aria-label="Close details" style="border:0; background:transparent; color:var(--vscode-foreground, #f4f4f5); cursor:pointer; width:22px; height:22px; display:flex; align-items:center; justify-content:center; border-radius:4px;"><svg viewBox="0 0 16 16" aria-hidden="true" style="width:14px; height:14px; fill:currentColor; pointer-events:none;"><path d="M13.85 2.15l-.7-.7L8 6.59 2.85 1.45l-.7.7L7.29 7.3 1.45 13.15l.7.7L7.3 8.71l5.85 5.85.7-.7L8.71 8l5.14-5.85z"/></svg></button>
		</div>
		<div class="meta-row">
			<label>Commit</label>
			<span id="detailsCommitSha" style="font-family:monospace; color:var(--vscode-textLink-foreground, #58a6ff); white-space:pre-line;"></span>
		</div>
		<div class="meta-row">
			<label>Message</label>
			<span id="detailsCommitMsg" style="word-break:break-word;"></span>
		</div>
		<div class="meta-row">
			<label>Author / Date</label>
			<span id="detailsCommitAuthor"></span>
		</div>
		<div class="meta-row">
			<label>Parents</label>
			<span id="detailsCommitParents" style="font-family:monospace;"></span>
		</div>
		<div class="delta-summary" id="detailsDeltaSummary"></div>
		<div class="meta-row" style="margin-top:6px; flex:1; display:flex; flex-direction:column; overflow:hidden;">
			<label>Changed Entities</label>
			<div class="entity-list" id="detailsEntityList"></div>
		</div>
	</div>
</div>

<!-- Temporal Minimal Canvas Breadcrumb & Viewport Toolbar -->
<div id="temporalToolbar">
	<div id="temporalDisplayModeWrap" style="display:flex; border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:6px; overflow:hidden; background:rgba(0,0,0,0.25); flex-shrink:0;">
		<button id="temporalModeStateBtn" type="button" class="active" title="Full Codebase Architecture Map (1)" style="padding:2px 8px; font-size:10.5px;">Full Map</button>
		<button id="temporalModeChangesBtn" type="button" title="Focus on Changed Files & Direct Dependencies (2)" style="padding:2px 8px; font-size:10.5px;">Focus Changes</button>
	</div>
	<div id="temporalBreadcrumbWrap" style="display:flex; align-items:center; gap:6px; font-size:11px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1;">
		<span id="temporalBreadcrumbTarget" style="font-family:monospace; font-weight:600; color:var(--vscode-textLink-foreground, #58a6ff);"></span>
		<span id="temporalBreadcrumbVs" style="opacity:0.5; font-size:10px;">vs</span>
		<span id="temporalBreadcrumbBase" style="font-family:monospace; color:var(--vscode-descriptionForeground, #a1a1aa);"></span>
	</div>
	<!-- Temporal Viewport Controls -->
	<div id="temporalViewportControls" style="display:flex; align-items:center; gap:2px; background:rgba(0,0,0,0.2); border:1px solid var(--vscode-widget-border, #3C3C3C); border-radius:6px; padding:2px; flex-shrink:0;">
		<button id="temporalFitBtn" type="button" title="Fit to screen / Recenter graph (F or 0)" aria-label="Fit to screen" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; background:transparent; border:0; color:var(--vscode-foreground, #f4f4f5); border-radius:4px; cursor:pointer;"><svg viewBox="0 0 16 16" aria-hidden="true" style="width:14px; height:14px; fill:currentColor; pointer-events:none;"><path d="M2 2L6.5 2 6.5 3 3.707 3 7.354 6.646 6.646 7.354 3 3.707 3 6.5 2 6.5z M14 14L9.5 14 9.5 13 12.293 13 8.646 9.354 9.354 8.646 13 12.293 13 9.5 14 9.5z"/></svg></button>
		<button id="temporalCenterLockBtn" type="button" title="Keep graph centered during timeline changes (C)" aria-label="Keep graph centered" aria-pressed="false" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; background:transparent; border:1px solid transparent; color:var(--vscode-foreground, #f4f4f5); border-radius:4px; cursor:pointer;"><svg class="icon-unpressed" viewBox="0 0 16 16" aria-hidden="true" style="width:14px; height:14px; fill:currentColor; pointer-events:none;"><path d="M8 1a6 6 0 0 1 6 6c0 2.3-1.5 4.05-3.15 5.07A11 11 0 0 1 8 13.44a11 11 0 0 1-2.85-1.37C3.5 11.05 2 9.3 2 7a6 6 0 0 1 6-6zm0 1a5 5 0 0 0-5 5c0 .34.03.66.1.96C3.53 9.86 5.63 10.94 8 12.4c2.37-1.46 4.47-2.54 4.9-4.44.07-.3.1-.62.1-.96a5 5 0 0 0-5-5zm0 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/></svg><svg class="icon-pressed" viewBox="0 0 16 16" aria-hidden="true" style="width:14px; height:14px; fill:currentColor; pointer-events:none; display:none;"><path d="M8 1a6 6 0 0 1 6 6c0 2.3-1.5 4.05-3.15 5.07A11 11 0 0 1 8 13.44a11 11 0 0 1-2.85-1.37C3.5 11.05 2 9.3 2 7a6 6 0 0 1 6-6zm0 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/></svg></button>
		<button id="temporalZoomInBtn" type="button" title="Zoom in (+)" aria-label="Zoom in" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; background:transparent; border:0; color:var(--vscode-foreground, #f4f4f5); border-radius:4px; cursor:pointer;"><svg viewBox="0 0 16 16" aria-hidden="true" style="width:14px; height:14px; fill:currentColor; pointer-events:none;"><path d="M7.5 2a5.5 5.5 0 0 1 4.383 8.838l4.471 4.47-.707.707-4.47-4.47A5.5 5.5 0 1 1 7.5 2zm0 1a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM8 5v2h2v1H8v2H7V8H5V7h2V5h1z"/></svg></button>
		<button id="temporalZoomOutBtn" type="button" title="Zoom out (-)" aria-label="Zoom out" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; background:transparent; border:0; color:var(--vscode-foreground, #f4f4f5); border-radius:4px; cursor:pointer;"><svg viewBox="0 0 16 16" aria-hidden="true" style="width:14px; height:14px; fill:currentColor; pointer-events:none;"><path d="M7.5 2a5.5 5.5 0 0 1 4.383 8.838l4.471 4.47-.707.707-4.47-4.47A5.5 5.5 0 1 1 7.5 2zm0 1a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM5 7h5v1H5V7z"/></svg></button>
		<button id="temporalResetBtn" type="button" title="Reset View (R)" aria-label="Reset View" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; background:transparent; border:0; color:var(--vscode-foreground, #f4f4f5); border-radius:4px; cursor:pointer;"><svg viewBox="0 0 16 16" aria-hidden="true" style="width:14px; height:14px; fill:currentColor; pointer-events:none;"><path d="M13.45 8.17c-.44 2.61-2.72 4.58-5.45 4.58A5.5 5.5 0 0 1 2.5 7.25h1.01a4.5 4.5 0 0 0 4.49 4.5c2.17 0 3.98-1.55 4.42-3.6l-1.71.57-.32-.95 3.12-1.04.95 3.12-.95.32-.06-.99zM2.55 6.83C2.99 4.22 5.27 2.25 8 2.25a5.5 5.5 0 0 1 5.5 5.5h-1.01a4.5 4.5 0 0 0-4.49-4.5c-2.17 0-3.98 1.55-4.42 3.6l1.71-.57.32.95-3.12 1.04L1.54 5.15l.95-.32.06.99z"/></svg></button>
		<button id="temporalHelpBtn" type="button" title="Keyboard Shortcuts (?)" aria-label="Keyboard Shortcuts" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; background:transparent; border:0; color:var(--vscode-foreground, #f4f4f5); border-radius:4px; cursor:pointer;"><svg viewBox="0 0 16 16" aria-hidden="true" style="width:14px; height:14px; fill:currentColor; pointer-events:none;"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.2a5.8 5.8 0 1 1 0 11.6 5.8 5.8 0 0 1 0-11.6zm-.1 2.5a2.2 2.2 0 0 0-2.2 2.2.6.6 0 0 0 1.2 0 .99.99 0 1 1 1.69.7.6.6 0 0 0-.15.42v1a.6.6 0 0 0 1.2 0v-.66a2.2 2.2 0 0 0-.74-1.66 1 1 0 0 0-.1-.08A1 1 0 0 1 7.9 4.7zm.1 6.3a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z"/></svg></button>
	</div>
	<div id="temporalDiffBadges" style="display:flex; gap:4px; font-size:10.5px; margin-left:auto; flex-shrink:0; align-items:center;">
		<span id="badgeAdded" class="badge-added" title="Added nodes">+0</span>
		<span id="badgeRemoved" class="badge-removed" title="Removed nodes">-0</span>
		<span id="badgeModified" class="badge-modified" title="Modified nodes">~0</span>
		<span id="badgeRenamed" class="badge-renamed" title="Renamed nodes">⇄0</span>
		<span id="temporalPartialWarning" class="badge-warning" style="display:none;"></span>
		<span id="temporalCommitStatus" class="status-pill" style="display:inline-flex; align-items:center; gap:4px; font-size:10px; border-radius:10px; padding:2px 7px; font-weight:600;"></span>
		<button id="temporalRetryBtn" type="button" title="Retry loading target commit" aria-label="Retry" style="display:none; font-size:10px; font-weight:600; padding:2px 8px; border-radius:4px; border:1px solid var(--vscode-widget-border, #3C3C3C); background:var(--vscode-button-secondaryBackground, #3a3d41); color:var(--vscode-button-secondaryForeground, #ffffff); cursor:pointer;">Retry</button>
	</div>
</div>

<!-- Temporal Scrubber Bar -->
<div id="temporalScrubberBar">
	<div id="temporalTimelineStrip" style="display:none;" aria-label="Loaded commit history timeline"></div>
	<div class="row controls-row" style="display:flex; align-items:center; gap:8px; width:100%;">
		<div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
			<button id="temporalPrevBtn" title="Previous older commit (Left arrow)" aria-label="Previous commit"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3.5v9L4.5 8z"/></svg></button>
			<button id="temporalPlayBtn" title="Play timeline (Space)" aria-label="Play timeline"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5l9 5.5-9 5.5z"/></svg></button>
			<button id="temporalNextBtn" title="Next newer commit (Right arrow)" aria-label="Next commit"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 12.5v-9l6 4.5z"/></svg></button>
			<button id="temporalLoadMoreBtn" title="Load more historical commits" aria-label="Load more history" style="display:none;">+More</button>
		</div>
		<div style="display:flex; align-items:center; gap:6px; flex:1; min-width:0; overflow:hidden;">
			<span id="temporalCommitSha" style="font-family:monospace; font-weight:600; color:var(--vscode-textLink-foreground, #58a6ff); font-size:11.5px; flex-shrink:0;"></span>
			<span id="temporalCommitMessage" style="font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0;"></span>
			<span id="temporalCommitAuthor" style="font-size:10.5px; opacity:0.75; flex-shrink:0;"></span>
		</div>
		<button id="temporalToggleDetailsBtn" type="button" title="Toggle commit details & structural diff inspector" aria-label="Toggle Details" aria-expanded="false" aria-controls="temporalDetailsPanel" style="flex-shrink:0; margin-left:auto;">Details</button>
	</div>
	<div class="row track-row" style="display:flex; align-items:center; width:100%; padding-top:2px;">
		<input id="temporalScrubber" type="range" min="0" max="0" value="0" aria-label="Temporal commit history scrubber" style="width:100%; display:block;">
	</div>
</div>

<div id="legend"></div>
<div id="popup" role="dialog" aria-modal="false" aria-label="Node details">
	<div class="popup-header">
		<div class="popup-header-main">
			<div class="popup-badges">
				<span id="popupLayerBadge" class="layer-badge" style="display:none;"></span>
				<span id="popupChangeBadge" class="change-badge" style="display:none;"></span>
			</div>
			<h3 id="popupTitle"></h3>
			<div class="meta" id="popupMeta"></div>
		</div>
		<button id="popupClose" type="button" title="Close (Esc)" aria-label="Close details"><svg viewBox="0 0 16 16" aria-hidden="true" style="width:14px; height:14px; fill:currentColor; pointer-events:none;"><path d="M13.85 2.15l-.7-.7L8 6.59 2.85 1.45l-.7.7L7.29 7.3 1.45 13.15l.7.7L7.3 8.71l5.85 5.85.7-.7L8.71 8l5.14-5.85z"/></svg></button>
	</div>
	<div id="popupDetailsList" class="popup-details-list"></div>
	<div id="popupAiWrap" style="display:none;">
		<div class="label" style="font-size:9.5px; font-weight:600; color:var(--vscode-descriptionForeground, #a1a1aa); margin:4px 0 2px;">AI Description</div>
		<p id="popupAi" style="margin:0 0 6px; font-size:11px; line-height:1.4; color:var(--vscode-foreground, #f4f4f5);"></p>
	</div>
	<div class="actions">
		<button id="popupSourceDiff" type="button" class="primary" title="View Source Diff against base" aria-label="View Source Diff" style="display:none;">View Source Diff</button>
		<button id="popupHistoricalView" type="button" class="primary" title="View historical revision at this commit" aria-label="View at Commit" style="display:none;">View at Commit</button>
		<button class="primary" id="popupOpen" type="button" title="Open File" aria-label="Open File">Open File</button>
		<button id="popupSetBase" type="button" title="Set this commit as comparison base" aria-label="Set as Base" style="display:none;">Set as Base</button>
		<button id="popupReveal" type="button" title="Reveal in Explorer" aria-label="Reveal in Explorer">Reveal</button>
		<button id="popupMagnus" type="button" title="Attach to Agents" aria-label="Attach to Agents">Attach to Agents</button>
	</div>
</div>
<div id="toolbar" role="toolbar" aria-label="Graph Viewport Controls">
	<button id="zoomIn" type="button" title="Zoom in" aria-label="Zoom in"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 2a5.5 5.5 0 0 1 4.383 8.838l4.471 4.47-.707.707-4.47-4.47A5.5 5.5 0 1 1 7.5 2zm0 1a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM8 5v2h2v1H8v2H7V8H5V7h2V5h1z"/></svg></button>
	<button id="zoomOut" type="button" title="Zoom out" aria-label="Zoom out"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 2a5.5 5.5 0 0 1 4.383 8.838l4.471 4.47-.707.707-4.47-4.47A5.5 5.5 0 1 1 7.5 2zm0 1a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM5 7h5v1H5V7z"/></svg></button>
	<button id="fit" type="button" title="Fit View" aria-label="Fit View"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2L6.5 2 6.5 3 3.707 3 7.354 6.646 6.646 7.354 3 3.707 3 6.5 2 6.5z M14 14L9.5 14 9.5 13 12.293 13 8.646 9.354 9.354 8.646 13 12.293 13 9.5 14 9.5z"/></svg></button>
	<button id="centerLock" type="button" title="Keep graph centered" aria-label="Keep graph centered" aria-pressed="false"><svg class="icon-unpressed" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a6 6 0 0 1 6 6c0 2.3-1.5 4.05-3.15 5.07A11 11 0 0 1 8 13.44a11 11 0 0 1-2.85-1.37C3.5 11.05 2 9.3 2 7a6 6 0 0 1 6-6zm0 1a5 5 0 0 0-5 5c0 .34.03.66.1.96C3.53 9.86 5.63 10.94 8 12.4c2.37-1.46 4.47-2.54 4.9-4.44.07-.3.1-.62.1-.96a5 5 0 0 0-5-5zm0 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/></svg><svg class="icon-pressed" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a6 6 0 0 1 6 6c0 2.3-1.5 4.05-3.15 5.07A11 11 0 0 1 8 13.44a11 11 0 0 1-2.85-1.37C3.5 11.05 2 9.3 2 7a6 6 0 0 1 6-6zm0 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/></svg></button>
	<button id="reset" type="button" title="Reset View" aria-label="Reset View"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.45 8.17c-.44 2.61-2.72 4.58-5.45 4.58A5.5 5.5 0 0 1 2.5 7.25h1.01a4.5 4.5 0 0 0 4.49 4.5c2.17 0 3.98-1.55 4.42-3.6l-1.71.57-.32-.95 3.12-1.04.95 3.12-.95.32-.06-.99zM2.55 6.83C2.99 4.22 5.27 2.25 8 2.25a5.5 5.5 0 0 1 5.5 5.5h-1.01a4.5 4.5 0 0 0-4.49-4.5c-2.17 0-3.98 1.55-4.42 3.6l1.71-.57.32.95-3.12 1.04L1.54 5.15l.95-.32.06.99z"/></svg></button>
	<button id="graphHelpBtn" type="button" title="Keyboard Shortcuts (?)" aria-label="Keyboard Shortcuts"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.2a5.8 5.8 0 1 1 0 11.6 5.8 5.8 0 0 1 0-11.6zm-.1 2.5a2.2 2.2 0 0 0-2.2 2.2.6.6 0 0 0 1.2 0 .99.99 0 1 1 1.69.7.6.6 0 0 0-.15.42v1a.6.6 0 0 0 1.2 0v-.66a2.2 2.2 0 0 0-.74-1.66 1 1 0 0 0-.1-.08A1 1 0 0 1 7.9 4.7zm.1 6.3a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z"/></svg></button>
	<label id="idleToggleWrap"><input type="checkbox" id="idleToggle" aria-label="Auto-rotate when idle"> Idle</label>
</div>
<div id="status">Scanning…</div>
<script nonce="${nonce}">
// 1. VS Code API and Initial Constants
const vscode = acquireVsCodeApi();
const currentGeneration = Number('${generation}') || 0;
let initialGraphType = '${initialGraphType}' === 'temporal' ? 'temporal' : 'network';
let graphType = initialGraphType;

// Authoritative Network edge visual resolver, injected from
// graphs/src/view/network/networkEdgeVisual.ts (single source of truth; parity-tested).
const resolveNetworkEdgeVisual = ${serializeNetworkEdgeVisualSource()};

// Authoritative Network node visual / pick / fit / depth math (single source of truth).
const computeNetworkVisualRadius = ${serializeNetworkVisualRadiusSource()};
const computeNetworkPickRadius = ${serializeNetworkPickRadiusSource()};
const computeNetworkFitTransform = ${serializeNetworkFitTransformSource()};
const computeDepthAlpha = ${serializeNetworkDepthAlphaSource()};
const computeNetworkLabelWorldFontSize = ${serializeNetworkLabelWorldFontSizeSource()};

// Authoritative Temporal status, Focus+Context, and LOD resolvers, injected from
// graphs/src/temporal/view/ (single source of truth; parity-tested).
const computeTemporalUnifiedStatus = ${serializeTemporalUnifiedStatusSource()};
const computeTemporalFocusContext = ${serializeTemporalFocusContextSource()};
const computeTemporalVisualRadius = ${serializeTemporalVisualRadiusSource()};
const computeTemporalFitTransform = ${serializeTemporalFitTransformSource()};
const computeCommunityAggregateEdges = ${serializeTemporalCommunityAggregateEdgesSource()};
const computeEdgeLodStyle = ${serializeTemporalEdgeLodStyleSource()};
const computeAggregateEdgeRoute = ${serializeTemporalAggregateEdgeRouteSource()};
const computeVisibleLabels = ${serializeTemporalVisibleLabelsSource()};
${serializeTemporalLabelLayoutSource()};
const projectTemporalVisibleSet = ${serializeTemporalProjectionSource()};

// 2. Fast request dispatcher & pending map
const pending = new Map();
function request(type, payload, timeoutMs = 5000) {
	const requestId = Math.random().toString(36).slice(2);
	return new Promise(function (resolve, reject) {
		const timer = setTimeout(function () {
			if (pending.has(requestId)) {
				pending.delete(requestId);
				reject(new Error('Request timed out: ' + type));
			}
		}, timeoutMs);
		pending.set(requestId, function (val) {
			clearTimeout(timer);
			resolve(val);
		});
		vscode.postMessage({ requestId: requestId, type: type, payload: payload, generation: currentGeneration });
	});
}

// 3. Immediate Bootstrap Ready Handshake (fires before any other logic)
vscode.postMessage({ requestId: 'bootstrap', type: 'ready', payload: { generation: currentGeneration, graphType: initialGraphType }, generation: currentGeneration });

// 4. Core DOM Element References
const archSvg = document.getElementById('archSvg');
const netCanvas = document.getElementById('netCanvas');
const ctx = netCanvas ? netCanvas.getContext('2d', { alpha: true }) : null;
const status = document.getElementById('status');
const legend = document.getElementById('legend');
const empty = document.getElementById('empty');
const idleToggle = document.getElementById('idleToggle');
const idleToggleWrap = document.getElementById('idleToggleWrap');
const toolbar = document.getElementById('toolbar');
const temporalToolbar = document.getElementById('temporalToolbar');
const temporalBreadcrumbTarget = document.getElementById('temporalBreadcrumbTarget');
const temporalBreadcrumbBase = document.getElementById('temporalBreadcrumbBase');
const temporalScrubberBar = document.getElementById('temporalScrubberBar');
const temporalRepoWrap = document.getElementById('temporalRepoWrap');
const temporalRepoSelect = document.getElementById('temporalRepoSelect');
const temporalRefSelect = document.getElementById('temporalRefSelect');
const temporalCompareSelect = document.getElementById('temporalCompareSelect');
const temporalFollowHead = document.getElementById('temporalFollowHead');
const temporalFilterInput = document.getElementById('temporalFilterInput');
const temporalModeChangesBtn = document.getElementById('temporalModeChangesBtn');
const temporalModeStateBtn = document.getElementById('temporalModeStateBtn');
const temporalContextModeWrap = document.getElementById('temporalContextModeWrap');
const temporalContextFocusedBtn = document.getElementById('temporalContextFocusedBtn');
const temporalContextFullBtn = document.getElementById('temporalContextFullBtn');
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
const temporalToggleDetailsBtn = document.getElementById('temporalToggleDetailsBtn');
const temporalDetailsPanel = document.getElementById('temporalDetailsPanel');
const temporalDetailsClose = document.getElementById('temporalDetailsClose');
const temporalFitBtn = document.getElementById('temporalFitBtn');
const temporalCenterLockBtn = document.getElementById('temporalCenterLockBtn');
const temporalZoomInBtn = document.getElementById('temporalZoomInBtn');
const temporalZoomOutBtn = document.getElementById('temporalZoomOutBtn');
const temporalResetBtn = document.getElementById('temporalResetBtn');
const temporalHelpBtn = document.getElementById('temporalHelpBtn');
const graphHelpBtn = document.getElementById('graphHelpBtn');
const temporalRetryBtn = document.getElementById('temporalRetryBtn');
const badgeAdded = document.getElementById('badgeAdded');
const badgeRemoved = document.getElementById('badgeRemoved');
const badgeModified = document.getElementById('badgeModified');
const badgeRenamed = document.getElementById('badgeRenamed');

const popup = document.getElementById('popup');
const popupTitle = document.getElementById('popupTitle');
const popupMeta = document.getElementById('popupMeta');
const popupLayerBadge = document.getElementById('popupLayerBadge');
const popupChangeBadge = document.getElementById('popupChangeBadge');
const popupDetailsList = document.getElementById('popupDetailsList');
const popupAiWrap = document.getElementById('popupAiWrap');
const popupAi = document.getElementById('popupAi');
const popupOpen = document.getElementById('popupOpen');
const popupHistoricalView = document.getElementById('popupHistoricalView');
const popupSourceDiff = document.getElementById('popupSourceDiff');
const popupSetBase = document.getElementById('popupSetBase');
const popupReveal = document.getElementById('popupReveal');
const popupMagnus = document.getElementById('popupMagnus');
const noChangesCard = document.getElementById('noChangesCard');
const noChangesViewSource = document.getElementById('noChangesViewSource');

let popupNode = null;
let pointerDownNode = null;
let pointerDownNodeId = null;
let nodeWasSelectedAtPointerDown = false;
let pointerDownX = 0, pointerDownY = 0;
let interactionState = 'idle';
let dragThreshold = 4;
const NODE_SCALE = 1;

const FOCAL = 850;
const IDLE_YAW = 0.08;
const IDLE_RESUME_MS = 1400;
const ARCH_W = 28, ARCH_H = 28;
const ARCH_MIN_HIT_PX = 10;
const ENTRY = '#e8b84a';
const FILE_COLORS = {
	typescript:'#3178c6', javascript:'#f1e05a', css:'#a371f7', html:'#e34c26',
	markdown:'#519aba', image:'#c678dd', config:'#6b7280', other:'#71717a'
};

const ARCHITECTURE_LAYER_COLORS = {
	'entry': '#f59e0b',
	'frontend': '#818cf8',
	'ui': '#a78bfa',
	'components': '#c084fc',
	'api': '#38bdf8',
	'auth': '#f472b6',
	'services': '#34d399',
	'backend': '#2dd4bf',
	'database': '#fb923c',
	'utils': '#71717a',
	'config': '#52525b',
	'tests': '#52525b',
	'other': '#6366f1'
};

function getArchitectureLayerColor(layer) {
	if (!layer) return '#6366f1';
	return ARCHITECTURE_LAYER_COLORS[layer.toLowerCase()] || '#6366f1';
}

const textWidthCache = new Map();
function measureTextWidth(text, font) {
	const key = font + '::' + text;
	let w = textWidthCache.get(key);
	if (w === undefined) {
		ctx.font = font;
		w = Math.ceil(ctx.measureText(text).width);
		if (textWidthCache.size > 2000) textWidthCache.clear();
		textWidthCache.set(key, w);
	}
	return w;
}

let transform = { x: 0, y: 0, k: 1 };
let rotation = { yaw: 0.55, pitch: 0.28 };
let snapshot = null;
let diagnostics = null;
let selectedNodeId = null;
let expandedTemporalGuideId = null;
let hoveredNodeId = null;
let settings = {
	showLegend: true,
	reduceMotion: false,
	networkIdleAutoRotate: false,
	networkDragDirection: 'natural',
	maxRenderedEdges: 420,
	maxRenderedNodes: 280,
	quality: 'auto',
	zoomSensitivity: 1.0,
	panSensitivity: 1.0,
	keepGraphCentered: false,
	networkEdgeOpacity: 0.55,
};
const centerLockBtn = document.getElementById('centerLock');
let keepGraphCentered = false;
let activeCameraAnim = null;

// Graph adjacency index: consumed by the highlight path in drawNetworkFrame.
// (A former incident-edges map and static edge descriptor cache were removed:
// they were built on every snapshot but never read by any render path.)
let nodeNeighborsMap = new Map();

let dragging = false, panning = false, rotating = false, draggingNode = false;
let lastX = 0, lastY = 0, moved = false;
let activePointerId = null, activePointerHost = null;
let layoutKey = '';
let base3d = Object.create(null);
let centroid = { x: 0, y: 0 };
let projected = Object.create(null);
let idlePaused = true;
let idleResumeTimer = null;
let lastRafTs = 0;
let dirty = true;
let rafScheduled = false;
let dpr = Math.min(2, window.devicePixelRatio || 1);

// Pure Viewport Mathematics & Helpers
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3.5;
const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

function clamp(val, min, max) {
	return Math.max(min, Math.min(max, val));
}

function uiFontFamily() {
	return getComputedThemeColors().fontFamily;
}
function canvasFont(style, sizePx) {
	return (style ? style + ' ' : '') + sizePx + 'px ' + uiFontFamily();
}
function recordProjectedUtilization(metrics, screenPoints, viewportW, viewportH) {
	metrics.viewportWidth = viewportW;
	metrics.viewportHeight = viewportH;
	metrics.labelCount = metrics.labelsDrawn;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let i = 0; i < screenPoints.length; i++) {
		const p = screenPoints[i];
		if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	if (!Number.isFinite(minX) || viewportW <= 0 || viewportH <= 0) {
		metrics.projectedBounds = null;
		metrics.screenUtilization = 0;
		return;
	}
	const width = Math.max(0, maxX - minX);
	const height = Math.max(0, maxY - minY);
	metrics.projectedBounds = { minX: minX, minY: minY, maxX: maxX, maxY: maxY, width: width, height: height };
	metrics.screenUtilization = (width * height) / (viewportW * viewportH);
}

function normalizeWheelZoomDelta(options) {
	const deltaY = options.deltaY || 0;
	const deltaMode = options.deltaMode !== undefined ? options.deltaMode : DOM_DELTA_PIXEL;
	const ctrlKey = Boolean(options.ctrlKey);
	const sensitivity = (typeof options.sensitivity === 'number' && Number.isFinite(options.sensitivity) && options.sensitivity > 0)
		? options.sensitivity
		: 1.0;

	if (deltaY === 0) return 0;

	let pixelDelta = deltaY;
	if (deltaMode === DOM_DELTA_LINE) {
		pixelDelta = deltaY * 24;
	} else if (deltaMode === DOM_DELTA_PAGE) {
		pixelDelta = deltaY * 400;
	}

	if (ctrlKey) {
		pixelDelta *= 2.0;
	}

	const clampedDelta = clamp(pixelDelta, -320, 320);
	return clampedDelta * sensitivity;
}

function computeContinuousZoomFactor(normalizedDelta) {
	if (normalizedDelta === 0) return 1.0;
	return Math.pow(2, -normalizedDelta * 0.0025);
}

function applyZoomAroundCursor(t, factor, cursorX, cursorY, minZoom, maxZoom) {
	const minZ = minZoom !== undefined ? minZoom : MIN_ZOOM;
	const maxZ = maxZoom !== undefined ? maxZoom : MAX_ZOOM;
	const prevK = t.k;
	const targetK = clamp(prevK * factor, minZ, maxZ);
	if (targetK === prevK) return { x: t.x, y: t.y, k: t.k };

	const ratio = targetK / prevK;
	const targetX = cursorX - (cursorX - t.x) * ratio;
	const targetY = cursorY - (cursorY - t.y) * ratio;

	return { x: targetX, y: targetY, k: targetK };
}

function applyZoomAroundCenter(t, factor, width, height, minZoom, maxZoom, insets) {
	const top = (insets && insets.top) || 0;
	const bottom = (insets && insets.bottom) || 0;
	const left = (insets && insets.left) || 0;
	const right = (insets && insets.right) || 0;

	const usableWidth = Math.max(1, width - left - right);
	const usableHeight = Math.max(1, height - top - bottom);
	const centerX = left + usableWidth / 2;
	const centerY = top + usableHeight / 2;

	return applyZoomAroundCursor(t, factor, centerX, centerY, minZoom, maxZoom);
}

function computeGraphBounds(nodes) {
	if (!nodes || nodes.length === 0) return null;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		const r = (typeof n.radius === 'number' && Number.isFinite(n.radius)) ? n.radius : 10;
		minX = Math.min(minX, n.x - r);
		minY = Math.min(minY, n.y - r);
		maxX = Math.max(maxX, n.x + r);
		maxY = Math.max(maxY, n.y + r);
	}
	if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
		return null;
	}
	return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

function computeCenterLockedTransform(bounds, width, height, currentK, insets) {
	if (!bounds) return { x: width / 2, y: height / 2, k: currentK };
	const top = (insets && insets.top) || 0;
	const bottom = (insets && insets.bottom) || 0;
	const left = (insets && insets.left) || 0;
	const right = (insets && insets.right) || 0;

	const usableWidth = Math.max(1, width - left - right);
	const usableHeight = Math.max(1, height - top - bottom);
	const viewportCenterX = left + usableWidth / 2;
	const viewportCenterY = top + usableHeight / 2;

	const graphCenterX = (bounds.minX + bounds.maxX) / 2;
	const graphCenterY = (bounds.minY + bounds.maxY) / 2;

	const targetX = viewportCenterX - graphCenterX * currentK;
	const targetY = viewportCenterY - graphCenterY * currentK;

	return { x: targetX, y: targetY, k: currentK };
}

function isCenterDeadZone(current, target, thresholdPx) {
	const thresh = thresholdPx !== undefined ? thresholdPx : 0.5;
	const dx = Math.abs(current.x - target.x);
	const dy = Math.abs(current.y - target.y);
	return dx < thresh && dy < thresh;
}

function easeOutCubic(t) {
	const clamped = clamp(t, 0, 1);
	return 1 - Math.pow(1 - clamped, 3);
}

function interpolateViewport(from, to, t) {
	const ease = easeOutCubic(t);
	return {
		x: from.x + (to.x - from.x) * ease,
		y: from.y + (to.y - from.y) * ease,
		k: from.k + (to.k - from.k) * ease,
	};
}

function getUsableInsets() {
	let top = 12, bottom = 56, left = 12, right = 12;
	if (isTemporal()) {
		top = 48;
		bottom = 68;
		// Commit-details inspector occupies the right side when visible
		// (~340px panel + 12px offsets); Fit View / Center Lock / zoom-around-center
		// must not center content underneath it.
		if (temporalDetailsPanel && temporalDetailsPanel.style.display !== 'none' && temporalDetailsPanel.offsetWidth > 0) {
			right += temporalDetailsPanel.offsetWidth + 24;
			bottom = Math.max(bottom, 84);
		}
	}
	// Defensive clamps: never let insets consume the whole (possibly tiny) viewport.
	const w = netCanvas ? (netCanvas.clientWidth || 800) : 800;
	const h = netCanvas ? (netCanvas.clientHeight || 600) : 600;
	return {
		top: Math.min(top, Math.floor(h * 0.4)),
		bottom: Math.min(bottom, Math.floor(h * 0.55)),
		left: Math.min(left, Math.floor(w * 0.4)),
		right: Math.min(right, Math.floor(w * 0.6)),
	};
}

function syncCenterLockUI() {
	if (centerLockBtn) {
		centerLockBtn.setAttribute('aria-pressed', keepGraphCentered ? 'true' : 'false');
		centerLockBtn.classList.toggle('active', keepGraphCentered);
		centerLockBtn.title = keepGraphCentered ? 'Keep graph centered (Active)' : 'Keep graph centered';
	}
	if (temporalCenterLockBtn) {
		temporalCenterLockBtn.setAttribute('aria-pressed', keepGraphCentered ? 'true' : 'false');
		temporalCenterLockBtn.classList.toggle('active', keepGraphCentered);
		temporalCenterLockBtn.title = keepGraphCentered ? 'Keep graph centered during timeline changes (Active)' : 'Keep graph centered during timeline changes (C)';
	}
}

// Reusable scratch list so per-frame center-lock recomputation does not allocate.
let _centerLockScratch = [];

function collectCenterLockBounds() {
	_centerLockScratch.length = 0;
	if (isTemporal()) {
		if (!currentTemporalRenderNodes || currentTemporalRenderNodes.size === 0) return null;
		currentTemporalRenderNodes.forEach(function (n) {
			_centerLockScratch.push({ x: n.x || 0, y: n.y || 0, radius: 10 });
		});
	} else if (isNetwork() && snapshot) {
		const nodes = snapshot.nodes || [];
		for (let i = 0; i < nodes.length; i++) {
			const p = projected[nodes[i].id];
			if (p) _centerLockScratch.push({ x: p.x, y: p.y, radius: 8 });
		}
	} else {
		return null;
	}
	return computeGraphBounds(_centerLockScratch);
}

function applyCenterLock(immediate) {
	if (!keepGraphCentered || !netCanvas) return;
	// Never fight an in-flight programmatic camera animation; rafLoop re-applies
	// lock after the animation completes.
	if (activeCameraAnim && !immediate) return;
	const w = netCanvas.clientWidth || 800;
	const h = netCanvas.clientHeight || 600;

	const bounds = collectCenterLockBounds();
	if (!bounds) return;
	const target = computeCenterLockedTransform(bounds, w, h, transform.k, getUsableInsets());
	// Sub-half-pixel residual is invisible at any DPR and re-locking every frame
	// against float drift would keep a repaint loop alive for nothing.
	if (!isCenterDeadZone(transform, target, 0.5)) {
		transform.x = target.x;
		transform.y = target.y;
		dirty = true;
		kickRaf();
	}
}

function cancelCameraAnimation() {
	activeCameraAnim = null;
}

function animateViewportTo(targetTransform, durationMs) {
	const dur = durationMs !== undefined ? durationMs : 240;
	if (settings.reduceMotion || dur <= 0) {
		transform = { x: targetTransform.x, y: targetTransform.y, k: targetTransform.k };
		dirty = true;
		kickRaf();
		return;
	}
	activeCameraAnim = {
		from: { x: transform.x, y: transform.y, k: transform.k },
		to: { x: targetTransform.x, y: targetTransform.y, k: targetTransform.k },
		startTs: performance.now(),
		duration: dur
	};
	dirty = true;
	kickRaf();
}

function rebuildAdjacency() {
	nodeNeighborsMap.clear();

	if (!snapshot) return;
	const nodes = snapshot.nodes || [];
	const edges = snapshot.edges || [];
	for (let i = 0; i < nodes.length; i++) {
		nodeNeighborsMap.set(nodes[i].id, new Set());
	}

	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		if (!nodeNeighborsMap.has(e.source)) nodeNeighborsMap.set(e.source, new Set());
		if (!nodeNeighborsMap.has(e.target)) nodeNeighborsMap.set(e.target, new Set());
		nodeNeighborsMap.get(e.source).add(e.target);
		nodeNeighborsMap.get(e.target).add(e.source);
	}
}

// Temporal State & 2D Transition Engine
let temporalState = null;
let temporalDiff = null;
let hasFittedTemporalView = false;
let userAdjustedViewport = false;
let previousTemporalRenderNodes = new Map();
let currentTemporalRenderNodes = new Map();
let animStartTime = 0;
let animDuration = 220;
let isAnimatingTemporal = false;
let isPlayingHistory = false;
let playIntervalTimer = null;
let displayMode = 'changes';
let temporalContextFilterMode = 'focused';

function isNetwork() { return graphType === 'network'; }
function isTemporal() { return graphType === 'temporal'; }

function hasRenderableTemporalNodes(diff) {
	if (!diff || !diff.nodes || !diff.nodes.length) {
		return false;
	}
	for (let i = 0; i < diff.nodes.length; i++) {
		const node = diff.nodes[i];
		if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
			return true;
		}
	}
	return false;
}

// Theme tokens cached between invalidations: getComputedStyle on every frame is a
// measurable hot-path cost (measured in Phase 3.10 profiling). Invalidate via
// invalidateThemeColors() when a message may follow a theme change.
let _themeColors = null;
function getComputedThemeColors() {
	if (_themeColors) return _themeColors;
	const s = getComputedStyle(document.documentElement);
	_themeColors = {
		bg: s.getPropertyValue('--vscode-editor-background').trim() || '#1B1C1E',
		fg: s.getPropertyValue('--vscode-foreground').trim() || '#f4f4f5',
		border: s.getPropertyValue('--vscode-widget-border').trim() || '#3C3C3C',
		added: s.getPropertyValue('--vscode-gitDecoration-addedResourceForeground').trim() || '#3fb950',
		deleted: s.getPropertyValue('--vscode-gitDecoration-deletedResourceForeground').trim() || '#f85149',
		modified: s.getPropertyValue('--vscode-gitDecoration-modifiedResourceForeground').trim() || '#d29922',
		renamed: s.getPropertyValue('--vscode-gitDecoration-renamedResourceForeground').trim() || '#58a6ff',
		accent: s.getPropertyValue('--vscode-button-background').trim() || '#2dd4bf',
		fontFamily: (document.body && window.getComputedStyle)
			? (window.getComputedStyle(document.body).fontFamily || 'sans-serif')
			: 'sans-serif',
		isHighContrast: document.body.classList.contains('vscode-high-contrast') || s.getPropertyValue('--vscode-contrastBorder').trim() !== '',
	};
	return _themeColors;
}
function invalidateThemeColors() {
	_themeColors = null;
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
		&& !draggingNode
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

function mapPointerDeltaToNodeWorld(dx, dy, depthScale) {
	const direction = settings.networkDragDirection === 'inverted' ? -1 : 1;
	const k = Math.max(0.001, transform.k);
	const ds = Math.max(0.001, Number(depthScale) || 1);
	const dProjX = (dx / k) * direction;
	const dProjY = (dy / k) * direction;
	const dx2 = dProjX / ds;
	const dy1 = dProjY / ds;
	const cy = Math.cos(rotation.yaw), sy = Math.sin(rotation.yaw);
	const cp = Math.cos(rotation.pitch), sp = Math.sin(rotation.pitch);
	const worldDx = dx2 * cy;
	const dz1 = dx2 * sy;
	return {
		x: worldDx,
		y: dy1 * cp + dz1 * sp,
		z: -dy1 * sp + dz1 * cp
	};
}

function wrapRotationAngle(angle) {
	const fullTurn = Math.PI * 2;
	return ((angle + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

function fileType(path) {
	if (!path) return { id:'other', name:'Other', color:FILE_COLORS.other };
	const normalized = String(path).replace(/\\\\/g, '/');
	const base = normalized.split('/').pop() || path;
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

function networkNodeScale() {
	return (typeof settings.nodeScale === 'number' && Number.isFinite(settings.nodeScale))
		? Math.max(0.5, Math.min(2.0, settings.nodeScale))
		: 1.0;
}

function networkVisualRadius(node, depthScale, entryId, isSelected, isHovered) {
	return computeNetworkVisualRadius(node, depthScale, {
		entryNodeId: entryId,
		isSelected: isSelected,
		isHovered: isHovered,
		nodeScale: networkNodeScale(),
		zoom: transform.k,
	});
}

function networkPickRadius(node, depthScale, entryId) {
	return computeNetworkPickRadius(node, depthScale, {
		entryNodeId: entryId,
		nodeScale: networkNodeScale(),
		zoom: transform.k,
	});
}

// Cached Focus+Context derivation: delegates to authoritative computeTemporalFocusContext,
// recomputed only when the diff, display mode or context filter actually changes.
let _temporalVisibleCache = null;
let _temporalVisibleCacheKey = '';

function computeTemporalVisibleElements(diff, mode, contextMode) {
	const cacheKey = (diff ? 1 : 0) + '|' + (mode || 'changes') + '|' + (contextMode || 'focused');
	if (_temporalVisibleCache && _temporalVisibleCacheKey === cacheKey && _temporalVisibleCache._diff === diff) {
		return _temporalVisibleCache;
	}
	_temporalVisibleCache = computeTemporalFocusContext(diff, mode || 'changes', contextMode || 'focused');
	_temporalVisibleCache._diff = diff;
	_temporalVisibleCacheKey = cacheKey;
	return _temporalVisibleCache;
}

function projectPoint(x, y, z, yaw, pitch) {
	const cp = Math.cos(pitch), sp = Math.sin(pitch);
	const y1 = y * cp - z * sp;
	const z1 = y * sp + z * cp;

	const cy = Math.cos(yaw), sy = Math.sin(yaw);
	const x2 = x * cy + z1 * sy;
	const z2 = -x * sy + z1 * cy;

	const distance = Math.max(FOCAL * 0.25, FOCAL + z2);
	const depthScale = FOCAL / distance;
	return { x: x2 * depthScale, y: y1 * depthScale, z: z2, depthScale: depthScale };
}

function resizeCanvas() {
	if (!netCanvas || !ctx) return;
	const w = netCanvas.clientWidth || 800;
	const h = netCanvas.clientHeight || 600;
	if (netCanvas.width !== Math.floor(w * dpr) || netCanvas.height !== Math.floor(h * dpr)) {
		netCanvas.width = Math.floor(w * dpr);
		netCanvas.height = Math.floor(h * dpr);
		if (typeof ctx.resetTransform === 'function') {
			ctx.resetTransform();
		}
		ctx.scale(dpr, dpr);
		dirty = true;
	}
}

function kickRaf() {
	if (rafScheduled) return;
	if (typeof document !== 'undefined' && document.hidden) return;
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
	if (!s || !s.nodes) return false;
	const key = [s.scannedAt || '', s.layoutMode || '', s.networkLayoutMode || '', s.graphType || '', (s.nodes || []).length, (s.edges || []).length, s.projectUri || ''].join('|');
	if (s.scannedAt && key === layoutKey && Object.keys(base3d).length) return false;
	layoutKey = key;
	base3d = Object.create(null);
	const nodes = s.nodes || [];
	const p3 = s.positions3d || null;

	let validCount = 0;
	let sx = 0, sy = 0;

	// 1. Production contract: s.positions3d
	if (p3 && typeof p3 === 'object') {
		for (let i = 0; i < nodes.length; i++) {
			const n = nodes[i];
			const p = p3[n.id];
			if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
			const pz = Number.isFinite(p.z) ? p.z : 0;
			base3d[n.id] = { x: p.x, y: p.y, z: pz };
			sx += p.x; sy += p.y;
			validCount++;
		}
	}

	// 2. Fallback to node.x, node.y, node.z if present
	if (validCount === 0) {
		for (let i = 0; i < nodes.length; i++) {
			const n = nodes[i];
			if (n && Number.isFinite(n.x) && Number.isFinite(n.y)) {
				const nz = Number.isFinite(n.z) ? n.z : 0;
				base3d[n.id] = { x: n.x, y: n.y, z: nz };
				sx += n.x; sy += n.y;
				validCount++;
			}
		}
	}

	// 3. Fallback to s.positions
	if (validCount === 0 && s.positions && typeof s.positions === 'object') {
		for (let i = 0; i < nodes.length; i++) {
			const n = nodes[i];
			const p = s.positions[n.id];
			if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
			base3d[n.id] = { x: p.x, y: p.y, z: 0 };
			sx += p.x; sy += p.y;
			validCount++;
		}
	}

	centroid = validCount > 1 ? { x: sx / validCount, y: sy / validCount } : { x: 0, y: 0 };

	return validCount > 0;
}

function projectAll() {
	if (!snapshot || !isNetwork()) return;
	const nodes = snapshot.nodes || [];
	projected = Object.create(null);
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const p = base3d[node.id];
		if (!p) continue;
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


function getVisualNodePosition(node, ease) {
	if (!node) return { x: 0, y: 0 };
	const targetX = node.x || 0;
	const targetY = node.y || 0;

	if (!isAnimatingTemporal) return { x: targetX, y: targetY };
	const prev = previousTemporalRenderNodes.get(node.entityId);
	if (prev) {
		const prevX = prev.x || 0;
		const prevY = prev.y || 0;
		return {
			x: prevX + (targetX - prevX) * ease,
			y: prevY + (targetY - prevY) * ease
		};
	}
	return { x: targetX, y: targetY };
}

function fitView(animate) {
	if (!netCanvas) return;
	const shouldAnimate = animate === true && !settings.reduceMotion;
	const animMs = Math.max(0, settings.layoutAnimationDuration !== undefined ? Number(settings.layoutAnimationDuration) : 320);
	const insets = getUsableInsets();
	const vw = netCanvas.clientWidth || 800;
	const vh = netCanvas.clientHeight || 600;
	const usableW = Math.max(1, vw - insets.left - insets.right);
	const usableH = Math.max(1, vh - insets.top - insets.bottom);
	const centerX = insets.left + usableW / 2;
	const centerY = insets.top + usableH / 2;

	if (isTemporal()) {
		if (!temporalDiff || !temporalDiff.nodes || !temporalDiff.nodes.length) return;
		const fc = computeTemporalVisibleElements(temporalDiff, displayMode, temporalContextFilterMode);
		const visibleNodes = (fc.visibleNodes || fc.nodes || []).filter(function (node) {
			return Number.isFinite(node.x) && Number.isFinite(node.y);
		});
		const largeOverview = displayMode === 'state' && visibleNodes.length > 400 && !expandedTemporalGuideId;
		const projection = projectTemporalVisibleSet(visibleNodes, temporalDiff.guides, {
			zoom: largeOverview ? 0.25 : (transform.k || 0.25),
			displayMode: displayMode,
			selectedEntityId: selectedNodeId,
			hoveredEntityId: hoveredNodeId,
			expandedGuideId: expandedTemporalGuideId,
			currentFileEntityId: temporalState && temporalState.currentFileEntityId,
		});
		const targetNodes = [];
		for (let i = 0; i < projection.items.length; i++) {
			const item = projection.items[i];
			if (item.kind === 'leaf') {
				targetNodes.push(item.node);
			} else {
				targetNodes.push({ entityId: item.entityId, x: item.x, y: item.y, changeKind: item.changedCount ? 'modified' : 'unchanged' });
			}
		}
		if (!targetNodes.length) return;
		const isFocusMode = (displayMode === 'changes' || displayMode === 'focus');
		// Fit the full architecture extent at overview, not the reduced glyph set.
		// Fitting only aggregates zooms in past the overview threshold and draws every leaf.
		const fitNodes = largeOverview ? visibleNodes : targetNodes;
		const targetTransform = computeTemporalFitTransform(fitNodes, vw, vh, {
			padding: isFocusMode ? 40 : 56,
			insets: insets,
			minZoom: MIN_ZOOM,
			maxZoom: largeOverview ? 0.48 : (isFocusMode && targetNodes.length <= 4 ? 3.2 : 2.4),
		});
		if (shouldAnimate && animMs > 0) {
			animateViewportTo(targetTransform, animMs);
		} else {
			transform = targetTransform;
			dirty = true;
			kickRaf();
		}
		return;
	}

	if (!snapshot || !(snapshot.nodes || []).length) return;
	projectAll();
	const nodes = snapshot.nodes;
	const entryId = snapshot.entryNodeId;
	const projectedMap = {};
	for (let i = 0; i < nodes.length; i++) {
		const p = screenPos(nodes[i].id);
		if (p) projectedMap[nodes[i].id] = { x: p.x, y: p.y, depthScale: p.depthScale || 1 };
	}
	const targetTransform = computeNetworkFitTransform(nodes, projectedMap, vw, vh, {
		padding: 48,
		initialZoom: settings.initialZoom || 1,
		nodeScale: networkNodeScale(),
		entryNodeId: entryId,
		insets: insets,
		minZoom: MIN_ZOOM,
		maxZoom: nodes.length <= 10 ? 3.2 : 2.4,
	});
	if (shouldAnimate && animMs > 0) {
		animateViewportTo(targetTransform, animMs);
	} else {
		transform = targetTransform;
		dirty = true;
		kickRaf();
	}
}

function updateLegend(s, network) {
	if (!legend) return;
	if (isTemporal()) {
		if (settings.showLegend === false) {
			legend.style.display = 'none';
			return;
		}
		let html = '<div class="header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid var(--vscode-widget-border, #3c3c3c); padding-bottom:4px;">';
		html += '<span class="title" style="margin:0; font-weight:700;">Temporal Legend</span>';
		html += '<button id="legendCloseBtn" type="button" title="Close legend" aria-label="Close legend" style="border:0; background:transparent; color:var(--vscode-foreground, #ccc); cursor:pointer; width:22px; height:22px; display:flex; align-items:center; justify-content:center;"><svg viewBox="0 0 16 16" aria-hidden="true" style="width:14px; height:14px; fill:currentColor; pointer-events:none;"><path d="M13.85 2.15l-.7-.7L8 6.59 2.85 1.45l-.7.7L7.29 7.3 1.45 13.15l.7.7L7.3 8.71l5.85 5.85.7-.7L8.71 8l5.14-5.85z"/></svg></button></div>';
		html += '<div class="title spaced" style="margin-top:4px; font-weight:700; text-transform:uppercase; font-size:10px; opacity:0.75;">Git Changes</div>';
		html += '<div class="row"><span class="swatch circle" style="background:var(--vscode-gitDecoration-addedResourceForeground, #3fb950)"></span>Added (+)</div>';
		html += '<div class="row"><span class="swatch circle" style="background:var(--vscode-gitDecoration-deletedResourceForeground, #f85149); border:1px dashed #f85149;"></span>Removed (-)</div>';
		html += '<div class="row"><span class="swatch circle" style="background:var(--vscode-gitDecoration-modifiedResourceForeground, #d29922)"></span>Modified (~)</div>';
		html += '<div class="row"><span class="swatch circle" style="background:var(--vscode-gitDecoration-renamedResourceForeground, #58a6ff)"></span>Renamed (⇄)</div>';
		html += '<div class="row"><span class="swatch circle" style="background:var(--vscode-descriptionForeground, #8b949e)"></span>Unchanged (•)</div>';
		html += '<div class="title spaced" style="margin-top:8px; font-weight:700; text-transform:uppercase; font-size:10px; opacity:0.75;">Architecture Regions</div>';
		html += '<div class="row"><span class="swatch circle" style="background:#f59e0b"></span>Entry Root</div>';
		html += '<div class="row"><span class="swatch circle" style="background:#818cf8"></span>Frontend / UI</div>';
		html += '<div class="row"><span class="swatch circle" style="background:#38bdf8"></span>API / Backend</div>';
		html += '<div class="row"><span class="swatch circle" style="background:#34d399"></span>Services / Logic</div>';
		html += '<div class="row"><span class="swatch circle" style="background:#fb923c"></span>Database / Data</div>';
		html += '<div class="row"><span class="swatch circle" style="background:#71717a"></span>Utils / Config</div>';
		legend.innerHTML = html;
		legend.style.display = 'block';
		legend.style.padding = '8px 12px';
		legend.style.minWidth = '140px';
		legend.style.maxWidth = '200px';
		legend.style.fontSize = '10px';
		legend.style.bottom = '80px';
		const closeBtn = document.getElementById('legendCloseBtn');
		if (closeBtn) closeBtn.onclick = function() { legend.style.display = 'none'; };
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
	const compact = (s.nodes || []).length <= 10;
	legend.style.display = 'block';
	legend.style.padding = compact ? '6px 8px' : '10px 12px';
	legend.style.minWidth = compact ? '108px' : '140px';
	legend.style.maxWidth = compact ? '160px' : '220px';
	legend.style.fontSize = compact ? '10px' : '11px';
	legend.style.bottom = compact ? '16px' : '100px';
}

function updateTemporalUI(state, diff) {
	if (!state) return;
	if (temporalToolbar) temporalToolbar.style.display = 'flex';
	if (temporalScrubberBar) temporalScrubberBar.style.display = 'flex';
	if (toolbar) toolbar.style.display = 'none';
	if (status) status.style.display = 'none';

	// Safe Multi-Repository Selector population
	if (temporalRepoSelect && temporalRepoWrap) {
		if (state.availableRepositories && state.availableRepositories.length > 1) {
			temporalRepoWrap.style.display = 'flex';
			temporalRepoSelect.innerHTML = '';
			for (let i = 0; i < state.availableRepositories.length; i++) {
				const r = state.availableRepositories[i];
				const opt = document.createElement('option');
				opt.value = r.rootUri;
				opt.textContent = r.label;
				if (r.rootUri === state.activeRepositoryRoot) opt.selected = true;
				temporalRepoSelect.appendChild(opt);
			}
		} else {
			temporalRepoWrap.style.display = 'none';
		}
	}

	// Safe DOM Ref Selector population
	if (temporalRefSelect) {
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
	}

	// Safe Arbitrary Compare Base Selector
	if (temporalCompareSelect) {
		while (temporalCompareSelect.firstChild) temporalCompareSelect.removeChild(temporalCompareSelect.firstChild);
		const timeline = state.pagedTimeline || [];
		const curCommit = state.selectedCommitSummary || timeline.find(c => c.sha === state.selectedCommitSha);
		const curBase = state.compareBaseSha || '';

		const p1Opt = document.createElement('option');
		p1Opt.value = curCommit?.parents?.[0] || '';
		p1Opt.textContent = curCommit?.parents?.[0] ? 'First Parent (' + curCommit.parents[0].slice(0, 7) + ')' : 'Initial Commit (No Parent)';
		if (state.comparisonMode === 'first-parent') p1Opt.selected = true;
		temporalCompareSelect.appendChild(p1Opt);

		if (curCommit?.parents && curCommit.parents.length > 1) {
			const p2Opt = document.createElement('option');
			p2Opt.value = curCommit.parents[1];
			p2Opt.textContent = 'Parent 2 (' + curCommit.parents[1].slice(0, 7) + ')';
			if (state.comparisonMode === 'explicit-parent') p2Opt.selected = true;
			temporalCompareSelect.appendChild(p2Opt);
		}

		if (state.comparisonMode === 'pinned' && curBase) {
			const customOpt = document.createElement('option');
			customOpt.value = curBase;
			customOpt.textContent = 'Pinned · ' + curBase.slice(0, 7);
			customOpt.selected = true;
			temporalCompareSelect.appendChild(customOpt);

			const clearOpt = document.createElement('option');
			clearOpt.value = '__clear_custom__';
			clearOpt.textContent = '↺ Reset to First Parent';
			temporalCompareSelect.appendChild(clearOpt);
		}

		const promptOpt = document.createElement('option');
		promptOpt.value = '__prompt_custom__';
		promptOpt.textContent = 'Set comparison base…';
		temporalCompareSelect.appendChild(promptOpt);
	}

	// Display Mode Buttons & Context Filter Toggle
	const previousDisplayMode = displayMode;
	displayMode = state.displayMode || displayMode;
	if (typeof state.displayMode === 'string' && previousDisplayMode !== displayMode && temporalDiff && temporalDiff.nodes && temporalDiff.nodes.length) {
		userAdjustedViewport = false;
		if (keepGraphCentered) {
			applyCenterLock(true);
		} else {
			fitView(!settings.reduceMotion);
		}
	}
	if (temporalModeChangesBtn && temporalModeStateBtn) {
		if (displayMode === 'changes' || displayMode === 'focus') {
			temporalModeChangesBtn.classList.add('active');
			temporalModeStateBtn.classList.remove('active');
			if (temporalContextModeWrap) temporalContextModeWrap.style.display = 'none';
		} else {
			temporalModeChangesBtn.classList.remove('active');
			temporalModeStateBtn.classList.add('active');
			if (temporalContextModeWrap) temporalContextModeWrap.style.display = 'none';
		}
	}

	if (temporalContextFocusedBtn && temporalContextFullBtn) {
		if (temporalContextFilterMode === 'focused') {
			temporalContextFocusedBtn.classList.add('active');
			temporalContextFullBtn.classList.remove('active');
		} else {
			temporalContextFocusedBtn.classList.remove('active');
			temporalContextFullBtn.classList.add('active');
		}
	}

	// Follow HEAD
	if (temporalFollowHead) {
		temporalFollowHead.checked = !!state.followHead;
	}

	// Scrubber slider & Timeline Strip
	const timeline = state.pagedTimeline || [];
	const total = state.loadedCommitCount || timeline.length;
	if (temporalScrubber) {
		temporalScrubber.max = String(Math.max(0, total - 1));
	}
	const currentIdx = typeof state.selectedCommitIndex === 'number'
		? state.selectedCommitIndex
		: timeline.findIndex(c => c.sha === state.selectedCommitSha);
	const curCommit = state.selectedCommitSummary || (currentIdx >= 0 ? timeline[currentIdx] : undefined);

	// Top Breadcrumb Update
	if (temporalBreadcrumbTarget) {
		const targetShort = curCommit ? (curCommit.shortSha || curCommit.sha.slice(0, 7)) : (state.selectedCommitSha ? state.selectedCommitSha.slice(0, 7) : 'HEAD');
		temporalBreadcrumbTarget.textContent = (state.selectedRef || 'HEAD') + ' · ' + targetShort;
	}
	if (temporalBreadcrumbBase) {
		const curBase = state.compareBaseSha || curCommit?.parents?.[0] || '';
		temporalBreadcrumbBase.textContent = curBase ? curBase.slice(0, 7) : 'root';
	}

	if (currentIdx >= 0) {
		const sliderVal = (total - 1) - currentIdx;
		if (temporalScrubber) temporalScrubber.value = String(sliderVal);
		const commit = curCommit || timeline[currentIdx];
		if (commit) {
			if (temporalCommitSha) temporalCommitSha.textContent = commit.shortSha || commit.sha.slice(0, 7);
			if (temporalCommitMessage) temporalCommitMessage.textContent = commit.message || '';
			if (temporalCommitAuthor) temporalCommitAuthor.textContent = commit.author ? 'by ' + commit.author : '';

			if (temporalCommitStatus || temporalRetryBtn) {
				const unifiedStatus = computeTemporalUnifiedStatus(state);
				if (temporalCommitStatus) {
					temporalCommitStatus.textContent = unifiedStatus.label;
					temporalCommitStatus.title = unifiedStatus.title;
					temporalCommitStatus.style.color = unifiedStatus.colorVar;
					temporalCommitStatus.style.background = unifiedStatus.bgVar;
				}
				if (temporalRetryBtn) {
					temporalRetryBtn.style.display = unifiedStatus.canRetry ? 'inline-block' : 'none';
				}
			}
			if (temporalScrubber) temporalScrubber.setAttribute('aria-valuetext', 'Commit ' + (commit.shortSha || commit.sha.slice(0, 7)) + ': ' + commit.message + (commit.author ? ', by ' + commit.author : ''));
		}
	}

	// Render windowed interactive timeline button markers
	if (temporalTimelineStrip) {
		while (temporalTimelineStrip.firstChild) temporalTimelineStrip.removeChild(temporalTimelineStrip.firstChild);
		const windowStart = state.timelineWindow ? state.timelineWindow.start : 0;
		for (let i = timeline.length - 1; i >= 0; i--) {
			const c = timeline[i];
			const globalIndex = windowStart + i;
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'commit-marker' + (c.sha === state.selectedCommitSha ? ' active' : '') + (c.isMerge ? ' is-merge' : '');
			btn.setAttribute('role', 'button');
			btn.setAttribute('tabindex', '0');
			if (c.sha === state.selectedCommitSha) {
				btn.setAttribute('aria-current', 'true');
			}
			const markerLabel = 'Commit ' + (c.shortSha || c.sha.slice(0, 7)) + ': ' + c.message + (c.author ? ', by ' + c.author : '') + (c.isMerge ? ' [Merge]' : '');
			btn.title = markerLabel;
			btn.setAttribute('aria-label', markerLabel);
			btn.onclick = (function (sha, idx) {
				return function (e) {
					if (e) { e.stopPropagation(); }
					request('selectTemporalCommitIndex', { index: idx, immediate: true });
				};
			})(c.sha, globalIndex);
			btn.onkeydown = (function (sha, idx) {
				return function (e) {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						e.stopPropagation();
						request('selectTemporalCommitIndex', { index: idx, immediate: true });
					}
				};
			})(c.sha, globalIndex);
			temporalTimelineStrip.appendChild(btn);
		}
	}

	// Details Inspector Panel Update
	const detailsSha = document.getElementById('detailsCommitSha');
	const detailsMsg = document.getElementById('detailsCommitMsg');
	const detailsAuthor = document.getElementById('detailsCommitAuthor');
	const detailsParents = document.getElementById('detailsCommitParents');
	const detailsSummary = document.getElementById('detailsDeltaSummary');
	const detailsEntities = document.getElementById('detailsEntityList');

	const renderedCommit = state.renderedCommitSummary;
	const isCurrentlyLoading = Boolean(state.isLoadingSelection || (state.renderedCommitSha && state.renderedCommitSha !== state.selectedCommitSha));

	if (detailsSha) {
		if (isCurrentlyLoading && curCommit && renderedCommit) {
			detailsSha.textContent = (renderedCommit.sha || '') + ' (Displaying)' + String.fromCharCode(10) + (curCommit.sha || '') + ' (Selected - Loading…)';
		} else {
			detailsSha.textContent = (renderedCommit ? renderedCommit.sha : (curCommit ? curCommit.sha : ''));
		}
	}
	if (detailsMsg) {
		const target = renderedCommit || curCommit;
		detailsMsg.textContent = target?.message || '(no message)';
	}
	if (detailsAuthor) {
		const target = renderedCommit || curCommit;
		detailsAuthor.textContent = (target?.author || 'Unknown') + ' · ' + (target?.timestamp ? new Date(target.timestamp).toLocaleString() : '');
	}
	if (detailsParents) {
		const target = renderedCommit || curCommit;
		detailsParents.textContent = (target?.parents && target.parents.length > 0) ? target.parents.join(', ') : 'None (Root commit)';
	}

	if (diff && diff.summary && detailsSummary) {
		while (detailsSummary.firstChild) detailsSummary.removeChild(detailsSummary.firstChild);
		const bAdded = document.createElement('span'); bAdded.className = 'badge-added'; bAdded.textContent = '+' + diff.summary.addedCount + ' nodes'; detailsSummary.appendChild(bAdded);
		const bRemoved = document.createElement('span'); bRemoved.className = 'badge-removed'; bRemoved.textContent = '-' + diff.summary.removedCount + ' nodes'; detailsSummary.appendChild(bRemoved);
		const bMod = document.createElement('span'); bMod.className = 'badge-modified'; bMod.textContent = '~' + diff.summary.modifiedCount + ' modified'; detailsSummary.appendChild(bMod);
		const bRen = document.createElement('span'); bRen.className = 'badge-renamed'; bRen.textContent = '⇄' + diff.summary.renamedCount + ' renamed' + (diff.summary.renamedModifiedCount ? ' (~' + diff.summary.renamedModifiedCount + ' also modified)' : ''); detailsSummary.appendChild(bRen);
		if (diff.summary.edgeAddedCount || diff.summary.edgeRemovedCount || diff.summary.edgeModifiedCount) {
			const bEdges = document.createElement('span'); bEdges.style.fontSize = '10px'; bEdges.style.opacity = '0.75';
			bEdges.textContent = 'Edges: +' + diff.summary.edgeAddedCount + ' -' + diff.summary.edgeRemovedCount + ' ~' + diff.summary.edgeModifiedCount;
			detailsSummary.appendChild(bEdges);
		}
		const bTotal = document.createElement('span'); bTotal.style.fontSize = '10px'; bTotal.style.opacity = '0.75'; bTotal.style.marginLeft = 'auto';
		bTotal.textContent = (diff.nodes ? diff.nodes.length : 0) + ' total nodes';
		detailsSummary.appendChild(bTotal);
	}
	if (diff && detailsEntities) {
		while (detailsEntities.firstChild) detailsEntities.removeChild(detailsEntities.firstChild);
		const changedNodes = (diff.nodes || []).filter(n => n.changeKind !== 'unchanged');
		if (changedNodes.length === 0) {
			const emptyDiv = document.createElement('div');
			emptyDiv.style.opacity = '0.6';
			emptyDiv.style.padding = '4px';
			emptyDiv.textContent = 'No structural changes against compare base.';
			detailsEntities.appendChild(emptyDiv);
		} else {
			for (let i = 0; i < changedNodes.length; i++) {
				const n = changedNodes[i];
				const item = document.createElement('div');
				item.className = 'entity-item';
				const labelSpan = document.createElement('span');
				labelSpan.style.fontFamily = 'monospace';
				labelSpan.style.overflow = 'hidden';
				labelSpan.style.textOverflow = 'ellipsis';
				labelSpan.style.whiteSpace = 'nowrap';
				labelSpan.style.maxWidth = '210px';
				labelSpan.title = n.path || '';
				labelSpan.textContent = n.label || n.path || n.entityId;
				item.appendChild(labelSpan);

				const badgeSpan = document.createElement('span');
				badgeSpan.className = 'badge-' + n.changeKind;
				badgeSpan.textContent = n.changeKind;
				item.appendChild(badgeSpan);

				item.onclick = (function (node) {
					return function () {
						selectedNodeId = node.entityId;
						openNodePopup(node, window.innerWidth / 2, window.innerHeight / 2);
						dirty = true;
						drawTemporalFrame(performance.now());
					};
				})(n);
				item.ondblclick = (function (node) {
					return function () {
						request('openTemporalSourceDiff', { entityId: node.entityId });
					};
				})(n);
				detailsEntities.appendChild(item);
			}
		}
	}

	// Load more history button
	if (temporalLoadMoreBtn) {
		temporalLoadMoreBtn.style.display = state.historyHasMore ? 'inline-block' : 'none';
		if (state.isLoadingMoreHistory) {
			temporalLoadMoreBtn.textContent = 'Loading…';
			temporalLoadMoreBtn.disabled = true;
		} else if (state.historyLoadMoreError) {
			temporalLoadMoreBtn.textContent = 'Retry loading older';
			temporalLoadMoreBtn.disabled = false;
			temporalLoadMoreBtn.title = state.historyLoadMoreError;
		} else {
			temporalLoadMoreBtn.textContent = 'Load older…';
			temporalLoadMoreBtn.disabled = false;
			temporalLoadMoreBtn.title = 'Load older commit history';
		}
	}

	// Partial warning
	if (temporalPartialWarning) {
		temporalPartialWarning.style.display = state.isPartialLineage ? 'inline-block' : 'none';
	}

	// Diff Badges
	if (diff && diff.summary) {
		if (badgeAdded) badgeAdded.textContent = '+' + diff.summary.addedCount;
		if (badgeRemoved) badgeRemoved.textContent = '-' + diff.summary.removedCount;
		if (badgeModified) badgeModified.textContent = '~' + diff.summary.modifiedCount;
		if (badgeRenamed) badgeRenamed.textContent = '⇄' + diff.summary.renamedCount;
	}
}

function updateTemporalDiffTransition(diff) {
	if (!diff) return;
	const nextPrevMap = new Map();
	const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const isReduced = settings.reduceMotion || prefersReduced;
	const currentEase = (isAnimatingTemporal && animDuration > 0 && !isReduced)
		? 1 - Math.pow(1 - Math.min(1, (performance.now() - animStartTime) / animDuration), 3)
		: 1;

	currentTemporalRenderNodes.forEach(function (n) {
		nextPrevMap.set(n.entityId, getVisualNodePosition(n, currentEase));
	});
	previousTemporalRenderNodes = nextPrevMap;

	const nextMap = new Map();
	const nodes = diff.nodes || [];
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		nextMap.set(node.entityId, {
			entityId: node.entityId,
			canonicalNodeId: node.canonicalNodeId,
			label: node.label,
			path: node.path,
			oldPath: node.oldPath,
			changeKind: node.changeKind,
			architectureLayer: node.architectureLayer,
			isMergeArtifact: node.isMergeArtifact,
			isStructuralAnomaly: node.isStructuralAnomaly,
			fileType: node.fileType,
			confidence: node.confidence,
			x: node.x || 0,
			y: node.y || 0,
		});
	}
	currentTemporalRenderNodes = nextMap;
	animDuration = isReduced ? 0 : 220;
	animStartTime = performance.now();
	isAnimatingTemporal = !isReduced && animDuration > 0;
	// Reduced motion must never leave a lingering animation flag that keeps the
	// RAF loop repainting.
	if (!isAnimatingTemporal) {
		previousTemporalRenderNodes = new Map();
	}
	dirty = true;
	kickRaf();
}

function drawTemporalFrame(ts) {
	if (!netCanvas || !ctx) return;
	const renderStart = performance.now();
	let edgesDrawn = 0;
	const w = netCanvas.clientWidth || 800;
	const h = netCanvas.clientHeight || 600;
	const theme = getComputedThemeColors();

	ctx.fillStyle = theme.bg || '#1B1C1E';
	ctx.fillRect(0, 0, w, h);

	const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const isReduced = settings.reduceMotion || prefersReduced;

	const elapsed = ts - animStartTime;
	const progress = (animDuration > 0 && !isReduced) ? Math.min(1, elapsed / animDuration) : 1;
	const ease = isReduced ? 1 : 1 - Math.pow(1 - progress, 3);
	if (progress >= 1) {
		isAnimatingTemporal = false;
	}

	const filterVal = (temporalFilterInput && temporalFilterInput.value) ? temporalFilterInput.value.toLowerCase().trim() : '';

	// 1. Calculate Focus+Context visible elements, then node-level LOD projection
	const visibleData = computeTemporalVisibleElements(temporalDiff, displayMode, temporalContextFilterMode);
	const kNow = Math.max(0.001, transform.k);
	const worldViewport = {
		minX: (0 - transform.x) / kNow,
		minY: (0 - transform.y) / kNow,
		maxX: (w - transform.x) / kNow,
		maxY: (h - transform.y) / kNow,
	};
	const temporalProjection = projectTemporalVisibleSet(visibleData.nodes, temporalDiff && temporalDiff.guides, {
		zoom: transform.k,
		displayMode: displayMode,
		selectedEntityId: selectedNodeId,
		hoveredEntityId: hoveredNodeId,
		searchQuery: filterVal,
		expandedGuideId: expandedTemporalGuideId,
		viewport: worldViewport,
		currentFileEntityId: temporalState && temporalState.currentFileEntityId,
	});
	const projectedLeafIds = new Set();
	const projectedLeaves = [];
	const projectedAggregates = [];
	for (let pi = 0; pi < temporalProjection.items.length; pi++) {
		const item = temporalProjection.items[pi];
		if (item.kind === 'aggregate') {
			projectedAggregates.push(item);
		} else {
			projectedLeafIds.add(item.entityId);
			projectedLeaves.push(item.node);
		}
	}

	if (visibleData.hasZeroChanges && displayMode === 'changes') {
		if (noChangesCard) noChangesCard.style.display = 'flex';
		return;
	} else {
		if (noChangesCard) noChangesCard.style.display = 'none';
	}

	ctx.save();
	ctx.translate(transform.x, transform.y);
	ctx.scale(transform.k, transform.k);

	// 2. Render Architecture Hierarchy / Community Region Boundaries in Full Codebase Mode
	if (displayMode === 'state' && temporalDiff && Array.isArray(temporalDiff.guides) && (temporalProjection.tier === 'overview' || transform.k >= 0.22)) {
		for (let g = 0; g < temporalDiff.guides.length; g++) {
			const guide = temporalDiff.guides[g];
			const bounds = guide && guide.bounds;
			if (!bounds) continue;
			ctx.save();
			const gx = bounds.minX;
			const gy = bounds.minY;
			const gw = Math.max(8, bounds.maxX - bounds.minX);
			const gh = Math.max(8, bounds.maxY - bounds.minY);
			const radius = Math.min(18, Math.min(gw, gh) * 0.18);
			const hexColor = typeof guide.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(guide.color) ? guide.color : '';
			ctx.beginPath();
			if (typeof ctx.roundRect === 'function') {
				ctx.roundRect(gx, gy, gw, gh, radius);
			} else {
				ctx.rect(gx, gy, gw, gh);
			}
			ctx.fillStyle = theme.isHighContrast
				? 'rgba(255, 255, 255, 0.02)'
				: (hexColor ? (hexColor + '08') : 'rgba(99, 102, 241, 0.03)');
			ctx.fill();
			ctx.strokeStyle = theme.isHighContrast
				? 'rgba(255, 255, 255, 0.16)'
				: (hexColor ? (hexColor + '2e') : 'rgba(99, 102, 241, 0.14)');
			ctx.lineWidth = 1;
			if (typeof ctx.setLineDash === 'function') ctx.setLineDash([3, 7]);
			ctx.stroke();
			ctx.restore();
		}

		// 2b. Render Overview Community-to-Community Aggregate Edges with coordinated crossfade
		if (transform.k < 0.85 && visibleData.edges && visibleData.edges.length > 0) {
			const aggAlpha = transform.k < 0.50 ? 0.85 : Math.max(0, 0.85 * (1 - (transform.k - 0.50) / 0.35));
			if (aggAlpha > 0.01) {
				const aggEdges = computeCommunityAggregateEdges(visibleData.edges, temporalDiff.guides);
				const commMap = new Map();
				for (let g = 0; g < temporalDiff.guides.length; g++) {
					commMap.set(temporalDiff.guides[g].id, temporalDiff.guides[g]);
				}
				// Lane index is per undirected community pair (not global agg list index).
				const pairLaneCounts = new Map();
				const pairLaneIndex = new Map();
				for (let a = 0; a < aggEdges.length; a++) {
					const agg = aggEdges[a];
					const lo = agg.sourceCommunityId < agg.targetCommunityId ? agg.sourceCommunityId : agg.targetCommunityId;
					const hi = agg.sourceCommunityId < agg.targetCommunityId ? agg.targetCommunityId : agg.sourceCommunityId;
					const key = lo + '::' + hi;
					pairLaneIndex.set(a, pairLaneCounts.get(key) || 0);
					pairLaneCounts.set(key, (pairLaneCounts.get(key) || 0) + 1);
				}

				for (let a = 0; a < aggEdges.length; a++) {
					const agg = aggEdges[a];
					const cSrc = commMap.get(agg.sourceCommunityId);
					const cTgt = commMap.get(agg.targetCommunityId);
					if (!cSrc || !cTgt) continue;

					const dx = cTgt.x - cSrc.x;
					const dy = cTgt.y - cSrc.y;
					const dist = Math.hypot(dx, dy);
					if (dist < 10) continue;

					const lo = agg.sourceCommunityId < agg.targetCommunityId ? agg.sourceCommunityId : agg.targetCommunityId;
					const hi = agg.sourceCommunityId < agg.targetCommunityId ? agg.targetCommunityId : agg.sourceCommunityId;
					const pairKey = lo + '::' + hi;
					const route = computeAggregateEdgeRoute(
						cSrc.x, cSrc.y, cTgt.x, cTgt.y,
						cSrc.radius || 40, cTgt.radius || 40,
						pairLaneIndex.get(a) || 0, pairLaneCounts.get(pairKey) || 1,
						agg.sourceCommunityId, agg.targetCommunityId
					);

					const strokeWidth = Math.min(4.0, 1.2 + Math.log2(1 + agg.edgeCount) * 0.5) / Math.max(0.35, Math.sqrt(transform.k));

					ctx.save();
					ctx.globalAlpha = aggAlpha;
					ctx.beginPath();
					ctx.moveTo(route.x1, route.y1);
					if (typeof ctx.quadraticCurveTo === 'function') {
						ctx.quadraticCurveTo(route.cpX, route.cpY, route.x2, route.y2);
					} else {
						ctx.lineTo(route.x2, route.y2);
					}
					ctx.strokeStyle = agg.changedEdgeCount > 0
						? theme.accent
						: (theme.isHighContrast ? 'rgba(255, 255, 255, 0.22)' : 'rgba(99, 102, 241, 0.20)');
					ctx.lineWidth = strokeWidth;
					ctx.stroke();
					edgesDrawn++;

					// Count badge on the quadratic midpoint (not the chord).
					if (transform.k >= 0.38) {
						const midX = 0.25 * route.x1 + 0.5 * route.cpX + 0.25 * route.x2;
						const midY = 0.25 * route.y1 + 0.5 * route.cpY + 0.25 * route.y2;
						const badgeFont = computeNetworkLabelWorldFontSize(9, transform.k, { minScreenPx: 8, maxScreenPx: 14 });
						ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
						ctx.fillRect(midX - 9 / transform.k, midY - 6 / transform.k, 18 / transform.k, 12 / transform.k);
						ctx.font = canvasFont('600', badgeFont);
						ctx.fillStyle = agg.changedEdgeCount > 0 ? theme.accent : '#94a3b8';
						ctx.textAlign = 'center';
						ctx.textBaseline = 'middle';
						ctx.fillText(String(agg.edgeCount), midX, midY);
					}
					ctx.restore();
				}
			}
		}
	}

	const visibleNodeSet = new Set(visibleData.nodes.map(n => n.entityId));
	const focusSet = visibleData.focusSet;
	const directContextSet = visibleData.directContextSet;

	// 3. Render Edges (Curved Bezier with Dark Contrast Halo & LOD)
	if (visibleData.edges) {
		const isEdgeConnectedToActive = function (edge) {
			const s = edge.sourceEntityId || edge.sourceId;
			const t = edge.targetEntityId || edge.targetId;
			const activeId = selectedNodeId || hoveredNodeId;
			return Boolean(activeId && (s === activeId || t === activeId));
		};

		// Sort edges: background unchanged edges first, changed focus edges next, active highlighted edges on top
		const edgesToDraw = visibleData.edges.slice().sort(function (a, b) {
			const aActive = isEdgeConnectedToActive(a) ? 2 : (a.changeKind && a.changeKind !== 'unchanged' ? 1 : 0);
			const bActive = isEdgeConnectedToActive(b) ? 2 : (b.changeKind && b.changeKind !== 'unchanged' ? 1 : 0);
			return aActive - bActive;
		});

		for (let i = 0; i < edgesToDraw.length; i++) {
			const edge = edgesToDraw[i];
			const sourceEntityId = edge.sourceEntityId || edge.sourceId;
			const targetEntityId = edge.targetEntityId || edge.targetId;
			const sourceNode = currentTemporalRenderNodes.get(sourceEntityId);
			const targetNode = currentTemporalRenderNodes.get(targetEntityId);
			if (!sourceNode || !targetNode) continue;
			if (!visibleNodeSet.has(sourceEntityId) || !visibleNodeSet.has(targetEntityId)) continue;
			if (temporalProjection.tier === 'overview' && !projectedLeafIds.has(sourceEntityId) && !projectedLeafIds.has(targetEntityId)) continue;

			const isEdgeActive = isEdgeConnectedToActive(edge);
			const isInteracting = isTemporal() && (panning || interactionState === 'panning' || (dragging && moved));

			const lodStyle = computeEdgeLodStyle(edge, transform.k, {
				isConnectedToActive: isEdgeActive,
				isInteracting: isInteracting,
				isHighContrast: theme.isHighContrast,
			});

			if (!lodStyle.shouldRender) {
				continue;
			}

			const sp = getVisualNodePosition(sourceNode, ease);
			const tp = getVisualNodePosition(targetNode, ease);

			const dx = tp.x - sp.x;
			const dy = tp.y - sp.y;
			const dist = Math.hypot(dx, dy);
			const curvature = Math.min(0.24, Math.max(0.08, 30 / (dist + 1)));
			const midX = (sp.x + tp.x) / 2;
			const midY = (sp.y + tp.y) / 2;
			const cpX = midX - dy * curvature * 0.35;
			const cpY = midY + dx * curvature * 0.35;

			let edgeColor = theme.isHighContrast ? 'rgba(255, 255, 255, 0.35)' : 'rgba(148, 163, 184, 0.2)';
			let edgeWidth = lodStyle.strokeWidth || 1.0;
			let edgeDash = lodStyle.strokeDash ? Array.from(lodStyle.strokeDash) : [];

			if (isEdgeActive) {
				edgeColor = theme.accent;
				edgeWidth = 2.4;
			} else if (edge.changeKind === 'added') {
				edgeColor = theme.added;
				edgeWidth = 1.8;
			} else if (edge.changeKind === 'removed') {
				edgeColor = theme.deleted;
				edgeWidth = 1.4;
				edgeDash = [4, 4];
			} else if (edge.changeKind === 'modified') {
				edgeColor = theme.modified;
				edgeWidth = 1.8;
			}

			ctx.save();
			ctx.globalAlpha = (typeof lodStyle.opacity === 'number' && Number.isFinite(lodStyle.opacity)) ? lodStyle.opacity : 1.0;
			// Dark contrast halo beneath edge
			ctx.beginPath();
			ctx.moveTo(sp.x, sp.y);
			if (typeof ctx.quadraticCurveTo === 'function') {
				ctx.quadraticCurveTo(cpX, cpY, tp.x, tp.y);
			} else {
				ctx.lineTo(tp.x, tp.y);
			}
			ctx.strokeStyle = theme.isHighContrast ? 'rgba(0, 0, 0, 0.95)' : 'rgba(15, 23, 42, 0.65)';
			ctx.lineWidth = edgeWidth + (isEdgeActive ? 3.0 : 2.0);
			ctx.stroke();

			// Colored stroke
			ctx.beginPath();
			ctx.moveTo(sp.x, sp.y);
			if (typeof ctx.quadraticCurveTo === 'function') {
				ctx.quadraticCurveTo(cpX, cpY, tp.x, tp.y);
			} else {
				ctx.lineTo(tp.x, tp.y);
			}
			ctx.strokeStyle = edgeColor;
			ctx.lineWidth = edgeWidth;
			if (edgeDash.length && typeof ctx.setLineDash === 'function') ctx.setLineDash(edgeDash);
			ctx.stroke();
			edgesDrawn++;
			ctx.restore();
		}
	}

	// 4. Render node-level LOD: community aggregates, then piercing / detail leaves
	if (projectedAggregates.length) {
		for (let a = 0; a < projectedAggregates.length; a++) {
			const agg = projectedAggregates[a];
			const markerR = Math.max(3.0, 4.8 / Math.max(0.4, transform.k));
			ctx.save();
			ctx.beginPath();
			ctx.arc(agg.x, agg.y, markerR, 0, Math.PI * 2);
			ctx.fillStyle = agg.changedCount > 0
				? theme.accent
				: (theme.isHighContrast ? '#ffffff' : (agg.color || 'rgba(230, 237, 243, 0.78)'));
			ctx.fill();
			const countFont = computeNetworkLabelWorldFontSize(10, transform.k, { minScreenPx: 8, maxScreenPx: 13 });
			ctx.font = canvasFont('600', countFont);
			ctx.fillStyle = theme.isHighContrast ? '#ffffff' : '#e6edf3';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';
			const countLabel = agg.changedCount > 0
				? (String(agg.nodeCount) + ' files · ' + String(agg.changedCount) + ' changed')
				: (String(agg.nodeCount) + ' files');
			ctx.fillText(countLabel, agg.x, agg.y + markerR + 2 / Math.max(0.4, transform.k));
			ctx.restore();
		}
	}

	const nodesToRender = projectedLeaves.slice();
	nodesToRender.sort(function (a, b) {
		const aRank = a.changeKind && a.changeKind !== 'unchanged' ? 2 : (directContextSet.has(a.entityId) ? 1 : 0);
		const bRank = b.changeKind && b.changeKind !== 'unchanged' ? 2 : (directContextSet.has(b.entityId) ? 1 : 0);
		return aRank - bRank;
	});

	const isChangesMode = displayMode === 'changes';

	for (let i = 0; i < nodesToRender.length; i++) {
		const node = nodesToRender[i];
		const pos = getVisualNodePosition(node, ease);
		const isMatch = !filterVal || (node.label && node.label.toLowerCase().includes(filterVal)) || (node.path && node.path.toLowerCase().includes(filterVal));
		const isSelected = selectedNodeId === node.entityId;
		const isHovered = hoveredNodeId === node.entityId;
		const isFocus = Boolean(node.changeKind && node.changeKind !== 'unchanged');
		const isDirectContext = directContextSet.has(node.entityId);

		const layerColor = getArchitectureLayerColor(node.meta?.architectureLayer);
		let r = computeTemporalVisualRadius(node, {
			isChanged: isFocus,
			isSelected: isSelected,
			isHovered: isHovered,
			zoom: transform.k,
		});
		if (!isFocus && isDirectContext) {
			r = Math.max(r, computeTemporalVisualRadius(node, { isChanged: false, zoom: transform.k }) * 1.12);
		}
		let fillColor = layerColor;
		let strokeColor = theme.isHighContrast ? '#ffffff' : '#6e7681';
		let alpha = isFocus ? 1.0 : (isDirectContext ? 0.85 : 0.45);
		let haloColor = null;

		if (node.changeKind === 'added') {
			strokeColor = theme.added;
			if (isChangesMode) {
				fillColor = '#2ea043';
				haloColor = 'rgba(63, 185, 80, 0.28)';
			}
		} else if (node.changeKind === 'removed') {
			strokeColor = theme.deleted;
			if (isChangesMode) {
				fillColor = 'rgba(248, 81, 73, 0.25)';
				haloColor = 'rgba(248, 81, 73, 0.28)';
			}
		} else if (node.changeKind === 'modified') {
			strokeColor = theme.modified;
			if (isChangesMode) {
				fillColor = '#d29922';
				haloColor = 'rgba(210, 153, 34, 0.28)';
			}
		} else if (node.changeKind === 'renamed') {
			strokeColor = theme.renamed;
			if (isChangesMode) {
				fillColor = '#1f6feb';
				haloColor = 'rgba(88, 166, 255, 0.28)';
			}
		}

		if (!isMatch) {
			alpha *= 0.25;
		}

		ctx.save();
		ctx.globalAlpha = alpha;

		// Selection / Hover highlights
		if (isSelected) {
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, r + 4.5, 0, Math.PI * 2);
			ctx.strokeStyle = theme.accent;
			ctx.lineWidth = 2.5;
			ctx.stroke();
		} else if (isHovered) {
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, r + 3.5, 0, Math.PI * 2);
			ctx.strokeStyle = '#58a6ff';
			ctx.lineWidth = 2.0;
			ctx.stroke();
		}

		// Entry indicator
		if (node.meta?.isEntry) {
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, r + 2.8, 0, Math.PI * 2);
			ctx.strokeStyle = '#f59e0b';
			ctx.lineWidth = 1.4;
			ctx.stroke();
		}

		// Glowing accent halo for changed nodes
		if (isFocus && haloColor) {
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, r + 4.5, 0, Math.PI * 2);
			ctx.fillStyle = haloColor;
			ctx.fill();
		}

		// Node Main Body
		ctx.beginPath();
		ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
		ctx.fillStyle = fillColor;
		ctx.fill();

		// Inner Architecture Pip in Changes Mode for changed nodes
		if (isChangesMode && isFocus) {
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, 2.5, 0, Math.PI * 2);
			ctx.fillStyle = layerColor;
			ctx.fill();
		}

		// Node Outer Stroke
		ctx.lineWidth = isFocus ? 2.2 : 1.2;
		if (node.changeKind === 'removed' && typeof ctx.setLineDash === 'function') {
			ctx.setLineDash([2, 2]);
		}
		ctx.strokeStyle = strokeColor;
		ctx.stroke();
		if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
		ctx.restore();
	}

	// 5. Labels with unified community + node occupancy
	const visibleNodeIdSet = new Set();
	for (let ni = 0; ni < nodesToRender.length; ni++) {
		visibleNodeIdSet.add(nodesToRender[ni].entityId);
	}
	const labelLayout = computeTemporalLabelLayout(nodesToRender, temporalDiff.guides || [], transform.k, {
		selectedNodeId: selectedNodeId,
		hoveredNodeId: hoveredNodeId,
		filterQuery: filterVal,
		measureWidth: function (t, f) { return measureTextWidth(t, f); },
		visibleNodeIds: visibleNodeIdSet,
	});
	const visibleLabels = labelLayout.nodeLabels;
	const guideLabels = labelLayout.guideLabels;

	for (let gi = 0; gi < guideLabels.length; gi++) {
		const gl = guideLabels[gi];
		ctx.save();
		const hexColor = gl.color || (gl.layerId ? getArchitectureLayerColor(gl.layerId) : null);
		const pillX = gl.box.x;
		const pillY = gl.box.y;
		const badgeW = gl.box.w;
		const badgeH = gl.box.h;
		const pillR = Math.min(6, Math.max(3, 4 / Math.max(0.4, transform.k)));

		ctx.fillStyle = theme.isHighContrast ? 'rgba(0, 0, 0, 0.90)' : 'rgba(15, 23, 42, 0.84)';
		if (typeof ctx.roundRect === 'function') {
			ctx.beginPath();
			ctx.roundRect(pillX, pillY, badgeW, badgeH, pillR);
			ctx.fill();
			ctx.strokeStyle = hexColor ? (hexColor + '55') : 'rgba(99, 102, 241, 0.35)';
			ctx.lineWidth = 1;
			if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
			ctx.stroke();
		} else {
			ctx.fillRect(pillX, pillY, badgeW, badgeH);
		}

		// Layer color dot
		const fontMatch = gl.font ? gl.font.match(/(\d+)px/) : null;
		const fontPx = fontMatch ? parseInt(fontMatch[1], 10) : 12;
		const dotR = Math.max(2, Math.round(3 / Math.max(0.4, transform.k)));
		ctx.beginPath();
		ctx.arc(pillX + Math.max(5, 7 / Math.max(0.4, transform.k)), pillY + fontPx * 0.55, dotR, 0, Math.PI * 2);
		ctx.fillStyle = hexColor || theme.accent;
		ctx.fill();

		// Community Title
		ctx.font = gl.font;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		ctx.fillStyle = theme.isHighContrast ? '#ffffff' : '#f1f5f9';
		ctx.fillText(gl.text, pillX + Math.max(12, 14 / Math.max(0.4, transform.k)), pillY + Math.max(2, 3 / Math.max(0.4, transform.k)));

		// Subtitle
		if (gl.subText && gl.subFont) {
			ctx.font = gl.subFont;
			ctx.fillStyle = theme.isHighContrast ? '#cccccc' : '#94a3b8';
			ctx.fillText(gl.subText, pillX + Math.max(12, 14 / Math.max(0.4, transform.k)), pillY + fontPx + Math.max(3, 4 / Math.max(0.4, transform.k)));
		}
		ctx.restore();
	}

	for (let i = 0; i < visibleLabels.length; i++) {
		const lbl = visibleLabels[i];
		ctx.save();
		ctx.font = lbl.font;
		ctx.textAlign = 'center';
		ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
		ctx.fillRect(lbl.box.x, lbl.box.y, lbl.box.w, lbl.box.h);
		ctx.fillStyle = lbl.isSelected ? theme.accent : (lbl.isHovered ? '#58a6ff' : (lbl.isChanged ? '#f4f4f5' : 'rgba(244, 244, 245, 0.75)'));
		ctx.fillText(lbl.text, lbl.x, lbl.y + 3);
		ctx.restore();
	}

	const renderEnd = performance.now();
	if (typeof window !== 'undefined' && window.__prebaseRecordRenderMetrics) {
		try {
			const metrics = window.__prebaseGraphRenderMetrics || (window.__prebaseGraphRenderMetrics = {});
			metrics.sequenceId = (metrics.sequenceId || 0) + 1;
			metrics.mode = 'temporal';
			metrics.displayMode = displayMode;
			metrics.renderStart = renderStart;
			metrics.renderEnd = renderEnd;
			metrics.durationMs = Math.max(0, renderEnd - renderStart);
			metrics.selectedCommitSha = temporalState && temporalState.selectedCommitSha;
			metrics.renderedCommitSha = temporalState && temporalState.renderedCommitSha;
			metrics.isPartialLineage = Boolean(temporalState && temporalState.isPartialLineage);
			metrics.receivedNodeCount = temporalDiff && temporalDiff.nodes ? temporalDiff.nodes.length : 0;
			metrics.visibleNodeCount = visibleData.nodes.length;
			metrics.finiteCoordinateCount = temporalDiff && temporalDiff.nodes
				? temporalDiff.nodes.filter(function (node) { return Number.isFinite(node.x) && Number.isFinite(node.y); }).length
				: 0;
			metrics.nodesDrawn = temporalProjection.leafNodesDrawn + temporalProjection.aggregateNodesDrawn;
			metrics.leafNodesDrawn = temporalProjection.leafNodesDrawn;
			metrics.aggregateNodesDrawn = temporalProjection.aggregateNodesDrawn;
			metrics.receivedLeafNodeCount = temporalProjection.receivedLeafNodeCount;
			metrics.communitiesRepresented = temporalProjection.communitiesRepresented;
			metrics.visibleChangedNodeCount = temporalProjection.visibleChangedNodeCount;
			metrics.visibleChangedAggregateCount = temporalProjection.visibleChangedAggregateCount;
			metrics.culledLeafCount = temporalProjection.culledLeafCount;
			metrics.projectionTier = temporalProjection.tier;
			metrics.lodTier = temporalProjection.tier === 'overview' ? 'aggregate' : (temporalProjection.tier === 'medium' ? 'direct' : 'full');
			metrics.structuralOk = metrics.nodesDrawn > 0 && Number.isFinite(transform.k);
			metrics.humanVisualReviewRequired = true;
			metrics.edgesDrawn = edgesDrawn;
			metrics.labelsDrawn = visibleLabels.length;
			metrics.guideLabelsDrawn = guideLabels.length;
			metrics.labelOverlapCount = labelLayout.labelOverlapCount;
			metrics.selectedNodeId = selectedNodeId;
			metrics.transform = { x: transform.x, y: transform.y, k: transform.k };
			metrics.canvas = { clientWidth: w, clientHeight: h, width: netCanvas.width, height: netCanvas.height };
			metrics.summary = temporalDiff && temporalDiff.summary;
			metrics.isAnimating = Boolean(isAnimatingTemporal);
			metrics.timestamp = renderEnd;
			const screenPoints = [];
			for (let ni = 0; ni < temporalProjection.items.length; ni++) {
				const n = temporalProjection.items[ni];
				if (Number.isFinite(n.x) && Number.isFinite(n.y)) {
					screenPoints.push({ x: n.x * transform.k + transform.x, y: n.y * transform.k + transform.y });
				}
			}
			recordProjectedUtilization(metrics, screenPoints, w, h);
		} catch {}
	}

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
	const k = Math.max(0.001, transform.k);
	const wx = (sx - transform.x) / k;
	const wy = (sy - transform.y) / k;

	const visibleData = computeTemporalVisibleElements(temporalDiff, displayMode, temporalContextFilterMode);
	const projection = projectTemporalVisibleSet(visibleData.nodes, temporalDiff && temporalDiff.guides, {
		zoom: transform.k,
		displayMode: displayMode,
		selectedEntityId: selectedNodeId,
		hoveredEntityId: hoveredNodeId,
		expandedGuideId: expandedTemporalGuideId,
		currentFileEntityId: temporalState && temporalState.currentFileEntityId,
	});
	const visibleNodeSet = new Set();
	for (let i = 0; i < projection.items.length; i++) {
		if (projection.items[i].kind === 'leaf') {
			visibleNodeSet.add(projection.items[i].entityId);
		}
	}

	let best = null;
	let bestDist = Infinity;
	const minPickR = Math.max(18, 22 / k);

	for (let a = 0; a < projection.items.length; a++) {
		const item = projection.items[a];
		if (item.kind !== 'aggregate') continue;
		const pickR = Math.max(22, (item.radius || 28) * 0.5, 26 / k);
		const d = Math.hypot(wx - item.x, wy - item.y);
		let hit = d <= pickR;
		if (!hit && temporalDiff && temporalDiff.guides) {
			for (let g = 0; g < temporalDiff.guides.length; g++) {
				const guide = temporalDiff.guides[g];
				if (guide.id !== item.guideId || !guide.bounds) {
					continue;
				}
				const b = guide.bounds;
				if (wx >= b.minX && wx <= b.maxX && wy >= b.minY && wy <= b.maxY) {
					hit = true;
				}
			}
		}
		if (hit && d < bestDist) {
			bestDist = d;
			best = { entityId: item.entityId, guideId: item.guideId, kind: 'aggregate', x: item.x, y: item.y, memberIds: item.memberIds, label: item.label };
		}
	}

	currentTemporalRenderNodes.forEach(function (node) {
		if (!visibleNodeSet.has(node.entityId)) return;
		const isFocus = Boolean(node.changeKind && node.changeKind !== 'unchanged');
		const pickR = isFocus ? Math.max(20, 24 / k) : minPickR;
		const d = Math.hypot(wx - (node.x || 0), wy - (node.y || 0));
		if (d <= pickR && d < bestDist) {
			bestDist = d;
			best = node;
		}
	});

	return best;
}

function stepTemporalCommit(delta) {
	request('stepTemporalCommit', { delta: delta });
}

const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5l9 5.5-9 5.5z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>';

function toggleTemporalPlay() {
	if (isPlayingHistory) {
		clearInterval(playIntervalTimer);
		playIntervalTimer = null;
		isPlayingHistory = false;
		if (temporalPlayBtn) {
			temporalPlayBtn.innerHTML = PLAY_ICON;
			temporalPlayBtn.title = 'Play timeline (Space)';
		}
	} else {
		if (!temporalState) return;
		const curIdx = typeof temporalState.selectedCommitIndex === 'number' ? temporalState.selectedCommitIndex : 0;
		if (curIdx === 0 && temporalState.loadedCommitCount > 1) {
			const oldestIdx = temporalState.loadedCommitCount - 1;
			request('selectTemporalCommitIndex', { index: oldestIdx, immediate: true });
		}
		isPlayingHistory = true;
		if (temporalPlayBtn) {
			temporalPlayBtn.innerHTML = PAUSE_ICON;
			temporalPlayBtn.title = 'Pause timeline (Space)';
		}
		playIntervalTimer = setInterval(function () {
			const currentIdx = (temporalState && typeof temporalState.selectedCommitIndex === 'number') ? temporalState.selectedCommitIndex : 0;
			if (currentIdx <= 0) {
				toggleTemporalPlay();
				return;
			}
			stepTemporalCommit(1);
		}, 900);
	}
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
	document.addEventListener('visibilitychange', function () {
		if (document.hidden && isPlayingHistory) {
			toggleTemporalPlay();
		}
		if (!document.hidden) {
			dirty = true;
			kickRaf();
		}
	});
}

function pickNetworkNode(clientX, clientY) {
	if (!snapshot || !isNetwork() || !netCanvas) return null;
	const rect = netCanvas.getBoundingClientRect();
	const sx = clientX - rect.left;
	const sy = clientY - rect.top;
	const k = Math.max(0.001, transform.k);
	const wx = (sx - transform.x) / k;
	const wy = (sy - transform.y) / k;
	let best = null;
	let bestDist = Infinity;
	const nodes = snapshot.nodes || [];
	const entryId = snapshot.entryNodeId;
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const p = screenPos(node.id);
		if (!p) continue;
		const pickR = networkPickRadius(node, p.depthScale || 1, entryId);
		const d = Math.hypot(wx - p.x, wy - p.y);
		if (d <= pickR && (d < bestDist || (d === bestDist && best && node.id < best.id))) {
			bestDist = d;
			best = node;
		}
	}
	return best;
}

function drawNetworkEdgeArrow(p1, p2, color, arrowSize) {
	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;
	const len = Math.hypot(dx, dy);
	if (len < 16) return;
	const midX = p1.x + dx * 0.62;
	const midY = p1.y + dy * 0.62;
	const angle = Math.atan2(dy, dx);
	ctx.save();
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.moveTo(midX, midY);
	ctx.lineTo(midX - arrowSize * Math.cos(angle - Math.PI / 6), midY - arrowSize * Math.sin(angle - Math.PI / 6));
	ctx.lineTo(midX - arrowSize * Math.cos(angle + Math.PI / 6), midY - arrowSize * Math.sin(angle + Math.PI / 6));
	if (ctx.closePath) ctx.closePath();
	ctx.fill();
	ctx.restore();
}

function drawNetworkFrame() {
	if (!netCanvas || !ctx) return;
	const renderStart = performance.now();
	const theme = getComputedThemeColors();
	let edgesDrawn = 0;
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
	const activeHighlightId = selectedNodeId || hoveredNodeId;

	// Build connected node lookup using pre-indexed neighbor map
	let connectedNodeIds = null;
	if (activeHighlightId) {
		const cachedNeighbors = nodeNeighborsMap.get(activeHighlightId);
		connectedNodeIds = cachedNeighbors ? new Set(cachedNeighbors) : new Set();
		connectedNodeIds.add(activeHighlightId);
	}

	// 1. Draw Network Edges (Z-bucketed semantic rendering with LOD culling)
	const edgesToDraw = [];
	const opacityVal = settings.networkEdgeOpacity;
	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		const p1 = screenPos(e.source);
		const p2 = screenPos(e.target);
		if (!p1 || !p2) continue;

		const isConnectedToHighlight = Boolean(activeHighlightId && (e.source === activeHighlightId || e.target === activeHighlightId));
		const desc = resolveNetworkEdgeVisual(e, isConnectedToHighlight, activeHighlightId, transform.k, opacityVal);
		if (!desc) continue;

		edgesToDraw.push({ p1: p1, p2: p2, desc: desc });
	}

	edgesToDraw.sort(function (a, b) { return a.desc.priority - b.desc.priority; });

	for (let i = 0; i < edgesToDraw.length; i++) {
		const item = edgesToDraw[i];
		const p1 = item.p1;
		const p2 = item.p2;
		const desc = item.desc;

		ctx.save();
		ctx.beginPath();
		ctx.moveTo(p1.x, p1.y);
		ctx.lineTo(p2.x, p2.y);
		ctx.strokeStyle = desc.color;
		ctx.lineWidth = desc.width;
		ctx.globalAlpha = desc.alpha;
		if (desc.dash && desc.dash.length > 0) {
			ctx.setLineDash(desc.dash);
		}
		ctx.stroke();

		if (desc.showArrow) {
			drawNetworkEdgeArrow(p1, p2, desc.color, Math.max(3, 4 / transform.k));
		}
		ctx.restore();
		edgesDrawn++;
	}

	// 2. Draw Network Nodes Sorted by Projected Z (Far-to-Near).
	// Pair (node, projected) up front: the comparator runs O(n log n) times and
	// must not perform two map lookups per comparison.
	const sortedPairs = [];
	for (let i = 0; i < nodes.length; i++) {
		const p = screenPos(nodes[i].id);
		if (p) sortedPairs.push({ node: nodes[i], p: p });
	}
	sortedPairs.sort(function (a, b) { return a.p.z - b.p.z; });

	for (let i = 0; i < sortedPairs.length; i++) {
		const node = sortedPairs[i].node;
		const p = sortedPairs[i].p;

		const isSelected = selectedNodeId === node.id;
		const isHovered = hoveredNodeId === node.id;
		const r = networkVisualRadius(node, p.depthScale || 1, entryId, isSelected, isHovered);
		const depthAlpha = computeDepthAlpha(p.depthScale || 1);
		const isDimmed = Boolean(activeHighlightId && connectedNodeIds && !connectedNodeIds.has(node.id));

		ctx.save();
		ctx.globalAlpha = isDimmed ? 0.25 : depthAlpha;

		if (isSelected) {
			ctx.beginPath();
			ctx.arc(p.x, p.y, r + 4, 0, 2 * Math.PI);
			ctx.strokeStyle = theme.accent;
			ctx.lineWidth = 2.5;
			ctx.stroke();
		} else if (isHovered) {
			ctx.beginPath();
			ctx.arc(p.x, p.y, r + 3, 0, 2 * Math.PI);
			ctx.strokeStyle = '#58a6ff';
			ctx.lineWidth = 1.8;
			ctx.stroke();
		}

		ctx.beginPath();
		ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
		ctx.fillStyle = nodeColor(node, entryId);
		ctx.fill();
		ctx.strokeStyle = isSelected ? theme.accent : (isHovered ? '#58a6ff' : 'rgba(27, 28, 30, 0.85)');
		ctx.lineWidth = isSelected || isHovered ? 1.8 : 1.0;
		ctx.stroke();
		ctx.restore();
	}

	// 3. Draw Network Labels with Level of Detail & Screen-Space Collision Culling
	const placedLabelBoxes = [];
	const isMoving = rotating || (dragging && panning);

	for (let i = 0; i < sortedPairs.length; i++) {
		const node = sortedPairs[i].node;
		const p = sortedPairs[i].p;

		const isSelected = selectedNodeId === node.id;
		const isHovered = hoveredNodeId === node.id;
		const isEntry = (node.id === entryId || node.isEntry);
		const isImportant = (node.importance && node.importance >= 0.7) || (node.degree && node.degree >= 6);

		let shouldShowLabel = false;
		if (isSelected || isHovered) {
			shouldShowLabel = true;
		} else if (!isMoving) {
			if (isEntry && transform.k >= 0.35) {
				shouldShowLabel = true;
			} else if (isImportant && transform.k >= 0.65) {
				shouldShowLabel = true;
			} else if (transform.k >= 1.2) {
				shouldShowLabel = true;
			}
		}

		if (!shouldShowLabel) continue;

		const r = networkVisualRadius(node, p.depthScale || 1, entryId, isSelected, isHovered);
		const labelText = node.label || node.id;
		const labelY = p.y + r + 10;

		const estWidth = Math.max(18, labelText.length * 6.2);
		const boxLeft = p.x - estWidth / 2 - 2;
		const boxTop = labelY - 7;
		const boxWidth = estWidth + 4;
		const boxHeight = 13;

		if (!isSelected && !isHovered) {
			let collides = false;
			for (let b = 0; b < placedLabelBoxes.length; b++) {
				const pb = placedLabelBoxes[b];
				if (
					boxLeft < pb.x + pb.w &&
					boxLeft + boxWidth > pb.x &&
					boxTop < pb.y + pb.h &&
					boxTop + boxHeight > pb.y
				) {
					collides = true;
					break;
				}
			}
			if (collides) continue;
		}

		placedLabelBoxes.push({ x: boxLeft, y: boxTop, w: boxWidth, h: boxHeight });

		const labelFontPx = computeNetworkLabelWorldFontSize(isSelected || isHovered ? 11 : 10, transform.k, {
			minScreenPx: isSelected || isHovered ? 11 : 9,
			maxScreenPx: 18,
		});
		ctx.save();
		ctx.font = canvasFont((isSelected || isHovered) ? 'bold' : '', labelFontPx);
		ctx.textAlign = 'center';

		// Backdrop for contrast
		ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
		ctx.fillRect(boxLeft, boxTop, boxWidth, boxHeight);

		ctx.fillStyle = (isSelected || isHovered) ? theme.accent : '#f4f4f5';
		ctx.fillText(labelText, p.x, labelY + 3);
		ctx.restore();
	}

	const renderEnd = performance.now();
	if (typeof window !== 'undefined' && window.__prebaseRecordRenderMetrics) {
		try {
			const metrics = window.__prebaseGraphRenderMetrics || (window.__prebaseGraphRenderMetrics = {});
			metrics.sequenceId = (metrics.sequenceId || 0) + 1;
			metrics.mode = 'network';
			metrics.renderStart = renderStart;
			metrics.renderEnd = renderEnd;
			metrics.durationMs = Math.max(0, renderEnd - renderStart);
			metrics.nodesDrawn = sortedPairs.length;
			metrics.receivedNodeCount = snapshot && snapshot.nodes ? snapshot.nodes.length : 0;
			metrics.edgesDrawn = edgesDrawn;
			metrics.labelsDrawn = placedLabelBoxes.length;
			metrics.selectedNodeId = selectedNodeId;
			metrics.networkLayoutMode = snapshot && snapshot.networkLayoutMode;
			metrics.networkIdleAutoRotate = Boolean(settings.networkIdleAutoRotate);
			metrics.rotation = { yaw: rotation.yaw, pitch: rotation.pitch };
			metrics.transform = { x: transform.x, y: transform.y, k: transform.k };
			metrics.nodeHits = [];
			for (let hi = 0; hi < nodes.length && metrics.nodeHits.length < 16; hi++) {
				const hitNode = nodes[hi];
				const hitPos = projected[hitNode.id];
				if (!hitPos) continue;
				const world = base3d[hitNode.id] || null;
				metrics.nodeHits.push({
					id: hitNode.id,
					x: hitPos.x * transform.k + transform.x,
					y: hitPos.y * transform.k + transform.y,
					worldX: world ? world.x : undefined,
					worldY: world ? world.y : undefined,
					worldZ: world ? world.z : undefined,
					world: world ? { x: world.x, y: world.y, z: world.z } : undefined,
				});
			}
			metrics.lodTier = transform.k < 0.3 ? 'low' : (transform.k < 0.8 ? 'medium' : 'high');
			metrics.isAnimating = canIdleRotate() && !idlePaused;
			metrics.timestamp = renderEnd;
			const screenPoints = [];
			for (let hi = 0; hi < nodes.length; hi++) {
				const hitPos = projected[nodes[hi].id];
				if (!hitPos) continue;
				screenPoints.push({ x: hitPos.x * transform.k + transform.x, y: hitPos.y * transform.k + transform.y });
			}
			recordProjectedUtilization(metrics, screenPoints, netCanvas.clientWidth || 0, netCanvas.clientHeight || 0);
		} catch {}
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
		if (archSvg) archSvg.style.display = 'none';
		if (netCanvas) netCanvas.style.display = 'block';
		if (empty) empty.style.display = 'none';
		resizeCanvas();
		updateLegend(null, false);
		updateTemporalUI(temporalState, temporalDiff);
		const canFitTemporal = hasRenderableTemporalNodes(temporalDiff);
		if (canFitTemporal && (first || !hasFittedTemporalView) && !userAdjustedViewport) {
			fitView(false);
			hasFittedTemporalView = true;
		} else if (!canFitTemporal && first) {
			hasFittedTemporalView = false;
		} else if (keepGraphCentered && !userAdjustedViewport) {
			applyCenterLock(true);
		}
		dirty = true;
		kickRaf();
		return;
	}

	hasFittedTemporalView = false;
	if (temporalToolbar) temporalToolbar.style.display = 'none';
	if (temporalScrubberBar) temporalScrubberBar.style.display = 'none';
	if (temporalDetailsPanel) temporalDetailsPanel.style.display = 'none';
	if (toolbar) toolbar.style.display = 'flex';

	if (!snapshot || !snapshot.nodes || !snapshot.nodes.length) {
		if (archSvg) archSvg.style.display = 'none';
		if (netCanvas) netCanvas.style.display = 'none';
		if (empty) {
			empty.style.display = 'flex';
			empty.textContent = (diagnostics && diagnostics.message) || 'Preparing Code Graph…';
		}
		if (status) {
			status.style.display = 'block';
			status.textContent = (diagnostics && diagnostics.status) === 'scanning' ? 'Scanning workspace…' : 'Idle';
		}
		return;
	}

	if (empty) empty.style.display = 'none';
	if (archSvg) archSvg.style.display = 'none';
	if (netCanvas) netCanvas.style.display = 'block';
	resizeCanvas();
	const layoutChanged = rebuildBase3d(snapshot);
	rebuildAdjacency();
	updateLegend(snapshot, true);
	if (status) {
		status.style.display = 'block';
		const edgeCount = (snapshot.edges || []).length;
		status.textContent = snapshot.nodes.length + ' files · ' + edgeCount + ' edges'
			+ (snapshot.nodes.length > 0 && edgeCount === 0 ? ' · No dependency edges were detected in this view.' : '');
	}
	if (first || layoutChanged) {
		projectAll();
		fitView(false);
	} else if (keepGraphCentered) {
		projectAll();
		applyCenterLock(true);
	}
	dirty = true;
	kickRaf();
}

function closePopup() {
	if (popup) popup.style.display = 'none';
	popupNode = null;
	// Focus return target when the popup was opened via keyboard.
	if (document.activeElement && document.activeElement !== document.body
		&& popup && popup.contains && popup.contains(document.activeElement)) {
		if (netCanvas) netCanvas.focus();
	}
}

function placePopupNear(clientX, clientY) {
	if (!popup) return;
	const pw = 340, ph = 260;
	let left = clientX + 14;
	let top = clientY + 14;
	if (left + pw > window.innerWidth - 14) left = clientX - pw - 14;
	if (top + ph > window.innerHeight - 64) top = clientY - ph - 14;
	popup.style.left = Math.max(14, Math.min(window.innerWidth - pw - 14, left)) + 'px';
	popup.style.top = Math.max(52, Math.min(window.innerHeight - ph - 64, top)) + 'px';
	popup.style.display = 'block';
}

let describeTimer = null;
function openNodePopup(node, clientX, clientY) {
	if (!popup) return;
	if (node && node.kind === 'aggregate') {
		expandedTemporalGuideId = node.guideId;
		selectedNodeId = node.entityId;
		announceGraph((node.label || 'Community') + ', ' + (node.memberIds ? node.memberIds.length : 0) + ' files');
		if (popupTitle) popupTitle.textContent = node.label || 'Community';
		if (popupMeta) popupMeta.textContent = (node.memberIds ? node.memberIds.length : 0) + ' files — click again or zoom to inspect';
		placePopupNear(clientX, clientY);
		popup.style.display = 'block';
		dirty = true;
		drawTemporalFrame(performance.now());
		return;
	}
	popupNode = node;
	if (describeTimer) {
		clearTimeout(describeTimer);
		describeTimer = null;
	}

	selectedNodeId = node.entityId || node.id;
	kbdFocusIndex = -1;
	if (popupTitle) popupTitle.textContent = node.label || node.id;
	if (popupMeta) popupMeta.textContent = node.path || '';
	announceGraph(describeNodeForAnnouncement(node));

	const layer = (node.meta && node.meta.architectureLayer) ? node.meta.architectureLayer : 'other';
	if (popupLayerBadge) {
		popupLayerBadge.style.display = 'inline-block';
		popupLayerBadge.textContent = layer;
		popupLayerBadge.style.backgroundColor = getArchitectureLayerColor(layer);
	}

	if (popupChangeBadge) {
		if (node.changeKind) {
			popupChangeBadge.style.display = 'inline-block';
			popupChangeBadge.textContent = node.changeKind.toUpperCase();
			if (node.changeKind === 'added') {
				popupChangeBadge.style.background = 'rgba(63, 185, 80, 0.2)';
				popupChangeBadge.style.color = '#3fb950';
			} else if (node.changeKind === 'removed') {
				popupChangeBadge.style.background = 'rgba(248, 81, 73, 0.2)';
				popupChangeBadge.style.color = '#f85149';
			} else if (node.changeKind === 'modified') {
				popupChangeBadge.style.background = 'rgba(210, 153, 34, 0.2)';
				popupChangeBadge.style.color = '#d29922';
			} else if (node.changeKind === 'renamed') {
				popupChangeBadge.style.background = 'rgba(163, 113, 247, 0.2)';
				popupChangeBadge.style.color = '#a371f7';
			} else {
				popupChangeBadge.style.background = 'rgba(255, 255, 255, 0.08)';
				popupChangeBadge.style.color = '#a1a1aa';
			}
		} else {
			popupChangeBadge.style.display = 'none';
		}
	}

	if (popupDetailsList) {
		popupDetailsList.innerHTML = '';
		const rows = [
			{ label: 'Layer', value: layer.charAt(0).toUpperCase() + layer.slice(1) },
			{ label: 'Language', value: (node.meta && node.meta.language) ? node.meta.language : fileType(node.path || node.label).label },
			{ label: 'Exports', value: (node.meta && Array.isArray(node.meta.exports)) ? (node.meta.exports.length + ' symbols') : '0 symbols' },
			{ label: 'Imports', value: (node.meta && Array.isArray(node.meta.imports)) ? (node.meta.imports.length + ' dependencies') : '0 dependencies' }
		];
		if (node.meta && typeof node.meta.linesOfCode === 'number' && node.meta.linesOfCode > 0) {
			rows.push({ label: 'Lines of Code', value: node.meta.linesOfCode + ' lines' });
		}
		if (node.oldPath) {
			rows.push({ label: 'Old Path', value: node.oldPath });
		}

		for (let i = 0; i < rows.length; i++) {
			const r = rows[i];
			const div = document.createElement('div');
			div.className = 'detail-row';
			const lbl = document.createElement('span');
			lbl.className = 'detail-label';
			lbl.textContent = r.label;
			const val = document.createElement('span');
			val.className = 'detail-value';
			val.textContent = r.value;
			div.appendChild(lbl);
			div.appendChild(val);
			popupDetailsList.appendChild(div);
		}
	}

	if (popupAi) popupAi.textContent = '';
	if (popupAiWrap) {
		if (isTemporal()) {
			popupAiWrap.style.display = 'none';
		} else {
			popupAiWrap.style.display = 'block';
		}
	}

	if (isTemporal()) {
		const isChanged = Boolean(node.changeKind && node.changeKind !== 'unchanged');
		if (popupSourceDiff) {
			popupSourceDiff.style.display = isChanged ? 'inline-block' : 'none';
		}
		if (popupHistoricalView) {
			popupHistoricalView.style.display = 'inline-block';
			if (isChanged) {
				popupHistoricalView.classList.remove('primary');
			} else {
				popupHistoricalView.classList.add('primary');
			}
		}
		if (popupSetBase) popupSetBase.style.display = 'inline-block';
		if (popupOpen) popupOpen.style.display = 'none';
		if (popupMagnus) {
			popupMagnus.disabled = true;
			popupMagnus.title = 'Attach to Agents is available on the live codebase.';
		}

		const isHead = Boolean(temporalState && temporalState.renderedCommitSha && temporalState.pagedTimeline && temporalState.pagedTimeline[0] && temporalState.renderedCommitSha === temporalState.pagedTimeline[0].sha);
		if (isHead && node.changeKind !== 'removed') {
			if (popupReveal) {
				popupReveal.style.display = 'inline-block';
				popupReveal.textContent = 'Reveal Current File';
			}
		} else {
			if (popupReveal) popupReveal.style.display = 'none';
		}
	} else {
		if (popupSourceDiff) popupSourceDiff.style.display = 'none';
		if (popupHistoricalView) popupHistoricalView.style.display = 'none';
		if (popupSetBase) popupSetBase.style.display = 'none';
		if (popupOpen) popupOpen.style.display = 'inline-block';
		if (popupReveal) {
			popupReveal.style.display = 'inline-block';
			popupReveal.textContent = 'Reveal in Explorer';
		}
		if (popupMagnus) {
			popupMagnus.disabled = false;
			popupMagnus.title = 'Attach to Agents';
		}
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
				if (popupAi) popupAi.textContent = peek.description;
			} else {
				if (popupAi) popupAi.textContent = 'Generating AI description…';
				describeTimer = setTimeout(async () => {
					const desc = await request('describeNode', { nodeId: node.id });
					if (!popupNode || popupNode.id !== node.id) return;
					if (desc && desc.aiStatus === 'ready' && desc.aiDescription) {
						if (popupAi) popupAi.textContent = desc.aiDescription;
					} else {
						if (popupAi) popupAi.textContent = (desc && desc.aiMessage) || 'AI description unavailable.';
					}
				}, 60);
			}
		});
		dirty = true; drawNetworkFrame();
	}
}

function onPointerDown(e, host) {
	if (!e.isPrimary || (e.button !== 0 && e.button !== 1)) return;
	if (popup && popup.style.display !== 'none') {
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
	pointerDownNodeId = pointerDownNode ? (pointerDownNode.entityId || pointerDownNode.id) : null;
	nodeWasSelectedAtPointerDown = Boolean(
		pointerDownNode &&
		pointerDownNodeId &&
		selectedNodeId &&
		pointerDownNodeId === selectedNodeId
	);

	const wantPan = e.button === 1 || e.shiftKey || isTemporal();
	panning = wantPan;
	rotating = false;
	if (host) {
		// Acquire capture so drags continue when the pointer leaves the canvas
		// (window edges, overlays, other editors); released in onPointerUp.
		if (typeof host.setPointerCapture === 'function') {
			try { host.setPointerCapture(e.pointerId); } catch (err) { /* stale/invalid pointer id */ }
		}
		host.classList.add('dragging');
	}
	updateCanvasCursor();
	if (panning || (isNetwork() && keepGraphCentered)) {
		scheduleIdleResume();
	}
}

/**
 * Single source of truth for the canvas cursor, derived from the live interaction state.
 * Order: active manipulation > selectable/draggable node hover > background affordance.
 */
function updateCanvasCursor() {
	if (!netCanvas) return;
	if (dragging) {
		netCanvas.style.cursor = 'grabbing';
		return;
	}
	if (hoveredNodeId) {
		const isHoveredSelected = Boolean(selectedNodeId && hoveredNodeId === selectedNodeId && isNetwork());
		netCanvas.style.cursor = isHoveredSelected ? 'grab' : 'pointer';
		return;
	}
	netCanvas.style.cursor = (isNetwork() && !keepGraphCentered) ? 'grab' : 'default';
}

function onPointerUp(e, cancelled) {
	if (e.pointerId !== activePointerId) return;
	const pointerHost = activePointerHost;
	activePointerId = null;
	activePointerHost = null;
	if (pointerHost && typeof pointerHost.hasPointerCapture === 'function' && pointerHost.hasPointerCapture(e.pointerId)) {
		pointerHost.releasePointerCapture(e.pointerId);
	}
	const wasMoved = moved || cancelled;
	dragging = false; panning = false; rotating = false; draggingNode = false;
	interactionState = cancelled ? 'cancelled' : 'idle';
	pointerDownNode = null;
	pointerDownNodeId = null;
	nodeWasSelectedAtPointerDown = false;
	if (netCanvas) {
		netCanvas.classList.remove('dragging');
		netCanvas.classList.remove('panning');
		updateCanvasCursor();
	}

	const dist = e ? Math.hypot((e.clientX || 0) - pointerDownX, (e.clientY || 0) - pointerDownY) : 99;
	if (e && !wasMoved && dist <= dragThreshold) {
		if (isTemporal()) {
			const node = pickTemporalNode(e.clientX, e.clientY);
			if (node) {
				openNodePopup(node, e.clientX, e.clientY);
				return;
			}
			selectedNodeId = null;
			expandedTemporalGuideId = null;
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
	if (!dragging) {
		const node = isTemporal() ? pickTemporalNode(e.clientX, e.clientY) : pickNetworkNode(e.clientX, e.clientY);
		const newHoverId = node ? (node.entityId || node.id) : null;
		if (newHoverId !== hoveredNodeId) {
			hoveredNodeId = newHoverId;
			updateCanvasCursor();
			dirty = true;
			kickRaf();
		}
		return;
	}

	if (e.pointerId !== activePointerId) return;
	const dx = e.clientX - lastX, dy = e.clientY - lastY;
	const total = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
	if (total > dragThreshold) moved = true;

	if (interactionState === 'pressed' && !panning && isNetwork() && moved) {
		const nodeDragEligible = Boolean(pointerDownNode && nodeWasSelectedAtPointerDown && !panning);
		if (nodeDragEligible) {
			draggingNode = true;
			interactionState = 'draggingNode';
		} else {
			rotating = true;
			interactionState = 'rotating';
			scheduleIdleResume();
		}
	}
	lastX = e.clientX; lastY = e.clientY;

	if (draggingNode && pointerDownNode && isNetwork()) {
		const nodeId = pointerDownNode.entityId || pointerDownNode.id;
		const current = base3d[nodeId] || { x: 0, y: 0, z: 0 };
		const projectedNow = projected[nodeId] || { depthScale: 1 };
		const delta = mapPointerDeltaToNodeWorld(dx, dy, projectedNow.depthScale);
		base3d[nodeId] = {
			x: current.x + delta.x,
			y: current.y + delta.y,
			z: current.z + delta.z
		};
		projectAll();
		if (keepGraphCentered) {
			applyCenterLock(true);
		}
		dirty = true;
		kickRaf();
		return;
	}

	if (rotating && isNetwork()) {
		const mapped = mapPointerDeltaToGraphRotation(dx, dy);
		rotation.yaw = wrapRotationAngle(rotation.yaw + mapped.yaw);
		rotation.pitch = wrapRotationAngle(rotation.pitch + mapped.pitch);
		projectAll();
		if (keepGraphCentered) {
			applyCenterLock(true);
		}
		dirty = true;
		kickRaf();
		return;
	}

	if (!moved) return;
	if (!panning) return;
	if (keepGraphCentered) {
		// Panning is disabled while Keep Graph Centered is active
		return;
	}
	interactionState = 'panning';
	const panSens = (typeof settings.panSensitivity === 'number' && Number.isFinite(settings.panSensitivity) && settings.panSensitivity > 0)
		? settings.panSensitivity
		: 1.0;
	transform.x += dx * panSens;
	transform.y += dy * panSens;
	userAdjustedViewport = true;
	dirty = true;
	kickRaf();
}

function onWheel(e) {
	if (!netCanvas) return;
	e.preventDefault();
	scheduleIdleResume();
	cancelCameraAnimation();

	const normalizedDelta = normalizeWheelZoomDelta({
		deltaY: e.deltaY,
		deltaMode: e.deltaMode,
		ctrlKey: e.ctrlKey,
		sensitivity: settings.zoomSensitivity ?? 1.0
	});
	if (normalizedDelta === 0) return;

	const factor = computeContinuousZoomFactor(normalizedDelta);
	const rect = netCanvas.getBoundingClientRect();
	const mx = e.clientX - rect.left;
	const my = e.clientY - rect.top;

	if (keepGraphCentered) {
		const insets = getUsableInsets();
		transform = applyZoomAroundCenter(transform, factor, rect.width, rect.height, MIN_ZOOM, MAX_ZOOM, insets);
		applyCenterLock(true);
	} else {
		transform = applyZoomAroundCursor(transform, factor, mx, my, MIN_ZOOM, MAX_ZOOM);
	}

	userAdjustedViewport = true;
	dirty = true;
	kickRaf();
}

// 5. Message Dispatcher
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
		if (msg.payload.settings) {
			settings = msg.payload.settings;
			invalidateThemeColors();
			if (typeof settings.keepGraphCentered === 'boolean') {
				keepGraphCentered = settings.keepGraphCentered;
				syncCenterLockUI();
			}
		}
		if (msg.payload.graphType) graphType = msg.payload.graphType;
		if (msg.payload.temporalState) {
			temporalState = msg.payload.temporalState;
			temporalDiff = temporalState.diff || null;
			updateTemporalDiffTransition(temporalDiff);
		}
		render(false);
		announceSnapshotSummary();
	} else if (msg.type === 'settings') {
		settings = msg.payload;
		invalidateThemeColors();
		if (typeof settings.keepGraphCentered === 'boolean') {
			keepGraphCentered = settings.keepGraphCentered;
			syncCenterLockUI();
			if (keepGraphCentered) applyCenterLock(true);
		}
		dirty = true;
		kickRaf();
	} else if (msg.type === 'temporalState') {
		graphType = 'temporal';
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
		render(false);
	} else if (msg.type === 'fitView') {
		fitView(true);
	} else if (msg.type === 'resetView') {
		resetCamera(false);
		fitView(true);
	}
});

// 6. Attach Event Handlers Guarded
if (netCanvas) {
	netCanvas.addEventListener('pointerdown', function (e) { onPointerDown(e, netCanvas); });
	netCanvas.addEventListener('pointermove', onPointerMove);
	netCanvas.addEventListener('pointerup', function (e) { onPointerUp(e, false); });
	netCanvas.addEventListener('pointercancel', function (e) { onPointerUp(e, true); });
	netCanvas.addEventListener('lostpointercapture', function (e) { onPointerUp(e, true); });
	netCanvas.addEventListener('wheel', onWheel, { passive: false });

	// Editor/window losing focus mid-drag must not leave a stuck grabbing state.
	window.addEventListener('blur', function () {
		if (activePointerId !== null) {
			onPointerUp({ pointerId: activePointerId }, true);
		}
	});

	netCanvas.addEventListener('dblclick', function (e) {
		if (isTemporal()) {
			const node = pickTemporalNode(e.clientX, e.clientY);
			if (node) request('openTemporalSourceDiff', { entityId: node.entityId });
		} else {
			const node = pickNetworkNode(e.clientX, e.clientY);
			if (node) request('openFile', { path: node.path || node.id.replace(/^file:/, '') });
		}
	});
}

const popupCloseBtn = document.getElementById('popupClose');
if (popupCloseBtn) popupCloseBtn.onclick = function () { closePopup(); };

if (popupOpen) {
	popupOpen.onclick = function () {
		if (popupNode) request('openFile', { path: popupNode.path || popupNode.id.replace(/^file:/, '') });
	};
}
if (popupHistoricalView) {
	popupHistoricalView.onclick = function () {
		if (popupNode && popupNode.entityId) request('openTemporalHistoricalFile', { entityId: popupNode.entityId });
	};
}
if (popupSourceDiff) {
	popupSourceDiff.onclick = function () {
		if (popupNode && popupNode.entityId) request('openTemporalSourceDiff', { entityId: popupNode.entityId });
	};
}
if (popupSetBase) {
	popupSetBase.onclick = function () {
		const baseSha = (temporalDiff && temporalDiff.targetCommitSha) || (temporalState && temporalState.renderedCommitSha);
		if (baseSha) {
			request('setTemporalCompareBase', { compareBaseSha: baseSha });
		}
	};
}
if (popupReveal) {
	popupReveal.onclick = function () {
		if (popupNode) request('revealFile', { path: popupNode.path || popupNode.id.replace(/^file:/, '') });
	};
}
if (popupMagnus) {
	popupMagnus.onclick = function () { request('attachToMagnus', {}); };
}

if (temporalRepoSelect) {
	temporalRepoSelect.addEventListener('change', function () {
		const repoRoot = temporalRepoSelect.value;
		if (repoRoot) request('switchTemporalRepository', { repoRoot: repoRoot });
	});
}
if (temporalRefSelect) {
	temporalRefSelect.addEventListener('change', function () {
		const ref = temporalRefSelect.value;
		if (ref) request('selectTemporalRef', { ref: ref });
	});
}
if (temporalCompareSelect) {
	temporalCompareSelect.addEventListener('change', function () {
		const base = temporalCompareSelect.value;
		if (base === '__prompt_custom__') {
			request('pickTemporalCompareBase', {});
			updateTemporalUI(temporalState, temporalDiff);
		} else if (base === '__clear_custom__') {
			request('setTemporalCompareBase', { compareBaseSha: undefined });
		} else {
			request('setTemporalCompareBase', { compareBaseSha: base || undefined });
		}
	});
}
if (temporalModeChangesBtn) {
	temporalModeChangesBtn.addEventListener('click', function () {
		request('setTemporalDisplayMode', { mode: 'changes' });
	});
}
if (temporalModeStateBtn) {
	temporalModeStateBtn.addEventListener('click', function () {
		if (popupNode && popupNode.changeKind === 'removed') {
			closePopup();
			selectedNodeId = null;
			request('selectTemporalEntity', { entityId: null });
		}
		request('setTemporalDisplayMode', { mode: 'state' });
	});
}
if (temporalContextFocusedBtn) {
	temporalContextFocusedBtn.addEventListener('click', function () {
		temporalContextFilterMode = 'focused';
		if (temporalState) updateTemporalUI(temporalState, temporalDiff);
		fitView();
		dirty = true;
		kickRaf();
	});
}
if (temporalContextFullBtn) {
	temporalContextFullBtn.addEventListener('click', function () {
		temporalContextFilterMode = 'full';
		if (temporalState) updateTemporalUI(temporalState, temporalDiff);
		fitView();
		dirty = true;
		kickRaf();
	});
}
function syncDetailsToggleLabel(isVisible) {
	if (!temporalToggleDetailsBtn) return;
	temporalToggleDetailsBtn.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
}
if (temporalToggleDetailsBtn) {
	syncDetailsToggleLabel(false);
	temporalToggleDetailsBtn.addEventListener('click', function () {
		if (temporalDetailsPanel) {
			const isVisible = temporalDetailsPanel.style.display === 'flex';
			temporalDetailsPanel.style.display = isVisible ? 'none' : 'flex';
			syncDetailsToggleLabel(!isVisible);
		}
	});
}
if (temporalDetailsClose && temporalDetailsPanel) {
	temporalDetailsClose.addEventListener('click', function () {
		temporalDetailsPanel.style.display = 'none';
		syncDetailsToggleLabel(false);
	});
}
if (noChangesViewSource) {
	noChangesViewSource.addEventListener('click', function () {
		const targetSha = (temporalDiff && temporalDiff.targetCommitSha) || (temporalState && temporalState.renderedCommitSha);
		if (targetSha) {
			request('openCommitChanges', { commitSha: targetSha });
		}
	});
}
if (temporalScrubber) {
	temporalScrubber.addEventListener('input', function () {
		const val = parseInt(temporalScrubber.value, 10);
		const total = (temporalState && temporalState.loadedCommitCount) || 0;
		if (total > 0) {
			const targetGlobalIdx = (total - 1) - val;
			request('selectTemporalCommitIndex', { index: targetGlobalIdx, immediate: false });
		}
	});
	temporalScrubber.addEventListener('change', function () {
		const val = parseInt(temporalScrubber.value, 10);
		const total = (temporalState && temporalState.loadedCommitCount) || 0;
		if (total > 0) {
			const targetGlobalIdx = (total - 1) - val;
			request('selectTemporalCommitIndex', { index: targetGlobalIdx, immediate: true });
		}
	});
}
if (temporalPrevBtn) temporalPrevBtn.addEventListener('click', function () { stepTemporalCommit(-1); });
if (temporalNextBtn) temporalNextBtn.addEventListener('click', function () { stepTemporalCommit(1); });
if (temporalPlayBtn) temporalPlayBtn.addEventListener('click', toggleTemporalPlay);
if (temporalLoadMoreBtn) temporalLoadMoreBtn.addEventListener('click', function () { request('loadMoreTemporalHistory', {}); });

let filterDebounceTimer = null;
if (temporalFilterInput) {
	temporalFilterInput.addEventListener('input', function () {
		dirty = true;
		kickRaf();
		if (filterDebounceTimer) clearTimeout(filterDebounceTimer);
		filterDebounceTimer = setTimeout(function () {
			request('setTemporalFilter', { filter: temporalFilterInput.value || '' });
		}, 200);
	});
}
if (temporalFollowHead) {
	temporalFollowHead.addEventListener('change', function () {
		request('setTemporalFollowHead', { follow: temporalFollowHead.checked });
	});
}
const temporalLegendBtn = document.getElementById('temporalLegendBtn');
if (temporalLegendBtn) {
	temporalLegendBtn.addEventListener('click', function () {
		if (legend) {
			const isVis = legend.style.display === 'block';
			legend.style.display = isVis ? 'none' : 'block';
		}
	});
}

// ── Accessibility: live announcements, keyboard graph navigation, help toggle ──
const graphLiveRegion = document.getElementById('graphLiveRegion');
let announceTimer = null;
function announceGraph(text) {
	if (!graphLiveRegion) return;
	// Clear-then-set forces screen readers to re-announce identical strings.
	graphLiveRegion.textContent = '';
	if (announceTimer) clearTimeout(announceTimer);
	announceTimer = setTimeout(function () {
		if (graphLiveRegion) graphLiveRegion.textContent = text;
	}, 60);
}

function describeNodeForAnnouncement(node) {
	if (!node) return 'No node selected';
	const id = node.entityId || node.id;
	const label = node.label || id;
	const path = node.path ? (', path ' + node.path) : '';
	let change = '';
	if (node.changeKind && node.changeKind !== 'unchanged') change = ', ' + node.changeKind;
	return label + path + change;
}

// Keyboard focus order over the currently visible nodes.
let kbdFocusIndex = -1;

function visibleNodesForNavigation() {
	if (isTemporal()) {
		const visible = computeTemporalVisibleElements(temporalDiff, displayMode, temporalContextFilterMode);
		return visible.nodes || [];
	}
	return (snapshot && snapshot.nodes) || [];
}

function centerOnNode(nodeId) {
	if (!netCanvas || !nodeId) return;
	const w = netCanvas.clientWidth || 800;
	const h = netCanvas.clientHeight || 600;
	const insets = getUsableInsets();
	let wx = null, wy = null;
	if (isTemporal()) {
		const n = currentTemporalRenderNodes.get(nodeId);
		if (n) { wx = n.x || 0; wy = n.y || 0; }
	} else {
		const p = projected[nodeId];
		if (p) { wx = p.x; wy = p.y; }
	}
	if (wx === null) return;
	const target = { x: w / 2 - wx * transform.k + (insets.left - insets.right) / 2, y: h / 2 - wy * transform.k + (insets.top - insets.bottom) / 2, k: transform.k };
	cancelCameraAnimation();
	transform = target;
	dirty = true;
	kickRaf();
}

function moveKbdFocus(delta) {
	const nodes = visibleNodesForNavigation();
	if (!nodes.length) {
		announceGraph(isTemporal() ? 'No temporal changes to navigate' : 'Graph is empty');
		return;
	}
	kbdFocusIndex = Math.max(0, Math.min(nodes.length - 1, (kbdFocusIndex < 0 ? (delta > 0 ? 0 : nodes.length - 1) : kbdFocusIndex + delta)));
	const node = nodes[kbdFocusIndex];
	if (!node) return;
	hoveredNodeId = node.entityId || node.id;
	centerOnNode(hoveredNodeId);
	dirty = true;
	kickRaf();
	announceGraph(describeNodeForAnnouncement(node) + (kbdFocusIndex + 1) + ' of ' + nodes.length);
}

function activateKbdFocus() {
	if (kbdFocusIndex < 0) return;
	const nodes = visibleNodesForNavigation();
	const node = nodes[kbdFocusIndex];
	if (!node) return;
	openNodePopup(node, window.innerWidth / 2, window.innerHeight / 2);
	dirty = true;
	kickRaf();
	if (netCanvas) netCanvas.focus();
	announceGraph('Opened details for ' + describeNodeForAnnouncement(node));
}

function clearGraphSelection(fromKey) {
	closePopup();
	selectedNodeId = null;
	hoveredNodeId = null;
	kbdFocusIndex = -1;
	if (isTemporal()) {
		request('selectTemporalEntity', { entityId: null });
	} else {
		request('selectNode', { nodeId: null });
	}
	dirty = true;
	kickRaf();
	if (fromKey && netCanvas) netCanvas.focus();
}

function zoomByFactor(factor) {
	if (!netCanvas) return;
	cancelCameraAnimation();
	const w = netCanvas.clientWidth || 800;
	const h = netCanvas.clientHeight || 600;
	const insets = getUsableInsets();
	const target = keepGraphCentered
		? applyZoomAroundCenter(transform, factor, w, h, MIN_ZOOM, MAX_ZOOM, insets)
		: applyZoomAroundCenter(transform, factor, w, h, MIN_ZOOM, MAX_ZOOM);
	if (settings.reduceMotion) {
		transform = target;
		dirty = true;
		kickRaf();
	} else {
		animateViewportTo(target, 160);
	}
	userAdjustedViewport = true;
}

function toggleGraphHelp() {
	const helpEl = document.getElementById('graphKbdHelp');
	if (helpEl) helpEl.hidden = !helpEl.hidden;
}

window.addEventListener('keydown', function (e) {
	const targetTag = (e.target && e.target.tagName) || '';
	const isTextInput = targetTag === 'INPUT' || targetTag === 'SELECT' || targetTag === 'TEXTAREA' || targetTag === 'BUTTON' || (e.target && e.target.isContentEditable);

	// Escape works everywhere except while typing in inputs (first Escape exits the field).
	if (e.key === 'Escape') {
		if (popup && popup.style && popup.style.display && popup.style.display !== 'none') {
			clearGraphSelection(true);
			e.preventDefault();
			return;
		}
		const helpEl = document.getElementById('graphKbdHelp');
		if (helpEl && !helpEl.hidden) { helpEl.hidden = true; e.preventDefault(); return; }
		if (!isTextInput) clearGraphSelection(true);
		return;
	}
	if (isTextInput) return;

	const canvasFocused = document.activeElement === netCanvas;
	// Keep F1 and Alt/Option+F1 available to VS Code Accessibility Help.
	if (((e.key === '/' && e.shiftKey) || e.key === '?') && canvasFocused) {
		toggleGraphHelp();
		e.preventDefault();
		return;
	}
	if (!canvasFocused) {
		// Temporal commit navigation stays available globally (no canvas focus
		// required); node traversal below applies once the canvas is focused.
		if (isTemporal()) {
			if (e.key === 'ArrowLeft') { e.preventDefault(); stepTemporalCommit(-1); }
			else if (e.key === 'ArrowRight') { e.preventDefault(); stepTemporalCommit(1); }
			else if (e.key === ' ') { e.preventDefault(); toggleTemporalPlay(); }
		}
		return;
	}

	switch (e.key) {
		case 'ArrowRight':
		case 'ArrowDown':
			e.preventDefault(); moveKbdFocus(1); break;
		case 'ArrowLeft':
		case 'ArrowUp':
			e.preventDefault(); moveKbdFocus(-1); break;
		case 'Enter':
		case ' ':
			e.preventDefault(); activateKbdFocus(); break;
		case '+':
		case '=':
			e.preventDefault(); zoomByFactor(1.25); break;
		case '-':
		case '_':
			e.preventDefault(); zoomByFactor(0.8); break;
		case '0':
		case 'f':
		case 'F':
			e.preventDefault();
			cancelCameraAnimation();
			userAdjustedViewport = false;
			fitView(!settings.reduceMotion);
			announceGraph('Fit view');
			break;
		case 'r':
		case 'R':
			e.preventDefault();
			cancelCameraAnimation();
			userAdjustedViewport = false;
			resetCamera(false);
			fitView(true);
			announceGraph('View reset');
			break;
		case 'c':
		case 'C':
			e.preventDefault();
			if (centerLockBtn) centerLockBtn.click();
			else if (temporalCenterLockBtn) temporalCenterLockBtn.click();
			announceGraph(keepGraphCentered ? 'Keep centered on' : 'Keep centered off');
			break;
		default:
			break;
	}
});

// System reduced-motion changes take effect without a reload.
if (window.matchMedia) {
	try {
		const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		const motionListener = function () { dirty = true; kickRaf(); };
		if (typeof motionQuery.addEventListener === 'function') {
			motionQuery.addEventListener('change', motionListener);
		} else if (typeof motionQuery.addListener === 'function') {
			motionQuery.addListener(motionListener);
		}
	} catch (err) { /* older matchMedia implementations */ }
}

// Announce snapshot arrival so screen readers describe what was loaded.
function announceSnapshotSummary() {
	if (isTemporal()) {
		const count = temporalDiff && temporalDiff.nodes ? temporalDiff.nodes.length : 0;
		const changed = temporalDiff && temporalDiff.summary ? (temporalDiff.summary.addedCount + temporalDiff.summary.removedCount + temporalDiff.summary.modifiedCount + temporalDiff.summary.renamedCount) : 0;
		announceGraph('Temporal graph: ' + count + ' entities, ' + changed + ' changed.');
	} else if (snapshot) {
		announceGraph('Code graph: ' + snapshot.nodes.length + ' files, ' + ((snapshot.edges || []).length) + ' connections.');
	}
}

if (centerLockBtn) {
	centerLockBtn.onclick = function () {
		cancelCameraAnimation();
		keepGraphCentered = !keepGraphCentered;
		settings.keepGraphCentered = keepGraphCentered;
		syncCenterLockUI();
		request('updateSetting', { key: 'prebase.interaction.keepGraphCentered', value: keepGraphCentered });
		if (keepGraphCentered) {
			applyCenterLock(true);
		}
	};
}

if (temporalCenterLockBtn) {
	temporalCenterLockBtn.onclick = function () {
		cancelCameraAnimation();
		keepGraphCentered = !keepGraphCentered;
		settings.keepGraphCentered = keepGraphCentered;
		syncCenterLockUI();
		request('updateSetting', { key: 'prebase.interaction.keepGraphCentered', value: keepGraphCentered });
		if (keepGraphCentered) {
			applyCenterLock(true);
		}
	};
}

if (temporalFitBtn) {
	temporalFitBtn.onclick = function () {
		cancelCameraAnimation();
		userAdjustedViewport = false;
		fitView(true);
		announceGraph('Fit view');
	};
}

if (temporalZoomInBtn) {
	temporalZoomInBtn.onclick = function () { zoomByFactor(1.25); };
}

if (temporalZoomOutBtn) {
	temporalZoomOutBtn.onclick = function () { zoomByFactor(0.8); };
}

if (temporalResetBtn) {
	temporalResetBtn.onclick = function () {
		cancelCameraAnimation();
		userAdjustedViewport = false;
		resetCamera(false);
		fitView(true);
		announceGraph('View reset');
	};
}

if (temporalHelpBtn) {
	temporalHelpBtn.onclick = toggleGraphHelp;
}
if (graphHelpBtn) {
	graphHelpBtn.onclick = toggleGraphHelp;
}

if (temporalRetryBtn) {
	temporalRetryBtn.onclick = function () {
		request('retryTemporalSelection');
	};
}

const zoomInBtn = document.getElementById('zoomIn');
if (zoomInBtn) {
	zoomInBtn.onclick = function () { zoomByFactor(1.25); };
}

const zoomOutBtn = document.getElementById('zoomOut');
if (zoomOutBtn) {
	zoomOutBtn.onclick = function () { zoomByFactor(0.8); };
}

const fitBtn = document.getElementById('fit');
if (fitBtn) {
	fitBtn.onclick = function () {
		cancelCameraAnimation();
		userAdjustedViewport = false;
		fitView(true);
	};
}

const resetBtn = document.getElementById('reset');
if (resetBtn) {
	resetBtn.onclick = function () {
		cancelCameraAnimation();
		userAdjustedViewport = false;
		resetCamera(false);
		fitView(true);
	};
}

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

	if (keepGraphCentered) {
		applyCenterLock(true);
	}

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

function rafLoop(ts) {
	rafScheduled = false;
	if (typeof document !== 'undefined' && document.hidden) {
		return;
	}
	const dt = Math.min(0.05, Math.max(0, (ts - (lastRafTs || ts)) / 1000));
	lastRafTs = ts;

	if (activeCameraAnim) {
		const elapsed = ts - activeCameraAnim.startTs;
		const progress = Math.min(1.0, elapsed / activeCameraAnim.duration);
		transform = interpolateViewport(activeCameraAnim.from, activeCameraAnim.to, progress);
		if (elapsed >= activeCameraAnim.duration) {
			activeCameraAnim = null;
			// Snap to exact final transform so easing residual never leaves the
			// camera a fraction of a pixel off target.
			dirty = true;
			if (keepGraphCentered && !isTemporal()) applyCenterLock(true);
		}
		dirty = true;
	}

	if (isTemporal()) {
		if (dirty || isAnimatingTemporal || activeCameraAnim) {
			drawTemporalFrame(ts);
			dirty = false;
		}
		if (isAnimatingTemporal || activeCameraAnim) kickRaf();
	} else {
		const animating = canIdleRotate() && !idlePaused;
		if (animating) {
			rotation.yaw += IDLE_YAW * dt;
			if (keepGraphCentered) {
				projectAll();
				applyCenterLock(true);
			}
			dirty = true;
		}
		if (dirty && isNetwork() && snapshot) drawNetworkFrame();
		if (animating || activeCameraAnim || isAnimatingTemporal) kickRaf();
	}
}
kickRaf();

// 7. Initial State Fetch
request('getSnapshot').then(function (res) {
	if (!res) return;
	snapshot = res.snapshot;
	diagnostics = res.diagnostics;
	selectedNodeId = res.selectedNodeId || null;
	if (res.settings) {
		settings = res.settings;
		if (typeof settings.keepGraphCentered === 'boolean') {
			keepGraphCentered = settings.keepGraphCentered;
			syncCenterLockUI();
		}
	}
	if (res.graphType) {
		graphType = res.graphType;
	} else if (initialGraphType) {
		graphType = initialGraphType;
	}
	if (res.temporalState) {
		temporalState = res.temporalState;
		temporalDiff = temporalState.diff || null;
		if (temporalDiff) updateTemporalDiffTransition(temporalDiff);
	}
	render(true);
	if (isTemporal()) {
		fitView(false);
	} else {
		resetCamera(false);
		fitView(false);
		scheduleIdleResume();
	}
	announceSnapshotSummary();
}).catch(function (err) {
	console.warn('[PreBase Graph] Initial getSnapshot failed:', err);
});

// 8. Startup Watchdog: If renderer remains uninitialized after 4s, provide interactive diagnostic/retry
setTimeout(function () {
	if (!snapshot && (!temporalState || !temporalDiff)) {
		if (empty && empty.textContent === 'Preparing graph…') {
			empty.innerHTML = '<div style="padding:16px;"><div>Graph renderer failed to initialize.</div><button id="retryWatchdogBtn" style="margin-top:10px; padding:4px 12px; border-radius:4px; background:var(--vscode-button-background, #2dd4bf); color:var(--vscode-button-foreground, #1B1C1E); border:none; cursor:pointer; font-weight:600;">Retry</button></div>';
			const btn = document.getElementById('retryWatchdogBtn');
			if (btn) {
				btn.onclick = function () {
					empty.textContent = 'Preparing graph…';
					request('ready', { generation: currentGeneration, graphType: initialGraphType });
					request('getSnapshot').then(function (res) {
						if (!res) return;
						snapshot = res.snapshot;
						diagnostics = res.diagnostics;
						if (res.graphType) graphType = res.graphType;
						render(true);
					});
				};
			}
		}
	}
}, 4000);
</script>
</body>
</html>`;
	}
}

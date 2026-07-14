/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IOutputService } from '../../../services/output/common/output.js';
import { match as matchGlob } from '../../../../base/common/glob.js';
import { PreBaseConfigKeys, PREBASE_GRAPH_CHANNEL_ID } from '../common/prebaseConfiguration.js';
import { detectEntryNodeId } from '../common/graph/entryDetector.js';
import { GraphGenerator } from '../common/graph/graphGenerator.js';
import { DEFAULT_IGNORE_PATTERNS } from '../common/graph/ignorePatterns.js';
import { extractImportsForFile, extractPackageName } from '../common/graph/importExtractors.js';
import { LayoutEngine } from '../common/graph/layoutEngine.js';
import {
	computeNetworkSphereRadius,
	layoutNetworkGraph,
	type NetworkLayoutMode,
} from '../common/graph/networkLayout.js';
import { getFileTypeInfo } from '../common/graph/fileTypeColors.js';
import {
	assignLayersToNodes,
	computeNodeImportance,
	filterNodesForArchitectureMode
} from '../common/graph/architectureLayers.js';
import {
	getHierarchyRingBandsForSnapshot,
	getPyramidDepthBands,
	type HierarchyRingBand,
	type PyramidDepthBand
} from '../common/graph/hierarchyLayout.js';
import { isGraphRelevantFile } from '../common/graph/projectFiles.js';
import { basename, normalizePath } from '../common/graph/paths.js';
import type { GraphEdge, GraphNode, GraphSnapshot, LayoutMode, ParseResult, ScannedFile } from '../common/graph/types.js';
import { depthLevelColor } from '../common/graph/layoutDepthColors.js';

export type PreBaseGraphType = 'architecture' | 'network';

export interface PreBaseGraphViewState {
	graphType: PreBaseGraphType;
	layoutMode: LayoutMode;
}

export interface PreBaseEnrichedSnapshot extends GraphSnapshot {
	graphType: PreBaseGraphType;
	layoutMode: LayoutMode;
	networkLayoutMode?: NetworkLayoutMode;
	ringBands: Array<HierarchyRingBand & { color: string }>;
	pyramidBands: Array<PyramidDepthBand & { color: string }>;
	diagnostics: PreBaseGraphDiagnostics;
}

export interface PreBaseGraphDiagnostics {
	fileCount: number;
	nodeCount: number;
	edgeCount: number;
	entryNodeId: string | null;
	scannedAt: number | null;
	status: 'idle' | 'scanning' | 'ready' | 'error' | 'cancelled';
	message?: string;
}

export const IPreBaseGraphService = createDecorator<IPreBaseGraphService>('prebaseGraphService');

export type PreBaseGraphCameraAction = 'reset' | 'fit';

export interface IPreBaseGraphService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeSnapshot: Event<PreBaseEnrichedSnapshot | undefined>;
	readonly onDidChangeViewState: Event<PreBaseGraphViewState>;
	readonly onDidChangeDiagnostics: Event<PreBaseGraphDiagnostics>;
	readonly onDidRequestCameraAction: Event<PreBaseGraphCameraAction>;

	getSnapshot(): PreBaseEnrichedSnapshot | undefined;
	getViewState(): PreBaseGraphViewState;
	getDiagnostics(): PreBaseGraphDiagnostics;

	scanWorkspace(token?: CancellationToken): Promise<PreBaseEnrichedSnapshot | undefined>;
	rescanWorkspace(token?: CancellationToken): Promise<PreBaseEnrichedSnapshot | undefined>;
	cancelScan(): void;
	clearCache(): void;

	setGraphType(graphType: PreBaseGraphType): Promise<void>;
	setLayoutMode(layoutMode: LayoutMode): Promise<void>;
	relayout(): Promise<PreBaseEnrichedSnapshot | undefined>;

	getSelectedNodeId(): string | undefined;
	setSelectedNodeId(nodeId: string | undefined): void;
	getSelectionSummaryForMagnus(): string | undefined;

	requestResetView(): void;
	requestFitView(): void;
}

export class PreBaseGraphService extends Disposable implements IPreBaseGraphService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSnapshot = this._register(new Emitter<PreBaseEnrichedSnapshot | undefined>());
	readonly onDidChangeSnapshot = this._onDidChangeSnapshot.event;

	private readonly _onDidChangeViewState = this._register(new Emitter<PreBaseGraphViewState>());
	readonly onDidChangeViewState = this._onDidChangeViewState.event;

	private readonly _onDidChangeDiagnostics = this._register(new Emitter<PreBaseGraphDiagnostics>());
	readonly onDidChangeDiagnostics = this._onDidChangeDiagnostics.event;

	private readonly _onDidRequestCameraAction = this._register(new Emitter<PreBaseGraphCameraAction>());
	readonly onDidRequestCameraAction = this._onDidRequestCameraAction.event;

	private _snapshot: PreBaseEnrichedSnapshot | undefined;
	private _rawSnapshot: GraphSnapshot | undefined;
	private _scanCts: CancellationTokenSource | undefined;
	private _selectedNodeId: string | undefined;
	private _viewState: PreBaseGraphViewState;
	private _diagnostics: PreBaseGraphDiagnostics = {
		fileCount: 0,
		nodeCount: 0,
		edgeCount: 0,
		entryNodeId: null,
		scannedAt: null,
		status: 'idle'
	};

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IOutputService private readonly outputService: IOutputService,
	) {
		super();
		this._viewState = {
			graphType: this.configurationService.getValue<PreBaseGraphType>(PreBaseConfigKeys.GraphDefaultType) || 'architecture',
			layoutMode: this.configurationService.getValue<LayoutMode>(PreBaseConfigKeys.GraphDefaultArchitectureLayout) || 'hierarchy'
		};
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(PreBaseConfigKeys.GraphHideLowImportance) ||
				e.affectsConfiguration(PreBaseConfigKeys.GraphMaxRenderedNodes) ||
				e.affectsConfiguration(PreBaseConfigKeys.GraphMaxRenderedEdges) ||
				e.affectsConfiguration(PreBaseConfigKeys.GraphArchitectureMode)
			) {
				if (this._rawSnapshot) {
					const enriched = this._enrich(this._rawSnapshot, this._diagnostics.fileCount);
					this._snapshot = enriched;
					this._onDidChangeSnapshot.fire(enriched);
					this._setDiagnostics(enriched.diagnostics);
				}
			} else if (
				e.affectsConfiguration(PreBaseConfigKeys.GraphNetworkForceStrength) ||
				e.affectsConfiguration(PreBaseConfigKeys.GraphNetworkLinkDistance) ||
				e.affectsConfiguration(PreBaseConfigKeys.GraphNetworkAlphaDecay) ||
				e.affectsConfiguration(PreBaseConfigKeys.GraphNetworkLayoutMode) ||
				e.affectsConfiguration(PreBaseConfigKeys.GraphNetworkSpreadScale)
			) {
				if (this._viewState.graphType === 'network' && this._rawSnapshot) {
					void this.relayout();
				}
			}
		}));
	}

	getSnapshot(): PreBaseEnrichedSnapshot | undefined {
		return this._snapshot;
	}

	getViewState(): PreBaseGraphViewState {
		return this._viewState;
	}

	getDiagnostics(): PreBaseGraphDiagnostics {
		return this._diagnostics;
	}

	getSelectedNodeId(): string | undefined {
		return this._selectedNodeId;
	}

	setSelectedNodeId(nodeId: string | undefined): void {
		if (this._selectedNodeId === nodeId) {
			return;
		}
		this._selectedNodeId = nodeId;
		if (this._snapshot) {
			this._onDidChangeSnapshot.fire(this._snapshot);
		}
	}

	requestResetView(): void {
		this._onDidRequestCameraAction.fire('reset');
	}

	requestFitView(): void {
		this._onDidRequestCameraAction.fire('fit');
	}

	getSelectionSummaryForMagnus(): string | undefined {
		if (!this._snapshot || !this._selectedNodeId) {
			return undefined;
		}
		const node = this._snapshot.nodes.find(n => n.id === this._selectedNodeId);
		if (!node) {
			return undefined;
		}
		const edges = this._snapshot.edges.filter(e => e.source === node.id || e.target === node.id);
		return [
			`Graph type: ${this._snapshot.graphType}`,
			`Layout: ${this._snapshot.layoutMode}`,
			`Selected node: ${node.label || node.id}`,
			`Path: ${node.path || node.id}`,
			`Kind: ${node.kind}`,
			`Connected edges: ${edges.length}`,
		].join('\n');
	}

	override dispose(): void {
		this.cancelScan();
		super.dispose();
	}

	cancelScan(): void {
		const cts = this._scanCts;
		if (!cts) {
			return;
		}
		cts.cancel();
		cts.dispose();
		this._scanCts = undefined;
		this._setDiagnostics({ status: 'cancelled', message: localize('prebase.graph.scanCancelled', "Scan cancelled.") });
	}

	clearCache(): void {
		this._snapshot = undefined;
		this._rawSnapshot = undefined;
		this._onDidChangeSnapshot.fire(undefined);
		this._setDiagnostics({
			fileCount: 0,
			nodeCount: 0,
			edgeCount: 0,
			entryNodeId: null,
			scannedAt: null,
			status: 'idle',
			message: localize('prebase.graph.cacheCleared', "Graph cache cleared.")
		});
		this._log(localize('prebase.graph.logCacheCleared', "Cleared graph cache."));
	}

	async setGraphType(graphType: PreBaseGraphType): Promise<void> {
		if (this._viewState.graphType === graphType) {
			return;
		}
		const previous = this._viewState.graphType;
		this._viewState = { ...this._viewState, graphType };
		this._onDidChangeViewState.fire(this._viewState);
		if (!this._rawSnapshot) {
			return;
		}
		// Network uses a different layout; architecture can re-enrich in place.
		if (previous === 'network' || graphType === 'network') {
			void this.relayout();
			return;
		}
		const enriched = this._enrich(this._rawSnapshot, this._diagnostics.fileCount);
		this._snapshot = enriched;
		this._onDidChangeSnapshot.fire(enriched);
		this._setDiagnostics(enriched.diagnostics);
	}

	async setLayoutMode(layoutMode: LayoutMode): Promise<void> {
		if (this._viewState.layoutMode === layoutMode) {
			return;
		}
		this._viewState = { ...this._viewState, layoutMode };
		this._onDidChangeViewState.fire(this._viewState);
		if (this._rawSnapshot) {
			void this.relayout();
		}
	}

	async rescanWorkspace(token?: CancellationToken): Promise<PreBaseEnrichedSnapshot | undefined> {
		this.clearCache();
		return this.scanWorkspace(token);
	}

	async scanWorkspace(token?: CancellationToken): Promise<PreBaseEnrichedSnapshot | undefined> {
		// Cancel any in-flight scan without marking the UI cancelled (a newer scan is starting).
		if (this._scanCts) {
			this._scanCts.cancel();
			this._scanCts.dispose();
			this._scanCts = undefined;
		}
		const cts = new CancellationTokenSource(token);
		this._scanCts = cts;
		this._setDiagnostics({ status: 'scanning', message: localize('prebase.graph.scanning', "Scanning workspace…") });
		this._log(localize('prebase.graph.logScanStart', "Starting workspace scan…"));

		try {
			const folder = this.workspaceService.getWorkspace().folders[0];
			if (!folder) {
				if (this._isActiveScan(cts)) {
					this._setDiagnostics({ status: 'error', message: localize('prebase.graph.noFolder', "Open a folder to scan.") });
				}
				return undefined;
			}

			const projectPath = folder.uri.fsPath || folder.uri.path;
			const projectName = basename(projectPath) || folder.name;
			const limits = this._scanLimits();
			const files = await this._collectFiles(folder.uri, cts.token, limits.maxScanFiles);
			if (cts.token.isCancellationRequested) {
				this._markCancelledIfActive(cts);
				return undefined;
			}

			this._setDiagnostics({
				fileCount: files.length,
				status: 'scanning',
				message: localize('prebase.graph.parsing', "Parsing {0} files…", files.length)
			});
			this._log(localize('prebase.graph.logFiles', "Found {0} relevant files (cap {1}).", files.length, limits.maxScanFiles));
			const results = await this._parseFiles(files, cts.token);
			if (cts.token.isCancellationRequested) {
				this._markCancelledIfActive(cts);
				return undefined;
			}

			await timeout(0);
			const generator = new GraphGenerator({ includeFolders: false, includeFunctions: false });
			const partial = generator.buildFromParseResults(projectPath, projectName, results);
			const packageMain = await this._readPackageMain(folder.uri);
			if (cts.token.isCancellationRequested) {
				this._markCancelledIfActive(cts);
				return undefined;
			}

			const entryNodeId = detectEntryNodeId(projectPath, partial.nodes, partial.edges, packageMain);
			const layeredNodes = assignLayersToNodes(partial.nodes, entryNodeId);
			const layoutNodes = this._pickLayoutNodes(layeredNodes, partial.edges, entryNodeId, limits.maxLayoutNodes);
			const layoutNodeIds = new Set(layoutNodes.map(n => n.id));
			const layoutEdges = partial.edges.filter(e => layoutNodeIds.has(e.source) && layoutNodeIds.has(e.target));

			this._setDiagnostics({
				fileCount: files.length,
				nodeCount: layoutNodes.length,
				edgeCount: layoutEdges.length,
				status: 'scanning',
				message: localize('prebase.graph.layingOut', "Computing layout for {0} nodes…", layoutNodes.length)
			});
			await timeout(0);

			const layoutMode = this._viewState.layoutMode;
			let positions: GraphSnapshot['positions'];
			let positions3d: GraphSnapshot['positions3d'] | undefined;
			let networkLayoutMode: NetworkLayoutMode | undefined;

			if (this._viewState.graphType === 'network') {
				networkLayoutMode = this._getNetworkLayoutMode();
				const computed = this._computeNetworkPositions(layoutNodes, layoutEdges, networkLayoutMode);
				positions = computed.positions2d;
				positions3d = computed.positions3d;
			} else {
				const layoutEngine = new LayoutEngine();
				positions = await layoutEngine.layout(layoutNodes, layoutEdges, {
					mode: layoutMode,
					entryNodeId,
					runtime: this._layoutRuntimeForMode(layoutMode)
				});
			}
			await timeout(0);

			// Reject stale completions that lost the scan slot to a newer run.
			if (!this._isActiveScan(cts) || cts.token.isCancellationRequested) {
				this._markCancelledIfActive(cts);
				return undefined;
			}

			this._rawSnapshot = {
				...partial,
				nodes: layoutNodes,
				edges: layoutEdges,
				positions,
				positions3d,
				networkLayoutMode,
				entryNodeId,
				scannedAt: Date.now()
			};

			const enriched = this._enrich(this._rawSnapshot, files.length);
			this._snapshot = enriched;
			this._onDidChangeSnapshot.fire(enriched);
			this._setDiagnostics(enriched.diagnostics);
			this._log(localize('prebase.graph.logReady', "Graph ready: {0} nodes, {1} edges.", enriched.nodes.length, enriched.edges.length));
			return enriched;
		} catch (err) {
			if (!this._isActiveScan(cts) || cts.token.isCancellationRequested) {
				this._markCancelledIfActive(cts);
				return undefined;
			}
			const message = err instanceof Error ? err.message : String(err);
			this._setDiagnostics({ status: 'error', message });
			this._log(localize('prebase.graph.logError', "Scan failed: {0}", message));
			return undefined;
		} finally {
			if (this._scanCts === cts) {
				this._scanCts = undefined;
			}
			cts.dispose();
		}
	}

	async relayout(): Promise<PreBaseEnrichedSnapshot | undefined> {
		if (!this._rawSnapshot) {
			return this.scanWorkspace();
		}
		this._setDiagnostics({
			status: 'scanning',
			message: localize('prebase.graph.relayout', "Updating layout…")
		});
		await timeout(0);
		if (this._viewState.graphType === 'network') {
			const networkLayoutMode = this._getNetworkLayoutMode();
			const computed = this._computeNetworkPositions(this._rawSnapshot.nodes, this._rawSnapshot.edges, networkLayoutMode);
			this._rawSnapshot = {
				...this._rawSnapshot,
				positions: computed.positions2d,
				positions3d: computed.positions3d,
				networkLayoutMode,
			};
		} else {
			const layoutEngine = new LayoutEngine();
			const mode = this._viewState.layoutMode;
			const positions = await layoutEngine.layout(this._rawSnapshot.nodes, this._rawSnapshot.edges, {
				mode,
				entryNodeId: this._rawSnapshot.entryNodeId,
				runtime: this._layoutRuntimeForMode(mode)
			});
			this._rawSnapshot = { ...this._rawSnapshot, positions, positions3d: undefined, networkLayoutMode: undefined };
		}
		await timeout(0);
		const enriched = this._enrich(this._rawSnapshot, this._diagnostics.fileCount);
		this._snapshot = enriched;
		this._onDidChangeSnapshot.fire(enriched);
		this._setDiagnostics(enriched.diagnostics);
		return enriched;
	}

	private _scanLimits(): { maxScanFiles: number; maxLayoutNodes: number; maxNodes: number; maxEdges: number } {
		const quality = this.configurationService.getValue<string>(PreBaseConfigKeys.GraphQuality) || 'auto';
		const configuredNodes = this.configurationService.getValue<number>(PreBaseConfigKeys.GraphMaxRenderedNodes) || 280;
		const configuredEdges = this.configurationService.getValue<number>(PreBaseConfigKeys.GraphMaxRenderedEdges) || 420;
		if (quality === 'performance') {
			return {
				maxScanFiles: Math.min(220, configuredNodes + 40),
				maxLayoutNodes: Math.min(180, configuredNodes),
				maxNodes: Math.min(180, configuredNodes),
				maxEdges: Math.min(280, configuredEdges)
			};
		}
		if (quality === 'quality') {
			return {
				maxScanFiles: Math.min(900, Math.max(configuredNodes * 2, 500)),
				maxLayoutNodes: Math.min(600, configuredNodes),
				maxNodes: configuredNodes,
				maxEdges: configuredEdges
			};
		}
		// auto — keep the workbench responsive even on huge repos (e.g. VS Code itself)
		return {
			maxScanFiles: Math.min(420, configuredNodes + 80),
			maxLayoutNodes: Math.min(320, configuredNodes),
			maxNodes: Math.min(280, configuredNodes),
			maxEdges: Math.min(420, configuredEdges)
		};
	}

	private _pickLayoutNodes(
		nodes: GraphNode[],
		edges: GraphEdge[],
		entryNodeId: string | null,
		maxNodes: number
	): GraphNode[] {
		const fileNodes = nodes.filter(n => n.kind !== 'folder');
		if (fileNodes.length <= maxNodes) {
			return fileNodes;
		}
		const scored = fileNodes.map(n => {
			const imp = computeNodeImportance(n.id, edges);
			const entryBoost = entryNodeId && (n.id === entryNodeId || n.isEntry) ? 1_000_000 : 0;
			return { n, score: imp.score + entryBoost };
		});
		scored.sort((a, b) => b.score - a.score || a.n.id.localeCompare(b.n.id));
		const picked = scored.slice(0, maxNodes).map(s => s.n);
		if (entryNodeId && !picked.some(n => n.id === entryNodeId)) {
			const entry = fileNodes.find(n => n.id === entryNodeId);
			if (entry) {
				picked[picked.length - 1] = entry;
			}
		}
		return picked;
	}

	private _layoutRuntimeForMode(mode: LayoutMode) {
		const quality = this.configurationService.getValue<string>(PreBaseConfigKeys.GraphQuality) || 'auto';
		const spacingScale = mode === 'scattered'
			? Math.max(0.5, Math.min(2.5, (this.configurationService.getValue<number>(PreBaseConfigKeys.GraphNetworkLinkDistance) || 80) / 80))
			: 1;
		const force = this.configurationService.getValue<number>(PreBaseConfigKeys.GraphNetworkForceStrength) || 0.35;
		const relaxBase = quality === 'performance' ? 4 : quality === 'quality' ? 14 : 8;
		return {
			spacingScale: mode === 'scattered' ? spacingScale * (0.7 + force) : spacingScale,
			scatterRelaxIterations: relaxBase
		};
	}

	private _isActiveScan(cts: CancellationTokenSource): boolean {
		return this._scanCts === cts;
	}

	private _markCancelledIfActive(cts: CancellationTokenSource): void {
		if (this._isActiveScan(cts)) {
			this._setDiagnostics({ status: 'cancelled', message: localize('prebase.graph.scanCancelled', "Scan cancelled.") });
		}
	}

	private _enrich(snapshot: GraphSnapshot, fileCount: number): PreBaseEnrichedSnapshot {
		const layoutMode = this._viewState.layoutMode;
		const networkLayoutMode = this._viewState.graphType === 'network'
			? (snapshot.networkLayoutMode as NetworkLayoutMode | undefined) || this._getNetworkLayoutMode()
			: undefined;
		let ringBands: Array<HierarchyRingBand & { color: string }> = [];
		let pyramidBands: Array<PyramidDepthBand & { color: string }> = [];

		// Use file nodes only so folder stubs don't distort ring/pyramid geometry.
		const layoutNodes = snapshot.nodes.filter(n => {
			if (n.kind === 'folder') {
				return false;
			}
			// Network layout drops function stubs; keep Architecture flexible.
			if (this._viewState.graphType === 'network' && n.kind === 'function') {
				return false;
			}
			return true;
		});
		const layoutEdges = snapshot.edges.filter(e => e.kind === 'import');

		if (snapshot.entryNodeId && this._viewState.graphType === 'architecture') {
			if (layoutMode === 'hierarchy') {
				ringBands = getHierarchyRingBandsForSnapshot(
					layoutNodes,
					layoutEdges,
					snapshot.entryNodeId,
					snapshot.positions
				).map(band => ({ ...band, color: depthLevelColor(band.semanticDepth) }));
			} else if (layoutMode === 'pyramid') {
				pyramidBands = getPyramidDepthBands(
					layoutNodes,
					layoutEdges,
					snapshot.entryNodeId,
					snapshot.positions
				).map(band => ({ ...band, color: depthLevelColor(band.depth) }));
			}
		}

		const limits = this._scanLimits();
		const maxNodes = limits.maxNodes;
		const maxEdges = limits.maxEdges;
		const hideLow = this.configurationService.getValue<boolean>(PreBaseConfigKeys.GraphHideLowImportance) === true;

		let nodes = layoutNodes;
		if (hideLow && snapshot.entryNodeId) {
			nodes = layoutNodes.filter(n => {
				if (n.id === snapshot.entryNodeId || n.isEntry) {
					return true;
				}
				const imp = computeNodeImportance(n.id, layoutEdges);
				return imp.score >= 1;
			});
		}
		// Architecture sidebar mode: filter which layers/nodes are rendered (layout geometry unchanged).
		if (this._viewState.graphType === 'architecture') {
			const archMode = this.configurationService.getValue<string>(PreBaseConfigKeys.GraphArchitectureMode);
			nodes = filterNodesForArchitectureMode(nodes, layoutEdges, archMode, snapshot.entryNodeId);
		}
		if (nodes.length > maxNodes) {
			nodes = this._pickLayoutNodes(nodes, layoutEdges, snapshot.entryNodeId, maxNodes);
		}
		const nodeIds = new Set(nodes.map(n => n.id));
		const edges = snapshot.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target)).slice(0, maxEdges);
		const positions: GraphSnapshot['positions'] = {};
		for (const node of nodes) {
			if (snapshot.positions[node.id]) {
				positions[node.id] = snapshot.positions[node.id];
			}
		}

		const truncated = fileCount >= limits.maxScanFiles || layoutNodes.length >= limits.maxLayoutNodes;
		const diagnostics: PreBaseGraphDiagnostics = {
			fileCount,
			nodeCount: nodes.length,
			edgeCount: edges.length,
			entryNodeId: snapshot.entryNodeId,
			scannedAt: snapshot.scannedAt,
			status: 'ready',
			message: truncated
				? localize('prebase.graph.readyCapped', "{0} files · {1} nodes · {2} edges (capped for performance)", fileCount, nodes.length, edges.length)
				: localize('prebase.graph.ready', "{0} files · {1} nodes · {2} edges", fileCount, nodes.length, edges.length)
		};

		const positions3d: NonNullable<GraphSnapshot['positions3d']> = {};
		for (const node of nodes) {
			const p = snapshot.positions3d?.[node.id];
			if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
				positions3d[node.id] = p;
			}
		}
		// Network always exposes positions3d (even empty) so the webview never hash01-synthesizes Z.
		const resolvedPositions3d = this._viewState.graphType === 'network'
			? positions3d
			: (Object.keys(positions3d).length ? positions3d : undefined);

		return {
			...snapshot,
			nodes,
			edges,
			positions,
			positions3d: resolvedPositions3d,
			networkLayoutMode,
			graphType: this._viewState.graphType,
			layoutMode,
			ringBands,
			pyramidBands,
			diagnostics
		};
	}

	private _getNetworkLayoutMode(): NetworkLayoutMode {
		const mode = this.configurationService.getValue<string>(PreBaseConfigKeys.GraphNetworkLayoutMode) || 'organic';
		const valid: NetworkLayoutMode[] = ['organic', 'sphere', 'constellation', 'clustered', 'radial'];
		return (valid.includes(mode as NetworkLayoutMode) ? mode : 'organic') as NetworkLayoutMode;
	}

	private _computeNetworkPositions(
		nodes: GraphNode[],
		edges: GraphEdge[],
		mode: NetworkLayoutMode
	): { positions2d: GraphSnapshot['positions']; positions3d: NonNullable<GraphSnapshot['positions3d']> } {
		const layoutNodes = nodes
			.filter(n => n.kind !== 'folder' && n.kind !== 'function')
			.map(n => {
				const ft = getFileTypeInfo(n.path);
				const imp = computeNodeImportance(n.id, edges);
				const degree = imp.inDegree + imp.outDegree;
				return {
					id: n.id,
					fileTypeId: ft.id,
					isEntry: !!n.isEntry,
					val: n.isEntry ? 10 : Math.max(1.5, 1.2 + Math.sqrt(degree) * 1.4),
				};
			});
		const nodeIds = new Set(layoutNodes.map(n => n.id));
		const links = edges
			.filter(e => (e.kind === 'import' || e.kind === 'dependency') && nodeIds.has(e.source) && nodeIds.has(e.target))
			.map(e => ({ source: e.source, target: e.target }));
		const spread = Math.max(0.4, Math.min(2.5, this.configurationService.getValue<number>(PreBaseConfigKeys.GraphNetworkSpreadScale) || 1));
		const radius = computeNetworkSphereRadius(layoutNodes.length, spread);
		const layout = layoutNetworkGraph(mode, layoutNodes, links, radius);
		const positions2d: GraphSnapshot['positions'] = {};
		const positions3d: NonNullable<GraphSnapshot['positions3d']> = {};
		for (const [id, p] of layout) {
			if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
				continue;
			}
			positions3d[id] = { x: p.x, y: p.y, z: p.z };
			positions2d[id] = { x: p.x - 14, y: p.y - 14 };
		}
		return { positions2d, positions3d };
	}

	private async _collectFiles(root: URI, token: CancellationToken, maxFiles: number): Promise<Array<ScannedFile & { resource: URI }>> {
		const files: Array<ScannedFile & { resource: URI }> = [];
		const ignorePatterns = DEFAULT_IGNORE_PATTERNS;
		const queue: URI[] = [root];
		let visited = 0;

		while (queue.length && files.length < maxFiles) {
			if (token.isCancellationRequested) {
				break;
			}
			const current = queue.shift()!;
			visited++;
			if (visited % 12 === 0) {
				this._setDiagnostics({
					fileCount: files.length,
					status: 'scanning',
					message: localize('prebase.graph.scanningProgress', "Scanning workspace… {0} files", files.length)
				});
				await timeout(0);
			}
			let stat: IFileStat;
			try {
				stat = await this.fileService.resolve(current, { resolveMetadata: false });
			} catch {
				continue;
			}
			if (!stat.isDirectory || !stat.children) {
				continue;
			}
			for (const child of stat.children) {
				if (files.length >= maxFiles) {
					break;
				}
				const relative = normalizePath(this._toRelative(root, child.resource));
				if (this._isIgnored(relative, child.isDirectory, ignorePatterns)) {
					continue;
				}
				if (child.isDirectory) {
					queue.push(child.resource);
					continue;
				}
				if (!isGraphRelevantFile(relative)) {
					continue;
				}
				const name = basename(relative);
				const ext = name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
				files.push({
					absolutePath: child.resource.fsPath || child.resource.path,
					relativePath: relative,
					extension: ext,
					resource: child.resource
				});
			}
		}
		return files;
	}

	private async _parseFiles(files: Array<ScannedFile & { resource: URI }>, token: CancellationToken): Promise<ParseResult[]> {
		const results: ParseResult[] = [];
		for (let i = 0; i < files.length; i++) {
			if (token.isCancellationRequested) {
				break;
			}
			if (i > 0 && i % 8 === 0) {
				this._setDiagnostics({
					fileCount: files.length,
					status: 'scanning',
					message: localize('prebase.graph.parseProgress', "Parsing files… {0}/{1}", i, files.length)
				});
				await timeout(0);
			}
			const file = files[i];
			try {
				const content = (await this.fileService.readFile(file.resource)).value.toString();
				if (content.length > 200_000) {
					continue;
				}
				const imports = extractImportsForFile(file, content);
				const packageName = extractPackageName(file, content);
				const exports: ParseResult['exports'] = [];
				const exportRe = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_]+)/g;
				let m: RegExpExecArray | null;
				let exportCount = 0;
				while ((m = exportRe.exec(content)) !== null && exportCount < 40) {
					exports.push({ name: m[1] });
					exportCount++;
				}
				results.push({
					filePath: file.absolutePath,
					relativePath: file.relativePath,
					imports,
					exports,
					functions: [],
					components: [],
					isComponentFile: file.extension === '.tsx' || file.extension === '.jsx',
					packageName
				});
			} catch {
				// skip unreadable files
			}
		}
		return results;
	}

	private async _readPackageMain(folder: URI): Promise<string | null> {
		try {
			const pkgUri = URI.joinPath(folder, 'package.json');
			const raw = (await this.fileService.readFile(pkgUri)).value.toString();
			const pkg = JSON.parse(raw) as { main?: string; module?: string };
			return pkg.module ?? pkg.main ?? null;
		} catch {
			return null;
		}
	}

	private _toRelative(root: URI, resource: URI): string {
		const rootPath = normalizePath(root.fsPath || root.path).replace(/\/$/, '');
		const full = normalizePath(resource.fsPath || resource.path);
		if (full.startsWith(rootPath + '/')) {
			return full.slice(rootPath.length + 1);
		}
		if (full === rootPath) {
			return '';
		}
		return basename(full);
	}

	private _isIgnored(relativePath: string, isDirectory: boolean, patterns: string[]): boolean {
		const path = relativePath.replace(/^\/+/, '');
		const candidates = isDirectory ? [path, `${path}/`, `**/${path}/**`] : [path, `**/${path}`];
		for (const pattern of patterns) {
			for (const candidate of candidates) {
				if (matchGlob(pattern, candidate) || matchGlob(pattern, `/${candidate}`)) {
					return true;
				}
			}
			// Fast path for common folder ignores
			const folder = pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '').replace(/\*\*/g, '');
			if (folder && (path === folder || path.startsWith(`${folder}/`) || path.includes(`/${folder}/`))) {
				return true;
			}
		}
		return false;
	}

	private _setDiagnostics(partial: Partial<PreBaseGraphDiagnostics>): void {
		this._diagnostics = { ...this._diagnostics, ...partial };
		this._onDidChangeDiagnostics.fire(this._diagnostics);
	}

	private _log(message: string): void {
		const channel = this.outputService.getChannel(PREBASE_GRAPH_CHANNEL_ID);
		channel?.append(`[PreBase] ${message}\n`);
	}
}

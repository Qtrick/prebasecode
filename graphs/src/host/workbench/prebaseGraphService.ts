/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IOutputService } from '../../../../../services/output/common/output.js';
import { PreBaseGraphConfigKeys, PREBASE_GRAPH_CHANNEL_ID } from '../../common/configuration/graphConfigKeys.js';
import type { CanonicalGraphSnapshot } from '../../common/types/canonicalTypes.js';
import { CanonicalGraphAnalyzer } from '../../core/canonical/canonicalGraphAnalyzer.js';
import { WorkingTreeContentSource } from '../../core/canonical/contentSource.js';
import { computeCanonicalGraphDiff, type CanonicalGraphDiff } from '../../core/canonical/canonicalGraphDiff.js';
import { projectNetworkGraph } from '../../core/projection/graphProjection.js';
import { GitHistoryService } from '../../history/git/gitHistoryService.js';
import { GitTreeContentSource } from '../../history/git/gitTreeContentSource.js';
import type { NetworkLayoutMode } from '../../layouts/network/index.js';
import { basename } from '../../core/resolution/paths.js';
import type { GraphEdge, GraphNode, GraphSnapshot, LayoutMode } from '../../common/types/graphTypes.js';

export type PreBaseGraphType = 'network';

export interface PreBaseGraphViewState {
	graphType: PreBaseGraphType;
	layoutMode: LayoutMode;
}

export interface PreBaseEnrichedSnapshot extends GraphSnapshot {
	graphType: PreBaseGraphType;
	layoutMode: LayoutMode;
	networkLayoutMode?: NetworkLayoutMode;
	ringBands: readonly [];
	pyramidBands: readonly [];
	diagnostics: PreBaseGraphDiagnostics;
}

export interface PreBaseGraphDiagnostics {
	fileCount: number;
	nodeCount: number;
	edgeCount: number;
	canonicalNodeCount?: number;
	canonicalEdgeCount?: number;
	entryNodeId: string | null;
	scannedAt: number | null;
	status: 'idle' | 'scanning' | 'ready' | 'error' | 'cancelled';
	message?: string;
	digest?: string;
}

interface AdjacentGraphEdge {
	edge: GraphEdge;
	isOutgoing: boolean;
	isIncoming: boolean;
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
	getCanonicalSnapshot(): CanonicalGraphSnapshot | undefined;
	getViewState(): PreBaseGraphViewState;
	getDiagnostics(): PreBaseGraphDiagnostics;

	scanWorkspace(token?: CancellationToken): Promise<PreBaseEnrichedSnapshot | undefined>;
	rescanWorkspace(token?: CancellationToken): Promise<PreBaseEnrichedSnapshot | undefined>;
	cancelScan(): void;
	clearCache(): void;

	setGraphType(graphType: PreBaseGraphType): Promise<void>;
	setLayoutMode(layoutMode: LayoutMode): Promise<void>;
	relayout(): Promise<PreBaseEnrichedSnapshot | undefined>;

	buildCanonicalGraphAtRef(ref: string, token?: CancellationToken): Promise<CanonicalGraphSnapshot | undefined>;
	compareCanonicalGraphRefs(refA: string, refB: string, token?: CancellationToken): Promise<{ diff: CanonicalGraphDiff; snapshotA: CanonicalGraphSnapshot; snapshotB: CanonicalGraphSnapshot } | undefined>;

	getSelectedNodeId(): string | undefined;
	setSelectedNodeId(nodeId: string | undefined): void;
	getSelectionSummaryForMagnus(): string | undefined;
	searchForMagnus(query: string, maximumResults?: number): string;
	getNodeDetailsForMagnus(nodeIdOrPath: string): string | undefined;
	getDependenciesForMagnus(nodeIdOrPath: string, direction?: 'incoming' | 'outgoing' | 'both', depth?: number, maximumNodes?: number): string | undefined;
	getOverviewForMagnus(): string;
	focusNodeForMagnus(nodeIdOrPath: string): boolean;

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
	private _canonicalSnapshot: CanonicalGraphSnapshot | undefined;
	private _scanCts: CancellationTokenSource | undefined;
	private _relayoutGeneration = 0;
	private _layoutRevision = 0;
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
			graphType: 'network',
			layoutMode: 'hierarchy'
		};
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphHideLowImportance) ||
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphMaxRenderedNodes) ||
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphMaxRenderedEdges)
			) {
				if (this._canonicalSnapshot) {
					this._projectAndPublish(this._canonicalSnapshot);
				}
			} else if (
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphNetworkForceStrength) ||
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphNetworkLinkDistance) ||
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphNetworkCollisionRadius) ||
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphNetworkLayoutMode) ||
				e.affectsConfiguration(PreBaseGraphConfigKeys.GraphNetworkSpreadScale)
			) {
				if (this._viewState.graphType === 'network' && this._canonicalSnapshot) {
					void this.relayout();
				}
			} else if (e.affectsConfiguration(PreBaseGraphConfigKeys.GraphRespectGitIgnore)) {
				this._debounceRescan();
			}
		}));

		this._register(this.fileService.onDidFilesChange(e => {
			const isIgnore = (uri: URI) => uri.path.endsWith('.gitignore') || uri.path.endsWith('.git/info/exclude');
			if (e.rawAdded.some(isIgnore) || e.rawUpdated.some(isIgnore) || e.rawDeleted.some(isIgnore)) {
				this._debounceRescan();
			}
		}));
	}

	private _debounceRescanTimer: any;
	private _debounceRescan(): void {
		if (this._debounceRescanTimer) {
			clearTimeout(this._debounceRescanTimer);
		}
		this._debounceRescanTimer = setTimeout(() => {
			this._debounceRescanTimer = undefined;
			void this.rescanWorkspace();
		}, 500);
	}

	getSnapshot(): PreBaseEnrichedSnapshot | undefined {
		return this._snapshot;
	}

	getCanonicalSnapshot(): CanonicalGraphSnapshot | undefined {
		return this._canonicalSnapshot;
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
		const source = this._canonicalSnapshot ?? this._snapshot;
		if (!source || !this._selectedNodeId) {
			return undefined;
		}
		const node = source.nodes.find(n => n.id === this._selectedNodeId);
		if (!node) {
			return undefined;
		}
		const edges = source.edges.filter(e => e.source === node.id || e.target === node.id);
		return [
			`Graph type: ${this._viewState.graphType}`,
			`Layout: ${this._viewState.layoutMode}`,
			`Selected node: ${node.label || node.id}`,
			`Path: ${node.path || node.id}`,
			`Kind: ${node.kind}`,
			`Connected edges: ${edges.length}`,
		].join('\n');
	}

	searchForMagnus(query: string, maximumResults = 20): string {
		const source = this._canonicalSnapshot ?? this._snapshot;
		const normalized = typeof query === 'string' && query.length <= 512 ? query.trim().toLowerCase() : '';
		if (!source || !normalized) {
			return JSON.stringify({ graph: this._freshness(), nodes: [] });
		}
		const boundedMaximum = typeof maximumResults === 'number' && Number.isFinite(maximumResults)
			? Math.max(1, Math.min(Math.floor(maximumResults), 50))
			: 20;
		const degree = this._degrees(source);
		const nodes = source.nodes
			.filter(node => [node.id, node.label, node.path, node.kind, node.meta?.language, node.meta?.architectureLayer]
				.some(value => value?.toLowerCase().includes(normalized)))
			.slice(0, boundedMaximum)
			.map(node => ({
				id: node.id,
				label: node.label,
				path: node.path,
				kind: node.kind,
				language: node.meta?.language,
				layer: node.meta?.architectureLayer,
				isEntry: !!node.isEntry,
				degree: degree.get(node.id) ?? 0,
			}));
		return JSON.stringify({ graph: this._freshness(), nodes });
	}

	getNodeDetailsForMagnus(nodeIdOrPath: string): string | undefined {
		const source = this._canonicalSnapshot ?? this._snapshot;
		const node = this._findNode(nodeIdOrPath);
		if (!source || !node) {
			return undefined;
		}
		const edges = source.edges.filter(edge => edge.source === node.id || edge.target === node.id);
		return JSON.stringify({
			graph: this._freshness(),
			node,
			imports: edges.filter(edge => edge.source === node.id).map(edge => ({ kind: edge.kind, target: edge.target })),
			dependents: edges.filter(edge => edge.target === node.id).map(edge => ({ kind: edge.kind, source: edge.source })),
		});
	}

	getDependenciesForMagnus(nodeIdOrPath: string, direction: 'incoming' | 'outgoing' | 'both' = 'both', depth = 1, maximumNodes = 50): string | undefined {
		const source = this._canonicalSnapshot ?? this._snapshot;
		const root = this._findNode(nodeIdOrPath);
		if (!source || !root) {
			return undefined;
		}
		const boundedDirection = direction === 'incoming' || direction === 'outgoing' || direction === 'both' ? direction : 'both';
		const boundedDepth = typeof depth === 'number' && Number.isFinite(depth) ? Math.max(1, Math.min(Math.floor(depth), 8)) : 1;
		const maximum = typeof maximumNodes === 'number' && Number.isFinite(maximumNodes) ? Math.max(1, Math.min(Math.floor(maximumNodes), 100)) : 50;
		const visited = new Set<string>([root.id]);
		const queue: Array<{ id: string; depth: number }> = [{ id: root.id, depth: 0 }];
		const relationships: Array<{ from: string; to: string; kind: string }> = [];
		const adjacentEdges = new Map<string, AdjacentGraphEdge[]>();
		const nodeById = new Map(source.nodes.map(node => [node.id, node]));
		for (const edge of source.edges) {
			this._addAdjacentEdge(adjacentEdges, edge.source, {
				edge,
				isOutgoing: true,
				isIncoming: edge.source === edge.target,
			});
			if (edge.source !== edge.target) {
				this._addAdjacentEdge(adjacentEdges, edge.target, { edge, isOutgoing: false, isIncoming: true });
			}
		}

		for (let queueIndex = 0; queueIndex < queue.length && visited.size <= maximum; queueIndex++) {
			const current = queue[queueIndex];
			if (current.depth >= boundedDepth) {
				continue;
			}
			this._visitDependencies(adjacentEdges.get(current.id), current, boundedDirection, visited, queue, relationships, maximum);
		}
		return JSON.stringify({
			graph: this._freshness(),
			root: root.id,
			nodes: [...visited].flatMap(id => {
				const node = nodeById.get(id);
				return node ? [node] : [];
			}),
			relationships: relationships.slice(0, maximum * 3),
		});
	}

	getOverviewForMagnus(): string {
		const source = this._canonicalSnapshot ?? this._snapshot;
		if (!source) {
			return JSON.stringify({ graph: this._freshness(), available: false });
		}
		const degree = this._degrees(source);
		const languages = [...new Set(source.nodes.map(node => node.meta?.language).filter((value): value is string => !!value))];
		const highDegree = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
			.map(([id, count]) => ({ id, degree: count, path: source.nodes.find(node => node.id === id)?.path }));
		return JSON.stringify({
			graph: this._freshness(),
			available: true,
			totalCanonicalNodes: source.nodes.length,
			totalCanonicalEdges: source.edges.length,
			languages,
			highDegree,
		});
	}

	focusNodeForMagnus(nodeIdOrPath: string): boolean {
		const node = this._findNode(nodeIdOrPath);
		if (!node) {
			return false;
		}
		this.setSelectedNodeId(node.id);
		return true;
	}

	private _findNode(nodeIdOrPath: string): GraphNode | undefined {
		if (typeof nodeIdOrPath !== 'string') {
			return undefined;
		}
		const value = nodeIdOrPath.trim();
		if (!value || value.length > 4096) {
			return undefined;
		}
		const source = this._canonicalSnapshot ?? this._snapshot;
		return source?.nodes.find(node => node.id === value || node.path === value || `file:${node.path}` === value);
	}

	private _degrees(source: { edges: readonly GraphEdge[] }): Map<string, number> {
		const degree = new Map<string, number>();
		for (const edge of source.edges) {
			degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
			degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
		}
		return degree;
	}

	private _freshness(): { scannedAt: number | null; status: PreBaseGraphDiagnostics['status']; projectPath: string | undefined; digest?: string } {
		return {
			scannedAt: this._diagnostics.scannedAt,
			status: this._diagnostics.status,
			projectPath: this._snapshot?.projectPath ?? this._canonicalSnapshot?.projectPath,
			digest: this._canonicalSnapshot?.digest,
		};
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
		this._canonicalSnapshot = undefined;
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

	async setGraphType(_graphType: PreBaseGraphType): Promise<void> {
		// The active product has one Code Graph.
	}

	async setLayoutMode(layoutMode: LayoutMode): Promise<void> {
		if (this._viewState.layoutMode === layoutMode) {
			return;
		}
		this._viewState = { ...this._viewState, layoutMode };
		this._onDidChangeViewState.fire(this._viewState);
		if (this._canonicalSnapshot) {
			void this.relayout();
		}
	}

	async rescanWorkspace(token?: CancellationToken): Promise<PreBaseEnrichedSnapshot | undefined> {
		this.clearCache();
		return this.scanWorkspace(token);
	}

	async scanWorkspace(token?: CancellationToken): Promise<PreBaseEnrichedSnapshot | undefined> {
		this._relayoutGeneration++;
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
			const respectGitIgnore = this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphRespectGitIgnore) !== false;

			const contentSource = new WorkingTreeContentSource(projectPath, {
				projectName,
				respectGitIgnore,
				fileOps: {
					readFile: async (p: string) => {
						const uri = URI.file(p);
						const fileContent = await this.fileService.readFile(uri, { position: 0, length: 500_000 });
						return fileContent.value.toString();
					}
				}
			});

			const analyzer = new CanonicalGraphAnalyzer();
			const canonical = await analyzer.analyze(contentSource, cts.token);
			if (!canonical || cts.token.isCancellationRequested) {
				this._markCancelledIfActive(cts);
				return undefined;
			}

			await timeout(0);
			if (!this._isActiveScan(cts) || cts.token.isCancellationRequested) {
				this._markCancelledIfActive(cts);
				return undefined;
			}

			this._canonicalSnapshot = canonical;
			const enriched = this._projectAndPublish(canonical);
			this._log(localize('prebase.graph.logReady', "Graph ready: {0} canonical nodes ({1} rendered), {2} edges.", canonical.nodes.length, enriched.nodes.length, enriched.edges.length));
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
		const canonical = this._canonicalSnapshot;
		if (!canonical) {
			return this.scanWorkspace();
		}
		const generation = ++this._relayoutGeneration;
		this._setDiagnostics({
			status: 'scanning',
			message: localize('prebase.graph.relayout', "Updating layout…")
		});
		await timeout(0);
		if (generation !== this._relayoutGeneration) {
			return undefined;
		}

		const enriched = this._projectAndPublish(canonical);
		return enriched;
	}

	async buildCanonicalGraphAtRef(ref: string, token?: CancellationToken): Promise<CanonicalGraphSnapshot | undefined> {
		const folder = this.workspaceService.getWorkspace().folders[0];
		if (!folder) {
			return undefined;
		}
		const rootPath = folder.uri.fsPath || folder.uri.path;
		const gitService = new GitHistoryService();
		const resolvedSha = await gitService.resolveRef(rootPath, ref, token);
		if (!resolvedSha) {
			return undefined;
		}
		const gitSource = new GitTreeContentSource(gitService, rootPath, resolvedSha);
		const analyzer = new CanonicalGraphAnalyzer();
		return analyzer.analyze(gitSource, token);
	}

	async compareCanonicalGraphRefs(refA: string, refB: string, token?: CancellationToken): Promise<{ diff: CanonicalGraphDiff; snapshotA: CanonicalGraphSnapshot; snapshotB: CanonicalGraphSnapshot } | undefined> {
		const snapshotA = await this.buildCanonicalGraphAtRef(refA, token);
		const snapshotB = await this.buildCanonicalGraphAtRef(refB, token);
		if (!snapshotA || !snapshotB) {
			return undefined;
		}
		const diff = computeCanonicalGraphDiff(snapshotA, snapshotB);
		return { diff, snapshotA, snapshotB };
	}

	private _projectAndPublish(canonical: CanonicalGraphSnapshot): PreBaseEnrichedSnapshot {
		const limits = this._scanLimits();
		const networkLayoutMode = this._getNetworkLayoutMode();
		const spread = Math.max(0.4, Math.min(2.5, this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphNetworkSpreadScale) || 1));
		const hideLow = this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphHideLowImportance) === true;

		const projection = projectNetworkGraph(canonical, {
			maxRenderedNodes: limits.maxNodes,
			maxRenderedEdges: limits.maxEdges,
			hideLowImportance: hideLow,
			networkLayoutMode,
			spreadScale: spread,
			collisionRadius: Math.max(2, this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphNetworkCollisionRadius) || 24),
			linkDistance: Math.max(4, this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphNetworkLinkDistance) || 80),
			forceStrength: Math.max(0, Math.min(2, this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphNetworkForceStrength) ?? 0.35)),
			layoutRevision: ++this._layoutRevision,
		});

		const isCapped = canonical.nodes.length > projection.nodes.length;
		const diagnostics: PreBaseGraphDiagnostics = {
			fileCount: canonical.completeness.analyzedFileCount,
			nodeCount: projection.nodes.length,
			edgeCount: projection.edges.length,
			canonicalNodeCount: canonical.nodes.length,
			canonicalEdgeCount: canonical.edges.length,
			entryNodeId: canonical.entryNodeId,
			scannedAt: canonical.analyzedAt,
			status: 'ready',
			digest: canonical.digest,
			message: isCapped
				? localize('prebase.graph.readyCapped', "{0} canonical nodes ({1} rendered) · {2} edges", canonical.nodes.length, projection.nodes.length, projection.edges.length)
				: localize('prebase.graph.ready', "{0} files · {1} nodes · {2} edges", canonical.completeness.analyzedFileCount, projection.nodes.length, projection.edges.length)
		};

		const enriched: PreBaseEnrichedSnapshot = {
			...projection,
			positions3d: projection.positions3d ?? {},
			networkLayoutMode,
			graphType: this._viewState.graphType,
			layoutMode: this._viewState.layoutMode,
			ringBands: [],
			pyramidBands: [],
			diagnostics
		};

		this._snapshot = enriched;
		this._onDidChangeSnapshot.fire(enriched);
		this._setDiagnostics(diagnostics);
		return enriched;
	}

	private _scanLimits(): { maxNodes: number; maxEdges: number } {
		const quality = this.configurationService.getValue<string>(PreBaseGraphConfigKeys.GraphQuality) || 'auto';
		const configuredNodes = this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphMaxRenderedNodes) || 280;
		const configuredEdges = this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphMaxRenderedEdges) || 420;
		if (quality === 'performance') {
			return {
				maxNodes: Math.min(180, configuredNodes),
				maxEdges: Math.min(280, configuredEdges)
			};
		}
		if (quality === 'quality') {
			return {
				maxNodes: configuredNodes,
				maxEdges: configuredEdges
			};
		}
		return {
			maxNodes: Math.min(280, configuredNodes),
			maxEdges: Math.min(420, configuredEdges)
		};
	}

	private _getNetworkLayoutMode(): NetworkLayoutMode {
		const mode = this.configurationService.getValue<string>(PreBaseGraphConfigKeys.GraphNetworkLayoutMode) || 'organic';
		const valid: NetworkLayoutMode[] = ['organic', 'sphere', 'constellation', 'clustered', 'radial'];
		return (valid.includes(mode as NetworkLayoutMode) ? mode : 'organic') as NetworkLayoutMode;
	}

	private _isActiveScan(cts: CancellationTokenSource): boolean {
		return this._scanCts === cts;
	}

	private _markCancelledIfActive(cts: CancellationTokenSource): void {
		if (this._isActiveScan(cts)) {
			this._setDiagnostics({ status: 'cancelled', message: localize('prebase.graph.scanCancelled', "Scan cancelled.") });
		}
	}

	private _addAdjacentEdge(index: Map<string, AdjacentGraphEdge[]>, nodeId: string, edge: AdjacentGraphEdge): void {
		const adjacent = index.get(nodeId);
		if (adjacent) {
			adjacent.push(edge);
		} else {
			index.set(nodeId, [edge]);
		}
	}

	private _visitDependencies(
		edges: readonly AdjacentGraphEdge[] | undefined,
		current: { id: string; depth: number },
		direction: 'incoming' | 'outgoing' | 'both',
		visited: Set<string>,
		queue: Array<{ id: string; depth: number }>,
		relationships: Array<{ from: string; to: string; kind: string }>,
		maximum: number
	): void {
		if (!edges) {
			return;
		}
		for (const adjacent of edges) {
			if ((direction === 'incoming' && !adjacent.isIncoming) || (direction === 'outgoing' && !adjacent.isOutgoing)) {
				continue;
			}
			const next = adjacent.isOutgoing ? adjacent.edge.target : adjacent.edge.source;
			relationships.push({ from: current.id, to: next, kind: adjacent.edge.kind });
			if (!visited.has(next) && visited.size < maximum) {
				visited.add(next);
				queue.push({ id: next, depth: current.depth + 1 });
			}
		}
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

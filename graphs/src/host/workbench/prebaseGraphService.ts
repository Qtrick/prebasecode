/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
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
import { CanonicalQueryIndex, type AdjacentEdgeInfo } from '../../core/query/canonicalQueryIndex.js';
import { normalizeNetworkLayoutMode, type NetworkLayoutMode } from '../../layouts/network/index.js';
import { basename } from '../../core/resolution/paths.js';
import type { GraphNode, GraphSnapshot, LayoutMode } from '../../common/types/graphTypes.js';
import { GitTreeContentSource } from '../../history/git/gitTreeContentSource.js';
import { IWorkbenchGitHistoryService } from './workbenchGitHistoryService.js';
import { IPreBaseCanonicalParseService } from './workbenchCanonicalParseService.js';
import { IGitService, IGitRepository } from '../../../../git/common/gitService.js';

export type PreBaseGraphType = 'network' | 'temporal';

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
	loadHistoricalCommit(commitSha?: string, token?: CancellationToken): Promise<PreBaseEnrichedSnapshot | undefined>;
	getSelectedHistoricalCommitSha(): string | undefined;

	getSelectedNodeId(): string | undefined;
	setSelectedNodeId(nodeId: string | undefined): void;
	getSelectionSummaryForMagnus(): string | undefined;
	searchForMagnus(query: string, maximumResults?: number): string;
	getNodeDetailsForMagnus(nodeIdOrPath: string): string | undefined;
	getDependenciesForMagnus(nodeIdOrPath: string, direction?: 'incoming' | 'outgoing' | 'both', depth?: number, maximumNodes?: number): string | undefined;
	getOverviewForMagnus(): string;
	focusNodeForMagnus(nodeIdOrPath: string): boolean;
	resolveNodeFocusForMagnus(nodeIdOrPath: string): {
		status: 'not-found' | 'found-rendered-focused' | 'found-canonical-not-rendered';
		node?: GraphNode;
	};

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
	private _canonicalIndex: CanonicalQueryIndex | undefined;
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

	/** Per-repository HEAD-state observers, keyed by repository root URI. */
	private readonly _repositoryHeadObservers = new Map<string, DisposableStore>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IOutputService private readonly outputService: IOutputService,
		@IGitService private readonly gitService: IGitService,
		@IWorkbenchGitHistoryService private readonly _gitHistoryService: IWorkbenchGitHistoryService,
		@IPreBaseCanonicalParseService private readonly _parseService: IPreBaseCanonicalParseService,
	) {
		super();
		this._viewState = {
			graphType: 'network',
			layoutMode: 'hierarchy'
		};
		if (this.gitService) {
			this._checkAndWireHeadObservers();
		}
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
			void this.rescanWorkspace().catch(() => { /* rescan failed */ });
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
		const node = this._selectedNodeId ? this._canonicalIndex?.findNode(this._selectedNodeId) : undefined;
		if (!node) {
			return undefined;
		}
		const incoming = this._canonicalIndex?.incomingEdges.get(node.id)?.length ?? 0;
		const outgoing = this._canonicalIndex?.outgoingEdges.get(node.id)?.length ?? 0;
		return [
			`Graph type: ${this._viewState.graphType}`,
			`Layout: ${this._viewState.layoutMode}`,
			`Selected node: ${node.label || node.id}`,
			`Path: ${node.path || node.id}`,
			`Kind: ${node.kind}`,
			`Connected edges: ${incoming + outgoing}`,
		].join('\n');
	}

	searchForMagnus(query: string, maximumResults = 20): string {
		const source = this._canonicalSnapshot;
		const normalized = typeof query === 'string' && query.length <= 512 ? query.trim().toLowerCase() : '';
		if (!source || !normalized) {
			return JSON.stringify({ graph: this._freshness(), nodes: [] });
		}
		const boundedMaximum = typeof maximumResults === 'number' && Number.isFinite(maximumResults)
			? Math.max(1, Math.min(Math.floor(maximumResults), 50))
			: 20;

		const matchingNodes: Array<{
			id: string;
			label: string;
			path?: string;
			kind: string;
			language?: string;
			layer?: string;
			isEntry: boolean;
			degree: number;
		}> = [];

		for (const node of source.nodes) {
			if (matchingNodes.length >= boundedMaximum) {
				break;
			}
			const matches = [node.id, node.label, node.path, node.kind, node.meta?.language, node.meta?.architectureLayer]
				.some(value => value?.toLowerCase().includes(normalized));

			if (matches) {
				matchingNodes.push({
					id: node.id,
					label: node.label,
					path: node.path,
					kind: node.kind,
					language: node.meta?.language,
					layer: node.meta?.architectureLayer,
					isEntry: !!node.isEntry,
					degree: this._canonicalIndex?.nodeDegree.get(node.id) ?? 0,
				});
			}
		}

		return JSON.stringify({ graph: this._freshness(), nodes: matchingNodes });
	}

	getNodeDetailsForMagnus(nodeIdOrPath: string): string | undefined {
		const node = this._findNode(nodeIdOrPath);
		if (!node || !this._canonicalIndex) {
			return undefined;
		}

		const incoming = this._canonicalIndex.incomingEdges.get(node.id) ?? [];
		const outgoing = this._canonicalIndex.outgoingEdges.get(node.id) ?? [];

		// Bounded details to avoid sending massive payloads to the AI model
		const boundedImports = outgoing.slice(0, 50).map(edge => ({ kind: edge.kind, target: edge.target }));
		const boundedDependents = incoming.slice(0, 50).map(edge => ({ kind: edge.kind, source: edge.source }));

		return JSON.stringify({
			graph: this._freshness(),
			node: {
				id: node.id,
				label: node.label,
				path: node.path,
				kind: node.kind,
				isEntry: node.isEntry,
				meta: {
					architectureLayer: node.meta?.architectureLayer,
					language: node.meta?.language,
					imports: node.meta?.imports?.slice(0, 50),
					exports: node.meta?.exports?.slice(0, 50),
				}
			},
			imports: boundedImports,
			dependents: boundedDependents,
		});
	}

	getDependenciesForMagnus(nodeIdOrPath: string, direction: 'incoming' | 'outgoing' | 'both' = 'both', depth = 1, maximumNodes = 50): string | undefined {
		const root = this._findNode(nodeIdOrPath);
		if (!root || !this._canonicalIndex) {
			return undefined;
		}
		const boundedDirection = direction === 'incoming' || direction === 'outgoing' || direction === 'both' ? direction : 'both';
		const boundedDepth = typeof depth === 'number' && Number.isFinite(depth) ? Math.max(1, Math.min(Math.floor(depth), 8)) : 1;
		const maximum = typeof maximumNodes === 'number' && Number.isFinite(maximumNodes) ? Math.max(1, Math.min(Math.floor(maximumNodes), 100)) : 50;

		const visited = new Set<string>([root.id]);
		const queue: Array<{ id: string; depth: number }> = [{ id: root.id, depth: 0 }];
		const relationships: Array<{ from: string; to: string; kind: string }> = [];

		for (let queueIndex = 0; queueIndex < queue.length && visited.size <= maximum; queueIndex++) {
			const current = queue[queueIndex];
			if (current.depth >= boundedDepth) {
				continue;
			}
			const adjacent = this._canonicalIndex.adjacentEdges.get(current.id);
			this._visitDependencies(adjacent, current, boundedDirection, visited, queue, relationships, maximum);
		}

		return JSON.stringify({
			graph: this._freshness(),
			root: root.id,
			nodes: [...visited].flatMap(id => {
				const node = this._canonicalIndex?.nodeById.get(id);
				return node ? [node] : [];
			}),
			relationships: relationships.slice(0, maximum * 3),
		});
	}

	getOverviewForMagnus(): string {
		const source = this._canonicalSnapshot;
		if (!source || !this._canonicalIndex) {
			return JSON.stringify({ graph: this._freshness(), available: false });
		}
		const degree = this._canonicalIndex.nodeDegree;
		const languages = this._canonicalIndex.languages;
		const highDegree = [...degree.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([id, count]) => ({ id, degree: count, path: this._canonicalIndex?.nodeById.get(id)?.path }));

		return JSON.stringify({
			graph: this._freshness(),
			available: true,
			totalCanonicalNodes: source.nodes.length,
			totalCanonicalEdges: source.edges.length,
			coverage: source.coverage,
			languages,
			highDegree,
		});
	}

	focusNodeForMagnus(nodeIdOrPath: string): boolean {
		const result = this.resolveNodeFocusForMagnus(nodeIdOrPath);
		return result.status === 'found-rendered-focused';
	}

	resolveNodeFocusForMagnus(nodeIdOrPath: string): {
		status: 'not-found' | 'found-rendered-focused' | 'found-canonical-not-rendered';
		node?: GraphNode;
	} {
		const node = this._findNode(nodeIdOrPath);
		if (!node) {
			return { status: 'not-found' };
		}

		// Check if node is rendered in current projection
		const isRendered = this._snapshot?.nodes.some(n => n.id === node.id);
		if (isRendered) {
			this.setSelectedNodeId(node.id);
			return { status: 'found-rendered-focused', node };
		}

		// Node exists in canonical graph but is not in render projection
		return { status: 'found-canonical-not-rendered', node };
	}

	private _findNode(nodeIdOrPath: string): GraphNode | undefined {
		if (typeof nodeIdOrPath !== 'string') {
			return undefined;
		}
		const value = nodeIdOrPath.trim();
		if (!value || value.length > 4096) {
			return undefined;
		}
		return this._canonicalIndex?.findNode(value) ?? this._snapshot?.nodes.find(n => n.id === value || n.path === value);
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
		for (const store of this._repositoryHeadObservers.values()) {
			store.dispose();
		}
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
		this._canonicalIndex = undefined;
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
		this._viewState = { ...this._viewState, graphType };
		this._onDidChangeViewState.fire(this._viewState);
	}

	async setLayoutMode(layoutMode: LayoutMode): Promise<void> {
		const normalized = normalizeNetworkLayoutMode(layoutMode) as LayoutMode;
		if (this._viewState.layoutMode === normalized) {
			return;
		}
		this._viewState = { ...this._viewState, layoutMode: normalized };
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

			// Ensure repository is opened/known before wiring ignore or HEAD
			const repoForIgnore = await this._ensureGitRepositoryForPath(projectPath);
			this._checkAndWireHeadObservers();

			// Wire git-native checkIgnore when available for the workspace folder.
			const checkIgnoreFn: ((paths: string[]) => Promise<Set<string>>) | undefined =
				(respectGitIgnore && repoForIgnore?.checkIgnore)
					? async (paths) => new Set(await repoForIgnore.checkIgnore!(paths))
					: undefined;

			const contentSource = new WorkingTreeContentSource(projectPath, {
				projectName,
				respectGitIgnore,
				checkIgnore: checkIgnoreFn,
				fileOps: {
					readFile: async (p: string) => {
						const uri = URI.file(p);
						const fileContent = await this.fileService.readFile(uri, { position: 0, length: 1_000_000 });
						return fileContent.value.toString();
					},
					readDirectory: async (p: string) => {
						const uri = URI.file(p);
						const stat = await this.fileService.resolve(uri);
						if (!stat.children) {return [];}
						return stat.children.map(c => ({ name: c.name, isDirectory: c.isDirectory }));
					},
					getFileSize: async (p: string) => {
						try {
							const uri = URI.file(p);
							const stat = await this.fileService.stat(uri);
							return stat.size;
						} catch {
							return undefined;
						}
					}
				}
			});

			const analyzer = new CanonicalGraphAnalyzer({ parseService: this._parseService });
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
		if (!this._gitHistoryService) {
			this._log(localize('prebase.graph.noGit', "Git history service is not available."));
			return undefined;
		}
		const folder = this.workspaceService.getWorkspace().folders[0];
		if (!folder) {
			return undefined;
		}
		const rootPath = folder.uri.fsPath || folder.uri.path;
		const limits = this._scanLimits();
		const analyzer = new CanonicalGraphAnalyzer({
			maxCanonicalFiles: limits.maxCanonicalFiles,
			maxFileSizeBytes: limits.maxFileSizeBytes,
			parseService: this._parseService,
		});

		try {
			const commitSha = await this._gitHistoryService.resolveRef(rootPath, ref, token);
			const source = new GitTreeContentSource(this._gitHistoryService, rootPath, commitSha, {
				maxScanFiles: limits.maxCanonicalFiles,
				maxFileSizeBytes: limits.maxFileSizeBytes,
				projectName: folder.name,
			});
			return await analyzer.analyze(source, token);
		} catch (err: any) {
			this._log(localize('prebase.graph.historicalAnalysisFailed', "Historical graph analysis failed for ref {0}: {1}", ref, err?.message || String(err)));
			return undefined;
		}
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

	private _selectedHistoricalCommitSha?: string;

	getSelectedHistoricalCommitSha(): string | undefined {
		return this._selectedHistoricalCommitSha;
	}

	async loadHistoricalCommit(commitSha?: string, token?: CancellationToken): Promise<PreBaseEnrichedSnapshot | undefined> {
		if (!commitSha || commitSha === 'HEAD' || commitSha === 'working-tree') {
			this._selectedHistoricalCommitSha = undefined;
			if (this._canonicalSnapshot) {
				return this._projectAndPublish(this._canonicalSnapshot);
			}
			return this.scanWorkspace(token);
		}

		this._selectedHistoricalCommitSha = commitSha;
		this._setDiagnostics({
			status: 'scanning',
			message: localize('prebase.graph.loadingHistorical', "Loading historical graph at {0}…", commitSha.slice(0, 7))
		});

		try {
			const canonical = await this.buildCanonicalGraphAtRef(commitSha, token);
			if (!canonical || token?.isCancellationRequested) {
				return undefined;
			}
			const enriched = this._projectAndPublish(canonical);
			this._setDiagnostics({
				status: 'ready',
				message: localize('prebase.graph.historicalReady', "Commit {0} · {1} files · {2} nodes", commitSha.slice(0, 7), canonical.coverage.analyzedCount, enriched.nodes.length)
			});
			return enriched;
		} catch (err: any) {
			const message = err instanceof Error ? err.message : String(err);
			this._setDiagnostics({ status: 'error', message: localize('prebase.graph.historicalFailed', "Failed to load historical commit {0}: {1}", commitSha.slice(0, 7), message) });
			return undefined;
		}
	}

	private _projectAndPublish(canonical: CanonicalGraphSnapshot): PreBaseEnrichedSnapshot {
		if (this._canonicalSnapshot !== canonical || !this._canonicalIndex) {
			this._canonicalIndex = new CanonicalQueryIndex(canonical);
		}

		const limits = this._scanLimits();
		const networkLayoutMode = this._getNetworkLayoutMode();
		const spread = Math.max(0.4, Math.min(2.5, this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphNetworkSpreadScale) || 1));
		const hideLow = this.configurationService.getValue<boolean>(PreBaseGraphConfigKeys.GraphHideLowImportance) === true;

		const projection = projectNetworkGraph(canonical, {
			maxRenderedNodes: limits.maxNodes,
			maxRenderedEdges: limits.maxEdges,
			hideLowImportance: hideLow,
			networkLayoutMode,
			spreadScale: spread * Math.max(0.5, Math.min(2, this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphNetworkPhysicsStrength) || 1)),
			collisionRadius: Math.max(2, this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphNetworkCollisionRadius) || 24),
			linkDistance: Math.max(4, this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphNetworkLinkDistance) || 80),
			forceStrength: Math.max(0, Math.min(2, this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphNetworkForceStrength) ?? 0.35)),
			layoutRevision: ++this._layoutRevision,
		});

		const isCapped = canonical.nodes.length > projection.nodes.length;
		const diagnostics: PreBaseGraphDiagnostics = {
			fileCount: canonical.coverage.analyzedCount,
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
				: localize('prebase.graph.ready', "{0} files · {1} nodes · {2} edges", canonical.coverage.analyzedCount, projection.nodes.length, projection.edges.length)
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

	private _scanLimits(): { maxNodes: number; maxEdges: number; maxCanonicalFiles: number; maxFileSizeBytes: number } {
		const quality = this.configurationService.getValue<string>(PreBaseGraphConfigKeys.GraphQuality) || 'auto';
		const configuredNodes = this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphMaxRenderedNodes) || 280;
		const configuredEdges = this.configurationService.getValue<number>(PreBaseGraphConfigKeys.GraphMaxRenderedEdges) || 420;
		if (quality === 'performance') {
			return {
				maxNodes: Math.min(180, configuredNodes),
				maxEdges: Math.min(280, configuredEdges),
				maxCanonicalFiles: 5_000,
				maxFileSizeBytes: 300_000,
			};
		}
		if (quality === 'quality') {
			return {
				maxNodes: configuredNodes,
				maxEdges: configuredEdges,
				maxCanonicalFiles: 20_000,
				maxFileSizeBytes: 1_000_000,
			};
		}
		return {
			maxNodes: Math.min(280, configuredNodes),
			maxEdges: Math.min(420, configuredEdges),
			maxCanonicalFiles: 10_000,
			maxFileSizeBytes: 500_000,
		};
	}

	private _getNetworkLayoutMode(): NetworkLayoutMode {
		const mode = this.configurationService.getValue<string>(PreBaseGraphConfigKeys.GraphNetworkLayoutMode) || 'organic';
		const normalized = normalizeNetworkLayoutMode(mode);
		if (mode !== normalized) {
			void this.configurationService.updateValue(PreBaseGraphConfigKeys.GraphNetworkLayoutMode, normalized);
		}
		return normalized;
	}

	/** Returns the IGitRepository for the given filesystem path, if open and known. */
	private _findGitRepositoryForPath(fsPath: string): IGitRepository | undefined {
		const normalizedTarget = fsPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
		for (const repo of this.gitService.repositories) {
			const repoFsPath = (repo.rootUri.fsPath || repo.rootUri.path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
			if (repoFsPath === normalizedTarget) {
				return repo;
			}
		}
		const all = Array.from(this.gitService.repositories);
		return all.length === 1 ? all[0] : undefined;
	}

	/** Ensures the repository for the given path is opened and tracked by git service. */
	private async _ensureGitRepositoryForPath(fsPath: string): Promise<IGitRepository | undefined> {
		let repo = this._findGitRepositoryForPath(fsPath);
		if (repo) {
			return repo;
		}
		if (this.gitService && typeof this.gitService.openRepository === 'function') {
			try {
				const uri = URI.file(fsPath);
				repo = await Promise.race([
					this.gitService.openRepository(uri),
					new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1500))
				]);
				if (repo) {
					this._wireRepositoryHeadObserver(repo);
				}
			} catch {
				// Non-git folder or open failed
			}
		}
		return repo || this._findGitRepositoryForPath(fsPath);
	}

	/**
	 * Subscribes to HEAD state changes on any IGitRepository that is currently
	 * open in the git service but not yet observed. Safe to call repeatedly.
	 */
	private _checkAndWireHeadObservers(): void {
		for (const repo of this.gitService.repositories) {
			this._wireRepositoryHeadObserver(repo);
		}
	}

	/**
	 * Attaches an observable subscription to `repo.state` so that whenever
	 * HEAD.commit changes we forward it to `_gitHistoryService.notifyHeadChanged()`.
	 * Idempotent — calling it twice for the same repository is a no-op.
	 */
	private _wireRepositoryHeadObserver(repo: IGitRepository): void {
		const repoId = repo.rootUri.toString();
		if (this._repositoryHeadObservers.has(repoId)) {
			return; // Already observing this repository.
		}
		let lastHeadCommit: string | undefined;
		const store = new DisposableStore();
		repo.state.recomputeInitiallyAndOnChange(store, (state) => {
			const headCommit = state.HEAD?.commit;
			if (headCommit && headCommit !== lastHeadCommit) {
				lastHeadCommit = headCommit;
				this._gitHistoryService?.notifyHeadChanged(repoId, headCommit, 'external');
			}
		});
		this._repositoryHeadObservers.set(repoId, store);
		this._register(store);
	}

	private _isActiveScan(cts: CancellationTokenSource): boolean {
		return this._scanCts === cts;
	}

	private _markCancelledIfActive(cts: CancellationTokenSource): void {
		if (this._isActiveScan(cts)) {
			this._setDiagnostics({ status: 'cancelled', message: localize('prebase.graph.scanCancelled', "Scan cancelled.") });
		}
	}

	private _visitDependencies(
		edges: readonly AdjacentEdgeInfo[] | undefined,
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

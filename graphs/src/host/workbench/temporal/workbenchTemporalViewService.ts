/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { Emitter, type Event } from '../../../../../../../base/common/event.js';
import { CancellationTokenSource } from '../../../../../../../base/common/cancellation.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../../../../platform/workspace/common/workspace.js';
import { ICommandService } from '../../../../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../../../../platform/log/common/log.js';
import { IEditorService } from '../../../../../../../workbench/services/editor/common/editorService.js';
import { IWorkbenchGitHistoryService } from '../workbenchGitHistoryService.js';
import { IPreBaseTemporalGraphService } from '../workbenchTemporalGraphService.js';
import {
	IPreBaseTemporalViewService,
	type ITemporalViewState,
	type TemporalCommitSummary,
	type TemporalStructuralDiff,
	type TemporalDisplayMode,
	type TemporalRepositoryDescriptor,
} from '../../../temporal/view/temporalViewTypes.js';
import { computeTemporalStructuralDiff } from '../../../temporal/view/temporalStructuralDiff.js';
import { layoutTemporalGraph } from '../../../temporal/view/temporalLayoutEngine.js';
import type { GitHeadChangeEvent } from '../../../history/git/gitHistoryService.js';
import type {
	TemporalCommitSummary as ITemporalStoreCommitSummary,
	TemporalEntitySnapshot,
	TemporalEdgeSnapshot,
	TemporalRepositoryRef,
} from '../../../temporal/common/temporalTypes.js';

const PAGE_SIZE = 50;
const MAX_DIFF_CACHE_ENTRIES = 25;
const SCRUB_DEBOUNCE_MS = 120;

export class WorkbenchTemporalViewService extends Disposable implements IPreBaseTemporalViewService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<ITemporalViewState>());
	readonly onDidChangeState: Event<ITemporalViewState> = this._onDidChangeState.event;

	private readonly _onDidChangeTimeline = this._register(new Emitter<readonly TemporalCommitSummary[]>());
	readonly onDidChangeTimeline: Event<readonly TemporalCommitSummary[]> = this._onDidChangeTimeline.event;

	private readonly _onDidChangeDiff = this._register(new Emitter<TemporalStructuralDiff>());
	readonly onDidChangeDiff: Event<TemporalStructuralDiff> = this._onDidChangeDiff.event;

	private _availableRepositories: TemporalRepositoryDescriptor[] = [];
	private _activeRepositoryId?: string;
	private _activeRepositoryRoot?: string;
	private _repositoryRefs: TemporalRepositoryRef[] = [];
	private _selectedRef: string = 'HEAD';
	private _selectedCommitSha: string = '';
	private _renderedCommitSha?: string;
	private _isLoadingSelection: boolean = false;
	private _selectionError?: string;
	private _compareBaseSha?: string;
	private _customCompareBase?: string;
	private _comparisonMode: 'first-parent' | 'explicit-parent' | 'arbitrary' = 'first-parent';
	private _followHead: boolean = true;
	private _displayMode: TemporalDisplayMode = 'changes';
	private _filterQuery: string = '';
	private _selectedEntityId?: string;

	private _pagedTimeline: TemporalCommitSummary[] = [];
	private _loadedCommitCount: number = 0;
	private _historyHasMore: boolean = false;
	private _historyNextCursor?: string;
	private _isLoadingMoreHistory: boolean = false;
	private _isSettled: boolean = false;
	private _isPartialLineage: boolean = false;
	private _currentDiff?: TemporalStructuralDiff;

	private readonly _positions = new Map<string, { x: number; y: number }>();
	private readonly _diffCache = new Map<string, TemporalStructuralDiff>();
	private _scrubTimer: any = undefined;
	private _historyGenerationToken: number = 0;
	private _historyCts?: CancellationTokenSource;
	private _generationToken: number = 0;
	private _activeCts?: CancellationTokenSource;
	private _initPromise?: Promise<void>;

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IWorkbenchGitHistoryService private readonly _gitHistoryService: IWorkbenchGitHistoryService,
		@IPreBaseTemporalGraphService private readonly _temporalGraphService: IPreBaseTemporalGraphService,
		@ICommandService private readonly _commandService: ICommandService,
		@IEditorService private readonly _editorService: IEditorService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		if (this._gitHistoryService?.onDidChangeHead) {
			this._register(this._gitHistoryService.onDidChangeHead(e => {
				if (this._followHead) {
					void this._handleHeadChanged(e);
				}
			}));
		}

		if (this._workspaceContextService?.onDidChangeWorkspaceFolders) {
			this._register(this._workspaceContextService.onDidChangeWorkspaceFolders(() => {
				this._activeRepositoryRoot = undefined;
				this._activeRepositoryId = undefined;
				this._diffCache.clear();
				this._positions.clear();
				void this.refresh();
			}));
		}
	}

	getState(): ITemporalViewState {
		return {
			availableRepositories: this._availableRepositories,
			activeRepositoryId: this._activeRepositoryId,
			activeRepositoryRoot: this._activeRepositoryRoot,
			repositoryRefs: this._repositoryRefs,
			selectedRef: this._selectedRef,
			selectedCommitSha: this._selectedCommitSha,
			renderedCommitSha: this._renderedCommitSha,
			isLoadingSelection: this._isLoadingSelection,
			selectionError: this._selectionError,
			compareBaseSha: this._compareBaseSha,
			customCompareBase: this._customCompareBase,
			comparisonMode: this._comparisonMode,
			followHead: this._followHead,
			displayMode: this._displayMode,
			pagedTimeline: this._pagedTimeline,
			loadedCommitCount: this._loadedCommitCount,
			totalAvailableCommits: this._pagedTimeline.length,
			historyHasMore: this._historyHasMore,
			historyNextCursor: this._historyNextCursor,
			isSettled: this._isSettled,
			isPartialLineage: this._isPartialLineage,
			diff: this._currentDiff,
			selectedEntityId: this._selectedEntityId,
			filterQuery: this._filterQuery,
		};
	}

	private _updateAvailableRepositories(): void {
		const repos: TemporalRepositoryDescriptor[] = [];
		try {
			if (this._gitHistoryService?.getRepositories) {
				const gitRepos = this._gitHistoryService.getRepositories();
				for (const r of gitRepos) {
					const rootPath = r.rootUri.fsPath || r.rootUri.path;
					const label = getBaseName(rootPath);
					repos.push({
						id: r.rootUri.toString(),
						rootUri: rootPath,
						label,
					});
				}
			}
		} catch {
			// ignore git history service query failure
		}

		if (repos.length === 0) {
			const workspace = this._workspaceContextService.getWorkspace();
			const folders = workspace?.folders || [];
			for (const f of folders) {
				const rootPath = f.uri.fsPath || f.uri.path;
				repos.push({
					id: f.uri.toString(),
					rootUri: rootPath,
					label: f.name || getBaseName(rootPath),
				});
			}
		}

		this._availableRepositories = repos;
	}

	private _getActiveRepoRoot(): string | undefined {
		if (this._activeRepositoryRoot) {
			return this._activeRepositoryRoot;
		}
		this._updateAvailableRepositories();
		if (this._availableRepositories.length > 0) {
			const first = this._availableRepositories[0];
			this._activeRepositoryRoot = first.rootUri;
			this._activeRepositoryId = first.id;
			return first.rootUri;
		}
		return undefined;
	}

	async initialize(): Promise<void> {
		if (this._initPromise) {
			return this._initPromise;
		}
		this._initPromise = this._doInitialize();
		try {
			await this._initPromise;
		} finally {
			this._initPromise = undefined;
		}
	}

	async switchRepository(repoRoot: string): Promise<void> {
		if (!repoRoot || repoRoot === this._activeRepositoryRoot) {
			return;
		}

		if (this._scrubTimer) {
			clearTimeout(this._scrubTimer);
			this._scrubTimer = undefined;
		}
		this._historyCts?.cancel();
		this._historyCts?.dispose();
		this._historyCts = undefined;
		this._activeCts?.cancel();
		this._activeCts?.dispose();
		this._activeCts = undefined;

		this._historyGenerationToken++;
		this._generationToken++;

		this._activeRepositoryRoot = repoRoot;
		this._diffCache.clear();
		this._positions.clear();
		this._pagedTimeline = [];
		this._loadedCommitCount = 0;
		this._historyNextCursor = undefined;
		this._historyHasMore = false;
		this._selectedCommitSha = '';
		this._renderedCommitSha = undefined;
		this._isLoadingSelection = false;
		this._selectionError = undefined;
		this._currentDiff = undefined;
		this._compareBaseSha = undefined;
		this._customCompareBase = undefined;

		await this.initialize();
	}

	private async _doInitialize(): Promise<void> {
		this._updateAvailableRepositories();
		const root = this._getActiveRepoRoot();
		if (!root) {
			this._notifyStateChanged();
			return;
		}

		try {
			if (this._gitHistoryService?.getRepositoryIdentity) {
				const identity = await this._gitHistoryService.getRepositoryIdentity(root);
				this._activeRepositoryId = identity?.repositoryId;
			}
		} catch {
			// ignore identity lookup failure on non-git
		}

		try {
			const refs = await this._temporalGraphService.getRepositoryRefs(root);
			this._repositoryRefs = refs || [];
		} catch (err) {
			this._logService.warn('[WorkbenchTemporalViewService] Failed to load repository refs:', err);
			this._repositoryRefs = [];
		}

		await this.selectRef(this._selectedRef || 'HEAD');
	}

	async selectRef(refName: string): Promise<void> {
		this._selectedRef = refName;
		if (refName !== 'HEAD' && refName !== '') {
			this._followHead = false;
		}

		const root = this._getActiveRepoRoot();
		if (!root) {
			return;
		}

		const currentGen = ++this._historyGenerationToken;
		this._historyCts?.cancel();
		this._historyCts?.dispose();
		const cts = new CancellationTokenSource();
		this._historyCts = cts;

		try {
			// Refresh refs in background
			try {
				const refs = await this._temporalGraphService.getRepositoryRefs(root);
				if (refs && refs.length > 0) {
					this._repositoryRefs = refs;
				}
			} catch {
				// retain existing refs
			}

			if (cts.token.isCancellationRequested || this._historyGenerationToken !== currentGen) {
				return;
			}

			// Reset pagination state for new ref
			this._historyNextCursor = undefined;
			const historyPage = await this._temporalGraphService.getHistoryPage(root, {
				ref: refName,
				pageSize: PAGE_SIZE,
			});

			if (cts.token.isCancellationRequested || this._historyGenerationToken !== currentGen) {
				return;
			}

			this._historyHasMore = Boolean(historyPage.hasMore);
			this._historyNextCursor = historyPage.nextCursor;

			this._pagedTimeline = historyPage.commits.map((c: ITemporalStoreCommitSummary) => ({
				sha: c.sha,
				shortSha: c.sha.slice(0, 7),
				message: c.message,
				author: c.authorName,
				timestamp: c.authorTimestamp,
				parents: c.parents || [],
				isMerge: (c.parents || []).length > 1,
				isCheckpoint: false,
				isSettled: c.indexStatus?.status === 'ready',
			}));
			this._loadedCommitCount = this._pagedTimeline.length;

			this._onDidChangeTimeline.fire(this._pagedTimeline);

			if (this._pagedTimeline.length > 0) {
				const headSha = this._pagedTimeline[0].sha;
				await this.selectCommit(headSha, { immediate: true });
			} else {
				this._selectedCommitSha = '';
				this._renderedCommitSha = undefined;
				this._isLoadingSelection = false;
				this._currentDiff = undefined;
				this._notifyStateChanged();
			}
		} catch (err) {
			if (!cts.token.isCancellationRequested && this._historyGenerationToken === currentGen) {
				this._logService.error('[WorkbenchTemporalViewService] Failed to load commit history for ref:', refName, err);
			}
		} finally {
			if (this._historyCts === cts) {
				this._historyCts = undefined;
			}
			cts.dispose();
		}
	}

	async loadMoreHistory(): Promise<void> {
		const root = this._getActiveRepoRoot();
		if (!root || !this._historyHasMore || !this._historyNextCursor || this._isLoadingMoreHistory) {
			return;
		}

		this._isLoadingMoreHistory = true;
		const currentGen = this._historyGenerationToken;

		try {
			const historyPage = await this._temporalGraphService.getHistoryPage(root, {
				cursor: this._historyNextCursor,
				pageSize: PAGE_SIZE,
			});

			if (this._historyGenerationToken !== currentGen) {
				return;
			}

			const existingShas = new Set(this._pagedTimeline.map(c => c.sha));
			const newItems = historyPage.commits
				.filter((c: ITemporalStoreCommitSummary) => !existingShas.has(c.sha))
				.map((c: ITemporalStoreCommitSummary) => ({
					sha: c.sha,
					shortSha: c.sha.slice(0, 7),
					message: c.message,
					author: c.authorName,
					timestamp: c.authorTimestamp,
					parents: c.parents || [],
					isMerge: (c.parents || []).length > 1,
					isCheckpoint: false,
					isSettled: c.indexStatus?.status === 'ready',
				}));

			this._pagedTimeline = [...this._pagedTimeline, ...newItems];
			this._loadedCommitCount = this._pagedTimeline.length;
			this._historyHasMore = Boolean(historyPage.hasMore);
			this._historyNextCursor = historyPage.nextCursor;

			this._onDidChangeTimeline.fire(this._pagedTimeline);
			this._notifyStateChanged();
		} catch (err) {
			this._logService.error('[WorkbenchTemporalViewService] Failed to load more history:', err);
		} finally {
			this._isLoadingMoreHistory = false;
		}
	}

	async selectCommit(commitSha: string, options?: { compareBaseSha?: string; immediate?: boolean }): Promise<void> {
		if (!commitSha) {
			return;
		}

		this._selectedCommitSha = commitSha;
		this._isLoadingSelection = true;
		this._selectionError = undefined;

		if (options?.compareBaseSha !== undefined) {
			this._compareBaseSha = options.compareBaseSha;
			this._customCompareBase = options.compareBaseSha;
			this._comparisonMode = 'arbitrary';
		} else if (this._customCompareBase) {
			this._compareBaseSha = this._customCompareBase;
			this._comparisonMode = 'arbitrary';
		} else {
			const commit = this._pagedTimeline.find(c => c.sha === commitSha);
			this._compareBaseSha = commit?.parents?.[0];
			this._comparisonMode = 'first-parent';
		}

		if (options?.immediate) {
			if (this._scrubTimer) {
				clearTimeout(this._scrubTimer);
				this._scrubTimer = undefined;
			}
			await this._reconstructDiffForSelection(commitSha, this._compareBaseSha);
		} else {
			if (this._scrubTimer) {
				clearTimeout(this._scrubTimer);
			}
			this._notifyStateChanged();
			this._scrubTimer = setTimeout(() => {
				this._scrubTimer = undefined;
				void this._reconstructDiffForSelection(commitSha, this._compareBaseSha);
			}, SCRUB_DEBOUNCE_MS);
		}
	}

	async setCompareBase(compareBaseSha: string | undefined): Promise<void> {
		this._compareBaseSha = compareBaseSha;
		this._customCompareBase = compareBaseSha;
		const commit = this._pagedTimeline.find(c => c.sha === this._selectedCommitSha);
		if (compareBaseSha === commit?.parents?.[0]) {
			this._comparisonMode = 'first-parent';
		} else if (commit?.parents && commit.parents.length > 1 && compareBaseSha === commit.parents[1]) {
			this._comparisonMode = 'explicit-parent';
		} else if (compareBaseSha) {
			this._comparisonMode = 'arbitrary';
		} else {
			this._comparisonMode = 'first-parent';
		}

		if (this._selectedCommitSha) {
			await this._reconstructDiffForSelection(this._selectedCommitSha, this._compareBaseSha);
		}
	}

	setDisplayMode(mode: TemporalDisplayMode): void {
		this._displayMode = mode;
		this._notifyStateChanged();
	}

	setFollowHead(follow: boolean): void {
		this._followHead = follow;
		if (follow && this._selectedRef !== 'HEAD') {
			void this.selectRef('HEAD');
			return;
		}
		this._notifyStateChanged();
	}

	setFilterQuery(query: string): void {
		this._filterQuery = query;
		this._notifyStateChanged();
	}

	selectEntity(entityId: string | undefined): void {
		this._selectedEntityId = entityId;
		this._notifyStateChanged();
	}

	private async _reconstructDiffForSelection(targetSha: string, baseSha?: string): Promise<void> {
		const root = this._getActiveRepoRoot();
		if (!root) {
			this._isLoadingSelection = false;
			this._notifyStateChanged();
			return;
		}

		const cachePrefix = `${this._activeRepositoryId || root}::${targetSha}..${baseSha || 'root'}`;
		const cached = this._diffCache.get(cachePrefix);
		if (cached) {
			this._diffCache.delete(cachePrefix);
			this._diffCache.set(cachePrefix, cached);

			this._renderedCommitSha = targetSha;
			this._isLoadingSelection = false;
			this._selectionError = undefined;
			this._currentDiff = cached;
			this._isSettled = true;
			this._isPartialLineage = cached.isPartialLineage;
			this._onDidChangeDiff.fire(cached);
			this._notifyStateChanged();
			return;
		}

		const currentGen = ++this._generationToken;
		this._activeCts?.cancel();
		this._activeCts?.dispose();
		const cts = new CancellationTokenSource();
		this._activeCts = cts;

		try {
			let baseEntities: readonly TemporalEntitySnapshot[] | undefined;
			let baseEdges: readonly TemporalEdgeSnapshot[] | undefined;

			if (baseSha) {
				const baseStatus = await this._temporalGraphService.getCommitIndexStatus(root, baseSha, cts.token);
				const isBaseReady = baseStatus.status === 'ready' || baseStatus.status === 'incomplete';
				const baseGraph = isBaseReady
					? await this._temporalGraphService.getGraphAtCommit(root, baseSha, cts.token)
					: await this._temporalGraphService.ensureCommitIndexed(root, baseSha, cts.token);

				baseEntities = baseGraph?.entityMap ? Array.from(baseGraph.entityMap.values()) : [];
				baseEdges = baseGraph?.edgeMap ? Array.from(baseGraph.edgeMap.values()) : [];
			}

			if (cts.token.isCancellationRequested || this._generationToken !== currentGen) {
				return;
			}

			const targetPreStatus = await this._temporalGraphService.getCommitIndexStatus(root, targetSha, cts.token);
			const isTargetReady = targetPreStatus.status === 'ready' || targetPreStatus.status === 'incomplete';

			const targetGraph = isTargetReady
				? await this._temporalGraphService.getGraphAtCommit(root, targetSha, cts.token)
				: await this._temporalGraphService.ensureCommitIndexed(root, targetSha, cts.token);

			const targetEntities: TemporalEntitySnapshot[] = targetGraph?.entityMap ? Array.from(targetGraph.entityMap.values()) : [];
			const targetEdges: TemporalEdgeSnapshot[] = targetGraph?.edgeMap ? Array.from(targetGraph.edgeMap.values()) : [];

			if (cts.token.isCancellationRequested || this._generationToken !== currentGen) {
				return;
			}

			const finalTargetStatus = await this._temporalGraphService.getCommitIndexStatus(root, targetSha, cts.token);
			const isFinalReady = finalTargetStatus.status === 'ready' || finalTargetStatus.status === 'incomplete';
			const isPartial = finalTargetStatus.lineageCoverage?.kind === 'partial';

			const rawDiff = computeTemporalStructuralDiff(
				targetSha,
				targetEntities,
				targetEdges,
				baseSha,
				baseEntities,
				baseEdges,
				{
					isPartialLineage: isPartial,
					partialLineageReason: isPartial ? 'Background lineage indexing in progress' : undefined,
				},
			);

			const layoutResult = layoutTemporalGraph(rawDiff, this._positions);
			for (const [id, pos] of layoutResult.positions) {
				this._positions.set(id, pos);
			}

			const diffWithLayout: TemporalStructuralDiff = {
				...rawDiff,
				nodes: layoutResult.nodes,
			};

			if (!isPartial) {
				this._diffCache.set(cachePrefix, diffWithLayout);
				if (this._diffCache.size > MAX_DIFF_CACHE_ENTRIES) {
					const firstKey = this._diffCache.keys().next().value;
					if (firstKey) {
						this._diffCache.delete(firstKey);
					}
				}
			}

			this._renderedCommitSha = targetSha;
			this._isLoadingSelection = false;
			this._selectionError = undefined;
			this._isSettled = isFinalReady;
			this._isPartialLineage = isPartial;
			this._currentDiff = diffWithLayout;

			this._onDidChangeDiff.fire(diffWithLayout);
			this._notifyStateChanged();
		} catch (err: any) {
			if (!cts.token.isCancellationRequested && this._generationToken === currentGen) {
				this._logService.error('[WorkbenchTemporalViewService] Failed to reconstruct diff:', err);
				this._isLoadingSelection = false;
				this._selectionError = err?.message || `Failed to reconstruct graph for ${targetSha.slice(0, 7)}`;
				this._notifyStateChanged();
			}
		} finally {
			if (this._activeCts === cts) {
				this._activeCts = undefined;
			}
			cts.dispose();
		}
	}

	async openSourceDiff(entityId: string): Promise<void> {
		if (!this._currentDiff) {
			return;
		}

		const node = this._currentDiff.nodes.find(n => n.entityId === entityId);
		if (!node) {
			return;
		}

		const root = this._getActiveRepoRoot();
		if (!root) {
			return;
		}

		const targetSha = this._selectedCommitSha;
		const baseSha = this._compareBaseSha;
		const targetPath = node.path;
		const basePath = node.oldPath || node.path;

		try {
			let baseUri: URI;
			let targetUri: URI;

			if (node.changeKind === 'added' || !baseSha) {
				baseUri = await this._createEmptyGitUri(root, targetPath);
				targetUri = this._createGitResourceUri(root, targetPath, targetSha);
			} else if (node.changeKind === 'removed') {
				baseUri = this._createGitResourceUri(root, basePath, baseSha);
				targetUri = await this._createEmptyGitUri(root, basePath);
			} else {
				baseUri = this._createGitResourceUri(root, basePath, baseSha);
				targetUri = this._createGitResourceUri(root, targetPath, targetSha);
			}

			const title = `${node.label} (${baseSha ? baseSha.slice(0, 7) : 'Empty'} ↔ ${targetSha ? targetSha.slice(0, 7) : 'Current'})`;
			await this._commandService.executeCommand('vscode.diff', baseUri, targetUri, title);
		} catch (err) {
			this._logService.warn('[WorkbenchTemporalViewService] Source diff command failed:', err);
		}
	}

	async openHistoricalFile(entityId: string): Promise<void> {
		if (!this._currentDiff) {
			return;
		}

		const node = this._currentDiff.nodes.find(n => n.entityId === entityId);
		if (!node) {
			return;
		}

		const root = this._getActiveRepoRoot();
		if (!root) {
			return;
		}

		try {
			if (node.changeKind === 'removed' && this._compareBaseSha) {
				const baseUri = this._createGitResourceUri(root, node.oldPath || node.path, this._compareBaseSha);
				await this._editorService.openEditor({ resource: baseUri, options: { pinned: false } });
			} else {
				const gitUri = this._createGitResourceUri(root, node.path, this._selectedCommitSha);
				await this._editorService.openEditor({ resource: gitUri, options: { pinned: false } });
			}
		} catch (err) {
			this._logService.warn('[WorkbenchTemporalViewService] Open historical file failed:', err);
		}
	}

	private _createGitResourceUri(rootFsPath: string, relativePath: string, ref: string): URI {
		const cleanRel = relativePath.replace(/^[/\\]+/, '');
		const fullPath = rootFsPath.endsWith('/') || rootFsPath.endsWith('\\')
			? `${rootFsPath}${cleanRel}`
			: `${rootFsPath}/${cleanRel}`;
		const fileUri = URI.file(fullPath);

		return fileUri.with({
			scheme: 'git',
			path: fileUri.path,
			query: JSON.stringify({ path: fileUri.fsPath, ref }),
		});
	}

	private async _createEmptyGitUri(rootFsPath: string, relativePath: string): Promise<URI> {
		const cleanRel = relativePath.replace(/^[/\\]+/, '');
		const fullPath = rootFsPath.endsWith('/') || rootFsPath.endsWith('\\')
			? `${rootFsPath}${cleanRel}`
			: `${rootFsPath}/${cleanRel}`;
		const fileUri = URI.file(fullPath);

		let emptyTreeRef = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
		try {
			if (this._gitHistoryService?.getEmptyTree) {
				emptyTreeRef = await this._gitHistoryService.getEmptyTree(rootFsPath);
			}
		} catch {
			// fallback
		}

		return fileUri.with({
			scheme: 'git',
			path: `${fileUri.path}.empty`,
			query: JSON.stringify({ path: fileUri.fsPath, ref: emptyTreeRef }),
		});
	}

	async refresh(): Promise<void> {
		this._diffCache.clear();
		this._positions.clear();
		await this.initialize();
	}

	private async _handleHeadChanged(e: GitHeadChangeEvent): Promise<void> {
		if (this._activeRepositoryId && e.repositoryId && e.repositoryId !== this._activeRepositoryId) {
			return;
		}
		if (e.currentHead && e.currentHead !== this._selectedCommitSha) {
			await this.selectRef(this._selectedRef);
		}
	}

	private _notifyStateChanged(): void {
		this._onDidChangeState.fire(this.getState());
	}

	override dispose(): void {
		if (this._scrubTimer) {
			clearTimeout(this._scrubTimer);
			this._scrubTimer = undefined;
		}
		this._historyCts?.cancel();
		this._historyCts?.dispose();
		this._historyCts = undefined;
		this._activeCts?.cancel();
		this._activeCts?.dispose();
		this._activeCts = undefined;
		this._diffCache.clear();
		this._positions.clear();
		super.dispose();
	}
}

function getBaseName(p: string): string {
	const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
	return lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
}


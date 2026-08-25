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
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../../platform/storage/common/storage.js';
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
	type TemporalComparisonSelection,
	type TemporalComparisonMode,
} from '../../../temporal/view/temporalViewTypes.js';
import { computeTemporalStructuralDiff } from '../../../temporal/view/temporalStructuralDiff.js';
import { layoutTemporalGraph } from '../../../temporal/view/temporalLayoutEngine.js';
import { GitHistoryError, type GitHeadChangeEvent } from '../../../history/git/gitHistoryService.js';
import type {
	TemporalCommitSummary as ITemporalStoreCommitSummary,
	TemporalEntitySnapshot,
	TemporalEdgeSnapshot,
	TemporalRepositoryRef,
} from '../../../temporal/common/temporalTypes.js';

const PAGE_SIZE = 50;
const MAX_DIFF_CACHE_ENTRIES = 25;
const MAX_POSITIONS_CACHE_ENTRIES = 10000;
const TIMELINE_WINDOW_SIZE = 100;
const SCRUB_DEBOUNCE_MS = 120;
const STORAGE_KEY_TEMPORAL_VIEW = 'prebase.temporal.viewState.v1';

interface IPersistedTemporalViewState {
	readonly activeRepositoryRoot?: string;
	readonly selectedRef?: string;
	readonly selectedCommitSha?: string;
	readonly displayMode?: TemporalDisplayMode;
	readonly followHead?: boolean;
	readonly comparisonSelection?: TemporalComparisonSelection;
}

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
	private _isLoadingHistory: boolean = false;
	private _historyError?: string;
	private _isLoadingMoreHistory: boolean = false;
	private _historyLoadMoreError?: string;

	private _comparisonSelection: TemporalComparisonSelection = { mode: 'first-parent' };
	private _compareBaseSha?: string;
	private _renderedCompareBaseSha?: string;

	private _followHead: boolean = true;
	private _displayMode: TemporalDisplayMode = 'state';
	private _filterQuery: string = '';
	private _selectedEntityId?: string;

	private _pagedTimeline: TemporalCommitSummary[] = [];
	private _loadedCommitCount: number = 0;
	private _historyHasMore: boolean = false;
	private _historyNextCursor?: string;
	private _isSettled: boolean = false;
	private _isPartialLineage: boolean = false;
	private _currentDiff?: TemporalStructuralDiff;

	private readonly _positions = new Map<string, { x: number; y: number }>();
	private readonly _diffCache = new Map<string, TemporalStructuralDiff>();
	private _scrubTimer: any = undefined;
	private _historyGenerationToken: number = 0;
	private _historyCts?: CancellationTokenSource;
	private _loadMoreCts?: CancellationTokenSource;
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
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();

		if (this._gitHistoryService?.onDidChangeHead) {
			this._register(this._gitHistoryService.onDidChangeHead(e => {
				void this._handleHeadChanged(e);
			}));
		}

		if (this._workspaceContextService?.onDidChangeWorkspaceFolders) {
			this._register(this._workspaceContextService.onDidChangeWorkspaceFolders(() => {
				this._cancelActiveRequests();
				this._activeRepositoryRoot = undefined;
				this._activeRepositoryId = undefined;
				this._diffCache.clear();
				this._positions.clear();
				void this.refresh();
			}));
		}
	}

	private _cancelActiveRequests(): void {
		if (this._scrubTimer) {
			clearTimeout(this._scrubTimer);
			this._scrubTimer = undefined;
		}
		this._historyGenerationToken++;
		this._generationToken++;
		this._historyCts?.cancel();
		this._historyCts?.dispose();
		this._historyCts = undefined;
		this._loadMoreCts?.cancel();
		this._loadMoreCts?.dispose();
		this._loadMoreCts = undefined;
		this._activeCts?.cancel();
		this._activeCts?.dispose();
		this._activeCts = undefined;
	}

	getState(): ITemporalViewState {
		const total = this._loadedCommitCount || this._pagedTimeline.length;
		const currentIdx = this._pagedTimeline.findIndex(c => c.sha === this._selectedCommitSha);
		const curCommit = currentIdx >= 0 ? this._pagedTimeline[currentIdx] : undefined;

		const renderedIdx = this._renderedCommitSha ? this._pagedTimeline.findIndex(c => c.sha === this._renderedCommitSha) : -1;
		const renderedCommit = renderedIdx >= 0 ? this._pagedTimeline[renderedIdx] : undefined;

		const renderedBaseIdx = this._renderedCompareBaseSha ? this._pagedTimeline.findIndex(c => c.sha === this._renderedCompareBaseSha) : -1;
		const renderedBaseCommit = renderedBaseIdx >= 0 ? this._pagedTimeline[renderedBaseIdx] : undefined;

		// Bounded timeline window (up to TIMELINE_WINDOW_SIZE around selection)
		let windowedTimeline: TemporalCommitSummary[] = this._pagedTimeline;
		let windowStart = 0;
		if (total > TIMELINE_WINDOW_SIZE && currentIdx >= 0) {
			const half = Math.floor(TIMELINE_WINDOW_SIZE / 2);
			let start = Math.max(0, currentIdx - half);
			let end = Math.min(total, start + TIMELINE_WINDOW_SIZE);
			if (end - start < TIMELINE_WINDOW_SIZE) {
				start = Math.max(0, end - TIMELINE_WINDOW_SIZE);
			}
			windowStart = start;
			windowedTimeline = this._pagedTimeline.slice(start, end);
		}

		const comparisonMode: TemporalComparisonMode =
			this._comparisonSelection.mode === 'parent'
				? 'explicit-parent'
				: this._comparisonSelection.mode === 'pinned'
					? 'pinned'
					: 'first-parent';

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
			isLoadingHistory: this._isLoadingHistory,
			historyError: this._historyError,
			isLoadingMoreHistory: this._isLoadingMoreHistory,
			historyLoadMoreError: this._historyLoadMoreError,
			compareBaseSha: this._compareBaseSha,
			renderedCompareBaseSha: this._renderedCompareBaseSha,
			comparisonSelection: this._comparisonSelection,
			comparisonMode,
			followHead: this._followHead,
			displayMode: this._displayMode,
			pagedTimeline: windowedTimeline,
			loadedCommitCount: total,
			selectedCommitIndex: currentIdx >= 0 ? currentIdx : undefined,
			selectedCommitSummary: curCommit,
			renderedCommitSummary: renderedCommit,
			renderedCompareBaseSummary: renderedBaseCommit,
			historyHasMore: this._historyHasMore,
			historyNextCursor: this._historyNextCursor,
			isSettled: this._isSettled,
			isPartialLineage: this._isPartialLineage,
			diff: this._currentDiff,
			selectedEntityId: this._selectedEntityId,
			filterQuery: this._filterQuery,
			timelineWindow: { start: windowStart, count: windowedTimeline.length },
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

		// Strictly only real Git repositories are supported for Temporal history.
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

		// Security: Validate repoRoot against discovered repositories
		this._updateAvailableRepositories();
		const matched = this._availableRepositories.find(r => r.rootUri === repoRoot);
		if (!matched) {
			this._logService.warn(`[WorkbenchTemporalViewService] switchRepository rejected untrusted path: ${repoRoot}`);
			return;
		}

		this._cancelActiveRequests();

		this._activeRepositoryRoot = repoRoot;
		this._activeRepositoryId = matched.id;
		this._selectedRef = 'HEAD';
		this._comparisonSelection = { mode: 'first-parent' };
		this._compareBaseSha = undefined;
		this._renderedCompareBaseSha = undefined;
		this._selectedEntityId = undefined;

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
		this._isLoadingHistory = false;
		this._historyError = undefined;
		this._isLoadingMoreHistory = false;
		this._historyLoadMoreError = undefined;
		this._currentDiff = undefined;

		await this.initialize();
	}

	private async _doInitialize(): Promise<void> {
		this._updateAvailableRepositories();
		if (this._availableRepositories.length === 0) {
			this._isLoadingHistory = false;
			this._historyError = 'No Git repository available in workspace';
			this._notifyStateChanged();
			return;
		}

		// 1. Read persisted candidate state first
		const persisted = this._readPersistedState();

		// 2. Validate repository: if active root was explicitly set, preserve it if valid, else use persisted or first discovered
		let activeRepo = this._activeRepositoryRoot
			? this._availableRepositories.find(r => r.rootUri === this._activeRepositoryRoot)
			: undefined;
		if (!activeRepo) {
			activeRepo = persisted?.activeRepositoryRoot
				? this._availableRepositories.find(r => r.rootUri === persisted.activeRepositoryRoot)
				: undefined;
		}
		if (!activeRepo) {
			activeRepo = this._availableRepositories[0];
		}

		// 3. Set active repo and root BEFORE any root-dependent operations
		this._activeRepositoryRoot = activeRepo.rootUri;
		this._activeRepositoryId = activeRepo.id;
		const root = this._activeRepositoryRoot;

		// 4. Apply display / comparison modes
		if (persisted?.displayMode === 'changes' || persisted?.displayMode === 'state') {
			this._displayMode = persisted.displayMode;
		}
		if (typeof persisted?.followHead === 'boolean') {
			this._followHead = persisted.followHead;
		}
		if (persisted?.comparisonSelection) {
			this._comparisonSelection = persisted.comparisonSelection;
		}

		// 5. Load identity for that exact root
		try {
			if (this._gitHistoryService?.getRepositoryIdentity) {
				const identity = await this._gitHistoryService.getRepositoryIdentity(root);
				if (identity?.repositoryId) {
					this._activeRepositoryId = identity.repositoryId;
				}
			}
		} catch {
			// ignore identity lookup failure
		}

		// 6. Load refs for that exact root
		try {
			const refs = await this._temporalGraphService.getRepositoryRefs(root);
			this._repositoryRefs = refs || [];
		} catch (err) {
			this._logService.warn('[WorkbenchTemporalViewService] Failed to load repository refs:', err);
			this._repositoryRefs = [];
		}

		// 7. Validate persisted ref against available refs; fallback to HEAD if stale/missing
		let refToSelect = persisted?.selectedRef || 'HEAD';
		if (refToSelect !== 'HEAD' && this._repositoryRefs.length > 0) {
			const refExists = this._repositoryRefs.some(r => r.name === refToSelect);
			if (!refExists) {
				this._logService.info(`[WorkbenchTemporalViewService] Persisted ref '${refToSelect}' no longer exists, falling back to HEAD.`);
				refToSelect = 'HEAD';
			}
		}

		// 8. Validate persisted pinned base if present
		if (this._comparisonSelection.mode === 'pinned' && this._comparisonSelection.baseSha) {
			try {
				const resolved = await this._gitHistoryService.resolveRef(root, this._comparisonSelection.baseSha);
				if (!resolved) {
					this._comparisonSelection = { mode: 'first-parent' };
				}
			} catch {
				this._comparisonSelection = { mode: 'first-parent' };
			}
		}

		// 9. Load history for selected ref (with optional persisted commit restoration only if followHead is false or ref is not HEAD)
		const commitToRestore = (this._followHead && refToSelect === 'HEAD') ? undefined : persisted?.selectedCommitSha;
		await this.selectRef(refToSelect, commitToRestore);
	}

	async selectRef(refName: string, targetCommitSha?: string): Promise<void> {
		const root = this._getActiveRepoRoot();
		if (!root) {
			this._isLoadingHistory = false;
			this._historyError = 'No Git repository available';
			this._notifyStateChanged();
			return;
		}

		const currentGen = ++this._historyGenerationToken;
		this._historyCts?.cancel();
		this._historyCts?.dispose();
		this._loadMoreCts?.cancel();
		this._loadMoreCts?.dispose();
		this._loadMoreCts = undefined;

		const cts = new CancellationTokenSource();
		this._historyCts = cts;

		this._isLoadingHistory = true;
		this._historyError = undefined;
		this._notifyStateChanged();

		try {
			// Refresh refs with cancellation token
			try {
				const refs = await this._temporalGraphService.getRepositoryRefs(root, cts.token);
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
			}, cts.token);

			if (cts.token.isCancellationRequested || this._historyGenerationToken !== currentGen) {
				return;
			}

			this._selectedRef = refName;
			if (refName !== 'HEAD' && refName !== '') {
				this._followHead = false;
			}

			// Reset explicit merge-parent selection when changing refs
			if (this._comparisonSelection.mode === 'parent') {
				this._comparisonSelection = { mode: 'first-parent' };
			}

			this._isLoadingHistory = false;
			this._historyError = undefined;
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

			if (this._pagedTimeline.length > 0) {
				const commitToSelect = targetCommitSha && this._pagedTimeline.some(c => c.sha === targetCommitSha)
					? targetCommitSha
					: this._pagedTimeline[0].sha;
				if (commitToSelect !== this._pagedTimeline[0].sha || (refName !== 'HEAD' && refName !== '')) {
					this._followHead = false;
				}
				await this.selectCommit(commitToSelect, { immediate: true, preserveFollowHead: this._followHead });
			} else {
				this._selectedCommitSha = '';
				this._renderedCommitSha = undefined;
				this._compareBaseSha = undefined;
				this._renderedCompareBaseSha = undefined;
				this._currentDiff = undefined;
				this._notifyStateChanged();
			}

			this._savePersistedState();
		} catch (err: any) {
			if (!cts.token.isCancellationRequested && this._historyGenerationToken === currentGen) {
				this._logService.error(`[WorkbenchTemporalViewService] Failed to load history for ref ${refName}:`, err);
				this._isLoadingHistory = false;
				this._historyError = err?.message || `Failed to load history for ${refName}`;
				this._notifyStateChanged();
			}
		} finally {
			if (this._historyCts === cts) {
				this._historyCts = undefined;
			}
			cts.dispose();
		}
	}

	async selectCommitIndex(globalIndex: number, options?: { immediate?: boolean }): Promise<void> {
		if (globalIndex < 0 || globalIndex >= this._pagedTimeline.length) {
			return;
		}
		const commit = this._pagedTimeline[globalIndex];
		if (commit) {
			if (globalIndex !== 0 || this._selectedRef !== 'HEAD') {
				this._followHead = false;
			}
			await this.selectCommit(commit.sha, options);
		}
	}

	async stepCommit(delta: number): Promise<void> {
		if (this._pagedTimeline.length === 0) {
			return;
		}
		// Stepping is manual historical navigation -> turns Follow HEAD off
		this._followHead = false;
		const curIdx = this._pagedTimeline.findIndex(c => c.sha === this._selectedCommitSha);
		const currentIdx = curIdx >= 0 ? curIdx : 0;
		const targetIdx = currentIdx - delta; // delta +1: newer (towards HEAD index 0), delta -1: older (towards higher index)

		if (targetIdx >= 0 && targetIdx < this._pagedTimeline.length) {
			await this.selectCommit(this._pagedTimeline[targetIdx].sha, { immediate: true });
		} else if (delta < 0 && targetIdx >= this._pagedTimeline.length) {
			// At loaded boundary and stepping older: load next page if available, then step
			if (this._historyHasMore && this._historyNextCursor) {
				await this.loadMoreHistory();
				if (targetIdx < this._pagedTimeline.length) {
					await this.selectCommit(this._pagedTimeline[targetIdx].sha, { immediate: true });
				}
			}
		}
	}

	async loadMoreHistory(): Promise<void> {
		const root = this._getActiveRepoRoot();
		if (!root || !this._historyHasMore || !this._historyNextCursor || this._isLoadingMoreHistory) {
			return;
		}

		this._isLoadingMoreHistory = true;
		this._historyLoadMoreError = undefined;
		this._notifyStateChanged();
		const currentGen = this._historyGenerationToken;
		const cursorToFetch = this._historyNextCursor;

		this._loadMoreCts?.cancel();
		this._loadMoreCts?.dispose();
		const cts = new CancellationTokenSource();
		this._loadMoreCts = cts;

		try {
			const historyPage = await this._temporalGraphService.getHistoryPage(root, {
				cursor: cursorToFetch,
				pageSize: PAGE_SIZE,
			}, cts.token);

			if (cts.token.isCancellationRequested || this._historyGenerationToken !== currentGen) {
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
			this._historyLoadMoreError = undefined;

			this._notifyStateChanged();
		} catch (err: any) {
			if (!cts.token.isCancellationRequested && this._historyGenerationToken === currentGen) {
				this._logService.error('[WorkbenchTemporalViewService] Failed to load more history:', err);
				this._historyLoadMoreError = err?.message || 'Could not load older history.';
				this._notifyStateChanged();
			}
		} finally {
			if (this._loadMoreCts === cts) {
				this._loadMoreCts = undefined;
			}
			cts.dispose();
			this._isLoadingMoreHistory = false;
			this._notifyStateChanged();
		}
	}

	private _deriveCompareBase(targetSha: string, selection: TemporalComparisonSelection): string | undefined {
		if (selection.mode === 'pinned') {
			return selection.baseSha;
		}

		const commit = this._pagedTimeline.find(c => c.sha === targetSha);
		if (!commit?.parents || commit.parents.length === 0) {
			return undefined;
		}

		if (selection.mode === 'parent' && selection.parentIndex > 0) {
			if (commit.parents.length > selection.parentIndex) {
				return commit.parents[selection.parentIndex];
			}
		}

		return commit.parents[0];
	}

	async selectCommit(commitSha: string, options?: { compareBaseSha?: string; immediate?: boolean; preserveFollowHead?: boolean }): Promise<void> {
		if (!commitSha) {
			return;
		}

		if (!options?.preserveFollowHead) {
			const isHeadCommit = this._pagedTimeline.length > 0 && this._pagedTimeline[0].sha === commitSha;
			if (!isHeadCommit || this._selectedRef !== 'HEAD') {
				this._followHead = false;
			}
		}

		this._selectedCommitSha = commitSha;
		this._isLoadingSelection = true;
		this._selectionError = undefined;

		if (options?.compareBaseSha !== undefined) {
			this._comparisonSelection = { mode: 'pinned', baseSha: options.compareBaseSha };
		} else if (this._comparisonSelection.mode === 'parent') {
			this._comparisonSelection = { mode: 'first-parent' };
		}

		this._compareBaseSha = this._deriveCompareBase(commitSha, this._comparisonSelection);

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

	async setCompareBase(compareBaseShaOrSelection: string | TemporalComparisonSelection | undefined): Promise<void> {
		if (typeof compareBaseShaOrSelection === 'object' && compareBaseShaOrSelection !== null) {
			this._comparisonSelection = compareBaseShaOrSelection;
		} else if (compareBaseShaOrSelection === undefined || compareBaseShaOrSelection === '__first_parent__') {
			this._comparisonSelection = { mode: 'first-parent' };
		} else {
			const curCommit = this._pagedTimeline.find(c => c.sha === this._selectedCommitSha);
			if (compareBaseShaOrSelection === curCommit?.parents?.[0]) {
				this._comparisonSelection = { mode: 'first-parent' };
			} else if (curCommit?.parents && curCommit.parents.length > 1 && compareBaseShaOrSelection === curCommit.parents[1]) {
				this._comparisonSelection = { mode: 'parent', parentIndex: 1 };
			} else {
				this._comparisonSelection = { mode: 'pinned', baseSha: compareBaseShaOrSelection };
			}
		}

		this._compareBaseSha = this._deriveCompareBase(this._selectedCommitSha, this._comparisonSelection);

		if (this._selectedCommitSha) {
			await this._reconstructDiffForSelection(this._selectedCommitSha, this._compareBaseSha);
		}
		this._savePersistedState();
	}

	setDisplayMode(mode: TemporalDisplayMode): void {
		this._displayMode = mode;
		this._notifyStateChanged();
		this._savePersistedState();
	}

	setFollowHead(follow: boolean): void {
		this._followHead = follow;
		if (follow) {
			// Immediately resolve and navigate to actual current HEAD even if _selectedRef is already 'HEAD'
			void this.selectRef('HEAD');
			return;
		}
		this._notifyStateChanged();
		this._savePersistedState();
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
			this._renderedCompareBaseSha = baseSha;
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
			let isBasePartial = false;

			if (baseSha) {
				const baseStatus = await this._temporalGraphService.getCommitIndexStatus(root, baseSha, cts.token);
				const isBaseReady = baseStatus.status === 'ready' || baseStatus.status === 'incomplete';
				isBasePartial = baseStatus.lineageCoverage?.kind === 'partial';
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
			const isTargetPartialInitial = targetPreStatus.lineageCoverage?.kind === 'partial';

			// If target was previously stored as a partial anchor and base is now ready, reconcile target
			const targetGraph = (isTargetPartialInitial && baseSha)
				? await this._temporalGraphService.ensureCommitIndexed(root, targetSha, cts.token)
				: (targetPreStatus.status === 'ready' || targetPreStatus.status === 'incomplete')
					? await this._temporalGraphService.getGraphAtCommit(root, targetSha, cts.token)
					: await this._temporalGraphService.ensureCommitIndexed(root, targetSha, cts.token);

			const targetEntities: TemporalEntitySnapshot[] = targetGraph?.entityMap ? Array.from(targetGraph.entityMap.values()) : [];
			const targetEdges: TemporalEdgeSnapshot[] = targetGraph?.edgeMap ? Array.from(targetGraph.edgeMap.values()) : [];

			if (cts.token.isCancellationRequested || this._generationToken !== currentGen) {
				return;
			}

			const finalTargetStatus = await this._temporalGraphService.getCommitIndexStatus(root, targetSha, cts.token);
			const isFinalReady = finalTargetStatus.status === 'ready' || finalTargetStatus.status === 'incomplete';
			const isTargetPartial = finalTargetStatus.lineageCoverage?.kind === 'partial';
			const isPartial = isTargetPartial || isBasePartial;

			let gitDiffChanges: import('../../../history/git/gitTypes.js').GitExactDiffChange[] | undefined;
			if (baseSha && this._gitHistoryService?.diffCommitTrees) {
				try {
					const diffResult = await this._gitHistoryService.diffCommitTrees(root, baseSha, targetSha, cts.token);
					gitDiffChanges = (diffResult.changes || []) as import('../../../history/git/gitTypes.js').GitExactDiffChange[];
				} catch {
					// Fall back cleanly to path and blob identity matching
				}
			}

			const rawDiff = computeTemporalStructuralDiff(
				targetSha,
				targetEntities,
				targetEdges,
				baseSha,
				baseEntities,
				baseEdges,
				{
					isPartialLineage: isPartial,
					partialLineageReason: isPartial ? 'Historical lineage coverage is partial' : undefined,
					gitDiffChanges,
				},
			);

			const layoutResult = layoutTemporalGraph(rawDiff, this._positions, {
				nodeSpacing: 48,
			});

			for (const [id, pos] of layoutResult.positions) {
				this._positions.delete(id);
				this._positions.set(id, pos);
				if (this._positions.size > MAX_POSITIONS_CACHE_ENTRIES) {
					const firstKey = this._positions.keys().next().value;
					if (firstKey) {
						this._positions.delete(firstKey);
					}
				}
			}

			const diffWithLayout: TemporalStructuralDiff = {
				...rawDiff,
				nodes: layoutResult.nodes,
				guides: layoutResult.guides || rawDiff.guides,
			};

			if (!isPartial) {
				this._diffCache.delete(cachePrefix);
				this._diffCache.set(cachePrefix, diffWithLayout);
				if (this._diffCache.size > MAX_DIFF_CACHE_ENTRIES) {
					const firstKey = this._diffCache.keys().next().value;
					if (firstKey) {
						this._diffCache.delete(firstKey);
					}
				}
			}

			this._renderedCommitSha = targetSha;
			this._renderedCompareBaseSha = baseSha;
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

	async openSourceDiff(entityId: string): Promise<{ ok: boolean; message?: string }> {
		if (!this._currentDiff) {
			return { ok: false, message: 'No rendered diff available' };
		}

		const node = this._currentDiff.nodes.find(n => n.entityId === entityId);
		if (!node) {
			return { ok: false, message: `Node with entityId ${entityId} not found in current diff` };
		}

		const root = this._getActiveRepoRoot();
		if (!root) {
			return { ok: false, message: 'Active repository not available' };
		}

		// Use rendered commit SHAs from _currentDiff to ensure truthfulness
		const targetSha = this._currentDiff.targetCommitSha;
		const baseSha = this._currentDiff.baseCommitSha;
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
			return { ok: true };
		} catch (err: any) {
			const message = err?.message || String(err);
			this._logService.warn('[WorkbenchTemporalViewService] Source diff command failed:', err);
			return { ok: false, message };
		}
	}

	async openHistoricalFile(entityId: string): Promise<{ ok: boolean; message?: string }> {
		if (!this._currentDiff) {
			return { ok: false, message: 'No rendered diff available' };
		}

		const node = this._currentDiff.nodes.find(n => n.entityId === entityId);
		if (!node) {
			return { ok: false, message: `Node with entityId ${entityId} not found in current diff` };
		}

		const root = this._getActiveRepoRoot();
		if (!root) {
			return { ok: false, message: 'Active repository not available' };
		}

		try {
			// Use rendered commit SHAs from _currentDiff
			if (node.changeKind === 'removed' && this._currentDiff.baseCommitSha) {
				const baseUri = this._createGitResourceUri(root, node.oldPath || node.path, this._currentDiff.baseCommitSha);
				await this._editorService.openEditor({ resource: baseUri, options: { pinned: false } });
			} else {
				const gitUri = this._createGitResourceUri(root, node.path, this._currentDiff.targetCommitSha);
				await this._editorService.openEditor({ resource: gitUri, options: { pinned: false } });
			}
			return { ok: true };
		} catch (err: any) {
			const message = err?.message || String(err);
			this._logService.warn('[WorkbenchTemporalViewService] Open historical file failed:', err);
			return { ok: false, message };
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

		if (!this._gitHistoryService?.getEmptyTree) {
			throw new GitHistoryError('NotSupported', 'Git empty tree resolution is not supported on active git service');
		}

		const emptyTreeRef = await this._gitHistoryService.getEmptyTree(rootFsPath);
		if (!emptyTreeRef) {
			throw new GitHistoryError('ProcessFailure', `Failed to resolve empty tree hash for repository ${rootFsPath}`);
		}

		return fileUri.with({
			scheme: 'git',
			path: `${fileUri.path}.empty`,
			query: JSON.stringify({ path: fileUri.fsPath, ref: emptyTreeRef }),
		});
	}

	async retrySelection(): Promise<void> {
		const hadHistoryError = Boolean(this._historyError || this._historyLoadMoreError);
		const hadSelectionError = Boolean(this._selectionError);
		const targetSha = this._selectedCommitSha;
		const baseSha = this._compareBaseSha;
		const root = this._getActiveRepoRoot();

		this._selectionError = undefined;
		this._historyError = undefined;
		this._historyLoadMoreError = undefined;

		if (hadHistoryError) {
			if (this._selectedRef) {
				await this.selectRef(this._selectedRef, this._selectedCommitSha || undefined);
			} else {
				await this.refresh();
			}
			return;
		}

		if (hadSelectionError && targetSha) {
			if (root) {
				const cachePrefix = `${this._activeRepositoryId || root}::${targetSha}..${baseSha || 'root'}`;
				this._diffCache.delete(cachePrefix);
			}
			await this.selectCommit(targetSha, { compareBaseSha: baseSha, immediate: true, preserveFollowHead: this._followHead });
			return;
		}

		if (this._selectedCommitSha) {
			await this.selectCommit(this._selectedCommitSha, { immediate: true, preserveFollowHead: this._followHead });
		} else if (this._selectedRef) {
			await this.selectRef(this._selectedRef);
		} else {
			await this.refresh();
		}
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
		if (this._followHead) {
			await this.selectRef('HEAD');
		} else {
			// When followHead is disabled, refresh timeline metadata so new commits appear in the history list,
			// while retaining the current historical commit selection without view jumps.
			const currentSelectedSha = this._selectedCommitSha;
			await this.selectRef(this._selectedRef, currentSelectedSha);
		}
	}

	private _notifyStateChanged(): void {
		this._onDidChangeState.fire(this.getState());
	}

	private _savePersistedState(): void {
		if (!this._storageService) {
			return;
		}
		try {
			const persisted: IPersistedTemporalViewState = {
				activeRepositoryRoot: this._activeRepositoryRoot,
				selectedRef: this._selectedRef,
				selectedCommitSha: this._selectedCommitSha,
				displayMode: this._displayMode,
				followHead: this._followHead,
				comparisonSelection: this._comparisonSelection,
			};
			this._storageService.store(STORAGE_KEY_TEMPORAL_VIEW, JSON.stringify(persisted), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} catch {
			// ignore storage serialization error
		}
	}

	private _readPersistedState(): IPersistedTemporalViewState | undefined {
		if (!this._storageService) {
			return undefined;
		}
		try {
			const raw = this._storageService.get(STORAGE_KEY_TEMPORAL_VIEW, StorageScope.WORKSPACE);
			if (!raw) {
				return undefined;
			}
			return JSON.parse(raw) as IPersistedTemporalViewState;
		} catch {
			return undefined;
		}
	}

	override dispose(): void {
		this._cancelActiveRequests();
		this._diffCache.clear();
		this._positions.clear();
		super.dispose();
	}
}

function getBaseName(p: string): string {
	const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
	return lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
}

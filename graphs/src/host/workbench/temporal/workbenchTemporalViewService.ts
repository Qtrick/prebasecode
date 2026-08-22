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
import { IWorkbenchGitHistoryService } from '../workbenchGitHistoryService.js';
import { IPreBaseTemporalGraphService } from '../workbenchTemporalGraphService.js';
import {
	IPreBaseTemporalViewService,
	type ITemporalViewState,
	type TemporalCommitSummary,
	type TemporalStructuralDiff,
} from '../../../temporal/view/temporalViewTypes.js';
import { computeTemporalStructuralDiff } from '../../../temporal/view/temporalStructuralDiff.js';
import type { GitHeadChangeEvent } from '../../../history/git/gitHistoryService.js';
import type { TemporalCommitSummary as ITemporalStoreCommitSummary, TemporalEntitySnapshot, TemporalEdgeSnapshot } from '../../../temporal/common/temporalTypes.js';

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

	private _selectedRef: string = 'HEAD';
	private _selectedCommitSha: string = '';
	private _compareBaseSha?: string;
	private _followHead: boolean = true;
	private _filterQuery: string = '';
	private _pagedTimeline: TemporalCommitSummary[] = [];
	private _totalAvailableCommits: number = 0;
	private _isSettled: boolean = false;
	private _isPartialLineage: boolean = false;
	private _currentDiff?: TemporalStructuralDiff;

	private readonly _diffCache = new Map<string, TemporalStructuralDiff>();
	private _scrubTimer: any = undefined;
	private _activeCts?: CancellationTokenSource;
	private _generationToken: number = 0;

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IWorkbenchGitHistoryService private readonly _gitHistoryService: IWorkbenchGitHistoryService,
		@IPreBaseTemporalGraphService private readonly _temporalGraphService: IPreBaseTemporalGraphService,
		@ICommandService private readonly _commandService: ICommandService,
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
				void this.refresh();
			}));
		}
	}

	getState(): ITemporalViewState {
		return {
			selectedRef: this._selectedRef,
			selectedCommitSha: this._selectedCommitSha,
			compareBaseSha: this._compareBaseSha,
			followHead: this._followHead,
			pagedTimeline: this._pagedTimeline,
			totalAvailableCommits: this._totalAvailableCommits,
			isSettled: this._isSettled,
			isPartialLineage: this._isPartialLineage,
			diff: this._currentDiff,
			selectedEntityId: undefined,
			filterQuery: this._filterQuery,
		};
	}

	private _getActiveRepoRoot(): string | undefined {
		const workspace = this._workspaceContextService.getWorkspace();
		const firstFolder = workspace?.folders?.[0];
		if (!firstFolder) {
			return undefined;
		}
		const root = firstFolder.uri.fsPath || firstFolder.uri.path;
		return root;
	}

	async selectRef(refName: string): Promise<void> {
		this._selectedRef = refName;
		const root = this._getActiveRepoRoot();
		if (!root) {
			return;
		}

		try {
			const historyPage = await this._temporalGraphService.getHistoryPage(root, {
				ref: refName,
				pageSize: PAGE_SIZE,
			});

			this._totalAvailableCommits = historyPage.commits.length;
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

			this._onDidChangeTimeline.fire(this._pagedTimeline);

			if (this._pagedTimeline.length > 0) {
				const headSha = this._pagedTimeline[0].sha;
				await this.selectCommit(headSha, { immediate: true });
			} else {
				this._selectedCommitSha = '';
				this._currentDiff = undefined;
				this._notifyStateChanged();
			}
		} catch (err) {
			this._logService.error('[WorkbenchTemporalViewService] Failed to load commit history for ref:', refName, err);
		}
	}

	async loadMoreHistory(): Promise<void> {
		const root = this._getActiveRepoRoot();
		if (!root || this._pagedTimeline.length >= this._totalAvailableCommits) {
			return;
		}

		try {
			const historyPage = await this._temporalGraphService.getHistoryPage(root, {
				ref: this._selectedRef,
				pageSize: PAGE_SIZE,
			});

			const newItems = historyPage.commits.map((c: ITemporalStoreCommitSummary) => ({
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
			this._totalAvailableCommits = this._pagedTimeline.length;
			this._onDidChangeTimeline.fire(this._pagedTimeline);
			this._notifyStateChanged();
		} catch (err) {
			this._logService.error('[WorkbenchTemporalViewService] Failed to load more history:', err);
		}
	}

	async selectCommit(commitSha: string, options?: { compareBaseSha?: string; immediate?: boolean }): Promise<void> {
		if (!commitSha) {
			return;
		}

		this._selectedCommitSha = commitSha;
		if (options?.compareBaseSha !== undefined) {
			this._compareBaseSha = options.compareBaseSha;
		} else {
			// Default compare base to first parent of the selected commit
			const commit = this._pagedTimeline.find(c => c.sha === commitSha);
			this._compareBaseSha = commit?.parents?.[0];
		}

		if (options?.immediate) {
			if (this._scrubTimer) {
				clearTimeout(this._scrubTimer);
				this._scrubTimer = undefined;
			}
			await this._reconstructDiffForSelection(commitSha, this._compareBaseSha);
		} else {
			// Rapid scrub debouncing
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
		if (this._selectedCommitSha) {
			await this._reconstructDiffForSelection(this._selectedCommitSha, this._compareBaseSha);
		}
	}

	setFollowHead(follow: boolean): void {
		this._followHead = follow;
		this._notifyStateChanged();
	}

	setFilterQuery(query: string): void {
		this._filterQuery = query;
		this._notifyStateChanged();
	}

	private async _reconstructDiffForSelection(targetSha: string, baseSha?: string): Promise<void> {
		const root = this._getActiveRepoRoot();
		if (!root) {
			return;
		}

		const cacheKey = `${targetSha}..${baseSha || 'root'}`;
		const cached = this._diffCache.get(cacheKey);
		if (cached) {
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
			const indexStatus = await this._temporalGraphService.getCommitIndexStatus(root, targetSha, cts.token);
			const isReady = indexStatus.status === 'ready' || indexStatus.status === 'incomplete';
			this._isSettled = isReady;

			// Load target snapshots via getGraphAtCommit or ensureCommitIndexed
			const targetGraph = isReady
				? await this._temporalGraphService.getGraphAtCommit(root, targetSha, cts.token)
				: await this._temporalGraphService.ensureCommitIndexed(root, targetSha, cts.token);

			const targetEntities: TemporalEntitySnapshot[] = targetGraph?.entityMap ? Array.from(targetGraph.entityMap.values()) : [];
			const targetEdges: TemporalEdgeSnapshot[] = targetGraph?.edgeMap ? Array.from(targetGraph.edgeMap.values()) : [];

			if (cts.token.isCancellationRequested || this._generationToken !== currentGen) {
				return;
			}

			// Load base snapshots if base commit specified
			let baseEntities: readonly TemporalEntitySnapshot[] | undefined;
			let baseEdges: readonly TemporalEdgeSnapshot[] | undefined;

			if (baseSha) {
				const baseGraph = await this._temporalGraphService.getGraphAtCommit(root, baseSha, cts.token);
				baseEntities = baseGraph?.entityMap ? Array.from(baseGraph.entityMap.values()) : [];
				baseEdges = baseGraph?.edgeMap ? Array.from(baseGraph.edgeMap.values()) : [];
			}

			if (cts.token.isCancellationRequested || this._generationToken !== currentGen) {
				return;
			}

			const isPartial = indexStatus.lineageCoverage?.kind === 'partial';

			const diff = computeTemporalStructuralDiff(
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

			this._diffCache.set(cacheKey, diff);
			if (this._diffCache.size > MAX_DIFF_CACHE_ENTRIES) {
				const firstKey = this._diffCache.keys().next().value;
				if (firstKey) {
					this._diffCache.delete(firstKey);
				}
			}

			this._currentDiff = diff;
			this._isPartialLineage = diff.isPartialLineage;
			this._onDidChangeDiff.fire(diff);
			this._notifyStateChanged();
		} catch (err) {
			if (!cts.token.isCancellationRequested) {
				this._logService.error('[WorkbenchTemporalViewService] Failed to reconstruct diff:', err);
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
			// Construct Git URIs for diff comparison
			const baseUri = baseSha
				? URI.from({ scheme: 'git-blob', authority: baseSha, path: `/${basePath}` })
				: URI.from({ scheme: 'git-blob', authority: 'empty', path: `/${targetPath}` });
			const targetUri = URI.from({ scheme: 'git-blob', authority: targetSha, path: `/${targetPath}` });
			const title = `${node.label} (${baseSha ? baseSha.slice(0, 7) : 'Initial'} ↔ ${targetSha.slice(0, 7)})`;

			await this._commandService.executeCommand('vscode.diff', baseUri, targetUri, title);
		} catch (err) {
			this._logService.warn('[WorkbenchTemporalViewService] Source diff command failed:', err);
		}
	}

	async refresh(): Promise<void> {
		this._diffCache.clear();
		await this.selectRef(this._selectedRef);
	}

	private async _handleHeadChanged(e: GitHeadChangeEvent): Promise<void> {
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
		this._activeCts?.cancel();
		this._activeCts?.dispose();
		this._activeCts = undefined;
		this._diffCache.clear();
		super.dispose();
	}
}

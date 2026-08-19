/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IGitService } from '../../../../git/common/gitService.js';
import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { EventLike, IGitHistoryService } from '../../history/git/gitHistoryService.js';
import {
	GitHistoryError,
	type GitBranchInfo,
	type GitCommitMetadata,
	type GitExactDiffResult,
	type GitHeadChangeEvent,
	type GitHeadTransitionType,
	type GitLogOptions,
	type GitRepositoryIdentity,
	type GitTagInfo,
	type GitTreeEntry,
	type GitTreeListOptions,
} from '../../history/git/gitTypes.js';

export const IWorkbenchGitHistoryService = createDecorator<IWorkbenchGitHistoryService>('workbenchGitHistoryService');

export interface IWorkbenchGitHistoryService extends IGitHistoryService {
	readonly _serviceBrand: undefined;
	notifyHeadChanged(repositoryId: string, newHead: string, transitionType?: GitHeadTransitionType): void;
	observeRepository(repo: WorkbenchGitRepositoryLike): void;
	dispose(): void;
}

export interface WorkbenchGitServiceLike {
	readonly _serviceBrand?: undefined;
	readonly repositories: Iterable<WorkbenchGitRepositoryLike>;
	openRepository?(uri: any): Promise<WorkbenchGitRepositoryLike | undefined>;
}

export interface WorkbenchGitRepositoryLike {
	readonly rootUri: { readonly fsPath?: string; readonly path: string; toString(): string };
	readonly state: { readonly get?: () => any; readonly current?: any };
	getRefs?(query: any, token?: any): Promise<any[]>;
	resolveCommitRef?(ref: string, token?: any): Promise<string>;
	getCommitDetails?(ref: string, token?: any): Promise<any>;
	getCommitLog?(options: any, token?: any): Promise<any[]>;
	listTreeEntries?(ref: string, options?: any, token?: any): Promise<any[]>;
	readBlobContent?(ref: string, path: string, maxBytes?: number, token?: any): Promise<string>;
	diffExactTrees?(refA: string, refB: string, token?: any): Promise<any>;
	diffCommitToParent?(commitRef: string, parentIndex?: number, token?: any): Promise<any>;
	diffReviewRange?(baseRef: string, headRef: string, token?: any): Promise<any>;
	checkIgnore?(paths: string[]): Promise<string[]>;
}

function normalizePath(p: string): string {
	return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

export class WorkbenchGitHistoryService implements IWorkbenchGitHistoryService {
	declare readonly _serviceBrand: undefined;

	private readonly _gitService: WorkbenchGitServiceLike;
	private readonly _headListeners = new Set<(e: GitHeadChangeEvent) => void>();
	/** Per-repository last-known HEAD SHA for deduplication. */
	private readonly _lastHeadShaByRepo = new Map<string, string>();
	private readonly _observedRepos = new Set<string>();
	private readonly _disposables: Array<{ dispose(): void }> = [];

	readonly onDidChangeHead: EventLike<GitHeadChangeEvent> = (listener) => {
		this._headListeners.add(listener);
		return {
			dispose: () => {
				this._headListeners.delete(listener);
			},
		};
	};

	constructor(@IGitService gitService: IGitService) {
		this._gitService = gitService as any;
		this._wireExistingRepositories();
	}

	private _wireExistingRepositories(): void {
		if (this._gitService && this._gitService.repositories) {
			for (const repo of this._gitService.repositories) {
				this.observeRepository(repo);
			}
		}
	}

	observeRepository(repo: WorkbenchGitRepositoryLike): void {
		const repoId = repo.rootUri.toString();
		if (this._observedRepos.has(repoId)) {
			return;
		}
		this._observedRepos.add(repoId);

		const repoState = (repo as any).state;
		if (repoState && typeof repoState.recomputeInitiallyAndOnChange === 'function') {
			let lastHead: string | undefined;
			const sub = repoState.recomputeInitiallyAndOnChange({ add: (d: any) => this._disposables.push(d) }, (state: any) => {
				const headCommit = state?.HEAD?.commit;
				if (headCommit && headCommit !== lastHead) {
					lastHead = headCommit;
					this.notifyHeadChanged(repoId, headCommit, 'external');
				}
			});
			if (sub && typeof sub.dispose === 'function') {
				this._disposables.push(sub);
			}
		}
	}

	private _findRepository(rootPath: string): WorkbenchGitRepositoryLike | undefined {
		const target = normalizePath(rootPath).toLowerCase();
		let bestMatch: WorkbenchGitRepositoryLike | undefined;
		let bestMatchLen = 0;

		for (const repo of this._gitService.repositories) {
			const repoFsPath = repo.rootUri.fsPath ? normalizePath(repo.rootUri.fsPath).toLowerCase() : '';
			const repoPath = normalizePath(repo.rootUri.path).toLowerCase();

			// Exact match
			if (repoFsPath === target || repoPath === target) {
				this.observeRepository(repo);
				return repo;
			}

			// Subdirectory match (e.g. /repo/packages/frontend inside /repo)
			if (repoFsPath && target.startsWith(repoFsPath + '/') && repoFsPath.length > bestMatchLen) {
				bestMatch = repo;
				bestMatchLen = repoFsPath.length;
			} else if (repoPath && target.startsWith(repoPath + '/') && repoPath.length > bestMatchLen) {
				bestMatch = repo;
				bestMatchLen = repoPath.length;
			}
		}

		if (bestMatch) {
			this.observeRepository(bestMatch);
			return bestMatch;
		}

		return undefined;
	}

	private async _ensureRepository(rootPath: string): Promise<WorkbenchGitRepositoryLike> {
		let repo = this._findRepository(rootPath);
		if (!repo && typeof this._gitService.openRepository === 'function') {
			try {
				repo = await this._gitService.openRepository({ path: rootPath, scheme: 'file' });
			} catch {
				// Failed to open
			}
		}
		if (!repo) {
			throw new GitHistoryError('RepositoryUnavailable', `No active Git repository for root path: ${rootPath}`);
		}
		return repo;
	}

	async isGitRepository(rootPath: string, _token?: CancellationTokenLike): Promise<boolean> {
		try {
			const repo = this._findRepository(rootPath);
			return !!repo;
		} catch {
			return false;
		}
	}

	async getRepositoryIdentity(rootPath: string, _token?: CancellationTokenLike): Promise<GitRepositoryIdentity> {
		const repo = await this._ensureRepository(rootPath);
		const repoRootPath = repo.rootUri.fsPath || repo.rootUri.path;
		const rootUriStr = repo.rootUri.toString();
		const state = repo.state?.current || (repo.state?.get ? repo.state.get() : undefined);
		const headBranch = state?.HEAD?.name;
		const isUnborn = !state?.HEAD?.commit;
		return {
			repositoryId: rootUriStr,
			rootPath: repoRootPath,
			rootUri: rootUriStr,
			headBranch,
			isUnborn,
		};
	}

	async getHead(rootPath: string, token?: CancellationTokenLike): Promise<string> {
		return this.resolveRef(rootPath, 'HEAD', token);
	}

	async getCommit(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<GitCommitMetadata> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.getCommitDetails) {
			throw new GitHistoryError('ProcessFailure', 'getCommitDetails is not available on workbench Git repository');
		}
		try {
			const dto = await repo.getCommitDetails(ref, token);
			return {
				sha: dto.sha,
				parents: dto.parents || [],
				author: dto.author,
				committer: dto.committer,
				authorTimestamp: dto.authorTimestamp,
				committerTimestamp: dto.committerTimestamp,
				message: dto.message,
			};
		} catch (err: any) {
			const code = err?.code || 'UnknownRef';
			throw new GitHistoryError(code, err?.message || `Failed to get commit details for '${ref}'`);
		}
	}

	async log(rootPath: string, options?: GitLogOptions, token?: CancellationTokenLike): Promise<GitCommitMetadata[]> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.getCommitLog) {
			throw new GitHistoryError('ProcessFailure', 'getCommitLog is not available on workbench Git repository');
		}
		try {
			const dtos = await repo.getCommitLog(options || {}, token);
			return (dtos || []).map(dto => ({
				sha: dto.sha,
				parents: dto.parents || [],
				author: dto.author,
				committer: dto.committer,
				authorTimestamp: dto.authorTimestamp,
				committerTimestamp: dto.committerTimestamp,
				message: dto.message,
			}));
		} catch (err: any) {
			const code = err?.code || 'ProcessFailure';
			throw new GitHistoryError(code, err?.message || 'Failed to get commit log');
		}
	}

	async resolveRef(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<string> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.resolveCommitRef) {
			throw new GitHistoryError('ProcessFailure', 'resolveCommitRef is not available on workbench Git repository');
		}
		try {
			return await repo.resolveCommitRef(ref, token);
		} catch (err: any) {
			const code = err?.code || 'UnknownRef';
			throw new GitHistoryError(code, err?.message || `Failed to resolve ref '${ref}'`);
		}
	}

	async listBranches(rootPath: string, token?: CancellationTokenLike): Promise<GitBranchInfo[]> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.getRefs) {
			throw new GitHistoryError('ProcessFailure', 'getRefs is not available on workbench Git repository');
		}
		try {
			const refs = await repo.getRefs({}, token);
			return (refs || [])
				.filter(r => r.name && r.commit && (r.type === 0 || r.type === 1)) // Head or RemoteHead
				.map(r => ({
					name: r.name,
					commit: r.commit,
					isRemote: r.type === 1,
				}));
		} catch (err: any) {
			const code = err?.code || 'ProcessFailure';
			throw new GitHistoryError(code, err?.message || 'Failed to list branches');
		}
	}

	async listTags(rootPath: string, token?: CancellationTokenLike): Promise<GitTagInfo[]> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.getRefs) {
			throw new GitHistoryError('ProcessFailure', 'getRefs is not available on workbench Git repository');
		}
		try {
			const refs = await repo.getRefs({ pattern: 'refs/tags/*' }, token);
			return (refs || [])
				.filter(r => r.name && r.commit)
				.map(r => ({
					name: r.name,
					tagCommit: r.tagCommit || r.commit,
					peeledCommit: r.peeledCommit || r.commit,
					isAnnotated: r.isAnnotated ?? false,
				}));
		} catch (err: any) {
			const code = err?.code || 'ProcessFailure';
			throw new GitHistoryError(code, err?.message || 'Failed to list tags');
		}
	}

	async listTree(rootPath: string, ref: string, options?: GitTreeListOptions | CancellationTokenLike, token?: CancellationTokenLike): Promise<GitTreeEntry[]> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.listTreeEntries) {
			throw new GitHistoryError('ProcessFailure', 'listTreeEntries is not available on workbench Git repository');
		}
		const opts = (options && 'maxEntries' in options) ? options : undefined;
		const actualToken = (options && 'isCancellationRequested' in options) ? options : token;
		try {
			const entries = await repo.listTreeEntries(ref, opts, actualToken);
			return (entries || []).map(e => ({
				path: e.path,
				objectId: e.objectId,
				blobOid: e.objectId,
				mode: e.mode,
				objectType: e.objectType,
				size: e.size,
			}));
		} catch (err: any) {
			const code = err?.code || 'ProcessFailure';
			throw new GitHistoryError(code, err?.message || `Failed to list tree for '${ref}'`);
		}
	}

	async readFileAtRef(rootPath: string, ref: string, relativePath: string, token?: CancellationTokenLike): Promise<string> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.readBlobContent) {
			throw new GitHistoryError('ProcessFailure', 'readBlobContent is not available on workbench Git repository');
		}
		try {
			return await repo.readBlobContent(ref, relativePath, undefined, token);
		} catch (err: any) {
			const code = err?.code || 'ObjectUnavailable';
			throw new GitHistoryError(code, err?.message || `Failed to read blob at '${ref}:${relativePath}'`);
		}
	}

	async readBlob(rootPath: string, objectId: string, token?: CancellationTokenLike): Promise<string> {
		return this.readFileAtRef(rootPath, objectId, '', token);
	}

	async diffCommitTrees(rootPath: string, refA: string, refB: string, token?: CancellationTokenLike): Promise<GitExactDiffResult> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.diffExactTrees) {
			throw new GitHistoryError('ProcessFailure', 'diffExactTrees is not available on workbench Git repository');
		}
		try {
			const res = await repo.diffExactTrees(refA, refB, token);
			return {
				fromRef: res.fromRef,
				toRef: res.toRef,
				changes: res.changes || [],
			};
		} catch (err: any) {
			const code = err?.code || 'ProcessFailure';
			throw new GitHistoryError(code, err?.message || `Failed to diff ${refA}..${refB}`);
		}
	}

	async diffCommitToParent(rootPath: string, commitRef: string, parentIndex?: number, token?: CancellationTokenLike): Promise<GitExactDiffResult> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.diffCommitToParent) {
			throw new GitHistoryError('ProcessFailure', 'diffCommitToParent is not available on workbench Git repository');
		}
		try {
			const res = await repo.diffCommitToParent(commitRef, parentIndex, token);
			return {
				fromRef: res.fromRef,
				toRef: res.toRef,
				changes: res.changes || [],
			};
		} catch (err: any) {
			const code = err?.code || 'ProcessFailure';
			throw new GitHistoryError(code, err?.message || `Failed to diff commit '${commitRef}' to parent`);
		}
	}

	async diffReviewRange(rootPath: string, baseRef: string, headRef: string, token?: CancellationTokenLike): Promise<GitExactDiffResult> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.diffReviewRange) {
			throw new GitHistoryError('ProcessFailure', 'diffReviewRange is not available on workbench Git repository');
		}
		try {
			const res = await repo.diffReviewRange(baseRef, headRef, token);
			return {
				fromRef: res.fromRef,
				toRef: res.toRef,
				changes: res.changes || [],
			};
		} catch (err: any) {
			const code = err?.code || 'ProcessFailure';
			throw new GitHistoryError(code, err?.message || `Failed to diff review range ${baseRef}...${headRef}`);
		}
	}

	notifyHeadChanged(repositoryId: string, newHead: string, transitionType: 'commit' | 'checkout' | 'reset' | 'branch-switch' | 'external' = 'external'): void {
		const previousHead = this._lastHeadShaByRepo.get(repositoryId);
		if (newHead === previousHead) {
			// Deduplicate per-repository only; different repos may share identical SHAs.
			return;
		}
		this._lastHeadShaByRepo.set(repositoryId, newHead);
		const event: GitHeadChangeEvent = {
			repositoryId,
			previousHead,
			currentHead: newHead,
			timestamp: Date.now(),
			transitionType,
		};
		for (const listener of this._headListeners) {
			try {
				listener(event);
			} catch {
				// Listener error
			}
		}
	}

	dispose(): void {
		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;
		this._headListeners.clear();
	}
}

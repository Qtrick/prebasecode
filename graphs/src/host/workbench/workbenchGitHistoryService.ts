/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { EventLike, IGitHistoryService } from '../../history/git/gitHistoryService.js';
import {
	GitHistoryError,
	type GitBranchInfo,
	type GitCommitMetadata,
	type GitExactDiffResult,
	type GitHeadChangeEvent,
	type GitLogOptions,
	type GitRepositoryIdentity,
	type GitTagInfo,
	type GitTreeEntry,
} from '../../history/git/gitTypes.js';

export interface WorkbenchGitServiceLike {
	readonly repositories: Iterable<WorkbenchGitRepositoryLike>;
	openRepository(uri: any): Promise<WorkbenchGitRepositoryLike | undefined>;
}

export interface WorkbenchGitRepositoryLike {
	readonly rootUri: { readonly fsPath?: string; readonly path: string; toString(): string };
	readonly state: { readonly get?: () => any; readonly current?: any };
	getRefs?(query: any, token?: any): Promise<any[]>;
	resolveCommitRef?(ref: string, token?: any): Promise<string>;
	getCommitDetails?(ref: string, token?: any): Promise<any>;
	getCommitLog?(options: any, token?: any): Promise<any[]>;
	listTreeEntries?(ref: string, token?: any): Promise<any[]>;
	readBlobContent?(ref: string, path: string, maxBytes?: number, token?: any): Promise<string>;
	diffExactTrees?(refA: string, refB: string, token?: any): Promise<any>;
	diffCommitToParent?(commitRef: string, parentIndex?: number, token?: any): Promise<any>;
	diffReviewRange?(baseRef: string, headRef: string, token?: any): Promise<any>;
	checkIgnore?(paths: string[]): Promise<string[]>;
}

function normalizePath(p: string): string {
	return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export class WorkbenchGitHistoryService implements IGitHistoryService {
	private readonly _gitService: WorkbenchGitServiceLike;
	private readonly _headListeners = new Set<(e: GitHeadChangeEvent) => void>();
	private _lastHeadSha: string | undefined;

	readonly onDidChangeHead: EventLike<GitHeadChangeEvent> = (listener) => {
		this._headListeners.add(listener);
		return {
			dispose: () => {
				this._headListeners.delete(listener);
			},
		};
	};

	constructor(gitService: WorkbenchGitServiceLike) {
		this._gitService = gitService;
	}

	private _findRepository(rootPath: string): WorkbenchGitRepositoryLike | undefined {
		const target = normalizePath(rootPath);
		for (const repo of this._gitService.repositories) {
			const repoFsPath = repo.rootUri.fsPath ? normalizePath(repo.rootUri.fsPath) : '';
			const repoPath = normalizePath(repo.rootUri.path);
			if (repoFsPath === target || repoPath === target || target.endsWith(repoPath)) {
				return repo;
			}
		}
		// Fallback: if only one repository is open, return it
		const allRepos = Array.from(this._gitService.repositories);
		if (allRepos.length === 1) {
			return allRepos[0];
		}
		return undefined;
	}

	private async _ensureRepository(rootPath: string): Promise<WorkbenchGitRepositoryLike> {
		let repo = this._findRepository(rootPath);
		if (!repo) {
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
		await this._ensureRepository(rootPath);
		return {
			rootPath,
			gitDir: `${rootPath}/.git`,
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
			throw new GitHistoryError('UnknownRef', err?.message || `Failed to get commit details for '${ref}'`);
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
			throw new GitHistoryError('ProcessFailure', err?.message || 'Failed to get commit log');
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
			throw new GitHistoryError('UnknownRef', err?.message || `Failed to resolve ref '${ref}'`);
		}
	}

	async listBranches(rootPath: string, token?: CancellationTokenLike): Promise<GitBranchInfo[]> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.getRefs) {
			return [];
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
		} catch {
			return [];
		}
	}

	async listTags(rootPath: string, token?: CancellationTokenLike): Promise<GitTagInfo[]> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.getRefs) {
			return [];
		}
		try {
			const refs = await repo.getRefs({ pattern: 'refs/tags/*' }, token);
			return (refs || [])
				.filter(r => r.name && r.commit)
				.map(r => ({
					name: r.name,
					tagCommit: r.commit,
					peeledCommit: r.commit,
					isAnnotated: false,
				}));
		} catch {
			return [];
		}
	}

	async listTree(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<GitTreeEntry[]> {
		const repo = await this._ensureRepository(rootPath);
		if (!repo.listTreeEntries) {
			throw new GitHistoryError('ProcessFailure', 'listTreeEntries is not available on workbench Git repository');
		}
		try {
			const entries = await repo.listTreeEntries(ref, token);
			return (entries || []).map(e => ({
				path: e.path,
				objectId: e.objectId,
				blobOid: e.objectId,
				mode: e.mode,
				objectType: e.objectType,
				size: e.size,
			}));
		} catch (err: any) {
			throw new GitHistoryError('ProcessFailure', err?.message || `Failed to list tree for '${ref}'`);
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
			throw new GitHistoryError('ObjectUnavailable', err?.message || `Failed to read blob at '${ref}:${relativePath}'`);
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
			throw new GitHistoryError('ProcessFailure', err?.message || `Failed to diff ${refA}..${refB}`);
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
			throw new GitHistoryError('ProcessFailure', err?.message || `Failed to diff commit '${commitRef}' to parent`);
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
			throw new GitHistoryError('ProcessFailure', err?.message || `Failed to diff review range ${baseRef}...${headRef}`);
		}
	}

	notifyHeadChanged(repositoryId: string, newHead: string, transitionType: 'commit' | 'checkout' | 'reset' | 'branch-switch' | 'external' = 'external'): void {
		if (newHead === this._lastHeadSha) {
			return;
		}
		const previousHead = this._lastHeadSha;
		this._lastHeadSha = newHead;
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
}

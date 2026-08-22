/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Event } from '../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IExtHostExtensionService } from './extHostExtensionService.js';
import { IExtHostRpcService } from './extHostRpcService.js';
import { ExtHostGitExtensionShape, GitBranchDto, GitChangeDto, GitCommitMetadataDto, GitDiffChangeDto, GitExactDiffChangeDto, GitExactDiffResultDto, GitHistoryResultDto, GitLogOptionsDto, GitRefDto, GitRefQueryDto, GitRefTypeDto, GitRepositoryStateDto, GitTreeEntryDto, GitUpstreamRefDto, MainContext, MainThreadGitExtensionShape } from './extHost.protocol.js';
import { ResourceMap } from '../../../base/common/map.js';
import * as path from '../../../base/common/path.js';

const GIT_EXTENSION_ID = 'vscode.git';

function toGitRefTypeDto(type: GitRefType): GitRefTypeDto {
	switch (type) {
		case GitRefType.Head: return GitRefTypeDto.Head;
		case GitRefType.RemoteHead: return GitRefTypeDto.RemoteHead;
		case GitRefType.Tag: return GitRefTypeDto.Tag;
		default: throw new Error(`Unknown GitRefType: ${type}`);
	}
}

function toGitBranchDto(branch: Branch): GitBranchDto {
	return {
		name: branch.name,
		commit: branch.commit,
		type: toGitRefTypeDto(branch.type),
		remote: branch.remote,
		upstream: branch.upstream ? toGitUpstreamRefDto(branch.upstream) : undefined,
		ahead: branch.ahead,
		behind: branch.behind,
	};
}

function toGitUpstreamRefDto(upstream: UpstreamRef): GitUpstreamRefDto {
	return {
		remote: upstream.remote,
		name: upstream.name,
		commit: upstream.commit,
	};
}

// Status values from the git extension's const enum Status
const enum GitStatus {
	INDEX_ADDED = 1,
	INDEX_DELETED = 2,
	INDEX_RENAMED = 3,
	MODIFIED = 5,
	DELETED = 6,
	UNTRACKED = 7,
	INTENT_TO_ADD = 9,
	INTENT_TO_RENAME = 10,
}

function toGitChangeDto(change: Change): GitChangeDto {
	switch (change.status) {
		// Added: no original
		case GitStatus.INDEX_ADDED:
		case GitStatus.UNTRACKED:
		case GitStatus.INTENT_TO_ADD:
			return { uri: change.uri, originalUri: undefined, modifiedUri: change.uri };

		// Deleted: no modified
		case GitStatus.INDEX_DELETED:
		case GitStatus.DELETED:
			return { uri: change.uri, originalUri: change.uri, modifiedUri: undefined };

		// Renamed: original is old name, modified is new name
		case GitStatus.INDEX_RENAMED:
		case GitStatus.INTENT_TO_RENAME:
			return { uri: change.uri, originalUri: change.originalUri, modifiedUri: change.renameUri };

		// Modified and everything else: both original and modified
		default:
			return { uri: change.uri, originalUri: change.originalUri, modifiedUri: change.uri };
	}
}

interface DiffChange extends Change {
	readonly insertions: number;
	readonly deletions: number;
	readonly oldBlobOid?: string;
	readonly newBlobOid?: string;
	readonly similarity?: number;
}

interface Commit {
	readonly hash: string;
	readonly message: string;
	readonly parents: string[];
	readonly authorDate?: Date;
	readonly authorName?: string;
	readonly authorEmail?: string;
	readonly committerName?: string;
	readonly committerEmail?: string;
	readonly commitDate?: Date;
}

interface LogOptions {
	readonly maxEntries?: number;
	readonly range?: string;
	readonly path?: string;
	readonly sortByAuthorDate?: boolean;
	readonly firstParent?: boolean;
	readonly skip?: number;
}

interface LsTreeItem {
	readonly mode: string;
	readonly type: string;
	readonly object: string;
	readonly size: string;
	readonly file: string;
}

interface LsTreeInventory {
	readonly entries: LsTreeItem[];
	readonly isTruncated: boolean;
	readonly returnedCount: number;
	readonly discoveredAtLeast: number;
}

interface Repository {
	readonly rootUri: vscode.Uri;
	readonly state: RepositoryState;

	status(): Promise<void>;
	getBranchBase(name: string): Promise<Branch | undefined>;
	getRefs(query: GitRefQuery, token?: vscode.CancellationToken): Promise<GitRef[]>;
	getBranches?(query: { remote?: boolean }, token?: vscode.CancellationToken): Promise<GitRef[]>;
	getCommit?(ref: string): Promise<Commit>;
	resolveCommitRef?(ref: string): Promise<string>;
	log?(options?: LogOptions, token?: vscode.CancellationToken): Promise<Commit[]>;
	getObjectFiles?(ref: string, options?: { recursive?: boolean; path?: string; maxEntries?: number; scope?: string }): Promise<LsTreeItem[]>;
	getObjectFilesInventory?(ref: string, options?: { recursive?: boolean; path?: string; maxEntries?: number; scope?: string }, token?: vscode.CancellationToken): Promise<LsTreeInventory>;
	getObjectDetails?(treeish: string, path: string): Promise<{ mode: string; object: string; size: number }>;
	show?(ref: string, path: string): Promise<string>;
	buffer?(ref: string, path: string): Promise<Buffer>;
	diffBetween?(ref1: string, ref2: string, path?: string): Promise<Change[]>;
	diffBetweenWithStats(ref1: string, ref2: string, path?: string): Promise<DiffChange[]>;
	diffBetweenWithStats2(ref: string, path?: string): Promise<DiffChange[]>;
	diffTrees?(treeish1: string, treeish2?: string, options?: { root?: boolean; similarityThreshold?: number }): Promise<DiffChange[]>;
	getMergeBase?(ref1: string, ref2: string): Promise<string | undefined>;
	checkIgnore?(paths: string[]): Promise<Set<string>>;
	isBranchProtected(branch?: Branch): boolean;
}

interface Change {
	readonly uri: vscode.Uri;
	readonly originalUri: vscode.Uri;
	readonly renameUri: vscode.Uri | undefined;
	readonly status: number;
}

interface RepositoryState {
	readonly HEAD: Branch | undefined;
	readonly remotes: Remote[];
	readonly mergeChanges: Change[];
	readonly indexChanges: Change[];
	readonly workingTreeChanges: Change[];
	readonly untrackedChanges: Change[];
	readonly onDidChange: Event<void>;
}

interface Remote {
	readonly name: string;
	readonly fetchUrl?: string;
	readonly pushUrl?: string;
	readonly isReadOnly: boolean;
}

interface Branch extends GitRef {
	readonly base?: BaseRef;
	readonly upstream?: UpstreamRef;
	readonly ahead?: number;
	readonly behind?: number;
}

interface BaseRef {
	readonly name: string;
	readonly isProtected: boolean;
}

interface UpstreamRef {
	readonly remote: string;
	readonly name: string;
	readonly commit?: string;
}

interface GitRef {
	type: GitRefType;
	name?: string;
	commit?: string;
	remote?: string;
}

const enum GitRefType {
	Head,
	RemoteHead,
	Tag
}

interface GitRefQuery {
	readonly contains?: string;
	readonly count?: number;
	readonly pattern?: string | string[];
	readonly sort?: 'alphabetically' | 'committerdate' | 'creatordate';
}

interface GitExtensionAPI {
	readonly repositories: readonly Repository[];
	readonly onDidOpenRepository: Event<Repository>;
	readonly onDidCloseRepository: Event<Repository>;
	openRepository(root: vscode.Uri): Promise<Repository | null>;
}

interface GitExtension {
	getAPI(version: 1): GitExtensionAPI;
}

function getErrorMessage(err: unknown): string | undefined {
	if (err instanceof Error && err.message) {
		return err.message;
	}
	if (typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string') {
		return (err as { message: string }).message;
	}
	return undefined;
}

function mapGitErrorToCode(err: unknown, defaultCode: string = 'ProcessFailure'): string {
	if (!err) {
		return defaultCode;
	}
	const errObj = typeof err === 'object' && err !== null ? (err as { code?: unknown; message?: unknown; stderr?: unknown; name?: unknown }) : undefined;
	if (errObj && typeof errObj.code === 'string') {
		return errObj.code;
	}
	const msg = String(errObj?.message || errObj?.stderr || err).toLowerCase();
	if (msg.includes('unknown revision') || msg.includes('bad object') || msg.includes('not a valid object name') || msg.includes('ambiguous argument') || msg.includes('path not known by git')) {
		return 'UnknownRef';
	}
	if (msg.includes('exceeds') || msg.includes('oversized')) {
		return 'OversizedBlob';
	}
	if (msg.includes('cancel') || (errObj && errObj.name === 'CancellationError')) {
		return 'Cancelled';
	}
	if (msg.includes('timeout')) {
		return 'Timeout';
	}
	if (msg.includes('buffer') || msg.includes('out of memory')) {
		return 'BufferLimit';
	}
	if (msg.includes('not a git repository') || (msg.includes('repository') && msg.includes('not found'))) {
		return 'RepositoryNotFound';
	}
	if (msg.includes('does not exist in') || msg.includes('could not show object')) {
		return 'ObjectUnavailable';
	}
	if (msg.includes('not supported') || msg.includes('unknown option')) {
		return 'NotSupported';
	}
	return defaultCode;
}

export interface IExtHostGitExtensionService extends ExtHostGitExtensionShape {
	readonly _serviceBrand: undefined;
}

export const IExtHostGitExtensionService = createDecorator<IExtHostGitExtensionService>('IExtHostGitExtensionService');

export class ExtHostGitExtensionService extends Disposable implements IExtHostGitExtensionService {
	declare readonly _serviceBrand: undefined;

	private static _handlePool: number = 0;

	private _gitApi: GitExtensionAPI | undefined;
	private _gitApiListenersInstalled = false;

	private readonly _proxy: MainThreadGitExtensionShape;

	private readonly _repositories = new Map<number, Repository>();
	private readonly _repositoryByUri = new ResourceMap<number>();
	private readonly _repositoryStateChangeListeners = new DisposableMap<number, vscode.Disposable>();

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostExtensionService private readonly _extHostExtensionService: IExtHostExtensionService,
	) {
		super();

		this._proxy = extHostRpc.getProxy(MainContext.MainThreadGitExtension);
	}

	async $isGitExtensionAvailable(): Promise<boolean> {
		const registry = await this._extHostExtensionService.getExtensionRegistry();
		return !!registry.getExtensionDescription(GIT_EXTENSION_ID);
	}

	async $openRepository(uri: UriComponents): Promise<{ handle: number; rootUri: UriComponents; state: GitRepositoryStateDto } | undefined> {
		const api = await this._ensureGitApi();
		if (!api) {
			return undefined;
		}

		const repository = await api.openRepository(URI.revive(uri));
		if (!repository) {
			return undefined;
		}

		return this._registerRepository(repository);
	}

	private _registerRepository(repository: Repository): { handle: number; rootUri: UriComponents; state: GitRepositoryStateDto } {
		const existingHandle = this._repositoryByUri.get(repository.rootUri);
		if (existingHandle !== undefined) {
			if (this._repositories.get(existingHandle) !== repository) {
				this._repositories.set(existingHandle, repository);
				this._repositoryByUri.set(repository.rootUri, existingHandle);

				this._setRepositoryStateChangeListener(existingHandle, repository);
			}

			const state = this._getRepositoryState(repository);
			return { handle: existingHandle, rootUri: repository.rootUri, state };
		}

		// Store the repository and its handle in the maps
		const handle = ExtHostGitExtensionService._handlePool++;

		this._repositories.set(handle, repository);
		this._repositoryByUri.set(repository.rootUri, handle);

		this._setRepositoryStateChangeListener(handle, repository);

		const state = this._getRepositoryState(repository);
		return { handle, rootUri: repository.rootUri, state };
	}

	private _unregisterRepository(repository: Repository): number | undefined {
		const handle = this._repositoryByUri.get(repository.rootUri);
		if (handle === undefined) {
			return undefined;
		}
		this._repositoryStateChangeListeners.deleteAndDispose(handle);
		this._repositoryByUri.delete(repository.rootUri);
		this._repositories.delete(handle);
		return handle;
	}

	async $getRefs(handle: number, query: GitRefQueryDto, token?: vscode.CancellationToken): Promise<GitRefDto[]> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return [];
		}

		try {
			const refs = await repository.getRefs(query, token);
			const result: (GitRefDto | undefined)[] = refs.map(ref => {
				if (!ref.name || !ref.commit) {
					return undefined;
				}

				const id = ref.type === GitRefType.Head
					? `refs/heads/${ref.name}`
					: ref.type === GitRefType.RemoteHead
						? `refs/remotes/${ref.remote}/${ref.name}`
						: `refs/tags/${ref.name}`;

				return {
					id,
					name: ref.name,
					type: toGitRefTypeDto(ref.type),
					revision: ref.commit,
					tagCommit: (ref as { readonly tagCommit?: string }).tagCommit,
					peeledCommit: (ref as { readonly peeledCommit?: string }).peeledCommit,
					isAnnotated: (ref as { readonly isAnnotated?: boolean }).isAnnotated,
				} satisfies GitRefDto;
			});

			return result.filter(ref => !!ref);
		} catch {
			return [];
		}
	}

	async $getRepositoryState(handle: number): Promise<GitRepositoryStateDto | undefined> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return undefined;
		}

		return this._getRepositoryState(repository);
	}

	private _getRepositoryState(repository: Repository): GitRepositoryStateDto {
		const state = repository.state;

		return {
			HEAD: state.HEAD ? toGitBranchDto(state.HEAD) : undefined,
			remotes: state.remotes,
			mergeChanges: state.mergeChanges.map(toGitChangeDto),
			indexChanges: state.indexChanges.map(toGitChangeDto),
			workingTreeChanges: state.workingTreeChanges.map(toGitChangeDto),
			untrackedChanges: state.untrackedChanges.map(toGitChangeDto),
		};
	}

	private _setRepositoryStateChangeListener(handle: number, repository: Repository): void {
		this._repositoryStateChangeListeners.set(handle, repository.state.onDidChange(() => {
			this._proxy.$onDidChangeRepository(handle);
		}));
	}

	async $diffBetweenWithStats(handle: number, ref1: string, ref2: string, path?: string): Promise<GitDiffChangeDto[]> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return [];
		}

		try {
			const changes = await repository.diffBetweenWithStats(ref1, ref2, path);
			return changes.map(c => ({
				...toGitChangeDto(c),
				insertions: c.insertions,
				deletions: c.deletions,
			}));
		} catch {
			return [];
		}
	}

	async $diffBetweenWithStats2(handle: number, ref: string, path?: string): Promise<GitDiffChangeDto[]> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return [];
		}

		try {
			const changes = await repository.diffBetweenWithStats2(ref, path);
			return changes.map(c => ({
				...toGitChangeDto(c),
				insertions: c.insertions,
				deletions: c.deletions,
			}));
		} catch {
			return [];
		}
	}

	async $resolveCommitRef(handle: number, ref: string, token?: vscode.CancellationToken): Promise<GitHistoryResultDto<string>> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return { success: false, error: { code: 'RepositoryNotFound', message: `Repository with handle ${handle} not found` } };
		}
		if (token?.isCancellationRequested) {
			return { success: false, error: { code: 'Cancelled', message: 'Operation cancelled' } };
		}
		try {
			if (typeof repository.resolveCommitRef === 'function') {
				const sha = await repository.resolveCommitRef(ref);
				return { success: true, data: sha };
			}
			if (typeof repository.getCommit === 'function') {
				const commit = await repository.getCommit(ref);
				if (!commit?.hash) {
					return { success: false, error: { code: 'UnknownRef', message: `Ref '${ref}' could not be resolved to a commit` } };
				}
				return { success: true, data: commit.hash };
			}
			return { success: false, error: { code: 'NotSupported', message: 'resolveCommitRef is not supported on repository' } };
		} catch (err) {
			return { success: false, error: { code: 'UnknownRef', message: getErrorMessage(err) || `Failed to resolve ref '${ref}'` } };
		}
	}

	async $getCommitDetails(handle: number, ref: string, token?: vscode.CancellationToken): Promise<GitHistoryResultDto<GitCommitMetadataDto>> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return { success: false, error: { code: 'RepositoryNotFound', message: `Repository with handle ${handle} not found` } };
		}
		if (token?.isCancellationRequested) {
			return { success: false, error: { code: 'Cancelled', message: 'Operation cancelled' } };
		}
		try {
			if (typeof repository.getCommit === 'function') {
				const commit = await repository.getCommit(ref);
				if (!commit) {
					return { success: false, error: { code: 'UnknownRef', message: `Commit '${ref}' not found` } };
				}
				const authorDateStr = commit.authorDate ? new Date(commit.authorDate).toISOString() : '';
				const commitDateStr = commit.commitDate ? new Date(commit.commitDate).toISOString() : '';
				return {
					success: true,
					data: {
						sha: commit.hash,
						parents: commit.parents || [],
						author: {
							name: commit.authorName || '',
							email: commit.authorEmail || '',
							date: authorDateStr,
						},
						committer: {
							name: commit.committerName || commit.authorName || '',
							email: commit.committerEmail || commit.authorEmail || '',
							date: commitDateStr || authorDateStr,
						},
						authorTimestamp: commit.authorDate ? new Date(commit.authorDate).getTime() : 0,
						committerTimestamp: commit.commitDate ? new Date(commit.commitDate).getTime() : 0,
						message: commit.message || '',
					}
				};
			}
			return { success: false, error: { code: 'NotSupported', message: 'getCommit is not supported on repository' } };
		} catch (err) {
			return { success: false, error: { code: 'UnknownRef', message: getErrorMessage(err) || `Failed to get commit '${ref}'` } };
		}
	}

	async $getCommitLog(handle: number, options: GitLogOptionsDto, token?: vscode.CancellationToken): Promise<GitHistoryResultDto<GitCommitMetadataDto[]>> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return { success: false, error: { code: 'RepositoryNotFound', message: `Repository with handle ${handle} not found` } };
		}
		if (token?.isCancellationRequested) {
			return { success: false, error: { code: 'Cancelled', message: 'Operation cancelled' } };
		}
		try {
			if (typeof repository.log === 'function') {
				const logOptions: LogOptions = {
					maxEntries: options.limit,
					range: options.ref,
					path: options.path,
					firstParent: options.firstParent,
					skip: options.skip,
				};
				const commits = await repository.log(logOptions, token);
				const mapped: GitCommitMetadataDto[] = (commits || []).map(commit => {
					const authorDateStr = commit.authorDate ? new Date(commit.authorDate).toISOString() : '';
					const commitDateStr = commit.commitDate ? new Date(commit.commitDate).toISOString() : '';
					return {
						sha: commit.hash,
						parents: commit.parents || [],
						author: {
							name: commit.authorName || '',
							email: commit.authorEmail || '',
							date: authorDateStr,
						},
						committer: {
							name: commit.committerName || commit.authorName || '',
							email: commit.committerEmail || commit.authorEmail || '',
							date: commitDateStr || authorDateStr,
						},
						authorTimestamp: commit.authorDate ? new Date(commit.authorDate).getTime() : 0,
						committerTimestamp: commit.commitDate ? new Date(commit.commitDate).getTime() : 0,
						message: commit.message || '',
					};
				});
				return { success: true, data: mapped };
			}
			return { success: false, error: { code: 'NotSupported', message: 'log is not supported on repository' } };
		} catch (err) {
			return { success: false, error: { code: mapGitErrorToCode(err, 'ProcessFailure'), message: getErrorMessage(err) || 'Failed to get commit log' } };
		}
	}

	async $listTreeEntries(handle: number, ref: string, options?: { maxEntries?: number; scope?: string }, token?: vscode.CancellationToken): Promise<GitHistoryResultDto<{ entries: GitTreeEntryDto[]; isTruncated: boolean; returnedCount: number; discoveredAtLeast: number }>> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return { success: false, error: { code: 'RepositoryNotFound', message: `Repository with handle ${handle} not found` } };
		}
		if (token?.isCancellationRequested) {
			return { success: false, error: { code: 'Cancelled', message: 'Operation cancelled' } };
		}
		try {
			if (typeof repository.getObjectFilesInventory === 'function') {
				const inventory = await repository.getObjectFilesInventory(ref, { recursive: true, path: options?.scope, maxEntries: options?.maxEntries, scope: options?.scope }, token);
				const entries: GitTreeEntryDto[] = (inventory.entries || []).map(item => ({
					path: item.file,
					objectId: item.object,
					mode: item.mode,
					objectType: item.type === 'blob' ? 'blob' : item.type === 'tree' ? 'tree' : item.type === 'commit' ? 'commit' : 'tag',
					size: parseInt(item.size, 10) || undefined,
				}));
				return { success: true, data: {
					entries,
					isTruncated: inventory.isTruncated,
					returnedCount: entries.length,
					discoveredAtLeast: Math.max(entries.length, inventory.discoveredAtLeast || entries.length),
				} };
			}
			return { success: false, error: { code: 'NotSupported', message: 'Producer-bounded tree inventory is not available on repository' } };
		} catch (err) {
			const code = mapGitErrorToCode(err, 'ProcessFailure');
			return { success: false, error: { code, message: getErrorMessage(err) || `Failed to list tree for '${ref}'` } };
		}
	}

	async $readBlobContent(handle: number, ref: string, path: string, maxBytes?: number, token?: vscode.CancellationToken): Promise<GitHistoryResultDto<string>> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return { success: false, error: { code: 'RepositoryNotFound', message: `Repository with handle ${handle} not found` } };
		}
		if (token?.isCancellationRequested) {
			return { success: false, error: { code: 'Cancelled', message: 'Operation cancelled' } };
		}
		try {
			if (maxBytes !== undefined && typeof repository.getObjectDetails === 'function') {
				try {
					const details = await repository.getObjectDetails(ref, path);
					if (details && details.size > maxBytes) {
						return { success: false, error: { code: 'OversizedBlob', message: `Blob size ${details.size} exceeds maximum limit of ${maxBytes} bytes` } };
					}
				} catch (detailErr) {
					const detailCode = mapGitErrorToCode(detailErr);
					if (detailCode === 'OversizedBlob') {
						return { success: false, error: { code: 'OversizedBlob', message: getErrorMessage(detailErr) || `Blob exceeds maximum limit of ${maxBytes} bytes` } };
					}
					// Fall through to buffer
				}
			}
			if (typeof repository.buffer === 'function') {
				const buf = await repository.buffer(ref, path);
				if (maxBytes !== undefined && buf.length > maxBytes) {
					return { success: false, error: { code: 'OversizedBlob', message: `Blob size ${buf.length} exceeds limit ${maxBytes}` } };
				}
				return { success: true, data: buf.toString('utf8') };
			}
			if (typeof repository.show === 'function') {
				const content = await repository.show(ref, path);
				return { success: true, data: content };
			}
			return { success: false, error: { code: 'NotSupported', message: 'show is not supported on repository' } };
		} catch (err) {
			const code = mapGitErrorToCode(err, 'ObjectUnavailable');
			return { success: false, error: { code, message: getErrorMessage(err) || `Failed to read blob at '${ref}:${path}'` } };
		}
	}

	async $diffExactTrees(handle: number, refA: string, refB: string, token?: vscode.CancellationToken): Promise<GitHistoryResultDto<GitExactDiffResultDto>> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return { success: false, error: { code: 'RepositoryNotFound', message: `Repository with handle ${handle} not found` } };
		}
		if (token?.isCancellationRequested) {
			return { success: false, error: { code: 'Cancelled', message: 'Operation cancelled' } };
		}
		try {
			let diffs: DiffChange[];
			if (typeof repository.diffTrees === 'function') {
				diffs = await repository.diffTrees(refA, refB);
			} else {
				diffs = await repository.diffBetweenWithStats(refA, refB);
			}
			const rootPath = repository.rootUri.path;
			const changes: GitExactDiffChangeDto[] = (diffs || []).map(d => {
				let kind: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied' = 'modified';
				if (d.status === GitStatus.INDEX_ADDED || d.status === GitStatus.UNTRACKED || d.status === GitStatus.INTENT_TO_ADD) {
					kind = 'added';
				} else if (d.status === GitStatus.INDEX_DELETED || d.status === GitStatus.DELETED) {
					kind = 'deleted';
				} else if (d.status === GitStatus.INDEX_RENAMED || d.status === GitStatus.INTENT_TO_RENAME) {
					kind = 'renamed';
				}
				const changeDto = toGitChangeDto(d);
				const modifiedUri = changeDto.modifiedUri ? URI.revive(changeDto.modifiedUri) : undefined;
				const originalUri = changeDto.originalUri ? URI.revive(changeDto.originalUri) : undefined;
				const uri = changeDto.uri ? URI.revive(changeDto.uri) : undefined;
				const relPath = modifiedUri ? modifiedUri.path.slice(rootPath.length + 1) : (uri ? uri.path.slice(rootPath.length + 1) : '');
				const oldRelPath = originalUri ? originalUri.path.slice(rootPath.length + 1) : undefined;
				return {
					kind,
					path: relPath,
					oldPath: oldRelPath,
					similarity: d.similarity,
					oldBlobOid: d.oldBlobOid,
					newBlobOid: d.newBlobOid,
				};
			});
			return { success: true, data: { fromRef: refA, toRef: refB, changes } };
		} catch (err) {
			const code = mapGitErrorToCode(err, 'ProcessFailure');
			return { success: false, error: { code, message: getErrorMessage(err) || `Failed to diff ${refA}..${refB}` } };
		}
	}

	async $diffCommitToParent(handle: number, commitRef: string, parentIndex?: number, token?: vscode.CancellationToken): Promise<GitHistoryResultDto<GitExactDiffResultDto>> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return { success: false, error: { code: 'RepositoryNotFound', message: `Repository with handle ${handle} not found` } };
		}
		if (token?.isCancellationRequested) {
			return { success: false, error: { code: 'Cancelled', message: 'Operation cancelled' } };
		}
		try {
			if (typeof repository.getCommit === 'function') {
				const commit = await repository.getCommit(commitRef);
				if (!commit) {
					return { success: false, error: { code: 'UnknownRef', message: `Commit '${commitRef}' not found` } };
				}
				const parents = commit.parents || [];
				const pIndex = parentIndex ?? 0;
				if (parents.length === 0 || pIndex >= parents.length) {
					// Root commit: diff directly against null tree using --root semantics (object-format independent)
					if (typeof repository.diffTrees === 'function') {
						const diffs = await repository.diffTrees(commitRef, undefined, { root: true });
						const rootPath = repository.rootUri.path;
						const changes: GitExactDiffChangeDto[] = (diffs || []).map(d => {
							const changeDto = toGitChangeDto(d);
							const modifiedUri = changeDto.modifiedUri ? URI.revive(changeDto.modifiedUri) : undefined;
							const originalUri = changeDto.originalUri ? URI.revive(changeDto.originalUri) : undefined;
							const uri = changeDto.uri ? URI.revive(changeDto.uri) : undefined;
							const relPath = modifiedUri ? modifiedUri.path.slice(rootPath.length + 1) : (uri ? uri.path.slice(rootPath.length + 1) : '');
							const oldRelPath = originalUri ? originalUri.path.slice(rootPath.length + 1) : undefined;
							return {
								kind: 'added',
								path: relPath,
								oldPath: oldRelPath,
								similarity: d.similarity,
								oldBlobOid: d.oldBlobOid,
								newBlobOid: d.newBlobOid,
							};
						});
						return { success: true, data: { fromRef: '', toRef: commitRef, changes } };
					}
				}
				const parentRef = parents[pIndex];
				return this.$diffExactTrees(handle, parentRef, commitRef, token);
			}
			return { success: false, error: { code: 'NotSupported', message: 'getCommit is not supported on repository' } };
		} catch (err) {
			const code = mapGitErrorToCode(err, 'ProcessFailure');
			return { success: false, error: { code, message: getErrorMessage(err) || `Failed to diff commit '${commitRef}' to parent` } };
		}
	}

	async $diffReviewRange(handle: number, baseRef: string, headRef: string, token?: vscode.CancellationToken): Promise<GitHistoryResultDto<GitExactDiffResultDto>> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return { success: false, error: { code: 'RepositoryNotFound', message: `Repository with handle ${handle} not found` } };
		}
		try {
			let fromRef = baseRef;
			if (typeof repository.getMergeBase === 'function') {
				const mergeBase = await repository.getMergeBase(baseRef, headRef);
				if (mergeBase) {
					fromRef = mergeBase;
				}
			}
			return this.$diffExactTrees(handle, fromRef, headRef, token);
		} catch (err) {
			const code = mapGitErrorToCode(err, 'ProcessFailure');
			return { success: false, error: { code, message: getErrorMessage(err) || `Failed to diff review range ${baseRef}...${headRef}` } };
		}
	}

	async $checkIgnore(handle: number, paths: string[]): Promise<string[]> {
		const repository = this._repositories.get(handle);
		if (!repository || !paths || paths.length === 0) {
			return [];
		}
		try {
			if (typeof repository.checkIgnore === 'function') {
				const rootPath = repository.rootUri.fsPath;
				const absPaths = paths.map(p => path.isAbsolute(p) ? p : path.join(rootPath, p));
				const set = await repository.checkIgnore(absPaths);
				if (!set || set.size === 0) {
					return [];
				}
				const result = new Set<string>();
				for (const p of paths) {
					const abs = path.isAbsolute(p) ? p : path.join(rootPath, p);
					if (set.has(abs) || set.has(p)) {
						result.add(p);
						result.add(abs);
					}
				}
				return Array.from(result);
			}
			return [];
		} catch {
			return [];
		}
	}

	async $getEmptyTree(handle: number, token?: vscode.CancellationToken): Promise<GitHistoryResultDto<string>> {
		const repository = this._repositories.get(handle);
		if (!repository) {
			return { success: false, error: { code: 'RepositoryNotFound', message: `Repository with handle ${handle} not found` } };
		}
		if (token?.isCancellationRequested) {
			return { success: false, error: { code: 'Cancelled', message: 'Operation cancelled' } };
		}
		try {
			if (typeof (repository as any).getEmptyTree === 'function') {
				const emptyTree = await (repository as any).getEmptyTree();
				return { success: true, data: emptyTree };
			}
			return { success: true, data: '4b825dc642cb6eb9a060e54bf8d69288fbee4904' };
		} catch (err) {
			const code = mapGitErrorToCode(err, 'ProcessFailure');
			return { success: false, error: { code, message: getErrorMessage(err) || 'Failed to get empty tree' } };
		}
	}

	private async _ensureGitApi(): Promise<GitExtensionAPI | undefined> {
		if (this._gitApi) {
			return this._gitApi;
		}

		try {
			await this._extHostExtensionService.activateByIdWithErrors(
				new ExtensionIdentifier(GIT_EXTENSION_ID),
				{ startup: false, extensionId: new ExtensionIdentifier(GIT_EXTENSION_ID), activationEvent: 'api' }
			);

			const exports = this._extHostExtensionService.getExtensionExports(new ExtensionIdentifier(GIT_EXTENSION_ID));
			if (!!exports && typeof (exports as GitExtension).getAPI === 'function') {
				this._gitApi = (exports as GitExtension).getAPI(1);
				if (!this._gitApiListenersInstalled) {
					this._gitApiListenersInstalled = true;
					for (const repository of this._gitApi.repositories) {
						const dto = this._registerRepository(repository);
						await this._proxy.$onDidOpenRepository(dto);
					}
					this._register(this._gitApi.onDidOpenRepository(repository => {
						void this._proxy.$onDidOpenRepository(this._registerRepository(repository));
					}));
					this._register(this._gitApi.onDidCloseRepository(repository => {
						const handle = this._unregisterRepository(repository);
						if (handle !== undefined) {
							void this._proxy.$onDidCloseRepository(handle);
						}
					}));
				}
			}
		} catch {
			// Git extension not available
		}

		return this._gitApi;
	}

	override dispose(): void {
		this._repositoryStateChangeListeners.dispose();
		super.dispose();
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IObservable } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export enum GitRefType {
	Head,
	RemoteHead,
	Tag
}

export interface GitRef {
	readonly type: GitRefType;
	readonly name?: string;
	readonly commit?: string;
	readonly remote?: string;
	readonly tagCommit?: string;
	readonly peeledCommit?: string;
	readonly isAnnotated?: boolean;
}

export interface GitRefQuery {
	readonly contains?: string;
	readonly count?: number;
	readonly pattern?: string | string[];
	readonly sort?: 'alphabetically' | 'committerdate' | 'creatordate';
}

export interface GitChange {
	readonly uri: URI;
	readonly originalUri: URI | undefined;
	readonly modifiedUri: URI | undefined;
}

export interface GitDiffChange extends GitChange {
	readonly insertions: number;
	readonly deletions: number;
	readonly oldBlobOid?: string;
	readonly newBlobOid?: string;
	readonly similarity?: number;
}

export interface GitRemote {
	readonly name: string;
	readonly fetchUrl?: string;
	readonly pushUrl?: string;
	readonly isReadOnly: boolean;
}

export interface GitRepositoryState {
	readonly HEAD?: GitBranch;
	readonly remotes: readonly GitRemote[];
	readonly mergeChanges: readonly GitChange[];
	readonly indexChanges: readonly GitChange[];
	readonly workingTreeChanges: readonly GitChange[];
	readonly untrackedChanges: readonly GitChange[];
}

export interface GitBranch extends GitRef {
	readonly upstream?: GitUpstreamRef;
	readonly ahead?: number;
	readonly behind?: number;
}

export interface GitBaseRef {
	readonly name: string;
	readonly isProtected: boolean;
}

export interface GitUpstreamRef {
	readonly remote: string;
	readonly name: string;
	readonly commit?: string;
}

export interface GitCommitMetadata {
	readonly sha: string;
	readonly parents: string[];
	readonly author: { readonly name: string; readonly email: string; readonly date: string };
	readonly committer: { readonly name: string; readonly email: string; readonly date: string };
	readonly authorTimestamp: number;
	readonly committerTimestamp: number;
	readonly message: string;
}

export interface GitTreeEntry {
	readonly path: string;
	readonly objectId: string;
	readonly mode: string;
	readonly objectType: 'blob' | 'tree' | 'commit' | 'tag';
	readonly size?: number;
}

export interface GitTreeInventory {
	readonly entries: GitTreeEntry[];
	readonly isTruncated: boolean;
	readonly returnedCount: number;
	readonly discoveredAtLeast: number;
}

export interface GitExactDiffChange {
	readonly kind: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';
	readonly path: string;
	readonly oldPath?: string;
	readonly similarity?: number;
	readonly oldBlobOid?: string;
	readonly newBlobOid?: string;
}

export interface GitExactDiffResult {
	readonly fromRef: string;
	readonly toRef: string;
	readonly changes: GitExactDiffChange[];
}

export interface GitLogOptions {
	readonly ref?: string;
	readonly limit?: number;
	readonly skip?: number;
	readonly firstParent?: boolean;
	readonly path?: string;
}

export interface IGitRepository {
	readonly rootUri: URI;

	readonly state: IObservable<GitRepositoryState>;
	updateState(state: GitRepositoryState): void;

	getRefs(query: GitRefQuery, token?: CancellationToken): Promise<GitRef[]>;
	diffBetweenWithStats(ref1: string, ref2: string, path?: string): Promise<GitDiffChange[]>;
	diffBetweenWithStats2(ref: string, path?: string): Promise<GitDiffChange[]>;

	// Historical Git Bridge
	resolveCommitRef?(ref: string, token?: CancellationToken): Promise<string>;
	getCommitDetails?(ref: string, token?: CancellationToken): Promise<GitCommitMetadata>;
	getCommitLog?(options: GitLogOptions, token?: CancellationToken): Promise<GitCommitMetadata[]>;
	listTreeEntries?(ref: string, options?: { maxEntries?: number; scope?: string }, token?: CancellationToken): Promise<GitTreeInventory>;
	readBlobContent?(ref: string, path: string, maxBytes?: number, token?: CancellationToken): Promise<string>;
	diffExactTrees?(refA: string, refB: string, token?: CancellationToken): Promise<GitExactDiffResult>;
	diffCommitToParent?(commitRef: string, parentIndex?: number, token?: CancellationToken): Promise<GitExactDiffResult>;
	diffReviewRange?(baseRef: string, headRef: string, token?: CancellationToken): Promise<GitExactDiffResult>;
	checkIgnore?(paths: string[]): Promise<string[]>;
}

export interface IGitExtensionDelegate {
	readonly repositories: Iterable<IGitRepository>;
	readonly onDidOpenRepository: Event<IGitRepository>;
	readonly onDidCloseRepository: Event<IGitRepository>;
	openRepository(uri: URI): Promise<IGitRepository | undefined>;

	getRefs(root: URI, query?: GitRefQuery, token?: CancellationToken): Promise<GitRef[]>;
	diffBetweenWithStats(root: URI, ref1: string, ref2: string, path?: string): Promise<GitDiffChange[]>;
	diffBetweenWithStats2(root: URI, ref: string, path?: string): Promise<GitDiffChange[]>;

	// Historical Git Bridge
	resolveCommitRef?(root: URI, ref: string, token?: CancellationToken): Promise<string>;
	getCommitDetails?(root: URI, ref: string, token?: CancellationToken): Promise<GitCommitMetadata>;
	getCommitLog?(root: URI, options: GitLogOptions, token?: CancellationToken): Promise<GitCommitMetadata[]>;
	listTreeEntries?(root: URI, ref: string, options?: { maxEntries?: number; scope?: string }, token?: CancellationToken): Promise<GitTreeInventory>;
	readBlobContent?(root: URI, ref: string, path: string, maxBytes?: number, token?: CancellationToken): Promise<string>;
	diffExactTrees?(root: URI, refA: string, refB: string, token?: CancellationToken): Promise<GitExactDiffResult>;
	diffCommitToParent?(root: URI, commitRef: string, parentIndex?: number, token?: CancellationToken): Promise<GitExactDiffResult>;
	diffReviewRange?(root: URI, baseRef: string, headRef: string, token?: CancellationToken): Promise<GitExactDiffResult>;
	checkIgnore?(root: URI, paths: string[]): Promise<string[]>;
}

export const IGitService = createDecorator<IGitService>('gitService');

export interface IGitService {
	readonly _serviceBrand: undefined;

	readonly repositories: Iterable<IGitRepository>;
	readonly onDidOpenRepository: Event<IGitRepository>;
	readonly onDidCloseRepository: Event<IGitRepository>;

	setDelegate(delegate: IGitExtensionDelegate): IDisposable;

	openRepository(uri: URI): Promise<IGitRepository | undefined>;
}

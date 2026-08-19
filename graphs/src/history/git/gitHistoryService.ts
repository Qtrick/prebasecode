/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type {
	GitBranchInfo,
	GitCommitMetadata,
	GitExactDiffResult,
	GitHeadChangeEvent,
	GitLogOptions,
	GitRepositoryIdentity,
	GitTagInfo,
	GitTreeEntry,
} from './gitTypes.js';

export const GIT_EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export type EventLike<T> = (listener: (e: T) => void) => { dispose(): void };

export interface IGitHistoryService {
	readonly onDidChangeHead?: EventLike<GitHeadChangeEvent>;
	isGitRepository(rootPath: string, token?: CancellationTokenLike): Promise<boolean>;
	getRepositoryIdentity(rootPath: string, token?: CancellationTokenLike): Promise<GitRepositoryIdentity>;
	getHead(rootPath: string, token?: CancellationTokenLike): Promise<string>;
	getCommit(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<GitCommitMetadata>;
	log(rootPath: string, options?: GitLogOptions, token?: CancellationTokenLike): Promise<GitCommitMetadata[]>;
	resolveRef(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<string>;
	listBranches(rootPath: string, token?: CancellationTokenLike): Promise<GitBranchInfo[]>;
	listTags(rootPath: string, token?: CancellationTokenLike): Promise<GitTagInfo[]>;
	listTree(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<GitTreeEntry[]>;
	readFileAtRef(rootPath: string, ref: string, relativePath: string, token?: CancellationTokenLike): Promise<string>;
	readBlob(rootPath: string, objectId: string, token?: CancellationTokenLike): Promise<string>;
	diffCommitTrees(rootPath: string, refA: string, refB: string, token?: CancellationTokenLike): Promise<GitExactDiffResult>;
	diffCommitToParent(rootPath: string, commitRef: string, parentIndex?: number, token?: CancellationTokenLike): Promise<GitExactDiffResult>;
	diffReviewRange(rootPath: string, baseRef: string, headRef: string, token?: CancellationTokenLike): Promise<GitExactDiffResult>;
}

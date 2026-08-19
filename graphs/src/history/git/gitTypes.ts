/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export interface GitSignature {
	readonly name: string;
	readonly email: string;
	readonly date: string;
}

export interface GitCommitMetadata {
	readonly sha: string;
	readonly parents: readonly string[];
	readonly author: GitSignature;
	readonly committer: GitSignature;
	readonly message: string;
	readonly timestamp: number;
}

export interface GitRepositoryIdentity {
	readonly rootPath: string;
	readonly gitDir: string;
	readonly commonGitDir?: string;
	readonly remoteUrl?: string;
}

export type GitObjectType = 'blob' | 'tree' | 'commit' | 'tag';

export interface GitTreeEntry {
	readonly path: string;
	readonly blobOid: string;
	readonly mode: string;
	readonly objectType: GitObjectType;
	readonly size?: number;
}

export type GitChangeKind = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';

export interface GitExactDiffChange {
	readonly kind: GitChangeKind;
	readonly path: string;
	readonly oldPath?: string;
	readonly similarity?: number;
	readonly oldBlobOid?: string;
	readonly newBlobOid?: string;
}

export interface GitExactDiffResult {
	readonly fromRef: string;
	readonly toRef: string;
	readonly changes: readonly GitExactDiffChange[];
}

export interface GitHeadChangeEvent {
	readonly repositoryId: string;
	readonly previousHead?: string;
	readonly currentHead: string;
	readonly timestamp: number;
}

export interface GitLogOptions {
	readonly ref?: string;
	readonly limit?: number;
	readonly skip?: number;
	readonly firstParent?: boolean;
	readonly path?: string;
}

export interface GitRefInfo {
	readonly name: string;
	readonly commit: string;
	readonly type: 'branch' | 'tag' | 'head';
}

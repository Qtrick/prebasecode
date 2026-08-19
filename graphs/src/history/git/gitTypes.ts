/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type GitHistoryErrorCode =
	| 'UnknownRef'
	| 'Cancelled'
	| 'Timeout'
	| 'BufferLimit'
	| 'RepositoryUnavailable'
	| 'ObjectUnavailable'
	| 'ProcessFailure'
	| 'ParseFailure';

export class GitHistoryError extends Error {
	readonly code: GitHistoryErrorCode;
	readonly details?: string;

	constructor(
		code: GitHistoryErrorCode,
		message: string,
		details?: string
	) {
		super(`[GitHistoryError:${code}] ${message}${details ? ` (${details})` : ''}`);
		Object.setPrototypeOf(this, GitHistoryError.prototype);
		this.name = 'GitHistoryError';
		this.code = code;
		this.details = details;
	}
}

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
	readonly authorTimestamp: number;
	readonly committerTimestamp: number;
	readonly message: string;
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
	readonly objectId: string;
	readonly blobOid?: string;
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

export type GitHeadTransitionType = 'commit' | 'checkout' | 'reset' | 'branch-switch' | 'external';

export interface GitHeadChangeEvent {
	readonly repositoryId: string;
	readonly previousHead?: string;
	readonly currentHead: string;
	readonly timestamp: number;
	readonly transitionType?: GitHeadTransitionType;
}

export interface GitLogOptions {
	readonly ref?: string;
	readonly limit?: number;
	readonly skip?: number;
	readonly firstParent?: boolean;
	readonly path?: string;
}

export interface GitBranchInfo {
	readonly name: string;
	readonly commit: string;
	readonly isRemote: boolean;
}

export interface GitTagInfo {
	readonly name: string;
	readonly tagCommit: string;
	readonly peeledCommit?: string;
	readonly isAnnotated: boolean;
}

export type GitRefInfo = GitBranchInfo | GitTagInfo;

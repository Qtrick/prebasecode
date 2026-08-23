/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type GitHistoryErrorCode =
	| 'UnknownRef'
	| 'Cancelled'
	| 'Timeout'
	| 'BufferLimit'
	| 'RepositoryUnavailable'
	| 'RepositoryNotFound'
	| 'ObjectUnavailable'
	| 'OversizedBlob'
	| 'NotSupported'
	| 'ProcessFailure'
	| 'ParseFailure'
	| 'HistoryIncomplete';

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
	readonly treeSha?: string;
	readonly author: GitSignature;
	readonly committer: GitSignature;
	readonly authorTimestamp: number;
	readonly committerTimestamp: number;
	readonly message: string;
}

export interface GitRepositoryIdentity {
	readonly repositoryId: string;
	readonly rootPath: string;
	readonly rootUri?: string;
	readonly gitDir?: string;
	readonly commonGitDir?: string;
	readonly remoteUrl?: string;
	readonly headBranch?: string;
	readonly isUnborn?: boolean;
	readonly objectFormat?: 'sha1' | 'sha256';
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

export interface GitTreeListOptions {
	readonly maxEntries?: number;
	readonly scope?: string;
}

export interface GitTreeInventory {
	readonly entries: readonly GitTreeEntry[];
	readonly isTruncated: boolean;
	readonly returnedCount: number;
	readonly discoveredAtLeast: number;
	readonly scope?: string;
	readonly truncationReason?: string;
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
	readonly author?: string;
	readonly grep?: string;
}

export interface GitHistorySearchOptions {
	readonly ref?: string;
	readonly query?: string;
	readonly message?: string;
	readonly author?: string;
	readonly sha?: string;
	readonly file?: string;
	readonly after?: string;
	readonly before?: string;
	readonly change?: string;
	readonly limit?: number;
	readonly skip?: number;
	readonly firstParent?: boolean;
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

export interface GitRemoteRefUpdate {
	readonly refName: string;
	readonly previousSha?: string;
	readonly currentSha: string;
	readonly isNew: boolean;
	readonly isDeleted: boolean;
}

export interface GitRemoteSyncResult {
	readonly ok: boolean;
	readonly remoteName: string;
	readonly updatedRefs: readonly GitRemoteRefUpdate[];
	readonly newCommitsDiscovered: number;
	readonly error?: string;
}

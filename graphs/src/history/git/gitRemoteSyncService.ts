/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { IGitHistoryService } from './gitHistoryService.js';
import type { GitRemoteRefUpdate, GitRemoteSyncResult } from './gitTypes.js';

export interface IGitRemoteSyncOptions {
	readonly remoteName?: string;
	readonly prune?: boolean;
}

export class GitRemoteSyncService {
	private readonly _gitHistoryService: IGitHistoryService;

	constructor(gitHistoryService: IGitHistoryService) {
		this._gitHistoryService = gitHistoryService;
	}

	async syncRemote(
		rootPath: string,
		options?: IGitRemoteSyncOptions,
		token?: CancellationTokenLike
	): Promise<GitRemoteSyncResult> {
		const remoteName = options?.remoteName || 'origin';

		try {
			// 1. Snapshot existing remote branch tips
			const preBranches = await this._gitHistoryService.listBranches(rootPath, token);
			const preRemoteMap = new Map<string, string>();
			for (const b of preBranches) {
				if (b.isRemote && (b.name.startsWith(`${remoteName}/`) || b.name.startsWith(`remotes/${remoteName}/`))) {
					preRemoteMap.set(b.name, b.commit);
				}
			}

			// 2. Perform remote fetch if history service implements it
			if (this._gitHistoryService.fetchRemoteRefs) {
				const directResult = await this._gitHistoryService.fetchRemoteRefs(rootPath, remoteName, token);
				if (directResult) {
					return directResult;
				}
			} else if (typeof (this._gitHistoryService as any).fetch === 'function') {
				await (this._gitHistoryService as any).fetch(rootPath, remoteName, token);
			}

			// 3. Query updated branch state
			const postBranches = await this._gitHistoryService.listBranches(rootPath, token);
			const postRemoteMap = new Map<string, string>();
			for (const b of postBranches) {
				if (b.isRemote && (b.name.startsWith(`${remoteName}/`) || b.name.startsWith(`remotes/${remoteName}/`))) {
					postRemoteMap.set(b.name, b.commit);
				}
			}

			// 4. Compute remote ref updates
			const updatedRefs: GitRemoteRefUpdate[] = [];
			let newCommitsDiscovered = 0;

			for (const [refName, newSha] of postRemoteMap) {
				const prevSha = preRemoteMap.get(refName);
				if (!prevSha) {
					updatedRefs.push({
						refName,
						currentSha: newSha,
						isNew: true,
						isDeleted: false,
					});
					newCommitsDiscovered++;
				} else if (prevSha !== newSha) {
					updatedRefs.push({
						refName,
						previousSha: prevSha,
						currentSha: newSha,
						isNew: false,
						isDeleted: false,
					});
					newCommitsDiscovered++;
				}
			}

			for (const [refName, oldSha] of preRemoteMap) {
				if (!postRemoteMap.has(refName)) {
					updatedRefs.push({
						refName,
						previousSha: oldSha,
						currentSha: '',
						isNew: false,
						isDeleted: true,
					});
				}
			}

			return {
				ok: true,
				remoteName,
				updatedRefs,
				newCommitsDiscovered,
			};
		} catch (err: any) {
			return {
				ok: false,
				remoteName,
				updatedRefs: [],
				newCommitsDiscovered: 0,
				error: err?.message || String(err),
			};
		}
	}
}

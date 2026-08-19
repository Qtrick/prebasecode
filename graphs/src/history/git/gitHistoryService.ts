/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import { GitCommandRunner } from './gitCommandRunner.js';
import type {
	GitChangeKind,
	GitCommitMetadata,
	GitExactDiffChange,
	GitExactDiffResult,
	GitLogOptions,
	GitObjectType,
	GitRefInfo,
	GitRepositoryIdentity,
	GitTreeEntry,
} from './gitTypes.js';
import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';

export const GIT_EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export interface IGitHistoryService {
	isGitRepository(rootPath: string, token?: CancellationTokenLike): Promise<boolean>;
	getRepositoryIdentity(rootPath: string, token?: CancellationTokenLike): Promise<GitRepositoryIdentity | undefined>;
	getHead(rootPath: string, token?: CancellationTokenLike): Promise<string | undefined>;
	getCommit(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<GitCommitMetadata | undefined>;
	log(rootPath: string, options?: GitLogOptions, token?: CancellationTokenLike): Promise<GitCommitMetadata[]>;
	resolveRef(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<string | undefined>;
	listBranches(rootPath: string, token?: CancellationTokenLike): Promise<GitRefInfo[]>;
	listTags(rootPath: string, token?: CancellationTokenLike): Promise<GitRefInfo[]>;
	listTree(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<GitTreeEntry[]>;
	readFileAtRef(rootPath: string, ref: string, relativePath: string, token?: CancellationTokenLike): Promise<string | undefined>;
	readBlob(rootPath: string, blobOid: string, token?: CancellationTokenLike): Promise<string | undefined>;
	diffCommitTrees(rootPath: string, refA: string, refB: string, token?: CancellationTokenLike): Promise<GitExactDiffResult>;
	diffCommitToParent(rootPath: string, commitRef: string, parentIndex?: number, token?: CancellationTokenLike): Promise<GitExactDiffResult>;
	diffReviewRange(rootPath: string, baseRef: string, headRef: string, token?: CancellationTokenLike): Promise<GitExactDiffResult>;
}

export class GitHistoryService implements IGitHistoryService {
	private readonly _runner: GitCommandRunner;

	constructor(runner = new GitCommandRunner()) {
		this._runner = runner;
	}

	async isGitRepository(rootPath: string, token?: CancellationTokenLike): Promise<boolean> {
		try {
			const res = await this._runner.exec({
				cwd: rootPath,
				args: ['rev-parse', '--is-inside-work-tree'],
				token,
			});
			return res.exitCode === 0 && res.stdout.trim() === 'true';
		} catch {
			return false;
		}
	}

	async getRepositoryIdentity(rootPath: string, token?: CancellationTokenLike): Promise<GitRepositoryIdentity | undefined> {
		try {
			const res = await this._runner.exec({
				cwd: rootPath,
				args: ['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir'],
				token,
			});
			if (res.exitCode !== 0) {
				return undefined;
			}
			const lines = res.stdout.trim().split('\n').map(l => l.trim());
			const topLevel = lines[0] || rootPath;
			const gitDir = path.isAbsolute(lines[1]) ? lines[1] : path.resolve(rootPath, lines[1]);
			const commonGitDir = lines[2] ? (path.isAbsolute(lines[2]) ? lines[2] : path.resolve(rootPath, lines[2])) : gitDir;

			let remoteUrl: string | undefined;
			try {
				const remoteRes = await this._runner.exec({
					cwd: rootPath,
					args: ['config', '--get', 'remote.origin.url'],
					token,
				});
				if (remoteRes.exitCode === 0 && remoteRes.stdout.trim()) {
					remoteUrl = remoteRes.stdout.trim();
				}
			} catch {
				// No remote
			}

			return {
				rootPath: topLevel,
				gitDir,
				commonGitDir,
				remoteUrl,
			};
		} catch {
			return undefined;
		}
	}

	async getHead(rootPath: string, token?: CancellationTokenLike): Promise<string | undefined> {
		try {
			const res = await this._runner.exec({
				cwd: rootPath,
				args: ['rev-parse', 'HEAD'],
				token,
			});
			if (res.exitCode === 0 && res.stdout.trim()) {
				return res.stdout.trim();
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	async getCommit(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<GitCommitMetadata | undefined> {
		try {
			const format = '%H%x00%P%x00%an%x00%ae%x00%ad%x00%cn%x00%ce%x00%cd%x00%B';
			const res = await this._runner.exec({
				cwd: rootPath,
				args: ['show', '-s', `--format=${format}`, ref],
				token,
			});
			if (res.exitCode !== 0 || !res.stdout.trim()) {
				return undefined;
			}
			return this._parseCommitRecord(res.stdout);
		} catch {
			return undefined;
		}
	}

	async log(rootPath: string, options: GitLogOptions = {}, token?: CancellationTokenLike): Promise<GitCommitMetadata[]> {
		try {
			const format = '%H%x00%P%x00%an%x00%ae%x00%ad%x00%cn%x00%ce%x00%cd%x00%B%x1e';
			const args = ['log', `--format=${format}`];

			if (options.firstParent) {
				args.push('--first-parent');
			}
			if (typeof options.limit === 'number' && options.limit > 0) {
				args.push(`--max-count=${options.limit}`);
			}
			if (typeof options.skip === 'number' && options.skip > 0) {
				args.push(`--skip=${options.skip}`);
			}
			if (options.ref) {
				args.push(options.ref);
			} else {
				args.push('HEAD');
			}
			if (options.path) {
				args.push('--', options.path);
			}

			const res = await this._runner.exec({
				cwd: rootPath,
				args,
				token,
			});

			if (res.exitCode !== 0) {
				return [];
			}

			const commits: GitCommitMetadata[] = [];
			const records = res.stdout.split('\x1e').filter(r => r.trim());

			for (const record of records) {
				const parsed = this._parseCommitRecord(record);
				if (parsed) {
					commits.push(parsed);
				}
			}

			return commits;
		} catch {
			return [];
		}
	}

	async resolveRef(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<string | undefined> {
		try {
			const res = await this._runner.exec({
				cwd: rootPath,
				args: ['rev-parse', '--verify', `${ref}^{commit}`],
				token,
			});
			if (res.exitCode === 0 && res.stdout.trim()) {
				return res.stdout.trim();
			}
			// Fallback without ^{commit} (e.g. tree or raw SHA)
			const fallback = await this._runner.exec({
				cwd: rootPath,
				args: ['rev-parse', '--verify', ref],
				token,
			});
			if (fallback.exitCode === 0 && fallback.stdout.trim()) {
				return fallback.stdout.trim();
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	async listBranches(rootPath: string, token?: CancellationTokenLike): Promise<GitRefInfo[]> {
		try {
			const format = '%(refname:short)%x00%(objectname)%x00head';
			const res = await this._runner.exec({
				cwd: rootPath,
				args: ['for-each-ref', `--format=${format}`, 'refs/heads/'],
				token,
			});
			if (res.exitCode !== 0) return [];
			const lines = res.stdout.trim().split('\n').filter(Boolean);
			return lines.map(line => {
				const [name, commit] = line.split('\x00');
				return { name, commit, type: 'branch' as const };
			});
		} catch {
			return [];
		}
	}

	async listTags(rootPath: string, token?: CancellationTokenLike): Promise<GitRefInfo[]> {
		try {
			const format = '%(refname:short)%x00%(*objectname)%(objectname)%x00tag';
			const res = await this._runner.exec({
				cwd: rootPath,
				args: ['for-each-ref', `--format=${format}`, 'refs/tags/'],
				token,
			});
			if (res.exitCode !== 0) return [];
			const lines = res.stdout.trim().split('\n').filter(Boolean);
			return lines.map(line => {
				const [name, commit] = line.split('\x00');
				return { name, commit, type: 'tag' as const };
			});
		} catch {
			return [];
		}
	}

	async listTree(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<GitTreeEntry[]> {
		try {
			const res = await this._runner.exec({
				cwd: rootPath,
				args: ['ls-tree', '-r', '-z', '--full-name', ref],
				token,
			});
			if (res.exitCode !== 0) {
				return [];
			}

			const entries: GitTreeEntry[] = [];
			const parts = res.stdout.split('\0').filter(Boolean);

			for (const part of parts) {
				// Format: "<mode> <type> <object>\t<file>"
				const tabIndex = part.indexOf('\t');
				if (tabIndex < 0) continue;
				const meta = part.slice(0, tabIndex).trim();
				const filePath = part.slice(tabIndex + 1);

				const metaParts = meta.split(/\s+/);
				if (metaParts.length < 3) continue;

				const mode = metaParts[0];
				const objectType = metaParts[1] as GitObjectType;
				const blobOid = metaParts[2];

				entries.push({
					path: filePath,
					blobOid,
					mode,
					objectType,
				});
			}

			return entries;
		} catch {
			return [];
		}
	}

	async readFileAtRef(rootPath: string, ref: string, relativePath: string, token?: CancellationTokenLike): Promise<string | undefined> {
		try {
			const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
			const res = await this._runner.exec({
				cwd: rootPath,
				args: ['show', `${ref}:${normalized}`],
				token,
			});
			if (res.exitCode === 0) {
				return res.stdout;
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	async readBlob(rootPath: string, blobOid: string, token?: CancellationTokenLike): Promise<string | undefined> {
		try {
			const res = await this._runner.exec({
				cwd: rootPath,
				args: ['cat-file', 'blob', blobOid],
				token,
			});
			if (res.exitCode === 0) {
				return res.stdout;
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	async diffCommitTrees(rootPath: string, refA: string, refB: string, token?: CancellationTokenLike): Promise<GitExactDiffResult> {
		try {
			const res = await this._runner.exec({
				cwd: rootPath,
				args: ['diff-tree', '-r', '-z', '-M', '--no-commit-id', refA, refB],
				token,
			});
			if (res.exitCode !== 0) {
				return { fromRef: refA, toRef: refB, changes: [] };
			}
			const changes = this._parseRawDiffTreeOutput(res.stdout);
			return { fromRef: refA, toRef: refB, changes };
		} catch {
			return { fromRef: refA, toRef: refB, changes: [] };
		}
	}

	async diffCommitToParent(rootPath: string, commitRef: string, parentIndex = 0, token?: CancellationTokenLike): Promise<GitExactDiffResult> {
		const commit = await this.getCommit(rootPath, commitRef, token);
		if (!commit) {
			return { fromRef: '', toRef: commitRef, changes: [] };
		}

		if (commit.parents.length === 0) {
			// Root commit: diff-tree with --root
			try {
				const res = await this._runner.exec({
					cwd: rootPath,
					args: ['diff-tree', '--root', '-r', '-z', '-M', '--no-commit-id', commit.sha],
					token,
				});
				if (res.exitCode !== 0) {
					return { fromRef: GIT_EMPTY_TREE_HASH, toRef: commit.sha, changes: [] };
				}
				const changes = this._parseRawDiffTreeOutput(res.stdout);
				return { fromRef: GIT_EMPTY_TREE_HASH, toRef: commit.sha, changes };
			} catch {
				return { fromRef: GIT_EMPTY_TREE_HASH, toRef: commit.sha, changes: [] };
			}
		}

		const parentRef = commit.parents[parentIndex] ?? commit.parents[0];
		return this.diffCommitTrees(rootPath, parentRef, commit.sha, token);
	}

	async diffReviewRange(rootPath: string, baseRef: string, headRef: string, token?: CancellationTokenLike): Promise<GitExactDiffResult> {
		try {
			const mbRes = await this._runner.exec({
				cwd: rootPath,
				args: ['merge-base', baseRef, headRef],
				token,
			});
			if (mbRes.exitCode !== 0 || !mbRes.stdout.trim()) {
				// Fallback to direct diff if no common ancestor
				return this.diffCommitTrees(rootPath, baseRef, headRef, token);
			}
			const mergeBase = mbRes.stdout.trim();
			return this.diffCommitTrees(rootPath, mergeBase, headRef, token);
		} catch {
			return { fromRef: baseRef, toRef: headRef, changes: [] };
		}
	}

	private _parseCommitRecord(raw: string): GitCommitMetadata | undefined {
		const fields = raw.split('\x00');
		if (fields.length < 8) {
			return undefined;
		}

		const sha = fields[0].trim();
		const parentsRaw = fields[1].trim();
		const parents = parentsRaw ? parentsRaw.split(/\s+/).filter(Boolean) : [];

		const authorName = fields[2];
		const authorEmail = fields[3];
		const authorDate = fields[4];

		const committerName = fields[5];
		const committerEmail = fields[6];
		const committerDate = fields[7];

		const message = fields.slice(8).join('\x00').trim();

		let timestamp = Date.now();
		if (authorDate) {
			const parsed = Date.parse(authorDate);
			if (!isNaN(parsed)) {
				timestamp = parsed;
			}
		}

		return {
			sha,
			parents,
			author: { name: authorName, email: authorEmail, date: authorDate },
			committer: { name: committerName, email: committerEmail, date: committerDate },
			message,
			timestamp,
		};
	}

	private _parseRawDiffTreeOutput(raw: string): GitExactDiffChange[] {
		const changes: GitExactDiffChange[] = [];
		const tokens = raw.split('\0').filter(t => t.length > 0);

		let i = 0;
		while (i < tokens.length) {
			const header = tokens[i++];
			if (!header || !header.startsWith(':')) {
				continue;
			}

			// Header format: :old_mode new_mode old_sha new_sha status[score]
			const parts = header.slice(1).split(/\s+/);
			if (parts.length < 5) {
				continue;
			}

			const oldBlobOid = parts[2];
			const newBlobOid = parts[3];
			const statusToken = parts[4];
			const statusCode = statusToken[0];
			const similarity = statusToken.length > 1 ? parseInt(statusToken.slice(1), 10) : undefined;

			if (statusCode === 'R' || statusCode === 'C') {
				// Renamed or copied has two paths: old_path, new_path
				const oldPath = tokens[i++];
				const newPath = tokens[i++];
				if (!oldPath || !newPath) continue;

				changes.push({
					kind: statusCode === 'R' ? 'renamed' : 'copied',
					path: newPath,
					oldPath,
					similarity,
					oldBlobOid,
					newBlobOid,
				});
			} else {
				const filePath = tokens[i++];
				if (!filePath) continue;

				let kind: GitChangeKind = 'modified';
				if (statusCode === 'A') kind = 'added';
				else if (statusCode === 'D') kind = 'deleted';
				else if (statusCode === 'M') kind = 'modified';

				changes.push({
					kind,
					path: filePath,
					oldBlobOid: statusCode !== 'A' ? oldBlobOid : undefined,
					newBlobOid: statusCode !== 'D' ? newBlobOid : undefined,
				});
			}
		}

		return changes;
	}
}

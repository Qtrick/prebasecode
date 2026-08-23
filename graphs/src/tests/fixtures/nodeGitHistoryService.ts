/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import {
	type IGitHistoryService,
} from '../../history/git/gitHistoryService.js';
import {
	type GitBranchInfo,
	type GitChangeKind,
	type GitCommitMetadata,
	type GitExactDiffChange,
	type GitExactDiffResult,
	type GitHeadChangeEvent,
	type GitLogOptions,
	type GitObjectType,
	type GitRemoteRefUpdate,
	type GitRemoteSyncResult,
	type GitRepositoryIdentity,
	type GitTagInfo,
	type GitTreeEntry,
	type GitTreeInventory,
	type GitTreeListOptions,
	GitHistoryError,
} from '../../history/git/gitTypes.js';

const SHA1_EMPTY_TREE_HASH_FIXTURE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

interface ExecGitOptions {
	cwd: string;
	args: string[];
	input?: string | Buffer;
	timeoutMs?: number;
	maxBufferBytes?: number;
	token?: CancellationTokenLike;
}

interface ExecGitResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export class NodeGitHistoryService implements IGitHistoryService {
	private readonly _listeners = new Set<(e: GitHeadChangeEvent) => void>();

	get onDidChangeHead() {
		return (listener: (e: GitHeadChangeEvent) => void) => {
			this._listeners.add(listener);
			return {
				dispose: () => this._listeners.delete(listener)
			};
		};
	}

	fireHeadChange(event: GitHeadChangeEvent): void {
		for (const listener of this._listeners) {
			listener(event);
		}
	}

	private async _exec(options: ExecGitOptions): Promise<ExecGitResult> {
		if (options.token?.isCancellationRequested) {
			throw new GitHistoryError('Cancelled', 'Git operation cancelled.');
		}

		return new Promise<ExecGitResult>((resolve, reject) => {
			const hasInput = options.input !== undefined;
			const child = spawn('git', options.args, {
				cwd: options.cwd,
				stdio: [hasInput ? 'pipe' : 'ignore', 'pipe', 'pipe'],
				env: {
					...process.env,
					GIT_OPTIONAL_LOCKS: '0',
					LC_ALL: 'C',
				},
			});

			if (hasInput && child.stdin) {
				child.stdin.end(options.input, 'utf8');
			}

			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];
			let totalStdoutBytes = 0;
			let totalStderrBytes = 0;
			let isResolved = false;

			const timeoutMs = options.timeoutMs ?? 30_000;
			const maxBuffer = options.maxBufferBytes ?? 50 * 1024 * 1024;

			let cancellationCheckInterval: ReturnType<typeof setInterval> | undefined;

			const cleanup = () => {
				if (cancellationCheckInterval) {
					clearInterval(cancellationCheckInterval);
					cancellationCheckInterval = undefined;
				}
				clearTimeout(timer);
			};

			const timer = setTimeout(() => {
				if (!isResolved) {
					isResolved = true;
					cleanup();
					child.kill('SIGKILL');
					reject(new GitHistoryError('Timeout', `Git command timed out after ${timeoutMs}ms: git ${options.args.join(' ')}`));
				}
			}, timeoutMs);

			if (options.token) {
				cancellationCheckInterval = setInterval(() => {
					if (options.token?.isCancellationRequested && !isResolved) {
						isResolved = true;
						cleanup();
						child.kill('SIGKILL');
						reject(new GitHistoryError('Cancelled', 'Git operation cancelled.'));
					}
				}, 50);
			}

			child.stdout?.on('data', (chunk: Buffer) => {
				totalStdoutBytes += chunk.length;
				if (totalStdoutBytes > maxBuffer) {
					if (!isResolved) {
						isResolved = true;
						cleanup();
						child.kill('SIGKILL');
						reject(new GitHistoryError('BufferLimit', `Git stdout exceeded maximum buffer of ${maxBuffer} bytes`));
					}
					return;
				}
				stdoutChunks.push(chunk);
			});

			child.stderr?.on('data', (chunk: Buffer) => {
				totalStderrBytes += chunk.length;
				if (totalStderrBytes > 5 * 1024 * 1024) {
					return; // Bound stderr accumulation
				}
				stderrChunks.push(chunk);
			});

			child.on('error', (err: Error) => {
				if (!isResolved) {
					isResolved = true;
					cleanup();
					reject(new GitHistoryError('ProcessFailure', err.message));
				}
			});

			child.on('close', (code: number | null) => {
				if (!isResolved) {
					isResolved = true;
					cleanup();

					const stdout = Buffer.concat(stdoutChunks).toString('utf8');
					const stderr = Buffer.concat(stderrChunks).toString('utf8');
					resolve({
						stdout,
						stderr,
						exitCode: code ?? 1,
					});
				}
			});
		});
	}

	async isGitRepository(rootPath: string, token?: CancellationTokenLike): Promise<boolean> {
		try {
			const res = await this._exec({
				cwd: rootPath,
				args: ['rev-parse', '--is-inside-work-tree'],
				token,
			});
			return res.exitCode === 0 && res.stdout.trim() === 'true';
		} catch {
			return false;
		}
	}

	async getRepositoryIdentity(rootPath: string, token?: CancellationTokenLike): Promise<GitRepositoryIdentity> {
		const res = await this._exec({
			cwd: rootPath,
			args: ['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir'],
			token,
		});
		if (res.exitCode !== 0) {
			throw new GitHistoryError('RepositoryUnavailable', `Not a git repository: ${rootPath}`, res.stderr);
		}
		const lines = res.stdout.trim().split('\n').map(l => l.trim());
		const topLevel = lines[0] || rootPath;
		const gitDir = path.isAbsolute(lines[1]) ? lines[1] : path.resolve(rootPath, lines[1]);
		const commonGitDir = lines[2] ? (path.isAbsolute(lines[2]) ? lines[2] : path.resolve(rootPath, lines[2])) : gitDir;

		let remoteUrl: string | undefined;
		try {
			const remoteRes = await this._exec({
				cwd: rootPath,
				args: ['config', '--get', 'remote.origin.url'],
				token,
			});
			if (remoteRes.exitCode === 0 && remoteRes.stdout.trim()) {
				remoteUrl = remoteRes.stdout.trim();
			}
		} catch {
			// No remote configured
		}

		let objectFormat: 'sha1' | 'sha256' = 'sha1';
		try {
			const formatRes = await this._exec({
				cwd: rootPath,
				args: ['rev-parse', '--show-object-format'],
				token,
			});
			if (formatRes.exitCode === 0 && formatRes.stdout.trim() === 'sha256') {
				objectFormat = 'sha256';
			}
		} catch {
			objectFormat = 'sha1';
		}

		return {
			repositoryId: topLevel,
			rootPath: topLevel,
			gitDir,
			commonGitDir,
			remoteUrl,
			objectFormat,
		};
	}

	async getHead(rootPath: string, token?: CancellationTokenLike): Promise<string> {
		const res = await this._exec({
			cwd: rootPath,
			args: ['rev-parse', '--verify', 'HEAD'],
			token,
		});
		if (res.exitCode !== 0 || !res.stdout.trim()) {
			throw new GitHistoryError('UnknownRef', 'HEAD ref cannot be resolved', res.stderr);
		}
		return res.stdout.trim();
	}

	async resolveRef(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<string> {
		const trimmed = ref.trim();
		if (!trimmed) {
			throw new GitHistoryError('UnknownRef', 'Empty ref provided');
		}
		const res = await this._exec({
			cwd: rootPath,
			args: ['rev-parse', '--verify', '--end-of-options', `${trimmed}^{commit}`],
			token,
		});
		if (res.exitCode !== 0 || !res.stdout.trim()) {
			throw new GitHistoryError('UnknownRef', `Ref does not resolve to a commit: ${ref}`, res.stderr);
		}
		return res.stdout.trim();
	}

	async getCommit(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<GitCommitMetadata> {
		const resolvedSha = await this.resolveRef(rootPath, ref, token);
		const format = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%at%x00%cn%x00%ce%x00%cI%x00%ct%x00%B';
		const res = await this._exec({
			cwd: rootPath,
			args: ['show', '-s', `--format=${format}`, '--end-of-options', resolvedSha],
			token,
		});
		if (res.exitCode !== 0 || !res.stdout.trim()) {
			throw new GitHistoryError('ObjectUnavailable', `Failed to read commit object: ${ref}`, res.stderr);
		}
		const commit = this._parseCommitRecord(res.stdout);
		if (!commit) {
			throw new GitHistoryError('ParseFailure', `Failed to parse commit record: ${ref}`);
		}
		return commit;
	}

	async log(rootPath: string, options: GitLogOptions = {}, token?: CancellationTokenLike): Promise<GitCommitMetadata[]> {
		const format = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%at%x00%cn%x00%ce%x00%cI%x00%ct%x00%B%x1e';
		const args = ['log', `--format=${format}`];

		if (options.firstParent) {
			args.push('--first-parent');
		}

		// Default limit: 50 commits (bounded)
		const limit = typeof options.limit === 'number' && options.limit > 0 ? Math.min(options.limit, 500) : 50;
		args.push(`--max-count=${limit}`);

		if (typeof options.skip === 'number' && options.skip > 0) {
			args.push(`--skip=${options.skip}`);
		}

		args.push('--end-of-options');

		if (options.ref) {
			args.push(options.ref);
		} else {
			args.push('HEAD');
		}

		if (options.path) {
			args.push('--', options.path);
		}

		const res = await this._exec({
			cwd: rootPath,
			args,
			token,
		});

		if (res.exitCode !== 0) {
			throw new GitHistoryError('ProcessFailure', `Failed to fetch git log for ref: ${options.ref ?? 'HEAD'}`, res.stderr);
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
	}

	async listBranches(rootPath: string, token?: CancellationTokenLike): Promise<GitBranchInfo[]> {
		// Git for-each-ref uses %00 for NUL interpolation
		const format = '%(refname:short)%00%(objectname)%00%(refname)';
		const res = await this._exec({
			cwd: rootPath,
			args: ['for-each-ref', `--format=${format}`, 'refs/heads/', 'refs/remotes/'],
			token,
		});
		if (res.exitCode !== 0) {
			throw new GitHistoryError('ProcessFailure', 'Failed to list branches', res.stderr);
		}
		const lines = res.stdout.trim().split('\n').filter(Boolean);
		return lines.map(line => {
			const parts = line.split('\0');
			const name = parts[0] || '';
			const commit = parts[1] || '';
			const fullName = parts[2] || '';
			return {
				name,
				commit,
				isRemote: fullName.startsWith('refs/remotes/'),
			};
		});
	}

	async listTags(rootPath: string, token?: CancellationTokenLike): Promise<GitTagInfo[]> {
		// %(*objectname) gets peeled commit for annotated tags; %(objectname) is the direct tag object
		const format = '%(refname:short)%00%(objectname)%00%(*objectname)';
		const res = await this._exec({
			cwd: rootPath,
			args: ['for-each-ref', `--format=${format}`, 'refs/tags/'],
			token,
		});
		if (res.exitCode !== 0) {
			throw new GitHistoryError('ProcessFailure', 'Failed to list tags', res.stderr);
		}
		const lines = res.stdout.trim().split('\n').filter(Boolean);
		return lines.map(line => {
			const parts = line.split('\0');
			const name = parts[0] || '';
			const directObject = parts[1] || '';
			const peeledCommit = parts[2] || undefined;
			const isAnnotated = Boolean(peeledCommit && peeledCommit !== directObject);

			return {
				name,
				tagCommit: directObject,
				peeledCommit,
				isAnnotated,
			};
		});
	}

	async listTree(rootPath: string, ref: string, options?: GitTreeListOptions | CancellationTokenLike, token?: CancellationTokenLike): Promise<GitTreeInventory> {
		const resolvedSha = await this.resolveRef(rootPath, ref, token);
		const opts = (options && 'maxEntries' in options) ? options : undefined;
		const actualToken = (options && 'isCancellationRequested' in options) ? options : token;

		const args = ['ls-tree', '-r', '-z', '-l', '--full-name', '--end-of-options', resolvedSha];
		if (opts?.scope) {
			args.push('--', opts.scope);
		}

		const res = await this._exec({
			cwd: rootPath,
			args,
			token: actualToken,
		});
		if (res.exitCode !== 0) {
			throw new GitHistoryError('ObjectUnavailable', `Failed to list tree for ref: ${ref}`, res.stderr);
		}

		const entries: GitTreeEntry[] = [];
		const parts = res.stdout.split('\0').filter(Boolean);

		let isTruncated = false;
		for (const part of parts) {
			// Format with -l: "<mode> <type> <object> <size>\t<file>"
			const tabIndex = part.indexOf('\t');
			if (tabIndex < 0) continue;
			const meta = part.slice(0, tabIndex).trim();
			const filePath = part.slice(tabIndex + 1);

			const metaParts = meta.split(/\s+/);
			if (metaParts.length < 3) continue;

			const mode = metaParts[0];
			const objectType = metaParts[1] as GitObjectType;
			const objectId = metaParts[2];
			const sizeStr = metaParts[3];
			const size = sizeStr && sizeStr !== '-' ? parseInt(sizeStr, 10) : undefined;

			entries.push({
				path: filePath,
				objectId,
				blobOid: objectType === 'blob' ? objectId : undefined,
				mode,
				objectType,
				size: isNaN(size as number) ? undefined : size,
			});

			if (typeof opts?.maxEntries === 'number' && opts.maxEntries > 0 && entries.length >= opts.maxEntries) {
				isTruncated = parts.length > entries.length;
				break;
			}
		}

		return {
			entries,
			isTruncated,
			returnedCount: entries.length,
			discoveredAtLeast: isTruncated ? entries.length + 1 : entries.length,
			scope: opts?.scope,
			truncationReason: isTruncated ? 'Git tree producer entry limit reached' : undefined,
		};
	}

	async readFileAtRef(rootPath: string, ref: string, relativePath: string, token?: CancellationTokenLike): Promise<string> {
		const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
		const res = await this._exec({
			cwd: rootPath,
			args: ['show', `${ref}:${normalized}`],
			token,
		});
		if (res.exitCode !== 0) {
			throw new GitHistoryError('ObjectUnavailable', `File not found at ref ${ref}: ${relativePath}`, res.stderr);
		}
		return res.stdout;
	}

	async readBlob(rootPath: string, objectId: string, token?: CancellationTokenLike): Promise<string> {
		const res = await this._exec({
			cwd: rootPath,
			args: ['cat-file', 'blob', objectId],
			token,
		});
		if (res.exitCode !== 0) {
			throw new GitHistoryError('ObjectUnavailable', `Blob object not found: ${objectId}`, res.stderr);
		}
		return res.stdout;
	}

	async diffCommitTrees(rootPath: string, refA: string, refB: string, token?: CancellationTokenLike): Promise<GitExactDiffResult> {
		const isRootDiff = !refA || refA === 'ROOT' || refA === SHA1_EMPTY_TREE_HASH_FIXTURE;
		const resolvedB = await this.resolveRef(rootPath, refB, token);

		const args = ['diff-tree', '-r', '-z', '-M', '--no-commit-id'];
		if (isRootDiff) {
			args.push('--root', '--end-of-options', resolvedB);
		} else {
			const resolvedA = await this.resolveRef(rootPath, refA, token);
			args.push('--end-of-options', resolvedA, resolvedB);
		}

		const res = await this._exec({
			cwd: rootPath,
			args,
			token,
		});
		if (res.exitCode !== 0) {
			throw new GitHistoryError('ProcessFailure', `Failed to diff trees ${refA} ↔ ${refB}`, res.stderr);
		}
		const changes = this._parseRawDiffTreeOutput(res.stdout);
		return { fromRef: refA, toRef: refB, changes };
	}

	async diffCommitToParent(rootPath: string, commitRef: string, parentIndex = 0, token?: CancellationTokenLike): Promise<GitExactDiffResult> {
		const commit = await this.getCommit(rootPath, commitRef, token);
		if (commit.parents.length === 0) {
			// Root commit
			return this.diffCommitTrees(rootPath, 'ROOT', commit.sha, token);
		}
		const parentRef = commit.parents[parentIndex] ?? commit.parents[0];
		return this.diffCommitTrees(rootPath, parentRef, commit.sha, token);
	}

	async diffReviewRange(rootPath: string, baseRef: string, headRef: string, token?: CancellationTokenLike): Promise<GitExactDiffResult> {
		const resolvedBase = await this.resolveRef(rootPath, baseRef, token);
		const resolvedHead = await this.resolveRef(rootPath, headRef, token);

		const mbRes = await this._exec({
			cwd: rootPath,
			args: ['merge-base', '--end-of-options', resolvedBase, resolvedHead],
			token,
		});
		if (mbRes.exitCode !== 0 || !mbRes.stdout.trim()) {
			throw new GitHistoryError('ProcessFailure', `No common ancestor found between ${baseRef} and ${headRef}`, mbRes.stderr);
		}
		const mergeBase = mbRes.stdout.trim();
		return this.diffCommitTrees(rootPath, mergeBase, resolvedHead, token);
	}

	private _parseCommitRecord(raw: string): GitCommitMetadata | undefined {
		const fields = raw.split('\0');
		if (fields.length < 11) {
			return undefined;
		}

		const sha = fields[0].trim();
		const parentsRaw = fields[1].trim();
		const parents = parentsRaw ? parentsRaw.split(/\s+/).filter(Boolean) : [];

		const authorName = fields[2];
		const authorEmail = fields[3];
		const authorDateISO = fields[4];
		const authorDateEpoch = parseInt(fields[5], 10);

		const committerName = fields[6];
		const committerEmail = fields[7];
		const committerDateISO = fields[8];
		const committerDateEpoch = parseInt(fields[9], 10);

		const message = fields.slice(10).join('\0').trim();

		const authorTimestamp = isNaN(authorDateEpoch) ? Date.now() : authorDateEpoch * 1000;
		const committerTimestamp = isNaN(committerDateEpoch) ? authorTimestamp : committerDateEpoch * 1000;

		return {
			sha,
			parents,
			author: { name: authorName, email: authorEmail, date: authorDateISO },
			committer: { name: committerName, email: committerEmail, date: committerDateISO },
			authorTimestamp,
			committerTimestamp,
			message,
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

	async getEmptyTree(rootPath: string, token?: CancellationTokenLike): Promise<string> {
		try {
			const res = await this._exec({
				cwd: rootPath,
				args: ['hash-object', '-t', 'tree', '--stdin'],
				input: '',
				token,
			});
			const tree = res.stdout.trim();
			if (tree) {
				return tree;
			}
		} catch {
			// fallback for test fixtures
		}
		return SHA1_EMPTY_TREE_HASH_FIXTURE;
	}

	async fetchRemoteRefs(rootPath: string, remoteName: string = 'origin', token?: CancellationTokenLike): Promise<GitRemoteSyncResult> {
		const preBranches = await this.listBranches(rootPath, token);
		const preRemoteMap = new Map<string, string>();
		for (const b of preBranches) {
			if (b.isRemote && (b.name.startsWith(`${remoteName}/`) || b.name.startsWith(`remotes/${remoteName}/`))) {
				preRemoteMap.set(b.name, b.commit);
			}
		}

		const res = await this._exec({
			cwd: rootPath,
			args: ['fetch', remoteName, '--prune'],
			token,
		});
		if (res.exitCode !== 0) {
			return {
				ok: false,
				remoteName,
				updatedRefs: [],
				newCommitsDiscovered: 0,
				error: res.stderr || 'Git fetch failed',
			};
		}

		const postBranches = await this.listBranches(rootPath, token);
		const postRemoteMap = new Map<string, string>();
		for (const b of postBranches) {
			if (b.isRemote && (b.name.startsWith(`${remoteName}/`) || b.name.startsWith(`remotes/${remoteName}/`))) {
				postRemoteMap.set(b.name, b.commit);
			}
		}

		const updatedRefs: GitRemoteRefUpdate[] = [];
		let newCommitsDiscovered = 0;
		for (const [refName, newSha] of postRemoteMap) {
			const prevSha = preRemoteMap.get(refName);
			if (!prevSha) {
				updatedRefs.push({ refName, currentSha: newSha, isNew: true, isDeleted: false });
				newCommitsDiscovered++;
			} else if (prevSha !== newSha) {
				updatedRefs.push({ refName, previousSha: prevSha, currentSha: newSha, isNew: false, isDeleted: false });
				newCommitsDiscovered++;
			}
		}
		for (const [refName, oldSha] of preRemoteMap) {
			if (!postRemoteMap.has(refName)) {
				updatedRefs.push({ refName, previousSha: oldSha, currentSha: '', isNew: false, isDeleted: true });
			}
		}

		return {
			ok: true,
			remoteName,
			updatedRefs,
			newCommitsDiscovered,
		};
	}
}

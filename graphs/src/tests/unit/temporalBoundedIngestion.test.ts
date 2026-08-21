/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, suite, test } from 'mocha';
import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { IGitHistoryService } from '../../history/git/gitHistoryService.js';
import type { GitBranchInfo, GitCommitMetadata, GitExactDiffResult, GitLogOptions, GitRepositoryIdentity, GitTagInfo, GitTreeInventory } from '../../history/git/gitTypes.js';
import { NodeCanonicalParseService } from '../../node/canonicalParseService.js';
import { TemporalGraphService } from '../../temporal/host/temporalGraphService.js';
import { TemporalRepositoryRegistry } from '../../temporal/ingestion/temporalRepositoryRegistry.js';
import { SqliteTemporalStore } from '../../temporal/persistence/node/sqliteTemporalStore.js';
import { isTemporalError } from '../../temporal/common/temporalErrors.js';

const HISTORY_LENGTH = 50_000;
const ROOT_PATH = '/synthetic/long-history';

function commitSha(index: number): string {
	return index.toString(16).padStart(40, '0');
}

class LongHistoryGitService implements IGitHistoryService {
	readonly commits = Array.from({ length: HISTORY_LENGTH }, (_, index) => this._commit(index));
	getCommitCalls = 0;
	logCalls = 0;
	listTreeCalls = 0;
	readFileCalls = 0;
	diffCalls = 0;

	async isGitRepository(): Promise<boolean> { return true; }
	async getRepositoryIdentity(): Promise<GitRepositoryIdentity> {
		return { repositoryId: 'synthetic-history', rootPath: ROOT_PATH, commonGitDir: '/synthetic/long-history/.git', objectFormat: 'sha1', headBranch: 'main' };
	}
	async getHead(_rootPath: string): Promise<string> { return commitSha(HISTORY_LENGTH - 1); }
	async getCommit(_rootPath: string, ref: string): Promise<GitCommitMetadata> {
		this.getCommitCalls++;
		const index = Number.parseInt(ref, 16);
		if (!Number.isSafeInteger(index) || index < 0 || index >= HISTORY_LENGTH || commitSha(index) !== ref) {
			throw new Error(`Unknown synthetic commit ${ref}`);
		}
		return this._commit(index);
	}
	async log(_rootPath: string, options: GitLogOptions = {}): Promise<GitCommitMetadata[]> {
		this.logCalls++;
		const ref = options.ref ?? await this.getHead(ROOT_PATH);
		const start = Number.parseInt(ref, 16) - (options.skip ?? 0);
		const limit = options.limit ?? HISTORY_LENGTH;
		return Array.from({ length: Math.max(0, Math.min(limit, start + 1)) }, (_, offset) => this._commit(start - offset));
	}
	async resolveRef(_rootPath: string, ref: string): Promise<string> { return ref === 'HEAD' ? this.getHead(ROOT_PATH) : ref; }
	async listBranches(): Promise<GitBranchInfo[]> { return []; }
	async listTags(): Promise<GitTagInfo[]> { return []; }
	async listTree(): Promise<GitTreeInventory> {
		this.listTreeCalls++;
		return {
			entries: [{ path: 'src/main.ts', objectId: 'blob-main', blobOid: 'blob-main', mode: '100644', objectType: 'blob', size: 26 }],
			isTruncated: false,
			returnedCount: 1,
			discoveredAtLeast: 1,
		};
	}
	async readFileAtRef(): Promise<string> {
		this.readFileCalls++;
		return 'export const history = true;';
	}
	async readBlob(): Promise<string> { return 'export const history = true;'; }
	async diffCommitTrees(): Promise<GitExactDiffResult> { return { fromRef: '', toRef: '', changes: [] }; }
	async diffCommitToParent(): Promise<GitExactDiffResult> {
		this.diffCalls++;
		return { fromRef: '', toRef: '', changes: [] };
	}
	async diffReviewRange(): Promise<GitExactDiffResult> { return { fromRef: '', toRef: '', changes: [] }; }

	private _commit(index: number): GitCommitMetadata {
		const sha = commitSha(index);
		return {
			sha,
			parents: index === 0 ? [] : [commitSha(index - 1)],
			treeSha: `tree-${index}`,
			author: { name: 'Synthetic', email: 'synthetic@prebase.invalid', date: '1970-01-01T00:00:00.000Z' },
			committer: { name: 'Synthetic', email: 'synthetic@prebase.invalid', date: '1970-01-01T00:00:00.000Z' },
			authorTimestamp: index,
			committerTimestamp: index,
			message: `Synthetic commit ${index}`,
		};
	}
}

suite('Temporal bounded cold-history indexing', () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('keeps metadata browsing cheap and indexes one isolated checkpoint from a 50,000-commit cold history', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-bounded-history-'));
		tempDirs.push(tempDir);
		const git = new LongHistoryGitService();
		const registry = new TemporalRepositoryRegistry(async () => new SqliteTemporalStore({ dbPath: path.join(tempDir, 'temporal.db') }), new NodeCanonicalParseService());
		const temporal = new TemporalGraphService(git, registry);
		const targetSha = commitSha(HISTORY_LENGTH - 1);

		try {
			const page = await temporal.getHistoryPage(ROOT_PATH, { pageSize: 50 });
			assert.deepStrictEqual({
				rows: page.commits.length,
				allNotIndexed: page.commits.every(commit => commit.indexStatus.status === 'not-indexed'),
				listTreeCalls: git.listTreeCalls,
				readFileCalls: git.readFileCalls,
			}, {
				rows: 50,
				allNotIndexed: true,
				listTreeCalls: 0,
				readFileCalls: 0,
			});

			const snapshot = await temporal.ensureCommitIndexed(ROOT_PATH, targetSha);
			const store = await registry.getStore('synthetic-history', ROOT_PATH);
			assert.deepStrictEqual({
				commitSha: snapshot.commitSha,
				isCheckpoint: snapshot.isCheckpoint,
				storedCommitCount: (await store.getAllCommits()).length,
				getCommitCalls: git.getCommitCalls,
				listTreeCalls: git.listTreeCalls,
				readFileCalls: git.readFileCalls,
				diffCalls: git.diffCalls,
				indexStatus: await temporal.getCommitIndexStatus(ROOT_PATH, targetSha),
			}, {
				commitSha: targetSha,
				isCheckpoint: true,
				storedCommitCount: 1,
				getCommitCalls: 1,
				listTreeCalls: 1,
				readFileCalls: 2,
				diffCalls: 0,
				indexStatus: { status: 'ready', lineageCoverage: { kind: 'partial', unknownBeforeCommitSha: targetSha } },
			});
		} finally {
			await registry.closeAll();
		}
	});

	test('does not start Git or parser work for a pre-cancelled cold-history selection', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-bounded-cancel-'));
		tempDirs.push(tempDir);
		const git = new LongHistoryGitService();
		const registry = new TemporalRepositoryRegistry(async () => new SqliteTemporalStore({ dbPath: path.join(tempDir, 'temporal.db') }), new NodeCanonicalParseService());
		const temporal = new TemporalGraphService(git, registry);
		const cancelled: CancellationTokenLike = { isCancellationRequested: true };

		try {
			await assert.rejects(
				temporal.ensureCommitIndexed(ROOT_PATH, commitSha(HISTORY_LENGTH - 1), cancelled),
				error => isTemporalError(error) && error.code === 'Cancelled',
			);
			assert.deepStrictEqual({
				getCommitCalls: git.getCommitCalls,
				listTreeCalls: git.listTreeCalls,
				readFileCalls: git.readFileCalls,
				status: await temporal.getCommitIndexStatus(ROOT_PATH, commitSha(HISTORY_LENGTH - 1)),
			}, {
				getCommitCalls: 0,
				listTreeCalls: 0,
				readFileCalls: 0,
				status: { status: 'cancelled' },
			});
		} finally {
			await registry.closeAll();
		}
	});

	test('reconciles an isolated child anchor after its parent segment is indexed', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-bounded-reconcile-'));
		tempDirs.push(tempDir);
		const git = new LongHistoryGitService();
		const registry = new TemporalRepositoryRegistry(async () => new SqliteTemporalStore({ dbPath: path.join(tempDir, 'temporal.db') }), new NodeCanonicalParseService());
		const temporal = new TemporalGraphService(git, registry);
		const rootSha = commitSha(0);
		const childSha = commitSha(1);

		try {
			await temporal.ensureCommitIndexed(ROOT_PATH, childSha);
			assert.deepStrictEqual(await temporal.getCommitIndexStatus(ROOT_PATH, childSha), {
				status: 'ready',
				lineageCoverage: { kind: 'partial', unknownBeforeCommitSha: childSha },
			});

			await temporal.ensureCommitIndexed(ROOT_PATH, rootSha);
			const reconciled = await temporal.ensureCommitIndexed(ROOT_PATH, childSha);
			const store = await registry.getStore('synthetic-history', ROOT_PATH);
			assert.deepStrictEqual({
				isCheckpoint: reconciled.isCheckpoint,
				storedCommits: (await store.getAllCommits()).map(commit => [commit.commitSha, commit.isCheckpoint, commit.baseCommitSha]),
				status: await temporal.getCommitIndexStatus(ROOT_PATH, childSha),
				getCommitCalls: git.getCommitCalls,
				diffCalls: git.diffCalls,
			}, {
				isCheckpoint: false,
				storedCommits: [
					[rootSha, true, undefined],
					[childSha, false, rootSha],
				],
				status: { status: 'ready', lineageCoverage: { kind: 'complete' } },
				getCommitCalls: 3,
				diffCalls: 1,
			});
		} finally {
			await registry.closeAll();
		}
	});

	test('multi-level reconciliation A -> B -> C -> D converges coverage and delta chain across out-of-order indexing (D, C, A, B, C, D)', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-bounded-multi-reconcile-'));
		tempDirs.push(tempDir);
		const git = new LongHistoryGitService();
		const registry = new TemporalRepositoryRegistry(async () => new SqliteTemporalStore({ dbPath: path.join(tempDir, 'temporal.db') }), new NodeCanonicalParseService());
		const temporal = new TemporalGraphService(git, registry);
		const shaA = commitSha(0);
		const shaB = commitSha(1);
		const shaC = commitSha(2);
		const shaD = commitSha(3);

		try {
			// 1. Index D (isolated checkpoint)
			await temporal.ensureCommitIndexed(ROOT_PATH, shaD);
			assert.deepStrictEqual(await temporal.getCommitIndexStatus(ROOT_PATH, shaD), {
				status: 'ready',
				lineageCoverage: { kind: 'partial', unknownBeforeCommitSha: shaD },
			});

			// 2. Index C (isolated checkpoint)
			await temporal.ensureCommitIndexed(ROOT_PATH, shaC);
			assert.deepStrictEqual(await temporal.getCommitIndexStatus(ROOT_PATH, shaC), {
				status: 'ready',
				lineageCoverage: { kind: 'partial', unknownBeforeCommitSha: shaC },
			});

			// 3. Index A (root checkpoint, complete)
			await temporal.ensureCommitIndexed(ROOT_PATH, shaA);
			assert.deepStrictEqual(await temporal.getCommitIndexStatus(ROOT_PATH, shaA), {
				status: 'ready',
				lineageCoverage: { kind: 'complete' },
			});

			// 4. Index B (delta from A, complete)
			await temporal.ensureCommitIndexed(ROOT_PATH, shaB);
			assert.deepStrictEqual(await temporal.getCommitIndexStatus(ROOT_PATH, shaB), {
				status: 'ready',
				lineageCoverage: { kind: 'complete' },
			});

			// 5. Re-request C: reconciles against B -> becomes delta from B, complete
			const reconciledC = await temporal.ensureCommitIndexed(ROOT_PATH, shaC);
			assert.strictEqual(reconciledC.isCheckpoint, false);
			assert.deepStrictEqual(await temporal.getCommitIndexStatus(ROOT_PATH, shaC), {
				status: 'ready',
				lineageCoverage: { kind: 'complete' },
			});

			// 6. Re-request D: reconciles against C -> becomes delta from C, complete
			const reconciledD = await temporal.ensureCommitIndexed(ROOT_PATH, shaD);
			assert.strictEqual(reconciledD.isCheckpoint, false);
			assert.deepStrictEqual(await temporal.getCommitIndexStatus(ROOT_PATH, shaD), {
				status: 'ready',
				lineageCoverage: { kind: 'complete' },
			});

			const store = await registry.getStore('synthetic-history', ROOT_PATH);
			const allCommits = await store.getAllCommits();
			const sorted = allCommits.slice().sort((a, b) => a.commitSha.localeCompare(b.commitSha));
			assert.deepStrictEqual(
				sorted.map(c => [c.commitSha, c.isCheckpoint, c.baseCommitSha, c.lineageCoverage?.kind]),
				[
					[shaA, true, undefined, 'complete'],
					[shaB, false, shaA, 'complete'],
					[shaC, false, shaB, 'complete'],
					[shaD, false, shaC, 'complete'],
				]
			);
		} finally {
			await registry.closeAll();
		}
	});
});

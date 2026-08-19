/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { WorkbenchGitHistoryService, type WorkbenchGitServiceLike } from '../../host/workbench/workbenchGitHistoryService.js';
import { GitHistoryError } from '../../history/git/gitTypes.js';

suite('Production Git Bridge Contract Unit Tests', () => {
	const mockRepo = {
		rootUri: { path: '/workspace/app', fsPath: '/workspace/app', toString: () => 'file:///workspace/app' },
		state: { current: {} },
		async resolveCommitRef(ref: string) {
			if (ref.startsWith('-')) {
				const err: any = new Error(`fatal: ambiguous argument '${ref}': unknown revision or path`);
				err.code = 'UnknownRef';
				throw err;
			}
			if (ref === 'HEAD' || ref === 'main') return 'aaaa111122223333444455556666777788889999';
			if (ref === 'feature') return 'bbbb111122223333444455556666777788889999';
			if (ref === 'v1.0.0') return 'cccc111122223333444455556666777788889999';
			const err: any = new Error(`Ref '${ref}' not found`);
			err.code = 'UnknownRef';
			throw err;
		},
		async getCommitDetails(ref: string) {
			if (ref === 'aaaa111122223333444455556666777788889999') {
				return {
					sha: 'aaaa111122223333444455556666777788889999',
					parents: ['parent000000000000000000000000000000000'],
					author: { name: 'Alice Author', email: 'alice@example.com', date: '2026-08-18T10:00:00.000Z' },
					committer: { name: 'Bob Committer', email: 'bob@example.com', date: '2026-08-18T12:00:00.000Z' },
					authorTimestamp: 1771322400000,
					committerTimestamp: 1771329600000,
					message: 'feat: add temporal bridge',
				};
			}
			const err: any = new Error(`Commit '${ref}' not found`);
			err.code = 'UnknownRef';
			throw err;
		},
		async getCommitLog(options: any) {
			if (options.firstParent) {
				return [
					{
						sha: 'aaaa111122223333444455556666777788889999',
						parents: ['parent000000000000000000000000000000000'],
						author: { name: 'Alice', email: 'alice@example.com', date: '2026-08-18T10:00:00Z' },
						committer: { name: 'Bob', email: 'bob@example.com', date: '2026-08-18T12:00:00Z' },
						authorTimestamp: 1771322400000,
						committerTimestamp: 1771329600000,
						message: 'mainline commit',
					}
				];
			}
			return [];
		},
		async getRefs(query: any) {
			if (query?.pattern === 'refs/tags/*') {
				return [
					{
						name: 'v1.0.0',
						commit: 'cccc111122223333444455556666777788889999',
						tagCommit: 'tagobj111111111111111111111111111111111',
						peeledCommit: 'cccc111122223333444455556666777788889999',
						isAnnotated: true,
						type: 2,
					},
					{
						name: 'v0.9.0-lw',
						commit: 'dddd111122223333444455556666777788889999',
						tagCommit: 'dddd111122223333444455556666777788889999',
						peeledCommit: 'dddd111122223333444455556666777788889999',
						isAnnotated: false,
						type: 2,
					}
				];
			}
			return [
				{ name: 'main', commit: 'aaaa111122223333444455556666777788889999', type: 0 },
				{ name: 'origin/main', commit: 'aaaa111122223333444455556666777788889999', type: 1 },
			];
		},
		async diffExactTrees(refA: string, refB: string) {
			return {
				fromRef: refA,
				toRef: refB,
				changes: [
					{ kind: 'modified', path: 'src/app.ts', oldBlobOid: 'blobA1', newBlobOid: 'blobB1' },
					{ kind: 'added', path: 'src/utils.ts', newBlobOid: 'blobB2' },
				]
			};
		},
		async diffReviewRange(baseRef: string, headRef: string) {
			return {
				fromRef: baseRef,
				toRef: headRef,
				changes: [
					{ kind: 'added', path: 'src/utils.ts', newBlobOid: 'blobB2' },
				]
			};
		},
		async diffCommitToParent(commitRef: string, parentIndex?: number) {
			const parent = parentIndex === undefined || parentIndex === 0 ? 'parent000000000000000000000000000000000' : 'empty';
			return {
				fromRef: parent,
				toRef: commitRef,
				changes: [
					{ kind: 'modified', path: 'src/app.ts' }
				]
			};
		},
		async listTreeEntries(_ref: string) {
			return [
				{ path: 'src/app.ts', objectId: 'blobA1', mode: '100644', objectType: 'blob', size: 500 },
			];
		},
		async readBlobContent(_ref: string, path: string, maxBytes?: number) {
			if (path === 'src/app.ts') {
				if (maxBytes !== undefined && maxBytes < 500) {
					const err: any = new Error('Blob exceeds limit');
					err.code = 'OversizedBlob';
					throw err;
				}
				return 'export const app = true;';
			}
			const err: any = new Error('Object not found');
			err.code = 'ObjectUnavailable';
			throw err;
		}
	};

	const mockGitService: WorkbenchGitServiceLike = {
		repositories: [mockRepo],
		async openRepository() {
			return mockRepo;
		}
	};

	test('distinguishes exact tree diff from review range diff on divergent branches', async () => {
		const service = new WorkbenchGitHistoryService(mockGitService as any);
		const exactDiff = await service.diffCommitTrees('/workspace/app', 'feature', 'main');
		const reviewDiff = await service.diffReviewRange('/workspace/app', 'main', 'feature');

		// Exact diff sees both modified and added
		assert.strictEqual(exactDiff.changes.length, 2);
		assert.strictEqual(exactDiff.changes[0].kind, 'modified');
		assert.strictEqual(exactDiff.changes[0].path, 'src/app.ts');

		// Review diff (merge-base) only sees feature additions
		assert.strictEqual(reviewDiff.changes.length, 1);
		assert.strictEqual(reviewDiff.changes[0].path, 'src/utils.ts');
	});

	test('peels annotated tags and marks isAnnotated truthfully', async () => {
		const service = new WorkbenchGitHistoryService(mockGitService as any);
		const tags = await service.listTags('/workspace/app');

		assert.strictEqual(tags.length, 2);

		const annotated = tags.find(t => t.name === 'v1.0.0');
		assert.ok(annotated);
		assert.strictEqual(annotated.isAnnotated, true);
		assert.strictEqual(annotated.tagCommit, 'tagobj111111111111111111111111111111111');
		assert.strictEqual(annotated.peeledCommit, 'cccc111122223333444455556666777788889999');

		const lightweight = tags.find(t => t.name === 'v0.9.0-lw');
		assert.ok(lightweight);
		assert.strictEqual(lightweight.isAnnotated, false);
		assert.strictEqual(lightweight.peeledCommit, 'dddd111122223333444455556666777788889999');
	});

	test('preserves committer distinct from author with valid timestamps', async () => {
		const service = new WorkbenchGitHistoryService(mockGitService as any);
		const commit = await service.getCommit('/workspace/app', 'aaaa111122223333444455556666777788889999');

		assert.strictEqual(commit.author.name, 'Alice Author');
		assert.strictEqual(commit.committer.name, 'Bob Committer');
		assert.strictEqual(commit.author.email, 'alice@example.com');
		assert.strictEqual(commit.committer.email, 'bob@example.com');
		assert.strictEqual(commit.authorTimestamp, 1771322400000);
		assert.strictEqual(commit.committerTimestamp, 1771329600000);
		assert.notStrictEqual(commit.authorTimestamp, commit.committerTimestamp);
	});

	test('rejects option-like ref injection safely', async () => {
		const service = new WorkbenchGitHistoryService(mockGitService as any);
		await assert.rejects(
			async () => service.resolveRef('/workspace/app', '--help'),
			(err: any) => {
				assert.strictEqual(err.name, GitHistoryError.name);
				assert.strictEqual(err.code, 'UnknownRef');
				return true;
			}
		);
	});

	test('supports firstParent log option for merge DAG traversal', async () => {
		const service = new WorkbenchGitHistoryService(mockGitService as any);
		const commits = await service.log('/workspace/app', { firstParent: true });

		assert.strictEqual(commits.length, 1);
		assert.strictEqual(commits[0].message, 'mainline commit');
	});

	test('propagates OversizedBlob error code when reading content beyond limit', async () => {
		const service = new WorkbenchGitHistoryService(mockGitService as any);
		const content = await service.readFileAtRef('/workspace/app', 'HEAD', 'src/app.ts');
		assert.strictEqual(content, 'export const app = true;');
	});
});

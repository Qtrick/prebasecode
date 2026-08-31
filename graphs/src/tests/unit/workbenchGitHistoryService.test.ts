/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { WorkbenchGitHistoryService, type WorkbenchGitServiceLike } from '../../host/workbench/workbenchGitHistoryService.js';
import { GitHistoryError } from '../../history/git/gitTypes.js';

const uriIdentityService = {
	extUri: {
		isEqual: (first: { fsPath: string }, second: { fsPath: string }) => first.fsPath === second.fsPath,
		isEqualOrParent: (resource: { fsPath: string }, candidate: { fsPath: string }) => resource.fsPath === candidate.fsPath || resource.fsPath.startsWith(`${candidate.fsPath}/`),
	},
} as unknown as ConstructorParameters<typeof WorkbenchGitHistoryService>[1];

suite('WorkbenchGitHistoryService Unit Tests', () => {
	const mockRepo = {
		rootUri: { path: '/workspace/test-repo', fsPath: '/workspace/test-repo', toString: () => 'file:///workspace/test-repo' },
		state: { current: {} },
		async resolveCommitRef(ref: string) {
			if (ref === 'HEAD' || ref === 'main') {
				return '1111111111111111111111111111111111111111';
			}
			if (ref === 'feat') {
				return '2222222222222222222222222222222222222222';
			}
			throw new Error(`Ref '${ref}' could not be resolved`);
		},
		async getCommitDetails(ref: string) {
			if (ref === '1111111111111111111111111111111111111111') {
				return {
					sha: '1111111111111111111111111111111111111111',
					parents: ['0000000000000000000000000000000000000000'],
					author: { name: 'Developer', email: 'dev@prebase.io', date: '2026-08-18T00:00:00Z' },
					committer: { name: 'Developer', email: 'dev@prebase.io', date: '2026-08-18T00:00:00Z' },
					authorTimestamp: 1771286400000,
					committerTimestamp: 1771286400000,
					message: 'feat: add temporal graph engine',
				};
			}
			throw new Error(`Commit '${ref}' not found`);
		},
		async getCommitLog(options?: any) {
			const all = [
				{
					sha: '1111111111111111111111111111111111111111',
					parents: [],
					author: { name: 'Developer', email: 'dev@prebase.io', date: '2026-08-18T00:00:00Z' },
					committer: { name: 'Developer', email: 'dev@prebase.io', date: '2026-08-18T00:00:00Z' },
					authorTimestamp: 1771286400000,
					committerTimestamp: 1771286400000,
					message: 'initial commit',
				},
				{
					sha: '2222222222222222222222222222222222222222',
					parents: ['1111111111111111111111111111111111111111'],
					author: { name: 'Alice', email: 'alice@prebase.io', date: '2026-08-19T00:00:00Z' },
					committer: { name: 'Alice', email: 'alice@prebase.io', date: '2026-08-19T00:00:00Z' },
					authorTimestamp: 1771372800000,
					committerTimestamp: 1771372800000,
					message: 'feat(graph): add 3d camera perspective',
				}
			];
			return all.filter(c => {
				if (options?.grep && !c.message.toLowerCase().includes(options.grep.toLowerCase())) {return false;}
				if (options?.author && !c.author.name.toLowerCase().includes(options.author.toLowerCase())) {return false;}
				return true;
			});
		},
		async listTreeEntries(_ref: string) {
			const entries = [
				{ path: 'src/index.ts', objectId: 'blob1', mode: '100644', objectType: 'blob', size: 120 },
				{ path: 'src/components/App.tsx', objectId: 'blob2', mode: '100644', objectType: 'blob', size: 240 },
			];
			return { entries, isTruncated: false, discoveredAtLeast: entries.length };
		},
		async readBlobContent(_ref: string, path: string) {
			if (path === 'src/index.ts') {
				return `export const index = true;`;
			}
			if (path === 'src/components/App.tsx') {
				return `export function App() { return null; }`;
			}
			throw new Error(`File '${path}' not found at ref`);
		},
		async diffExactTrees(refA: string, refB: string) {
			return {
				fromRef: refA,
				toRef: refB,
				changes: [
					{ kind: 'modified', path: 'src/index.ts' },
					{ kind: 'added', path: 'src/components/App.tsx' },
				]
			};
		},
		async diffCommitToParent(commitRef: string, _parentIndex?: number) {
			return {
				fromRef: '0000000000000000000000000000000000000000',
				toRef: commitRef,
				changes: [
					{ kind: 'added', path: 'src/index.ts' },
				]
			};
		},
		async diffReviewRange(baseRef: string, headRef: string) {
			return {
				fromRef: baseRef,
				toRef: headRef,
				changes: [
					{ kind: 'modified', path: 'src/index.ts' }
				]
			};
		},
		async getRefs() {
			return [
				{ name: 'main', commit: '1111111111111111111111111111111111111111', type: 0 },
				{ name: 'v1.0.0', commit: '1111111111111111111111111111111111111111', type: 2 },
			];
		},
		async checkIgnore(paths: string[]) {
			return paths.filter(p => p.includes('ignore-me'));
		}
	};

	const mockGitService: WorkbenchGitServiceLike = {
		repositories: [mockRepo],
		async openRepository() {
			return mockRepo;
		}
	};

	const gitServiceParam = mockGitService as unknown as ConstructorParameters<typeof WorkbenchGitHistoryService>[0];

	test('resolves references and fetches commit details accurately', async () => {
		const service = new WorkbenchGitHistoryService(gitServiceParam, uriIdentityService);
		const sha = await service.resolveRef('/workspace/test-repo', 'main');
		assert.strictEqual(sha, '1111111111111111111111111111111111111111');

		const commit = await service.getCommit('/workspace/test-repo', sha);
		assert.strictEqual(commit.sha, sha);
		assert.strictEqual(commit.message, 'feat: add temporal graph engine');
		assert.strictEqual(commit.parents.length, 1);
	});

	test('lists tree entries, reads blobs, and diffs trees via bridge', async () => {
		const service = new WorkbenchGitHistoryService(gitServiceParam, uriIdentityService);
		const inventory = await service.listTree('/workspace/test-repo', 'HEAD');
		assert.strictEqual(inventory.entries.length, 2);
		assert.strictEqual(inventory.isTruncated, false);
		assert.strictEqual(inventory.entries[0].path, 'src/index.ts');
		assert.strictEqual(inventory.entries[0].objectType, 'blob');

		const content = await service.readFileAtRef('/workspace/test-repo', 'HEAD', 'src/index.ts');
		assert.strictEqual(content, 'export const index = true;');

		const diff = await service.diffCommitTrees('/workspace/test-repo', 'refA', 'refB');
		assert.strictEqual(diff.changes.length, 2);
		assert.strictEqual(diff.changes[0].kind, 'modified');
	});

	test('preserves producer truncation metadata across the workbench bridge', async () => {
		const truncatedRepo = {
			...mockRepo,
			async listTreeEntries() {
				return {
					entries: [{ path: 'src/index.ts', objectId: 'blob1', mode: '100644', objectType: 'blob', size: 120 }],
					isTruncated: true,
					discoveredAtLeast: 2,
				};
			},
		};
		const service = new WorkbenchGitHistoryService({ repositories: [truncatedRepo] } as unknown as ConstructorParameters<typeof WorkbenchGitHistoryService>[0], uriIdentityService);
		const inventory = await service.listTree('/workspace/test-repo', 'HEAD', { maxEntries: 1 });
		assert.deepStrictEqual({
			paths: inventory.entries.map(entry => entry.path),
			isTruncated: inventory.isTruncated,
			returnedCount: inventory.returnedCount,
			discoveredAtLeast: inventory.discoveredAtLeast,
		}, {
			paths: ['src/index.ts'],
			isTruncated: true,
			returnedCount: 1,
			discoveredAtLeast: 2,
		});
	});

	test('emits deduplicated onDidChangeHead events', () => {
		const service = new WorkbenchGitHistoryService(gitServiceParam, uriIdentityService);
		const events: unknown[] = [];
		const disposable = service.onDidChangeHead?.((e) => {
			events.push(e);
		});

		service.notifyHeadChanged('repo1', 'shaA', 'commit');
		service.notifyHeadChanged('repo1', 'shaA', 'commit'); // Duplicate SHA should be ignored!
		service.notifyHeadChanged('repo1', 'shaB', 'checkout');

		assert.strictEqual(events.length, 2);
		const event0 = events[0] as { currentHead: string; transitionType: string };
		const event1 = events[1] as { previousHead: string; currentHead: string; transitionType: string };
		assert.strictEqual(event0.currentHead, 'shaA');
		assert.strictEqual(event0.transitionType, 'commit');
		assert.strictEqual(event1.previousHead, 'shaA');
		assert.strictEqual(event1.currentHead, 'shaB');
		assert.strictEqual(event1.transitionType, 'checkout');

		disposable?.dispose();
	});

	test('wraps failures into typed GitHistoryError without silent swallowing', async () => {
		const service = new WorkbenchGitHistoryService(gitServiceParam, uriIdentityService);
		await assert.rejects(
			async () => service.resolveRef('/workspace/test-repo', 'invalid-ref-12345'),
			(err: unknown) => {
				const e = err as GitHistoryError;
				assert.strictEqual(e.name, GitHistoryError.name);
				assert.strictEqual(e.code, 'UnknownRef');
				return true;
			}
		);
	});

	test('preserves extension-host log cancellation as typed Git control flow', async () => {
		const cancelledRepo = {
			...mockRepo,
			async getCommitLog() {
				const error = new Error('Cancelled by caller');
				error.name = 'CancellationError';
				throw error;
			},
		};
		const service = new WorkbenchGitHistoryService({ repositories: [cancelledRepo] } as unknown as ConstructorParameters<typeof WorkbenchGitHistoryService>[0], uriIdentityService);
		await assert.rejects(
			() => service.log('/workspace/test-repo'),
			// The graph runner loads workbench code from `out/`, so `instanceof`
			// can cross two copies of this class. Verify the stable boundary shape.
			(error: unknown) => (error as { name?: string; code?: string }).name === GitHistoryError.name && (error as { code?: string }).code === 'Cancelled',
		);
	});

	test('tracks HEAD changes per repository — events from different repos are independent', () => {
		const service = new WorkbenchGitHistoryService(gitServiceParam, uriIdentityService);
		const events: Array<{ repositoryId: string; previousHead?: string; currentHead: string; transitionType?: string }> = [];
		const disposable = service.onDidChangeHead?.((e) => events.push(e));

		// Both repos advance independently
		service.notifyHeadChanged('repo1', 'sha_A', 'commit');
		service.notifyHeadChanged('repo2', 'sha_X', 'commit');
		service.notifyHeadChanged('repo1', 'sha_B', 'checkout');
		service.notifyHeadChanged('repo2', 'sha_Y', 'branch-switch');

		assert.strictEqual(events.length, 4, 'all 4 events must be emitted');

		// repo1 event 1
		assert.strictEqual(events[0].repositoryId, 'repo1');
		assert.strictEqual(events[0].previousHead, undefined);
		assert.strictEqual(events[0].currentHead, 'sha_A');

		// repo2 event 1
		assert.strictEqual(events[1].repositoryId, 'repo2');
		assert.strictEqual(events[1].previousHead, undefined);
		assert.strictEqual(events[1].currentHead, 'sha_X');

		// repo1 event 2 — previousHead is repo1's last, not repo2's
		assert.strictEqual(events[2].repositoryId, 'repo1');
		assert.strictEqual(events[2].previousHead, 'sha_A');
		assert.strictEqual(events[2].currentHead, 'sha_B');

		// repo2 event 2 — previousHead is repo2's last
		assert.strictEqual(events[3].repositoryId, 'repo2');
		assert.strictEqual(events[3].previousHead, 'sha_X');
		assert.strictEqual(events[3].currentHead, 'sha_Y');

		disposable?.dispose();
	});

	test('per-repo deduplication: identical SHA on one repo does not suppress the same SHA on another', () => {
		const service = new WorkbenchGitHistoryService(gitServiceParam, uriIdentityService);
		const events: Array<{ repositoryId: string; previousHead?: string; currentHead: string }> = [];
		const disposable = service.onDidChangeHead?.((e) => events.push(e));

		// Simulate two repos landing on the same SHA (e.g. both branch from the same upstream tag)
		const SHARED_SHA = 'deadbeef00000000000000000000000000000000';
		service.notifyHeadChanged('repo1', SHARED_SHA, 'commit');
		service.notifyHeadChanged('repo2', SHARED_SHA, 'commit'); // must NOT be swallowed
		// Within the same repo, a duplicate should be swallowed
		service.notifyHeadChanged('repo1', SHARED_SHA, 'commit'); // swallowed
		service.notifyHeadChanged('repo2', SHARED_SHA, 'checkout'); // swallowed

		// Only 2 events emitted (one per repo); the within-repo duplicates are suppressed
		assert.strictEqual(events.length, 2);
		assert.strictEqual(events[0].repositoryId, 'repo1');
		assert.strictEqual(events[0].currentHead, SHARED_SHA);
		assert.strictEqual(events[1].repositoryId, 'repo2');
		assert.strictEqual(events[1].currentHead, SHARED_SHA);

		disposable?.dispose();
	});

	suite('searchHistory Intelligent Search', () => {
		test('searches commits by plain text query matching message', async () => {
			const service = new WorkbenchGitHistoryService(gitServiceParam, uriIdentityService);
			const results = await service.searchHistory('/workspace/test-repo', { query: 'camera' });
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].sha, '2222222222222222222222222222222222222222');
			assert.strictEqual(results[0].message, 'feat(graph): add 3d camera perspective');
		});

		test('parses author: prefix filter', async () => {
			const service = new WorkbenchGitHistoryService(gitServiceParam, uriIdentityService);
			const results = await service.searchHistory('/workspace/test-repo', { query: 'author:Alice' });
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].author.name, 'Alice');
		});

		test('parses msg: prefix filter', async () => {
			const service = new WorkbenchGitHistoryService(gitServiceParam, uriIdentityService);
			const results = await service.searchHistory('/workspace/test-repo', { query: 'msg:initial' });
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].sha, '1111111111111111111111111111111111111111');
		});

		test('direct SHA lookup resolves exact commit', async () => {
			const service = new WorkbenchGitHistoryService(gitServiceParam, uriIdentityService);
			const results = await service.searchHistory('/workspace/test-repo', { sha: '1111111111111111111111111111111111111111' });
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].sha, '1111111111111111111111111111111111111111');
		});
	});
});

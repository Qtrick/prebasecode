/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { WorkbenchGitHistoryService, type WorkbenchGitServiceLike } from '../../host/workbench/workbenchGitHistoryService.js';
import { GitHistoryError } from '../../history/git/gitTypes.js';

suite('WorkbenchGitHistoryService Unit Tests', () => {
	const mockRepo = {
		rootUri: { path: '/workspace/test-repo', fsPath: '/workspace/test-repo', toString: () => 'file:///workspace/test-repo' },
		state: { current: {} },
		async resolveCommitRef(ref: string) {
			if (ref === 'HEAD' || ref === 'main') return '1111111111111111111111111111111111111111';
			if (ref === 'feat') return '2222222222222222222222222222222222222222';
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
		async getCommitLog() {
			return [
				{
					sha: '1111111111111111111111111111111111111111',
					parents: [],
					author: { name: 'Developer', email: 'dev@prebase.io', date: '2026-08-18T00:00:00Z' },
					committer: { name: 'Developer', email: 'dev@prebase.io', date: '2026-08-18T00:00:00Z' },
					authorTimestamp: 1771286400000,
					committerTimestamp: 1771286400000,
					message: 'initial commit',
				}
			];
		},
		async listTreeEntries(_ref: string) {
			return [
				{ path: 'src/index.ts', objectId: 'blob1', mode: '100644', objectType: 'blob', size: 120 },
				{ path: 'src/components/App.tsx', objectId: 'blob2', mode: '100644', objectType: 'blob', size: 240 },
			];
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

	test('resolves references and fetches commit details accurately', async () => {
		const service = new WorkbenchGitHistoryService(mockGitService);
		const sha = await service.resolveRef('/workspace/test-repo', 'main');
		assert.strictEqual(sha, '1111111111111111111111111111111111111111');

		const commit = await service.getCommit('/workspace/test-repo', sha);
		assert.strictEqual(commit.sha, sha);
		assert.strictEqual(commit.message, 'feat: add temporal graph engine');
		assert.strictEqual(commit.parents.length, 1);
	});

	test('lists tree entries, reads blobs, and diffs trees via bridge', async () => {
		const service = new WorkbenchGitHistoryService(mockGitService);
		const entries = await service.listTree('/workspace/test-repo', 'HEAD');
		assert.strictEqual(entries.length, 2);
		assert.strictEqual(entries[0].path, 'src/index.ts');
		assert.strictEqual(entries[0].objectType, 'blob');

		const content = await service.readFileAtRef('/workspace/test-repo', 'HEAD', 'src/index.ts');
		assert.strictEqual(content, 'export const index = true;');

		const diff = await service.diffCommitTrees('/workspace/test-repo', 'refA', 'refB');
		assert.strictEqual(diff.changes.length, 2);
		assert.strictEqual(diff.changes[0].kind, 'modified');
	});

	test('emits deduplicated onDidChangeHead events', () => {
		const service = new WorkbenchGitHistoryService(mockGitService);
		const events: any[] = [];
		const disposable = service.onDidChangeHead?.((e) => {
			events.push(e);
		});

		service.notifyHeadChanged('repo1', 'shaA', 'commit');
		service.notifyHeadChanged('repo1', 'shaA', 'commit'); // Duplicate SHA should be ignored!
		service.notifyHeadChanged('repo1', 'shaB', 'checkout');

		assert.strictEqual(events.length, 2);
		assert.strictEqual(events[0].currentHead, 'shaA');
		assert.strictEqual(events[0].transitionType, 'commit');
		assert.strictEqual(events[1].previousHead, 'shaA');
		assert.strictEqual(events[1].currentHead, 'shaB');
		assert.strictEqual(events[1].transitionType, 'checkout');

		disposable?.dispose();
	});

	test('wraps failures into typed GitHistoryError without silent swallowing', async () => {
		const service = new WorkbenchGitHistoryService(mockGitService);
		await assert.rejects(
			async () => service.resolveRef('/workspace/test-repo', 'invalid-ref-12345'),
			(err: any) => {
				assert.strictEqual(err.name, GitHistoryError.name);
				assert.strictEqual(err.code, 'UnknownRef');
				return true;
			}
		);
	});
});

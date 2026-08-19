/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NodeGitHistoryService } from '../fixtures/nodeGitHistoryService.js';
import { GitHistoryError } from '../../history/git/gitTypes.js';

suite('GitHistoryService & Node Adapter Unit Tests', () => {
	let tempRepoDir: string;
	let gitService: NodeGitHistoryService;

	setup(async () => {
		tempRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prebase-git-test-'));
		execSync('git init -b main', { cwd: tempRepoDir });
		execSync('git config user.name "Test Runner"', { cwd: tempRepoDir });
		execSync('git config user.email "test@example.com"', { cwd: tempRepoDir });

		// Commit 1: Initial files
		await fs.writeFile(path.join(tempRepoDir, 'package.json'), JSON.stringify({ name: 'repo', main: 'index.js' }));
		await fs.writeFile(path.join(tempRepoDir, 'index.js'), 'const a = require("./util");\nmodule.exports = a;\n');
		await fs.writeFile(path.join(tempRepoDir, 'util.js'), 'module.exports = 42;\n');
		execSync('git add . && git commit -m "feat: initial commit"', { cwd: tempRepoDir });

		// Lightweight tag
		execSync('git tag v0.1.0', { cwd: tempRepoDir });

		// Commit 2: Modify & rename
		await fs.writeFile(path.join(tempRepoDir, 'index.js'), 'const a = require("./helper");\nmodule.exports = a;\n');
		execSync('git mv util.js helper.js', { cwd: tempRepoDir });
		execSync('git commit -a -m "refactor: rename util to helper"', { cwd: tempRepoDir });

		// Annotated tag
		execSync('git tag -a v0.2.0 -m "Release v0.2.0"', { cwd: tempRepoDir });

		// Branch feature/login
		execSync('git branch feature/login', { cwd: tempRepoDir });

		gitService = new NodeGitHistoryService();
	});

	teardown(async () => {
		try {
			await fs.rm(tempRepoDir, { recursive: true, force: true });
		} catch {
			// Cleanup ignore
		}
	});

	test('isGitRepository and getRepositoryIdentity', async () => {
		const isRepo = await gitService.isGitRepository(tempRepoDir);
		assert.strictEqual(isRepo, true);

		const identity = await gitService.getRepositoryIdentity(tempRepoDir);
		assert.ok(identity.rootPath);
		assert.ok(identity.gitDir.endsWith('.git'));
	});

	test('listBranches parses branch names and commits cleanly via %00', async () => {
		const branches = await gitService.listBranches(tempRepoDir);
		assert.ok(branches.length >= 2);
		const main = branches.find(b => b.name === 'main');
		const feature = branches.find(b => b.name === 'feature/login');

		assert.ok(main);
		assert.ok(feature);
		assert.strictEqual(main.isRemote, false);
		assert.strictEqual(main.commit.length, 40);
	});

	test('listTags distinguishes lightweight from annotated tags and peels annotated tags', async () => {
		const tags = await gitService.listTags(tempRepoDir);
		assert.strictEqual(tags.length, 2);

		const v010 = tags.find(t => t.name === 'v0.1.0');
		const v020 = tags.find(t => t.name === 'v0.2.0');

		assert.ok(v010);
		assert.ok(v020);

		// v0.1.0 is lightweight
		assert.strictEqual(v010.isAnnotated, false);
		assert.strictEqual(v010.tagCommit.length, 40);

		// v0.2.0 is annotated
		assert.strictEqual(v020.isAnnotated, true);
		assert.strictEqual(v020.tagCommit.length, 40);
		assert.ok(v020.peeledCommit);
		assert.strictEqual(v020.peeledCommit?.length, 40);
		assert.notStrictEqual(v020.tagCommit, v020.peeledCommit);
	});

	test('resolveRef strictly resolves commits with --verify and throws UnknownRef for invalid refs', async () => {
		const headCommit = await gitService.resolveRef(tempRepoDir, 'HEAD');
		assert.strictEqual(headCommit.length, 40);

		const tagCommit = await gitService.resolveRef(tempRepoDir, 'v0.2.0');
		assert.strictEqual(tagCommit.length, 40);

		await assert.rejects(
			async () => gitService.resolveRef(tempRepoDir, 'nonexistent-ref-12345'),
			(err: Error) => {
				assert.ok(err instanceof GitHistoryError);
				assert.strictEqual((err as GitHistoryError).code, 'UnknownRef');
				return true;
			}
		);
	});

	test('log returns bounded commits with machine-stable timestamps and parent links', async () => {
		const commits = await gitService.log(tempRepoDir, { limit: 10 });
		assert.strictEqual(commits.length, 2);

		const head = commits[0];
		assert.strictEqual(head.message, 'refactor: rename util to helper');
		assert.strictEqual(head.parents.length, 1);
		assert.ok(head.authorTimestamp > 0);
		assert.ok(head.committerTimestamp > 0);
		assert.strictEqual(head.author.name, 'Test Runner');

		const root = commits[1];
		assert.strictEqual(root.message, 'feat: initial commit');
		assert.strictEqual(root.parents.length, 0);
	});

	test('listTree parses objectId, mode, and size using -l', async () => {
		const headSha = await gitService.getHead(tempRepoDir);
		const tree = await gitService.listTree(tempRepoDir, headSha);

		assert.ok(tree.length >= 3);
		const helperEntry = tree.find(e => e.path === 'helper.js');
		assert.ok(helperEntry);
		assert.strictEqual(helperEntry.objectType, 'blob');
		assert.strictEqual(typeof helperEntry.size, 'number');
		assert.ok(helperEntry.size! > 0);
		assert.strictEqual(helperEntry.objectId.length, 40);
	});

	test('diffCommitTrees captures rename and modifications with exact blob hashes', async () => {
		const commits = await gitService.log(tempRepoDir);
		const rootSha = commits[1].sha;
		const headSha = commits[0].sha;

		const diff = await gitService.diffCommitTrees(tempRepoDir, rootSha, headSha);
		assert.strictEqual(diff.fromRef, rootSha);
		assert.strictEqual(diff.toRef, headSha);

		const rename = diff.changes.find(c => c.kind === 'renamed');
		assert.ok(rename);
		assert.strictEqual(rename.oldPath, 'util.js');
		assert.strictEqual(rename.path, 'helper.js');

		const mod = diff.changes.find(c => c.kind === 'modified' && c.path === 'index.js');
		assert.ok(mod);
		assert.ok(mod.oldBlobOid);
		assert.ok(mod.newBlobOid);
	});

	test('diffCommitToParent for root commit correctly diffs against empty tree', async () => {
		const commits = await gitService.log(tempRepoDir);
		const rootSha = commits[1].sha;

		const diff = await gitService.diffCommitToParent(tempRepoDir, rootSha);
		assert.strictEqual(diff.toRef, rootSha);
		assert.strictEqual(diff.changes.length, 3);
		assert.ok(diff.changes.every(c => c.kind === 'added'));
	});

	test('HEAD change observer notifies on event fire', () => {
		let received: string | undefined;
		const sub = gitService.onDidChangeHead((e) => {
			received = e.currentHead;
		});

		gitService.fireHeadChange({
			repositoryId: tempRepoDir,
			currentHead: 'deadbeef123',
			timestamp: Date.now(),
			transitionType: 'commit',
		});

		assert.strictEqual(received, 'deadbeef123');
		sub.dispose();
	});
});

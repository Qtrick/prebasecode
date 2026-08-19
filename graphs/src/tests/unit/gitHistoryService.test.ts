/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { GitHistoryService, GIT_EMPTY_TREE_HASH } from '../../history/git/gitHistoryService.js';

suite('GitHistoryService Unit & Integration Tests', () => {
	let repoDir: string;
	let gitService: GitHistoryService;

	let rootCommitSha: string;
	let commit2Sha: string;
	let renameCommitSha: string;
	let featureCommitSha: string;
	let mainCommitSha: string;
	let mergeCommitSha: string;
	let weirdPathsCommitSha: string;

	suiteSetup(async () => {
		repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prebase-git-test-'));
		gitService = new GitHistoryService();

		const runGit = (args: string[]) => {
			execFileSync('git', args, { cwd: repoDir, stdio: 'pipe' });
		};

		runGit(['init', '-b', 'main']);
		runGit(['config', 'user.name', 'PreBase Test']);
		runGit(['config', 'user.email', 'test@prebase.dev']);
		runGit(['config', 'commit.gpgsign', 'false']);

		// 1. Root commit (0 parents)
		await fs.mkdir(path.join(repoDir, 'src'), { recursive: true });
		await fs.writeFile(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'test-app', main: 'src/index.ts' }), 'utf8');
		await fs.writeFile(path.join(repoDir, 'src', 'index.ts'), 'export const start = () => console.log("started");\n', 'utf8');
		runGit(['add', '.']);
		runGit(['commit', '-m', 'Initial root commit']);
		rootCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// 2. Commit 2: Add auth file
		await fs.mkdir(path.join(repoDir, 'src', 'auth'), { recursive: true });
		const loginContent = '// Authentication module\nexport function login(user: string, pass: string) { return user === "admin"; }\n';
		await fs.writeFile(path.join(repoDir, 'src', 'auth', 'login.ts'), loginContent, 'utf8');
		runGit(['add', '.']);
		runGit(['commit', '-m', 'Add auth login module']);
		commit2Sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// 3. Commit 3: Rename login.ts -> authentication/login.ts
		await fs.mkdir(path.join(repoDir, 'src', 'authentication'), { recursive: true });
		runGit(['mv', 'src/auth/login.ts', 'src/authentication/login.ts']);
		runGit(['commit', '-m', 'Rename auth to authentication']);
		renameCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// 4. Branch divergence: feature branch
		runGit(['checkout', '-b', 'feature']);
		await fs.writeFile(path.join(repoDir, 'src', 'feature.ts'), 'export const feature = 42;\n', 'utf8');
		runGit(['add', '.']);
		runGit(['commit', '-m', 'Add feature module']);
		featureCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// 5. Back to main branch and make another commit
		runGit(['checkout', 'main']);
		await fs.writeFile(path.join(repoDir, 'src', 'mainEdit.ts'), 'export const mainEdit = true;\n', 'utf8');
		runGit(['add', '.']);
		runGit(['commit', '-m', 'Main branch progress']);
		mainCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// 6. Merge feature into main (merge commit with 2 parents)
		runGit(['merge', 'feature', '--no-ff', '-m', 'Merge branch feature into main']);
		mergeCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// 7. Commit with weird file names (spaces, unicode, leading dashes)
		await fs.writeFile(path.join(repoDir, 'src', 'space name.ts'), 'export const space = true;\n', 'utf8');
		await fs.writeFile(path.join(repoDir, 'src', 'unicode-文件.ts'), 'export const unicode = true;\n', 'utf8');
		await fs.writeFile(path.join(repoDir, 'src', '--dash.ts'), 'export const dash = true;\n', 'utf8');
		runGit(['add', '.']);
		runGit(['commit', '-m', 'Add files with unusual paths']);
		weirdPathsCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();
	});

	suiteTeardown(async () => {
		if (repoDir) {
			await fs.rm(repoDir, { recursive: true, force: true });
		}
	});

	test('isGitRepository identifies valid git repositories and rejects non-git paths', async () => {
		assert.strictEqual(await gitService.isGitRepository(repoDir), true);
		assert.strictEqual(await gitService.isGitRepository(os.tmpdir()), false);
	});

	test('getRepositoryIdentity extracts root path and git directory', async () => {
		const identity = await gitService.getRepositoryIdentity(repoDir);
		assert.ok(identity);
		const realExpected = await fs.realpath(repoDir);
		assert.strictEqual(identity.rootPath, realExpected);
		assert.ok(identity.gitDir.endsWith('.git'));
	});

	test('getCommit correctly preserves parents for root (0), linear (1), and merge (2) commits', async () => {
		const rootCommit = await gitService.getCommit(repoDir, rootCommitSha);
		assert.ok(rootCommit);
		assert.strictEqual(rootCommit.sha, rootCommitSha);
		assert.strictEqual(rootCommit.parents.length, 0); // Root commit has 0 parents
		assert.strictEqual(rootCommit.message, 'Initial root commit');

		const linearCommit = await gitService.getCommit(repoDir, commit2Sha);
		assert.ok(linearCommit);
		assert.strictEqual(linearCommit.parents.length, 1);
		assert.strictEqual(linearCommit.parents[0], rootCommitSha);

		const mergeCommit = await gitService.getCommit(repoDir, mergeCommitSha);
		assert.ok(mergeCommit);
		assert.strictEqual(mergeCommit.parents.length, 2); // Merge commit has 2 parents!
		assert.strictEqual(mergeCommit.parents.includes(mainCommitSha), true);
		assert.strictEqual(mergeCommit.parents.includes(featureCommitSha), true);
	});

	test('log returns paginated commits and supports firstParent option', async () => {
		const fullLog = await gitService.log(repoDir, { limit: 20 });
		assert.strictEqual(fullLog.length >= 6, true);

		const paged = await gitService.log(repoDir, { limit: 2, skip: 1 });
		assert.strictEqual(paged.length, 2);
		assert.strictEqual(paged[0].sha, fullLog[1].sha);
		assert.strictEqual(paged[1].sha, fullLog[2].sha);

		const firstParentLog = await gitService.log(repoDir, { ref: mergeCommitSha, firstParent: true });
		assert.strictEqual(firstParentLog.some(c => c.sha === featureCommitSha), false);
		assert.strictEqual(firstParentLog.some(c => c.sha === mainCommitSha), true);
	});

	test('diffCommitTrees detects file renames with oldPath and newPath', async () => {
		const diff = await gitService.diffCommitTrees(repoDir, commit2Sha, renameCommitSha);
		assert.strictEqual(diff.fromRef, commit2Sha);
		assert.strictEqual(diff.toRef, renameCommitSha);

		const renameChange = diff.changes.find(c => c.kind === 'renamed');
		assert.ok(renameChange);
		assert.strictEqual(renameChange.oldPath, 'src/auth/login.ts');
		assert.strictEqual(renameChange.path, 'src/authentication/login.ts');
		assert.ok(typeof renameChange.similarity === 'number');
	});

	test('diffCommitToParent diffs root commit against empty tree hash', async () => {
		assert.strictEqual(GIT_EMPTY_TREE_HASH, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
		const rootDiff = await gitService.diffCommitToParent(repoDir, rootCommitSha);
		assert.strictEqual(rootDiff.changes.length, 2); // package.json and src/index.ts
		assert.strictEqual(rootDiff.changes.every(c => c.kind === 'added'), true);
	});

	test('diffCommitTrees (exact state A↔B) is distinct from diffReviewRange (three-dot base↔head)', async () => {
		// Exact diff between mainCommitSha and featureCommitSha
		// mainCommit has src/mainEdit.ts and does NOT have src/feature.ts
		// featureCommit has src/feature.ts and does NOT have src/mainEdit.ts
		const exactDiff = await gitService.diffCommitTrees(repoDir, mainCommitSha, featureCommitSha);
		// Exact diff from main -> feature should show mainEdit deleted and feature added
		const mainEditInExact = exactDiff.changes.find(c => c.path === 'src/mainEdit.ts');
		assert.ok(mainEditInExact);
		assert.strictEqual(mainEditInExact.kind, 'deleted');

		// Review diff: merge-base(main, feature) -> feature
		// merge-base is renameCommitSha, where mainEdit didn't exist yet, so review diff ONLY adds feature!
		const reviewDiff = await gitService.diffReviewRange(repoDir, mainCommitSha, featureCommitSha);
		const mainEditInReview = reviewDiff.changes.find(c => c.path === 'src/mainEdit.ts');
		assert.strictEqual(mainEditInReview, undefined); // NOT in review diff!
		const featureInReview = reviewDiff.changes.find(c => c.path === 'src/feature.ts');
		assert.ok(featureInReview);
		assert.strictEqual(featureInReview.kind, 'added');
	});

	test('listTree and readFileAtRef read historical files without checking out', async () => {
		// List tree at commit2 (before rename)
		const tree2 = await gitService.listTree(repoDir, commit2Sha);
		assert.strictEqual(tree2.some(e => e.path === 'src/auth/login.ts'), true);
		assert.strictEqual(tree2.some(e => e.path === 'src/authentication/login.ts'), false);

		// Read file content at commit2
		const content2 = await gitService.readFileAtRef(repoDir, commit2Sha, 'src/auth/login.ts');
		assert.ok(content2);
		assert.strictEqual(content2.includes('export function login'), true);

		// File does not exist at root commit
		const notFound = await gitService.readFileAtRef(repoDir, rootCommitSha, 'src/auth/login.ts');
		assert.strictEqual(notFound, undefined);
	});

	test('safely handles unusual file paths with spaces, unicode, and leading dashes', async () => {
		const tree = await gitService.listTree(repoDir, weirdPathsCommitSha);
		assert.strictEqual(tree.some(e => e.path === 'src/space name.ts'), true);
		assert.strictEqual(tree.some(e => e.path === 'src/unicode-文件.ts'), true);
		assert.strictEqual(tree.some(e => e.path === 'src/--dash.ts'), true);

		const spaceContent = await gitService.readFileAtRef(repoDir, weirdPathsCommitSha, 'src/space name.ts');
		assert.ok(spaceContent?.includes('export const space'));

		const unicodeContent = await gitService.readFileAtRef(repoDir, weirdPathsCommitSha, 'src/unicode-文件.ts');
		assert.ok(unicodeContent?.includes('export const unicode'));

		const dashContent = await gitService.readFileAtRef(repoDir, weirdPathsCommitSha, 'src/--dash.ts');
		assert.ok(dashContent?.includes('export const dash'));
	});

	test('historical analysis leaves working directory and HEAD completely unchanged', async () => {
		const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();
		const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// Perform multiple historical reads
		await gitService.getCommit(repoDir, rootCommitSha);
		await gitService.listTree(repoDir, commit2Sha);
		await gitService.readFileAtRef(repoDir, rootCommitSha, 'package.json');
		await gitService.diffCommitTrees(repoDir, rootCommitSha, mergeCommitSha);

		const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();
		const statusAfter = execFileSync('git', ['status', '--porcelain'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		assert.strictEqual(headBefore, headAfter);
		assert.strictEqual(statusBefore, statusAfter);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { GitHistoryService } from '../../history/git/gitHistoryService.js';
import { GitTreeContentSource } from '../../history/git/gitTreeContentSource.js';
import { WorkingTreeContentSource } from '../../core/canonical/contentSource.js';
import { CanonicalGraphAnalyzer } from '../../core/canonical/canonicalGraphAnalyzer.js';
import { computeCanonicalGraphDiff } from '../../core/canonical/canonicalGraphDiff.js';

suite('GitTreeHistoricalAnalysis Integration Tests', () => {
	let repoDir: string;
	let gitService: GitHistoryService;
	let commit1Sha: string;
	let commit2Sha: string;

	suiteSetup(async () => {
		repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prebase-hist-test-'));
		gitService = new GitHistoryService();

		const runGit = (args: string[]) => {
			execFileSync('git', args, { cwd: repoDir, stdio: 'pipe' });
		};

		runGit(['init', '-b', 'main']);
		runGit(['config', 'user.name', 'PreBase Test']);
		runGit(['config', 'user.email', 'test@prebase.dev']);
		runGit(['config', 'commit.gpgsign', 'false']);

		// Commit 1: Basic app
		await fs.mkdir(path.join(repoDir, 'src', 'utils'), { recursive: true });
		await fs.writeFile(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'app', main: 'src/index.ts' }), 'utf8');
		await fs.writeFile(path.join(repoDir, 'src', 'index.ts'), 'import { helper } from "./utils/helper";\nexport const run = () => helper();\n', 'utf8');
		await fs.writeFile(path.join(repoDir, 'src', 'utils', 'helper.ts'), 'export const helper = () => "v1";\n', 'utf8');
		runGit(['add', '.']);
		runGit(['commit', '-m', 'Commit 1: v1 helper']);
		commit1Sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// Commit 2: Add auth and update helper
		await fs.mkdir(path.join(repoDir, 'src', 'auth'), { recursive: true });
		await fs.writeFile(path.join(repoDir, 'src', 'auth', 'authService.ts'), 'export class AuthService {}\n', 'utf8');
		await fs.writeFile(path.join(repoDir, 'src', 'utils', 'helper.ts'), 'import { AuthService } from "../auth/authService";\nexport const helper = () => new AuthService();\n', 'utf8');
		runGit(['add', '.']);
		runGit(['commit', '-m', 'Commit 2: v2 helper with auth']);
		commit2Sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, stdio: 'pipe' }).toString().trim();
	});

	suiteTeardown(async () => {
		if (repoDir) {
			await fs.rm(repoDir, { recursive: true, force: true });
		}
	});

	test('clean working tree canonical graph matches Git HEAD tree canonical graph identically', async () => {
		const analyzer = new CanonicalGraphAnalyzer();

		const workingSource = new WorkingTreeContentSource(repoDir);
		const workingGraph = await analyzer.analyze(workingSource);

		const gitHeadSource = new GitTreeContentSource(gitService, repoDir, commit2Sha);
		const gitHeadGraph = await analyzer.analyze(gitHeadSource);

		assert.ok(workingGraph);
		assert.ok(gitHeadGraph);

		assert.strictEqual(workingGraph.digest, gitHeadGraph.digest);
		assert.strictEqual(workingGraph.nodes.length, gitHeadGraph.nodes.length);
		assert.strictEqual(workingGraph.edges.length, gitHeadGraph.edges.length);

		const diff = computeCanonicalGraphDiff(workingGraph, gitHeadGraph);
		assert.strictEqual(diff.isIdentical, true);
	});

	test('analyzes historical commit 1 accurately without checkout', async () => {
		const analyzer = new CanonicalGraphAnalyzer();
		const gitCommit1Source = new GitTreeContentSource(gitService, repoDir, commit1Sha);
		const commit1Graph = await analyzer.analyze(gitCommit1Source);

		assert.ok(commit1Graph);
		// Commit 1 does NOT have authService
		const authNode = commit1Graph.nodes.find(n => n.path === 'src/auth/authService.ts');
		assert.strictEqual(authNode, undefined);

		// Commit 1 has index.ts, helper.ts, package.json
		assert.strictEqual(commit1Graph.nodes.length, 3);

		// Helper in Commit 1 does not import authService
		const helperNode = commit1Graph.nodes.find(n => n.path === 'src/utils/helper.ts');
		assert.ok(helperNode);
		assert.strictEqual(helperNode.meta?.imports?.includes('../auth/authService'), false);
	});

	test('historical analysis isolates dirty working tree edits from historical ref', async () => {
		// Create uncommitted dirty file in working tree
		const dirtyFilePath = path.join(repoDir, 'src', 'dirtyUncommitted.ts');
		await fs.writeFile(dirtyFilePath, 'export const dirty = true;\n', 'utf8');

		try {
			const analyzer = new CanonicalGraphAnalyzer();

			// Analyze commit 1 from Git
			const gitCommit1Source = new GitTreeContentSource(gitService, repoDir, commit1Sha);
			const commit1Graph = await analyzer.analyze(gitCommit1Source);

			assert.ok(commit1Graph);
			const dirtyInCommit1 = commit1Graph.nodes.find(n => n.path === 'src/dirtyUncommitted.ts');
			assert.strictEqual(dirtyInCommit1, undefined);

			// Working tree graph includes dirty file
			const workingSource = new WorkingTreeContentSource(repoDir);
			const workingGraph = await analyzer.analyze(workingSource);
			assert.ok(workingGraph);
			const dirtyInWorking = workingGraph.nodes.find(n => n.path === 'src/dirtyUncommitted.ts');
			assert.ok(dirtyInWorking);

			// Verify dirty file is still untouched on disk
			const stat = await fs.stat(dirtyFilePath);
			assert.ok(stat.isFile());
		} finally {
			// Clean up dirty file
			await fs.rm(dirtyFilePath, { force: true });
		}
	});

	test('historical diff between commit 1 and commit 2 shows exact architectural progression', async () => {
		const analyzer = new CanonicalGraphAnalyzer();

		const c1Graph = await analyzer.analyze(new GitTreeContentSource(gitService, repoDir, commit1Sha));
		const c2Graph = await analyzer.analyze(new GitTreeContentSource(gitService, repoDir, commit2Sha));

		assert.ok(c1Graph);
		assert.ok(c2Graph);

		const diff = computeCanonicalGraphDiff(c1Graph, c2Graph);
		assert.strictEqual(diff.isIdentical, false);

		// Added authService node
		assert.strictEqual(diff.addedNodes.length, 1);
		assert.strictEqual(diff.addedNodes[0].path, 'src/auth/authService.ts');

		// Updated helper node (now imports authService)
		assert.strictEqual(diff.updatedNodes.length, 1);
		assert.strictEqual(diff.updatedNodes[0].path, 'src/utils/helper.ts');

		// Added edge helper -> authService
		assert.strictEqual(diff.addedEdges.length, 1);
		assert.strictEqual(diff.addedEdges[0].target, 'file:src/auth/authService.ts');
	});
});

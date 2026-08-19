/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CanonicalGraphAnalyzer } from '../../core/canonical/canonicalGraphAnalyzer.js';
import { computeCanonicalGraphDiff } from '../../core/canonical/canonicalGraphDiff.js';
import { GitTreeContentSource } from '../../history/git/gitTreeContentSource.js';
import { NodeGitHistoryService } from '../fixtures/nodeGitHistoryService.js';

suite('GitTreeHistoricalAnalysis Integration Tests', () => {
	let tempRepoDir: string;
	let gitService: NodeGitHistoryService;
	let commit1Sha: string;
	let commit2Sha: string;

	setup(async () => {
		tempRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prebase-hist-test-'));
		execSync('git init -b main', { cwd: tempRepoDir });
		execSync('git config user.name "Test Runner"', { cwd: tempRepoDir });
		execSync('git config user.email "test@example.com"', { cwd: tempRepoDir });

		// Commit 1
		await fs.writeFile(path.join(tempRepoDir, 'package.json'), JSON.stringify({ name: 'app', main: 'src/index.ts' }));
		await fs.mkdir(path.join(tempRepoDir, 'src'), { recursive: true });
		await fs.writeFile(path.join(tempRepoDir, 'src/index.ts'), `import { serviceA } from './serviceA'; export const run = () => serviceA();`);
		await fs.writeFile(path.join(tempRepoDir, 'src/serviceA.ts'), `export function serviceA() { return 1; }`);
		execSync('git add . && git commit -m "feat: commit 1"', { cwd: tempRepoDir });
		commit1Sha = execSync('git rev-parse HEAD', { cwd: tempRepoDir }).toString('utf8').trim();

		// Commit 2: Add serviceB and import it in index
		await fs.writeFile(path.join(tempRepoDir, 'src/index.ts'), `import { serviceA } from './serviceA'; import { serviceB } from './serviceB'; export const run = () => serviceA() + serviceB();`);
		await fs.writeFile(path.join(tempRepoDir, 'src/serviceB.ts'), `export function serviceB() { return 2; }`);
		execSync('git add . && git commit -m "feat: commit 2"', { cwd: tempRepoDir });
		commit2Sha = execSync('git rev-parse HEAD', { cwd: tempRepoDir }).toString('utf8').trim();

		gitService = new NodeGitHistoryService();
	});

	teardown(async () => {
		try {
			await fs.rm(tempRepoDir, { recursive: true, force: true });
		} catch {
			// Cleanup ignore
		}
	});

	test('analyzes historical commit 1 without checkout', async () => {
		const source1 = new GitTreeContentSource(gitService, tempRepoDir, commit1Sha);
		const analyzer = new CanonicalGraphAnalyzer();
		const snapshot1 = await analyzer.analyze(source1);

		assert.ok(snapshot1);
		assert.strictEqual(snapshot1.coverage.completeWithinProfile, true);
		assert.strictEqual(snapshot1.coverage.analyzedCount, 3); // package.json, index.ts, serviceA.ts
		assert.ok(snapshot1.nodes.some(n => n.path === 'src/serviceA.ts'));
		assert.strictEqual(snapshot1.nodes.some(n => n.path === 'src/serviceB.ts'), false);
	});

	test('analyzes historical commit 2 without checkout', async () => {
		const source2 = new GitTreeContentSource(gitService, tempRepoDir, commit2Sha);
		const analyzer = new CanonicalGraphAnalyzer();
		const snapshot2 = await analyzer.analyze(source2);

		assert.ok(snapshot2);
		assert.strictEqual(snapshot2.coverage.analyzedCount, 4); // package.json, index.ts, serviceA.ts, serviceB.ts
		assert.ok(snapshot2.nodes.some(n => n.path === 'src/serviceB.ts'));
	});

	test('diffs historical snapshots 1 and 2 yielding exact structural diff', async () => {
		const analyzer = new CanonicalGraphAnalyzer();
		const snap1 = await analyzer.analyze(new GitTreeContentSource(gitService, tempRepoDir, commit1Sha));
		const snap2 = await analyzer.analyze(new GitTreeContentSource(gitService, tempRepoDir, commit2Sha));

		assert.ok(snap1);
		assert.ok(snap2);

		const diff = computeCanonicalGraphDiff(snap1, snap2);
		assert.strictEqual(diff.isIdentical, false);
		assert.strictEqual(diff.addedNodes.length, 1);
		assert.strictEqual(diff.addedNodes[0].path, 'src/serviceB.ts');
		assert.strictEqual(diff.updatedNodes.length, 1);
		assert.strictEqual(diff.updatedNodes[0].path, 'src/index.ts');
		assert.strictEqual(diff.addedEdges.length, 1);
	});

	test('dirty working tree changes do NOT contaminate historical git analysis', async () => {
		// Mutate working tree with dirty untracked and uncommitted files
		await fs.writeFile(path.join(tempRepoDir, 'src/index.ts'), `throw new Error('DIRTY WORKTREE OVERWRITE');`);
		await fs.writeFile(path.join(tempRepoDir, 'src/dirtyNewFile.ts'), `export const dirty = true;`);

		const source1 = new GitTreeContentSource(gitService, tempRepoDir, commit1Sha);
		const analyzer = new CanonicalGraphAnalyzer();
		const snapshot1 = await analyzer.analyze(source1);

		assert.ok(snapshot1);
		// snapshot1 must have the pristine historical index.ts, not the dirty working tree overwrite
		const indexNode = snapshot1.nodes.find(n => n.path === 'src/index.ts');
		assert.ok(indexNode);
		assert.strictEqual(snapshot1.nodes.some(n => n.path === 'src/dirtyNewFile.ts'), false);
		assert.ok(snapshot1.edges.some(e => e.target === 'file:src/serviceA.ts'));
	});
});

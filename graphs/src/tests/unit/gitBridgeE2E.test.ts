/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CanonicalGraphAnalyzer } from '../../core/canonical/canonicalGraphAnalyzer.js';
import { NodeCanonicalParseService } from '../../node/canonicalParseService.js';
import { computeCanonicalGraphDiff } from '../../core/canonical/canonicalGraphDiff.js';
import { CanonicalQueryIndex } from '../../core/query/canonicalQueryIndex.js';
import { projectNetworkGraph } from '../../core/projection/graphProjection.js';
import { GitTreeContentSource } from '../../history/git/gitTreeContentSource.js';
import { GitHistoryError } from '../../history/git/gitTypes.js';
import { NodeGitHistoryService } from '../fixtures/nodeGitHistoryService.js';

suite('Production Git Bridge & Real Git Fixture E2E Tests', function () {
	this.timeout(45000);
	let tempRepoDir: string;
	let gitService: NodeGitHistoryService;
	let rootCommitSha: string;
	let featureCommitSha: string;
	let mainCommitSha: string;
	let renameCommitSha: string;
	let commentOnlyCommitSha: string;
	const createAnalyzer = (): CanonicalGraphAnalyzer => new CanonicalGraphAnalyzer({ parseService: new NodeCanonicalParseService() });

	setup(async () => {
		tempRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prebase-bridge-e2e-'));
		execSync('git init -b main', { cwd: tempRepoDir });
		execSync('git config user.name "Alice Engineer"', { cwd: tempRepoDir });
		execSync('git config user.email "alice@example.com"', { cwd: tempRepoDir });

		// 1. Root Commit (multi-file)
		await fs.writeFile(path.join(tempRepoDir, 'package.json'), JSON.stringify({ name: 'prebase-fixture', main: 'src/index.ts' }));
		await fs.mkdir(path.join(tempRepoDir, 'src'), { recursive: true });
		await fs.writeFile(path.join(tempRepoDir, 'src/index.ts'), `import { core } from './core'; export const app = () => core();`);
		await fs.writeFile(path.join(tempRepoDir, 'src/core.ts'), `export function core() { return 'v1'; }`);
		execSync('git add . && git commit -m "feat: initial root commit"', { cwd: tempRepoDir });
		rootCommitSha = execSync('git rev-parse HEAD', { cwd: tempRepoDir }).toString('utf8').trim();

		// 2. Create divergent branch: feature
		execSync('git checkout -b feature', { cwd: tempRepoDir });
		await fs.writeFile(path.join(tempRepoDir, 'src/feature.ts'), `export function feature() { return true; }`);
		execSync('git add . && git commit -m "feat: add feature module"', { cwd: tempRepoDir });
		featureCommitSha = execSync('git rev-parse HEAD', { cwd: tempRepoDir }).toString('utf8').trim();

		// 3. Switch back to main and commit divergent changes
		execSync('git checkout main', { cwd: tempRepoDir });
		await fs.writeFile(path.join(tempRepoDir, 'src/mainline.ts'), `export function mainline() { return 42; }`);
		execSync('git add . && git commit -m "feat: add mainline module"', { cwd: tempRepoDir });
		mainCommitSha = execSync('git rev-parse HEAD', { cwd: tempRepoDir }).toString('utf8').trim();

		// 4. Create tags: lightweight and annotated
		execSync('git tag v1.0.0-lw', { cwd: tempRepoDir });
		execSync('git tag -a v1.0.0-annotated -m "Release version 1.0.0 annotated"', { cwd: tempRepoDir });

		// 5. Add rename commit
		await fs.mkdir(path.join(tempRepoDir, 'src/modules'), { recursive: true });
		execSync('git mv src/core.ts src/modules/core.ts', { cwd: tempRepoDir });
		await fs.writeFile(path.join(tempRepoDir, 'src/index.ts'), `import { core } from './modules/core'; export const app = () => core();`);
		execSync('git add . && git commit -m "refactor: move core into modules"', { cwd: tempRepoDir });
		renameCommitSha = execSync('git rev-parse HEAD', { cwd: tempRepoDir }).toString('utf8').trim();

		// 6. Add comment-only commit (structural invariant)
		await fs.writeFile(path.join(tempRepoDir, 'src/modules/core.ts'), `// Helpful developer documentation comment\n/* Another block comment */\nexport function core() { return 'v1'; }`);
		execSync('git add . && git commit -m "docs: add comments to core"', { cwd: tempRepoDir });
		commentOnlyCommitSha = execSync('git rev-parse HEAD', { cwd: tempRepoDir }).toString('utf8').trim();

		gitService = new NodeGitHistoryService();
	});

	teardown(async () => {
		try {
			await fs.rm(tempRepoDir, { recursive: true, force: true });
		} catch {
			// Cleanup ignore
		}
	});

	test('root commit diff with --root captures all initial files and blob OIDs', async () => {
		const diff = await gitService.diffCommitToParent(tempRepoDir, rootCommitSha);
		assert.ok(diff);
		assert.strictEqual(diff.changes.length, 3);
		assert.ok(diff.changes.every(c => c.kind === 'added'));
		assert.ok(diff.changes.every(c => typeof c.newBlobOid === 'string' && c.newBlobOid.length >= 40));
		assert.ok(diff.changes.some(c => c.path === 'package.json'));
		assert.ok(diff.changes.some(c => c.path === 'src/index.ts'));
		assert.ok(diff.changes.some(c => c.path === 'src/core.ts'));
	});

	test('divergent branches: exact tree diff vs review range (merge-base) diff', async () => {
		// Exact tree diff between feature and main
		const exactDiff = await gitService.diffCommitTrees(tempRepoDir, featureCommitSha, mainCommitSha);
		// Exact diff should show src/feature.ts deleted (or missing in main) and src/mainline.ts added
		assert.ok(exactDiff.changes.some(c => c.path === 'src/feature.ts' && c.kind === 'deleted'));
		assert.ok(exactDiff.changes.some(c => c.path === 'src/mainline.ts' && c.kind === 'added'));

		// Review range diff: base=main, head=feature (diff merge-base..feature)
		const reviewDiff = await gitService.diffReviewRange(tempRepoDir, mainCommitSha, featureCommitSha);
		// Review diff only includes feature branch additions relative to merge-base (root)
		assert.strictEqual(reviewDiff.changes.length, 1);
		assert.strictEqual(reviewDiff.changes[0].path, 'src/feature.ts');
		assert.strictEqual(reviewDiff.changes[0].kind, 'added');
	});

	test('rename tracking captures old and new paths with similarity score', async () => {
		const diff = await gitService.diffCommitToParent(tempRepoDir, renameCommitSha);
		assert.ok(diff);
		const renameChange = diff.changes.find(c => c.oldPath === 'src/core.ts');
		assert.ok(renameChange, 'Rename change should be detected');
		assert.strictEqual(renameChange.path, 'src/modules/core.ts');
		assert.strictEqual(renameChange.kind, 'renamed');
		assert.ok(typeof renameChange.similarity === 'number' && renameChange.similarity >= 50);
	});

	test('comment-only commit invariant: exact tree diff detects blob change, canonical AST is identical', async () => {
		// Exact tree diff detects modified blob
		const diff = await gitService.diffCommitToParent(tempRepoDir, commentOnlyCommitSha);
		assert.ok(diff);
		assert.strictEqual(diff.changes.length, 1);
		assert.strictEqual(diff.changes[0].path, 'src/modules/core.ts');
		assert.strictEqual(diff.changes[0].kind, 'modified');
		assert.notStrictEqual(diff.changes[0].oldBlobOid, diff.changes[0].newBlobOid);

		// Canonical graph analysis on both commits
		const analyzer = createAnalyzer();
		const prevSnapshot = await analyzer.analyze(new GitTreeContentSource(gitService, tempRepoDir, renameCommitSha));
		const currentSnapshot = await analyzer.analyze(new GitTreeContentSource(gitService, tempRepoDir, commentOnlyCommitSha));

		assert.ok(prevSnapshot);
		assert.ok(currentSnapshot);

		// Structural diff must be identical (comments stripped from AST)
		const canonicalDiff = computeCanonicalGraphDiff(prevSnapshot, currentSnapshot);
		assert.strictEqual(canonicalDiff.isIdentical, true);
		assert.strictEqual(canonicalDiff.addedNodes.length, 0);
		assert.strictEqual(canonicalDiff.removedNodeIds.length, 0);
		assert.strictEqual(canonicalDiff.updatedNodes.length, 0);
	});

	test('annotated vs lightweight tags peeling and metadata', async () => {
		const tags = await gitService.listTags(tempRepoDir);
		assert.strictEqual(tags.length, 2);

		const annotated = tags.find(t => t.name === 'v1.0.0-annotated');
		assert.ok(annotated);
		assert.strictEqual(annotated.isAnnotated, true);
		assert.strictEqual(annotated.peeledCommit, mainCommitSha);
		assert.notStrictEqual(annotated.tagCommit, mainCommitSha); // Tag object SHA != peeled commit SHA

		const lightweight = tags.find(t => t.name === 'v1.0.0-lw');
		assert.ok(lightweight);
		assert.strictEqual(lightweight.isAnnotated, false);
		assert.strictEqual(lightweight.tagCommit, mainCommitSha);
	});

	test('safely rejects option injection in refs', async () => {
		await assert.rejects(
			async () => gitService.resolveRef(tempRepoDir, '--help'),
			(err: any) => {
				assert.strictEqual(err.name, GitHistoryError.name);
				assert.strictEqual(err.code, 'UnknownRef');
				return true;
			}
		);
	});

	test('handles unborn repository gracefully without throwing or stalling', async () => {
		const unbornDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prebase-unborn-test-'));
		try {
			execSync('git init -b main', { cwd: unbornDir });
			const realUnbornDir = await fs.realpath(unbornDir);
			const identity = await gitService.getRepositoryIdentity(unbornDir);
			assert.ok(identity);
			assert.strictEqual(identity.rootPath, realUnbornDir);

			// Resolving HEAD on unborn repo throws typed UnknownRef immediately
			await assert.rejects(
				async () => gitService.getHead(unbornDir),
				(err: any) => {
					assert.strictEqual(err.code, 'UnknownRef');
					return true;
				}
			);
		} finally {
			await fs.rm(unbornDir, { recursive: true, force: true });
		}
	});

	test('Magnus node focus resolution: rendered vs canonical-only vs missing', async () => {
		// Create a large synthetic canonical graph with 300 nodes
		const nodes = Array.from({ length: 300 }, (_, i) => ({
			id: `file:src/module_${i}.ts`,
			path: `src/module_${i}.ts`,
			label: `module_${i}.ts`,
			kind: 'module' as const,
			isEntry: i === 0,
		}));
		const edges = Array.from({ length: 299 }, (_, i) => ({
			id: `edge:${i}->${i + 1}`,
			source: `file:src/module_${i}.ts`,
			target: `file:src/module_${i + 1}.ts`,
			kind: 'import' as const,
		}));

		const canonical = {
			nodes,
			edges,
			projectPath: tempRepoDir,
			projectName: 'test',
			entryNodeId: 'file:src/module_0.ts',
			analyzedAt: 1000,
			sourceIdentity: 'test',
			digest: 'test-digest',
			versions: {
				graphSchemaVersion: 1,
				analyzerVersion: 1,
				identityVersion: 1,
				layoutVersion: 1,
				analysisProfileVersion: 1,
			},
			coverage: {
				completeWithinProfile: true,
				isComplete: true,
				discoveredCount: 300,
				analyzedCount: 300,
				analyzedFileCount: 300,
				excludedCount: 0,
				excludedFileCount: 0,
				failedCount: 0,
				truncated: false,
				exclusionBreakdown: {
					'oversized-file': 0,
					'binary-file': 0,
					'unsupported-language': 0,
					'parse-error': 0,
					'permission-denied': 0,
					'ignored-pattern': 0,
					'policy-excluded': 0,
					'other': 0,
				},
				exclusionReasons: {},
			},
			completeness: {
				completeWithinProfile: true,
				isComplete: true,
				discoveredCount: 300,
				analyzedCount: 300,
				analyzedFileCount: 300,
				excludedCount: 0,
				excludedFileCount: 0,
				failedCount: 0,
				truncated: false,
				exclusionBreakdown: {
					'oversized-file': 0,
					'binary-file': 0,
					'unsupported-language': 0,
					'parse-error': 0,
					'permission-denied': 0,
					'ignored-pattern': 0,
					'policy-excluded': 0,
					'other': 0,
				},
				exclusionReasons: {},
			},
		};

		const projection = projectNetworkGraph(canonical, {
			maxRenderedNodes: 280,
			maxRenderedEdges: 420,
			hideLowImportance: true,
		});

		assert.strictEqual(projection.nodes.length, 280);
		const index = new CanonicalQueryIndex(canonical);

		// Rendered node
		const renderedNode = index.findNode('src/module_0.ts');
		assert.ok(renderedNode);
		const isRendered = projection.nodes.some(n => n.id === renderedNode.id);
		assert.strictEqual(isRendered, true);

		// Hidden canonical node (omitted from 280-node render projection)
		const hiddenNode = index.findNode('src/module_299.ts');
		assert.ok(hiddenNode);
		const isHiddenRendered = projection.nodes.some(n => n.id === hiddenNode.id);
		assert.strictEqual(isHiddenRendered, false);

		// Missing node
		const missingNode = index.findNode('src/non_existent.ts');
		assert.strictEqual(missingNode, undefined);
	});

	test('performance evidence: measures execution timings and calculates blob reuse across commit history', async function () {
		this.timeout(45000);
		// Generate a sequence of commits
		const commitShas: string[] = [rootCommitSha];
		for (let i = 1; i <= 6; i++) {
			await fs.writeFile(path.join(tempRepoDir, `src/generated_${i}.ts`), `export function gen${i}() { return ${i}; }`);
			execSync(`git add . && git commit -m "feat: generated module ${i}"`, { cwd: tempRepoDir });
			commitShas.push(execSync('git rev-parse HEAD', { cwd: tempRepoDir }).toString('utf8').trim());
		}

		const analyzer = createAnalyzer();
		const timings: { commit: string; durationMs: number; blobCount: number }[] = [];
		const seenBlobOids = new Set<string>();
		let totalBlobReferences = 0;

		const startOverall = Date.now();
		for (const sha of commitShas) {
			const source = new GitTreeContentSource(gitService, tempRepoDir, sha);
			const t0 = Date.now();
			const snap = await analyzer.analyze(source);
			const dt = Date.now() - t0;
			assert.ok(snap);

			const tree = await gitService.listTree(tempRepoDir, sha);
			for (const entry of tree.entries) {
				if (entry.blobOid) {
					seenBlobOids.add(entry.blobOid);
					totalBlobReferences++;
				}
			}

			timings.push({
				commit: sha.slice(0, 7),
				durationMs: dt,
				blobCount: tree.entries.length,
			});
		}
		const totalDuration = Date.now() - startOverall;

		// Verify average analysis time is bounded
		const avgDuration = totalDuration / commitShas.length;
		assert.ok(avgDuration < 1500, `Average commit analysis duration ${avgDuration}ms should be reasonable`);

		// Verify blob reuse calculation
		const uniqueBlobs = seenBlobOids.size;
		const blobReuseRatio = 1 - (uniqueBlobs / totalBlobReferences);
		assert.ok(blobReuseRatio > 0.4, `Blob reuse ratio ${blobReuseRatio.toFixed(3)} should reflect substantial content sharing across commits`);
	});
});

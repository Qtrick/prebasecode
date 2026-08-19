/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { suite, test } from 'mocha';
import { NodeGitHistoryService } from '../fixtures/nodeGitHistoryService.js';
import { SqliteTemporalStore } from '../../temporal/persistence/node/sqliteTemporalStore.js';
import { TemporalRepositoryRegistry } from '../../temporal/ingestion/temporalRepositoryRegistry.js';
import { TemporalCommitIngestionService } from '../../temporal/ingestion/temporalCommitIngestionService.js';
import { TemporalGraphService } from '../../temporal/host/temporalGraphService.js';
import { IncrementalGraphAnalyzer } from '../../temporal/analysis/incrementalGraphAnalyzer.js';
import { TemporalReconstructionEngine } from '../../temporal/core/temporalReconstruction.js';
import { TemporalIndexPlanner } from '../../temporal/core/temporalIndexPlanner.js';

function isSha256Supported(): boolean {
	try {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-sha256-probe-'));
		execSync('git init --object-format=sha256', { cwd: tempDir, stdio: 'pipe' });
		fs.rmSync(tempDir, { recursive: true, force: true });
		return true;
	} catch {
		return false;
	}
}

function createE2ERepo(objectFormat: 'sha1' | 'sha256' = 'sha1'): { repoDir: string; tempBase: string; dbPath: string } {
	const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-temporal-e2e-'));
	const repoDir = path.join(tempBase, 'repo');
	const dbPath = path.join(tempBase, 'temporal.db');
	fs.mkdirSync(repoDir, { recursive: true });

	const formatFlag = objectFormat === 'sha256' ? '--object-format=sha256' : '';
	execSync(`git init ${formatFlag}`, { cwd: repoDir, stdio: 'pipe' });
	execSync('git config user.name "PreBase Tester"', { cwd: repoDir, stdio: 'pipe' });
	execSync('git config user.email "tester@prebase.io"', { cwd: repoDir, stdio: 'pipe' });

	return { repoDir, tempBase, dbPath };
}

suite('Temporal Graph E2E Ingestion & Reconstruction', () => {
	test('Ingests linear commits, renames, and verifies deterministic reconstruction (SHA-1)', async () => {
		const { repoDir, tempBase, dbPath } = createE2ERepo('sha1');

		try {
			const gitService = new NodeGitHistoryService();
			const registry = new TemporalRepositoryRegistry(async () => new SqliteTemporalStore({ dbPath }));
			const analyzer = new IncrementalGraphAnalyzer();
			const reconstructionEngine = new TemporalReconstructionEngine();
			const indexPlanner = new TemporalIndexPlanner({ checkpointInterval: 2 });
			const ingestionService = new TemporalCommitIngestionService(gitService, registry, analyzer, reconstructionEngine, indexPlanner);
			const temporalService = new TemporalGraphService(gitService, registry, ingestionService);

			// 1. Commit 1: Create src/main.ts and src/util.ts
			fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
			fs.writeFileSync(path.join(repoDir, 'src/main.ts'), 'import { helper } from "./util";\nexport const main = 1;', 'utf8');
			fs.writeFileSync(path.join(repoDir, 'src/util.ts'), 'export const helper = () => "hello";', 'utf8');
			execSync('git add . && git commit -m "feat: initial commit"', { cwd: repoDir, stdio: 'pipe' });
			const c1 = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

			// Check status before ingestion
			const statusBefore = await temporalService.getCommitIndexStatus(repoDir, c1);
			assert.strictEqual(statusBefore, 'not-indexed');

			// Ingest Commit 1 via ensureCommitIndexed
			const snap1 = await temporalService.ensureCommitIndexed(repoDir, c1);
			assert.strictEqual(snap1.commitSha, c1);
			assert.strictEqual(snap1.entityMap.size, 2);
			assert.strictEqual(snap1.edgeMap.size, 1);

			// Check status after ingestion
			const statusAfter = await temporalService.getCommitIndexStatus(repoDir, c1);
			assert.strictEqual(statusAfter, 'ready');

			// 2. Commit 2: Modify src/util.ts and add src/config.ts
			fs.writeFileSync(path.join(repoDir, 'src/util.ts'), 'export const helper = () => "hello world!";\nexport const version = 2;', 'utf8');
			fs.writeFileSync(path.join(repoDir, 'src/config.ts'), 'export const config = { debug: true };', 'utf8');
			execSync('git add . && git commit -m "feat: add config and update util"', { cwd: repoDir, stdio: 'pipe' });
			const c2 = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

			// Ingest Commit 2
			const snap2 = await temporalService.ingestCommit(repoDir, c2);
			assert.strictEqual(snap2.commitSha, c2);
			assert.strictEqual(snap2.entityMap.size, 3);

			// 3. Commit 3: Rename src/util.ts -> src/utils.ts
			execSync('git mv src/util.ts src/utils.ts', { cwd: repoDir, stdio: 'pipe' });
			fs.writeFileSync(path.join(repoDir, 'src/main.ts'), 'import { helper } from "./utils";\nexport const main = 1;', 'utf8');
			execSync('git add . && git commit -m "refactor: rename util to utils"', { cwd: repoDir, stdio: 'pipe' });
			const c3 = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

			// Ingest Commit 3
			const snap3 = await temporalService.ingestCommit(repoDir, c3);
			assert.strictEqual(snap3.commitSha, c3);
			assert.strictEqual(snap3.entityMap.size, 3);
			assert.ok(snap3.pathToEntityId.has('src/utils.ts'));

			// Verify Reconstructed Graph at Commit 1, 2, 3
			const reconstructed1 = await temporalService.getGraphAtCommit(repoDir, c1);
			assert.strictEqual(reconstructed1.commitSha, c1);
			assert.strictEqual(reconstructed1.entityMap.size, 2);

			const reconstructed2 = await temporalService.getGraphAtCommit(repoDir, c2);
			assert.strictEqual(reconstructed2.commitSha, c2);
			assert.strictEqual(reconstructed2.entityMap.size, 3);

			const reconstructed3 = await temporalService.getGraphAtCommit(repoDir, c3);
			assert.strictEqual(reconstructed3.commitSha, c3);
			assert.strictEqual(reconstructed3.entityMap.size, 3);

			// Verify Entity Lineage of renamed file
			const utilEntityId = snap1.pathToEntityId.get('src/util.ts')!;
			const utilHistory = await temporalService.getEntityHistory(repoDir, utilEntityId);
			assert.strictEqual(utilHistory.length, 3);
			assert.strictEqual(utilHistory[0].path, 'src/util.ts');
			assert.strictEqual(utilHistory[2].path, 'src/utils.ts'); // preserved ID through rename!

			const lineageEvents = await temporalService.getEntityLineageEvents(repoDir, utilEntityId);
			const renameEvent = lineageEvents.find(e => e.lineageCase === 'git-rename' || e.lineageCase === 'git-rename-edit');
			assert.ok(renameEvent);
			assert.strictEqual(renameEvent.evidence.oldPath, 'src/util.ts');
			assert.strictEqual(renameEvent.evidence.newPath, 'src/utils.ts');

			await registry.closeAll();

			// 4. Test Persistence Restart: open new registry on same dbPath and verify instant reconstruction without re-ingesting
			const restartRegistry = new TemporalRepositoryRegistry(async () => new SqliteTemporalStore({ dbPath }));
			const restartIngestion = new TemporalCommitIngestionService(gitService, restartRegistry);
			const restartTemporalService = new TemporalGraphService(gitService, restartRegistry, restartIngestion);

			const restartedSnap3 = await restartTemporalService.getGraphAtCommit(repoDir, c3);
			assert.strictEqual(restartedSnap3.commitSha, c3);
			assert.strictEqual(restartedSnap3.entityMap.size, 3);

			await restartRegistry.closeAll();
		} finally {
			try {
				fs.rmSync(tempBase, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	test('Handles branch merge commits and preserves multi-parent DAG relations', async () => {
		const { repoDir, tempBase, dbPath } = createE2ERepo('sha1');

		try {
			const gitService = new NodeGitHistoryService();
			const registry = new TemporalRepositoryRegistry(async () => new SqliteTemporalStore({ dbPath }));
			const analyzer = new IncrementalGraphAnalyzer();
			const ingestionService = new TemporalCommitIngestionService(gitService, registry, analyzer);
			const temporalService = new TemporalGraphService(gitService, registry, ingestionService);

			// Root commit on main
			fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
			fs.writeFileSync(path.join(repoDir, 'src/base.ts'), 'export const base = 1;', 'utf8');
			execSync('git add . && git commit -m "feat: root"', { cwd: repoDir, stdio: 'pipe' });
			const cRoot = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
			await temporalService.ingestCommit(repoDir, cRoot);

			// Create feature branch
			execSync('git checkout -b feature', { cwd: repoDir, stdio: 'pipe' });
			fs.writeFileSync(path.join(repoDir, 'src/feature.ts'), 'export const feature = 2;', 'utf8');
			execSync('git add . && git commit -m "feat: add feature"', { cwd: repoDir, stdio: 'pipe' });
			const cFeature = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
			await temporalService.ingestCommit(repoDir, cFeature);

			// Back to main, commit a change
			execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
			fs.writeFileSync(path.join(repoDir, 'src/mainExtra.ts'), 'export const mainExtra = 3;', 'utf8');
			execSync('git add . && git commit -m "feat: main extra"', { cwd: repoDir, stdio: 'pipe' });
			const cMain = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
			await temporalService.ingestCommit(repoDir, cMain);

			// Merge feature branch into main
			execSync('git merge feature -m "merge: feature into main"', { cwd: repoDir, stdio: 'pipe' });
			const cMerge = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
			const mergeSnap = await temporalService.ingestCommit(repoDir, cMerge);

			assert.strictEqual(mergeSnap.commitSha, cMerge);
			assert.strictEqual(mergeSnap.entityMap.size, 3); // base.ts, feature.ts, mainExtra.ts

			const store = await registry.getStore('repo', repoDir);
			const parents = await store.getCommitParents(cMerge);
			assert.strictEqual(parents.length, 2);
			assert.strictEqual(parents[0], cMain);
			assert.strictEqual(parents[1], cFeature);

			await registry.closeAll();
		} finally {
			try {
				fs.rmSync(tempBase, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	test('Ingests commits in a SHA-256 repository', async function () {
		if (!isSha256Supported()) {
			this.skip();
		}

		const { repoDir, tempBase, dbPath } = createE2ERepo('sha256');

		try {
			const gitService = new NodeGitHistoryService();
			const registry = new TemporalRepositoryRegistry(async () => new SqliteTemporalStore({ dbPath }));
			const analyzer = new IncrementalGraphAnalyzer();
			const reconstructionEngine = new TemporalReconstructionEngine();
			const indexPlanner = new TemporalIndexPlanner();
			const ingestionService = new TemporalCommitIngestionService(gitService, registry, analyzer, reconstructionEngine, indexPlanner);
			const temporalService = new TemporalGraphService(gitService, registry, ingestionService);

			fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
			fs.writeFileSync(path.join(repoDir, 'src/index.ts'), 'export const sha256 = true;', 'utf8');
			execSync('git add . && git commit -m "feat: sha256 init"', { cwd: repoDir, stdio: 'pipe' });
			const c1 = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

			assert.strictEqual(c1.length, 64); // 64 hex characters for SHA-256

			const snap = await temporalService.ingestCommit(repoDir, c1);
			assert.strictEqual(snap.commitSha, c1);
			assert.strictEqual(snap.entityMap.size, 1);

			await registry.closeAll();
		} finally {
			try {
				fs.rmSync(tempBase, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});
});

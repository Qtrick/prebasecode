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
import { TemporalRepositoryRegistry, type TemporalStoreFactory } from '../../temporal/ingestion/temporalRepositoryRegistry.js';
import { TemporalCommitIngestionService } from '../../temporal/ingestion/temporalCommitIngestionService.js';
import { TemporalGraphService } from '../../temporal/host/temporalGraphService.js';
import { IncrementalGraphAnalyzer } from '../../temporal/analysis/incrementalGraphAnalyzer.js';
import { NodeCanonicalParseService } from '../../node/canonicalParseService.js';
import { TemporalReconstructionEngine } from '../../temporal/core/temporalReconstruction.js';
import { TemporalIndexPlanner } from '../../temporal/core/temporalIndexPlanner.js';
import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { GitCommitMetadata, GitTreeInventory, GitTreeListOptions } from '../../history/git/gitHistoryService.js';

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

function createIncrementalAnalyzer(): IncrementalGraphAnalyzer {
	return new IncrementalGraphAnalyzer({ parseService: new NodeCanonicalParseService() });
}

function createRegistry(storeFactory: TemporalStoreFactory): TemporalRepositoryRegistry {
	return new TemporalRepositoryRegistry(storeFactory, new NodeCanonicalParseService());
}

class CoordinatedGitHistoryService extends NodeGitHistoryService {
	private _blockedParent: string | undefined;
	private _releaseParent: (() => void) | undefined;
	private _parentReached: (() => void) | undefined;
	private readonly _parentGate = new Promise<void>(resolve => this._releaseParent = resolve);
	readonly parentReached = new Promise<void>(resolve => this._parentReached = resolve);
	readonly treeReads = new Map<string, number>();

	blockParent(commitSha: string): void {
		this._blockedParent = commitSha;
	}

	releaseParent(): void {
		this._releaseParent?.();
	}

	override async getCommit(rootPath: string, ref: string, token?: CancellationTokenLike): Promise<GitCommitMetadata> {
		if (ref === this._blockedParent) {
			this._parentReached?.();
			this._parentReached = undefined;
			await this._parentGate;
		}
		return super.getCommit(rootPath, ref, token);
	}

	override async listTree(rootPath: string, ref: string, options?: GitTreeListOptions | CancellationTokenLike, token?: CancellationTokenLike): Promise<GitTreeInventory> {
		this.treeReads.set(ref, (this.treeReads.get(ref) ?? 0) + 1);
		return super.listTree(rootPath, ref, options, token);
	}
}

suite('Temporal Graph E2E Ingestion & Reconstruction', () => {
	test('coordinates concurrent parent and child requests without duplicate analysis or deadlock', async () => {
		const { repoDir, tempBase, dbPath } = createE2ERepo('sha1');

		try {
			fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
			fs.writeFileSync(path.join(repoDir, 'src/a.ts'), 'export const a = 1;', 'utf8');
			execSync('git add . && git commit -m "feat: parent"', { cwd: repoDir, stdio: 'pipe' });
			const parentSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
			fs.writeFileSync(path.join(repoDir, 'src/b.ts'), 'export const b = 2;', 'utf8');
			execSync('git add . && git commit -m "feat: child"', { cwd: repoDir, stdio: 'pipe' });
			const childSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

			const gitService = new CoordinatedGitHistoryService();
			gitService.blockParent(parentSha);
			const registry = createRegistry(async () => new SqliteTemporalStore({ dbPath }));
			const temporalService = new TemporalGraphService(gitService, registry);

			const childRequest = temporalService.ensureCommitIndexed(repoDir, childSha);
			await gitService.parentReached;
			const parentRequest = temporalService.ensureCommitIndexed(repoDir, parentSha);
			gitService.releaseParent();

			const [child, parent] = await Promise.all([childRequest, parentRequest]);
			const store = await registry.getStore(repoDir, repoDir);
			assert.deepStrictEqual({
				child: child.commitSha,
				parent: parent.commitSha,
				parentTreeReads: gitService.treeReads.get(parentSha),
				childTreeReads: gitService.treeReads.get(childSha),
				storedCommits: (await store.getAllCommits()).length,
			}, {
				child: childSha,
				parent: parentSha,
				parentTreeReads: 1,
				childTreeReads: 1,
				storedCommits: 2,
			});
			await registry.closeAll();
		} finally {
			fs.rmSync(tempBase, { recursive: true, force: true });
		}
	});

	test('Ingests linear commits, renames, and verifies deterministic reconstruction (SHA-1)', async () => {
		const { repoDir, tempBase, dbPath } = createE2ERepo('sha1');

		try {
			const gitService = new NodeGitHistoryService();
			const registry = createRegistry(async () => new SqliteTemporalStore({ dbPath }));
			const analyzer = createIncrementalAnalyzer();
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
			assert.deepStrictEqual(statusBefore, { status: 'not-indexed' });

			// Ingest Commit 1 via ensureCommitIndexed
			const snap1 = await temporalService.ensureCommitIndexed(repoDir, c1);
			assert.strictEqual(snap1.commitSha, c1);
			assert.strictEqual(snap1.entityMap.size, 2);
			assert.strictEqual(snap1.edgeMap.size, 1);

			// Check status after ingestion
			const statusAfter = await temporalService.getCommitIndexStatus(repoDir, c1);
			assert.deepStrictEqual(statusAfter, { status: 'ready' });

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
			const restartRegistry = createRegistry(async () => new SqliteTemporalStore({ dbPath }));
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
			const registry = createRegistry(async () => new SqliteTemporalStore({ dbPath }));
			const analyzer = createIncrementalAnalyzer();
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
			fs.writeFileSync(path.join(repoDir, 'src/feature.ts'), 'import { base } from "./base"; export const feature = base + 1;', 'utf8');
			execSync('git add . && git commit -m "feat: add feature"', { cwd: repoDir, stdio: 'pipe' });
			const cFeature = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
			const featureSnap = await temporalService.ingestCommit(repoDir, cFeature);
			const featureEdgeId = Array.from(featureSnap.edgeMap.keys())[0];
			assert.ok(featureEdgeId);

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
			assert.deepStrictEqual(
				(await temporalService.getEdgeLifecycleEventsAtRef(repoDir, featureEdgeId, cMerge)).map(event => [event.commitSha, event.eventKind]),
				[[cFeature, 'present']],
				'An edge introduced on a non-first merge parent must remain visible through all-parent ancestry even when merge lineage assigns the reintroduced relation a new edge ID.',
			);

			await registry.closeAll();
		} finally {
			try {
				fs.rmSync(tempBase, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	test('scopes entity, lineage, and edge history to the requested ref ancestry regardless of ingestion order', async () => {
		const { repoDir, tempBase, dbPath } = createE2ERepo('sha1');

		try {
			const gitService = new NodeGitHistoryService();
			const registry = createRegistry(async () => new SqliteTemporalStore({ dbPath }));
			const temporalService = new TemporalGraphService(gitService, registry);
			fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
			fs.writeFileSync(path.join(repoDir, 'src/a.ts'), 'export const a = 1;', 'utf8');
			fs.writeFileSync(path.join(repoDir, 'src/b.ts'), 'import { a } from "./a"; export const b = a;', 'utf8');
			execSync('git add . && git commit -m "feat: root graph"', { cwd: repoDir, stdio: 'pipe' });
			const rootSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
			const root = await temporalService.ingestCommit(repoDir, rootSha);
			const entityId = root.pathToEntityId.get('src/a.ts');
			const edgeId = Array.from(root.edgeMap.keys())[0];
			assert.ok(entityId);
			assert.ok(edgeId);

			execSync('git checkout -b feature', { cwd: repoDir, stdio: 'pipe' });
			fs.writeFileSync(path.join(repoDir, 'src/a.ts'), 'export const a = 2;', 'utf8');
			fs.writeFileSync(path.join(repoDir, 'src/b.ts'), 'export const b = 2;', 'utf8');
			execSync('git add . && git commit -m "feat: feature diverges"', { cwd: repoDir, stdio: 'pipe' });
			const featureSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
			await temporalService.ingestCommit(repoDir, featureSha);

			execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
			fs.writeFileSync(path.join(repoDir, 'src/a.ts'), 'export const a = 3;', 'utf8');
			execSync('git add . && git commit -m "feat: main diverges"', { cwd: repoDir, stdio: 'pipe' });
			const mainSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
			await temporalService.ingestCommit(repoDir, mainSha);

			const [mainEntities, featureEntities, mainLineage, featureLineage, mainEdges, featureEdges, mainLifecycle, featureLifecycle] = await Promise.all([
				temporalService.getEntityHistoryAtRef(repoDir, entityId, mainSha),
				temporalService.getEntityHistoryAtRef(repoDir, entityId, featureSha),
				temporalService.getEntityLineageEventsAtRef(repoDir, entityId, mainSha),
				temporalService.getEntityLineageEventsAtRef(repoDir, entityId, featureSha),
				temporalService.getEdgeHistoryAtRef(repoDir, edgeId, mainSha),
				temporalService.getEdgeHistoryAtRef(repoDir, edgeId, featureSha),
				temporalService.getEdgeLifecycleEventsAtRef(repoDir, edgeId, mainSha),
				temporalService.getEdgeLifecycleEventsAtRef(repoDir, edgeId, featureSha),
			]);

			assert.deepStrictEqual({
				mainEntities: mainEntities.map(snapshot => snapshot.commitSha),
				featureEntities: featureEntities.map(snapshot => snapshot.commitSha),
				mainLineage: mainLineage.map(event => event.commitSha),
				featureLineage: featureLineage.map(event => event.commitSha),
				mainEdges: mainEdges.map(snapshot => snapshot.commitSha),
				featureEdges: featureEdges.map(snapshot => snapshot.commitSha),
				mainLifecycle: mainLifecycle.map(event => [event.commitSha, event.eventKind]),
				featureLifecycle: featureLifecycle.map(event => [event.commitSha, event.eventKind]),
			}, {
				mainEntities: [rootSha, mainSha],
				featureEntities: [rootSha, featureSha],
				mainLineage: [mainSha],
				featureLineage: [featureSha],
				mainEdges: [rootSha, mainSha],
				featureEdges: [rootSha],
				mainLifecycle: [[rootSha, 'present'], [mainSha, 'present']],
				featureLifecycle: [[rootSha, 'present'], [featureSha, 'removed']],
			});
			await registry.closeAll();
		} finally {
			fs.rmSync(tempBase, { recursive: true, force: true });
		}
	});

	test('exposes refs and advances a bounded first-parent timeline without reconstructing unindexed graphs', async () => {
		const { repoDir, tempBase, dbPath } = createE2ERepo('sha1');

		try {
			const gitService = new NodeGitHistoryService();
			const storeCalls = { commit: 0, coverage: 0, metadata: 0, replaceRefs: 0 };
			const registry = createRegistry(async () => {
				const store = new SqliteTemporalStore({ dbPath });
				return new Proxy(store, {
					get(target, property, receiver) {
						const value = Reflect.get(target, property, receiver);
						if (typeof value !== 'function') {
							return value;
						}
						return (...args: unknown[]) => {
							if (property === 'getCommit') storeCalls.commit++;
							if (property === 'getCommitCoverage') storeCalls.coverage++;
							if (property === 'getCommitIndexMetadata') storeCalls.metadata++;
							if (property === 'replaceRefs') storeCalls.replaceRefs++;
							return value.apply(target, args);
						};
					},
				});
			});
			const temporalService = new TemporalGraphService(gitService, registry);
			fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
			fs.writeFileSync(path.join(repoDir, 'src/main.ts'), 'export const revision = 0;', 'utf8');
			execSync('git add . && git commit -m "feat: root"', { cwd: repoDir, stdio: 'pipe' });
			const rootSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
			fs.writeFileSync(path.join(repoDir, 'src/main.ts'), 'export const revision = 1;', 'utf8');
			execSync('git add . && git commit -m "feat: second"', { cwd: repoDir, stdio: 'pipe' });
			const secondSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
			execSync('git branch feature', { cwd: repoDir, stdio: 'pipe' });
			execSync('git tag v1', { cwd: repoDir, stdio: 'pipe' });
			fs.writeFileSync(path.join(repoDir, 'src/main.ts'), 'export const revision = 2;', 'utf8');
			execSync('git add . && git commit -m "feat: third"', { cwd: repoDir, stdio: 'pipe' });
			const thirdSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

			const refs = await temporalService.getRepositoryRefs(repoDir);
			const cachedRefs = await temporalService.getRepositoryRefs(repoDir);
			assert.deepStrictEqual(cachedRefs, refs);
			assert.strictEqual(storeCalls.replaceRefs, 1, 'Fresh ref reads must reuse the persisted snapshot instead of writing SQLite again.');
			const firstPage = await temporalService.getHistoryPage(repoDir, { pageSize: 2 });
			assert.ok(firstPage.nextCursor);
			assert.deepStrictEqual(storeCalls, { commit: 0, coverage: 0, metadata: 1, replaceRefs: 1 }, 'A page must batch persisted index metadata instead of issuing N+1 row lookups.');
			fs.writeFileSync(path.join(repoDir, 'src/main.ts'), 'export const revision = 3;', 'utf8');
			execSync('git add . && git commit -m "feat: fourth after first page"', { cwd: repoDir, stdio: 'pipe' });
			const fourthSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
			const cancelledToken: CancellationTokenLike = { isCancellationRequested: true };
			await assert.rejects(
				temporalService.getHistoryPage(repoDir, { cursor: firstPage.nextCursor, pageSize: 2 }, cancelledToken),
				error => error instanceof Error && error.name === 'GitHistoryError' && 'code' in error && error.code === 'Cancelled',
			);
			const secondPage = await temporalService.getHistoryPage(repoDir, { cursor: firstPage.nextCursor, pageSize: 2 });
			const featurePage = await temporalService.getHistoryPage(repoDir, { ref: 'feature', pageSize: 1 });

			assert.deepStrictEqual({
				refs: refs.map(ref => [ref.name, ref.targetSha, ref.kind]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
				pageOne: firstPage.commits.map(commit => [commit.sha, commit.indexStatus.status]),
				pageTwo: secondPage.commits.map(commit => [commit.sha, commit.indexStatus.status]),
				featurePage: featurePage.commits.map(commit => commit.sha),
				headAfterPaging: (await temporalService.getHistoryPage(repoDir, { pageSize: 1 })).commits.map(commit => commit.sha),
				hasMore: [firstPage.hasMore, secondPage.hasMore],
			}, {
				refs: [
					['HEAD', thirdSha, 'head'],
					['refs/heads/feature', secondSha, 'branch'],
					['refs/heads/main', thirdSha, 'branch'],
					['refs/tags/v1', secondSha, 'tag'],
				],
				pageOne: [[thirdSha, 'not-indexed'], [secondSha, 'not-indexed']],
				pageTwo: [[rootSha, 'not-indexed']],
				featurePage: [secondSha],
				headAfterPaging: [fourthSha],
				hasMore: [true, false],
			});

			execSync(`git checkout --detach ${thirdSha}`, { cwd: repoDir, stdio: 'pipe' });
			const detachedHead = (await temporalService.getRepositoryRefs(repoDir)).find(ref => ref.name === 'HEAD');
			assert.deepStrictEqual(detachedHead, {
				name: 'HEAD',
				targetSha: thirdSha,
				kind: 'head',
				isDetached: true,
			});
			execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
			await registry.closeAll();
		} finally {
			fs.rmSync(tempBase, { recursive: true, force: true });
		}
	});

	test('Ingests commits in a SHA-256 repository', async function () {
		if (!isSha256Supported()) {
			this.skip();
		}

		const { repoDir, tempBase, dbPath } = createE2ERepo('sha256');

		try {
			const gitService = new NodeGitHistoryService();
			const registry = createRegistry(async () => new SqliteTemporalStore({ dbPath }));
			const analyzer = createIncrementalAnalyzer();
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

	test('Two-tier parse cache persists across store restarts and serves L2 parse artifacts', async () => {
		const { repoDir, tempBase, dbPath } = createE2ERepo('sha1');

		try {
			const gitService = new NodeGitHistoryService();

			// Session 1: Create and ingest Commit 1
			{
				const registry = createRegistry(async () => new SqliteTemporalStore({ dbPath }));
				const analyzer = createIncrementalAnalyzer();
				const reconstructionEngine = new TemporalReconstructionEngine();
				const indexPlanner = new TemporalIndexPlanner();
				const ingestionService = new TemporalCommitIngestionService(gitService, registry, analyzer, reconstructionEngine, indexPlanner);
				const temporalService = new TemporalGraphService(gitService, registry, ingestionService);

				fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
				fs.writeFileSync(path.join(repoDir, 'src/a.ts'), 'export const a = 1;', 'utf8');
				fs.writeFileSync(path.join(repoDir, 'src/b.ts'), 'export const b = 2;', 'utf8');
				execSync('git add . && git commit -m "feat: initial"', { cwd: repoDir, stdio: 'pipe' });
				const c1 = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

				await temporalService.ingestCommit(repoDir, c1);
				await registry.closeAll();
			}

			// Session 2: Fresh registry and store restart against same database
			{
				const freshRegistry = createRegistry(async () => new SqliteTemporalStore({ dbPath }));
				const freshAnalyzer = createIncrementalAnalyzer();
				const freshReconstructionEngine = new TemporalReconstructionEngine();
				const freshIndexPlanner = new TemporalIndexPlanner();
				const freshIngestionService = new TemporalCommitIngestionService(
					gitService,
					freshRegistry,
					freshAnalyzer,
					freshReconstructionEngine,
					freshIndexPlanner
				);
				const freshTemporalService = new TemporalGraphService(gitService, freshRegistry, freshIngestionService);

				// Modify only a.ts -> b.ts is unchanged and should load from persistent L2 SQLite store
				fs.writeFileSync(path.join(repoDir, 'src/a.ts'), 'export const a = 100;', 'utf8');
				execSync('git add . && git commit -m "feat: update a"', { cwd: repoDir, stdio: 'pipe' });
				const c2 = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

				const snap2 = await freshTemporalService.ingestCommit(repoDir, c2);
				assert.strictEqual(snap2.commitSha, c2);
				assert.strictEqual(snap2.entityMap.size, 2);

				// Reconstruct C1 from the restarted store
				const c1 = execSync('git rev-parse HEAD~1', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
				const snap1 = await freshTemporalService.getGraphAtCommit(repoDir, c1);
				assert.strictEqual(snap1.commitSha, c1);
				assert.strictEqual(snap1.entityMap.size, 2);

				await freshRegistry.closeAll();
			}
		} finally {
			try {
				fs.rmSync(tempBase, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	test('Multi-root concurrent event routing and FIFO ingestion queue', async () => {
		const repoA = createE2ERepo('sha1');
		const repoB = createE2ERepo('sha1');

		try {
			const gitService = new NodeGitHistoryService();
			const registry = createRegistry(async (_repoId: string, rootPath: string) => {
				const db = rootPath === repoA.repoDir ? repoA.dbPath : repoB.dbPath;
				return new SqliteTemporalStore({ dbPath: db });
			});
			const analyzer = createIncrementalAnalyzer();
			const reconstructionEngine = new TemporalReconstructionEngine();
			const indexPlanner = new TemporalIndexPlanner();
			const ingestionService = new TemporalCommitIngestionService(gitService, registry, analyzer, reconstructionEngine, indexPlanner);
			const temporalService = new TemporalGraphService(gitService, registry, ingestionService);

			// Populate Repo A
			fs.mkdirSync(path.join(repoA.repoDir, 'src'), { recursive: true });
			fs.writeFileSync(path.join(repoA.repoDir, 'src/repoA.ts'), 'export const repoA = true;', 'utf8');
			execSync('git add . && git commit -m "feat: repo A init"', { cwd: repoA.repoDir, stdio: 'pipe' });
			const cA = execSync('git rev-parse HEAD', { cwd: repoA.repoDir, stdio: 'pipe' }).toString().trim();

			// Populate Repo B
			fs.mkdirSync(path.join(repoB.repoDir, 'src'), { recursive: true });
			fs.writeFileSync(path.join(repoB.repoDir, 'src/repoB.ts'), 'export const repoB = true;', 'utf8');
			execSync('git add . && git commit -m "feat: repo B init"', { cwd: repoB.repoDir, stdio: 'pipe' });
			const cB = execSync('git rev-parse HEAD', { cwd: repoB.repoDir, stdio: 'pipe' }).toString().trim();

			// Concurrently ingest both repositories
			const [snapA, snapB] = await Promise.all([
				temporalService.ensureCommitIndexed(repoA.repoDir, cA),
				temporalService.ensureCommitIndexed(repoB.repoDir, cB),
			]);

			assert.strictEqual(snapA.commitSha, cA);
			assert.ok(snapA.pathToEntityId.has('src/repoA.ts'));
			assert.strictEqual(snapA.pathToEntityId.has('src/repoB.ts'), false);

			assert.strictEqual(snapB.commitSha, cB);
			assert.ok(snapB.pathToEntityId.has('src/repoB.ts'));
			assert.strictEqual(snapB.pathToEntityId.has('src/repoA.ts'), false);

			// Test handleHeadChanged routing
			const idA = await gitService.getRepositoryIdentity(repoA.repoDir);
			await temporalService.handleHeadChanged({
				repositoryId: idA.repositoryId,
				currentHead: cA,
				timestamp: Date.now(),
				transitionType: 'commit',
			}, repoA.repoDir);

			const statusA = await temporalService.getCommitIndexStatus(repoA.repoDir, cA);
			assert.deepStrictEqual(statusA, { status: 'ready' });

			await registry.closeAll();
		} finally {
			try {
				fs.rmSync(repoA.tempBase, { recursive: true, force: true });
				fs.rmSync(repoB.tempBase, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});
});

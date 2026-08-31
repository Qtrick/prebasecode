/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { suite, test, afterEach } from 'mocha';
import { URI } from '../../../../../../base/common/uri.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { NodeGitHistoryService } from '../fixtures/nodeGitHistoryService.js';
import { SqliteTemporalStore } from '../../temporal/persistence/node/sqliteTemporalStore.js';
import { TemporalRepositoryRegistry } from '../../temporal/ingestion/temporalRepositoryRegistry.js';
import { NodeCanonicalParseService } from '../../node/canonicalParseService.js';
import { TemporalGraphService } from '../../temporal/host/temporalGraphService.js';
import { WorkbenchTemporalViewService } from '../../host/workbench/temporal/workbenchTemporalViewService.js';

suite('Temporal Service E2E Tests (Phase 3.5)', () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// best effort cleanup
			}
		}
		tempDirs.length = 0;
	});

	function createTempGitRepo(prefix = 'prebase-temporal-e2e'): { repoDir: string; dbPath: string } {
		const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-repo-`));
		const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-db-`));
		tempDirs.push(repoDir, dbDir);

		const dbPath = path.join(dbDir, 'temporal.db');

		execSync('git init -b main', { cwd: repoDir, stdio: 'pipe' });
		execSync('git config user.name "PreBase Tester"', { cwd: repoDir, stdio: 'pipe' });
		execSync('git config user.email "tester@prebase.io"', { cwd: repoDir, stdio: 'pipe' });

		return { repoDir, dbPath };
	}

	test('Full Phase 3.5 Lifecycle: DAG, Bounded Navigation, Relative Stepping, Renamed+Modified, Pinned Compare & Zero-byte Empty Tree', async () => {
		const { repoDir, dbPath } = createTempGitRepo();

		// Commit 1 (Root): Add initial files
		fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
		fs.writeFileSync(path.join(repoDir, 'src/math.ts'), 'export function add(a: number, b: number): number { return a + b; }\n', 'utf8');
		fs.writeFileSync(path.join(repoDir, 'src/app.ts'), 'import { add } from "./math.js";\nexport const result = add(1, 2);\n', 'utf8');
		execSync('git add . && git commit -m "feat: initial commit with math and app"', { cwd: repoDir, stdio: 'pipe' });
		const c1Sha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// Commit 2: Pure rename math.ts -> calc.ts (identical content)
		execSync('git mv src/math.ts src/calc.ts', { cwd: repoDir, stdio: 'pipe' });
		fs.writeFileSync(path.join(repoDir, 'src/app.ts'), 'import { add } from "./calc.js";\nexport const result = add(1, 2);\n', 'utf8');
		execSync('git add . && git commit -m "refactor: pure rename math to calc"', { cwd: repoDir, stdio: 'pipe' });
		const c2Sha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// Commit 3: Branch feature-service from c2, add service.ts
		execSync('git checkout -b feature-service', { cwd: repoDir, stdio: 'pipe' });
		fs.writeFileSync(path.join(repoDir, 'src/service.ts'), 'export class WorkerService { run() { return "ok"; } }\n', 'utf8');
		execSync('git add . && git commit -m "feat(service): add worker service"', { cwd: repoDir, stdio: 'pipe' });
		const c3Sha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// Commit 4: Switch back to main, modify calc.ts with new multiply function
		execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
		fs.writeFileSync(path.join(repoDir, 'src/calc.ts'), 'export function add(a: number, b: number): number { return a + b; }\nexport function multiply(a: number, b: number): number { return a * b; }\n', 'utf8');
		execSync('git add . && git commit -m "feat(calc): add multiply function"', { cwd: repoDir, stdio: 'pipe' });
		const c4Sha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// Commit 5: Merge feature-service into main (2 parents: c4 and c3)
		execSync('git merge --no-ff feature-service -m "merge: merge feature-service into main"', { cwd: repoDir, stdio: 'pipe' });
		const c5Sha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// Commit 6: Delete app.ts
		fs.rmSync(path.join(repoDir, 'src/app.ts'));
		execSync('git add . && git commit -m "chore: remove deprecated app.ts"', { cwd: repoDir, stdio: 'pipe' });
		const c6Sha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

		// Initialize real Git history service, SQLite store, and TemporalGraphService
		const repoUri = URI.file(repoDir);
		const gitHistoryService = new NodeGitHistoryService();
		// WorkbenchTemporalViewService checks for the optional getRepositories() method
		// (only present on WorkbenchGitHistoryService in production). Wire it so the
		// service can discover the temp repo and proceed past the early-exit guard.
		(gitHistoryService as any).getRepositories = () => [{ rootUri: repoUri }];
		const parseService = new NodeCanonicalParseService();
		const registry = new TemporalRepositoryRegistry(async () => new SqliteTemporalStore({ dbPath }), parseService);
		const temporalGraphService = new TemporalGraphService(gitHistoryService as any, registry as any);

		// Setup Workbench workspace and service
		const mockWorkspaceService = {
			getWorkspace: () => ({
				folders: [{ uri: repoUri, name: path.basename(repoDir), index: 0, toResource: (rel: string) => URI.joinPath(repoUri, rel) }]
			}),
			onDidChangeWorkspaceFolders: new Emitter<any>().event,
		};

		const executedCommands: { command: string; args: any[] }[] = [];
		const mockCommandService = {
			executeCommand: async (command: string, ...args: any[]) => {
				executedCommands.push({ command, args });
				return undefined;
			},
		};

		const openedEditors: any[] = [];
		const mockEditorService = {
			openEditor: async (editor: any) => {
				openedEditors.push(editor);
				return undefined;
			},
		};

		const mockLogService = {
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {},
			trace: () => {},
		};

		let persistedData: string | undefined;
		const mockStorageService = {
			get: () => persistedData,
			store: (_k: string, v: string) => { persistedData = v; },
			remove: () => { persistedData = undefined; },
		};

		const viewService = new WorkbenchTemporalViewService(
			mockWorkspaceService as any,
			gitHistoryService as any,
			temporalGraphService as any,
			mockCommandService as any,
			mockEditorService as any,
			mockLogService as any,
			mockStorageService as any,
		);

		await viewService.initialize();

		// Verification Step 1: Initial HEAD selection at c6
		const stateAtHead = viewService.getState();
		assert.equal(stateAtHead.selectedCommitSha, c6Sha);
		assert.equal(stateAtHead.renderedCommitSha, c6Sha);
		assert.equal(stateAtHead.isLoadingSelection, false);
		assert.equal(stateAtHead.compareBaseSha, c5Sha, 'First parent of c6 must be c5');
		assert.ok(stateAtHead.diff, 'Structural diff must be computed');
		assert.equal(stateAtHead.diff?.summary.removedCount, 1, 'app.ts removed in c6');
		assert.ok(stateAtHead.timelineWindow, 'Timeline window must be populated');
		assert.equal(stateAtHead.timelineWindow?.start, 0);

		// Verification Step 2: Source diff on removed node creates zero-byte empty tree URI on right
		const removedNode = stateAtHead.diff?.nodes.find(n => n.path === 'src/app.ts');
		assert.ok(removedNode);
		await viewService.openSourceDiff(removedNode.entityId);
		assert.equal(executedCommands.length, 1);
		const [diffBaseUri, diffTargetUri] = executedCommands[0].args;
		const emptyTreeOid = await gitHistoryService.getEmptyTree(repoDir);
		assert.equal(JSON.parse(diffBaseUri.query).ref, c5Sha);
		assert.equal(JSON.parse(diffTargetUri.query).ref, emptyTreeOid, 'Removed file target side must be exact empty tree OID');

		// Verification Step 3: Pure rename verification at commit 2
		await viewService.selectCommit(c2Sha, { immediate: true });
		const stateAtC2 = viewService.getState();
		assert.equal(stateAtC2.selectedCommitSha, c2Sha);
		assert.equal(stateAtC2.renderedCommitSha, c2Sha);
		assert.ok(stateAtC2.diff);
		assert.equal(stateAtC2.diff.summary.renamedCount, 1, 'math.ts was renamed to calc.ts');
		assert.equal(stateAtC2.diff.summary.modifiedCount, 1, 'app.ts import changed');
		const renamedNode = stateAtC2.diff.nodes.find(n => n.path === 'src/calc.ts');
		assert.ok(renamedNode);
		assert.equal(renamedNode.changeKind, 'renamed');

		// Verification Step 4: Step navigation (delta -1 goes older, delta +1 goes newer)
		await viewService.stepCommit(-1); // from c2 towards older commit (c1, index 4)
		assert.equal(viewService.getState().selectedCommitSha, c1Sha);

		await viewService.stepCommit(1); // from c1 towards newer commit (c2, index 3)
		assert.equal(viewService.getState().selectedCommitSha, c2Sha);

		// Verification Step 5: Global Index Selection
		await viewService.selectCommitIndex(0, { immediate: true }); // HEAD (c6)
		assert.equal(viewService.getState().selectedCommitSha, c6Sha);

		// Verification Step 6: Merge commit comparison (c5 vs Parent 1 vs Parent 2)
		await viewService.selectCommit(c5Sha, { immediate: true });
		assert.equal(viewService.getState().compareBaseSha, c4Sha, 'Default base for merge commit is Parent 1 (c4)');

		// Switch compare base to Parent 2 (c3)
		await viewService.setCompareBase(c3Sha);
		const stateAtC5VsP2 = viewService.getState();
		assert.equal(stateAtC5VsP2.compareBaseSha, c3Sha);
		assert.equal(stateAtC5VsP2.comparisonMode, 'explicit-parent');
		assert.ok(stateAtC5VsP2.diff);

		// Verification Step 7: Arbitrary pinned comparison (c6 against root c1)
		await viewService.selectCommit(c6Sha, { immediate: true });
		await viewService.setCompareBase(c1Sha);
		const stateArbitrary = viewService.getState();
		assert.equal(stateArbitrary.comparisonMode, 'pinned');
		assert.equal(stateArbitrary.compareBaseSha, c1Sha);
		assert.ok(stateArbitrary.diff);

		// Verification Step 8: Mode toggle and state invariant
		viewService.setDisplayMode('state');
		assert.equal(viewService.getState().displayMode, 'state');

		viewService.dispose();
		await registry.dispose();
	});
});

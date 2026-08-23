/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { URI } from '../../../../../../base/common/uri.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { WorkbenchTemporalViewService } from '../../host/workbench/temporal/workbenchTemporalViewService.js';
import type { TemporalEntitySnapshot, TemporalEdgeSnapshot, TemporalHistoryPage, TemporalCommitSummary, TemporalRepositoryRef } from '../../temporal/common/temporalTypes.js';

suite('WorkbenchTemporalViewService (Unit - Phase 3.4 Hardening)', () => {
	const workspaceFolderUri = URI.parse('file:///mock/repo');
	const workspaceFolder = {
		uri: workspaceFolderUri,
		name: 'mock-repo',
		index: 0,
		toResource: (rel: string) => URI.joinPath(workspaceFolderUri, rel),
	};

	const mockWorkspaceService = {
		getWorkspace: () => ({ folders: [workspaceFolder] }),
		onDidChangeWorkspaceFolders: new Emitter<any>().event,
	} as any;

	function makeCommitSummary(sha: string, message: string, timestamp: number, parents: string[], _isCheckpoint = false): TemporalCommitSummary {
		return {
			sha,
			parents,
			authorName: 'Dev',
			authorEmail: 'dev@prebase.io',
			authorTimestamp: timestamp,
			committerTimestamp: timestamp,
			message,
			indexStatus: { status: 'ready' },
		};
	}

	function makeEntity(entityId: string, path: string, canonicalId: string, meta?: any): TemporalEntitySnapshot {
		return {
			entityId,
			commitSha: 'commit-test',
			path,
			nodeData: {
				id: canonicalId,
				kind: 'file',
				label: path.split('/').pop() || path,
				path,
				meta: meta || {},
			} as any,
		};
	}

	function createMockTemporalGraphService(
		historyPages: Record<string, TemporalHistoryPage>,
		entitiesByCommit: Record<string, TemporalEntitySnapshot[]>,
		edgesByCommit: Record<string, TemporalEdgeSnapshot[]> = {},
		refs: TemporalRepositoryRef[] = []
	) {
		const indexingSequence: string[] = [];
		let entityQueryCount = 0;

		return {
			get entityQueryCount() { return entityQueryCount; },
			get indexingSequence() { return indexingSequence; },
			getRepositoryRefs: async (_root: string): Promise<TemporalRepositoryRef[]> => {
				return refs;
			},
			getHistoryPage: async (_root: string, options?: any): Promise<TemporalHistoryPage> => {
				if (options?.cursor) {
					return historyPages[options.cursor] || { commits: [], hasMore: false };
				}
				const ref = options?.ref || 'HEAD';
				return historyPages[ref] || { commits: [], hasMore: false };
			},
			getCommitIndexStatus: async (_root: string, _sha: string) => {
				return { status: 'ready' as const, lineageCoverage: { kind: 'complete' as const } };
			},
			getGraphAtCommit: async (_root: string, sha: string) => {
				indexingSequence.push(`get:${sha}`);
				entityQueryCount++;
				const entities = entitiesByCommit[sha] || [];
				const edges = edgesByCommit[sha] || [];
				const entityMap = new Map<string, TemporalEntitySnapshot>();
				for (const e of entities) {
					entityMap.set(e.entityId, e);
				}
				const edgeMap = new Map<string, TemporalEdgeSnapshot>();
				for (const ed of edges) {
					edgeMap.set(ed.edgeId, ed);
				}
				return {
					commitSha: sha,
					timestamp: Date.now(),
					isCheckpoint: false,
					entityMap,
					edgeMap,
					pathToEntityId: new Map(),
					graphData: { nodes: [], edges: [], timestamp: Date.now() },
					schemaVersion: 1,
					analyzerVersion: 1,
					profileVersion: 1,
				};
			},
			ensureCommitIndexed: async (_root: string, sha: string) => {
				indexingSequence.push(`ensure:${sha}`);
				entityQueryCount++;
				const entities = entitiesByCommit[sha] || [];
				const edges = edgesByCommit[sha] || [];
				const entityMap = new Map<string, TemporalEntitySnapshot>();
				for (const e of entities) {
					entityMap.set(e.entityId, e);
				}
				const edgeMap = new Map<string, TemporalEdgeSnapshot>();
				for (const ed of edges) {
					edgeMap.set(ed.edgeId, ed);
				}
				return {
					commitSha: sha,
					timestamp: Date.now(),
					isCheckpoint: false,
					entityMap,
					edgeMap,
					pathToEntityId: new Map(),
					graphData: { nodes: [], edges: [], timestamp: Date.now() },
					schemaVersion: 1,
					analyzerVersion: 1,
					profileVersion: 1,
				};
			},
		};
	}

	function createMockGitHistoryService() {
		const onDidChangeHeadEmitter = new Emitter<any>();
		return {
			getRepositories: () => [{ rootUri: workspaceFolderUri }],
			getRepositoryIdentity: async () => ({ repositoryId: 'repo-mock-123' }),
			getEmptyTree: async () => '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
			onDidChangeHead: onDidChangeHeadEmitter.event,
			emitHeadChanged: (currentHead: string) => onDidChangeHeadEmitter.fire({ currentHead, repositoryId: 'repo-mock-123', timestamp: Date.now() }),
		};
	}

	function createMockCommandService() {
		const executedCommands: { command: string; args: any[] }[] = [];
		return {
			get executedCommands() { return executedCommands; },
			executeCommand: async (command: string, ...args: any[]) => {
				executedCommands.push({ command, args });
				return undefined;
			},
		};
	}

	function createMockEditorService() {
		const openedEditors: any[] = [];
		return {
			get openedEditors() { return openedEditors; },
			openEditor: async (editor: any) => {
				openedEditors.push(editor);
				return undefined;
			},
		};
	}

	const mockLogService = {
		error: () => {},
		warn: () => {},
		info: () => {},
		trace: () => {},
		debug: () => {},
	} as any;

	const mockStorageService = {
		get: () => undefined,
		store: () => {},
		remove: () => {},
	} as any;

	test('1. selectRef loads paged commit timeline, positions nodes, and selects HEAD', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-3', 'feat: add C', 300, ['commit-2']),
				makeCommitSummary('commit-2', 'feat: add B', 200, ['commit-1']),
				makeCommitSummary('commit-1', 'feat: add A', 100, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-3': [
				makeEntity('ent-1', 'src/a.ts', 'can-1'),
				makeEntity('ent-2', 'src/b.ts', 'can-2'),
				makeEntity('ent-3', 'src/c.ts', 'can-3'),
			],
			'commit-2': [
				makeEntity('ent-1', 'src/a.ts', 'can-1'),
				makeEntity('ent-2', 'src/b.ts', 'can-2'),
			],
			'commit-1': [
				makeEntity('ent-1', 'src/a.ts', 'can-1'),
			],
		};

		const temporalGraphService = createMockTemporalGraphService({ HEAD: history }, entities);
		const gitHistoryService = createMockGitHistoryService();
		const commandService = createMockCommandService();
		const editorService = createMockEditorService();

		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			gitHistoryService as any,
			temporalGraphService as any,
			commandService as any,
			editorService as any,
			mockLogService,
			mockStorageService,
		);

		await service.initialize();

		const state = service.getState();
		assert.equal(state.selectedRef, 'HEAD');
		assert.equal(state.selectedCommitSha, 'commit-3');
		assert.equal(state.renderedCommitSha, 'commit-3');
		assert.equal(state.compareBaseSha, 'commit-2');
		assert.equal(state.loadedCommitCount, 3);
		assert.equal(state.pagedTimeline.length, 3);
		assert.equal(state.diff?.summary.addedCount, 1); // src/c.ts added relative to commit-2
		assert.equal(state.diff?.nodes.length, 3);

		service.dispose();
	});

	test('2. Scrubbing with debouncing: rapid selectCommit coalesces and updates selection state', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-3', 'feat: add C', 300, ['commit-2']),
				makeCommitSummary('commit-2', 'feat: add B', 200, ['commit-1']),
				makeCommitSummary('commit-1', 'feat: add A', 100, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-3': [makeEntity('ent-1', 'src/a.ts', 'can-1'), makeEntity('ent-2', 'src/b.ts', 'can-2'), makeEntity('ent-3', 'src/c.ts', 'can-3')],
			'commit-2': [makeEntity('ent-1', 'src/a.ts', 'can-1'), makeEntity('ent-2', 'src/b.ts', 'can-2')],
			'commit-1': [makeEntity('ent-1', 'src/a.ts', 'can-1')],
		};

		const temporalGraphService = createMockTemporalGraphService({ HEAD: history }, entities);
		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			createMockGitHistoryService() as any,
			temporalGraphService as any,
			createMockCommandService() as any,
			createMockEditorService() as any,
			mockLogService,
			mockStorageService,
		);

		await service.initialize();
		assert.equal(service.getState().selectedCommitSha, 'commit-3');

		// Rapid scrubs without immediate flag
		void service.selectCommit('commit-2');
		void service.selectCommit('commit-1');

		// Selection state reflects latest immediately
		assert.equal(service.getState().selectedCommitSha, 'commit-1');
		assert.equal(service.getState().isLoadingSelection, true);

		// Wait for debounce timer (120ms)
		await new Promise(r => setTimeout(r, 160));

		assert.equal(service.getState().selectedCommitSha, 'commit-1');
		assert.equal(service.getState().renderedCommitSha, 'commit-1');
		assert.equal(service.getState().isLoadingSelection, false);
		assert.equal(service.getState().diff?.summary.addedCount, 1);

		service.dispose();
	});

	test('3. Base-before-target indexing ordering & LRU diff cache', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-2', 'feat: add B', 200, ['commit-1']),
				makeCommitSummary('commit-1', 'feat: add A', 100, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-2': [makeEntity('ent-1', 'src/a.ts', 'can-1'), makeEntity('ent-2', 'src/b.ts', 'can-2')],
			'commit-1': [makeEntity('ent-1', 'src/a.ts', 'can-1')],
		};

		const temporalGraphService = createMockTemporalGraphService({ HEAD: history }, entities);
		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			createMockGitHistoryService() as any,
			temporalGraphService as any,
			createMockCommandService() as any,
			createMockEditorService() as any,
			mockLogService,
			mockStorageService,
		);

		await service.initialize();

		// Check that base (commit-1) was fetched before target (commit-2)
		const seq = temporalGraphService.indexingSequence;
		const baseIdx = seq.indexOf('get:commit-1');
		const targetIdx = seq.indexOf('get:commit-2');
		assert.ok(baseIdx >= 0, 'Base commit was indexed');
		assert.ok(targetIdx >= 0, 'Target commit was indexed');
		assert.ok(baseIdx < targetIdx, 'Base commit MUST be indexed before target commit for delta reconciliation');

		// Re-selecting commit-2 should hit the LRU diff cache
		const initialCount = temporalGraphService.entityQueryCount;
		await service.selectCommit('commit-2', { immediate: true });
		assert.equal(temporalGraphService.entityQueryCount, initialCount, 'Cache hit must not re-query graph service');

		service.dispose();
	});

	test('4. openSourceDiff operates on rendered diff commit SHAs with getEmptyTree', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-2', 'feat: add B and remove A', 200, ['commit-1']),
				makeCommitSummary('commit-1', 'feat: add A', 100, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-2': [
				makeEntity('ent-2', 'src/b.ts', 'can-2'), // added
				makeEntity('ent-3', 'src/mod.ts', 'can-mod-v2'), // modified
			],
			'commit-1': [
				makeEntity('ent-1', 'src/a.ts', 'can-1'), // removed
				makeEntity('ent-3', 'src/mod.ts', 'can-mod-v1'),
			],
		};

		const temporalGraphService = createMockTemporalGraphService({ HEAD: history }, entities);
		const commandService = createMockCommandService();
		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			createMockGitHistoryService() as any,
			temporalGraphService as any,
			commandService as any,
			createMockEditorService() as any,
			mockLogService,
			mockStorageService,
		);

		await service.initialize();

		// 1. Added file (src/b.ts) -> base should be empty tree git URI
		const addRes = await service.openSourceDiff('ent-2');
		assert.equal(addRes.ok, true);
		const addCall = commandService.executedCommands.find(c => c.command === 'vscode.diff');
		assert.ok(addCall, 'vscode.diff was executed');
		const [baseUri, targetUri] = addCall.args;
		assert.equal(baseUri.scheme, 'git');
		assert.equal(JSON.parse(baseUri.query).ref, '4b825dc642cb6eb9a060e54bf8d69288fbee4904', 'Added file left side must be empty tree git ref');
		assert.equal(targetUri.scheme, 'git');
		assert.equal(JSON.parse(targetUri.query).ref, 'commit-2', 'Added file right side must be target commit ref');

		// 2. Removed file (src/a.ts) -> target should be empty tree git URI
		const remRes = await service.openSourceDiff('ent-1');
		assert.equal(remRes.ok, true);
		const remCall = commandService.executedCommands[commandService.executedCommands.length - 1];
		const [remBaseUri, remTargetUri] = remCall.args;
		assert.equal(remBaseUri.scheme, 'git');
		assert.equal(JSON.parse(remBaseUri.query).ref, 'commit-1', 'Removed file left side must be base commit ref');
		assert.equal(remTargetUri.scheme, 'git');
		assert.equal(JSON.parse(remTargetUri.query).ref, '4b825dc642cb6eb9a060e54bf8d69288fbee4904', 'Removed file right side must be empty tree git ref');

		service.dispose();
	});

	test('5. openHistoricalFile opens revision at rendered commit via EditorService', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-2', 'feat: update', 200, ['commit-1']),
				makeCommitSummary('commit-1', 'feat: initial', 100, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-2': [makeEntity('ent-1', 'src/a.ts', 'can-1')],
			'commit-1': [makeEntity('ent-1', 'src/a.ts', 'can-1'), makeEntity('ent-del', 'src/deleted.ts', 'can-del')],
		};

		const temporalGraphService = createMockTemporalGraphService({ HEAD: history }, entities);
		const editorService = createMockEditorService();
		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			createMockGitHistoryService() as any,
			temporalGraphService as any,
			createMockCommandService() as any,
			editorService as any,
			mockLogService,
			mockStorageService,
		);

		await service.initialize();

		// Open normal surviving node -> target commit ref
		const histRes1 = await service.openHistoricalFile('ent-1');
		assert.equal(histRes1.ok, true);
		assert.equal(editorService.openedEditors.length, 1);
		const openedUri1 = editorService.openedEditors[0].resource;
		assert.equal(openedUri1.scheme, 'git');
		assert.equal(JSON.parse(openedUri1.query).ref, 'commit-2');

		// Open removed node -> base commit ref
		const histRes2 = await service.openHistoricalFile('ent-del');
		assert.equal(histRes2.ok, true);
		assert.equal(editorService.openedEditors.length, 2);
		const openedUri2 = editorService.openedEditors[1].resource;
		assert.equal(openedUri2.scheme, 'git');
		assert.equal(JSON.parse(openedUri2.query).ref, 'commit-1');

		service.dispose();
	});

	test('6. Multi-repository ownership, untrusted path rejection, and reset on switchRepository', async () => {
		const repo1Uri = URI.parse('file:///mock/repo1');
		const repo2Uri = URI.parse('file:///mock/repo2');

		const gitHistoryService = {
			getRepositories: () => [
				{ rootUri: repo1Uri },
				{ rootUri: repo2Uri },
			],
			getRepositoryIdentity: async (root: string) => ({
				repositoryId: root.includes('repo2') ? 'repo-2' : 'repo-1',
			}),
			getEmptyTree: async () => '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
			onDidChangeHead: new Emitter<any>().event,
		};

		const history1: TemporalHistoryPage = {
			commits: [makeCommitSummary('c1-head', 'repo1 commit', 100, [])],
			hasMore: false,
		};
		const history2: TemporalHistoryPage = {
			commits: [makeCommitSummary('c2-head', 'repo2 commit', 200, [])],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'c1-head': [makeEntity('ent-1', 'src/a.ts', 'can-1')],
			'c2-head': [makeEntity('ent-2', 'src/b.ts', 'can-2')],
		};

		const temporalGraphService = {
			getRepositoryRefs: async () => [],
			getHistoryPage: async (root: string) => {
				return root.includes('repo2') ? history2 : history1;
			},
			getCommitIndexStatus: async () => ({ status: 'ready' as const, lineageCoverage: { kind: 'complete' as const } }),
			getGraphAtCommit: async (_root: string, sha: string) => ({
				commitSha: sha,
				timestamp: Date.now(),
				isCheckpoint: false,
				entityMap: new Map((entities[sha] || []).map(e => [e.entityId, e])),
				edgeMap: new Map(),
				pathToEntityId: new Map(),
				graphData: { nodes: [], edges: [], timestamp: Date.now() },
				schemaVersion: 1,
				analyzerVersion: 1,
				profileVersion: 1,
			}),
			ensureCommitIndexed: async (_root: string, sha: string) => ({
				commitSha: sha,
				timestamp: Date.now(),
				isCheckpoint: false,
				entityMap: new Map((entities[sha] || []).map(e => [e.entityId, e])),
				edgeMap: new Map(),
				pathToEntityId: new Map(),
				graphData: { nodes: [], edges: [], timestamp: Date.now() },
				schemaVersion: 1,
				analyzerVersion: 1,
				profileVersion: 1,
			}),
		};

		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			gitHistoryService as any,
			temporalGraphService as any,
			createMockCommandService() as any,
			createMockEditorService() as any,
			mockLogService,
			mockStorageService,
		);

		await service.initialize();
		assert.equal(service.getState().activeRepositoryRoot, repo1Uri.fsPath || repo1Uri.path);
		assert.equal(service.getState().selectedCommitSha, 'c1-head');

		// Security: Attempt to switch to an untrusted path outside discovered repositories
		await service.switchRepository('/etc/shadow');
		assert.equal(service.getState().activeRepositoryRoot, repo1Uri.fsPath || repo1Uri.path, 'Untrusted repository root MUST be rejected');

		// Valid switch to Repo 2
		await service.switchRepository(repo2Uri.fsPath || repo2Uri.path);
		assert.equal(service.getState().activeRepositoryRoot, repo2Uri.fsPath || repo2Uri.path);
		assert.equal(service.getState().selectedCommitSha, 'c2-head');
		assert.equal(service.getState().renderedCommitSha, 'c2-head');
		assert.equal(service.getState().comparisonMode, 'first-parent');

		service.dispose();
	});

	test('7. Comparison State Machine: first-parent dynamic scrubbing, explicit-parent, pinned, and reset', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-merge', 'Merge branch', 400, ['commit-c', 'commit-b2']),
				makeCommitSummary('commit-c', 'feat: C', 300, ['commit-b']),
				makeCommitSummary('commit-b', 'feat: B', 200, ['commit-a']),
				makeCommitSummary('commit-b2', 'feat: B2 branch', 250, ['commit-a']),
				makeCommitSummary('commit-a', 'feat: initial', 100, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-merge': [makeEntity('ent-a', 'src/a.ts', 'can-a'), makeEntity('ent-b', 'src/b.ts', 'can-b'), makeEntity('ent-b2', 'src/b2.ts', 'can-b2'), makeEntity('ent-c', 'src/c.ts', 'can-c')],
			'commit-c': [makeEntity('ent-a', 'src/a.ts', 'can-a'), makeEntity('ent-b', 'src/b.ts', 'can-b'), makeEntity('ent-c', 'src/c.ts', 'can-c')],
			'commit-b': [makeEntity('ent-a', 'src/a.ts', 'can-a'), makeEntity('ent-b', 'src/b.ts', 'can-b')],
			'commit-b2': [makeEntity('ent-a', 'src/a.ts', 'can-a'), makeEntity('ent-b2', 'src/b2.ts', 'can-b2')],
			'commit-a': [makeEntity('ent-a', 'src/a.ts', 'can-a')],
		};

		const temporalGraphService = createMockTemporalGraphService({ HEAD: history }, entities);
		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			createMockGitHistoryService() as any,
			temporalGraphService as any,
			createMockCommandService() as any,
			createMockEditorService() as any,
			mockLogService,
			mockStorageService,
		);

		await service.initialize();

		// Initial state on merge commit: default is first-parent (commit-c)
		assert.equal(service.getState().selectedCommitSha, 'commit-merge');
		assert.equal(service.getState().comparisonMode, 'first-parent');
		assert.equal(service.getState().compareBaseSha, 'commit-c');

		// 1. Dynamic first-parent scrubbing: scrubbing from merge -> commit-c updates base to commit-b without pinning
		await service.selectCommit('commit-c', { immediate: true });
		assert.equal(service.getState().selectedCommitSha, 'commit-c');
		assert.equal(service.getState().comparisonMode, 'first-parent');
		assert.equal(service.getState().compareBaseSha, 'commit-b', 'Scrubbing dynamically derives first parent');

		// 2. Explicit second parent on merge commit
		await service.selectCommit('commit-merge', { immediate: true });
		await service.setCompareBase({ mode: 'parent', parentIndex: 1 });
		assert.equal(service.getState().comparisonMode, 'explicit-parent');
		assert.equal(service.getState().compareBaseSha, 'commit-b2');

		// 3. Scrubbing away from merge commit with explicit-parent resets back to first-parent
		await service.selectCommit('commit-c', { immediate: true });
		assert.equal(service.getState().comparisonMode, 'first-parent');
		assert.equal(service.getState().compareBaseSha, 'commit-b');

		// 4. Pinning a base commit (e.g. commit-a)
		await service.setCompareBase({ mode: 'pinned', baseSha: 'commit-a' });
		assert.equal(service.getState().comparisonMode, 'pinned');
		assert.equal(service.getState().compareBaseSha, 'commit-a');

		// Scrubbing from commit-c -> commit-b preserves pinned base commit-a
		await service.selectCommit('commit-b', { immediate: true });
		assert.equal(service.getState().comparisonMode, 'pinned');
		assert.equal(service.getState().compareBaseSha, 'commit-a');

		// 5. Resetting comparison base to undefined recomputes first-parent of target commit-b (commit-a)
		await service.setCompareBase(undefined);
		assert.equal(service.getState().comparisonMode, 'first-parent');
		assert.equal(service.getState().compareBaseSha, 'commit-a');

		service.dispose();
	});

	test('8. Async History Cancellation and Error Resilience', async () => {
		let throwOnRef = false;
		const history: TemporalHistoryPage = {
			commits: [makeCommitSummary('c-1', 'initial', 100, [])],
			hasMore: false,
		};

		const temporalGraphService = {
			getRepositoryRefs: async () => [],
			getHistoryPage: async (_root: string, options: any) => {
				if (throwOnRef && options?.ref === 'bad-branch') {
					throw new Error('Ref bad-branch not found in repository');
				}
				return history;
			},
			getCommitIndexStatus: async () => ({ status: 'ready' as const, lineageCoverage: { kind: 'complete' as const } }),
			getGraphAtCommit: async (_root: string, sha: string) => ({
				commitSha: sha,
				timestamp: Date.now(),
				isCheckpoint: false,
				entityMap: new Map(),
				edgeMap: new Map(),
				pathToEntityId: new Map(),
				graphData: { nodes: [], edges: [], timestamp: Date.now() },
				schemaVersion: 1,
				analyzerVersion: 1,
				profileVersion: 1,
			}),
			ensureCommitIndexed: async (_root: string, sha: string) => ({
				commitSha: sha,
				timestamp: Date.now(),
				isCheckpoint: false,
				entityMap: new Map(),
				edgeMap: new Map(),
				pathToEntityId: new Map(),
				graphData: { nodes: [], edges: [], timestamp: Date.now() },
				schemaVersion: 1,
				analyzerVersion: 1,
				profileVersion: 1,
			}),
		};

		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			createMockGitHistoryService() as any,
			temporalGraphService as any,
			createMockCommandService() as any,
			createMockEditorService() as any,
			mockLogService,
			mockStorageService,
		);

		await service.initialize();
		assert.equal(service.getState().selectedRef, 'HEAD');
		assert.equal(service.getState().historyError, undefined);

		// Now attempt to select a non-existent ref
		throwOnRef = true;
		await service.selectRef('bad-branch');

		// selectedRef must NOT be relabeled to bad-branch when history failed
		assert.equal(service.getState().selectedRef, 'HEAD');
		assert.ok(service.getState().historyError?.includes('not found'));
		assert.equal(service.getState().isLoadingHistory, false);

		service.dispose();
	});

	test('selectCommitIndex and stepCommit: host-owned bounded navigation', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('c-3', 'third', 300, ['c-2']),
				makeCommitSummary('c-2', 'second', 200, ['c-1']),
				makeCommitSummary('c-1', 'initial', 100, []),
			],
			hasMore: false,
		};

		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			createMockGitHistoryService() as any,
			createMockTemporalGraphService({ HEAD: history }, {}, {}) as any,
			createMockCommandService() as any,
			createMockEditorService() as any,
			mockLogService,
			mockStorageService,
		);

		await service.initialize();
		assert.equal(service.getState().selectedCommitSha, 'c-3');
		assert.equal(service.getState().selectedCommitIndex, 0);

		// Step older (+1 delta in stepCommit moves newer towards HEAD index 0, -1 moves older towards higher index)
		await service.stepCommit(-1);
		assert.equal(service.getState().selectedCommitSha, 'c-2');
		assert.equal(service.getState().selectedCommitIndex, 1);

		await service.stepCommit(-1);
		assert.equal(service.getState().selectedCommitSha, 'c-1');
		assert.equal(service.getState().selectedCommitIndex, 2);

		// Step newer
		await service.stepCommit(1);
		assert.equal(service.getState().selectedCommitSha, 'c-2');
		assert.equal(service.getState().selectedCommitIndex, 1);

		// Direct index jump
		await service.selectCommitIndex(0, { immediate: true });
		assert.equal(service.getState().selectedCommitSha, 'c-3');
		assert.equal(service.getState().selectedCommitIndex, 0);

		service.dispose();
	});

	test('Non-Git workspace: availableRepositories only discovers genuine Git repositories', async () => {
		const nonGitGitHistoryService = {
			getRepositories: () => [],
			getRepositoryIdentity: async () => undefined,
			getEmptyTree: async () => '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
			onDidChangeHead: new Emitter<any>().event,
		};

		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			nonGitGitHistoryService as any,
			createMockTemporalGraphService({}, {}, {}) as any,
			createMockCommandService() as any,
			createMockEditorService() as any,
			mockLogService,
			mockStorageService,
		);

		await service.initialize();
		assert.equal(service.getState().availableRepositories.length, 0);
		assert.equal(service.getState().historyError, 'No Git repository available in workspace');

		service.dispose();
	});
});

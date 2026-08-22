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

suite('WorkbenchTemporalViewService (Unit - Phase 3.1 & 3.2)', () => {
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
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
		trace: () => {},
	} as any;

	test('1. selectRef loads paged commit timeline, positions nodes, and selects HEAD', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-3', 'third', 3000, ['commit-2']),
				makeCommitSummary('commit-2', 'second', 2000, ['commit-1']),
				makeCommitSummary('commit-1', 'initial', 1000, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-3': [makeEntity('ent-1', 'src/a.ts', 'can-1'), makeEntity('ent-2', 'src/b.ts', 'can-2')],
			'commit-2': [makeEntity('ent-1', 'src/a.ts', 'can-1')],
			'commit-1': [makeEntity('ent-1', 'src/a.ts', 'can-1')],
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
		);

		await service.initialize();

		const state = service.getState();
		assert.equal(state.selectedRef, 'HEAD');
		assert.equal(state.selectedCommitSha, 'commit-3');
		assert.equal(state.renderedCommitSha, 'commit-3');
		assert.equal(state.isLoadingSelection, false);
		assert.equal(state.compareBaseSha, 'commit-2');
		assert.equal(state.pagedTimeline.length, 3);
		assert.equal(state.diff?.nodes.length, 2);
		assert.equal(state.diff?.summary.addedCount, 1);

		service.dispose();
	});

	test('2. Scrubbing with debouncing: rapid selectCommit coalesces and updates selection state', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-3', 'third', 3000, ['commit-2']),
				makeCommitSummary('commit-2', 'second', 2000, ['commit-1']),
				makeCommitSummary('commit-1', 'initial', 1000, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-3': [makeEntity('ent-1', 'src/a.ts', 'can-1')],
			'commit-2': [makeEntity('ent-1', 'src/a.ts', 'can-1')],
			'commit-1': [makeEntity('ent-1', 'src/a.ts', 'can-1')],
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
		);

		await service.initialize();

		// Rapid scrubs without immediate flag
		service.selectCommit('commit-2');
		assert.equal(service.getState().selectedCommitSha, 'commit-2');
		assert.equal(service.getState().isLoadingSelection, true);

		service.selectCommit('commit-1');
		assert.equal(service.getState().selectedCommitSha, 'commit-1');
		assert.equal(service.getState().isLoadingSelection, true);

		// Wait for scrub debounce timer to fire
		await new Promise(r => setTimeout(r, 160));

		assert.equal(service.getState().selectedCommitSha, 'commit-1');
		assert.equal(service.getState().renderedCommitSha, 'commit-1');
		assert.equal(service.getState().isLoadingSelection, false);

		service.dispose();
	});

	test('3. Base-before-target indexing ordering & LRU diff cache', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-target', 'feature', 2000, ['commit-base']),
				makeCommitSummary('commit-base', 'base', 1000, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-target': [makeEntity('ent-1', 'src/a.ts', 'can-1'), makeEntity('ent-2', 'src/b.ts', 'can-2')],
			'commit-base': [makeEntity('ent-1', 'src/a.ts', 'can-1')],
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
		);

		await service.initialize();

		// Check indexing order: base was queried before target!
		const seq = temporalGraphService.indexingSequence;
		const baseIdx = seq.indexOf('get:commit-base');
		const targetIdx = seq.indexOf('get:commit-target');
		assert.ok(baseIdx !== -1 && targetIdx !== -1);
		assert.ok(baseIdx < targetIdx, `Base commit must be indexed before target commit (base=${baseIdx}, target=${targetIdx})`);

		// Selecting same commit again should hit LRU cache without re-indexing
		const initialCount = temporalGraphService.entityQueryCount;
		await service.selectCommit('commit-target', { immediate: true });
		assert.equal(temporalGraphService.entityQueryCount, initialCount, 'Cache hit should not re-query entity graphs');

		service.dispose();
	});

	test('4. openSourceDiff constructs valid Git resource URIs for added, removed, and modified files with getEmptyTree', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('target-sha-1234567890', 'target', 2000, ['base-sha-1234567890']),
				makeCommitSummary('base-sha-1234567890', 'base', 1000, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'target-sha-1234567890': [
				makeEntity('ent-added', 'src/added.ts', 'can-add'),
				makeEntity('ent-modified', 'src/mod.ts', 'can-mod-v2'),
			],
			'base-sha-1234567890': [
				makeEntity('ent-removed', 'src/removed.ts', 'can-rem'),
				makeEntity('ent-modified', 'src/mod.ts', 'can-mod-v1'),
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
		);

		await service.initialize();

		// Test added file diff (empty left)
		await service.openSourceDiff('ent-added');
		assert.equal(commandService.executedCommands.length, 1);
		let diffCall = commandService.executedCommands[0];
		assert.equal(diffCall.command, 'vscode.diff');
		let [baseUri, targetUri] = diffCall.args;
		assert.equal(baseUri.scheme, 'git');
		assert.equal(JSON.parse(baseUri.query).ref, '4b825dc642cb6eb9a060e54bf8d69288fbee4904', 'Added file left side must be empty tree git ref');
		assert.equal(targetUri.scheme, 'git');
		assert.equal(JSON.parse(targetUri.query).ref, 'target-sha-1234567890');

		// Test modified file diff
		await service.openSourceDiff('ent-modified');
		diffCall = commandService.executedCommands[1];
		[baseUri, targetUri] = diffCall.args;
		assert.equal(baseUri.scheme, 'git');
		assert.equal(JSON.parse(baseUri.query).ref, 'base-sha-1234567890');
		assert.equal(targetUri.scheme, 'git');
		assert.equal(JSON.parse(targetUri.query).ref, 'target-sha-1234567890');

		// Test removed file diff (empty right)
		await service.openSourceDiff('ent-removed');
		diffCall = commandService.executedCommands[2];
		[baseUri, targetUri] = diffCall.args;
		assert.equal(baseUri.scheme, 'git');
		assert.equal(JSON.parse(baseUri.query).ref, 'base-sha-1234567890');
		assert.equal(targetUri.scheme, 'git');
		assert.equal(JSON.parse(targetUri.query).ref, '4b825dc642cb6eb9a060e54bf8d69288fbee4904', 'Removed file right side must be empty tree git ref');

		service.dispose();
	});

	test('5. openHistoricalFile opens revision at selected commit via EditorService', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-historical', 'old commit', 2000, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-historical': [makeEntity('ent-1', 'src/service.ts', 'can-1')],
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
		);

		await service.selectRef('HEAD');
		await service.openHistoricalFile('ent-1');

		assert.equal(editorService.openedEditors.length, 1);
		const opened = editorService.openedEditors[0];
		assert.equal(opened.resource.scheme, 'git');
		assert.equal(JSON.parse(opened.resource.query).ref, 'commit-historical');

		service.dispose();
	});

	test('6. Display mode and entity selection isolation', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-1', 'initial', 1000, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-1': [makeEntity('ent-1', 'src/a.ts', 'can-1')],
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
		);

		await service.selectRef('HEAD');

		assert.equal(service.getState().displayMode, 'changes');
		service.setDisplayMode('state');
		assert.equal(service.getState().displayMode, 'state');

		service.selectEntity('ent-1');
		assert.equal(service.getState().selectedEntityId, 'ent-1');
		service.selectEntity(undefined);
		assert.equal(service.getState().selectedEntityId, undefined);

		service.dispose();
	});

	test('7. Multi-repository ownership and switchRepository', async () => {
		const historyRepoA: TemporalHistoryPage = {
			commits: [makeCommitSummary('commit-a1', 'repo a commit', 1000, [])],
			hasMore: false,
		};
		const historyRepoB: TemporalHistoryPage = {
			commits: [makeCommitSummary('commit-b1', 'repo b commit', 2000, [])],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-a1': [makeEntity('ent-a', 'src/a.ts', 'can-a')],
			'commit-b1': [makeEntity('ent-b', 'src/b.ts', 'can-b')],
		};

		const temporalGraphService = {
			getRepositoryRefs: async () => [],
			getHistoryPage: async (root: string) => {
				return root.includes('repoB') ? historyRepoB : historyRepoA;
			},
			getCommitIndexStatus: async () => ({ status: 'ready' as const }),
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
		};

		const gitHistoryService = {
			getRepositories: () => [
				{ rootUri: URI.file('/mock/repoA') },
				{ rootUri: URI.file('/mock/repoB') },
			],
			getRepositoryIdentity: async (root: string) => ({ repositoryId: root }),
			getEmptyTree: async () => '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
			onDidChangeHead: new Emitter<any>().event,
		};

		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			gitHistoryService as any,
			temporalGraphService as any,
			createMockCommandService() as any,
			createMockEditorService() as any,
			mockLogService,
		);

		await service.initialize();

		assert.equal(service.getState().availableRepositories.length, 2);
		assert.equal(service.getState().selectedCommitSha, 'commit-a1');

		await service.switchRepository('/mock/repoB');
		assert.equal(service.getState().activeRepositoryRoot, '/mock/repoB');
		assert.equal(service.getState().selectedCommitSha, 'commit-b1');

		service.dispose();
	});

	test('8. Arbitrary comparison base: setCompareBase triggers diff against custom base', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-head', 'head', 3000, ['commit-p1', 'commit-p2']),
				makeCommitSummary('commit-p1', 'parent 1', 2000, []),
				makeCommitSummary('commit-p2', 'parent 2', 2000, []),
				makeCommitSummary('commit-old', 'old branch', 1000, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-head': [makeEntity('ent-1', 'src/a.ts', 'can-1'), makeEntity('ent-2', 'src/b.ts', 'can-2')],
			'commit-p1': [makeEntity('ent-1', 'src/a.ts', 'can-1')],
			'commit-p2': [makeEntity('ent-2', 'src/b.ts', 'can-2')],
			'commit-old': [],
		};

		const temporalGraphService = createMockTemporalGraphService({ HEAD: history }, entities);
		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			createMockGitHistoryService() as any,
			temporalGraphService as any,
			createMockCommandService() as any,
			createMockEditorService() as any,
			mockLogService,
		);

		await service.initialize();
		assert.equal(service.getState().comparisonMode, 'first-parent');
		assert.equal(service.getState().compareBaseSha, 'commit-p1');

		// Switch to explicit second parent
		await service.setCompareBase('commit-p2');
		assert.equal(service.getState().comparisonMode, 'explicit-parent');
		assert.equal(service.getState().compareBaseSha, 'commit-p2');
		assert.equal(service.getState().diff?.summary.addedCount, 1); // ent-1 was added relative to p2

		// Switch to arbitrary old commit
		await service.setCompareBase('commit-old');
		assert.equal(service.getState().comparisonMode, 'arbitrary');
		assert.equal(service.getState().compareBaseSha, 'commit-old');
		assert.equal(service.getState().diff?.summary.addedCount, 2); // both ent-1 and ent-2 are added relative to old

		service.dispose();
	});
});

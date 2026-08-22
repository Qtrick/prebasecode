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
				makeCommitSummary('commit-3', 'feat: add service', 3000, ['commit-2']),
				makeCommitSummary('commit-2', 'fix: utils', 2000, ['commit-1']),
				makeCommitSummary('commit-1', 'initial', 1000, [], true),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-3': [makeEntity('e1', 'src/a.ts', 'can-1')],
			'commit-2': [makeEntity('e1', 'src/a.ts', 'can-1')],
		};

		const temporalGraphService = createMockTemporalGraphService({ HEAD: history, main: history }, entities);
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

		await service.selectRef('main');

		const state = service.getState();
		assert.equal(state.selectedRef, 'main');
		assert.equal(state.selectedCommitSha, 'commit-3');
		assert.equal(state.compareBaseSha, 'commit-2', 'Default compare base for commit-3 must be first parent (commit-2)');
		assert.equal(state.pagedTimeline.length, 3);
		assert.equal(state.totalAvailableCommits, 3);
		assert.equal(state.isSettled, true);
		assert.ok(state.diff);
		assert.equal(state.diff?.targetCommitSha, 'commit-3');
		assert.equal(state.diff?.nodes.length, 1);
		assert.ok(typeof state.diff?.nodes[0].x === 'number');
		assert.ok(typeof state.diff?.nodes[0].y === 'number');
	});

	test('2. Multi-page cursor pagination loads > 50 commits without duplication or premature cutoff', async () => {
		const page1Commits: TemporalCommitSummary[] = [];
		for (let i = 120; i > 70; i--) {
			page1Commits.push(makeCommitSummary(`sha-${i}`, `commit ${i}`, i * 1000, [`sha-${i - 1}`]));
		}
		const page2Commits: TemporalCommitSummary[] = [];
		for (let i = 70; i > 20; i--) {
			page2Commits.push(makeCommitSummary(`sha-${i}`, `commit ${i}`, i * 1000, [`sha-${i - 1}`]));
		}
		const page3Commits: TemporalCommitSummary[] = [];
		for (let i = 20; i >= 1; i--) {
			page3Commits.push(makeCommitSummary(`sha-${i}`, `commit ${i}`, i * 1000, i > 1 ? [`sha-${i - 1}`] : []));
		}

		const historyPages: Record<string, TemporalHistoryPage> = {
			HEAD: { commits: page1Commits, hasMore: true, nextCursor: 'cursor-page-2' },
			'cursor-page-2': { commits: page2Commits, hasMore: true, nextCursor: 'cursor-page-3' },
			'cursor-page-3': { commits: page3Commits, hasMore: false },
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'sha-120': [makeEntity('e1', 'src/a.ts', 'can-1')],
			'sha-119': [makeEntity('e1', 'src/a.ts', 'can-1')],
		};

		const temporalGraphService = createMockTemporalGraphService(historyPages, entities);
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

		// Page 1
		let state = service.getState();
		assert.equal(state.pagedTimeline.length, 50);
		assert.equal(state.historyHasMore, true);
		assert.equal(state.historyNextCursor, 'cursor-page-2');

		// Load Page 2
		await service.loadMoreHistory();
		state = service.getState();
		assert.equal(state.pagedTimeline.length, 100);
		assert.equal(state.historyHasMore, true);
		assert.equal(state.historyNextCursor, 'cursor-page-3');

		// Load Page 3
		await service.loadMoreHistory();
		state = service.getState();
		assert.equal(state.pagedTimeline.length, 120);
		assert.equal(state.historyHasMore, false);

		// Deduplication check: all 120 SHAs must be unique
		const shas = new Set(state.pagedTimeline.map(c => c.sha));
		assert.equal(shas.size, 120);
	});

	test('3. Base-Before-Target Indexing Order: base is indexed before target commit', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('target-sha', 'target', 2000, ['base-sha']),
				makeCommitSummary('base-sha', 'base', 1000, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'target-sha': [makeEntity('e1', 'src/a.ts', 'can-2')],
			'base-sha': [makeEntity('e1', 'src/a.ts', 'can-1')],
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

		// Check sequence of index/get calls
		const baseIndex = temporalGraphService.indexingSequence.findIndex(s => s.includes('base-sha'));
		const targetIndex = temporalGraphService.indexingSequence.findIndex(s => s.includes('target-sha'));
		assert.ok(baseIndex >= 0, 'Base commit must be indexed');
		assert.ok(targetIndex >= 0, 'Target commit must be indexed');
		assert.ok(baseIndex < targetIndex, 'Base commit must be indexed BEFORE target commit');
	});

	test('4. openSourceDiff invokes vscode.diff with exact Git extension URI contract', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('target-sha-1234567890', 'mod file', 2000, ['base-sha-1234567890']),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'target-sha-1234567890': [
				makeEntity('ent-mod', 'src/modified.ts', 'can-v2'),
				makeEntity('ent-added', 'src/added.ts', 'can-add'),
				makeEntity('ent-renamed', 'src/newPath.ts', 'can-v2'),
			],
			'base-sha-1234567890': [
				makeEntity('ent-mod', 'src/modified.ts', 'can-v1'),
				makeEntity('ent-removed', 'src/deleted.ts', 'can-del'),
				makeEntity('ent-renamed', 'src/oldPath.ts', 'can-v1'),
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

		await service.selectRef('HEAD');

		// Test modified file diff
		await service.openSourceDiff('ent-mod');
		assert.equal(commandService.executedCommands.length, 1);
		let diffCall = commandService.executedCommands[0];
		assert.equal(diffCall.command, 'vscode.diff');
		let [baseUri, targetUri, title] = diffCall.args;

		assert.equal(baseUri.scheme, 'git');
		assert.equal(JSON.parse(baseUri.query).ref, 'base-sha-1234567890');
		assert.equal(targetUri.scheme, 'git');
		assert.equal(JSON.parse(targetUri.query).ref, 'target-sha-1234567890');
		assert.ok(title.includes('modified.ts'));

		// Test added file diff (empty left)
		await service.openSourceDiff('ent-added');
		diffCall = commandService.executedCommands[1];
		[baseUri, targetUri] = diffCall.args;
		assert.equal(baseUri.scheme, 'git');
		assert.equal(JSON.parse(baseUri.query).ref, '~', 'Added file left side must be empty git ref');
		assert.equal(targetUri.scheme, 'git');
		assert.equal(JSON.parse(targetUri.query).ref, 'target-sha-1234567890');

		// Test removed file diff (empty right)
		await service.openSourceDiff('ent-removed');
		diffCall = commandService.executedCommands[2];
		[baseUri, targetUri] = diffCall.args;
		assert.equal(baseUri.scheme, 'git');
		assert.equal(JSON.parse(baseUri.query).ref, 'base-sha-1234567890');
		assert.equal(targetUri.scheme, 'git');
		assert.equal(JSON.parse(targetUri.query).ref, '~', 'Removed file right side must be empty git ref');
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
});

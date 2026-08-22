/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { URI } from '../../../../../../base/common/uri.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { WorkbenchTemporalViewService } from '../../host/workbench/temporal/workbenchTemporalViewService.js';
import type { TemporalEntitySnapshot, TemporalEdgeSnapshot, TemporalHistoryPage, TemporalCommitSummary } from '../../temporal/common/temporalTypes.js';

suite('WorkbenchTemporalViewService (Unit - Phase 3.1 Controller & Bridge)', () => {
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

	function makeEntity(entityId: string, path: string, canonicalId: string): TemporalEntitySnapshot {
		return {
			entityId,
			commitSha: 'commit-test',
			path,
			nodeData: {
				id: canonicalId,
				kind: 'file',
				label: path.split('/').pop() || path,
				path,
			} as any,
		};
	}

	function createMockTemporalGraphService(history: TemporalHistoryPage, entitiesByCommit: Record<string, TemporalEntitySnapshot[]>, edgesByCommit: Record<string, TemporalEdgeSnapshot[]> = {}) {
		let entityQueryCount = 0;

		return {
			get entityQueryCount() { return entityQueryCount; },
			getHistoryPage: async (_root: string, _options?: any): Promise<TemporalHistoryPage> => {
				return history;
			},
			getCommitIndexStatus: async (_root: string, _sha: string) => {
				return { status: 'ready' as const, lineageCoverage: { kind: 'complete' as const } };
			},
			getGraphAtCommit: async (_root: string, sha: string) => {
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
			onDidChangeHead: onDidChangeHeadEmitter.event,
			emitHeadChanged: (currentHead: string) => onDidChangeHeadEmitter.fire({ currentHead, repositoryId: 'mock-repo', timestamp: Date.now() }),
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

	const mockLogService = {
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
		trace: () => {},
	} as any;

	test('1. selectRef loads paged commit timeline and immediately selects HEAD', async () => {
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

		const temporalGraphService = createMockTemporalGraphService(history, entities);
		const gitHistoryService = createMockGitHistoryService();
		const commandService = createMockCommandService();

		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			gitHistoryService as any,
			temporalGraphService as any,
			commandService as any,
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
	});

	test('2. Debounced rapid scrubbing: intermediate selections are cancelled and only settled commit is reconstructed', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-3', 'c3', 3000, ['commit-2']),
				makeCommitSummary('commit-2', 'c2', 2000, ['commit-1']),
				makeCommitSummary('commit-1', 'c1', 1000, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-3': [makeEntity('e1', 'src/a.ts', 'can-1')],
			'commit-2': [makeEntity('e1', 'src/a.ts', 'can-1')],
			'commit-1': [makeEntity('e1', 'src/a.ts', 'can-1')],
		};

		const temporalGraphService = createMockTemporalGraphService(history, entities);
		const gitHistoryService = createMockGitHistoryService();
		const commandService = createMockCommandService();

		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			gitHistoryService as any,
			temporalGraphService as any,
			commandService as any,
			mockLogService,
		);

		await service.selectRef('main');
		const initialQueryCount = temporalGraphService.entityQueryCount;

		// Rapid scrubbing: select commit-2 then immediately commit-1 without immediate flag
		void service.selectCommit('commit-2', { immediate: false });
		await new Promise(r => setTimeout(r, 20)); // shorter than 120ms debounce
		void service.selectCommit('commit-1', { immediate: false });

		// Wait for debounce timer to fire (150ms)
		await new Promise(r => setTimeout(r, 160));

		const state = service.getState();
		assert.equal(state.selectedCommitSha, 'commit-1');
		// Only 1 additional reconstruction should have executed for the settled target (commit-1), not commit-2
		assert.equal(temporalGraphService.entityQueryCount, initialQueryCount + 1);
	});

	test('3. Bounded diff caching: revisiting previously viewed commit serves from cache without IPC queries', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-2', 'c2', 2000, ['commit-1']),
				makeCommitSummary('commit-1', 'c1', 1000, []),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-2': [makeEntity('e1', 'src/a.ts', 'can-1')],
			'commit-1': [makeEntity('e1', 'src/a.ts', 'can-1')],
		};

		const temporalGraphService = createMockTemporalGraphService(history, entities);
		const gitHistoryService = createMockGitHistoryService();
		const commandService = createMockCommandService();

		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			gitHistoryService as any,
			temporalGraphService as any,
			commandService as any,
			mockLogService,
		);

		await service.selectRef('main');
		const queriesAfterHead = temporalGraphService.entityQueryCount;

		// Select commit-1
		await service.selectCommit('commit-1', { immediate: true });
		const queriesAfterC1 = temporalGraphService.entityQueryCount;
		assert.ok(queriesAfterC1 > queriesAfterHead);

		// Select commit-2 again (was HEAD and previously diffed)
		await service.selectCommit('commit-2', { immediate: true });
		assert.equal(temporalGraphService.entityQueryCount, queriesAfterC1, 'Revisiting commit-2 must serve from diff cache');

		// Select commit-1 again
		await service.selectCommit('commit-1', { immediate: true });
		assert.equal(temporalGraphService.entityQueryCount, queriesAfterC1, 'Revisiting commit-1 must serve from diff cache');
	});

	test('4. openSourceDiff invokes vscode.diff with correct git-blob URIs', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('target-sha-1234567890', 'mod file', 2000, ['base-sha-1234567890']),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'target-sha-1234567890': [makeEntity('ent-renamed', 'src/newPath.ts', 'can-v2')],
			'base-sha-1234567890': [makeEntity('ent-renamed', 'src/oldPath.ts', 'can-v1')],
		};

		const temporalGraphService = createMockTemporalGraphService(history, entities);
		const gitHistoryService = createMockGitHistoryService();
		const commandService = createMockCommandService();

		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			gitHistoryService as any,
			temporalGraphService as any,
			commandService as any,
			mockLogService,
		);

		await service.selectRef('main');

		await service.openSourceDiff('ent-renamed');

		assert.equal(commandService.executedCommands.length, 1);
		const diffCall = commandService.executedCommands[0];
		assert.equal(diffCall.command, 'vscode.diff');

		const [baseUri, targetUri, title] = diffCall.args;
		assert.equal(baseUri.scheme, 'git-blob');
		assert.equal(baseUri.authority, 'base-sha-1234567890');
		assert.equal(baseUri.path, '/src/oldPath.ts');

		assert.equal(targetUri.scheme, 'git-blob');
		assert.equal(targetUri.authority, 'target-sha-1234567890');
		assert.equal(targetUri.path, '/src/newPath.ts');

		assert.ok(title.includes('newPath.ts'));
		assert.ok(title.includes('base-sh'));
		assert.ok(title.includes('target-'));
	});

	test('5. Merge commit handling and follow-HEAD updates', async () => {
		const history: TemporalHistoryPage = {
			commits: [
				makeCommitSummary('commit-merge', 'Merge branch feature', 3000, ['commit-main', 'commit-feat']),
				makeCommitSummary('commit-main', 'main commit', 2000, ['commit-0']),
				makeCommitSummary('commit-feat', 'feat commit', 1500, ['commit-0']),
			],
			hasMore: false,
		};

		const entities: Record<string, TemporalEntitySnapshot[]> = {
			'commit-merge': [makeEntity('e1', 'src/a.ts', 'can-1')],
			'commit-main': [makeEntity('e1', 'src/a.ts', 'can-1')],
		};

		const temporalGraphService = createMockTemporalGraphService(history, entities);
		const gitHistoryService = createMockGitHistoryService();
		const commandService = createMockCommandService();

		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			gitHistoryService as any,
			temporalGraphService as any,
			commandService as any,
			mockLogService,
		);

		await service.selectRef('main');

		const state = service.getState();
		const mergeCommit = state.pagedTimeline.find(c => c.sha === 'commit-merge');
		assert.ok(mergeCommit);
		assert.equal(mergeCommit.isMerge, true);
		assert.equal(mergeCommit.parents.length, 2);

		// Test follow-HEAD disabled: head change does not reload
		service.setFollowHead(false);
		assert.equal(service.getState().followHead, false);

		service.dispose();
	});
});

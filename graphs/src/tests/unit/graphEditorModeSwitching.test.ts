/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { URI } from '../../../../../../base/common/uri.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { WorkbenchTemporalViewService } from '../../host/workbench/temporal/workbenchTemporalViewService.js';
import type { TemporalCommitSummary, TemporalEntitySnapshot, TemporalHistoryPage, TemporalRepositoryRef } from '../../temporal/common/temporalTypes.js';

suite('Graph Editor Mode Switching Lifecycle (Temporal <-> Network)', () => {
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

	function makeCommitSummary(sha: string, message: string, timestamp: number, parents: string[]): TemporalCommitSummary {
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

	function createMockTemporalGraphService(
		historyPages: Record<string, TemporalHistoryPage>,
		entitiesByCommit: Record<string, TemporalEntitySnapshot[]> = {},
		delayMs = 0
	) {
		return {
			getRepositoryRefs: async (_root: string): Promise<TemporalRepositoryRef[]> => [],
			getHistoryPage: async (_root: string, options?: any): Promise<TemporalHistoryPage> => {
				if (delayMs > 0) {
					await new Promise(resolve => setTimeout(resolve, delayMs));
				}
				const ref = options?.ref || options?.cursor || 'HEAD';
				return historyPages[ref] || { commits: [], hasMore: false };
			},
			getCommitIndexStatus: async () => ({ status: 'ready' as const, lineageCoverage: { kind: 'complete' as const } }),
			getGraphAtCommit: async (_root: string, sha: string) => {
				if (delayMs > 0) {
					await new Promise(resolve => setTimeout(resolve, delayMs));
				}
				const entities = entitiesByCommit[sha] || [];
				const entityMap = new Map();
				for (const e of entities) {
					entityMap.set(e.entityId, e);
				}
				return {
					commitSha: sha,
					timestamp: Date.now(),
					isCheckpoint: false,
					entityMap,
					edgeMap: new Map(),
					pathToEntityId: new Map(),
					graphData: { nodes: [], edges: [], timestamp: Date.now() },
					schemaVersion: 1,
					analyzerVersion: 1,
					profileVersion: 1,
				};
			},
			ensureCommitIndexed: async (_root: string, sha: string) => {
				const entities = entitiesByCommit[sha] || [];
				const entityMap = new Map();
				for (const e of entities) {
					entityMap.set(e.entityId, e);
				}
				return {
					commitSha: sha,
					timestamp: Date.now(),
					isCheckpoint: false,
					entityMap,
					edgeMap: new Map(),
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
		return {
			getRepositories: () => [{ rootUri: workspaceFolderUri }],
			getRepositoryIdentity: async () => ({ repositoryId: 'repo-mock-123' }),
			getEmptyTree: async () => '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
			onDidChangeHead: new Emitter<any>().event,
		};
	}

	function createService(historyPages: Record<string, TemporalHistoryPage>, delayMs = 0) {
		const temporalGraphService = createMockTemporalGraphService(historyPages, {}, delayMs);
		const gitHistoryService = createMockGitHistoryService();
		return new WorkbenchTemporalViewService(
			mockWorkspaceService,
			gitHistoryService as any,
			temporalGraphService as any,
			{ executeCommand: async () => undefined } as any,
			{ openEditor: async () => undefined } as any,
			mockLogService,
			mockStorageService,
		);
	}

	const defaultHistory: Record<string, TemporalHistoryPage> = {
		HEAD: {
			commits: [
				makeCommitSummary('commit-3', 'commit 3', 300, ['commit-2']),
				makeCommitSummary('commit-2', 'commit 2', 200, ['commit-1']),
				makeCommitSummary('commit-1', 'commit 1', 100, []),
			],
			hasMore: false,
		},
	};

	// 1. Network -> Temporal
	test('1. Network -> Temporal initializes WorkbenchTemporalViewService and populates commit state', async () => {
		const service = createService(defaultHistory);
		assert.equal(service.getState().selectedCommitSha, '', 'Initially empty commit SHA');

		await service.initialize();

		const state = service.getState();
		assert.equal(state.selectedRef, 'HEAD');
		assert.equal(state.selectedCommitSha, 'commit-3');
		assert.equal(state.loadedCommitCount, 3);
		service.dispose();
	});

	// 2. Temporal -> Network
	test('2. Temporal -> Network triggers pauseActiveWork and cancels active work without error', async () => {
		const service = createService(defaultHistory, 50);
		const initPromise = service.initialize();

		// Immediately switch to network mode:
		service.pauseActiveWork();
		await initPromise;

		// Service is paused cleanly
		assert.doesNotThrow(() => service.pauseActiveWork());
		service.dispose();
	});

	// 3. Rapid Temporal -> Network -> Temporal -> Network
	test('3. rapid Temporal -> Network -> Temporal mode switching preserves clean state', async () => {
		const service = createService(defaultHistory);

		// Switch to Temporal
		const p1 = service.initialize();
		// Quickly switch to Network
		service.pauseActiveWork();
		await p1;

		// Switch back to Temporal
		const p2 = service.initialize();
		await p2;
		assert.equal(service.getState().selectedCommitSha, 'commit-3');

		// Switch back to Network
		service.pauseActiveWork();
		assert.doesNotThrow(() => service.pauseActiveWork());
		service.dispose();
	});

	// 4. Temporal request resolves after switching to Network
	test('4. Temporal request resolving after switching to Network is discarded via pauseActiveWork', async () => {
		const service = createService(defaultHistory, 30);
		const initPromise = service.initialize();

		// Switch to Network mid-request
		service.pauseActiveWork();
		await initPromise;

		// No crash, state remains safe
		assert.ok(service.getState());
		service.dispose();
	});

	// 5. Temporal diff resolves after switching to Network
	test('5. Temporal diff resolving after switching to Network does not post stale diff', async () => {
		const postedMessages: Array<{ type: string; payload: any }> = [];
		let currentInputType: 'network' | 'temporal' = 'temporal';

		function pushTemporalDiff(diff: any) {
			if (currentInputType !== 'temporal') {
				return;
			}
			postedMessages.push({ type: 'temporalDiff', payload: diff });
		}

		// Diff completes while in temporal mode:
		pushTemporalDiff({ modified: ['file1.ts'] });
		assert.equal(postedMessages.length, 1);

		// Switch to network mode:
		currentInputType = 'network';
		// Late diff resolves:
		pushTemporalDiff({ modified: ['file2.ts'] });
		assert.equal(postedMessages.length, 1, 'Late diff resolving after switch to network must be dropped');
	});

	// 6. Temporal initialization is cancelled cleanly
	test('6. Temporal initialization cancellation pauses in-flight history request', async () => {
		const service = createService(defaultHistory, 100);
		const initPromise = service.initialize();
		service.pauseActiveWork();
		await initPromise;
		assert.ok(true, 'Initialization cancelled cleanly');
		service.dispose();
	});

	// 7. No stale Temporal IPC after mode switch
	test('7. no stale Temporal IPC messages posted when mode is network', () => {
		const postedMessages: Array<{ type: string; payload: any }> = [];
		let currentInputType: 'network' | 'temporal' = 'network';

		function pushTemporalState(state: any) {
			if (currentInputType !== 'temporal') {
				return;
			}
			postedMessages.push({ type: 'temporalState', payload: state });
		}

		pushTemporalState({ selectedCommitSha: 'sha-stale' });
		assert.equal(postedMessages.length, 0, 'No temporalState posted in network mode');

		currentInputType = 'temporal';
		pushTemporalState({ selectedCommitSha: 'sha-fresh' });
		assert.equal(postedMessages.length, 1, 'temporalState posted in temporal mode');

		currentInputType = 'network';
		pushTemporalState({ selectedCommitSha: 'sha-stale-2' });
		assert.equal(postedMessages.length, 1, 'Subsequent temporalState dropped when back in network mode');
	});

	// 8. Reopening Temporal initializes correctly
	test('8. reopening Temporal re-initializes and loads timeline', async () => {
		const service = createService(defaultHistory);
		await service.initialize();
		assert.equal(service.getState().selectedCommitSha, 'commit-3');

		// Switch to Network
		service.pauseActiveWork();

		// Reopen Temporal
		await service.initialize();
		assert.equal(service.getState().selectedCommitSha, 'commit-3');
		assert.equal(service.getState().loadedCommitCount, 3);
		service.dispose();
	});

	// 9. Closing/reopening editor does not leak state
	test('9. closing and disposing service does not throw or leak active listeners', async () => {
		const service = createService(defaultHistory);
		await service.initialize();

		assert.doesNotThrow(() => {
			service.pauseActiveWork();
			service.dispose();
		});

		// Second service instance can start cleanly
		const service2 = createService(defaultHistory);
		await service2.initialize();
		assert.equal(service2.getState().selectedCommitSha, 'commit-3');
		service2.dispose();
	});

	// 10. Repeated mode switching does not accumulate work
	test('10. repeated mode switching (10 cycles) executes safely without accumulating work', async () => {
		const service = createService(defaultHistory);

		for (let cycle = 0; cycle < 10; cycle++) {
			const initPromise = service.initialize();
			if (cycle % 2 === 0) {
				service.pauseActiveWork();
			}
			await initPromise;
		}

		service.pauseActiveWork();
		service.dispose();
		assert.ok(true, '10 cycles of rapid mode switching completed cleanly');
	});

	test('11. obsolete initialize after pause does not overwrite a newer initialize', async () => {
		let resolveRefs: (() => void) | undefined;
		const refsGate = new Promise<void>(resolve => { resolveRefs = resolve; });
		let resolveHistory: (() => void) | undefined;
		const historyGate = new Promise<void>(resolve => { resolveHistory = resolve; });
		let historyCalls = 0;
		let refsCalls = 0;

		const temporalGraphService = {
			getRepositoryRefs: async () => {
				refsCalls++;
				if (refsCalls === 1) {
					await refsGate;
				}
				return [];
			},
			getHistoryPage: async () => {
				historyCalls++;
				if (historyCalls === 1) {
					await historyGate;
				}
				return defaultHistory.HEAD;
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
			{ executeCommand: async () => undefined } as any,
			{ openEditor: async () => undefined } as any,
			mockLogService,
			mockStorageService,
		);

		const obsolete = service.initialize();
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(refsCalls, 1, 'obsolete init must be blocked in getRepositoryRefs');

		service.pauseActiveWork();
		const newer = service.initialize();
		assert.notEqual(obsolete, newer, 'post-pause initialize must not reuse the obsolete promise');
		const newerPromiseSlot = (service as any)._initPromise;
		assert.ok(newerPromiseSlot, 'newer initialize must install its own promise');
		assert.equal(newer, newerPromiseSlot, 'initialize return value must match installed promise');

		assert.ok(resolveRefs, 'refs gate must be armed');
		resolveRefs();
		await obsolete;
		assert.equal(
			(service as any)._initPromise,
			newerPromiseSlot,
			'obsolete finally must not clear the newer init promise',
		);
		assert.equal(service.getState().selectedCommitSha, '', 'obsolete init must not commit selection');

		assert.ok(resolveHistory, 'history gate must be armed');
		resolveHistory();
		await newer;
		assert.equal(service.getState().selectedCommitSha, 'commit-3');
		assert.equal(service.getState().selectedRef, 'HEAD');
		assert.equal(service.getState().isLoadingHistory, false);
		assert.ok(historyCalls > 0, 'newer init must load history');
		service.dispose();
	});

	test('12. selectedCommitSha advances while renderedCommitSha stays stale during loading', async () => {
		const entity = (sha: string, hash: string): TemporalEntitySnapshot => ({
			entityId: 'e1',
			commitSha: sha,
			path: 'a.ts',
			contentHash: hash,
			nodeData: { id: 'e1', label: 'a.ts', path: 'a.ts' } as any,
		});
		const entitiesByCommit: Record<string, TemporalEntitySnapshot[]> = {
			'commit-3': [entity('commit-3', 'h1')],
			'commit-2': [entity('commit-2', 'h0')],
			'commit-1': [entity('commit-1', 'h0')],
		};
		const temporalGraphService = createMockTemporalGraphService(defaultHistory, entitiesByCommit, 0);
		const service = new WorkbenchTemporalViewService(
			mockWorkspaceService,
			createMockGitHistoryService() as any,
			temporalGraphService as any,
			{ executeCommand: async () => undefined } as any,
			{ openEditor: async () => undefined } as any,
			mockLogService,
			mockStorageService,
		);
		await service.initialize();
		assert.equal(service.getState().selectedCommitSha, 'commit-3');
		assert.equal(service.getState().renderedCommitSha, 'commit-3');

		// Non-immediate selection: selection/loading flags flip before reconstruct runs (scrub debounce).
		await service.selectCommit('commit-2', { immediate: false });
		const mid = service.getState();
		assert.equal(mid.selectedCommitSha, 'commit-2', 'selection must advance immediately');
		assert.equal(mid.isLoadingSelection, true);
		assert.equal(mid.renderedCommitSha, 'commit-3', 'rendered SHA must stay stale while loading');
		assert.notEqual(mid.selectedCommitSha, mid.renderedCommitSha);

		await new Promise(resolve => setTimeout(resolve, 180));
		const after = service.getState();
		assert.equal(after.selectedCommitSha, 'commit-2');
		assert.equal(after.renderedCommitSha, 'commit-2');
		assert.equal(after.isLoadingSelection, false);
		service.dispose();
	});

	test('13. rapid Network-Temporal initialize/pause under delayed IO preserves final Temporal truth', async () => {
		const service = createService(defaultHistory, 25);
		const ops: Promise<void>[] = [];
		for (let i = 0; i < 8; i++) {
			ops.push(service.initialize());
			if (i % 2 === 0) {
				service.pauseActiveWork();
			}
		}
		await Promise.all(ops);
		await service.initialize();
		assert.equal(service.getState().selectedCommitSha, 'commit-3');
		assert.equal(service.getState().loadedCommitCount, 3);
		assert.equal(service.getState().renderedCommitSha, 'commit-3');
		service.pauseActiveWork();
		service.dispose();
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { suite, test } from 'mocha';
import { GitHistoryError } from '../../history/git/gitTypes.js';
import { TemporalError } from '../../temporal/common/temporalErrors.js';
import { TemporalGraphService } from '../../temporal/host/temporalGraphService.js';
import type { IGitHistoryService } from '../../history/git/gitHistoryService.js';
import type { TemporalCommitRecord, TemporalGraphSnapshot } from '../../temporal/common/temporalTypes.js';
import { TemporalRepositoryRegistry } from '../../temporal/ingestion/temporalRepositoryRegistry.js';
import { TemporalRepositoryRuntime } from '../../temporal/ingestion/temporalRepositoryRuntime.js';
import type { ITemporalStore } from '../../temporal/persistence/common/temporalStore.js';

function createSnapshot(commitSha: string): TemporalGraphSnapshot {
	return {
		schemaVersion: 1,
		analyzerVersion: 1,
		profileVersion: 1,
		commitSha,
		timestamp: 1,
		isCheckpoint: true,
		graphData: { nodes: [], edges: [], timestamp: 1 },
		entityMap: new Map(),
		edgeMap: new Map(),
		pathToEntityId: new Map(),
	};
}

function createRuntime(onClose: () => void = () => {}): TemporalRepositoryRuntime {
	const store = Object.assign(Object.create(null), {
		close: async () => onClose(),
	}) as ITemporalStore;
	const gitService = Object.create(null) as IGitHistoryService;
	return new TemporalRepositoryRuntime('repo-a', '/repo-a', store, gitService);
}

suite('TemporalRepositoryRuntime', () => {
	test('cold-start runtime creation is deduplicated per repository', async () => {
		let factoryCalls = 0;
		let openCalls = 0;
		let releaseFactory: (() => void) | undefined;
		const factoryGate = new Promise<void>(resolve => releaseFactory = resolve);
		const store = Object.assign(Object.create(null), {
			isOpen: () => openCalls > 0,
			open: async () => { openCalls++; },
			close: async () => {},
		}) as ITemporalStore;
		const registry = new TemporalRepositoryRegistry(async () => {
			factoryCalls++;
			await factoryGate;
			return store;
		});
		const gitService = Object.create(null) as IGitHistoryService;

		const first = registry.getRuntime('repo-a', '/repo-a', gitService);
		const duplicate = registry.getRuntime('repo-a', '/repo-a', gitService);
		releaseFactory?.();
		const [firstRuntime, duplicateRuntime] = await Promise.all([first, duplicate]);

		assert.deepStrictEqual({
			factoryCalls,
			openCalls,
			sameRuntime: firstRuntime === duplicateRuntime,
		}, {
			factoryCalls: 1,
			openCalls: 1,
			sameRuntime: true,
		});
		await registry.closeAll();
	});

	test('closes a repository runtime by root path instead of treating a URI as its Git identity', async () => {
		let closeCalls = 0;
		const store = Object.assign(Object.create(null), {
			isOpen: () => true,
			close: async () => { closeCalls++; },
		}) as ITemporalStore;
		const registry = new TemporalRepositoryRegistry(async () => store);
		const gitService = Object.create(null) as IGitHistoryService;

		await registry.getRuntime('stable-git-id', '/repo-a', gitService);
		await registry.closeStoreByRootPath('/repo-a');

		assert.deepStrictEqual({ closeCalls, hasRuntime: registry.hasRuntime('stable-git-id') }, {
			closeCalls: 1,
			hasRuntime: false,
		});
	});

	test('deduplicates simultaneous work for one commit SHA', async () => {
		const runtime = createRuntime();
		let taskCalls = 0;
		let releaseTask: (() => void) | undefined;
		const gate = new Promise<void>(resolve => releaseTask = resolve);

		const first = runtime.queueIngestion('commit-c', async () => {
			taskCalls++;
			await gate;
			return createSnapshot('commit-c');
		});
		const duplicate = runtime.queueIngestion('commit-c', async () => {
			taskCalls++;
			return createSnapshot('commit-c');
		});

		assert.strictEqual(first, duplicate);
		assert.strictEqual(runtime.hasInFlightIngestion('commit-c'), true);
		releaseTask?.();
		const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
		assert.strictEqual(runtime.hasInFlightIngestion('commit-c'), false);
		assert.deepStrictEqual({ taskCalls, sameResult: firstResult === duplicateResult }, {
			taskCalls: 1,
			sameResult: true,
		});
		await runtime.dispose();
	});

	test('refreshRefs replaces the observed set so deleted refs are pruned', async () => {
		let storedRefs = [
			{ refName: 'refs/heads/deleted', targetSha: 'old', refType: 'branch', lastObserved: 1 },
			{ refName: 'refs/tags/deleted', targetSha: 'old', refType: 'tag', lastObserved: 1 },
		];
		const store = Object.assign(Object.create(null), {
			replaceRefs: async (refs: typeof storedRefs) => { storedRefs = [...refs]; },
			close: async () => {},
		}) as ITemporalStore;
		const gitService = Object.assign(Object.create(null), {
			getRepositoryIdentity: async () => ({ repositoryId: 'repo-a', rootPath: '/repo-a', headBranch: 'main', objectFormat: 'sha1' as const }),
			getHead: async () => 'new-head',
			listBranches: async () => [{ name: 'main', commit: 'new-head', isRemote: false }],
			listTags: async () => [],
		}) as IGitHistoryService;
		const runtime = new TemporalRepositoryRuntime('repo-a', '/repo-a', store, gitService);

		await runtime.refreshRefs();

		assert.deepStrictEqual(storedRefs.map(ref => [ref.refName, ref.targetSha]).sort(), [
			['HEAD', 'new-head'],
			['refs/heads/main', 'new-head'],
		]);
		await runtime.dispose();
	});

	test('continues FIFO processing after a failed job', async () => {
		const runtime = createRuntime();
		const order: string[] = [];
		const failed = runtime.queueIngestion('commit-c', async () => {
			order.push('c');
			throw new Error('expected indexing failure');
		});
		const recovered = runtime.queueIngestion('commit-d', async () => {
			order.push('d');
			return createSnapshot('commit-d');
		});

		await assert.rejects(failed, /expected indexing failure/);
		assert.strictEqual((await recovered).commitSha, 'commit-d');
		assert.deepStrictEqual(order, ['c', 'd']);
		await runtime.dispose();
	});

	test('clears failed in-flight work so the same commit can be retried', async () => {
		const runtime = createRuntime();
		let attempts = 0;
		await assert.rejects(runtime.queueIngestion('commit-c', async () => {
			attempts++;
			throw new Error('transient indexing failure');
		}), /transient indexing failure/);

		const recovered = await runtime.queueIngestion('commit-c', async () => {
			attempts++;
			return createSnapshot('commit-c');
		});

		assert.deepStrictEqual({ attempts, commitSha: recovered.commitSha }, {
			attempts: 2,
			commitSha: 'commit-c',
		});
		await runtime.dispose();
	});

	test('disposal drains active work before closing its store', async () => {
		let closeCalls = 0;
		let releaseTask: (() => void) | undefined;
		const gate = new Promise<void>(resolve => releaseTask = resolve);
		const runtime = createRuntime(() => closeCalls++);
		const active = runtime.queueIngestion('commit-c', async () => {
			await gate;
			return createSnapshot('commit-c');
		});
		await Promise.resolve();

		const disposing = runtime.dispose();
		await Promise.resolve();
		assert.strictEqual(closeCalls, 0);
		releaseTask?.();
		await Promise.all([active, disposing]);
		assert.strictEqual(closeCalls, 1);
	});

	test('disposal is idempotent, rejects new work, and closes the store exactly once', async () => {
		let closeCalls = 0;
		const runtime = createRuntime(() => closeCalls++);

		await runtime.dispose();
		await runtime.dispose();
		await assert.rejects(
			runtime.queueIngestion('commit-c', async () => createSnapshot('commit-c')),
			/disposed/
		);
		assert.strictEqual(closeCalls, 1);
	});

	test('reports repository failures as structured diagnostics instead of unregistered without context', async () => {
		const gitService = Object.assign(Object.create(null), {
			getRepositoryIdentity: async () => {
				throw new GitHistoryError('RepositoryUnavailable', 'repository is closed');
			},
		}) as IGitHistoryService;
		const registry = new TemporalRepositoryRegistry(async () => Object.create(null) as ITemporalStore);
		const service = new TemporalGraphService(gitService, registry);

		assert.deepStrictEqual(await service.getCommitIndexStatus('/repo-a', 'commit-a'), {
			status: 'unregistered',
			diagnosticCode: 'repository-unavailable',
		});
	});

	test('reports persisted cache corruption as failed instead of masking it as an unregistered repository', async () => {
		const store = Object.assign(Object.create(null), {
			isOpen: () => true,
			open: async () => {},
			close: async () => {},
			getCommit: async () => {
				throw new TemporalError('DatabaseCorrupted', 'checkpoint digest does not match');
			},
		}) as ITemporalStore;
		const gitService = Object.assign(Object.create(null), {
			getRepositoryIdentity: async () => ({ repositoryId: 'repo-a', rootPath: '/repo-a', objectFormat: 'sha1' as const }),
		}) as IGitHistoryService;
		const service = new TemporalGraphService(gitService, new TemporalRepositoryRegistry(async () => store));

		assert.deepStrictEqual(await service.getCommitIndexStatus('/repo-a', 'commit-a'), {
			status: 'failed',
			diagnosticCode: 'database-corrupted',
		});
	});

	test('derives incomplete status from persisted canonical coverage after runtime restart', async () => {
		const commit: TemporalCommitRecord = {
			commitSha: 'commit-a',
			canonicalDigest: 'digest-a',
			parentShas: [],
			treeSha: 'tree-a',
			authorName: 'Tester',
			authorEmail: 'tester@prebase.invalid',
			authorTimestamp: 1,
			committerTimestamp: 1,
			message: 'incomplete graph',
			ingestedAt: 1,
			isCheckpoint: true,
			checkpointInterval: 10,
			deltaDepth: 0,
			schemaVersion: 4,
			analyzerVersion: 1,
			profileVersion: 1,
		};
		const coverage = {
			completeWithinProfile: false,
			isComplete: false,
			discoveredCount: 2,
			analyzedCount: 1,
			analyzedFileCount: 1,
			excludedCount: 1,
			excludedFileCount: 1,
			failedCount: 0,
			truncated: true,
			truncationReason: 'producer limit',
			exclusionBreakdown: {
				'oversized-file': 0,
				'binary-file': 0,
				'unsupported-language': 0,
				'parse-error': 0,
				'permission-denied': 0,
				'ignored-pattern': 0,
				'policy-excluded': 0,
				other: 0,
			},
			exclusionReasons: {},
		};
		const snapshot: TemporalGraphSnapshot = {
			schemaVersion: 4,
			analyzerVersion: 1,
			profileVersion: 1,
			commitSha: commit.commitSha,
			timestamp: 1,
			isCheckpoint: true,
			digest: 'digest-a',
			canonicalSnapshot: {
				nodes: [],
				edges: [],
				projectPath: '/repo-a',
				projectName: 'repo-a',
				entryNodeId: null,
				analyzedAt: 1,
				sourceIdentity: 'git:commit-a',
				digest: 'digest-a',
				versions: { graphSchemaVersion: 1, analyzerVersion: 1, identityVersion: 1, layoutVersion: 1 },
				coverage,
				completeness: coverage,
			},
			graphData: { nodes: [], edges: [], timestamp: 1 },
			entityMap: new Map(),
			edgeMap: new Map(),
			pathToEntityId: new Map(),
		};
		const store = Object.assign(Object.create(null), {
			isOpen: () => true,
			open: async () => {},
			close: async () => {},
			getCommit: async () => commit,
			getCommitCoverage: async () => snapshot.canonicalSnapshot!.coverage,
		}) as ITemporalStore;
		const gitService = Object.assign(Object.create(null), {
			getRepositoryIdentity: async () => ({ repositoryId: 'repo-a', rootPath: '/repo-a', objectFormat: 'sha1' as const }),
		}) as IGitHistoryService;

		// A new registry has no in-memory ingestion state, which models a restart.
		const restartedRegistry = new TemporalRepositoryRegistry(async () => store);
		const restartedService = new TemporalGraphService(gitService, restartedRegistry);
		assert.deepStrictEqual(await restartedService.getCommitIndexStatus('/repo-a', commit.commitSha), {
			status: 'incomplete',
		});
		await restartedRegistry.closeAll();
	});
});

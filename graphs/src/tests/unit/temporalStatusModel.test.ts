/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { computeTemporalUnifiedStatus } from '../../temporal/view/temporalStatusModel.js';
import type { ITemporalViewState, TemporalCommitSummary } from '../../temporal/view/temporalViewTypes.js';

suite('TemporalStatusModel (Unit - Authoritative Status & Precedence)', () => {
	function makeCommitSummary(sha: string, shortSha: string, message: string, author: string): TemporalCommitSummary {
		return {
			sha,
			shortSha,
			message,
			author,
			timestamp: 1700000000,
			parents: [],
			isMerge: false,
			isCheckpoint: false,
			isSettled: true,
		};
	}

	function makeState(overrides: Partial<ITemporalViewState> = {}): ITemporalViewState {
		const headSummary = makeCommitSummary('b491c6a01234567890', 'b491c6a', 'feat: new feature', 'Dev');
		return {
			availableRepositories: [],
			repositoryRefs: [],
			selectedRef: 'HEAD',
			isLoadingSelection: false,
			selectionError: undefined,
			historyError: undefined,
			pagedTimeline: [headSummary],
			loadedCommitCount: 1,
			selectedCommitSha: 'b491c6a01234567890',
			renderedCommitSha: 'b491c6a01234567890',
			selectedCommitSummary: headSummary,
			renderedCommitSummary: headSummary,
			diff: undefined,
			isPartialLineage: false,
			followHead: true,
			displayMode: 'state',
			historyHasMore: false,
			isSettled: true,
			comparisonMode: 'first-parent',
			...overrides,
		};
	}

	test('1. Ready State: Reconciled selected and rendered commit returns Ready', () => {
		const state = makeState();
		const status = computeTemporalUnifiedStatus(state);
		assert.strictEqual(status.kind, 'ready');
		assert.strictEqual(status.label, 'Ready');
		assert.strictEqual(status.isJobActive, false);
		assert.strictEqual(status.isError, false);
		assert.strictEqual(status.canRetry, false);
	});

	test('2. Loading History: Active history loading takes top precedence', () => {
		const state = makeState({ isLoadingHistory: true });
		const status = computeTemporalUnifiedStatus(state);
		assert.strictEqual(status.kind, 'loading-history');
		assert.strictEqual(status.label, 'Loading History…');
		assert.strictEqual(status.isJobActive, true);
		assert.strictEqual(status.isError, false);
		assert.strictEqual(status.canRetry, false);
	});

	test('3. Reconstructing / Indexing: Active selection reconstruction returns Indexing with commit target', () => {
		const state = makeState({
			isLoadingSelection: true,
			selectedCommitSha: 'c50119f00000000000',
			selectedCommitSummary: makeCommitSummary('c50119f00000000000', 'c50119f', 'wip', 'Dev'),
			renderedCommitSha: 'b491c6a01234567890',
		});
		const status = computeTemporalUnifiedStatus(state);
		assert.strictEqual(status.kind, 'reconstructing');
		assert.strictEqual(status.label, 'Indexing…');
		assert.ok(status.title.includes('c50119f'), `title contains short sha: ${status.title}`);
		assert.strictEqual(status.isJobActive, true);
		assert.strictEqual(status.canRetry, false);
	});

	test('4. Error Precedence: When reconstruction fails, status is Error (NEVER Indexing)', () => {
		const state = makeState({
			isLoadingSelection: false, // Ingestion finished/failed
			selectionError: 'Git tree parse failed: corrupted packfile',
			selectedCommitSha: 'c50119f00000000000',
			selectedCommitSummary: makeCommitSummary('c50119f00000000000', 'c50119f', 'wip', 'Dev'),
			renderedCommitSha: 'b491c6a01234567890', // Previous graph is still displayed
		});
		const status = computeTemporalUnifiedStatus(state);
		assert.strictEqual(status.kind, 'error');
		assert.strictEqual(status.label, 'Error');
		assert.strictEqual(status.isError, true);
		assert.strictEqual(status.isJobActive, false);
		assert.strictEqual(status.canRetry, true);
		assert.ok(status.title.includes('Could not load c50119f'), `Explains target failure: ${status.title}`);
		assert.ok(status.title.includes('Showing previous graph b491c6a'), `Explains fallback rendered graph: ${status.title}`);
	});

	test('5. Stale Render Explanation: When selection differs from render without error and not indexing', () => {
		const state = makeState({
			isLoadingSelection: false,
			selectionError: undefined,
			selectedCommitSha: 'c50119f00000000000',
			selectedCommitSummary: makeCommitSummary('c50119f00000000000', 'c50119f', 'wip', 'Dev'),
			renderedCommitSha: 'b491c6a01234567890',
			renderedCommitSummary: makeCommitSummary('b491c6a01234567890', 'b491c6a', 'base', 'Dev'),
		});
		const status = computeTemporalUnifiedStatus(state);
		assert.strictEqual(status.kind, 'stale');
		assert.strictEqual(status.label, 'Stale View');
		assert.strictEqual(status.canRetry, true);
		assert.ok(status.title.includes('b491c6a'), `title mentions rendered sha: ${status.title}`);
	});

	test('6. Partial History Lineage: When history is partial, surfaces Partial History badge', () => {
		const state = makeState({ isPartialLineage: true });
		const status = computeTemporalUnifiedStatus(state);
		assert.strictEqual(status.kind, 'partial');
		assert.strictEqual(status.label, 'Partial History');
		assert.strictEqual(status.isJobActive, false);
	});

	test('7. Empty / Idle State: When no commits exist, returns No History', () => {
		const state = makeState({ pagedTimeline: [], loadedCommitCount: 0 });
		const status = computeTemporalUnifiedStatus(state);
		assert.strictEqual(status.kind, 'idle');
		assert.strictEqual(status.label, 'No History');
	});
});

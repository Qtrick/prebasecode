/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	formatWorkDuration,
	MAGNUS_SESSION_SCHEMA_VERSION,
	migrateLegacyTurnsToTaskRun,
	runHeaderLabel,
} from './taskRunModel';

suite('Magnus taskRunModel', () => {
	test('formats durations from timestamps', () => {
		assert.strictEqual(formatWorkDuration(0, 25_000), '25s');
		assert.strictEqual(formatWorkDuration(0, 90_000), '1m 30s');
	});

	test('run header labels depend on status', () => {
		const base = { submittedAt: 0, startedAt: 0, completedAt: 12_000 };
		assert.ok(runHeaderLabel({ ...base, status: 'planning' }).startsWith('Planning'));
		assert.ok(runHeaderLabel({ ...base, status: 'running' }).startsWith('Working'));
		assert.strictEqual(runHeaderLabel({ ...base, status: 'completed' }), 'Worked for 12s');
		assert.strictEqual(runHeaderLabel({ ...base, status: 'cancelled' }), 'Cancelled after 12s');
	});

	test('migrates legacy turns once', () => {
		const run = migrateLegacyTurnsToTaskRun([
			{ role: 'user', content: 'Fix the bug', timestamp: 1 },
			{ role: 'assistant', content: 'Looking…', timestamp: 2 },
			{ role: 'tool', content: 'read file', timestamp: 3 },
			{ role: 'assistant', content: 'Done.', timestamp: 4 },
		]);
		assert.ok(run);
		assert.strictEqual(run!.migrated, true);
		assert.strictEqual(run!.userTask, 'Fix the bug');
		assert.strictEqual(run!.finalResponse, 'Done.');
		assert.strictEqual(run!.workGroups[0]?.category, 'Previous conversation');
		assert.strictEqual(migrateLegacyTurnsToTaskRun([]), undefined);
		assert.strictEqual(
			migrateLegacyTurnsToTaskRun([], { schemaVersion: MAGNUS_SESSION_SCHEMA_VERSION }),
			undefined,
		);
		assert.strictEqual(
			migrateLegacyTurnsToTaskRun(
				[{ role: 'user', content: 'Already migrated' }],
				{ schemaVersion: MAGNUS_SESSION_SCHEMA_VERSION },
			),
			undefined,
		);
	});

	test('migrates user-only legacy turns without work groups', () => {
		const run = migrateLegacyTurnsToTaskRun([
			{ role: 'user', content: 'Hello', timestamp: 10 },
		]);
		assert.ok(run);
		assert.strictEqual(run!.userTask, 'Hello');
		assert.strictEqual(run!.workGroups.length, 0);
		assert.strictEqual(run!.finalResponse, undefined);
	});
});

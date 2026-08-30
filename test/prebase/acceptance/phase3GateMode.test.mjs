import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	parseMode,
	shouldSkipProducerExecution,
	buildValidationPlan,
} from './prebase-phase3-final-gate.mjs';

const identity = {
	sourceHead: 'test-head',
	sourceFingerprint: 'test-fp',
	productFingerprint: 'test-fp',
};

describe('phase3 gate parseMode / resume skip / only-producer', () => {
	test('parseMode accepts --plan --tier commit and --only-producer lists', () => {
		const mode = parseMode([
			'node', 'gate.mjs',
			'--plan',
			'--tier', 'commit',
			'--only-producer', 'magnus-guidance-smoke,lifecycle-cycles',
		]);
		assert.equal(mode.plan, true);
		assert.equal(mode.tier, 'commit');
		assert.deepEqual(mode.onlyProducers, ['magnus-guidance-smoke', 'lifecycle-cycles']);
	});

	test('parseMode rejects --only-producer without a mode that supports filtering', () => {
		assert.throws(
			() => parseMode(['node', 'gate.mjs', '--validate-evidence', '--only-producer', 'magnus-guidance-smoke']),
			/--tier \/ --only-producer require/,
		);
	});

	test('parseMode rejects empty --only-producer value', () => {
		assert.throws(
			() => parseMode(['node', 'gate.mjs', '--plan', '--only-producer']),
			/--only-producer requires a producer id/,
		);
	});

	test('shouldSkipProducerExecution never restarts COMPLETE producers', () => {
		assert.equal(shouldSkipProducerExecution({
			id: 'magnus-guidance-smoke',
			status: 'STALE',
			execution: { status: 'COMPLETE', durationMs: 12_000 },
		}), true);
		assert.equal(shouldSkipProducerExecution({
			id: 'magnus-guidance-smoke',
			status: 'STALE',
			execution: { status: 'FAILED' },
		}), false);
		assert.equal(shouldSkipProducerExecution({
			id: 'active-soak',
			status: 'DEFERRED_RELEASE',
		}), true);
		assert.equal(shouldSkipProducerExecution({
			id: 'hybrid-web-smoke',
			status: 'SKIPPED',
			reason: 'excluded by --only-producer',
		}), true);
	});

	test('buildValidationPlan --only-producer marks other producers SKIPPED', { timeout: 120_000 }, () => {
		const plan = buildValidationPlan(new URL('../../..', import.meta.url).pathname, identity, {
			forceNew: true,
			onlyProducers: ['magnus-guidance-smoke'],
			changedPaths: [
				'extensions/prebase-magnus/src/projectGuidanceService.ts',
				'test/prebase/acceptance/prebase-magnus-guidance-live.mjs',
			],
		});
		assert.ok(plan.onlyProducers.includes('magnus-guidance-smoke'));
		const guidance = plan.producers.find(item => item.id === 'magnus-guidance-smoke');
		assert.ok(guidance);
		assert.notEqual(guidance.status, 'SKIPPED');
		const skipped = plan.producers.filter(item => item.status === 'SKIPPED');
		assert.ok(skipped.length > 0);
		assert.ok(skipped.every(item => /excluded by --only-producer/.test(item.reason ?? '')));
		assert.equal(plan.producers.find(item => item.id === 'active-soak')?.status === 'SKIPPED'
			|| plan.producers.find(item => item.id === 'active-soak')?.status === 'CURRENT_GREEN'
			|| plan.producers.find(item => item.id === 'active-soak')?.status === 'EXTERNAL', true);
	});

	test('buildValidationPlan commit tier defers release soaks for guidance-only paths', { timeout: 120_000 }, () => {
		const plan = buildValidationPlan(new URL('../../..', import.meta.url).pathname, identity, {
			forceNew: true,
			tier: 'commit',
			changedPaths: [
				'extensions/prebase-magnus/src/projectGuidanceDelta.ts',
				'test/prebase/acceptance/prebase-magnus-guidance-live.mjs',
			],
		});
		assert.equal(plan.tier, 'commit');
		for (const id of ['active-soak', 'electron-restart-soak', 'idle-soak', 'parser-benchmark']) {
			const entry = plan.producers.find(item => item.id === id);
			assert.ok(entry, id);
			assert.ok(
				entry.status === 'DEFERRED_RELEASE' || entry.status === 'CURRENT_GREEN' || entry.status === 'EXTERNAL',
				`${id} status=${entry.status}`,
			);
		}
		const guidance = plan.producers.find(item => item.id === 'magnus-guidance-smoke');
		assert.ok(guidance);
		assert.notEqual(guidance.status, 'DEFERRED_RELEASE');
		assert.notEqual(guidance.status, 'SKIPPED');
	});
});

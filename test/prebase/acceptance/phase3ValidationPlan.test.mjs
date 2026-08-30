import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';
import { currentSourceIdentity } from './phase3Evidence.mjs';
import {
	assertPlanIdentity,
	buildValidationPlan,
	classifyRequiredEvidence,
	computePlanKey,
	expectedProducerFingerprint,
	loadPlan,
	persistPlan,
	planCheckpointPath,
	probeEnvironmentPrerequisites,
	scenarioOk,
} from './prebase-phase3-final-gate.mjs';
import { computeProducerFingerprint } from './phase3ProducerDomains.mjs';

const acceptanceDir = dirname(fileURLToPath(import.meta.url));
const repo = join(acceptanceDir, '../../..');

function passingHybridSkip(identity, producerFingerprint) {
	return {
		ok: false,
		skipped: true,
		firecrawlConfigured: false,
		linkupConfigured: true,
		scenario: 'hybrid-web-smoke',
		sourceHead: identity.sourceHead,
		sourceFingerprint: identity.sourceFingerprint,
		producerFingerprint,
		failures: ['local hybrid skipped: both LINKUP_API_KEY and FIRECRAWL_API_KEY must resolve'],
	};
}

describe('phase 3 validation plan reuse and prerequisites', () => {
	const identity = currentSourceIdentity(repo);
	const prerequisites = probeEnvironmentPrerequisites();
	const planKey = computePlanKey(repo, identity, prerequisites);
	const keyDir = join(repo, '.build/prebase-validation', planKey);
	let savedCheckpoint;

	after(() => {
		if (savedCheckpoint !== undefined) {
			const checkpoint = planCheckpointPath(savedCheckpoint.runId, planKey);
			if (existsSync(checkpoint)) {
				rmSync(dirname(checkpoint), { recursive: true, force: true });
			}
		}
	});

	test('buildValidationPlan reuses a persisted checkpoint with the same planKey', () => {
		const fresh = buildValidationPlan(repo, identity, { forceNew: true });
		assert.equal(fresh.reused, false);
		persistPlan(fresh);
		savedCheckpoint = fresh;
		const reused = buildValidationPlan(repo, identity);
		assert.equal(reused.reused, true);
		assert.equal(reused.runId, fresh.runId);
		assert.equal(reused.planKey, fresh.planKey);
		assert.equal(reused.currentHead, identity.sourceHead);
	});

	test('forceNew bypasses reusable checkpoints even when planKey matches', () => {
		const first = buildValidationPlan(repo, identity, { forceNew: true });
		persistPlan(first);
		const second = buildValidationPlan(repo, identity, { forceNew: true });
		assert.equal(second.reused, false);
		assert.notEqual(second.runId, first.runId);
	});

	test('checkpoint persists under planKey/runId and reloads by runId', () => {
		const plan = buildValidationPlan(repo, identity, { forceNew: true });
		persistPlan(plan);
		savedCheckpoint = plan;
		const checkpoint = planCheckpointPath(plan.runId, plan.planKey);
		assert.equal(existsSync(checkpoint), true);
		const loaded = loadPlan(plan.runId, plan.planKey);
		assert.equal(loaded.runId, plan.runId);
		assert.equal(loaded.planKey, plan.planKey);
		assert.deepEqual(loaded.producers.map(item => item.id), plan.producers.map(item => item.id));
	});

	test('assertPlanIdentity accepts HEAD drift when product and producer fingerprints still match', () => {
		const plan = buildValidationPlan(repo, identity, { forceNew: true });
		for (const entry of plan.producers) {
			entry.expectedProducerFingerprint = expectedProducerFingerprint(repo, entry.id);
		}
		assert.doesNotThrow(() => assertPlanIdentity(plan, identity, repo));
		assert.doesNotThrow(() => assertPlanIdentity({
			...plan,
			sourceHead: '0'.repeat(40),
			plannedAtHead: '0'.repeat(40),
		}, identity, repo));
		assert.throws(
			() => assertPlanIdentity({ ...plan, productFingerprint: 'stale-product-fingerprint' }, identity, repo),
			/product fingerprint mismatch/,
		);
		assert.throws(
			() => assertPlanIdentity({
				...plan,
				producers: plan.producers.map(entry => entry.id === 'core-ide'
					? { ...entry, expectedProducerFingerprint: 'stale-producer-fingerprint' }
					: entry),
			}, identity, repo),
			/producer core-ide fingerprint mismatch/,
		);
	});

	test('assertPlanIdentity rejects environment prerequisite changes', () => {
		const plan = buildValidationPlan(repo, identity, { forceNew: true });
		for (const entry of plan.producers) {
			entry.expectedProducerFingerprint = expectedProducerFingerprint(repo, entry.id);
		}
		const flipped = {
			...plan,
			prerequisites: {
				...plan.prerequisites,
				firecrawlConfigured: !plan.prerequisites.firecrawlConfigured,
			},
		};
		assert.throws(
			() => assertPlanIdentity(flipped, identity, repo),
			/environment prerequisite change/,
		);
	});

	test('hybrid-web-smoke skip stays external until Firecrawl is configured, then becomes stale', () => {
		const producerFingerprint = computeProducerFingerprint(repo, 'hybrid-web-smoke');
		const skipped = passingHybridSkip(identity, producerFingerprint);
		const withoutKey = classifyRequiredEvidence(identity, new Map([['hybrid-web-smoke', skipped]]), repo, {
			firecrawlConfigured: false,
			linkupConfigured: true,
			geminiConfigured: false,
		});
		assert.equal(withoutKey.some(item => item.id === 'hybrid-web-smoke'), false);
		const withKey = classifyRequiredEvidence(identity, new Map([['hybrid-web-smoke', skipped]]), repo, {
			firecrawlConfigured: true,
			linkupConfigured: true,
			geminiConfigured: false,
		});
		assert.ok(withKey.some(item => item.id === 'hybrid-web-smoke' && /FIRECRAWL_API_KEY is now configured/.test(item.reason)));
	});

	test('commit-equivalent evidence stays fresh when producer fingerprint matches but HEAD moved', () => {
		const producerFingerprint = expectedProducerFingerprint(repo, 'core-ide');
		const entry = {
			id: 'core-ide',
			sourceHead: 'new-head-after-commit',
			sourceFingerprint: identity.sourceFingerprint,
			expectedProducerFingerprint: producerFingerprint,
		};
		const evidence = {
			ok: true,
			scenario: 'core-ide',
			sourceHead: 'old-head-before-commit',
			sourceFingerprint: identity.sourceFingerprint,
			producerFingerprint,
		};
		const verdict = scenarioOk(entry, evidence);
		assert.equal(verdict.ok, true);
		assert.equal(verdict.provenanceHeadMismatch, true);
		assert.equal(scenarioOk(entry, { ...evidence, producerFingerprint: 'stale-producer' }).ok, false);
	});
});

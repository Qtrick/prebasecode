import assert from 'node:assert/strict';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
	DOMAIN_PATHSPECS,
	PRODUCER_DOMAINS,
	PRODUCER_ESTIMATED_DURATION_MS,
	RELEASE_ONLY_PRODUCERS,
	classifyChangedPaths,
	computeProducerFingerprint,
	domainsForPath,
	estimateProducerDurationMs,
	isTransientProducerFailure,
	pathspecsForProducer,
	producersAffectedByDomains,
	producersForCommitTier,
	producerIdForScenario,
} from './phase3ProducerDomains.mjs';
import { producerForArtifact } from './prebase-phase3-final-gate.mjs';

const repo = new URL('../../..', import.meta.url).pathname;
// Probe must land under a hybrid pathspec (web-context dir), not a loose magnus root file.
const hybridPathspecProbe = join(repo, 'supabase/functions/web-search/tmp-producer-fingerprint-probe.ts');
const outOfDomainProbe = join(repo, 'docs/phase3-producer-fingerprint-probe.txt');
const legacyMagnusRootProbe = join(repo, 'extensions/prebase-magnus/tmp-producer-fingerprint-probe.ts');

function cleanupProbes() {
	for (const path of [hybridPathspecProbe, outOfDomainProbe, legacyMagnusRootProbe]) {
		try { unlinkSync(path); } catch { /* absent */ }
	}
}

cleanupProbes();
after(cleanupProbes);

describe('phase3 producer domains', () => {
	test('every producer declares domains and harness pathspecs', () => {
		for (const producer of Object.keys(PRODUCER_DOMAINS)) {
			if (producer === 'assurance') {
				continue;
			}
			assert.ok(pathspecsForProducer(producer).length > 0, `${producer} has no pathspecs`);
		}
	});

	test('magnus hybrid change does not map to electron restart soak domains only', () => {
		const domains = domainsForPath('extensions/prebase-magnus/src/hybridWebContext.ts');
		assert.ok(domains.includes('web-context'));
		const affected = producersAffectedByDomains(domains);
		assert.ok(affected.includes('hybrid-web-smoke'));
		assert.equal(affected.includes('electron-restart-soak'), false);
	});

	test('guidance live harness does not invalidate active soak via catch-all', () => {
		const domains = domainsForPath('test/prebase/acceptance/prebase-magnus-guidance-live.mjs');
		assert.deepEqual(domains, ['magnus-guidance']);
		const affected = producersAffectedByDomains(domains);
		assert.ok(affected.includes('magnus-guidance-smoke'));
		assert.equal(affected.includes('active-soak'), false);
		assert.equal(affected.includes('electron-restart-soak'), false);
		assert.equal(affected.includes('lifecycle-cycles'), false);
	});

	test('acceptance orchestration edit does not fingerprint-stale product soaks', () => {
		const domains = domainsForPath('test/prebase/acceptance/phase3ProducerDomains.mjs');
		assert.deepEqual(domains, ['validation-orchestration']);
		const affected = producersAffectedByDomains(domains);
		assert.equal(affected.includes('active-soak'), false);
		assert.equal(affected.includes('electron-restart-soak'), false);
		assert.equal(affected.includes('magnus-guidance-smoke'), false);
	});

	test('no broad test/prebase catch-all domain mapping', () => {
		assert.deepEqual(domainsForPath('test/prebase/acceptance/some-unknown-harness.mjs'), []);
		assert.deepEqual(domainsForPath('test/prebase/unit/foo.test.ts'), []);
	});

	test('acceptance-shared domain is gone from live producer/domain maps', async () => {
		assert.equal(Object.hasOwn(DOMAIN_PATHSPECS, 'acceptance-shared'), false);
		const domainsModule = await import('./phase3ProducerDomains.mjs');
		assert.equal(Object.hasOwn(domainsModule, 'DOMAIN_PATHSPECS_ACCEPTANCE_SHARED'), false);
		for (const domains of Object.values(PRODUCER_DOMAINS)) {
			assert.equal(domains.includes('acceptance-shared'), false);
		}
		assert.ok(Object.hasOwn(DOMAIN_PATHSPECS, 'validation-orchestration'));
	});

	test('commit tier excludes release soaks for guidance-only changes', () => {
		const { producers, unknown } = producersForCommitTier([
			'extensions/prebase-magnus/src/projectGuidanceService.ts',
			'test/prebase/acceptance/prebase-magnus-guidance-live.mjs',
		]);
		assert.equal(unknown.length, 0);
		assert.ok(producers.includes('magnus-guidance-smoke'));
		assert.equal(producers.includes('active-soak'), false);
		assert.equal(producers.includes('electron-restart-soak'), false);
		assert.equal(producers.includes('parser-benchmark'), false);
		for (const id of RELEASE_ONLY_PRODUCERS) {
			assert.equal(producers.includes(id), false, `release-only ${id} leaked into commit tier`);
		}
	});

	test('nativeTools / chatParticipant map to guidance so commit tier schedules smoke', () => {
		assert.ok(domainsForPath('extensions/prebase-magnus/src/nativeTools.ts').includes('magnus-guidance'));
		assert.ok(domainsForPath('extensions/prebase-magnus/src/chatParticipant.ts').includes('magnus-guidance'));
		const { producers } = producersForCommitTier(['extensions/prebase-magnus/src/nativeTools.ts']);
		assert.ok(producers.includes('magnus-guidance-smoke'));
		assert.equal(producers.includes('active-soak'), false);
		assert.equal(producers.includes('electron-product-path'), false);
		assert.equal(producers.includes('magnus-electron-tools'), false);
	});

	test('lifecycle estimate is far below obsolete 22-minute constant', () => {
		const ms = estimateProducerDurationMs(repo, 'lifecycle-cycles', {
			validationPlanPath: join(repo, 'reports/graph-acceptance/phase-3-final/missing-validation-plan.json'),
		});
		assert.ok(ms < 10 * 60 * 1000, `lifecycle estimate ${ms} still looks like the old 22m constant`);
		assert.ok(ms <= PRODUCER_ESTIMATED_DURATION_MS['lifecycle-cycles'] * 2);
		assert.ok(ms < 22 * 60 * 1000);
	});

	test('guidance smoke estimate uses evidence when available', () => {
		const ms = estimateProducerDurationMs(repo, 'magnus-guidance-smoke');
		assert.ok(ms >= 5_000 && ms <= 120_000);
	});

	test('isTransientProducerFailure retries infrastructure only, not deterministic assertion failures', () => {
		assert.equal(isTransientProducerFailure({
			code: 1,
			timedOut: false,
			logTail: 'AssertionError: expected guidance snapshot',
			leftoverPids: [],
		}), false);
		assert.equal(isTransientProducerFailure({
			code: 1,
			timedOut: true,
			logTail: 'EADDRINUSE address already in use',
			leftoverPids: [],
		}), false);
		assert.equal(isTransientProducerFailure({
			code: 1,
			timedOut: false,
			logTail: 'Error: EADDRINUSE: address already in use :::9222',
			leftoverPids: [],
		}), true);
		assert.equal(isTransientProducerFailure({
			code: 1,
			timedOut: false,
			logTail: 'cdp attach failed: WebSocket failed to connect',
			leftoverPids: [],
		}), true);
		assert.equal(isTransientProducerFailure({
			code: 0,
			timedOut: false,
			logTail: '',
			leftoverPids: [4242],
		}), true);
	});

	test('producer fingerprints differ between unrelated producers', () => {
		const hybrid = computeProducerFingerprint(repo, 'hybrid-web-smoke');
		const electron = computeProducerFingerprint(repo, 'electron-restart-soak');
		assert.notEqual(hybrid, electron);
	});

	test('scenario to producer mapping covers core-ide artifacts', () => {
		assert.equal(producerIdForScenario('code-graph'), 'core-ide');
		assert.equal(producerForArtifact('code-graph')?.id, 'core-ide');
		assert.equal(producerIdForScenario('magnus-guidance-smoke'), 'magnus-guidance-smoke');
		assert.equal(producerForArtifact('magnus-guidance-smoke')?.id, 'magnus-guidance-smoke');
	});

	test('unknown changed path is reported conservatively', () => {
		const { unknown } = classifyChangedPaths(repo, ['totally-unknown-root/foo.txt']);
		assert.deepEqual(unknown, ['totally-unknown-root/foo.txt']);
	});

	test('unrelated producer fingerprint stays stable when only an out-of-domain tree changes', { timeout: 120_000 }, () => {
		const hybridBefore = computeProducerFingerprint(repo, 'hybrid-web-smoke');
		const electronBefore = computeProducerFingerprint(repo, 'electron-restart-soak');
		try {
			writeFileSync(outOfDomainProbe, 'phase3 producer fingerprint isolation probe\n');
			assert.equal(computeProducerFingerprint(repo, 'hybrid-web-smoke'), hybridBefore);
			assert.equal(computeProducerFingerprint(repo, 'electron-restart-soak'), electronBefore);
		} finally {
			cleanupProbes();
		}
	});

	test('web-context pathspec edit changes hybrid fingerprint but not electron restart soak', { timeout: 120_000 }, () => {
		const hybridBefore = computeProducerFingerprint(repo, 'hybrid-web-smoke');
		const electronBefore = computeProducerFingerprint(repo, 'electron-restart-soak');
		try {
			writeFileSync(hybridPathspecProbe, 'export const producerFingerprintProbe = true;\n');
			assert.notEqual(computeProducerFingerprint(repo, 'hybrid-web-smoke'), hybridBefore);
			assert.equal(computeProducerFingerprint(repo, 'electron-restart-soak'), electronBefore);
		} finally {
			cleanupProbes();
		}
		assert.equal(existsSync(hybridPathspecProbe), false);
	});
});

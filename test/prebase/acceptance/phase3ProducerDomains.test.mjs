import assert from 'node:assert/strict';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
	PRODUCER_DOMAINS,
	classifyChangedPaths,
	computeProducerFingerprint,
	domainsForPath,
	pathspecsForProducer,
	producersAffectedByDomains,
	producerIdForScenario,
} from './phase3ProducerDomains.mjs';
import { producerForArtifact } from './prebase-phase3-final-gate.mjs';

const repo = new URL('../../..', import.meta.url).pathname;
const magnusProbe = join(repo, 'extensions/prebase-magnus/tmp-producer-fingerprint-probe.ts');
const outOfDomainProbe = join(repo, 'docs/phase3-producer-fingerprint-probe.txt');

function cleanupProbes() {
	for (const path of [magnusProbe, outOfDomainProbe]) {
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

	test('producer fingerprints differ between unrelated producers', () => {
		const hybrid = computeProducerFingerprint(repo, 'hybrid-web-smoke');
		const electron = computeProducerFingerprint(repo, 'electron-restart-soak');
		assert.notEqual(hybrid, electron);
	});

	test('scenario to producer mapping covers core-ide artifacts', () => {
		assert.equal(producerIdForScenario('code-graph'), 'core-ide');
		assert.equal(producerForArtifact('code-graph')?.id, 'core-ide');
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

	test('magnus-only edit changes hybrid producer fingerprint but not electron restart soak', { timeout: 120_000 }, () => {
		const hybridBefore = computeProducerFingerprint(repo, 'hybrid-web-smoke');
		const electronBefore = computeProducerFingerprint(repo, 'electron-restart-soak');
		try {
			writeFileSync(magnusProbe, 'export const producerFingerprintProbe = true;\n');
			assert.notEqual(computeProducerFingerprint(repo, 'hybrid-web-smoke'), hybridBefore);
			assert.equal(computeProducerFingerprint(repo, 'electron-restart-soak'), electronBefore);
		} finally {
			cleanupProbes();
		}
		assert.equal(existsSync(magnusProbe), false);
	});
});

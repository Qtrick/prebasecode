/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { computePureSha256 } from '../../core/canonical/pureSha256.js';

suite('PureSha256 Unit Tests', () => {
	test('matches official NIST FIPS 180-4 standard test vectors', () => {
		// Empty string vector
		const emptyHash = computePureSha256('');
		assert.strictEqual(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

		// "abc" vector
		const abcHash = computePureSha256('abc');
		assert.strictEqual(abcHash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

		// "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq" vector
		const multiBlockVector = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
		const multiBlockHash = computePureSha256(multiBlockVector);
		assert.strictEqual(multiBlockHash, '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
	});

	test('matches Node crypto.createHash across various input shapes and Unicode', () => {
		const testCases = [
			'',
			'hello world',
			'PreBase IDE Temporal Graph 2026',
			'🚀 Volumetric 3D Network Graph · UTF-8 测试 ñoño',
			'a'.repeat(55), // Boundary length 55 bytes
			'b'.repeat(56), // Boundary length 56 bytes
			'c'.repeat(64), // Exactly one 64-byte block
			'd'.repeat(65), // Spanning into next block
			'e'.repeat(128), // Exactly two blocks
			'f'.repeat(10_000), // Large buffer
			JSON.stringify({
				nodes: [{ id: 'file:src/index.ts', kind: 'file', label: 'index.ts' }],
				edges: [{ id: 'e1', source: 'a', target: 'b' }],
			}),
		];

		for (const input of testCases) {
			const pureResult = computePureSha256(input);
			const nodeResult = createHash('sha256').update(input, 'utf8').digest('hex');
			assert.strictEqual(pureResult, nodeResult, `Mismatch for input of length ${input.length}`);
		}
	});

	test('computes hash over a 200KB payload efficiently without errors', () => {
		const largeInput = 'const x = "PreBase Graph Structural Test Payload";\n'.repeat(4000); // ~204KB
		const t0 = Date.now();
		const pureResult = computePureSha256(largeInput);
		const duration = Date.now() - t0;

		const expected = createHash('sha256').update(largeInput, 'utf8').digest('hex');
		assert.strictEqual(pureResult, expected);
		assert.ok(duration < 200, `Hashing 200KB took ${duration}ms, should be fast`);
	});
});

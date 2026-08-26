/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { paceTextStream } from './streamPace';

describe('streamPace Unit Tests', () => {
	test('paces text in nominal chunks with injected sleep ticks', async () => {
		const sleepTicks: number[] = [];
		const sleepFn = async (ms: number) => {
			sleepTicks.push(ms);
		};

		async function* source() {
			yield 'abcdefgh';
		}

		const chunks: string[] = [];
		for await (const chunk of paceTextStream(source(), { charsPerTick: 3, intervalMs: 22, sleepFn })) {
			chunks.push(chunk);
		}

		assert.strictEqual(chunks.join(''), 'abcdefgh');
		assert.deepStrictEqual(chunks, ['abc', 'def', 'gh']);
		assert.ok(sleepTicks.length >= 2);
		assert.strictEqual(sleepTicks[0], 22);
	});

	test('preserves UTF-16 surrogate pairs and avoids splitting high and low surrogates', async () => {
		// Emoji 🚀 is '\uD83D\uDE80' (2 UTF-16 code units)
		// Input 'ab🚀cd': 'ab' (2) + '\uD83D\uDE80' (2) + 'cd' (2) = 6 code units.
		// If charsPerTick = 3, target split would be at index 3 (right between \uD83D and \uDE80).
		// Surrogate protection must expand first chunk to 4 code units ('ab🚀') rather than slicing '\uD83D'.
		const sleepFn = async () => {};

		async function* source() {
			yield 'ab🚀cd';
		}

		const chunks: string[] = [];
		for await (const chunk of paceTextStream(source(), { charsPerTick: 3, sleepFn })) {
			chunks.push(chunk);
		}

		assert.strictEqual(chunks.join(''), 'ab🚀cd');
		assert.strictEqual(chunks[0], 'ab🚀');
		assert.strictEqual(chunks[1], 'cd');
	});

	test('adaptively catches up when backlog is large and source finishes', async () => {
		const sleepFn = async () => {};
		const largeText = 'A'.repeat(500);

		async function* source() {
			yield largeText;
		}

		const chunks: string[] = [];
		for await (const chunk of paceTextStream(source(), { charsPerTick: 3, sleepFn })) {
			chunks.push(chunk);
		}

		assert.strictEqual(chunks.join(''), largeText);
		// Tail catch-up bounds drain to ~25 ticks rather than 167 ticks
		assert.ok(chunks.length < 35, `Expected < 35 chunks due to adaptive catch-up, got ${chunks.length}`);
	});

	test('immediately terminates on cancellation without yielding further', async () => {
		const sleepFn = async () => {};
		const cancellationSource = { isCancellationRequested: false };

		async function* source() {
			yield '12345678901234567890';
		}

		const chunks: string[] = [];
		for await (const chunk of paceTextStream(source(), { charsPerTick: 3, token: cancellationSource, sleepFn })) {
			chunks.push(chunk);
			if (chunks.length === 2) {
				cancellationSource.isCancellationRequested = true;
			}
		}

		assert.strictEqual(chunks.length, 2);
		assert.strictEqual(chunks.join(''), '123456');
	});

	test('propagates upstream source errors faithfully', async () => {
		const sleepFn = async () => {};

		async function* errorSource() {
			yield 'hello';
			throw new Error('SSE stream connection severed');
		}

		const chunks: string[] = [];
		await assert.rejects(async () => {
			for await (const chunk of paceTextStream(errorSource(), { charsPerTick: 3, sleepFn })) {
				chunks.push(chunk);
			}
		}, /SSE stream connection severed/);

		assert.strictEqual(chunks.join(''), 'hello');
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { paceTextStream, createLivePacedSink } from './streamPace';

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

	test('cancellation stops a yield-paused source via return() and does not hang on a blocked source await', async () => {
		let sourceReturned = false;
		const sleepFn = async () => {};
		const cancellationSource = { isCancellationRequested: false };

		async function* yieldPausedSource() {
			try {
				yield 'abcdef';
				yield 'stalled-at-yield';
			} finally {
				sourceReturned = true;
			}
		}

		const chunks: string[] = [];
		for await (const chunk of paceTextStream(yieldPausedSource(), { charsPerTick: 3, token: cancellationSource, sleepFn })) {
			chunks.push(chunk);
			if (chunks.length === 1) {
				cancellationSource.isCancellationRequested = true;
			}
		}

		assert.ok(chunks.length >= 1);
		assert.strictEqual(sourceReturned, true);

		async function* blockedAwaitSource() {
			yield 'xyz';
			await new Promise(() => {});
		}
		const cancellation2 = { isCancellationRequested: false };
		let settled = false;
		const paced = (async () => {
			for await (const chunk of paceTextStream(blockedAwaitSource(), { charsPerTick: 3, token: cancellation2, sleepFn: async () => {} })) {
				if (chunk) {
					cancellation2.isCancellationRequested = true;
				}
			}
			settled = true;
		})();
		await Promise.race([paced, new Promise(resolve => setTimeout(resolve, 200))]);
		assert.strictEqual(settled, true, 'blocked source await must not hang paceTextStream');
	});

	test('no-op sleepFn parks on a delayed source instead of busy-polling', async () => {
		let sleeps = 0;
		const sleepFn = async () => {
			sleeps++;
		};
		async function* delayedSource() {
			await new Promise(resolve => setTimeout(resolve, 40));
			yield 'hello';
		}
		const chunks: string[] = [];
		for await (const chunk of paceTextStream(delayedSource(), { charsPerTick: 5, sleepFn })) {
			chunks.push(chunk);
		}
		assert.strictEqual(chunks.join(''), 'hello');
		assert.ok(sleeps < 8, `expected park-until-progress, got ${sleeps} sleepFn calls`);
	});

	test('createLivePacedSink cancel wakes a blocked waiter and settles', async () => {
		const pieces: string[] = [];
		let cancelled = false;
		const listeners: Array<() => void> = [];
		const token = {
			get isCancellationRequested() {
				return cancelled;
			},
			onCancellationRequested(listener: () => void) {
				listeners.push(listener);
				return { dispose() { } };
			},
		};
		const sink = createLivePacedSink(piece => pieces.push(piece), { token, charsPerTick: 8, sleepFn: async () => {} });
		await Promise.resolve();
		await Promise.resolve();
		assert.ok(listeners.length >= 1, 'sink must subscribe to cancellation so a blocked waiter can be woken');
		cancelled = true;
		for (const listener of listeners) {
			listener();
		}
		sink.push('late-text');
		let settled = false;
		const closed = sink.close().then(() => { settled = true; });
		await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 200))]);
		assert.strictEqual(settled, true, 'cancel must wake the waiter so close does not hang');
		assert.deepStrictEqual(pieces, []);
	});
});

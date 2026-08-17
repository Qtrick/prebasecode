/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { suite, test } from 'node:test';
import {
	classifyGeminiHttpError,
	executeWithRetry,
	sleepWithCancellation,
} from './directGeminiTransport';

suite('Provider Resilience & Transient Retry', () => {
	test('classifyGeminiHttpError classifies status codes correctly', () => {
		assert.strictEqual(classifyGeminiHttpError(new Error('Auth error (HTTP 401)')).code, 'authentication');
		assert.strictEqual(classifyGeminiHttpError(new Error('Auth error (HTTP 401)')).retryable, false);

		assert.strictEqual(classifyGeminiHttpError(new Error('Quota (HTTP 429)')).code, 'rateLimited');
		assert.strictEqual(classifyGeminiHttpError(new Error('Quota (HTTP 429)')).retryable, true);

		assert.strictEqual(classifyGeminiHttpError(new Error('Service Unavailable (HTTP 503)')).code, 'providerServerError');
		assert.strictEqual(classifyGeminiHttpError(new Error('Service Unavailable (HTTP 503)')).retryable, true);

		assert.strictEqual(classifyGeminiHttpError(new Error('fetch failed ENOTFOUND')).code, 'network');
		assert.strictEqual(classifyGeminiHttpError(new Error('fetch failed ENOTFOUND')).retryable, true);

		assert.strictEqual(classifyGeminiHttpError(new Error('Cancelled')).code, 'cancelled');
		assert.strictEqual(classifyGeminiHttpError(new Error('Cancelled')).retryable, false);
	});

	test('executeWithRetry succeeds on first try', async () => {
		let attempts = 0;
		const result = await executeWithRetry(async (attempt) => {
			attempts++;
			return `success-${attempt}`;
		});
		assert.strictEqual(result, 'success-1');
		assert.strictEqual(attempts, 1);
	});

	test('executeWithRetry retries transient 503 and succeeds on second try', async () => {
		let attempts = 0;
		const result = await executeWithRetry(
			async (attempt) => {
				attempts++;
				if (attempt === 1) {
					throw new Error('Service Unavailable (HTTP 503)');
				}
				return 'recovered';
			},
			undefined,
			{ maxAttempts: 3, initialDelayMs: 10, maxDelayMs: 50 },
		);
		assert.strictEqual(result, 'recovered');
		assert.strictEqual(attempts, 2);
	});

	test('executeWithRetry does not retry non-retryable 401 error', async () => {
		let attempts = 0;
		await assert.rejects(
			async () => {
				await executeWithRetry(
					async () => {
						attempts++;
						throw new Error('Invalid API key (HTTP 401)');
					},
					undefined,
					{ maxAttempts: 3, initialDelayMs: 10 },
				);
			},
			/401/,
		);
		assert.strictEqual(attempts, 1);
	});

	test('sleepWithCancellation aborts promptly when token is cancelled', async () => {
		const listeners: Array<() => void> = [];
		const fakeToken = {
			isCancellationRequested: false,
			onCancellationRequested: (fn: () => void) => {
				listeners.push(fn);
				return { dispose: () => {} };
			},
		};

		const sleepPromise = sleepWithCancellation(5000, fakeToken);

		// Trigger cancellation
		setTimeout(() => {
			fakeToken.isCancellationRequested = true;
			for (const l of listeners) {
				l();
			}
		}, 20);

		await assert.rejects(sleepPromise, /Cancelled/);
	});
});

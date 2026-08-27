/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { suite, test } from 'node:test';
import {
	generateContent,
	generateContentCandidate,
	streamGenerateContent,
	type GeminiCancellationToken,
	type GeminiTransport,
} from './geminiClient.ts';

class TestCancellationToken implements GeminiCancellationToken {
	isCancellationRequested = false;
	private readonly listeners = new Set<() => void>();

	onCancellationRequested = (listener: () => void) => {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	};

	cancel(): void {
		this.isCancellationRequested = true;
		for (const listener of [...this.listeners]) {
			listener();
		}
	}

	get listenerCount(): number {
		return this.listeners.size;
	}
}

const request = { contents: [{ role: 'user' as const, parts: [{ text: 'Hello' }] }] };

suite('Gemini client cancellation transport', () => {
	test('sends non-stream credentials only in x-goog-api-key and never in the URL or Authorization header', async () => {
		const sentinel = 'AIza-secret-sentinel';
		let url = '';
		let headers: HeadersInit | undefined;
		const transport: GeminiTransport = {
			fetch: async (input, init) => {
				url = String(input);
				headers = init?.headers;
				return {
					ok: true,
					json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'Done' }] }, finishReason: 'STOP' }] }),
				} as Response;
			},
		};

		await generateContentCandidate(sentinel, 'gemini-test', request, undefined, transport);
		assert.strictEqual(url.includes(sentinel), false);
		assert.strictEqual((headers as Record<string, string>)['x-goog-api-key'], sentinel);
		assert.strictEqual(Object.hasOwn(headers as Record<string, string>, 'Authorization'), false);
	});

	test('sends SSE credentials only in x-goog-api-key and never in the URL or Authorization header', async () => {
		const sentinel = 'AIza-stream-secret-sentinel';
		let url = '';
		let headers: HeadersInit | undefined;
		const transport: GeminiTransport = {
			fetch: async (input, init) => {
				url = String(input);
				headers = init?.headers;
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n'));
						controller.close();
					},
				});
				return { ok: true, body } as Response;
			},
		};

		const chunks: string[] = [];
		for await (const chunk of streamGenerateContent(sentinel, 'gemini-test', request, undefined, transport)) {
			chunks.push(chunk);
		}

		assert.deepStrictEqual(chunks, ['Hello']);
		assert.strictEqual(url.includes(sentinel), false);
		assert.strictEqual((headers as Record<string, string>)['x-goog-api-key'], sentinel);
		assert.strictEqual(Object.hasOwn(headers as Record<string, string>, 'Authorization'), false);
	});

	test('rejects an oversized unterminated SSE frame without falling back to a second request', async () => {
		let fetchCalls = 0;
		const transport: GeminiTransport = {
			fetch: async () => {
				fetchCalls++;
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(`data: ${'x'.repeat(1_048_577)}`));
						controller.close();
					},
				});
				return { ok: true, body } as Response;
			},
		};

		const stream = streamGenerateContent('AIza-test', 'gemini-test', request, undefined, transport);
		await assert.rejects(stream.next(), /SSE response exceeded the 1 MiB framing limit/);
		assert.strictEqual(fetchCalls, 1);
	});

	test('falls back to a bounded non-stream request when the SSE endpoint declines the request', async () => {
		let fetchCalls = 0;
		const transport: GeminiTransport = {
			fetch: async () => {
				fetchCalls++;
				if (fetchCalls === 1) {
					return { ok: false } as Response;
				}
				return {
					ok: true,
					json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'Done' }] }, finishReason: 'STOP' }] }),
				} as Response;
			},
		};

		const chunks: string[] = [];
		for await (const chunk of streamGenerateContent('AIza-test', 'gemini-test', request, undefined, transport)) {
			chunks.push(chunk);
		}

		assert.deepStrictEqual(chunks, ['Done']);
		assert.strictEqual(fetchCalls, 2);
	});

	test('does not start a request when cancellation has already been requested', async () => {
		const token = new TestCancellationToken();
		token.cancel();
		let fetchCalls = 0;
		const transport: GeminiTransport = {
			fetch: async () => {
				fetchCalls++;
				throw new Error('fetch must not run');
			},
		};

		await assert.rejects(generateContentCandidate('AIza-test', 'gemini-test', request, token, transport), /Cancelled/);
		assert.strictEqual(fetchCalls, 0);
		assert.strictEqual(token.listenerCount, 0);
	});

	test('aborts an in-flight content request without retrying alternative authentication', async () => {
		const token = new TestCancellationToken();
		let fetchCalls = 0;
		let observedSignal: AbortSignal | undefined;
		const transport: GeminiTransport = {
			fetch: async (_input, init) => {
				fetchCalls++;
				observedSignal = init?.signal as AbortSignal | undefined;
				return new Promise<Response>((_resolve, reject) => {
					observedSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
				});
			},
		};

		const pending = generateContentCandidate('AIza-test', 'gemini-test', request, token, transport);
		await Promise.resolve();
		token.cancel();

		await assert.rejects(pending, /Aborted/);
		assert.strictEqual(observedSignal?.aborted, true);
		assert.strictEqual(fetchCalls, 1);
		assert.strictEqual(token.listenerCount, 0);
	});

	test('aborts an in-flight SSE stream on Quit without falling back to a second request', async () => {
		const token = new TestCancellationToken();
		let fetchCalls = 0;
		let readerCancelled = false;
		const transport: GeminiTransport = {
			fetch: async (_input, init) => {
				fetchCalls++;
				const signal = init?.signal;
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						signal?.addEventListener('abort', () => {
							try {
								controller.close();
							} catch {
								// already closed
							}
						}, { once: true });
					},
					cancel() {
						readerCancelled = true;
					},
				});
				return { ok: true, body } as Response;
			},
		};

		const pending = (async () => {
			const chunks: string[] = [];
			for await (const chunk of streamGenerateContent('AIza-test', 'gemini-test', request, token, transport)) {
				chunks.push(chunk);
			}
			return chunks;
		})();
		await Promise.resolve();
		await Promise.resolve();
		token.cancel();
		assert.deepStrictEqual(await pending, []);
		assert.strictEqual(fetchCalls, 1);
		assert.ok(readerCancelled || token.isCancellationRequested);
		assert.strictEqual(token.listenerCount, 0);
	});

	test('concatenates multiple text parts across non-stream response', async () => {
		const transport: GeminiTransport = {
			fetch: async () => ({
				ok: true,
				text: async () => JSON.stringify({
					candidates: [{
						content: {
							role: 'model',
							parts: [{ text: 'Part 1. ' }, { text: 'Part 2.' }],
						},
						finishReason: 'STOP',
					}],
				}),
			} as Response),
		};

		const result = await generateContent('AIza-test', 'gemini-test', request, undefined, transport);
		assert.strictEqual(result, 'Part 1. Part 2.');
	});

	test('rejects an oversized non-stream response body', async () => {
		const transport: GeminiTransport = {
			fetch: async () => {
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new Uint8Array(1024 * 1024 + 50));
						controller.close();
					},
				});
				return { ok: true, body } as Response;
			},
		};

		await assert.rejects(generateContent('AIza-test', 'gemini-test', request, undefined, transport), /size limit/);
	});
});

suite('classifyGeminiError', () => {
	test('classifies authentication errors safely without key logging', async () => {
		const { classifyGeminiError } = await import('./geminiClient.ts');
		const authErr = new Error(JSON.stringify({ code: 400, status: 'INVALID_ARGUMENT', message: 'API_KEY_INVALID' }));
		const res = classifyGeminiError(authErr);
		assert.strictEqual(res.status, 'authError');
		assert.strictEqual(res.retryable, false);
		assert.ok(res.safeMessage.includes('credential'));
	});

	test('classifies rate limit errors as retryable', async () => {
		const { classifyGeminiError } = await import('./geminiClient.ts');
		const rateErr = new Error(JSON.stringify({ code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' }));
		const res = classifyGeminiError(rateErr);
		assert.strictEqual(res.status, 'rateLimited');
		assert.strictEqual(res.retryable, true);
	});

	test('classifies model unavailable errors', async () => {
		const { classifyGeminiError } = await import('./geminiClient.ts');
		const modelErr = new Error(JSON.stringify({ code: 404, status: 'NOT_FOUND', message: 'models/gemini-old is not found' }));
		const res = classifyGeminiError(modelErr);
		assert.strictEqual(res.status, 'modelUnavailable');
		assert.strictEqual(res.retryable, false);
	});

	test('classifies network failures as retryable', async () => {
		const { classifyGeminiError } = await import('./geminiClient.ts');
		const netErr = new Error('fetch failed: getaddrinfo ENOTFOUND generativelanguage.googleapis.com');
		const res = classifyGeminiError(netErr);
		assert.strictEqual(res.status, 'networkError');
		assert.strictEqual(res.retryable, true);
	});

	test('classifies cancellation requests', async () => {
		const { classifyGeminiError } = await import('./geminiClient.ts');
		const cancelErr = new Error('Cancelled');
		const res = classifyGeminiError(cancelErr);
		assert.strictEqual(res.status, 'cancelled');
		assert.strictEqual(res.retryable, false);
	});
});



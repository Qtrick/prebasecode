/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	generateContentCandidate,
	streamGenerateContent,
	type GeminiCancellationToken,
	type GeminiTransport,
} from './geminiClient.js';

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

		assert.deepStrictEqual(chunks, ['Don', 'e']);
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

	test('disposes the request cancellation listener after a successful response', async () => {
		const token = new TestCancellationToken();
		const transport: GeminiTransport = {
			fetch: async () => ({
				ok: true,
				json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'Done' }] }, finishReason: 'STOP' }] }),
			} as Response),
		};

		const candidate = await generateContentCandidate('AIza-test', 'gemini-test', request, token, transport);
		assert.strictEqual(candidate?.content.parts[0].text, 'Done');
		assert.strictEqual(token.listenerCount, 0);
	});

	test('cancels a blocked SSE reader and never retries authentication or falls back to a second request', async () => {
		const token = new TestCancellationToken();
		let fetchCalls = 0;
		let observedSignal: AbortSignal | undefined;
		const transport: GeminiTransport = {
			fetch: async (_input, init) => {
				fetchCalls++;
				observedSignal = init?.signal as AbortSignal | undefined;
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						observedSignal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
					},
				});
				return { ok: true, body } as Response;
			},
		};

		const stream = streamGenerateContent('AIza-test', 'gemini-test', request, token, transport);
		const pending = stream.next();
		await Promise.resolve();
		token.cancel();

		assert.deepStrictEqual(await pending, { value: undefined, done: true });
		assert.strictEqual(observedSignal?.aborted, true);
		assert.strictEqual(fetchCalls, 1);
		assert.strictEqual(token.listenerCount, 0);
	});
});

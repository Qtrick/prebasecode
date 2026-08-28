/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { suite, test } from 'node:test';
import { scrapePublicUrl, searchFirecrawlCompact, type FirecrawlTransport } from './localFirecrawlClient';

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers(headers),
		json: async () => body,
	} as Response;
}

suite('local Firecrawl client', () => {
	test('sends scrape to v2/scrape with markdown/main-content and never puts the key in the URL', async () => {
		const sentinel = 'fc-secret-sentinel';
		let calledUrl = '';
		let calledHeaders: HeadersInit | undefined;
		let calledBody = '';
		const transport: FirecrawlTransport = {
			fetch: async (input, init) => {
				calledUrl = String(input);
				calledHeaders = init?.headers;
				calledBody = String(init?.body);
				return jsonResponse({
					success: true,
					data: { markdown: '# Hello', metadata: { title: 'Hello', url: 'https://example.com/doc' } },
				});
			},
		};
		const result = await scrapePublicUrl(sentinel, { url: 'https://example.com/doc', maxAge: 0, timeoutMs: 8_000 }, undefined, transport);
		assert.equal(calledUrl, 'https://api.firecrawl.dev/v2/scrape');
		assert.equal(calledUrl.includes(sentinel), false);
		assert.equal((calledHeaders as Record<string, string>).Authorization, `Bearer ${sentinel}`);
		const body = JSON.parse(calledBody);
		assert.deepEqual(body.formats, ['markdown']);
		assert.equal(body.onlyMainContent, true);
		assert.equal(body.removeBase64Images, true);
		assert.equal(body.blockAds, true);
		assert.equal(body.maxAge, 0);
		assert.equal(result.markdown, '# Hello');
	});

	test('Firecrawl Search stays compact and does not request markdown scrapeOptions', async () => {
		let calledBody = '';
		const transport: FirecrawlTransport = {
			fetch: async (_input, init) => {
				calledBody = String(init?.body);
				return jsonResponse({ data: { web: [{ title: 'Issue', url: 'https://github.com/x/y/issues/1', description: 'bug' }] } });
			},
		};
		const hits = await searchFirecrawlCompact('fc-key', 'github issue', ['github'], undefined, transport);
		const body = JSON.parse(calledBody);
		assert.equal(body.scrapeOptions, undefined);
		assert.equal(hits[0].url, 'https://github.com/x/y/issues/1');
	});

	test('cancels in-flight scrape without retrying', async () => {
		let calls = 0;
		const token = {
			isCancellationRequested: false,
			onCancellationRequested(listener: () => void) {
				queueMicrotask(() => {
					token.isCancellationRequested = true;
					listener();
				});
				return { dispose() { /* noop */ } };
			},
		};
		const transport: FirecrawlTransport = {
			fetch: async (_input, init) => {
				calls++;
				await new Promise((_, reject) => {
					init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
				});
				return jsonResponse({});
			},
		};
		await assert.rejects(scrapePublicUrl('fc-key', { url: 'https://example.com', maxAge: 0, timeoutMs: 8_000 }, token, transport), /Cancelled/);
		assert.equal(calls, 1);
	});

	test('rejects private destinations before calling Firecrawl', async () => {
		let called = false;
		const transport: FirecrawlTransport = {
			fetch: async () => {
				called = true;
				return jsonResponse({});
			},
		};
		await assert.rejects(scrapePublicUrl('fc-key', { url: 'http://127.0.0.1/secret', maxAge: 0, timeoutMs: 8_000 }, undefined, transport), /public http/);
		assert.equal(called, false);
	});

	test('rejects a private URL returned in scrape metadata', async () => {
		const transport: FirecrawlTransport = {
			fetch: async () => jsonResponse({
				success: true,
				data: { markdown: 'nope', metadata: { title: 'x', url: 'http://127.0.0.1/secret' } },
			}),
		};
		await assert.rejects(scrapePublicUrl('fc-key', { url: 'https://example.com', maxAge: 0, timeoutMs: 8_000 }, undefined, transport), /public http/);
	});

	test('retries a retryable scrape at most once', async () => {
		let calls = 0;
		const transport: FirecrawlTransport = {
			fetch: async () => {
				calls++;
				return jsonResponse({ success: false }, 503);
			},
		};
		await assert.rejects(scrapePublicUrl('fc-key', { url: 'https://example.com', maxAge: 0, timeoutMs: 8_000 }, undefined, transport), /HTTP 503/);
		assert.equal(calls, 2);
	});

	test('Firecrawl Search drops private hits and does not retry a 429', async () => {
		let calls = 0;
		const transport: FirecrawlTransport = {
			fetch: async () => {
				calls++;
				if (calls === 1) {
					return jsonResponse({
						data: {
							web: [
								{ title: 'Secret', url: 'http://127.0.0.1/admin', description: 'nope' },
								{ title: 'Public', url: 'https://github.com/x/y/issues/1', description: 'ok' },
							],
						},
					});
				}
				return jsonResponse({ success: false }, 429);
			},
		};
		const hits = await searchFirecrawlCompact('fc-key', 'github issue', ['github'], undefined, transport);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].url, 'https://github.com/x/y/issues/1');
		await assert.rejects(searchFirecrawlCompact('fc-key', 'github issue', ['github'], undefined, transport), /HTTP 429/);
		assert.equal(calls, 2);
	});

	test('cancels in-flight search without retrying', async () => {
		let calls = 0;
		const token = {
			isCancellationRequested: false,
			onCancellationRequested(listener: () => void) {
				queueMicrotask(() => {
					token.isCancellationRequested = true;
					listener();
				});
				return { dispose() { /* noop */ } };
			},
		};
		const transport: FirecrawlTransport = {
			fetch: async (_input, init) => {
				calls++;
				await new Promise((_, reject) => {
					init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
				});
				return jsonResponse({});
			},
		};
		await assert.rejects(searchFirecrawlCompact('fc-key', 'github issue', ['github'], token, transport), /Cancelled/);
		assert.equal(calls, 1);
	});

	test('aborts a hung scrape on timeout without a nested retry storm', async () => {
		let calls = 0;
		const transport: FirecrawlTransport = {
			fetch: async (_input, init) => {
				calls++;
				await new Promise((_, reject) => {
					init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
				});
				return jsonResponse({});
			},
		};
		await assert.rejects(scrapePublicUrl('fc-key', { url: 'https://example.com', maxAge: 0, timeoutMs: 30 }, undefined, transport), /timed out/);
		assert.equal(calls, 1);
	});
});

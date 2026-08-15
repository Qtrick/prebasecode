/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { suite, test } from 'node:test';
import { executeLocalLinkupSearch, type LocalLinkupSearchRequest, type LinkupTransport } from './localLinkupClient';

suite('Local LinkUp search client', () => {
	test('sends credentials in Authorization Bearer and never in URL', async () => {
		const sentinel = 'linkup-secret-sentinel';
		let calledUrl = '';
		let calledHeaders: Record<string, string> | undefined;
		let calledBody: string | undefined;

		const transport: LinkupTransport = {
			fetch: async (input, init) => {
				calledUrl = String(input);
				calledHeaders = init?.headers as Record<string, string>;
				calledBody = typeof init?.body === 'string' ? init.body : undefined;
				return {
					ok: true,
					json: async () => ({
						results: [
							{
								name: 'PreBase Official',
								url: 'https://prebase.dev/docs',
								content: 'PreBase is an AI developer environment.',
							},
						],
					}),
				} as Response;
			},
		};

		const response = await executeLocalLinkupSearch(
			sentinel,
			{ query: 'PreBase IDE', depth: 'standard', maxResults: 5 },
			undefined,
			transport,
		);

		assert.strictEqual(calledUrl.includes(sentinel), false);
		assert.strictEqual(calledHeaders?.['Authorization'], `Bearer ${sentinel}`);
		assert.strictEqual(calledHeaders?.['Content-Type'], 'application/json');
		assert.ok(calledBody?.includes('PreBase IDE'));

		assert.strictEqual(response.sources.length, 1);
		assert.strictEqual(response.sources[0].title, 'PreBase Official');
		assert.strictEqual(response.sources[0].url, 'https://prebase.dev/docs');
		assert.strictEqual(response.sources[0].excerpt, 'PreBase is an AI developer environment.');
		assert.strictEqual(response.truncated, false);
	});

	test('validates input boundaries and rejects invalid queries', async () => {
		await assert.rejects(
			executeLocalLinkupSearch('test-key', { query: '' }),
			/requires a query of 1 to 1,000 characters/,
		);
		await assert.rejects(
			executeLocalLinkupSearch('test-key', { query: 'a'.repeat(1001) }),
			/requires a query of 1 to 1,000 characters/,
		);
		await assert.rejects(
			executeLocalLinkupSearch('test-key', { query: 'valid', depth: 'invalid' as unknown as 'fast' }),
			/depth is invalid/,
		);
		await assert.rejects(
			executeLocalLinkupSearch('test-key', { query: 'valid', maxResults: 50 }),
			/maximum results must be an integer from 1 to 10/,
		);
	});

	test('filters out invalid or non-http URLs', async () => {
		const transport: LinkupTransport = {
			fetch: async () => ({
				ok: true,
				json: async () => ({
					results: [
						{ name: 'Invalid JS', url: 'javascript:alert(1)', content: 'bad' },
						{ name: 'Valid Doc', url: 'https://example.com/doc', content: 'good' },
						{ name: 'File URL', url: 'file:///etc/passwd', content: 'bad' },
					],
				}),
			}) as Response,
		};

		const response = await executeLocalLinkupSearch('key', { query: 'test' }, undefined, transport);
		assert.strictEqual(response.sources.length, 1);
		assert.strictEqual(response.sources[0].url, 'https://example.com/doc');
	});

	test('handles rate limit HTTP 429 and auth HTTP 401 cleanly', async () => {
		const authFailTransport: LinkupTransport = {
			fetch: async () => ({
				ok: false,
				status: 401,
				json: async () => ({}),
			}) as Response,
		};

		await assert.rejects(
			executeLocalLinkupSearch('bad-key', { query: 'test' }, undefined, authFailTransport),
			/authentication failed/,
		);

		const rateLimitTransport: LinkupTransport = {
			fetch: async () => ({
				ok: false,
				status: 429,
				json: async () => ({}),
			}) as Response,
		};

		await assert.rejects(
			executeLocalLinkupSearch('key', { query: 'test' }, undefined, rateLimitTransport),
			/rate limit exceeded/,
		);
	});
});

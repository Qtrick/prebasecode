/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
	DirectGeminiTransport,
	classifyGeminiHttpError,
} from './transports/directGeminiTransport';
import {
	HostedGeminiTransport,
	classifyHostedGatewayError,
} from './transports/hostedGeminiTransport';

describe('DirectGeminiTransport', () => {
	it('sends credentials strictly via x-goog-api-key header and never in URL', async () => {
		let capturedUrl = '';
		let capturedHeaders: Record<string, string> = {};
		let capturedBody = '';

		const mockFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
			capturedUrl = String(input);
			capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
			capturedBody = String(init?.body ?? '');

			return new Response(JSON.stringify({
				candidates: [{
					content: { parts: [{ text: 'Hello from direct Gemini' }], role: 'model' },
					finishReason: 'STOP',
				}],
			}), { status: 200 });
		};

		const transport = new DirectGeminiTransport({ fetchImpl: mockFetch });
		const result = await transport.generate(
			'test-google-key-12345',
			{
				modelId: 'gemini-2.5-flash',
				contents: [{ role: 'user', parts: [{ text: 'Ping' }] }],
			},
		);

		assert.equal(result.text, 'Hello from direct Gemini');
		assert.equal(capturedHeaders['x-goog-api-key'], 'test-google-key-12345');
		assert.equal(capturedHeaders['Authorization'], undefined);
		assert.ok(!capturedUrl.includes('test-google-key-12345'));
		assert.ok(!capturedBody.includes('test-google-key-12345'));
	});

	it('handles streaming SSE chunks and bounds accumulation', async () => {
		const sseBody = [
			'data: {"candidates":[{"content":{"parts":[{"text":"Part A"}],"role":"model"}}]}\n\n',
			'data: {"candidates":[{"content":{"parts":[{"text":" Part B"}],"role":"model"}}]}\n\n',
			'data: [DONE]\n\n',
		].join('');

		const mockFetch = async (): Promise<Response> => {
			return new Response(sseBody, {
				status: 200,
				headers: { 'Content-Type': 'text/event-stream' },
			});
		};

		const transport = new DirectGeminiTransport({ fetchImpl: mockFetch });
		const chunks: string[] = [];

		const result = await transport.streamGenerate(
			'test-key',
			{
				modelId: 'gemini-2.5-flash',
				contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
			},
			chunk => {
				if (chunk.text) {
					chunks.push(chunk.text);
				}
			},
		);

		assert.equal(chunks.join(''), 'Part A Part B');
		assert.equal(result.text, 'Part A Part B');
	});

	it('classifies direct HTTP errors with safe messages', () => {
		const authErr = classifyGeminiHttpError(new Error('API key not valid. Please pass a valid API key. (HTTP 400)'));
		assert.equal(authErr.code, 'authentication');
		assert.equal(authErr.retryable, false);

		const rateErr = classifyGeminiHttpError(new Error('RESOURCE_EXHAUSTED: Quota exceeded for quota metric (HTTP 429)'));
		assert.equal(rateErr.code, 'rateLimited');
		assert.equal(rateErr.retryable, true);

		const cancelErr = classifyGeminiHttpError(new Error('AbortError: The operation was aborted.'));
		assert.equal(cancelErr.code, 'cancelled');
		assert.equal(cancelErr.retryable, false);
	});

	it('discovers models across multiple pages and filters out specialized modalities', async () => {
		const requestedUrls: string[] = [];

		const mockFetch = async (input: string | URL): Promise<Response> => {
			const url = String(input);
			requestedUrls.push(url);

			if (!url.includes('pageToken')) {
				// Page 1
				return new Response(JSON.stringify({
					models: [
						{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
						{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
						{ name: 'models/imagen-3.0-generate-002', displayName: 'Imagen 3', supportedGenerationMethods: ['generateContent'] },
						{ name: 'models/gemini-robotics-er-2', displayName: 'Robotics ER 2', supportedGenerationMethods: ['generateContent'] },
					],
					nextPageToken: 'page2-token-abc',
				}), { status: 200 });
			} else {
				// Page 2
				return new Response(JSON.stringify({
					models: [
						{ name: 'models/gemini-3.7-flash', displayName: 'Gemini 3.7 Flash', supportedGenerationMethods: ['generateContent'] },
						{ name: 'models/text-embedding-004', displayName: 'Text Embedding', supportedGenerationMethods: ['embedContent'] },
						{ name: 'models/veo-3.1-generate', displayName: 'Veo 3.1', supportedGenerationMethods: ['generateContent'] },
					],
				}), { status: 200 });
			}
		};

		const transport = new DirectGeminiTransport({ fetchImpl: mockFetch });
		const discovered = await transport.discoverModels('test-key');

		// Assert pagination occurred
		assert.equal(requestedUrls.length, 2);
		assert.ok(requestedUrls[1].includes('pageToken=page2-token-abc'));

		// Assert models discovered
		const ids = discovered.map(m => m.id);
		assert.ok(ids.includes('gemini-2.5-flash'));
		assert.ok(ids.includes('gemini-2.5-pro'));
		assert.ok(ids.includes('gemini-3.7-flash'));

		// Assert specialized non-coding models were excluded
		assert.ok(!ids.includes('imagen-3.0-generate-002'));
		assert.ok(!ids.includes('gemini-robotics-er-2'));
		assert.ok(!ids.includes('text-embedding-004'));
		assert.ok(!ids.includes('veo-3.1-generate'));
	});
});

describe('HostedGeminiTransport', () => {
	it('dispatches to gatewayClient or edge function endpoint with Bearer auth', async () => {
		let capturedUrl = '';
		let capturedHeaders: Record<string, string> = {};

		const mockFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
			capturedUrl = String(input);
			capturedHeaders = (init?.headers ?? {}) as Record<string, string>;

			return new Response(JSON.stringify({
				model: 'gemini-2.5-flash',
				text: 'Hello from hosted gateway',
			}), { status: 200 });
		};

		const transport = new HostedGeminiTransport({
			gatewayUrl: 'https://test-project.supabase.co',
			publishableKey: 'sb-publishable-key-999',
			getAccessToken: async () => 'mock-jwt-user-access-token',
			fetchImpl: mockFetch,
		});

		const result = await transport.generate({
			modelId: 'gemini-2.5-flash',
			contents: [{ role: 'user', parts: [{ text: 'Ping' }] }],
		});

		assert.equal(result.text, 'Hello from hosted gateway');
		assert.equal(result.executionMode, 'hosted');
		assert.equal(capturedUrl, 'https://test-project.supabase.co/functions/v1/agent-gateway');
		assert.equal(capturedHeaders['Authorization'], 'Bearer mock-jwt-user-access-token');
		assert.equal(capturedHeaders['apikey'], 'sb-publishable-key-999');
	});

	it('classifies hosted errors accurately', () => {
		const authErr = classifyHostedGatewayError(new Error('Sign in to PreBase Cloud before using hosted AI.'));
		assert.equal(authErr.code, 'hostedAuthenticationRequired');
		assert.equal(authErr.retryable, false);

		const quotaErr = classifyHostedGatewayError(new Error('Usage rate limit or daily quota exceeded (HTTP 429)'));
		assert.equal(quotaErr.code, 'quotaExceeded');
		assert.equal(quotaErr.retryable, true);

		const unavailErr = classifyHostedGatewayError(new Error('Gateway is misconfigured or closed (HTTP 503)'));
		assert.equal(unavailErr.code, 'hostedUnavailable');
		assert.equal(unavailErr.retryable, true);
	});
});

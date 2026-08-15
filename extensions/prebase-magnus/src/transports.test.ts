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

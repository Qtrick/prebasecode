/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	DirectGeminiTransport,
	classifyGeminiHttpError,
	serializeGeminiRequest,
	parseGeminiResponsePart,
} from './transports/directGeminiTransport';
import {
	HostedGeminiTransport,
	classifyHostedGatewayError,
} from './transports/hostedGeminiTransport';
import type { AIGenerateRequest, AIToolDeclaration } from './aiTypes';

describe('Gemini Protocol & Schema Serialization', () => {
	it('serializes function declarations using parametersJsonSchema without dropping additionalProperties', () => {
		const request: AIGenerateRequest = {
			modelId: 'gemini-2.5-flash',
			contents: [{ role: 'user', parts: [{ text: 'Search for TypeScript' }] }],
			tools: [
				{
					name: 'prebase_web_search',
					description: 'Search the web using LinkUp API',
					inputSchema: {
						type: 'object',
						properties: {
							query: { type: 'string', minLength: 1, maxLength: 1000 },
							depth: { type: 'string', enum: ['fast', 'standard', 'deep'] },
							maxResults: { type: 'integer', minimum: 1, maximum: 10 },
						},
						required: ['query'],
						additionalProperties: false,
					},
				},
			],
		};

		const payload = serializeGeminiRequest(request);
		const tools = payload.tools as Array<{ functionDeclarations: Array<Record<string, unknown>> }>;
		assert.ok(tools && tools.length === 1);
		const decl = tools[0].functionDeclarations[0];
		assert.equal(decl.name, 'prebase_web_search');
		assert.equal(decl.description, 'Search the web using LinkUp API');
		assert.equal(decl.parameters, undefined, 'parameters field should NOT be used');
		assert.ok(decl.parametersJsonSchema, 'parametersJsonSchema field MUST be used');

		const schema = decl.parametersJsonSchema as Record<string, unknown>;
		assert.equal(schema.type, 'object');
		assert.equal(schema.additionalProperties, false, 'additionalProperties: false MUST be preserved');
		assert.deepEqual(schema.required, ['query']);
	});

	it('serializes multi-turn function calls and responses preserving IDs and thought signatures', () => {
		const request: AIGenerateRequest = {
			modelId: 'gemini-2.5-flash',
			contents: [
				{ role: 'user', parts: [{ text: 'Search' }] },
				{
					role: 'model',
					parts: [
						{
							functionCall: { id: 'call_12345', name: 'prebase_web_search', args: { query: 'TypeScript 7' } },
							thoughtSignature: 'opaque-signature-token-xyz',
							thought: true,
						},
					],
				},
				{
					role: 'user',
					parts: [
						{
							functionResponse: {
								id: 'call_12345',
								name: 'prebase_web_search',
								response: { result: 'TypeScript 7 released.' },
							},
						},
					],
				},
			],
		};

		const payload = serializeGeminiRequest(request);
		const contents = payload.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
		assert.equal(contents.length, 3);

		// Turn 2 (model): preserves functionCall with id and thoughtSignature
		const modelPart = contents[1].parts[0];
		const fc = modelPart.functionCall as Record<string, unknown>;
		assert.equal(fc.id, 'call_12345');
		assert.equal(fc.name, 'prebase_web_search');
		assert.equal(modelPart.thoughtSignature, 'opaque-signature-token-xyz');
		assert.equal(modelPart.thought, true);

		// Turn 3 (user functionResponse): preserves matching id
		const userPart = contents[2].parts[0];
		const fr = userPart.functionResponse as Record<string, unknown>;
		assert.equal(fr.id, 'call_12345');
		assert.equal(fr.name, 'prebase_web_search');
	});

	it('parses raw Gemini candidates preserving functionCall IDs and thought signatures', () => {
		const rawPart = {
			functionCall: {
				id: 'call_abc_999',
				name: 'prebase_workspace_search',
				args: { query: 'export function' },
			},
			thoughtSignature: 'base64-thought-signature-bytes',
			thought: false,
		};

		const parsed = parseGeminiResponsePart(rawPart);
		assert.equal(parsed.functionCall?.id, 'call_abc_999');
		assert.equal(parsed.functionCall?.name, 'prebase_workspace_search');
		assert.deepEqual(parsed.functionCall?.args, { query: 'export function' });
		assert.equal(parsed.thoughtSignature, 'base64-thought-signature-bytes');
	});

	it('parses thought_signature snake_case variant from Gemini API', () => {
		const rawPart = {
			functionCall: {
				name: 'prebase_read_file',
				args: { path: 'src/vs/editor.ts' },
			},
			thought_signature: 'snake_case_signature_token',
		};

		const parsed = parseGeminiResponsePart(rawPart);
		assert.equal(parsed.functionCall?.name, 'prebase_read_file');
		assert.equal(parsed.thoughtSignature, 'snake_case_signature_token');
	});

	it('validates schema serialization matrix for all 38 contributing Magnus tools', () => {
		const currentDir = path.dirname(fileURLToPath(import.meta.url));
		const pkgPath = path.resolve(currentDir, '../package.json');
		const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
		const tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = pkg.contributes?.languageModelTools ?? [];
		assert.ok(tools.length >= 35, `Expected at least 35 tools, found ${tools.length}`);

		const declarations: AIToolDeclaration[] = tools.map(t => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema,
		}));

		const request: AIGenerateRequest = {
			modelId: 'gemini-2.5-flash',
			contents: [{ role: 'user', parts: [{ text: 'Tool test' }] }],
			tools: declarations,
		};

		const payload = serializeGeminiRequest(request);
		const toolList = payload.tools as Array<{ functionDeclarations: Array<Record<string, unknown>> }>;
		assert.equal(toolList.length, 1);
		const decls = toolList[0].functionDeclarations;
		assert.equal(decls.length, tools.length);

		for (const [i, decl] of decls.entries()) {
			const original = tools[i];
			assert.equal(decl.name, original.name);
			assert.equal(decl.description, original.description);
			assert.equal(decl.parameters, undefined);
			assert.ok(decl.parametersJsonSchema, `Tool ${original.name} missing parametersJsonSchema`);
			assert.deepEqual(decl.parametersJsonSchema, original.inputSchema);
		}
	});
});

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

	it('serializes reasoning effort accurately for Gemini 3.x vs Gemini 2.5 vs default', () => {
		// Gemini 3.x thinkingLevel
		const g3Minimal = serializeGeminiRequest({
			modelId: 'gemini-3.7-flash',
			contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
			reasoningEffort: 'minimal',
		});
		assert.deepEqual(
			(g3Minimal.generationConfig as Record<string, unknown>)?.thinkingConfig,
			{ thinkingLevel: 'MINIMAL' }
		);

		const g3High = serializeGeminiRequest({
			modelId: 'gemini-3.7-flash',
			contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
			reasoningEffort: 'high',
		});
		assert.deepEqual(
			(g3High.generationConfig as Record<string, unknown>)?.thinkingConfig,
			{ thinkingLevel: 'HIGH' }
		);

		// Gemini 2.5 thinkingBudget
		const g25Low = serializeGeminiRequest({
			modelId: 'gemini-2.5-flash',
			contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
			reasoningEffort: 'low',
		});
		assert.deepEqual(
			(g25Low.generationConfig as Record<string, unknown>)?.thinkingConfig,
			{ thinkingBudget: 2048 }
		);

		// Default reasoning: thinkingConfig omitted
		const g25Default = serializeGeminiRequest({
			modelId: 'gemini-2.5-flash',
			contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
			reasoningEffort: 'default',
		});
		assert.equal(
			(g25Default.generationConfig as Record<string, unknown>)?.thinkingConfig,
			undefined
		);
	});

	it('filters thought parts from visible answer text and captures usageMetadata in generate and streamGenerate', async () => {
		const mockFetchGenerate = async (): Promise<Response> => {
			return new Response(JSON.stringify({
				candidates: [{
					content: {
						role: 'model',
						parts: [
							{ text: 'Thinking about the architecture...', thought: true },
							{ text: 'Final concise summary of the module.' },
						],
					},
					finishReason: 'STOP',
				}],
				usageMetadata: {
					promptTokenCount: 120,
					candidatesTokenCount: 15,
					thoughtsTokenCount: 85,
					totalTokenCount: 220,
				},
			}), { status: 200 });
		};

		const directTransport = new DirectGeminiTransport({ fetchImpl: mockFetchGenerate });
		const result = await directTransport.generate('test-key', {
			modelId: 'gemini-2.5-flash',
			contents: [{ role: 'user', parts: [{ text: 'Describe' }] }],
		});

		assert.equal(result.text, 'Final concise summary of the module.');
		assert.ok(!result.text.includes('Thinking about'));
		assert.deepEqual(result.usageMetadata, {
			promptTokenCount: 120,
			candidatesTokenCount: 15,
			thoughtsTokenCount: 85,
			totalTokenCount: 220,
		});

		// Streaming thought filter
		const sseBody = [
			'data: {"candidates":[{"content":{"parts":[{"text":"Thinking hidden step...","thought":true}],"role":"model"}}]}\n\n',
			'data: {"candidates":[{"content":{"parts":[{"text":"Visible answer chunk."}],"role":"model"}}],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":10,"thoughtsTokenCount":50,"totalTokenCount":160}}\n\n',
			'data: [DONE]\n\n',
		].join('');

		const mockFetchStream = async (): Promise<Response> => {
			return new Response(sseBody, {
				status: 200,
				headers: { 'Content-Type': 'text/event-stream' },
			});
		};

		const directStreamTransport = new DirectGeminiTransport({ fetchImpl: mockFetchStream });
		const streamedChunks: string[] = [];

		const streamRes = await directStreamTransport.streamGenerate('test-key', {
			modelId: 'gemini-2.5-flash',
			contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
		}, chunk => {
			if (chunk.text) {
				streamedChunks.push(chunk.text);
			}
		});

		assert.equal(streamedChunks.join(''), 'Visible answer chunk.');
		assert.equal(streamRes.text, 'Visible answer chunk.');
		assert.deepEqual(streamRes.usageMetadata, {
			promptTokenCount: 100,
			candidatesTokenCount: 10,
			thoughtsTokenCount: 50,
			totalTokenCount: 160,
		});
	});
});

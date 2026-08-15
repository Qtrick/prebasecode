/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Direct HTTP client for the Gemini Generative Language API.
 *
 * Sends Google AI Studio credentials only in the documented x-goog-api-key
 * header. In particular, credentials must never be placed in request URLs.
 */

import type { MagnusDescriptionStatus } from './models';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_NON_STREAM_RESPONSE_BYTES = 1 * 1024 * 1024; // 1 MiB max response size
const MAX_SSE_BUFFER_BYTES = 1 * 1024 * 1024; // 1 MiB max accumulated SSE buffer

export type GeminiRole = 'user' | 'model';

export interface GeminiPart {
	text?: string;
	inlineData?: { mimeType: string; data: string };
	functionCall?: { name: string; args?: Record<string, unknown> };
	functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
	role: GeminiRole;
	parts: GeminiPart[];
}

export interface GenerateRequest {
	contents: GeminiContent[];
	systemInstruction?: { parts: GeminiPart[] };
	generationConfig?: Record<string, unknown>;
	tools?: Array<{ googleSearch: Record<string, never> } | { functionDeclarations: unknown[] }>;
}

export interface GeminiResponseCandidate {
	content: { parts: GeminiPart[]; role: string };
	finishReason: string;
}

export interface GeminiResponse {
	candidates?: GeminiResponseCandidate[];
	error?: { code: number; message: string; status: string };
}

export interface GeminiRawModel {
	name?: string;
	version?: string;
	displayName?: string;
	description?: string;
	inputTokenLimit?: number;
	outputTokenLimit?: number;
	supportedGenerationMethods?: string[];
	temperature?: number;
	topP?: number;
	topK?: number;
}

export interface GeminiModelsListResponse {
	models?: GeminiRawModel[];
	nextPageToken?: string;
	error?: { code: number; message: string; status: string };
}

export interface DiscoveredGeminiModel {
	readonly id: string; // e.g. "gemini-2.5-flash"
	readonly name: string; // e.g. "models/gemini-2.5-flash"
	readonly displayName: string;
	readonly description: string;
	readonly inputTokenLimit: number;
	readonly outputTokenLimit: number;
	readonly supportedGenerationMethods: readonly string[];
	readonly agentCompatible: boolean;
	readonly descriptionCompatible: boolean;
}

export interface GeminiCancellationToken {
	readonly isCancellationRequested: boolean;
	readonly onCancellationRequested?: (listener: () => void) => { dispose(): void };
}

export interface GeminiTransport {
	fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

interface CancellationBridge {
	readonly signal: AbortSignal;
	dispose(): void;
}

function bridgeCancellation(token: GeminiCancellationToken | undefined): CancellationBridge {
	const controller = new AbortController();
	if (token?.isCancellationRequested) {
		controller.abort();
	}
	const subscription = token?.onCancellationRequested?.(() => controller.abort());
	return {
		signal: controller.signal,
		dispose: () => subscription?.dispose(),
	};
}

/**
 * Reads a response body safely with an explicit byte bound.
 */
async function readBoundedResponseBody(res: Response, maxBytes: number = MAX_NON_STREAM_RESPONSE_BYTES): Promise<string> {
	if (!res.body) {
		if (typeof res.text === 'function') {
			return res.text();
		}
		if (typeof (res as unknown as { json?: () => Promise<unknown> }).json === 'function') {
			const j = await (res as unknown as { json: () => Promise<unknown> }).json();
			return JSON.stringify(j);
		}
		return '';
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let totalBytes = 0;
	let text = '';
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			await reader.cancel();
			throw new Error(`Gemini response exceeded the ${Math.round(maxBytes / 1024)} KiB size limit.`);
		}
		text += decoder.decode(value, { stream: true });
	}
	text += decoder.decode();
	return text;
}

/**
 * Lists models available from the Gemini API using documented models.list endpoint.
 * Paginates automatically and normalizes models with capability metadata.
 */
export async function listGeminiModels(
	apiKey: string,
	token?: GeminiCancellationToken,
	transport: GeminiTransport = globalThis,
): Promise<DiscoveredGeminiModel[]> {
	if (token?.isCancellationRequested) {
		throw new Error('Cancelled');
	}

	const discovered: DiscoveredGeminiModel[] = [];
	let pageToken: string | undefined;

	do {
		const url = new URL(`${BASE_URL}/models`);
		url.searchParams.set('pageSize', '50');
		if (pageToken) {
			url.searchParams.set('pageToken', pageToken);
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'x-goog-api-key': apiKey,
		};

		const cancellation = bridgeCancellation(token);
		try {
			const res = await transport.fetch(url.toString(), {
				method: 'GET',
				headers,
				signal: cancellation.signal,
			});

			const rawText = await readBoundedResponseBody(res, MAX_NON_STREAM_RESPONSE_BYTES);
			let json: GeminiModelsListResponse;
			try {
				json = JSON.parse(rawText) as GeminiModelsListResponse;
			} catch (err) {
				throw new Error(JSON.stringify({
					code: res.status,
					message: `Failed to parse models response: ${err instanceof Error ? err.message : String(err)}`,
				}));
			}

			if (!res.ok || json.error) {
				throw new Error(JSON.stringify(json.error ?? { code: res.status, message: `HTTP ${res.status}` }));
			}

			for (const raw of json.models ?? []) {
				const rawName = raw.name ?? '';
				const id = rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
				if (!id) {
					continue;
				}

				const methods = raw.supportedGenerationMethods ?? [];
				const supportsGenerate = methods.includes('generateContent');
				// Text generation models are description compatible
				const descriptionCompatible = supportsGenerate;
				// Filter for agent compatibility: generateContent is required; exclude embedding/image/sound only
				const isEmbeddingOnly = methods.length === 1 && (methods[0] === 'embedContent' || methods[0] === 'batchEmbedContents');
				const isImageOnly = id.includes('imagen') || id.includes('image-generation');
				const isAudioOnly = id.includes('chirp') || id.includes('native-audio');
				const isDeprecated = id.includes('1.0') || id.includes('1.5') || id.includes('experimental');
				const agentCompatible = supportsGenerate && !isEmbeddingOnly && !isImageOnly && !isAudioOnly && !isDeprecated;

				discovered.push({
					id,
					name: rawName,
					displayName: raw.displayName || id,
					description: raw.description || '',
					inputTokenLimit: raw.inputTokenLimit || 1_000_000,
					outputTokenLimit: raw.outputTokenLimit || 65_536,
					supportedGenerationMethods: methods,
					agentCompatible,
					descriptionCompatible,
				});
			}

			pageToken = json.nextPageToken;
		} finally {
			cancellation.dispose();
		}
	} while (pageToken && discovered.length < 200);

	return discovered;
}

async function tryAuth(
	apiKey: string,
	model: string,
	body: GenerateRequest,
	token?: GeminiCancellationToken,
	transport: GeminiTransport = globalThis,
): Promise<GeminiResponseCandidate | undefined> {
	if (token?.isCancellationRequested) {
		throw new Error('Cancelled');
	}

	const url = `${BASE_URL}/models/${model}:generateContent`;
	const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };

	const cancellation = bridgeCancellation(token);
	try {
		const res = await transport.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: cancellation.signal });
		let json: GeminiResponse;
		try {
			const rawText = await readBoundedResponseBody(res, MAX_NON_STREAM_RESPONSE_BYTES);
			json = JSON.parse(rawText) as GeminiResponse;
		} catch (err) {
			if (err instanceof Error && err.message.includes('size limit')) {
				throw err;
			}
			throw new Error(JSON.stringify({ code: res.status, message: `Failed to parse response: ${err instanceof Error ? err.message : String(err)}` }));
		}

		if (!res.ok || json.error) {
			throw new Error(JSON.stringify(json.error ?? { code: res.status, message: `HTTP ${res.status}` }));
		}

		return json.candidates?.[0];
	} finally {
		cancellation.dispose();
	}
}

export async function generateContentCandidate(
	apiKey: string,
	model: string,
	body: GenerateRequest,
	token?: GeminiCancellationToken,
	transport: GeminiTransport = globalThis,
): Promise<GeminiResponseCandidate | undefined> {
	return tryAuth(apiKey, model, body, token, transport);
}

export async function generateContent(
	apiKey: string,
	model: string,
	body: GenerateRequest,
	token?: GeminiCancellationToken,
	transport: GeminiTransport = globalThis,
): Promise<string> {
	const candidate = await generateContentCandidate(apiKey, model, body, token, transport);
	const textParts = (candidate?.content?.parts ?? [])
		.map(p => p.text ?? '')
		.join('');
	return textParts.trim();
}

/**
 * Stream-ish helper: Gemini non-stream generateContent, then emit the text in chunks
 * for chat UX. Uses streamGenerateContent when available; falls back to chunking.
 */
export async function* streamGenerateContent(
	apiKey: string,
	model: string,
	body: GenerateRequest,
	token?: GeminiCancellationToken,
	transport: GeminiTransport = globalThis,
): AsyncGenerator<string, void, unknown> {
	const streamUrl = `${BASE_URL}/models/${model}:streamGenerateContent?alt=sse`;
	const maxSseBufferBytes = MAX_SSE_BUFFER_BYTES;

	const tryStream = async (): Promise<{ response: Response; cancellation: CancellationBridge } | undefined> => {
		const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
		const cancellation = bridgeCancellation(token);
		try {
			const response = await transport.fetch(streamUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: cancellation.signal });
			if (!response.ok) {
				cancellation.dispose();
				return undefined;
			}
			return { response, cancellation };
		} catch (error) {
			cancellation.dispose();
			throw error;
		}
	};

	let stream: { response: Response; cancellation: CancellationBridge } | undefined;
	try {
		stream = await tryStream();
		if (stream?.response.body) {
			const reader = stream.response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let accumulatedBytes = 0;
			while (true) {
				if (token?.isCancellationRequested) {
					await reader.cancel();
					return;
				}
				const { done, value } = await reader.read();
				if (done) {
					return;
				}
				accumulatedBytes += value.byteLength;
				if (accumulatedBytes > maxSseBufferBytes) {
					throw new Error('Gemini SSE response exceeded the 1 MiB framing limit.');
				}
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith('data:')) {
						continue;
					}
					const payload = trimmed.slice(5).trim();
					if (!payload || payload === '[DONE]') {
						continue;
					}
					try {
						const json = JSON.parse(payload) as GeminiResponse;
						const text = json.candidates?.[0]?.content?.parts
							?.map(p => p.text ?? '')
							.join('') ?? '';
						if (text) {
							yield text;
						}
					} catch {
						// ignore malformed SSE chunks
					}
				}
			}
		}
	} catch (error) {
		if (token?.isCancellationRequested) {
			return;
		}
		if (error instanceof Error && error.message.includes('SSE response exceeded')) {
			throw error;
		}
	} finally {
		stream?.cancellation.dispose();
	}

	if (token?.isCancellationRequested) {
		return;
	}
	const full = await generateContent(apiKey, model, body, token, transport);
	// Match paced UI fallback (~3 chars / 22ms) when SSE is unavailable.
	for (let i = 0; i < full.length; i += 3) {
		if (token?.isCancellationRequested) {
			return;
		}
		yield full.slice(i, i + 3);
		await new Promise(resolve => setTimeout(resolve, 22));
	}
}

/**
 * Normalizes provider errors into structured, user-safe status objects without leaking secrets.
 */
export function classifyGeminiError(error: unknown): {
	status: MagnusDescriptionStatus;
	safeMessage: string;
	retryable: boolean;
} {
	if (!error) {
		return { status: 'error', safeMessage: 'Unknown provider error occurred.', retryable: true };
	}

	const rawMsg = error instanceof Error ? error.message : String(error);

	if (rawMsg.includes('Cancelled') || rawMsg.includes('AbortError') || rawMsg.includes('aborted')) {
		return { status: 'cancelled', safeMessage: 'Request was cancelled.', retryable: false };
	}

	if (rawMsg.includes('size limit') || rawMsg.includes('exceeded the 1 MiB')) {
		return { status: 'error', safeMessage: 'Gemini response exceeded size limit.', retryable: false };
	}

	// Try parsing JSON error structure from tryAuth / listGeminiModels
	try {
		const parsed = JSON.parse(rawMsg) as { code?: number; message?: string; status?: string };
		const code = parsed.code;
		const statusStr = parsed.status ?? '';

		if (code === 400 && (statusStr === 'INVALID_ARGUMENT' || parsed.message?.includes('API_KEY_INVALID') || parsed.message?.includes('API key not valid'))) {
			return {
				status: 'authError',
				safeMessage: 'The configured Gemini credential was found but Google rejected it. Check the key\'s current Gemini API authorization/restriction status.',
				retryable: false,
			};
		}
		if (code === 401 || code === 403 || statusStr === 'PERMISSION_DENIED' || statusStr === 'UNAUTHENTICATED') {
			return {
				status: 'authError',
				safeMessage: 'Gemini authentication failed. Check the key\'s current Gemini API authorization/restriction status.',
				retryable: false,
			};
		}
		if (code === 429 || statusStr === 'RESOURCE_EXHAUSTED' || parsed.message?.includes('quota') || parsed.message?.includes('rate limit')) {
			return { status: 'rateLimited', safeMessage: 'Gemini API is temporarily rate limited. Please retry in a moment.', retryable: true };
		}
		if (code === 404 || statusStr === 'NOT_FOUND' || parsed.message?.includes('models/')) {
			return { status: 'modelUnavailable', safeMessage: 'The selected Gemini model is currently unavailable.', retryable: false };
		}
		if (code && code >= 500) {
			return { status: 'error', safeMessage: `Gemini service error (${code}). Please retry.`, retryable: true };
		}
	} catch {
		// Not JSON
	}

	if (rawMsg.includes('fetch failed') || rawMsg.includes('ENOTFOUND') || rawMsg.includes('ECONNREFUSED') || rawMsg.includes('network') || rawMsg.includes('ETIMEDOUT')) {
		return { status: 'networkError', safeMessage: 'Could not reach Gemini API. Please check your network connection.', retryable: true };
	}

	return { status: 'error', safeMessage: 'Gemini request encountered an error.', retryable: true };
}

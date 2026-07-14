/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Direct HTTP client for the Gemini Generative Language API.
 *
 * Supports classic API keys (AIza…) via query/`x-goog-api-key`, and newer
 * "AQ." bearer credentials via Authorization header.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export type GeminiRole = 'user' | 'model';

export interface GeminiPart {
	text?: string;
	inlineData?: { mimeType: string; data: string };
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

interface GeminiResponseCandidate {
	content: { parts: GeminiPart[]; role: string };
	finishReason: string;
}

interface GeminiResponse {
	candidates?: GeminiResponseCandidate[];
	error?: { code: number; message: string; status: string };
}

async function tryAuth(
	apiKey: string,
	model: string,
	body: GenerateRequest,
	method: 'query' | 'header' | 'bearer',
	token?: { isCancellationRequested: boolean },
): Promise<GeminiResponseCandidate | undefined> {
	if (token?.isCancellationRequested) {
		throw new Error('Cancelled');
	}

	const baseUrl = `${BASE_URL}/models/${model}:generateContent`;
	const url = method === 'query'
		? `${baseUrl}?key=${encodeURIComponent(apiKey)}`
		: baseUrl;

	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (method === 'header') {
		headers['x-goog-api-key'] = apiKey;
	}
	if (method === 'bearer') {
		headers['Authorization'] = `Bearer ${apiKey}`;
	}

	const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
	const json = await res.json() as GeminiResponse;

	if (!res.ok || json.error) {
		throw new Error(JSON.stringify(json.error ?? { code: res.status, message: `HTTP ${res.status}` }));
	}

	return json.candidates?.[0];
}

async function generateCandidate(
	apiKey: string,
	model: string,
	body: GenerateRequest,
	token?: { isCancellationRequested: boolean },
): Promise<GeminiResponseCandidate | undefined> {
	const methods: Array<'header' | 'query' | 'bearer'> = ['header', 'query', 'bearer'];
	let lastError: Error | undefined;

	for (const method of methods) {
		try {
			return await tryAuth(apiKey, model, body, method, token);
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			const msg = lastError.message.toLowerCase();
			const isAuthError =
				msg.includes('api_key_invalid') ||
				msg.includes('api_key_service_blocked') ||
				msg.includes('unauthenticated') ||
				msg.includes('invalid_argument') ||
				msg.includes('"code":400') ||
				msg.includes('"code":401') ||
				msg.includes('"code":403');
			if (!isAuthError) {
				break;
			}
		}
	}

	throw lastError ?? new Error('All auth methods failed');
}

export async function generateContent(
	apiKey: string,
	model: string,
	body: GenerateRequest,
	token?: { isCancellationRequested: boolean },
): Promise<string> {
	const candidate = await generateCandidate(apiKey, model, body, token);
	return (candidate?.content?.parts?.[0]?.text ?? '').trim();
}

/**
 * Stream-ish helper: Gemini non-stream generateContent, then emit the text in chunks
 * for chat UX. Uses streamGenerateContent when available; falls back to chunking.
 */
export async function* streamGenerateContent(
	apiKey: string,
	model: string,
	body: GenerateRequest,
	token?: { isCancellationRequested: boolean },
): AsyncGenerator<string, void, unknown> {
	const streamUrlBase = `${BASE_URL}/models/${model}:streamGenerateContent?alt=sse`;

	const tryStream = async (method: 'header' | 'query' | 'bearer'): Promise<Response | undefined> => {
		const url = method === 'query'
			? `${streamUrlBase}&key=${encodeURIComponent(apiKey)}`
			: streamUrlBase;
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (method === 'header') {
			headers['x-goog-api-key'] = apiKey;
		}
		if (method === 'bearer') {
			headers['Authorization'] = `Bearer ${apiKey}`;
		}
		const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
		if (!res.ok) {
			return undefined;
		}
		return res;
	};

	for (const method of ['header', 'query', 'bearer'] as const) {
		try {
			const res = await tryStream(method);
			if (!res?.body) {
				continue;
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				if (token?.isCancellationRequested) {
					await reader.cancel();
					return;
				}
				const { done, value } = await reader.read();
				if (done) {
					return;
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
		} catch {
			// try next auth method / fall through
		}
	}

	const full = await generateContent(apiKey, model, body, token);
	const chunkSize = 48;
	for (let i = 0; i < full.length; i += chunkSize) {
		if (token?.isCancellationRequested) {
			return;
		}
		yield full.slice(i, i + chunkSize);
	}
}

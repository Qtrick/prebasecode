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

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

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

interface GeminiResponse {
	candidates?: GeminiResponseCandidate[];
	error?: { code: number; message: string; status: string };
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
		const json = await res.json() as GeminiResponse;

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
	token?: GeminiCancellationToken,
	transport: GeminiTransport = globalThis,
): AsyncGenerator<string, void, unknown> {
	const streamUrl = `${BASE_URL}/models/${model}:streamGenerateContent?alt=sse`;
	const maxSseBufferBytes = 1 * 1024 * 1024;

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
				if (buffer.length > maxSseBufferBytes) {
					throw new Error('Gemini SSE response exceeded the 1 MiB framing limit.');
				}
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

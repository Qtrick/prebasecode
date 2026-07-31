/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Direct HTTP client for the Gemini Generative Language API.
 *
 * Credentials are only ever sent in a request header: classic API keys (AIza…)
 * via `x-goog-api-key`, newer "AQ." credentials via `Authorization: Bearer`.
 * They are never placed in the URL, because query strings end up in proxy logs,
 * crash dumps and network traces.
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

/**
 * Structural subset of `vscode.CancellationToken` so this module stays free of
 * the `vscode` import and remains unit-testable.
 */
export interface CancellationLike {
	readonly isCancellationRequested: boolean;
	onCancellationRequested?(listener: () => void): { dispose(): void };
}

type AuthMethod = 'header' | 'bearer';

interface GeminiResponseCandidate {
	content: { parts: GeminiPart[]; role: string };
	finishReason: string;
}

interface GeminiResponse {
	candidates?: GeminiResponseCandidate[];
	error?: { code: number; message: string; status: string };
}

/**
 * A Gemini failure with a message safe to show in chat. The raw payload is kept
 * on `detail` for logging only — it can contain quoted request content.
 */
export class GeminiRequestError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly detail: string,
		readonly isAuthFailure: boolean,
	) {
		super(message);
		this.name = 'GeminiRequestError';
	}
}

function userFacingMessage(status: number, apiMessage: string): string {
	switch (status) {
		case 400:
			return 'Gemini rejected the request. Check the selected model in Settings.';
		case 401:
		case 403:
			return 'Gemini rejected the API key. Run "Agents: Set Gemini API Key" to update it.';
		case 404:
			return 'The selected Gemini model is not available for this key.';
		case 429:
			return 'Gemini rate limit reached. Wait a moment and try again.';
		default:
			break;
	}
	if (status >= 500) {
		return 'Gemini is temporarily unavailable. Try again shortly.';
	}
	return apiMessage || `Gemini request failed (HTTP ${status}).`;
}

function isAuthStatus(status: number): boolean {
	return status === 400 || status === 401 || status === 403;
}

/**
 * Bridges a cancellation token to an `AbortSignal` so an in-flight request is
 * actually torn down on cancel rather than downloaded to completion.
 */
function abortOnCancel(token?: CancellationLike): { signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	if (token?.isCancellationRequested) {
		controller.abort();
		return { signal: controller.signal, dispose: () => { } };
	}
	const sub = token?.onCancellationRequested?.(() => controller.abort());
	return { signal: controller.signal, dispose: () => sub?.dispose() };
}

/** Release the socket for a response whose body we are not going to read. */
async function discardBody(res: Response): Promise<void> {
	try {
		await res.body?.cancel();
	} catch {
		// The connection is already gone; nothing to release.
	}
}

async function errorFromResponse(res: Response): Promise<GeminiRequestError> {
	let apiMessage = '';
	let detail = `HTTP ${res.status}`;
	try {
		const json = await res.json() as GeminiResponse;
		apiMessage = json.error?.message ?? '';
		detail = JSON.stringify(json.error ?? { code: res.status });
	} catch {
		await discardBody(res);
	}
	return new GeminiRequestError(
		userFacingMessage(res.status, apiMessage),
		res.status,
		detail,
		isAuthStatus(res.status),
	);
}

function headersFor(apiKey: string, method: AuthMethod): Record<string, string> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (method === 'header') {
		headers['x-goog-api-key'] = apiKey;
	} else {
		headers['Authorization'] = `Bearer ${apiKey}`;
	}
	return headers;
}

function authMethodsForKey(apiKey: string): AuthMethod[] {
	// Newer Google AI Studio credentials often start with "AQ" / "AQ." and need Bearer.
	return /^AQ[.A-Za-z0-9_-]/i.test(apiKey.trim())
		? ['bearer', 'header']
		: ['header', 'bearer'];
}

async function tryAuth(
	apiKey: string,
	model: string,
	body: GenerateRequest,
	method: AuthMethod,
	signal: AbortSignal,
): Promise<GeminiResponseCandidate | undefined> {
	const res = await fetch(`${BASE_URL}/models/${model}:generateContent`, {
		method: 'POST',
		headers: headersFor(apiKey, method),
		body: JSON.stringify(body),
		signal,
	});

	if (!res.ok) {
		throw await errorFromResponse(res);
	}

	const json = await res.json() as GeminiResponse;
	if (json.error) {
		throw new GeminiRequestError(
			userFacingMessage(json.error.code, json.error.message),
			json.error.code,
			JSON.stringify(json.error),
			isAuthStatus(json.error.code),
		);
	}
	return json.candidates?.[0];
}

async function generateCandidate(
	apiKey: string,
	model: string,
	body: GenerateRequest,
	token?: CancellationLike,
): Promise<GeminiResponseCandidate | undefined> {
	if (token?.isCancellationRequested) {
		throw new Error('Cancelled');
	}
	const { signal, dispose } = abortOnCancel(token);
	try {
		let lastError: Error | undefined;
		for (const method of authMethodsForKey(apiKey)) {
			try {
				return await tryAuth(apiKey, model, body, method, signal);
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				// Only an auth rejection is worth retrying with the other scheme.
				if (!(lastError instanceof GeminiRequestError) || !lastError.isAuthFailure) {
					break;
				}
			}
		}
		throw lastError ?? new Error('All auth methods failed');
	} finally {
		dispose();
	}
}

export async function generateContent(
	apiKey: string,
	model: string,
	body: GenerateRequest,
	token?: CancellationLike,
): Promise<string> {
	const candidate = await generateCandidate(apiKey, model, body, token);
	return (candidate?.content?.parts?.[0]?.text ?? '').trim();
}

/**
 * Streams `streamGenerateContent` over SSE. If no auth scheme yields a stream,
 * falls back to a single non-streamed request chunked for chat UX.
 */
export async function* streamGenerateContent(
	apiKey: string,
	model: string,
	body: GenerateRequest,
	token?: CancellationLike,
): AsyncGenerator<string, void, unknown> {
	const streamUrl = `${BASE_URL}/models/${model}:streamGenerateContent?alt=sse`;
	const { signal, dispose } = abortOnCancel(token);
	// An HTTP rejection means the API refused us and the non-streaming endpoint
	// will refuse us identically, so it is rethrown. A transport failure may just
	// mean SSE is blocked by a proxy, so it falls through to the non-stream path.
	let httpError: GeminiRequestError | undefined;

	try {
		for (const method of authMethodsForKey(apiKey)) {
			if (token?.isCancellationRequested) {
				return;
			}
			let res: Response;
			try {
				res = await fetch(streamUrl, {
					method: 'POST',
					headers: headersFor(apiKey, method),
					body: JSON.stringify(body),
					signal,
				});
			} catch {
				if (signal.aborted) {
					return;
				}
				continue;
			}

			if (!res.ok) {
				// Drain the body so the socket is returned to the pool before we
				// retry with the other auth scheme.
				httpError = await errorFromResponse(res);
				if (!httpError.isAuthFailure) {
					throw httpError;
				}
				continue;
			}
			if (!res.body) {
				await discardBody(res);
				continue;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			try {
				while (true) {
					if (token?.isCancellationRequested) {
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
							// Ignore malformed SSE chunks.
						}
					}
				}
			} finally {
				// Covers early return from cancellation and from the consumer
				// abandoning the generator.
				await reader.cancel().catch(() => { });
			}
		}
	} finally {
		dispose();
	}

	if (token?.isCancellationRequested) {
		return;
	}
	if (httpError) {
		throw httpError;
	}

	const full = await generateContent(apiKey, model, body, token);
	// Match paced UI fallback (~3 chars / 22ms) when SSE is unavailable.
	for (let i = 0; i < full.length; i += 3) {
		if (token?.isCancellationRequested) {
			return;
		}
		yield full.slice(i, i + 3);
		await new Promise(resolve => setTimeout(resolve, 22));
	}
}

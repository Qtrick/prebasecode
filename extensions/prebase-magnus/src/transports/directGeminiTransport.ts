/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	AICancellationToken,
	AIContentPart,
	AIGenerateRequest,
	AIGenerateResponseCandidate,
	AIGenerateResult,
	AIProviderErrorClassification,
	AIResponseDisposition,
	NormalizedAIModel,
} from '../aiTypes';

const GOOGLE_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_NON_STREAM_RESPONSE_BYTES = 1 * 1024 * 1024; // 1 MiB max response size
const MAX_SSE_BUFFER_BYTES = 1 * 1024 * 1024; // 1 MiB max accumulated SSE buffer

export interface DirectGeminiTransportOptions {
	baseUrl?: string;
	fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

export function classifyGeminiResponseDisposition(
	data: {
		candidates?: Array<{
			content?: { parts?: Array<Record<string, unknown> | AIContentPart>; role?: string };
			finishReason?: string;
			finishMessage?: string;
			safetyRatings?: unknown[];
		}>;
		promptFeedback?: {
			blockReason?: string;
			safetyRatings?: unknown[];
		};
		usageMetadata?: Record<string, unknown>;
	},
	parts: AIContentPart[],
	text: string,
): AIResponseDisposition {
	if (data.promptFeedback?.blockReason) {
		return 'promptBlocked';
	}
	const firstCandidate = data.candidates?.[0];
	if (!firstCandidate) {
		return 'malformed';
	}
	const finishReason = (firstCandidate.finishReason || '').toUpperCase();
	if (finishReason === 'SAFETY' || finishReason === 'BLOCKLIST' || finishReason === 'PROHIBITED_CONTENT') {
		return 'candidateBlocked';
	}
	const hasFunctionCalls = parts.some(p => !!p.functionCall);
	if (hasFunctionCalls) {
		return 'toolCalls';
	}
	if (text.length > 0) {
		return 'text';
	}
	const thoughtsTokenCount = typeof data.usageMetadata?.thoughtsTokenCount === 'number'
		? data.usageMetadata.thoughtsTokenCount
		: 0;
	const hasThoughtParts = parts.some(p => p.thought === true);
	if (finishReason === 'MAX_TOKENS') {
		return (thoughtsTokenCount > 0 || hasThoughtParts) ? 'thoughtOnly' : 'maxTokens';
	}
	if (finishReason === 'STOP') {
		return (thoughtsTokenCount > 0 || hasThoughtParts) ? 'thoughtOnly' : 'emptyStop';
	}
	return 'malformed';
}

export function classifyGeminiHttpError(err: unknown): AIProviderErrorClassification {
	if (!err) {
		return { code: 'unknown', safeMessage: 'Unknown provider error.', retryable: false };
	}

	const message = err instanceof Error ? err.message : String(err);

	if (message === 'Cancelled' || message.includes('aborted') || message.includes('AbortError')) {
		return { code: 'cancelled', safeMessage: 'Generation request was cancelled.', retryable: false };
	}

	// Pattern match HTTP status from error message if available
	const statusMatch = message.match(/\(HTTP (\d+)\)/);
	const status = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

	if (status === 401 || status === 403 || message.includes('API key not valid') || message.includes('API_KEY_INVALID')) {
		return {
			code: 'authentication',
			safeMessage: 'Gemini API authentication failed. Please verify your configured API key.',
			retryable: false,
			httpStatus: status ?? 401,
		};
	}

	if (status === 404 || message.includes('models/') && message.includes('not found')) {
		return {
			code: 'modelUnavailable',
			safeMessage: 'The selected Gemini model is unavailable or does not support this method.',
			retryable: false,
			httpStatus: status ?? 404,
		};
	}

	if (status === 429 || message.includes('RESOURCE_EXHAUSTED') || message.includes('Quota exceeded')) {
		return {
			code: 'rateLimited',
			safeMessage: 'Gemini API rate limit or quota exceeded. Please retry in a moment.',
			retryable: true,
			httpStatus: status ?? 429,
		};
	}

	if (status === 413 || message.includes('exceeded the') && message.includes('size limit')) {
		return {
			code: 'responseTooLarge',
			safeMessage: 'Model response exceeded maximum allowed output size.',
			retryable: false,
			httpStatus: status ?? 413,
		};
	}

	if (status === 503 || message.includes('503') || message.includes('high demand') || message.includes('UNAVAILABLE') || message.includes('Service Unavailable')) {
		return {
			code: 'providerServerError',
			safeMessage: 'This model is currently experiencing high demand. Please retry in a moment.',
			retryable: true,
			httpStatus: status ?? 503,
		};
	}

	if (status && status >= 500) {
		return {
			code: 'providerServerError',
			safeMessage: 'Gemini service is temporarily unavailable. Please retry in a moment.',
			retryable: true,
			httpStatus: status,
		};
	}

	if (message.includes('fetch failed') || message.includes('ENOTFOUND') || message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT') || message.includes('network')) {
		return {
			code: 'network',
			safeMessage: 'Network error communicating with Google Gemini API.',
			retryable: true,
		};
	}

	return {
		code: 'invalidRequest',
		safeMessage: message.length > 200 ? `${message.slice(0, 200)}…` : message,
		retryable: false,
		httpStatus: status,
	};
}

/**
 * Direct transport for Google Gemini Generative Language API.
 * Sends credentials strictly via x-goog-api-key header (never in URL or body).
 */
/**
 * Serializes a provider-neutral AIGenerateRequest to Gemini REST wire format.
 * Uses parametersJsonSchema for function declarations to preserve JSON Schema fidelity.
 * Preserves functionCall IDs, functionResponse IDs, and thought signatures.
 */
export function serializeGeminiRequest(request: AIGenerateRequest): Record<string, unknown> {
	const contents = request.contents.map(msg => ({
		role: msg.role === 'model' ? 'model' : 'user',
		parts: msg.parts.map(p => {
			if (p.functionCall) {
				const fc: Record<string, unknown> = {
					name: p.functionCall.name,
					args: p.functionCall.args ?? {},
				};
				if (p.functionCall.id) {
					fc.id = p.functionCall.id;
				}
				const partObj: Record<string, unknown> = { functionCall: fc };
				if (p.thoughtSignature) {
					partObj.thoughtSignature = p.thoughtSignature;
				}
				if (p.thought !== undefined) {
					partObj.thought = p.thought;
				}
				return partObj;
			}
			if (p.functionResponse) {
				const fr: Record<string, unknown> = {
					name: p.functionResponse.name,
					response: p.functionResponse.response ?? {},
				};
				if (p.functionResponse.id) {
					fr.id = p.functionResponse.id;
				}
				return { functionResponse: fr };
			}
			if (p.inlineData) {
				return { inlineData: p.inlineData };
			}
			const partObj: Record<string, unknown> = { text: p.text ?? '' };
			if (p.thoughtSignature) {
				partObj.thoughtSignature = p.thoughtSignature;
			}
			if (p.thought !== undefined) {
				partObj.thought = p.thought;
			}
			return partObj;
		}),
	}));

	const payload: Record<string, unknown> = {
		contents,
	};

	if (request.systemInstruction) {
		payload.systemInstruction = {
			parts: [{ text: request.systemInstruction }],
		};
	}

	const genConfig: Record<string, unknown> = {};
	if (request.maxOutputTokens !== undefined) {
		genConfig.maxOutputTokens = request.maxOutputTokens;
	}
	if (request.temperature !== undefined) {
		genConfig.temperature = request.temperature;
	}

	// Translate normalized reasoning effort to Gemini wire format
	if (request.reasoningEffort && request.reasoningEffort !== 'default') {
		const rawModel = (request.modelId || '').toLowerCase().replace(/^models\//, '');
		const isGemini3 = /gemini-3/i.test(rawModel);

		if (isGemini3) {
			if (rawModel.startsWith('gemini-3.6-flash')) {
				const levelMap: Record<string, string> = {
					minimal: 'MINIMAL',
					low: 'LOW',
					medium: 'MEDIUM',
					high: 'HIGH',
				};
				genConfig.thinkingConfig = {
					thinkingLevel: levelMap[request.reasoningEffort] || 'MEDIUM',
				};
			} else {
				// Gemini 3.7 Flash and other 3.x models: minimal is unsupported -> normalize to LOW
				const levelMap: Record<string, string> = {
					minimal: 'LOW',
					low: 'LOW',
					medium: 'MEDIUM',
					high: 'HIGH',
				};
				genConfig.thinkingConfig = {
					thinkingLevel: levelMap[request.reasoningEffort] || 'MEDIUM',
				};
			}
		} else {
			const budgetMap: Record<string, number> = {
				minimal: 1024,
				low: 1024,
				medium: 8192,
				high: 24576,
			};
			genConfig.thinkingConfig = {
				thinkingBudget: budgetMap[request.reasoningEffort] ?? 1024,
			};
		}
	}

	if (Object.keys(genConfig).length > 0) {
		payload.generationConfig = genConfig;
	}

	if (request.tools && request.tools.length > 0) {
		payload.tools = [
			{
				functionDeclarations: request.tools.map(t => {
					const decl: Record<string, unknown> = {
						name: t.name,
						description: t.description,
					};
					const schema = t.inputSchema ?? t.parameters;
					if (schema) {
						decl.parametersJsonSchema = schema;
					}
					return decl;
				}),
			},
		];
	}

	return payload;
}

export function parseGeminiResponsePart(rawPart: Record<string, unknown>): AIContentPart {
	const part: {
		text?: string;
		inlineData?: { mimeType: string; data: string };
		functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
		functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
		thought?: boolean;
		thoughtSignature?: string;
	} = {};

	if (typeof rawPart.text === 'string') {
		part.text = rawPart.text;
	}
	if (rawPart.thought === true) {
		part.thought = true;
	}
	const sig = (typeof rawPart.thoughtSignature === 'string' && rawPart.thoughtSignature) ||
		(typeof rawPart.thought_signature === 'string' && rawPart.thought_signature);
	if (sig) {
		part.thoughtSignature = sig;
	}

	if (rawPart.functionCall && typeof rawPart.functionCall === 'object') {
		const fc = rawPart.functionCall as Record<string, unknown>;
		const fcSig = (typeof fc.thoughtSignature === 'string' && fc.thoughtSignature) ||
			(typeof fc.thought_signature === 'string' && fc.thought_signature);
		if (fcSig && !part.thoughtSignature) {
			part.thoughtSignature = fcSig;
		}
		part.functionCall = {
			name: String(fc.name || ''),
			id: typeof fc.id === 'string' ? fc.id : undefined,
			args: (fc.args && typeof fc.args === 'object' && !Array.isArray(fc.args)) ? fc.args as Record<string, unknown> : {},
		};
	}

	if (rawPart.functionResponse && typeof rawPart.functionResponse === 'object') {
		const fr = rawPart.functionResponse as Record<string, unknown>;
		part.functionResponse = {
			name: String(fr.name || ''),
			id: typeof fr.id === 'string' ? fr.id : undefined,
			response: (fr.response && typeof fr.response === 'object' && !Array.isArray(fr.response)) ? fr.response as Record<string, unknown> : {},
		};
	}

	if (rawPart.inlineData && typeof rawPart.inlineData === 'object') {
		const id = rawPart.inlineData as Record<string, unknown>;
		part.inlineData = {
			mimeType: String(id.mimeType || ''),
			data: String(id.data || ''),
		};
	}

	return part;
}

export async function sleepWithCancellation(ms: number, token?: AICancellationToken): Promise<void> {
	if (token?.isCancellationRequested) {
		throw new Error('Cancelled');
	}
	return new Promise((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const sub = token?.onCancellationRequested?.(() => {
			if (timer) {
				clearTimeout(timer);
			}
			reject(new Error('Cancelled'));
		});
		timer = setTimeout(() => {
			sub?.dispose();
			resolve();
		}, ms);
	});
}

export interface RetryOptions {
	maxAttempts?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
}

export async function executeWithRetry<T>(
	operation: (attempt: number) => Promise<T>,
	token?: AICancellationToken,
	options?: RetryOptions,
): Promise<T> {
	const maxAttempts = options?.maxAttempts ?? 3;
	const initialDelayMs = options?.initialDelayMs ?? 500;
	const maxDelayMs = options?.maxDelayMs ?? 4000;

	let attempt = 0;
	while (attempt < maxAttempts) {
		attempt++;
		if (token?.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		try {
			return await operation(attempt);
		} catch (err) {
			if (token?.isCancellationRequested || (err instanceof Error && err.message === 'Cancelled')) {
				throw err;
			}
			const classification = classifyGeminiHttpError(err);
			if (!classification.retryable || attempt >= maxAttempts) {
				throw err;
			}

			// Bounded exponential backoff with jitter
			const baseDelay = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
			const jitter = baseDelay * (0.8 + Math.random() * 0.4);
			const delayMs = Math.round(jitter);

			await sleepWithCancellation(delayMs, token);
		}
	}
	throw new Error('Retry attempts exhausted.');
}

export class DirectGeminiTransport {
	private readonly baseUrl: string;
	private readonly fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>;

	constructor(options?: DirectGeminiTransportOptions) {
		this.baseUrl = (options?.baseUrl ?? GOOGLE_API_BASE_URL).replace(/\/$/, '');
		this.fetchImpl = options?.fetchImpl ?? globalThis.fetch.bind(globalThis);
	}

	private createAbortController(token?: AICancellationToken): { controller: AbortController; cleanup: () => void } {
		const controller = new AbortController();
		if (token?.isCancellationRequested) {
			controller.abort();
		}
		const sub = token?.onCancellationRequested?.(() => controller.abort());
		return {
			controller,
			cleanup: () => sub?.dispose(),
		};
	}

	private async readBoundedText(res: Response, maxBytes: number = MAX_NON_STREAM_RESPONSE_BYTES): Promise<string> {
		if (!res.body) {
			if (typeof res.text === 'function') {
				return res.text();
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

	async generate(
		apiKey: string,
		request: AIGenerateRequest,
		token?: AICancellationToken,
	): Promise<AIGenerateResult> {
		if (token?.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		if (!apiKey.trim()) {
			throw new Error('Gemini API key is required for direct generation.');
		}

		return executeWithRetry(async () => {
			const { controller, cleanup } = this.createAbortController(token);
			try {
				const model = request.modelId.replace(/^models\//, '');
				const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`;

				const payload = serializeGeminiRequest(request);

				const res = await this.fetchImpl(url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-goog-api-key': apiKey.trim(),
					},
					body: JSON.stringify(payload),
					signal: controller.signal,
				});

				if (!res.ok) {
					const bodyText = await this.readBoundedText(res).catch(() => '');
					let errMsg = `Gemini generation failed (HTTP ${res.status})`;
					try {
						const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
						if (parsed?.error?.message) {
							errMsg = `${parsed.error.message} (HTTP ${res.status})`;
						}
					} catch {
						// use default errMsg
					}
					throw new Error(errMsg);
				}

				const rawBody = await this.readBoundedText(res);
				const data = JSON.parse(rawBody) as {
					candidates?: Array<{
						content?: {
							parts?: Array<Record<string, unknown>>;
							role?: string;
						};
						finishReason?: string;
						finishMessage?: string;
						safetyRatings?: unknown[];
					}>;
					promptFeedback?: {
						blockReason?: string;
						safetyRatings?: unknown[];
					};
					usageMetadata?: Record<string, unknown>;
				};

				const firstCandidate = data.candidates?.[0];
				const rawParts = firstCandidate?.content?.parts ?? [];
				const parts = rawParts.map(parseGeminiResponsePart);
				const textParts = parts.filter(p => !p.thought).map(p => p.text ?? '').filter(Boolean);
				const text = textParts.join('');

				let candidate: AIGenerateResponseCandidate | undefined;
				if (firstCandidate?.content) {
					candidate = {
						content: {
							role: firstCandidate.content.role ?? 'model',
							parts,
						},
						finishReason: firstCandidate.finishReason,
						finishMessage: firstCandidate.finishMessage,
						safetyRatings: firstCandidate.safetyRatings,
					};
				}

				let usageMetadata: import('../aiTypes').AIUsageMetadata | undefined;
				if (data.usageMetadata && typeof data.usageMetadata === 'object') {
					const rawUsage = data.usageMetadata;
					usageMetadata = {
						promptTokenCount: typeof rawUsage.promptTokenCount === 'number' ? rawUsage.promptTokenCount : undefined,
						candidatesTokenCount: typeof rawUsage.candidatesTokenCount === 'number'
							? rawUsage.candidatesTokenCount
							: (typeof rawUsage.candidateTokenCount === 'number' ? rawUsage.candidateTokenCount : undefined),
						thoughtsTokenCount: typeof rawUsage.thoughtsTokenCount === 'number' ? rawUsage.thoughtsTokenCount : undefined,
						totalTokenCount: typeof rawUsage.totalTokenCount === 'number' ? rawUsage.totalTokenCount : undefined,
					};
				}

				const disposition = classifyGeminiResponseDisposition(data, parts, text);

				return {
					text,
					candidate,
					disposition,
					promptFeedback: data.promptFeedback ? {
						blockReason: data.promptFeedback.blockReason,
						safetyRatings: data.promptFeedback.safetyRatings,
					} : undefined,
					usageMetadata,
					modelId: model,
					providerId: 'gemini',
					executionMode: 'byok',
				};
			} finally {
				cleanup();
			}
		}, token);
	}

	async streamGenerate(
		apiKey: string,
		request: AIGenerateRequest,
		onChunk: (chunk: { text?: string; candidate?: AIGenerateResponseCandidate }) => void,
		token?: AICancellationToken,
	): Promise<AIGenerateResult> {
		if (token?.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		if (!apiKey.trim()) {
			throw new Error('Gemini API key is required for direct streaming generation.');
		}

		let emittedChunk = false;

		const runStream = async (): Promise<AIGenerateResult> => {
			const { controller, cleanup } = this.createAbortController(token);

			try {
				const model = request.modelId.replace(/^models\//, '');
				const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

				const payload = serializeGeminiRequest(request);

				const res = await this.fetchImpl(url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-goog-api-key': apiKey.trim(),
						Accept: 'text/event-stream',
					},
					body: JSON.stringify(payload),
					signal: controller.signal,
				});

				if (!res.ok) {
					const bodyText = await this.readBoundedText(res).catch(() => '');
					let errMsg = `Gemini streaming failed (HTTP ${res.status})`;
					try {
						const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
						if (parsed?.error?.message) {
							errMsg = `${parsed.error.message} (HTTP ${res.status})`;
						}
					} catch {
						// use default errMsg
					}

					// If the endpoint explicitly indicates method not supported, fallback to non-streaming
					if (res.status === 404 || res.status === 405) {
						return await this.generate(apiKey, request, token);
					}

					throw new Error(errMsg);
				}

				if (!res.body) {
					return await this.generate(apiKey, request, token);
				}

				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let accumulatedText = '';
				const accumulatedParts: AIContentPart[] = [];
				let buffer = '';
				let totalBytes = 0;
				let finishReason: string | undefined;
				let latestUsage: import('../aiTypes').AIUsageMetadata | undefined;

				const processLine = (line: string) => {
					const trimmed = line.trim();
					if (trimmed.startsWith('data: ')) {
						const jsonStr = trimmed.slice(6).trim();
						if (jsonStr === '[DONE]') {
							return;
						}
						try {
							const parsed = JSON.parse(jsonStr) as {
								candidates?: Array<{
									content?: {
										parts?: Array<Record<string, unknown>>;
										role?: string;
									};
									finishReason?: string;
								}>;
								usageMetadata?: Record<string, unknown>;
							};
							if (parsed.usageMetadata && typeof parsed.usageMetadata === 'object') {
								const rawUsage = parsed.usageMetadata;
								latestUsage = {
									promptTokenCount: typeof rawUsage.promptTokenCount === 'number' ? rawUsage.promptTokenCount : undefined,
									candidatesTokenCount: typeof rawUsage.candidatesTokenCount === 'number'
										? rawUsage.candidatesTokenCount
										: (typeof rawUsage.candidateTokenCount === 'number' ? rawUsage.candidateTokenCount : undefined),
									thoughtsTokenCount: typeof rawUsage.thoughtsTokenCount === 'number' ? rawUsage.thoughtsTokenCount : undefined,
									totalTokenCount: typeof rawUsage.totalTokenCount === 'number' ? rawUsage.totalTokenCount : undefined,
								};
							}
							const cand = parsed.candidates?.[0];
							if (cand?.finishReason) {
								finishReason = cand.finishReason;
							}
							if (cand?.content?.parts) {
								const parsedParts = cand.content.parts.map(parseGeminiResponsePart);
								for (const p of parsedParts) {
									accumulatedParts.push(p);
									if (p.text && !p.thought) {
										accumulatedText += p.text;
										emittedChunk = true;
										onChunk({ text: p.text });
									}
									if (p.functionCall) {
										emittedChunk = true;
										onChunk({
											candidate: {
												content: {
													role: 'model',
													parts: [p],
												},
												finishReason: cand.finishReason,
											},
										});
									}
								}
							}
						} catch {
							// continue parsing subsequent chunks
						}
					}
				};

				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						const rest = decoder.decode();
						if (rest) {
							buffer += rest;
						}
						if (buffer.trim()) {
							processLine(buffer);
						}
						break;
					}
					totalBytes += value.byteLength;
					if (totalBytes > MAX_SSE_BUFFER_BYTES) {
						await reader.cancel();
						throw new Error('Gemini streaming response exceeded maximum stream buffer size.');
					}

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split(/\r?\n/);
					buffer = lines.pop() ?? '';

					for (const line of lines) {
						processLine(line);
					}
				}

				const finalCandidate: AIGenerateResponseCandidate | undefined = accumulatedParts.length > 0
					? {
						content: {
							role: 'model',
							parts: accumulatedParts,
						},
						finishReason,
					}
					: undefined;

				const streamRawData = {
					candidates: finalCandidate ? [{
						content: finalCandidate.content,
						finishReason,
					}] : [],
					usageMetadata: latestUsage ? {
						promptTokenCount: latestUsage.promptTokenCount,
						candidatesTokenCount: latestUsage.candidatesTokenCount,
						thoughtsTokenCount: latestUsage.thoughtsTokenCount,
						totalTokenCount: latestUsage.totalTokenCount,
					} : undefined,
				};
				const disposition = classifyGeminiResponseDisposition(streamRawData, accumulatedParts, accumulatedText);

				return {
					text: accumulatedText,
					candidate: finalCandidate,
					disposition,
					usageMetadata: latestUsage,
					modelId: model,
					providerId: 'gemini',
					executionMode: 'byok',
				};
			} finally {
				cleanup();
			}
		};

		// Only retry before any chunks have been emitted
		return executeWithRetry(async () => {
			if (emittedChunk) {
				throw new Error('Stream interrupted after partial emission; replay prevented.');
			}
			return await runStream();
		}, token);
	}

	async discoverModels(
		apiKey: string,
		token?: AICancellationToken,
	): Promise<NormalizedAIModel[]> {
		if (token?.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		if (!apiKey.trim()) {
			return [];
		}

		return executeWithRetry(async () => {
			const { controller, cleanup } = this.createAbortController(token);
			const MAX_PAGES = 10;
			const PAGE_SIZE = 100;

			const EXCLUDED_PATTERNS = [
				'embedding', 'aqa', 'imagen', 'veo', 'tts', 'live', 'robotics',
				'bison', // legacy PaLM-era
				'gemma',  // open weights, not Gemini API general chat
			];

			function isExcludedFamily(id: string): boolean {
				const lower = id.toLowerCase();
				return EXCLUDED_PATTERNS.some(pat => lower.includes(pat));
			}

			try {
				const normalized: NormalizedAIModel[] = [];
				let pageToken: string | undefined;
				let pagesRead = 0;

				do {
					if (token?.isCancellationRequested) {
						throw new Error('Cancelled');
					}

					const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
					if (pageToken) {
						params.set('pageToken', pageToken);
					}
					const url = `${this.baseUrl}/models?${params.toString()}`;

					const res = await this.fetchImpl(url, {
						method: 'GET',
						headers: {
							'Content-Type': 'application/json',
							'x-goog-api-key': apiKey.trim(),
						},
						signal: controller.signal,
					});

					if (!res.ok) {
						throw new Error(`Gemini model discovery failed (HTTP ${res.status})`);
					}

					const bodyText = await this.readBoundedText(res);
					const data = JSON.parse(bodyText) as {
						models?: Array<{
							name?: string;
							displayName?: string;
							description?: string;
							inputTokenLimit?: number;
							outputTokenLimit?: number;
							supportedGenerationMethods?: string[];
						}>;
						nextPageToken?: string;
					};

					pagesRead++;
					pageToken = data.nextPageToken;

					const rawModels = data.models ?? [];

					for (const m of rawModels) {
						const rawName = m.name ?? '';
						const id = rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
						if (!id) {
							continue;
						}

						if (isExcludedFamily(id)) {
							continue;
						}

						const methods = m.supportedGenerationMethods ?? [];
						const supportsGenerate = methods.includes('generateContent');
						if (!supportsGenerate) {
							continue;
						}

						const baseModel: NormalizedAIModel = {
							id,
							name: rawName || `models/${id}`,
							displayName: m.displayName || id,
							description: m.description || `Google Gemini ${id} model.`,
							inputTokenLimit: m.inputTokenLimit || 1_000_000,
							outputTokenLimit: m.outputTokenLimit || 65_536,
							capabilities: {
								textGeneration: supportsGenerate,
								streaming: true,
								functionCalling: supportsGenerate,
								multimodalInput: true,
								structuredOutput: supportsGenerate,
								thinkingProtocol: false,
								agentCompatible: supportsGenerate,
								descriptionCompatible: supportsGenerate,
							},
						};

						normalized.push(baseModel);
					}
				} while (pageToken && pagesRead < MAX_PAGES);

				return normalized;
			} finally {
				cleanup();
			}
		}, token);
	}


	async testConnection(
		apiKey: string,
		modelId: string = 'gemini-2.5-flash',
		token?: AICancellationToken,
	): Promise<{ ok: boolean; modelId: string; reply?: string; error?: AIProviderErrorClassification }> {
		try {
			const result = await this.generate(
				apiKey,
				{
					modelId,
					contents: [{ role: 'user', parts: [{ text: 'Respond with exactly "PONG" in one word.' }] }],
					maxOutputTokens: 16,
					temperature: 0.0,
				},
				token,
			);
			return { ok: true, modelId, reply: result.text.trim() };
		} catch (err) {
			const classification = classifyGeminiHttpError(err);
			return { ok: false, modelId, error: classification };
		}
	}
}

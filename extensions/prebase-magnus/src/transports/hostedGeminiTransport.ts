/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	AICancellationToken,
	AIGenerateRequest,
	AIGenerateResponseCandidate,
	AIGenerateResult,
	AIProviderErrorClassification,
	NormalizedAIModel,
} from '../aiTypes';

export interface HostedGatewayClient {
	generate(payload: Record<string, unknown>, token?: AICancellationToken): Promise<Record<string, unknown>>;
	discoverModels(token?: AICancellationToken): Promise<NormalizedAIModel[]>;
	streamGenerate?(
		payload: Record<string, unknown>,
		onChunk: (chunk: { text?: string; candidate?: AIGenerateResponseCandidate }) => void,
		token?: AICancellationToken
	): Promise<Record<string, unknown>>;
}

export interface HostedGeminiTransportOptions {
	gatewayUrl?: string;
	publishableKey?: string;
	getAccessToken?: () => Promise<string | undefined>;
	fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
	gatewayClient?: HostedGatewayClient;
}

export function classifyHostedGatewayError(err: unknown): AIProviderErrorClassification {
	if (!err) {
		return { code: 'unknown', safeMessage: 'Unknown hosted gateway error.', retryable: false };
	}

	const message = err instanceof Error ? err.message : String(err);

	if (message === 'Cancelled' || message.includes('aborted') || message.includes('AbortError')) {
		return { code: 'cancelled', safeMessage: 'Hosted generation request was cancelled.', retryable: false };
	}

	if (message.includes('unauthorized') || message.includes('Sign in to') || message.includes('HTTP 401')) {
		return {
			code: 'hostedAuthenticationRequired',
			safeMessage: 'PreBase Cloud sign-in is required to use hosted AI. Please sign in to your account.',
			retryable: false,
			httpStatus: 401,
		};
	}

	if (message.includes('quota_exceeded') || message.includes('Usage rate limit') || message.includes('HTTP 429')) {
		return {
			code: 'quotaExceeded',
			safeMessage: 'Hosted AI daily quota or rate limit exceeded. Please wait or configure your own BYOK key.',
			retryable: true,
			httpStatus: 429,
		};
	}

	if (message.includes('not_configured') || message.includes('misconfigured') || message.includes('HTTP 503')) {
		return {
			code: 'hostedUnavailable',
			safeMessage: 'PreBase hosted AI gateway is currently unavailable.',
			retryable: true,
			httpStatus: 503,
		};
	}

	if (message.includes('provider_auth_error') || message.includes('rejected')) {
		return {
			code: 'providerServerError',
			safeMessage: 'Hosted provider credentials rejected by upstream service.',
			retryable: false,
			httpStatus: 502,
		};
	}

	if (message.includes('response_too_large') || message.includes('HTTP 413')) {
		return {
			code: 'responseTooLarge',
			safeMessage: 'Model response exceeded output limit.',
			retryable: false,
			httpStatus: 413,
		};
	}

	if (message.includes('model_not_allowed')) {
		return {
			code: 'modelUnavailable',
			safeMessage: 'The selected model is not available on the hosted gateway.',
			retryable: false,
			httpStatus: 400,
		};
	}

	return {
		code: 'providerServerError',
		safeMessage: message.length > 200 ? `${message.slice(0, 200)}…` : message,
		retryable: false,
	};
}

/**
 * Transport for PreBase Hosted Gemini through the Supabase agent-gateway Edge Function.
 * The desktop client never receives or stores the provider secret.
 */
export class HostedGeminiTransport {
	private readonly gatewayUrl?: string;
	private readonly publishableKey?: string;
	private readonly getAccessToken?: () => Promise<string | undefined>;
	private readonly fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>;
	private readonly gatewayClient?: HostedGatewayClient;

	constructor(options?: HostedGeminiTransportOptions) {
		this.gatewayUrl = options?.gatewayUrl?.replace(/\/$/, '');
		this.publishableKey = options?.publishableKey;
		this.getAccessToken = options?.getAccessToken;
		this.fetchImpl = options?.fetchImpl ?? globalThis.fetch.bind(globalThis);
		this.gatewayClient = options?.gatewayClient;
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

	async generate(
		request: AIGenerateRequest,
		token?: AICancellationToken,
	): Promise<AIGenerateResult> {
		if (token?.isCancellationRequested) {
			throw new Error('Cancelled');
		}

		// Use custom gateway client if provided (e.g. from workbench commands)
		if (this.gatewayClient) {
			const payload = {
				model: request.modelId.replace(/^models\//, ''),
				contents: request.contents,
				systemInstruction: request.systemInstruction ? { parts: [{ text: request.systemInstruction }] } : undefined,
				generationConfig: {
					maxOutputTokens: request.maxOutputTokens ?? 4096,
					temperature: request.temperature ?? 0.2,
				},
				tools: request.tools && request.tools.length > 0 ? [{ functionDeclarations: request.tools }] : undefined,
			};

			const raw = await this.gatewayClient.generate(payload, token);
			const text = typeof raw.text === 'string' ? raw.text : '';
			const candidate = raw.candidate as AIGenerateResponseCandidate | undefined;

			return {
				text,
				candidate,
				modelId: request.modelId,
				providerId: 'gemini',
				executionMode: 'hosted',
			};
		}

		if (!this.gatewayUrl || !this.publishableKey || !this.getAccessToken) {
			throw new Error('Hosted gateway client is not configured.');
		}

		const accessToken = await this.getAccessToken();
		if (!accessToken) {
			throw new Error('Sign in to PreBase Cloud before using hosted AI.');
		}

		const { controller, cleanup } = this.createAbortController(token);

		try {
			const model = request.modelId.replace(/^models\//, '');
			const url = `${this.gatewayUrl}/functions/v1/agent-gateway`;

			const contents = request.contents.map(msg => ({
				role: msg.role === 'model' ? 'model' : 'user',
				parts: msg.parts.map(p => {
					if (p.functionCall) {
						return { functionCall: p.functionCall };
					}
					if (p.functionResponse) {
						return { functionResponse: p.functionResponse };
					}
					return { text: p.text ?? '' };
				}),
			}));

			const payload: Record<string, unknown> = {
				model,
				contents,
			};

			if (request.systemInstruction) {
				payload.systemInstruction = {
					parts: [{ text: request.systemInstruction }],
				};
			}

			if (request.maxOutputTokens || request.temperature !== undefined) {
				payload.generationConfig = {
					maxOutputTokens: request.maxOutputTokens ?? 4096,
					temperature: request.temperature ?? 0.2,
				};
			}

			if (request.tools && request.tools.length > 0) {
				payload.tools = [
					{
						functionDeclarations: request.tools.map(t => ({
							name: t.name,
							description: t.description,
							parameters: t.parameters,
						})),
					},
				];
			}

			const res = await this.fetchImpl(url, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					apikey: this.publishableKey,
					'Content-Type': 'application/json',
					'x-request-id': crypto.randomUUID(),
				},
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			if (!res.ok) {
				const bodyText = await res.text().catch(() => '');
				let errMsg = `Hosted AI request failed (HTTP ${res.status})`;
				try {
					const parsed = JSON.parse(bodyText) as { error?: string; message?: string };
					if (parsed?.message) {
						errMsg = `${parsed.message} (${parsed.error || `HTTP ${res.status}`})`;
					} else if (parsed?.error) {
						errMsg = `${parsed.error} (HTTP ${res.status})`;
					}
				} catch {
					// default errMsg
				}
				throw new Error(errMsg);
			}

			const rawBody = await res.text();
			const data = JSON.parse(rawBody) as {
				model?: string;
				text?: string;
				candidate?: AIGenerateResponseCandidate;
			};

			return {
				text: data.text ?? '',
				candidate: data.candidate,
				modelId: model,
				providerId: 'gemini',
				executionMode: 'hosted',
			};
		} finally {
			cleanup();
		}
	}

	async streamGenerate(
		request: AIGenerateRequest,
		onChunk: (chunk: { text?: string; candidate?: AIGenerateResponseCandidate }) => void,
		token?: AICancellationToken,
	): Promise<AIGenerateResult> {
		if (this.gatewayClient?.streamGenerate) {
			const payload = {
				model: request.modelId.replace(/^models\//, ''),
				contents: request.contents,
				systemInstruction: request.systemInstruction ? { parts: [{ text: request.systemInstruction }] } : undefined,
				generationConfig: {
					maxOutputTokens: request.maxOutputTokens ?? 4096,
					temperature: request.temperature ?? 0.2,
				},
				tools: request.tools && request.tools.length > 0 ? [{ functionDeclarations: request.tools }] : undefined,
			};

			const raw = await this.gatewayClient.streamGenerate(payload, onChunk, token);
			return {
				text: typeof raw.text === 'string' ? raw.text : '',
				candidate: raw.candidate as AIGenerateResponseCandidate | undefined,
				modelId: request.modelId,
				providerId: 'gemini',
				executionMode: 'hosted',
			};
		}

		// Fallback to non-streaming generate
		const result = await this.generate(request, token);
		if (result.text) {
			onChunk({ text: result.text });
		}
		if (result.candidate) {
			onChunk({ candidate: result.candidate });
		}
		return result;
	}

	async discoverModels(
		token?: AICancellationToken,
	): Promise<NormalizedAIModel[]> {
		if (token?.isCancellationRequested) {
			throw new Error('Cancelled');
		}

		if (this.gatewayClient) {
			return await this.gatewayClient.discoverModels(token);
		}

		if (!this.gatewayUrl || !this.publishableKey || !this.getAccessToken) {
			throw new Error('Hosted gateway client is not configured.');
		}

		const accessToken = await this.getAccessToken();
		if (!accessToken) {
			throw new Error('Sign in to PreBase Cloud before discovering hosted models.');
		}

		const { controller, cleanup } = this.createAbortController(token);

		try {
			const url = `${this.gatewayUrl}/functions/v1/agent-gateway/models`;
			const res = await this.fetchImpl(url, {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					apikey: this.publishableKey,
					'Content-Type': 'application/json',
				},
				signal: controller.signal,
			});

			if (!res.ok) {
				throw new Error(`Hosted model discovery failed (HTTP ${res.status})`);
			}

			const rawBody = await res.text();
			const data = JSON.parse(rawBody) as {
				models?: Array<{
					id: string;
					displayName?: string;
					description?: string;
					inputTokenLimit?: number;
					outputTokenLimit?: number;
					agentCompatible?: boolean;
					descriptionCompatible?: boolean;
				}>;
			};

			const rawModels = data.models ?? [];
			return rawModels.map(m => ({
				id: m.id,
				name: `models/${m.id}`,
				displayName: m.displayName || m.id,
				description: m.description || `Google Gemini ${m.id} model (Hosted).`,
				inputTokenLimit: m.inputTokenLimit || 1_000_000,
				outputTokenLimit: m.outputTokenLimit || 65_536,
				capabilities: {
					textGeneration: true,
					streaming: true,
					functionCalling: m.agentCompatible ?? true,
					multimodalInput: true,
					structuredOutput: true,
					thinkingProtocol: false,
					agentCompatible: m.agentCompatible ?? true,
					descriptionCompatible: m.descriptionCompatible ?? true,
				},
			}));
		} finally {
			cleanup();
		}
	}

	async testConnection(
		modelId: string = 'gemini-2.5-flash',
		token?: AICancellationToken,
	): Promise<{ ok: boolean; modelId: string; reply?: string; error?: AIProviderErrorClassification }> {
		try {
			const result = await this.generate(
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
			const classification = classifyHostedGatewayError(err);
			return { ok: false, modelId, error: classification };
		}
	}
}

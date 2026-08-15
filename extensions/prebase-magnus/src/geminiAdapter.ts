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
	IPreBaseAIProviderAdapter,
	NormalizedAIModel,
} from './aiTypes';
import type { PreBaseAIExecutionMode } from './secretCatalog';
import type { ResolvedProviderExecution } from './secretResolver';
import {
	classifyGeminiHttpError,
	DirectGeminiTransport,
	type DirectGeminiTransportOptions,
} from './transports/directGeminiTransport';
import {
	classifyHostedGatewayError,
	HostedGeminiTransport,
	type HostedGeminiTransportOptions,
} from './transports/hostedGeminiTransport';

export const STATIC_FALLBACK_GEMINI_MODELS: readonly NormalizedAIModel[] = [
	{
		id: 'auto',
		name: 'models/gemini-2.5-flash',
		displayName: 'Auto',
		description: 'Balanced quality and speed, recommended for most tasks (resolves to Gemini 2.5 Flash).',
		inputTokenLimit: 1_000_000,
		outputTokenLimit: 65_536,
		capabilities: {
			textGeneration: true,
			streaming: true,
			functionCalling: true,
			multimodalInput: true,
			structuredOutput: true,
			thinkingProtocol: false,
			agentCompatible: true,
			descriptionCompatible: true,
		},
		isAuto: true,
		isFallback: true,
	},
	{
		id: 'gemini-2.5-pro',
		name: 'models/gemini-2.5-pro',
		displayName: 'Gemini 2.5 Pro',
		description: 'Highest quality Gemini model — best for complex reasoning and large refactors.',
		inputTokenLimit: 1_000_000,
		outputTokenLimit: 65_536,
		capabilities: {
			textGeneration: true,
			streaming: true,
			functionCalling: true,
			multimodalInput: true,
			structuredOutput: true,
			thinkingProtocol: false,
			agentCompatible: true,
			descriptionCompatible: true,
		},
		isFallback: true,
	},
	{
		id: 'gemini-2.5-flash',
		name: 'models/gemini-2.5-flash',
		displayName: 'Gemini 2.5 Flash',
		description: 'Fast and capable — strong default for everyday coding.',
		inputTokenLimit: 1_000_000,
		outputTokenLimit: 65_536,
		capabilities: {
			textGeneration: true,
			streaming: true,
			functionCalling: true,
			multimodalInput: true,
			structuredOutput: true,
			thinkingProtocol: false,
			agentCompatible: true,
			descriptionCompatible: true,
		},
		isFallback: true,
	},
];

export class GeminiProviderAdapter implements IPreBaseAIProviderAdapter {
	readonly id = 'gemini';
	readonly displayName = 'Google Gemini';
	readonly supportedExecutionModes: readonly PreBaseAIExecutionMode[] = [
		'auto',
		'development-env',
		'byok',
		'hosted',
	];
	readonly defaultModel = 'auto';
	readonly staticFallbackModels = STATIC_FALLBACK_GEMINI_MODELS;

	readonly directTransport: DirectGeminiTransport;
	readonly hostedTransport: HostedGeminiTransport;

	constructor(options?: {
		directOptions?: DirectGeminiTransportOptions;
		hostedOptions?: HostedGeminiTransportOptions;
	}) {
		this.directTransport = new DirectGeminiTransport(options?.directOptions);
		this.hostedTransport = new HostedGeminiTransport(options?.hostedOptions);
	}

	resolveAutoModel(_executionMode: PreBaseAIExecutionMode): string {
		return 'gemini-2.5-flash';
	}

	normalizeError(error: unknown): AIProviderErrorClassification {
		if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
			return error as AIProviderErrorClassification;
		}
		const msg = error instanceof Error ? error.message : String(error);
		if (msg.includes('Hosted') || msg.includes('hosted') || msg.includes('gateway')) {
			return classifyHostedGatewayError(error);
		}
		return classifyGeminiHttpError(error);
	}

	async discoverModels(
		credential: ResolvedProviderExecution,
		token?: AICancellationToken,
	): Promise<NormalizedAIModel[]> {
		if (credential.isHosted) {
			return await this.hostedTransport.discoverModels(token);
		}
		if (credential.key) {
			return await this.directTransport.discoverModels(credential.key, token);
		}
		return [...this.staticFallbackModels];
	}

	async generate(
		request: AIGenerateRequest,
		credential: ResolvedProviderExecution,
		token?: AICancellationToken,
	): Promise<AIGenerateResult> {
		const targetModel = request.modelId === 'auto'
			? this.resolveAutoModel(credential.executionMode)
			: request.modelId.replace(/^models\//, '');

		const resolvedRequest = { ...request, modelId: targetModel };

		if (credential.isHosted) {
			return await this.hostedTransport.generate(resolvedRequest, token);
		}

		if (credential.key) {
			return await this.directTransport.generate(credential.key, resolvedRequest, token);
		}

		throw new Error(
			credential.executionMode === 'development-env'
				? 'Agents has no configured Gemini credential. Provide GEMINI_API_KEY in PreBase root .env.'
				: 'Agents has no configured Gemini credential. Configure a key in Agents Settings or sign in to PreBase Cloud.'
		);
	}

	async streamGenerate(
		request: AIGenerateRequest,
		credential: ResolvedProviderExecution,
		onChunk: (chunk: { text?: string; candidate?: AIGenerateResponseCandidate }) => void,
		token?: AICancellationToken,
	): Promise<AIGenerateResult> {
		const targetModel = request.modelId === 'auto'
			? this.resolveAutoModel(credential.executionMode)
			: request.modelId.replace(/^models\//, '');

		const resolvedRequest = { ...request, modelId: targetModel };

		if (credential.isHosted) {
			return await this.hostedTransport.streamGenerate(resolvedRequest, onChunk, token);
		}

		if (credential.key) {
			return await this.directTransport.streamGenerate(credential.key, resolvedRequest, onChunk, token);
		}

		throw new Error(
			credential.executionMode === 'development-env'
				? 'Agents has no configured Gemini credential. Provide GEMINI_API_KEY in PreBase root .env.'
				: 'Agents has no configured Gemini credential. Configure a key in Agents Settings or sign in to PreBase Cloud.'
		);
	}

	async testConnection(
		credential: ResolvedProviderExecution,
		modelId: string = 'gemini-2.5-flash',
		token?: AICancellationToken,
	): Promise<{ ok: boolean; modelId: string; reply?: string; error?: AIProviderErrorClassification }> {
		const targetModel = modelId === 'auto' ? this.resolveAutoModel(credential.executionMode) : modelId;

		if (credential.isHosted) {
			return await this.hostedTransport.testConnection(targetModel, token);
		}

		if (credential.key) {
			return await this.directTransport.testConnection(credential.key, targetModel, token);
		}

		return {
			ok: false,
			modelId: targetModel,
			error: {
				code: 'notConfigured',
				safeMessage: credential.executionMode === 'development-env'
					? 'Gemini development credential (GEMINI_API_KEY) is not configured in PreBase root .env.'
					: 'Gemini credential is not configured. Configure a key in Settings or sign in to PreBase Cloud.',
				retryable: false,
			},
		};
	}
}

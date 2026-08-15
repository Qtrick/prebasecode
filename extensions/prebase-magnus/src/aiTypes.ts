/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PreBaseAIExecutionMode } from './secretCatalog';
import type { ResolvedProviderExecution } from './secretResolver';
import type { MagnusDescriptionResult } from './models';

export type AIProviderId = 'gemini' | string;

export interface ModelCapabilityFlags {
	readonly textGeneration: boolean;
	readonly streaming: boolean;
	readonly functionCalling: boolean;
	readonly multimodalInput: boolean;
	readonly structuredOutput: boolean;
	readonly thinkingProtocol: boolean;
	readonly agentCompatible: boolean;
	readonly descriptionCompatible: boolean;
}

export interface NormalizedAIModel {
	readonly id: string;
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly inputTokenLimit: number;
	readonly outputTokenLimit: number;
	readonly capabilities: ModelCapabilityFlags;
	readonly isAuto?: boolean;
	readonly isFallback?: boolean;
}

export interface AIContentPart {
	readonly text?: string;
	readonly inlineData?: { mimeType: string; data: string };
	readonly functionCall?: { name: string; args?: Record<string, unknown> };
	readonly functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface AIContentMessage {
	readonly role: 'user' | 'model' | 'system';
	readonly parts: AIContentPart[];
}

export interface AIGenerateRequest {
	readonly modelId: string;
	readonly contents: AIContentMessage[];
	readonly systemInstruction?: string;
	readonly maxOutputTokens?: number;
	readonly temperature?: number;
	readonly tools?: Array<{ name: string; description: string; parameters?: object }>;
	readonly stream?: boolean;
}

export interface AIGenerateResponseCandidate {
	readonly content: { parts: AIContentPart[]; role: string };
	readonly finishReason?: string;
}

export interface AIGenerateResult {
	readonly text: string;
	readonly candidate?: AIGenerateResponseCandidate;
	readonly modelId: string;
	readonly providerId: string;
	readonly executionMode: PreBaseAIExecutionMode;
}

export type AIProviderErrorCode =
	| 'notConfigured'
	| 'authentication'
	| 'authorization'
	| 'quotaExceeded'
	| 'rateLimited'
	| 'modelUnavailable'
	| 'invalidRequest'
	| 'network'
	| 'timeout'
	| 'cancelled'
	| 'providerServerError'
	| 'responseTooLarge'
	| 'malformedResponse'
	| 'hostedUnavailable'
	| 'hostedAuthenticationRequired'
	| 'hostedEntitlementRequired'
	| 'unknown';

export interface AIProviderErrorClassification {
	readonly code: AIProviderErrorCode;
	readonly safeMessage: string;
	readonly retryable: boolean;
	readonly httpStatus?: number;
}

export interface AICancellationToken {
	readonly isCancellationRequested: boolean;
	readonly onCancellationRequested?: (listener: () => void) => { dispose(): void };
}

export interface IPreBaseAIProviderAdapter {
	readonly id: string;
	readonly displayName: string;
	readonly supportedExecutionModes: readonly PreBaseAIExecutionMode[];
	readonly defaultModel: string;
	readonly staticFallbackModels: readonly NormalizedAIModel[];

	resolveAutoModel(executionMode: PreBaseAIExecutionMode): string;

	discoverModels(
		credential: ResolvedProviderExecution,
		token?: AICancellationToken,
	): Promise<NormalizedAIModel[]>;

	generate(
		request: AIGenerateRequest,
		credential: ResolvedProviderExecution,
		token?: AICancellationToken,
	): Promise<AIGenerateResult>;

	streamGenerate?(
		request: AIGenerateRequest,
		credential: ResolvedProviderExecution,
		onChunk: (chunk: { text?: string; candidate?: AIGenerateResponseCandidate }) => void,
		token?: AICancellationToken,
	): Promise<AIGenerateResult>;

	testConnection(
		credential: ResolvedProviderExecution,
		modelId?: string,
		token?: AICancellationToken,
	): Promise<{ ok: boolean; modelId: string; reply?: string; error?: AIProviderErrorClassification }>;

	normalizeError(error: unknown): AIProviderErrorClassification;
}

export interface ProviderStatusResult {
	readonly providerId: string;
	readonly displayName: string;
	readonly configured: boolean;
	readonly executionMode: PreBaseAIExecutionMode;
	readonly effectiveSource: string;
	readonly modelDiscovery: 'live' | 'cached' | 'fallback' | 'unconfigured';
	readonly modelCount: number;
	readonly safeStatusMessage: string;
}

export interface IPreBaseAIService {
	getExecutionMode(): PreBaseAIExecutionMode;
	setExecutionMode(mode: PreBaseAIExecutionMode): Promise<void>;

	getActiveProviderId(): string;
	setActiveProviderId(providerId: string): Promise<void>;

	getActiveModelId(): string;
	setActiveModelId(modelId: string): Promise<void>;

	getProviderStatus(providerId?: string): Promise<ProviderStatusResult>;

	listModels(providerId?: string, forceRefresh?: boolean, token?: AICancellationToken): Promise<NormalizedAIModel[]>;

	generateText(prompt: string, options?: { modelId?: string; maxTokens?: number; temperature?: number }, token?: AICancellationToken): Promise<string>;

	describeFile(prompt: string, filePath?: string, token?: AICancellationToken): Promise<MagnusDescriptionResult>;

	generateCandidate(
		request: {
			messages: AIContentMessage[];
			systemInstruction?: string;
			tools?: Array<{ name: string; description: string; parameters?: object }>;
			modelId?: string;
		},
		token?: AICancellationToken,
	): Promise<AIGenerateResult>;

	streamCandidate?(
		request: {
			messages: AIContentMessage[];
			systemInstruction?: string;
			tools?: Array<{ name: string; description: string; parameters?: object }>;
			modelId?: string;
		},
		onChunk: (chunk: { text?: string; candidate?: AIGenerateResponseCandidate }) => void,
		token?: AICancellationToken,
	): Promise<AIGenerateResult>;

	testConnection(providerId?: string, modelId?: string, token?: AICancellationToken): Promise<{ ok: boolean; modelId?: string; reply?: string; error?: AIProviderErrorClassification }>;
}

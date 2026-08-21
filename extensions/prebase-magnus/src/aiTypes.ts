/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PreBaseAIExecutionMode } from './secretCatalog';
export type { PreBaseAIExecutionMode };
import type { ResolvedProviderExecution } from './secretResolver';
import type { MagnusDescriptionResult } from './models';

export type AIProviderId = 'gemini' | string;

export type ModelReleaseChannel =
	| 'stable'
	| 'preview'
	| 'experimental'
	| 'latest-alias'
	| 'early-access'
	| 'unknown';

export type ModelWorkload =
	| 'general-agent'
	| 'fast-agent'
	| 'deep-reasoning'
	| 'description'
	| 'media'
	| 'audio'
	| 'research'
	| 'computer-use'
	| 'embedding'
	| 'specialized';

export type ModelVisibility =
	| 'recommended'
	| 'consumer'
	| 'internal'
	| 'hidden';

export type ModelTier =
	| 'flash'
	| 'pro'
	| 'lite'
	| 'custom';

export type AIReasoningEffort =
	| 'default'
	| 'minimal'
	| 'low'
	| 'medium'
	| 'high';

export interface AIModelReasoningMetadata {
	readonly supported: boolean;
	readonly supportedEfforts: readonly AIReasoningEffort[];
	readonly defaultEffort: AIReasoningEffort;
}

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
	readonly reasoning?: AIModelReasoningMetadata;
	readonly providerId?: string;
	readonly family?: string;
	readonly releaseChannel?: ModelReleaseChannel;
	readonly workloads?: readonly ModelWorkload[];
	readonly visibility?: ModelVisibility;
	readonly tier?: ModelTier;
	readonly consumerSelectable?: boolean;
	readonly autoEligible?: boolean;
	readonly descriptionEligible?: boolean;
	readonly deprecated?: boolean;
	readonly hiddenReason?: string;
	readonly isAuto?: boolean;
	readonly isFallback?: boolean;
}

export interface AIContentPart {
	readonly text?: string;
	readonly inlineData?: { mimeType: string; data: string };
	readonly functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
	readonly functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
	readonly thought?: boolean;
	readonly thoughtSignature?: string;
	readonly opaqueMetadata?: Record<string, unknown>;
}

export interface AIContentMessage {
	readonly role: 'user' | 'model' | 'system';
	readonly parts: AIContentPart[];
}

export interface AIToolDeclaration {
	readonly name: string;
	readonly description: string;
	readonly inputSchema?: Record<string, unknown>;
	readonly parameters?: Record<string, unknown>;
}

export interface AIGenerateRequest {
	readonly modelId: string;
	readonly contents: AIContentMessage[];
	readonly systemInstruction?: string;
	readonly maxOutputTokens?: number;
	readonly temperature?: number;
	readonly reasoningEffort?: AIReasoningEffort;
	readonly tools?: AIToolDeclaration[];
	readonly stream?: boolean;
}

export type AIResponseDisposition =
	| 'text'
	| 'toolCalls'
	| 'thoughtOnly'
	| 'maxTokens'
	| 'promptBlocked'
	| 'candidateBlocked'
	| 'emptyStop'
	| 'malformed'
	| 'cancelled'
	| 'providerError';

export interface AIPromptFeedback {
	readonly blockReason?: string;
	readonly safetyRatings?: readonly unknown[];
}

export interface AIGenerateResponseCandidate {
	readonly content: { parts: AIContentPart[]; role: string };
	readonly finishReason?: string;
	readonly finishMessage?: string;
	readonly safetyRatings?: readonly unknown[];
	readonly thoughtsTokenCount?: number;
}

export interface AIUsageMetadata {
	readonly promptTokenCount?: number;
	readonly candidatesTokenCount?: number;
	readonly thoughtsTokenCount?: number;
	readonly totalTokenCount?: number;
}

export interface AIGenerateResult {
	readonly text: string;
	readonly candidate?: AIGenerateResponseCandidate;
	readonly disposition: AIResponseDisposition;
	readonly promptFeedback?: AIPromptFeedback;
	readonly usageMetadata?: AIUsageMetadata;
	readonly modelId: string;
	readonly providerId: string;
	readonly executionMode: PreBaseAIExecutionMode;
}

export interface MagnusDescriptionContext {
	readonly providerId: string;
	readonly modelId: string;
	readonly executionMode: PreBaseAIExecutionMode;
	readonly reasoningEffort: AIReasoningEffort;
	readonly policyVersion: string;
	readonly cacheIdentity: string;
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

	resolveAutoModel(executionMode: PreBaseAIExecutionMode, discoveredModels?: readonly NormalizedAIModel[], workload?: ModelWorkload): string;

	discoverModels(
		credential: ResolvedProviderExecution,
		token?: AICancellationToken,
	): Promise<NormalizedAIModel[]>;

	curateConsumerCatalog?(models: readonly NormalizedAIModel[]): NormalizedAIModel[];

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
	listRawModels?(providerId?: string, forceRefresh?: boolean, token?: AICancellationToken): Promise<NormalizedAIModel[]>;

	generateText(prompt: string, options?: { modelId?: string; maxTokens?: number; temperature?: number; reasoningEffort?: AIReasoningEffort; workload?: ModelWorkload }, token?: AICancellationToken): Promise<string>;

	describeFile(prompt: string, filePath?: string, token?: AICancellationToken): Promise<MagnusDescriptionResult>;
	getDescriptionContext?(filePath?: string): Promise<MagnusDescriptionContext>;

	generateCandidate(
		request: {
			messages: AIContentMessage[];
			systemInstruction?: string;
			tools?: AIToolDeclaration[];
			modelId?: string;
			reasoningEffort?: AIReasoningEffort;
			workload?: ModelWorkload;
		},
		token?: AICancellationToken,
	): Promise<AIGenerateResult>;

	streamCandidate?(
		request: {
			messages: AIContentMessage[];
			systemInstruction?: string;
			tools?: AIToolDeclaration[];
			modelId?: string;
			reasoningEffort?: AIReasoningEffort;
			workload?: ModelWorkload;
		},
		onChunk: (chunk: { text?: string; candidate?: AIGenerateResponseCandidate }) => void,
		token?: AICancellationToken,
	): Promise<AIGenerateResult>;

	testConnection(providerId?: string, modelId?: string, token?: AICancellationToken): Promise<{ ok: boolean; modelId?: string; reply?: string; error?: AIProviderErrorClassification }>;
}

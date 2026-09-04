/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DiscoveredGeminiModel } from './geminiClient';

export type MagnusProviderId = 'gemini';

export interface MagnusProviderCapabilities {
	readonly textGeneration: boolean;
	readonly streaming: boolean;
	readonly functionCalling: boolean;
	readonly multimodalInput: boolean;
	readonly thinkingProtocol: boolean;
}

export interface MagnusProviderDescriptor {
	readonly id: MagnusProviderId;
	readonly displayName: string;
	readonly capabilities: MagnusProviderCapabilities;
	readonly defaultModel: string;
}

export const MAGNUS_PROVIDERS: readonly MagnusProviderDescriptor[] = [
	{
		id: 'gemini',
		displayName: 'Google Gemini',
		capabilities: {
			textGeneration: true,
			streaming: true,
			functionCalling: true,
			multimodalInput: true,
			thinkingProtocol: false,
		},
		defaultModel: 'auto',
	},
];

export interface MagnusModelOption {
	readonly id: string;
	readonly name: string;
	/** Gemini API model id. */
	readonly apiModel: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	/** Short picker / hover description. */
	readonly description: string;
	readonly isAuto?: boolean;
	readonly reasoning?: import('./aiTypes').AIModelReasoningMetadata;
}

/**
 * Default fallback models when live discovery is not yet available or offline.
 * Auto resolves to Gemini 3.8 Flash as the balanced, fast default.
 */
import { defaultGeminiModelPolicy } from './modelPolicy';

export const DEFAULT_MAGNUS_MODELS: readonly MagnusModelOption[] = [
	{
		id: 'auto',
		name: 'Auto',
		apiModel: 'gemini-3.8-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
		description: 'Balanced quality, thinking reasoning, and speed, recommended for most tasks.',
		isAuto: true,
		reasoning: {
			supported: true,
			supportedEfforts: ['default', 'low', 'medium', 'high'],
			defaultEffort: 'default',
		},
	},
	{
		id: 'gemini-3.8-flash',
		name: 'Gemini 3.8 Flash',
		apiModel: 'gemini-3.8-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
		description: 'Next-generation flagship Flash model — ultra-fast with advanced thinking capabilities.',
		reasoning: {
			supported: true,
			supportedEfforts: ['default', 'low', 'medium', 'high'],
			defaultEffort: 'default',
		},
	},
	{
		id: 'gemini-3.7-flash',
		name: 'Gemini 3.7 Flash',
		apiModel: 'gemini-3.7-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
		description: 'Next-generation hybrid reasoning model — fast with dynamic thinking capabilities.',
		reasoning: {
			supported: true,
			supportedEfforts: ['default', 'low', 'medium', 'high'],
			defaultEffort: 'default',
		},
	},
	{
		id: 'gemini-2.5-flash',
		name: 'Gemini 2.5 Flash',
		apiModel: 'gemini-2.5-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
		description: 'Fast and capable — strong default for everyday coding.',
		reasoning: {
			supported: true,
			supportedEfforts: ['default', 'low', 'medium', 'high'],
			defaultEffort: 'default',
		},
	},
	{
		id: 'gemini-2.5-pro',
		name: 'Gemini 2.5 Pro',
		apiModel: 'gemini-2.5-pro',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
		description: 'Highest quality Gemini model — best for complex reasoning and large refactors.',
		reasoning: {
			supported: true,
			supportedEfforts: ['default', 'low', 'medium', 'high'],
			defaultEffort: 'default',
		},
	},
];

export const MAGNUS_MODELS: readonly MagnusModelOption[] = DEFAULT_MAGNUS_MODELS;

export type MagnusDescriptionStatus =
	| 'ready'
	| 'notConfigured'
	| 'authError'
	| 'rateLimited'
	| 'networkError'
	| 'modelUnavailable'
	| 'cancelled'
	| 'disabled'
	| 'error'
	| 'skipped';

export interface MagnusDescriptionResult {
	readonly status: MagnusDescriptionStatus;
	readonly text?: string;
	readonly providerId?: string;
	readonly modelId?: string;
	readonly cacheIdentity?: string;
	readonly safeMessage?: string;
	readonly retryable?: boolean;
}

/** In-memory short-lived cache for discovered models (TTL 5 minutes). */
export class GeminiModelCache {
	private _models: DiscoveredGeminiModel[] | undefined;
	private _cachedAt: number = 0;
	private readonly _ttlMs: number;

	constructor(ttlMs: number = 5 * 60 * 1000) {
		this._ttlMs = ttlMs;
	}

	get(): DiscoveredGeminiModel[] | undefined {
		if (this._models && Date.now() - this._cachedAt < this._ttlMs) {
			return this._models;
		}
		return undefined;
	}

	set(models: DiscoveredGeminiModel[]): void {
		this._models = models;
		this._cachedAt = Date.now();
	}

	invalidate(): void {
		this._models = undefined;
		this._cachedAt = 0;
	}
}

export const globalGeminiModelCache = new GeminiModelCache();

export type DiscoveredModelInput = DiscoveredGeminiModel | import('./aiTypes').NormalizedAIModel;

function toNormalizedModel(m: DiscoveredModelInput): import('./aiTypes').NormalizedAIModel {
	const maybeNorm = m as import('./aiTypes').NormalizedAIModel;
	if (maybeNorm.capabilities && typeof maybeNorm.capabilities === 'object') {
		return maybeNorm;
	}
	const disc = m as DiscoveredGeminiModel;
	const supportsGenerate = Array.isArray(disc.supportedGenerationMethods)
		? disc.supportedGenerationMethods.includes('generateContent')
		: true;
	const modelName = typeof disc.name === 'string' && disc.name ? disc.name : `models/${m.id}`;
	return {
		id: m.id,
		name: modelName,
		displayName: m.displayName || m.id,
		description: m.description || `Google Gemini model (${m.id}).`,
		inputTokenLimit: m.inputTokenLimit || 1_000_000,
		outputTokenLimit: m.outputTokenLimit || 65_536,
		capabilities: {
			textGeneration: supportsGenerate,
			streaming: true,
			functionCalling: supportsGenerate,
			multimodalInput: true,
			structuredOutput: supportsGenerate,
			thinkingProtocol: true,
			agentCompatible: supportsGenerate,
			descriptionCompatible: supportsGenerate,
		},
		reasoning: {
			supported: true,
			supportedEfforts: ((typeof m.id === 'string' && m.id.startsWith('gemini-3.6-flash')) || (typeof m.name === 'string' && m.name.includes('gemini-3.6-flash')))
				? ['default', 'minimal', 'low', 'medium', 'high']
				: ['default', 'low', 'medium', 'high'],
			defaultEffort: 'default',
		},
	};
}

function getModelDisplayName(m: DiscoveredModelInput): string {
	const disc = m as DiscoveredGeminiModel;
	const discName = typeof disc.name === 'string' && disc.name ? disc.name : undefined;
	return m.displayName || discName || m.id;
}

/**
 * Builds list of user-selectable model options from discovered models or fallbacks.
 * Uses provider policy curation to ensure consumers see only curated stable models.
 */
export function buildModelOptions(discovered?: DiscoveredModelInput[]): MagnusModelOption[] {
	if (!discovered || discovered.length === 0) {
		return [...DEFAULT_MAGNUS_MODELS];
	}

	const normalized = discovered.map(toNormalizedModel);
	const curated = defaultGeminiModelPolicy.curateConsumerCatalog(normalized);

	return curated.map(m => ({
		id: m.id,
		name: m.isAuto ? 'Auto' : getModelDisplayName(m),
		apiModel: m.isAuto ? defaultGeminiModelPolicy.resolveAuto(curated) : m.id,
		maxInputTokens: m.inputTokenLimit,
		maxOutputTokens: m.outputTokenLimit,
		description: m.description || `Google Gemini model (${m.id}).`,
		isAuto: m.isAuto,
		reasoning: m.reasoning,
	}));
}

export function resolveApiModel(modelId: string, discovered?: DiscoveredModelInput[]): string {
	const options = buildModelOptions(discovered ?? globalGeminiModelCache.get());
	const found = options.find(m => m.id === modelId);
	return found?.apiModel || options[0]?.apiModel || DEFAULT_MAGNUS_MODELS[0].apiModel;
}

export function resolveModelInfo(modelId: string, discovered?: DiscoveredGeminiModel[]): { apiModel: string; resolvedModelId: string } {
	const options = buildModelOptions(discovered ?? globalGeminiModelCache.get());
	const found = options.find(m => m.id === modelId);
	if (found) {
		return { apiModel: found.apiModel, resolvedModelId: found.id };
	}
	return { apiModel: options[0]?.apiModel || DEFAULT_MAGNUS_MODELS[0].apiModel, resolvedModelId: 'auto' };
}

export function resolveModelOrFallback(modelId: string, discovered?: DiscoveredModelInput[]): string {
	const options = buildModelOptions(discovered ?? globalGeminiModelCache.get());
	const found = options.find(m => m.id === modelId);
	if (found) {
		return found.id;
	}
	// Fallback to auto
	return 'auto';
}

export function getModelOption(modelId: string, discovered?: DiscoveredGeminiModel[]): MagnusModelOption {
	const options = buildModelOptions(discovered ?? globalGeminiModelCache.get());
	return options.find(m => m.id === modelId) ?? options[0];
}

/** Cursor-style context label, e.g. "1M context window". */
export function formatContextWindowLabel(maxInputTokens: number): string {
	const n = Math.max(0, Math.floor(maxInputTokens));
	if (n >= 1_000_000) {
		const millions = n / 1_000_000;
		const label = Number.isInteger(millions) ? String(millions) : millions.toFixed(1).replace(/\.0$/, '');
		return `${label}M context window`;
	}
	if (n >= 1_000) {
		const thousands = Math.round(n / 1_000);
		return `${thousands}k context window`;
	}
	return `${n} context window`;
}

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
}

/**
 * Default fallback models when live discovery is not yet available or offline.
 * Auto resolves to Gemini 2.5 Flash as the balanced, fast default.
 */
export const DEFAULT_MAGNUS_MODELS: readonly MagnusModelOption[] = [
	{
		id: 'auto',
		name: 'Auto',
		apiModel: 'gemini-2.5-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
		description: 'Balanced quality and speed, recommended for most tasks (resolves to Gemini 2.5 Flash).',
		isAuto: true,
	},
	{
		id: 'gemini-2.5-pro',
		name: 'Gemini 2.5 Pro',
		apiModel: 'gemini-2.5-pro',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
		description: 'Highest quality Gemini model — best for complex reasoning and large refactors.',
	},
	{
		id: 'gemini-2.5-flash',
		name: 'Gemini 2.5 Flash',
		apiModel: 'gemini-2.5-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
		description: 'Fast and capable — strong default for everyday coding.',
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

function isCompatibleModel(m: DiscoveredModelInput): boolean {
	if ('capabilities' in m && m.capabilities) {
		return !!m.capabilities.agentCompatible;
	}
	if ('agentCompatible' in m) {
		return !!m.agentCompatible;
	}
	return true;
}

function getModelDisplayName(m: DiscoveredModelInput): string {
	return m.displayName || ('name' in m && m.name ? m.name : m.id);
}

/**
 * Builds list of user-selectable model options from discovered models or fallbacks.
 */
export function buildModelOptions(discovered?: DiscoveredModelInput[]): MagnusModelOption[] {
	if (!discovered || discovered.length === 0) {
		return [...DEFAULT_MAGNUS_MODELS];
	}

	const compatible = discovered.filter(isCompatibleModel);
	if (compatible.length === 0) {
		return [...DEFAULT_MAGNUS_MODELS];
	}

	// Determine best auto target: prefer gemini-3.x-flash, then 2.5-flash, then 2.5-pro, then first compatible
	const autoTarget = compatible.find(m => /^gemini-3\.\d+-flash/i.test(m.id))
		|| compatible.find(m => m.id === 'gemini-2.5-flash')
		|| compatible.find(m => m.id === 'gemini-2.5-pro')
		|| compatible[0];

	const targetDisplayName = getModelDisplayName(autoTarget);

	const autoOption: MagnusModelOption = {
		id: 'auto',
		name: 'Auto',
		apiModel: autoTarget.id,
		maxInputTokens: autoTarget.inputTokenLimit,
		maxOutputTokens: autoTarget.outputTokenLimit,
		description: `Balanced quality and speed (resolves to ${targetDisplayName}).`,
		isAuto: true,
	};

	const explicitOptions: MagnusModelOption[] = compatible.map(m => ({
		id: m.id,
		name: getModelDisplayName(m),
		apiModel: m.id,
		maxInputTokens: m.inputTokenLimit,
		maxOutputTokens: m.outputTokenLimit,
		description: m.description || `Google Gemini model (${m.id}).`,
	}));

	return [autoOption, ...explicitOptions];
}

export function resolveApiModel(modelId: string, discovered?: DiscoveredModelInput[]): string {
	const options = buildModelOptions(discovered ?? globalGeminiModelCache.get());
	const found = options.find(m => m.id === modelId);
	return found?.apiModel || 'gemini-2.5-flash';
}

export function resolveModelInfo(modelId: string, discovered?: DiscoveredGeminiModel[]): { apiModel: string; resolvedModelId: string } {
	const options = buildModelOptions(discovered ?? globalGeminiModelCache.get());
	const found = options.find(m => m.id === modelId);
	if (found) {
		return { apiModel: found.apiModel, resolvedModelId: found.id };
	}
	return { apiModel: 'gemini-2.5-flash', resolvedModelId: 'auto' };
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

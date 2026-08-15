/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
	/** Gemini API model id (empty for auto). */
	readonly apiModel: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	/** Short picker / hover description (Cursor-style). */
	readonly description: string;
}

/**
 * Active supported models for PreBase beta.
 * Stale / shutdown models (Gemini 1.5 Pro/Flash, Gemini 2.0 Flash) have been retired.
 * Auto resolves to Gemini 2.5 Flash as the balanced, fast default.
 */
export const MAGNUS_MODELS: readonly MagnusModelOption[] = [
	{
		id: 'auto',
		name: 'Auto',
		apiModel: 'gemini-2.5-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
		description: 'Balanced quality and speed, recommended for most tasks (resolves to Gemini 2.5 Flash).',
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

export function resolveApiModel(modelId: string): string {
	const found = MAGNUS_MODELS.find(m => m.id === modelId);
	return found?.apiModel ?? 'gemini-2.5-flash';
}

export function resolveModelInfo(modelId: string): { apiModel: string; resolvedModelId: string } {
	const found = MAGNUS_MODELS.find(m => m.id === modelId);
	if (found) {
		return { apiModel: found.apiModel, resolvedModelId: found.id };
	}
	return { apiModel: 'gemini-2.5-flash', resolvedModelId: 'auto' };
}

export function getModelOption(modelId: string): MagnusModelOption {
	return MAGNUS_MODELS.find(m => m.id === modelId) ?? MAGNUS_MODELS[0];
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


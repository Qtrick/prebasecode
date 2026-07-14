/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export interface MagnusModelOption {
	readonly id: string;
	readonly name: string;
	/** Gemini API model id (empty for auto). */
	readonly apiModel: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
}

export const MAGNUS_MODELS: readonly MagnusModelOption[] = [
	{
		id: 'auto',
		name: 'Auto',
		apiModel: 'gemini-2.5-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
	},
	{
		id: 'gemini-2.5-pro',
		name: 'Gemini 2.5 Pro',
		apiModel: 'gemini-2.5-pro',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
	},
	{
		id: 'gemini-2.5-flash',
		name: 'Gemini 2.5 Flash',
		apiModel: 'gemini-2.5-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
	},
	{
		id: 'gemini-2.0-flash',
		name: 'Gemini 2.0 Flash',
		apiModel: 'gemini-2.0-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 8192,
	},
	{
		id: 'gemini-1.5-pro',
		name: 'Gemini 1.5 Pro',
		apiModel: 'gemini-1.5-pro',
		maxInputTokens: 2_000_000,
		maxOutputTokens: 8192,
	},
	{
		id: 'gemini-1.5-flash',
		name: 'Gemini 1.5 Flash',
		apiModel: 'gemini-1.5-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 8192,
	},
];

export function resolveApiModel(modelId: string): string {
	const found = MAGNUS_MODELS.find(m => m.id === modelId);
	return found?.apiModel ?? 'gemini-2.5-flash';
}

export function getModelOption(modelId: string): MagnusModelOption {
	return MAGNUS_MODELS.find(m => m.id === modelId) ?? MAGNUS_MODELS[0];
}

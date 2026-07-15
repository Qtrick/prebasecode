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
	/** Short picker / hover description (Cursor-style). */
	readonly description: string;
}

export const MAGNUS_MODELS: readonly MagnusModelOption[] = [
	{
		id: 'auto',
		name: 'Auto',
		apiModel: 'gemini-2.5-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
		description: 'Balanced quality and speed, recommended for most tasks.',
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
	{
		id: 'gemini-2.0-flash',
		name: 'Gemini 2.0 Flash',
		apiModel: 'gemini-2.0-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 8192,
		description: 'Previous-generation Flash — quick responses with solid quality.',
	},
	{
		id: 'gemini-1.5-pro',
		name: 'Gemini 1.5 Pro',
		apiModel: 'gemini-1.5-pro',
		maxInputTokens: 2_000_000,
		maxOutputTokens: 8192,
		description: 'Very large context window for long files and multi-file reviews.',
	},
	{
		id: 'gemini-1.5-flash',
		name: 'Gemini 1.5 Flash',
		apiModel: 'gemini-1.5-flash',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 8192,
		description: 'Lightweight Flash for quick questions and small edits.',
	},
];

export function resolveApiModel(modelId: string): string {
	const found = MAGNUS_MODELS.find(m => m.id === modelId);
	return found?.apiModel ?? 'gemini-2.5-flash';
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

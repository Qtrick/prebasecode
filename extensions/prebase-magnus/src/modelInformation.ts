/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { formatContextWindowLabel, MAGNUS_MODELS } from './models';

export interface MagnusLanguageModelInformation {
	id: string;
	name: string;
	family: string;
	version: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	detail: string;
	tooltip: string;
	capabilities: { toolCalling: true; imageInput: false };
	isDefault: boolean;
	isUserSelectable: boolean;
	isBYOK: boolean;
}

/**
 * Produces the extension's advertised model metadata without claiming capabilities that the
 * Gemini transport does not currently implement.
 */
export function buildMagnusLanguageModelInformation(hasKey: boolean): MagnusLanguageModelInformation[] {
	return MAGNUS_MODELS.map((model, index) => ({
		id: model.id,
		name: model.name,
		family: 'gemini',
		version: '1.0.0',
		maxInputTokens: model.maxInputTokens,
		maxOutputTokens: model.maxOutputTokens,
		detail: formatContextWindowLabel(model.maxInputTokens),
		tooltip: hasKey
			? model.description
			: `${model.description}\n\nConfigure a model provider in secure storage before using Agents.`,
		// The Gemini transport maps function parts to VS Code tool calls and accepts
		// matching tool-result continuation messages.
		capabilities: { toolCalling: true, imageInput: false },
		isDefault: index === 0,
		isUserSelectable: true,
		isBYOK: true,
	}));
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatContextWindowLabel, buildModelOptions, globalGeminiModelCache, type MagnusModelOption, type DiscoveredModelInput } from './models';
import { createThinkingLevelConfigSchema } from './modelPolicy';

export interface MagnusLanguageModelInformation {
	id: string;
	name: string;
	family: string;
	version: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	detail: string;
	tooltip: string;
	capabilities: { toolCalling: true; imageInput: true };
	isDefault: boolean;
	isUserSelectable: boolean;
	isBYOK: boolean;
	configurationSchema?: Record<string, unknown>;
}

/**
 * Produces the extension's advertised model metadata dynamically based on discovered
 * models, with informative purpose descriptions and multimodal image input enabled.
 */
export function buildMagnusLanguageModelInformation(
	hasKey: boolean,
	discovered?: DiscoveredModelInput[],
): MagnusLanguageModelInformation[] {
	const modelOptions = buildModelOptions(discovered ?? globalGeminiModelCache.get());

	return modelOptions.map((model: MagnusModelOption, index: number) => {
		const configSchema = createThinkingLevelConfigSchema(model.reasoning);
		const contextWindowStr = formatContextWindowLabel(model.maxInputTokens);
		const hasContextInDesc = model.description ? model.description.includes(contextWindowStr) : false;
		const baseTooltip = model.description
			? (hasContextInDesc ? model.description : `${model.description} (${contextWindowStr})`)
			: contextWindowStr;
		return {
			id: model.id,
			name: model.name,
			family: 'gemini',
			version: '1.0.0',
			maxInputTokens: model.maxInputTokens,
			maxOutputTokens: model.maxOutputTokens,
			detail: model.description || contextWindowStr,
			tooltip: hasKey
				? baseTooltip
				: `${baseTooltip}\n\nConfigure a Gemini credential before using Agents.`,
			capabilities: { toolCalling: true, imageInput: true },
			isDefault: index === 0,
			isUserSelectable: true,
			isBYOK: true,
			...(configSchema ? { configurationSchema: configSchema } : {}),
		};
	});
}

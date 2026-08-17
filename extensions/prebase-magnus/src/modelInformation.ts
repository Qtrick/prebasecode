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
	capabilities: { toolCalling: true; imageInput: false };
	isDefault: boolean;
	isUserSelectable: boolean;
	isBYOK: boolean;
	configurationSchema?: Record<string, unknown>;
}

/**
 * Produces the extension's advertised model metadata dynamically based on discovered
 * models, without claiming capabilities that the transport does not currently implement.
 */
export function buildMagnusLanguageModelInformation(
	hasKey: boolean,
	discovered?: DiscoveredModelInput[],
): MagnusLanguageModelInformation[] {
	const modelOptions = buildModelOptions(discovered ?? globalGeminiModelCache.get());

	return modelOptions.map((model: MagnusModelOption, index: number) => {
		const configSchema = createThinkingLevelConfigSchema(model.reasoning);
		return {
			id: model.id,
			name: model.name,
			family: 'gemini',
			version: '1.0.0',
			maxInputTokens: model.maxInputTokens,
			maxOutputTokens: model.maxOutputTokens,
			detail: formatContextWindowLabel(model.maxInputTokens),
			tooltip: hasKey
				? model.description
				: `${model.description}\n\nConfigure a Gemini credential before using Agents.`,
			capabilities: { toolCalling: true, imageInput: false },
			isDefault: index === 0,
			isUserSelectable: true,
			isBYOK: true,
			...(configSchema ? { configurationSchema: configSchema } : {}),
		};
	});
}

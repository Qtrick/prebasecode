/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { test, suite } from 'node:test';
import {
	MAGNUS_MODELS,
	MAGNUS_PROVIDERS,
	resolveApiModel,
	resolveModelInfo,
	resolveModelOrFallback,
	getModelOption,
	formatContextWindowLabel,
} from './models.ts';
import { resolveAutoModelFromDiscovered } from './geminiAdapter.ts';

suite('Magnus Models & Providers', () => {
	test('defines Gemini as the primary provider with standard capabilities', () => {
		assert.strictEqual(MAGNUS_PROVIDERS.length, 1);
		const gemini = MAGNUS_PROVIDERS[0];
		assert.strictEqual(gemini.id, 'gemini');
		assert.strictEqual(gemini.capabilities.textGeneration, true);
		assert.strictEqual(gemini.capabilities.streaming, true);
		assert.strictEqual(gemini.capabilities.functionCalling, true);
	});

	test('contains active Gemini models and auto', () => {
		const modelIds = MAGNUS_MODELS.map(m => m.id);
		assert.deepStrictEqual(modelIds, ['auto', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-2.5-flash', 'gemini-2.5-pro']);
	});

	test('resolveApiModel resolves auto to gemini-3.8-flash', () => {
		assert.strictEqual(resolveApiModel('auto'), 'gemini-3.8-flash');
		assert.strictEqual(resolveApiModel('gemini-2.5-pro'), 'gemini-2.5-pro');
		assert.strictEqual(resolveApiModel('gemini-2.5-flash'), 'gemini-2.5-flash');
	});

	test('resolveModelInfo migrates retired models safely to auto/gemini-2.5-flash', () => {
		const retired = resolveModelInfo('gemini-2.0-flash');
		assert.strictEqual(retired.apiModel, 'gemini-2.5-flash');
		assert.strictEqual(retired.resolvedModelId, 'auto');

		const old15 = resolveModelInfo('gemini-1.5-pro');
		assert.strictEqual(old15.apiModel, 'gemini-2.5-flash');
		assert.strictEqual(old15.resolvedModelId, 'auto');
	});

	test('getModelOption falls back to auto option on unknown model id', () => {
		const opt = getModelOption('unknown-model-xyz');
		assert.strictEqual(opt.id, 'auto');
	});

	test('resolveModelOrFallback returns known model or falls back to auto', () => {
		assert.strictEqual(resolveModelOrFallback('gemini-2.5-pro'), 'gemini-2.5-pro');
		assert.strictEqual(resolveModelOrFallback('gemini-2.5-flash'), 'gemini-2.5-flash');
		assert.strictEqual(resolveModelOrFallback('unknown-old-model'), 'auto');
		assert.strictEqual(resolveModelOrFallback('auto'), 'auto');
	});

	function makeMockDiscoveredModel(id: string): any {
		return {
			id,
			name: `models/${id}`,
			displayName: id,
			description: id,
			inputTokenLimit: 1_000_000,
			outputTokenLimit: 65_536,
			capabilities: {
				textGeneration: true,
				streaming: true,
				functionCalling: true,
				multimodalInput: true,
				structuredOutput: true,
				thinkingProtocol: false,
				agentCompatible: true,
				descriptionCompatible: true,
			},
		};
	}

	test('resolveAutoModelFromDiscovered selects flash 3.x over 2.5 and 2.5 over pro', () => {
		// Case 1: 3.x flash available
		const with3x = [
			makeMockDiscoveredModel('gemini-3.7-flash'),
			makeMockDiscoveredModel('gemini-2.5-flash'),
			makeMockDiscoveredModel('gemini-2.5-pro'),
		];
		assert.strictEqual(resolveAutoModelFromDiscovered(with3x), 'gemini-3.7-flash');

		// Case 2: only 2.5 available
		const with25 = [
			makeMockDiscoveredModel('gemini-2.5-pro'),
			makeMockDiscoveredModel('gemini-2.5-flash'),
		];
		assert.strictEqual(resolveAutoModelFromDiscovered(with25), 'gemini-2.5-flash');

		// Case 3: only pro available
		const withPro = [
			makeMockDiscoveredModel('gemini-2.5-pro'),
		];
		assert.strictEqual(resolveAutoModelFromDiscovered(withPro), 'gemini-2.5-pro');

		// Case 4: empty / offline fallback
		assert.strictEqual(resolveAutoModelFromDiscovered([]), 'gemini-2.5-flash');
		assert.strictEqual(resolveAutoModelFromDiscovered(undefined), 'gemini-3.7-flash');
	});

	test('formatContextWindowLabel formats token counts cleanly', () => {
		assert.strictEqual(formatContextWindowLabel(1_000_000), '1M context window');
		assert.strictEqual(formatContextWindowLabel(2_000_000), '2M context window');
		assert.strictEqual(formatContextWindowLabel(128_000), '128k context window');
	});

	test('buildMagnusLanguageModelInformation includes purpose descriptions and imageInput capability', async () => {
		const { buildMagnusLanguageModelInformation } = await import('./modelInformation.ts');
		const infos = buildMagnusLanguageModelInformation(true);
		assert.ok(infos.length >= 3);
		for (const info of infos) {
			assert.ok(info.detail.length > 5, 'Must provide informative detail description');
			assert.strictEqual(info.capabilities.imageInput, true, 'Must enable imageInput capability');
			assert.strictEqual(info.capabilities.toolCalling, true, 'Must enable toolCalling capability');
			assert.ok(info.tooltip.includes('context window'), 'Tooltip must include context window label');
		}
	});
});

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
	getModelOption,
	formatContextWindowLabel,
} from './models.ts';

suite('Magnus Models & Providers', () => {
	test('defines Gemini as the primary provider with standard capabilities', () => {
		assert.strictEqual(MAGNUS_PROVIDERS.length, 1);
		const gemini = MAGNUS_PROVIDERS[0];
		assert.strictEqual(gemini.id, 'gemini');
		assert.strictEqual(gemini.capabilities.textGeneration, true);
		assert.strictEqual(gemini.capabilities.streaming, true);
		assert.strictEqual(gemini.capabilities.functionCalling, true);
	});

	test('contains only active Gemini 2.5 models and auto', () => {
		const modelIds = MAGNUS_MODELS.map(m => m.id);
		assert.deepStrictEqual(modelIds, ['auto', 'gemini-2.5-pro', 'gemini-2.5-flash']);
	});

	test('resolveApiModel resolves auto to gemini-2.5-flash', () => {
		assert.strictEqual(resolveApiModel('auto'), 'gemini-2.5-flash');
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

	test('formatContextWindowLabel formats token counts cleanly', () => {
		assert.strictEqual(formatContextWindowLabel(1_000_000), '1M context window');
		assert.strictEqual(formatContextWindowLabel(2_000_000), '2M context window');
		assert.strictEqual(formatContextWindowLabel(128_000), '128k context window');
	});
});

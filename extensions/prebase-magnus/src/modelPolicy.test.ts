/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { suite, test } from 'node:test';
import type { NormalizedAIModel } from './aiTypes.ts';
import {
	defaultGeminiModelPolicy,
	GeminiModelPolicy,
	type IModelPolicy,
	createThinkingLevelConfigSchema,
	getReasoningEffortLabel,
	getReasoningEffortDescription,
	resolveSupportedReasoningEffort,
} from './modelPolicy.ts';

suite('GeminiModelPolicy & Model Curation Layer', () => {
	const policy = new GeminiModelPolicy();

	function makeRawModel(id: string, displayName?: string): NormalizedAIModel {
		return {
			id,
			name: `models/${id}`,
			displayName: displayName || id,
			description: `Test model ${id}`,
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

	test('classifies stable Flash and Pro models as consumer selectable', () => {
		const flash25 = policy.classify(makeRawModel('gemini-2.5-flash', 'Gemini 2.5 Flash'));
		assert.strictEqual(flash25.releaseChannel, 'stable');
		assert.strictEqual(flash25.tier, 'flash');
		assert.strictEqual(flash25.consumerSelectable, true);
		assert.strictEqual(flash25.autoEligible, true);
		assert.strictEqual(flash25.descriptionEligible, true);

		const pro25 = policy.classify(makeRawModel('gemini-2.5-pro', 'Gemini 2.5 Pro'));
		assert.strictEqual(pro25.releaseChannel, 'stable');
		assert.strictEqual(pro25.tier, 'pro');
		assert.strictEqual(pro25.consumerSelectable, true);
		assert.strictEqual(pro25.autoEligible, true);

		const flash38 = policy.classify(makeRawModel('gemini-3.8-flash', 'Gemini 3.8 Flash'));
		assert.strictEqual(flash38.releaseChannel, 'stable');
		assert.strictEqual(flash38.tier, 'flash');
		assert.strictEqual(flash38.consumerSelectable, true);
		assert.strictEqual(flash38.autoEligible, true);

		const flash37 = policy.classify(makeRawModel('gemini-3.7-flash', 'Gemini 3.7 Flash'));
		assert.strictEqual(flash37.releaseChannel, 'stable');
		assert.strictEqual(flash37.tier, 'flash');
		assert.strictEqual(flash37.consumerSelectable, true);
		assert.strictEqual(flash37.autoEligible, true);
	});

	test('hides all preview models from consumer selector', () => {
		const previewModels = [
			'gemini-3-flash-preview',
			'gemini-3.1-pro-preview',
			'gemini-3.1-pro-preview-custom-tools',
			'gemini-3.1-flash-lite-preview',
			'gemini-2.5-flash-preview-tts',
			'gemini-2.5-pro-preview-tts',
			'gemini-2.5-computer-use-preview-10-2025',
			'deep-research-preview-apr-21-2026',
			'deep-research-pro-preview-dec-12-2025',
			'antigravity-agent-preview',
		];

		for (const id of previewModels) {
			const classified = policy.classify(makeRawModel(id));
			assert.strictEqual(classified.consumerSelectable, false, `Expected ${id} to not be consumer selectable`);
			assert.strictEqual(classified.visibility, 'hidden', `Expected ${id} to have hidden visibility`);
			assert.strictEqual(classified.autoEligible, false, `Expected ${id} to not be auto eligible`);
		}
	});

	test('hides experimental, latest aliases, and flash-lite models from consumer picker', () => {
		const exp = policy.classify(makeRawModel('gemini-2.5-flash-exp'));
		assert.strictEqual(exp.releaseChannel, 'experimental');
		assert.strictEqual(exp.consumerSelectable, false);

		const alias = policy.classify(makeRawModel('gemini-flash-latest'));
		assert.strictEqual(alias.releaseChannel, 'latest-alias');
		assert.strictEqual(alias.consumerSelectable, false);

		const lite = policy.classify(makeRawModel('gemini-2.5-flash-lite'));
		assert.strictEqual(lite.tier, 'lite');
		assert.strictEqual(lite.visibility, 'internal');
		assert.strictEqual(lite.consumerSelectable, false);
	});

	test('hides specialized non-coding models (media, audio, embeddings, robotics, gemma)', () => {
		const specialized = [
			'text-embedding-004',
			'imagen-3.0-generate-002',
			'veo-2.0-generate-001',
			'gemma-4-26b-a4b-it',
			'gemma-4-31b-it',
			'aqa',
		];

		for (const id of specialized) {
			const classified = policy.classify(makeRawModel(id));
			assert.strictEqual(classified.consumerSelectable, false, `Expected specialized model ${id} to be hidden`);
		}
	});

	test('curates a 50-model raw provider catalog dump down to Auto + 2-4 stable models', () => {
		const rawCatalog = [
			makeRawModel('gemini-2.5-flash', 'Gemini 2.5 Flash'),
			makeRawModel('gemini-2.5-pro', 'Gemini 2.5 Pro'),
			makeRawModel('gemini-3.7-flash', 'Gemini 3.7 Flash'),
			makeRawModel('gemini-3.6-flash', 'Gemini 3.6 Flash'),
			makeRawModel('gemini-3-flash-preview', 'Gemini 3 Flash Preview'),
			makeRawModel('gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'),
			makeRawModel('gemini-3.1-pro-preview-custom-tools', 'Gemini 3.1 Pro Preview Custom Tools'),
			makeRawModel('gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite Preview'),
			makeRawModel('gemini-2.5-flash-preview-tts', 'Gemini 2.5 Flash Preview TTS'),
			makeRawModel('gemini-2.5-pro-preview-tts', 'Gemini 2.5 Pro Preview TTS'),
			makeRawModel('gemini-2.5-computer-use-preview-10-2025', 'Gemini 2.5 Computer Use Preview'),
			makeRawModel('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite'),
			makeRawModel('gemini-flash-latest', 'Gemini Flash Latest'),
			makeRawModel('deep-research-preview-apr-21-2026', 'Deep Research Preview'),
			makeRawModel('deep-research-pro-preview-dec-12-2025', 'Deep Research Pro Preview'),
			makeRawModel('antigravity-agent-preview', 'Antigravity Agent Preview'),
			makeRawModel('gemma-4-26b-a4b-it', 'Gemma 4 26B A4B IT'),
			makeRawModel('gemma-4-31b-it', 'Gemma 4 31B IT'),
			makeRawModel('text-embedding-004', 'Text Embedding 004'),
			makeRawModel('imagen-3.0-generate-002', 'Imagen 3.0'),
		];

		const curated = policy.curateConsumerCatalog(rawCatalog);
		const ids = curated.map(m => m.id);

		// Must start with Auto
		assert.strictEqual(ids[0], 'auto');

		// Must not contain any preview, experimental, alias, or specialized models
		assert.strictEqual(ids.some(id => id.includes('preview')), false, 'Curated catalog must not contain preview models');
		assert.strictEqual(ids.some(id => id.includes('exp')), false, 'Curated catalog must not contain exp models');
		assert.strictEqual(ids.some(id => id.includes('latest')), false, 'Curated catalog must not contain latest alias');
		assert.strictEqual(ids.some(id => id.includes('gemma')), false, 'Curated catalog must not contain gemma');
		assert.strictEqual(ids.some(id => id.includes('lite')), false, 'Curated catalog must not contain lite');
		assert.strictEqual(ids.some(id => id.includes('research')), false, 'Curated catalog must not contain research');
		assert.strictEqual(ids.some(id => id.includes('computer-use')), false, 'Curated catalog must not contain computer-use');

		// Total consumer options must be small (Auto + <= 4 models)
		assert.ok(curated.length <= 5, `Expected small curated set, received ${curated.length}`);
	});

	test('resolves Auto dynamically using version hierarchy', () => {
		// Frontier available: gemini-3.8-flash
		const catalogWith38 = [
			makeRawModel('gemini-3.8-flash', 'Gemini 3.8 Flash'),
			makeRawModel('gemini-3.7-flash', 'Gemini 3.7 Flash'),
			makeRawModel('gemini-3.6-flash', 'Gemini 3.6 Flash'),
			makeRawModel('gemini-2.5-flash', 'Gemini 2.5 Flash'),
			makeRawModel('gemini-2.5-pro', 'Gemini 2.5 Pro'),
		];
		assert.strictEqual(policy.resolveAuto(catalogWith38), 'gemini-3.8-flash');

		// Frontier available: gemini-3.7-flash
		const catalogWith37 = [
			makeRawModel('gemini-3.7-flash', 'Gemini 3.7 Flash'),
			makeRawModel('gemini-3.6-flash', 'Gemini 3.6 Flash'),
			makeRawModel('gemini-2.5-flash', 'Gemini 2.5 Flash'),
			makeRawModel('gemini-2.5-pro', 'Gemini 2.5 Pro'),
		];
		assert.strictEqual(policy.resolveAuto(catalogWith37), 'gemini-3.7-flash');

		// Frontier absent, only 2.5 available
		const catalog25 = [
			makeRawModel('gemini-2.5-flash', 'Gemini 2.5 Flash'),
			makeRawModel('gemini-2.5-pro', 'Gemini 2.5 Pro'),
		];
		assert.strictEqual(policy.resolveAuto(catalog25), 'gemini-2.5-flash');

		// Only Pro available
		const catalogPro = [
			makeRawModel('gemini-2.5-pro', 'Gemini 2.5 Pro'),
		];
		assert.strictEqual(policy.resolveAuto(catalogPro), 'gemini-2.5-pro');

		// Empty catalog fallback
		assert.strictEqual(policy.resolveAuto([]), 'gemini-2.5-flash');
	});

	test('routes workload profiles to appropriate model classes', () => {
		const catalog = [
			makeRawModel('gemini-3.7-flash', 'Gemini 3.7 Flash'),
			makeRawModel('gemini-2.5-flash', 'Gemini 2.5 Flash'),
			makeRawModel('gemini-2.5-pro', 'Gemini 2.5 Pro'),
			makeRawModel('gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'),
		];

		// description workload routes to stable fast Flash (never preview)
		const descModel = policy.resolveWorkloadModel(catalog, 'description');
		assert.strictEqual(descModel, 'gemini-3.7-flash');
		assert.ok(!descModel.includes('preview'), 'Description model must never be preview');

		// deep-reasoning routes to stable Pro (never preview)
		const reasonModel = policy.resolveWorkloadModel(catalog, 'deep-reasoning');
		assert.strictEqual(reasonModel, 'gemini-2.5-pro');
		assert.ok(!reasonModel.includes('preview'), 'Reasoning model must never be preview');
	});

	test('safely migrates obsolete, preview, or invalid saved model selections', () => {
		const curated = policy.curateConsumerCatalog([
			makeRawModel('gemini-2.5-flash', 'Gemini 2.5 Flash'),
			makeRawModel('gemini-2.5-pro', 'Gemini 2.5 Pro'),
		]);

		// Valid model
		assert.strictEqual(policy.isMigrationRequired('gemini-2.5-flash', curated), false);
		assert.strictEqual(policy.migrateSavedModel('gemini-2.5-flash', curated), 'gemini-2.5-flash');

		// Auto
		assert.strictEqual(policy.isMigrationRequired('auto', curated), false);
		assert.strictEqual(policy.migrateSavedModel('auto', curated), 'auto');

		// Preview model -> migrates to auto or nearest stable
		assert.strictEqual(policy.isMigrationRequired('gemini-3.1-pro-preview', curated), true);
		assert.strictEqual(policy.migrateSavedModel('gemini-3.1-pro-preview', curated), 'gemini-2.5-pro');

		// Deprecated pro model -> migrates to stable pro
		assert.strictEqual(policy.isMigrationRequired('gemini-1.5-pro', curated), true);
		assert.strictEqual(policy.migrateSavedModel('gemini-1.5-pro', curated), 'gemini-2.5-pro');

		// Unknown / unsupported model -> migrates to auto
		assert.strictEqual(policy.isMigrationRequired('unknown-model-xyz', curated), true);
		assert.strictEqual(policy.migrateSavedModel('unknown-model-xyz', curated), 'auto');
	});

	test('formats safe diagnostics without sensitive leakage', () => {
		const rawCatalog = [
			makeRawModel('gemini-2.5-flash', 'Gemini 2.5 Flash'),
			makeRawModel('gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'),
			makeRawModel('text-embedding-004', 'Embedding 004'),
		];

		const diag = policy.formatDiagnostics(rawCatalog);
		assert.strictEqual(diag.providerId, 'gemini');
		assert.strictEqual(diag.rawModelCount, 3);
		assert.strictEqual(typeof diag.autoResolvedModel, 'string');
		assert.strictEqual(typeof diag.classificationSummary, 'object');

		const json = JSON.stringify(diag);
		assert.strictEqual(json.includes('AIza'), false, 'Diagnostics must not contain API keys');
		assert.strictEqual(json.includes('Bearer'), false, 'Diagnostics must not contain Bearer tokens');
	});

	test('demonstrates future provider extensibility via provider-agnostic IModelPolicy interface', () => {
		class MockClaudeModelPolicy implements IModelPolicy {
			readonly providerId = 'claude';
			classify(m: NormalizedAIModel): NormalizedAIModel {
				const isPreview = m.id.includes('preview');
				return {
					...m,
					providerId: 'claude',
					releaseChannel: isPreview ? 'preview' : 'stable',
					consumerSelectable: !isPreview,
					autoEligible: !isPreview,
					visibility: isPreview ? 'hidden' : 'consumer',
				};
			}
			curateConsumerCatalog(models: readonly NormalizedAIModel[]): NormalizedAIModel[] {
				const valid = models.filter(m => !m.id.includes('preview'));
				return [{ id: 'auto', name: 'Auto', displayName: 'Auto', description: 'Auto', inputTokenLimit: 200_000, outputTokenLimit: 8192, capabilities: { textGeneration: true, streaming: true, functionCalling: true, multimodalInput: true, structuredOutput: true, thinkingProtocol: true, agentCompatible: true, descriptionCompatible: true }, isAuto: true }, ...valid];
			}
			resolveAuto(catalog: readonly NormalizedAIModel[]): string {
				return catalog.find(m => m.id !== 'auto')?.id || 'claude-3-7-sonnet';
			}
			resolveWorkloadModel(catalog: readonly NormalizedAIModel[]): string {
				return 'claude-3-5-haiku';
			}
			isMigrationRequired(id: string, catalog: readonly NormalizedAIModel[]): boolean {
				return id !== 'auto' && !catalog.some(m => m.id === id);
			}
			migrateSavedModel(id: string, catalog: readonly NormalizedAIModel[]): string {
				return this.isMigrationRequired(id, catalog) ? 'auto' : id;
			}
			formatDiagnostics(catalog: readonly NormalizedAIModel[]) {
				return { providerId: 'claude', count: catalog.length };
			}
		}

		const mockPolicy = new MockClaudeModelPolicy();
		const raw = [
			makeRawModel('claude-3-7-sonnet'),
			makeRawModel('claude-3-7-sonnet-preview'),
		];

		const curated = mockPolicy.curateConsumerCatalog(raw);
		assert.strictEqual(curated.length, 2);
		assert.strictEqual(curated[0].id, 'auto');
		assert.strictEqual(curated[1].id, 'claude-3-7-sonnet');
	});

	test('fails closed for unrecognized models with unknown release channel', () => {
		const unknownModel = policy.classify(makeRawModel('unrecognized-test-model-xyz'));
		assert.strictEqual(unknownModel.releaseChannel, 'unknown');
		assert.strictEqual(unknownModel.consumerSelectable, false);
		assert.strictEqual(unknownModel.autoEligible, false);
		assert.strictEqual(unknownModel.descriptionEligible, false);
		assert.strictEqual(unknownModel.visibility, 'hidden');
		assert.strictEqual(unknownModel.hiddenReason, 'Unknown release channel (fail closed)');
	});

	test('synthesizes accurate reasoning metadata for Flash, Pro, and Auto models', () => {
		// Gemini 3.7 Flash: Minimal is unsupported -> default, low, medium, high
		const flash37 = policy.classify(makeRawModel('gemini-3.7-flash', 'Gemini 3.7 Flash'));
		assert.strictEqual(flash37.reasoning?.supported, true);
		assert.deepStrictEqual(flash37.reasoning?.supportedEfforts, ['default', 'low', 'medium', 'high']);
		assert.strictEqual(flash37.reasoning?.defaultEffort, 'default');

		// Gemini 3.6 Flash: Minimal is supported -> default, minimal, low, medium, high
		const flash36 = policy.classify(makeRawModel('gemini-3.6-flash', 'Gemini 3.6 Flash'));
		assert.strictEqual(flash36.reasoning?.supported, true);
		assert.deepStrictEqual(flash36.reasoning?.supportedEfforts, ['default', 'minimal', 'low', 'medium', 'high']);
		assert.strictEqual(flash36.reasoning?.defaultEffort, 'default');

		// Gemini 2.5 Flash: consumer levels -> default, low, medium, high
		const flash25 = policy.classify(makeRawModel('gemini-2.5-flash', 'Gemini 2.5 Flash'));
		assert.strictEqual(flash25.reasoning?.supported, true);
		assert.deepStrictEqual(flash25.reasoning?.supportedEfforts, ['default', 'low', 'medium', 'high']);
		assert.strictEqual(flash25.reasoning?.defaultEffort, 'default');

		// Gemini 2.5 Pro: default, low, medium, high
		const pro25 = policy.classify(makeRawModel('gemini-2.5-pro', 'Gemini 2.5 Pro'));
		assert.strictEqual(pro25.reasoning?.supported, true);
		assert.deepStrictEqual(pro25.reasoning?.supportedEfforts, ['default', 'low', 'medium', 'high']);
		assert.strictEqual(pro25.reasoning?.defaultEffort, 'default');

		// Auto model: safe intersection across auto targets -> default, low, medium, high
		const curated = policy.curateConsumerCatalog([
			makeRawModel('gemini-3.7-flash', 'Gemini 3.7 Flash'),
			makeRawModel('gemini-3.6-flash', 'Gemini 3.6 Flash'),
			makeRawModel('gemini-2.5-flash', 'Gemini 2.5 Flash'),
			makeRawModel('gemini-2.5-pro', 'Gemini 2.5 Pro'),
		]);
		const auto = curated.find(m => m.id === 'auto');
		assert.ok(auto);
		assert.strictEqual(auto.reasoning?.supported, true);
		assert.deepStrictEqual(auto.reasoning?.supportedEfforts, ['default', 'low', 'medium', 'high']);
		assert.strictEqual(auto.reasoning?.defaultEffort, 'default');
	});

	test('resolves supported reasoning effort safely defending against unsupported model efforts', () => {
		// 3.6 Flash supports minimal
		assert.strictEqual(resolveSupportedReasoningEffort('gemini-3.6-flash', 'minimal'), 'minimal');
		assert.strictEqual(resolveSupportedReasoningEffort('gemini-3.6-flash', 'low'), 'low');

		// 3.7 Flash normalizes minimal to low
		assert.strictEqual(resolveSupportedReasoningEffort('gemini-3.7-flash', 'minimal'), 'low');
		assert.strictEqual(resolveSupportedReasoningEffort('gemini-3.7-flash', 'medium'), 'medium');

		// 2.5 Flash normalizes minimal to low
		assert.strictEqual(resolveSupportedReasoningEffort('gemini-2.5-flash', 'minimal'), 'low');
		assert.strictEqual(resolveSupportedReasoningEffort('gemini-2.5-flash', 'default'), 'default');
	});

	test('creates navigation configuration schema for models with thinking support', () => {
		assert.strictEqual(getReasoningEffortLabel('default'), 'Default');
		assert.strictEqual(getReasoningEffortLabel('minimal'), 'Minimal');
		assert.strictEqual(getReasoningEffortLabel('low'), 'Low');
		assert.strictEqual(getReasoningEffortLabel('medium'), 'Medium');
		assert.strictEqual(getReasoningEffortLabel('high'), 'High');

		const schema = createThinkingLevelConfigSchema({
			supported: true,
			supportedEfforts: ['default', 'minimal', 'low', 'medium', 'high'],
			defaultEffort: 'default',
		});

		assert.ok(schema);
		assert.strictEqual(schema.type, 'object');
		const props = schema.properties as Record<string, any>;
		assert.ok(props.thinkingLevel);
		assert.strictEqual(props.thinkingLevel.title, 'Thinking Effort');
		assert.strictEqual(props.thinkingLevel.group, 'navigation');
		assert.strictEqual(props.thinkingLevel.default, 'default');
		assert.deepStrictEqual(props.thinkingLevel.enum, ['default', 'minimal', 'low', 'medium', 'high']);
		assert.deepStrictEqual(props.thinkingLevel.enumItemLabels, ['Default', 'Minimal', 'Low', 'Medium', 'High']);
		assert.strictEqual(props.thinkingLevel.enumDescriptions.length, 5);
	});
});

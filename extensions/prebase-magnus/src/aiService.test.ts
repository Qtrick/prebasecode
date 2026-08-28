/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PreBaseAIService, InMemoryConfigProvider, VsCodeWorkspaceConfigProvider } from './aiService.ts';
import { AIProviderRegistry } from './aiProviderRegistry.ts';
import { MagnusSecretStorage } from './secretStorage.ts';
import { PreBaseSecretResolver } from './secretResolver.ts';
import { buildModelOptions, resolveApiModel, resolveModelInfo } from './models.ts';
import { MAGNUS_SMOKE_CHUNKS, MagnusSmokeTransportAdapter } from './smokeTransport.ts';
import type {
	AIGenerateRequest,
	AIGenerateResponseCandidate,
	AIGenerateResult,
	IPreBaseAIProviderAdapter,
	NormalizedAIModel,
} from './aiTypes.ts';
import type { PreBaseAIExecutionMode } from './secretCatalog.ts';

/**
 * ============================================================================
 * STATE MATRIX ENUMERATION:
 * ----------------------------------------------------------------------------
 * 1. Credential-Source States:
 *    - 'local-env' (PreBase application root .env)
 *    - 'secret-storage' (OS SecretStorage BYOK)
 *    - 'process-env' (Fallback environment)
 *    - 'hosted' (PreBase Cloud authenticated agent-gateway)
 *    - 'unconfigured' (No key or cloud auth present)
 *
 * 2. Execution-Mode States:
 *    - 'auto' (source dev -> local-env > secret-storage > hosted > process-env; packaged -> secret-storage > hosted)
 *    - 'development-env' (strictly local-env / process-env)
 *    - 'byok' (strictly SecretStorage)
 *    - 'hosted' (strictly Cloud gateway)
 *
 * 3. Model-Discovery States:
 *    - 'live' (fetched from active provider/gateway)
 *    - 'cached' (valid TTL cache < 5 minutes)
 *    - 'fallback' (static fallback catalog when unconfigured or offline)
 *    - 'stale' (invalidated on provider/mode change)
 *
 * 4. Model Capabilities:
 *    - agentCompatible (chat, tool-calling, multi-step loops)
 *    - descriptionCompatible (architectural graph file summaries)
 *
 * 5. Generation Modes & Errors:
 *    - Non-streaming text & candidate generation
 *    - SSE streaming chunk delivery
 *    - Error classification: notConfigured, authentication, rateLimited, quotaExceeded,
 *      modelUnavailable, invalidRequest, network, cancelled, providerServerError
 * ============================================================================
 */

class MockSecretStorage {
	private readonly map = new Map<string, string>();

	async get(key: string): Promise<string | undefined> {
		return this.map.get(key);
	}

	async store(key: string, value: string): Promise<void> {
		this.map.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.map.delete(key);
	}
}

class MockAIProviderAdapter implements IPreBaseAIProviderAdapter {
	readonly id: string;
	readonly displayName: string;
	readonly supportedExecutionModes: readonly PreBaseAIExecutionMode[] = ['auto', 'development-env', 'byok', 'hosted'];
	readonly defaultModel = 'auto';
	readonly staticFallbackModels: readonly NormalizedAIModel[];

	discoverCalls = 0;
	generateCalls = 0;
	streamCalls = 0;
	testCalls = 0;

	generateResult: AIGenerateResult = {
		text: 'Mock response text',
		modelId: 'gemini-2.5-flash',
		providerId: 'gemini',
		executionMode: 'byok',
	};

	readonly supportedExecutionModes: readonly PreBaseAIExecutionMode[] = ['byok', 'development-env'];
	readonly defaultModel = 'gemini-2.5-flash';

	discoveredModels: NormalizedAIModel[] = [
		{
			id: 'gemini-2.5-flash',
			name: 'models/gemini-2.5-flash',
			displayName: 'Gemini 2.5 Flash',
			description: 'Mock fast model',
			inputTokenLimit: 1_000_000,
			outputTokenLimit: 65_536,
			capabilities: {
				textGeneration: true,
				streaming: true,
				functionCalling: true,
				multimodalInput: false,
				agentCompatible: true,
				descriptionCompatible: true,
			},
		},
		{
			id: 'gemini-2.5-pro',
			name: 'models/gemini-2.5-pro',
			displayName: 'Gemini 2.5 Pro',
			description: 'Mock quality model',
			inputTokenLimit: 2_000_000,
			outputTokenLimit: 65_536,
			capabilities: {
				textGeneration: true,
				streaming: true,
				functionCalling: true,
				multimodalInput: false,
				agentCompatible: true,
				descriptionCompatible: true,
			},
		},
	];

	constructor(id = 'gemini', displayName = 'Google Gemini') {
		this.id = id;
		this.displayName = displayName;
		this.staticFallbackModels = [...this.discoveredModels];
	}

	resolveAutoModel(executionMode: PreBaseAIExecutionMode): string {
		return 'gemini-2.5-flash';
	}

	async discoverModels(): Promise<NormalizedAIModel[]> {
		this.discoverCalls++;
		return [...this.discoveredModels];
	}

	async generate(request: AIGenerateRequest): Promise<AIGenerateResult> {
		this.generateCalls++;
		return this.generateResult;
	}

	async streamGenerate(
		request: AIGenerateRequest,
		credential: unknown,
		onChunk: (chunk: { text?: string; candidate?: AIGenerateResponseCandidate }) => void,
	): Promise<AIGenerateResult> {
		this.streamCalls++;
		onChunk({ text: 'Streamed part 1' });
		onChunk({ text: 'Streamed part 2' });
		return {
			text: 'Streamed part 1Streamed part 2',
			modelId: request.modelId,
			providerId: this.id,
			executionMode: 'byok',
		};
	}

	async testConnection(
		credential?: ResolvedProviderExecution,
		modelId?: string,
		token?: AICancellationToken,
	): Promise<{ ok: boolean; modelId: string; reply?: string; error?: AIProviderErrorClassification }> {
		this.testCalls++;
		return { ok: true, modelId: modelId || 'gemini-2.5-flash', reply: 'PONG' };
	}

	normalizeError(err: unknown): AIProviderErrorClassification {
		return {
			code: 'unknown',
			safeMessage: err instanceof Error ? err.message : String(err),
			retryable: false,
		};
	}
}

describe('PreBaseAIService & Provider Resolution', () => {
	it('resolves execution modes and updates provider status cleanly', async () => {
		const mockStorage = new MockSecretStorage();
		const resolver = new PreBaseSecretResolver({ forcePackaged: true });
		const secrets = new MagnusSecretStorage(mockStorage as never, resolver);
		const adapter = new MockAIProviderAdapter();
		const registry = new AIProviderRegistry([adapter]);
		const configProvider = new InMemoryConfigProvider({ executionMode: 'byok' });
		const aiService = new PreBaseAIService(secrets, registry, configProvider);

		// Initially unconfigured in BYOK mode
		const status1 = await aiService.getProviderStatus('gemini');
		assert.equal(status1.configured, false);
		assert.equal(status1.executionMode, 'byok');

		// Configure key in SecretStorage
		await secrets.setProviderApiKey('gemini', 'secret-byok-test-key-12345');
		const status2 = await aiService.getProviderStatus('gemini');
		assert.equal(status2.configured, true);
		assert.equal(status2.effectiveSource, 'OS SecretStorage (BYOK)');
	});

	it('reads and writes configuration via PreBaseAIConfigProvider', async () => {
		const mockStorage = new MockSecretStorage();
		const resolver = new PreBaseSecretResolver({ forcePackaged: true });
		const secrets = new MagnusSecretStorage(mockStorage as never, resolver);
		const adapter = new MockAIProviderAdapter();
		const registry = new AIProviderRegistry([adapter]);
		const config = new InMemoryConfigProvider({ executionMode: 'auto', defaultModel: 'auto', enabled: true });
		const aiService = new PreBaseAIService(secrets, registry, config);

		assert.equal(aiService.getExecutionMode(), 'auto');
		assert.equal(aiService.isEnabled(), true);
		assert.equal(aiService.getActiveModelId(), 'auto');

		await aiService.setExecutionMode('development-env');
		assert.equal(aiService.getExecutionMode(), 'development-env');
		assert.equal(config.getExecutionMode(), 'development-env');

		await aiService.setActiveModelId('gemini-2.5-pro');
		assert.equal(aiService.getActiveModelId(), 'gemini-2.5-pro');
		assert.equal(config.getDefaultModel(), 'gemini-2.5-pro');
	});

	it('works with VsCodeWorkspaceConfigProvider adapter pattern', async () => {
		const store = new Map<string, unknown>([
			['executionMode', 'byok'],
			['provider', 'gemini'],
			['defaultModel', 'gemini-2.5-flash'],
			['enabled', true],
		]);

		const mockVsCodeConfig = {
			get: <T>(key: string, def?: T): T => (store.has(key) ? (store.get(key) as T) : (def as T)),
			update: async (key: string, val: unknown) => {
				store.set(key, val);
			},
		};

		const provider = new VsCodeWorkspaceConfigProvider(() => mockVsCodeConfig);
		assert.equal(provider.getExecutionMode(), 'byok');
		assert.equal(provider.getProvider(), 'gemini');
		assert.equal(provider.getDefaultModel(), 'gemini-2.5-flash');
		assert.equal(provider.isEnabled(), true);

		await provider.setExecutionMode('development-env');
		assert.equal(store.get('executionMode'), 'development-env');
	});

	it('discovers and caches models with TTL and handles auto model resolution', async () => {
		const mockStorage = new MockSecretStorage();
		await mockStorage.store('prebase.magnus.provider.gemini.apiKey', 'valid-key');
		const resolver = new PreBaseSecretResolver({ forcePackaged: true });
		const secrets = new MagnusSecretStorage(mockStorage as never, resolver);
		const adapter = new MockAIProviderAdapter();
		const registry = new AIProviderRegistry([adapter]);
		const aiService = new PreBaseAIService(secrets, registry);

		// First call should discover live models
		const models1 = await aiService.listModels('gemini', false);
		assert.equal(adapter.discoverCalls, 1);
		assert.ok(models1.length > 0);
		assert.ok(models1.some(m => m.id === 'gemini-2.5-flash'));

		// Second call should return cached models without rediscovery
		const models2 = await aiService.listModels('gemini', false);
		assert.equal(adapter.discoverCalls, 1);
		assert.equal(models2.length, models1.length);

		// Force refresh should trigger discovery
		await aiService.listModels('gemini', true);
		assert.equal(adapter.discoverCalls, 2);
	});

	it('builds model options correctly from both NormalizedAIModel and legacy formats', () => {
		const normalized: NormalizedAIModel[] = [
			{
				id: 'gemini-2.5-flash',
				name: 'models/gemini-2.5-flash',
				displayName: 'Gemini 2.5 Flash',
				description: 'Fast model',
				inputTokenLimit: 1_000_000,
				outputTokenLimit: 65_536,
				capabilities: {
					textGeneration: true,
					streaming: true,
					functionCalling: true,
					multimodalInput: false,
					agentCompatible: true,
					descriptionCompatible: true,
				},
			},
			{
				id: 'incompatible-embed',
				name: 'models/text-embedding-004',
				displayName: 'Text Embedding 004',
				inputTokenLimit: 2048,
				outputTokenLimit: 0,
				capabilities: {
					textGeneration: false,
					streaming: false,
					functionCalling: false,
					multimodalInput: false,
					agentCompatible: false,
					descriptionCompatible: false,
				},
			},
		];

		const options = buildModelOptions(normalized);
		assert.equal(options.length, 2); // Auto + gemini-2.5-flash (embed filtered out)
		assert.equal(options[0].id, 'auto');
		assert.equal(options[0].apiModel, 'gemini-2.5-flash');
		assert.equal(options[1].id, 'gemini-2.5-flash');

		assert.equal(resolveApiModel('auto', normalized), 'gemini-2.5-flash');
		assert.equal(resolveApiModel('gemini-2.5-flash', normalized), 'gemini-2.5-flash');
		assert.equal(resolveApiModel('unknown-retired-model', normalized), 'gemini-2.5-flash');

		const info = resolveModelInfo('auto');
		assert.equal(info.apiModel, 'gemini-2.5-flash');
	});

	it('generates text and stream candidates cleanly', async () => {
		const mockStorage = new MockSecretStorage();
		await mockStorage.store('prebase.magnus.provider.gemini.apiKey', 'valid-key');
		const resolver = new PreBaseSecretResolver({ forcePackaged: true });
		const secrets = new MagnusSecretStorage(mockStorage as never, resolver);
		const adapter = new MockAIProviderAdapter();
		const registry = new AIProviderRegistry([adapter]);
		const aiService = new PreBaseAIService(secrets, registry);

		const reply = await aiService.generateText('Explain recursion in 5 words.');
		assert.equal(adapter.generateCalls, 1);
		assert.equal(reply, 'Mock response text');

		const chunks: string[] = [];
		const streamResult = await aiService.streamCandidate(
			{
				messages: [{ role: 'user', parts: [{ text: 'Hello' }] }],
			},
			chunk => {
				if (chunk.text) {
					chunks.push(chunk.text);
				}
			},
		);

		assert.equal(adapter.streamCalls, 1);
		assert.equal(chunks.length, 2);
		assert.equal(streamResult.text, 'Streamed part 1Streamed part 2');
	});

	it('generates structured architectural file descriptions with dynamic cache identity', async () => {
		const mockStorage = new MockSecretStorage();
		await mockStorage.store('prebase.magnus.provider.gemini.apiKey', 'valid-key');
		const resolver = new PreBaseSecretResolver({ forcePackaged: true });
		const secrets = new MagnusSecretStorage(mockStorage as never, resolver);
		const adapter = new MockAIProviderAdapter();
		const registry = new AIProviderRegistry([adapter]);
		const aiService = new PreBaseAIService(secrets, registry);

		const desc = await aiService.describeFile('File content for description', 'src/vs/editor.ts');
		assert.equal(desc.status, 'ready');
		assert.equal(desc.text, 'Mock response text');
		assert.ok(desc.cacheIdentity?.startsWith('gemini:'));
	});

	it('handles unconfigured description requests gracefully with clear status', async () => {
		const mockStorage = new MockSecretStorage();
		const resolver = new PreBaseSecretResolver({ forcePackaged: true });
		const secrets = new MagnusSecretStorage(mockStorage as never, resolver);
		const adapter = new MockAIProviderAdapter();
		const registry = new AIProviderRegistry([adapter]);
		const aiService = new PreBaseAIService(secrets, registry);

		const desc = await aiService.describeFile('File content', 'src/vs/editor.ts');
		assert.equal(desc.status, 'notConfigured');
		assert.ok(desc.safeMessage?.includes('unavailable'));
	});

	it('tests provider connectivity with connection ping', async () => {
		const mockStorage = new MockSecretStorage();
		await mockStorage.store('prebase.magnus.provider.gemini.apiKey', 'valid-key');
		const resolver = new PreBaseSecretResolver({ forcePackaged: true });
		const secrets = new MagnusSecretStorage(mockStorage as never, resolver);
		const adapter = new MockAIProviderAdapter();
		const registry = new AIProviderRegistry([adapter]);
		const aiService = new PreBaseAIService(secrets, registry);

		const testRes = await aiService.testConnection('gemini');
		assert.equal(testRes.ok, true);
		assert.equal(testRes.reply, 'PONG');
		assert.equal(adapter.testCalls, 1);
	});

	it('retries describeFile automatically on token starvation / MAX_TOKENS', async () => {
		const mockStorage = new MockSecretStorage();
		await mockStorage.store('prebase.magnus.provider.gemini.apiKey', 'valid-key');
		const resolver = new PreBaseSecretResolver({ forcePackaged: true });
		const secrets = new MagnusSecretStorage(mockStorage as never, resolver);
		const adapter = new MockAIProviderAdapter();
		const registry = new AIProviderRegistry([adapter]);
		const aiService = new PreBaseAIService(secrets, registry);

		let callCount = 0;
		adapter.generate = async (req: AIGenerateRequest) => {
			callCount++;
			if (callCount === 1) {
				// Simulate token starvation: empty text + MAX_TOKENS finish reason
				return {
					text: '',
					candidate: {
						content: { role: 'model', parts: [{ text: '', thought: true }] },
						finishReason: 'MAX_TOKENS',
					},
					usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 0, thoughtsTokenCount: 256, totalTokenCount: 306 },
					modelId: req.modelId,
					providerId: 'gemini',
					executionMode: 'byok',
				};
			}
			// Attempt 2 succeeds with expanded headroom
			assert.equal(req.maxOutputTokens, 2048);
			assert.equal(req.reasoningEffort, 'low');
			return {
				text: 'Configuration entrypoint for Tauri host architecture.',
				modelId: req.modelId,
				providerId: 'gemini',
				executionMode: 'byok',
			};
		};

		const desc = await aiService.describeFile('File content', 'src-tauri/src/config/mod.rs');
		assert.equal(desc.status, 'ready');
		assert.equal(desc.text, 'Configuration entrypoint for Tauri host architecture.');
		assert.equal(callCount, 2, 'Should have executed retry on MAX_TOKENS starvation');
		assert.equal(desc.cacheIdentity, 'gemini:gemini-2.5-flash:description-policy-v7');
	});

	it('resolves description context with low reasoning effort and v7 cache identity', async () => {
		const mockStorage = new MockSecretStorage();
		await mockStorage.store('prebase.magnus.provider.gemini.apiKey', 'valid-key');
		const resolver = new PreBaseSecretResolver({ forcePackaged: true });
		const secrets = new MagnusSecretStorage(mockStorage as never, resolver);
		const adapter = new MockAIProviderAdapter();
		const registry = new AIProviderRegistry([adapter]);
		const aiService = new PreBaseAIService(secrets, registry);

		const ctx = await aiService.getDescriptionContext('src/app.ts');
		assert.equal(ctx.providerId, 'gemini');
		assert.equal(ctx.modelId, 'gemini-2.5-flash');
		assert.equal(ctx.executionMode, 'byok');
		assert.equal(ctx.reasoningEffort, 'low');
		assert.equal(ctx.policyVersion, 'v7');
		assert.equal(ctx.cacheIdentity, 'gemini:gemini-2.5-flash:description-policy-v7');
	});

	it('installSmokeTransport routes streamCandidate through the smoke adapter, not the product catalog', async () => {
		const mockStorage = new MockSecretStorage();
		await mockStorage.store('prebase.magnus.provider.gemini.apiKey', 'valid-key');
		const resolver = new PreBaseSecretResolver({ forcePackaged: true });
		const secrets = new MagnusSecretStorage(mockStorage as never, resolver);
		const gemini = new MockAIProviderAdapter();
		const registry = new AIProviderRegistry([gemini]);
		const aiService = new PreBaseAIService(secrets, registry);

		assert.equal(aiService.getActiveProviderId(), 'gemini');
		assert.equal(aiService.isSmokeTransportEnabled(), false);

		aiService.installSmokeTransport(new MagnusSmokeTransportAdapter());
		assert.equal(aiService.getActiveProviderId(), 'smoke');
		assert.equal(aiService.isSmokeTransportEnabled(), true);
		assert.equal(registry.hasAdapter('smoke'), false, 'smoke transport must not enter the global provider registry');
		const pickerModels = await aiService.listModels(undefined, true);
		assert.equal(pickerModels.some(model => model.id === 'smoke-local' || model.providerId === 'smoke'), false, 'smoke-local must stay out of the product picker');
		const discoverBefore = gemini.discoverCalls;
		await aiService.listModels('gemini', true);
		assert.equal(gemini.discoverCalls, discoverBefore, 'explicit gemini listModels must not escape smoke isolation or resolve product credentials');

		const smokeChunks: string[] = [];
		const smokeResult = await aiService.streamCandidate(
			{ messages: [{ role: 'user', parts: [{ text: 'prebase-smoke-stream' }] }] },
			chunk => {
				if (chunk.text) {
					smokeChunks.push(chunk.text);
				}
			},
		);
		assert.deepEqual(smokeChunks, [...MAGNUS_SMOKE_CHUNKS]);
		assert.equal(smokeResult.providerId, 'smoke');
		assert.equal(smokeResult.modelId, 'smoke-local');
		assert.equal(gemini.streamCalls, 0, 'product Gemini adapter must not receive smoke-driver traffic');

		aiService.clearSmokeTransport();
		assert.equal(aiService.getActiveProviderId(), 'gemini');
		const restored = await aiService.listModels('gemini', true);
		assert.ok(restored.some(model => model.id === 'gemini-2.5-flash'), 'smoke listModels must not poison the product catalog cache');
		assert.equal(restored.some(model => model.providerId === 'smoke'), false);
		const productChunks: string[] = [];
		await aiService.streamCandidate(
			{ messages: [{ role: 'user', parts: [{ text: 'hello' }] }] },
			chunk => {
				if (chunk.text) {
					productChunks.push(chunk.text);
				}
			},
		);
		assert.equal(gemini.streamCalls, 1);
		assert.deepEqual(productChunks, ['Streamed part 1', 'Streamed part 2']);
	});
});

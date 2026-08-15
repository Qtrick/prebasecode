/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PreBaseAIService } from './aiService';
import { AIProviderRegistry } from './aiProviderRegistry';
import { MagnusSecretStorage } from './secretStorage';
import { PreBaseSecretResolver } from './secretResolver';
import type {
	AIGenerateRequest,
	AIGenerateResponseCandidate,
	AIGenerateResult,
	IPreBaseAIProviderAdapter,
	NormalizedAIModel,
} from './aiTypes';
import type { PreBaseAIExecutionMode } from './secretCatalog';

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
				multimodalInput: true,
				structuredOutput: true,
				thinkingProtocol: false,
				agentCompatible: true,
				descriptionCompatible: true,
			},
		},
	];

	constructor(id = 'gemini', displayName = 'Google Gemini') {
		this.id = id;
		this.displayName = displayName;
		this.staticFallbackModels = [
			{
				id: 'auto',
				name: 'models/gemini-2.5-flash',
				displayName: 'Auto',
				description: 'Auto fallback',
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
				isAuto: true,
				isFallback: true,
			},
		];
	}

	resolveAutoModel(): string {
		return 'gemini-2.5-flash';
	}

	async discoverModels(): Promise<NormalizedAIModel[]> {
		this.discoverCalls++;
		return this.discoveredModels;
	}

	async generate(request: AIGenerateRequest): Promise<AIGenerateResult> {
		this.generateCalls++;
		return {
			...this.generateResult,
			modelId: request.modelId,
		};
	}

	async streamGenerate(
		request: AIGenerateRequest,
		_credential: unknown,
		onChunk: (chunk: { text?: string; candidate?: AIGenerateResponseCandidate }) => void,
	): Promise<AIGenerateResult> {
		this.streamCalls++;
		onChunk({ text: 'Streamed part 1' });
		onChunk({ text: 'Streamed part 2' });
		return {
			...this.generateResult,
			text: 'Streamed part 1Streamed part 2',
			modelId: request.modelId,
		};
	}

	async testConnection() {
		this.testCalls++;
		return { ok: true, modelId: 'gemini-2.5-flash', reply: 'PONG' };
	}

	normalizeError(error: unknown) {
		return {
			code: 'unknown' as const,
			safeMessage: String(error),
			retryable: false,
		};
	}
}

describe('PreBaseAIService & State Machine', () => {
	it('resolves execution modes and credential precedence in packaged mode', async () => {
		const mockStorage = new MockSecretStorage();
		const resolver = new PreBaseSecretResolver({ forcePackaged: true });
		const secrets = new MagnusSecretStorage(mockStorage as never, resolver);
		const adapter = new MockAIProviderAdapter();
		const registry = new AIProviderRegistry([adapter]);
		const aiService = new PreBaseAIService(secrets, registry);

		// Initially unconfigured
		const status1 = await aiService.getProviderStatus('gemini');
		assert.equal(status1.configured, false);
		assert.equal(status1.modelDiscovery, 'unconfigured');

		// Set BYOK key
		await secrets.setProviderApiKey('gemini', 'secret-byok-test-key-12345');
		const status2 = await aiService.getProviderStatus('gemini');
		assert.equal(status2.configured, true);
		assert.equal(status2.effectiveSource, 'OS SecretStorage (BYOK)');
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
		assert.ok(models1.some(m => m.id === 'auto'));

		// Second call should return cached models without rediscovery
		const models2 = await aiService.listModels('gemini', false);
		assert.equal(adapter.discoverCalls, 1);
		assert.equal(models2.length, models1.length);

		// Force refresh should trigger discovery
		await aiService.listModels('gemini', true);
		assert.equal(adapter.discoverCalls, 2);
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

	it('generates structured architectural file descriptions', async () => {
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
		assert.equal(desc.cacheIdentity, 'gemini:gemini-2.5-flash');
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
});

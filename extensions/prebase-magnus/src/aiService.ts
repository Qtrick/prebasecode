/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	AICancellationToken,
	AIContentMessage,
	AIGenerateResult,
	AIProviderErrorClassification,
	IPreBaseAIService,
	NormalizedAIModel,
	ProviderStatusResult,
} from './aiTypes';
import { AIProviderRegistry, globalAIProviderRegistry } from './aiProviderRegistry';
import type { PreBaseAIExecutionMode } from './secretCatalog';
import type { MagnusSecretStorage } from './secretStorage';
import type { MagnusDescriptionResult } from './models';

interface CachedModelCatalog {
	readonly models: NormalizedAIModel[];
	readonly cachedAt: number;
	readonly source: 'live' | 'fallback';
}

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface PreBaseAIConfigProvider {
	getExecutionMode(): PreBaseAIExecutionMode;
	setExecutionMode?(mode: PreBaseAIExecutionMode): Promise<void>;
	getProvider(): string;
	setProvider?(provider: string): Promise<void>;
	getDefaultModel(): string;
	setDefaultModel?(model: string): Promise<void>;
	isEnabled(): boolean;
}

class DefaultConfigProvider implements PreBaseAIConfigProvider {
	private _executionMode: PreBaseAIExecutionMode = 'auto';
	private _provider: string = 'gemini';
	private _defaultModel: string = 'auto';
	private _enabled: boolean = true;

	private getVsCodeWorkspaceConfig() {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const vscode = (globalThis as any).vscode;
			if (vscode?.workspace?.getConfiguration) {
				return vscode.workspace.getConfiguration('prebase.magnus');
			}
		} catch {
			// ignore
		}
		return undefined;
	}

	getExecutionMode(): PreBaseAIExecutionMode {
		const cfg = this.getVsCodeWorkspaceConfig();
		if (cfg) {
			const val = cfg.get('executionMode', 'auto');
			if (val === 'development-env' || val === 'byok' || val === 'hosted') {
				return val;
			}
			return 'auto';
		}
		return this._executionMode;
	}

	async setExecutionMode(mode: PreBaseAIExecutionMode): Promise<void> {
		this._executionMode = mode;
		const cfg = this.getVsCodeWorkspaceConfig();
		if (cfg?.update) {
			await cfg.update('executionMode', mode, 1 /* ConfigurationTarget.Global */);
		}
	}

	getProvider(): string {
		const cfg = this.getVsCodeWorkspaceConfig();
		if (cfg) {
			return cfg.get('provider', 'gemini') || 'gemini';
		}
		return this._provider;
	}

	async setProvider(provider: string): Promise<void> {
		this._provider = provider;
		const cfg = this.getVsCodeWorkspaceConfig();
		if (cfg?.update) {
			await cfg.update('provider', provider, 1 /* ConfigurationTarget.Global */);
		}
	}

	getDefaultModel(): string {
		const cfg = this.getVsCodeWorkspaceConfig();
		if (cfg) {
			return cfg.get('defaultModel', 'auto') || 'auto';
		}
		return this._defaultModel;
	}

	async setDefaultModel(model: string): Promise<void> {
		this._defaultModel = model;
		const cfg = this.getVsCodeWorkspaceConfig();
		if (cfg?.update) {
			await cfg.update('defaultModel', model, 1 /* ConfigurationTarget.Global */);
		}
	}

	isEnabled(): boolean {
		const cfg = this.getVsCodeWorkspaceConfig();
		if (cfg) {
			return cfg.get('enabled', true) !== false;
		}
		return this._enabled;
	}
}

export class PreBaseAIService implements IPreBaseAIService {
	private readonly secrets: MagnusSecretStorage;
	private readonly registry: AIProviderRegistry;
	private readonly config: PreBaseAIConfigProvider;
	private readonly modelCache = new Map<string, CachedModelCatalog>();
	private _cloudHostedAvailable: boolean = false;

	constructor(
		secrets: MagnusSecretStorage,
		registry: AIProviderRegistry = globalAIProviderRegistry,
		config?: PreBaseAIConfigProvider,
	) {
		this.secrets = secrets;
		this.registry = registry;
		this.config = config ?? new DefaultConfigProvider();
	}

	setCloudHostedAvailable(available: boolean): void {
		this._cloudHostedAvailable = available;
		this.invalidateModelCache();
	}

	invalidateModelCache(providerId?: string): void {
		if (providerId) {
			const norm = providerId.toLowerCase().replace(/-api$/, '');
			this.modelCache.delete(norm);
		} else {
			this.modelCache.clear();
		}
	}

	getExecutionMode(): PreBaseAIExecutionMode {
		return this.config.getExecutionMode();
	}

	async setExecutionMode(mode: PreBaseAIExecutionMode): Promise<void> {
		if (this.config.setExecutionMode) {
			await this.config.setExecutionMode(mode);
		}
		this.invalidateModelCache();
	}

	getActiveProviderId(): string {
		const provider = this.config.getProvider();
		return provider.toLowerCase().replace(/-api$/, '');
	}

	async setActiveProviderId(providerId: string): Promise<void> {
		const norm = providerId.toLowerCase().replace(/-api$/, '');
		if (this.config.setProvider) {
			await this.config.setProvider(norm);
		}
		this.invalidateModelCache(norm);
	}

	getActiveModelId(): string {
		return this.config.getDefaultModel();
	}

	async setActiveModelId(modelId: string): Promise<void> {
		if (this.config.setDefaultModel) {
			await this.config.setDefaultModel(modelId);
		}
	}

	private async resolveCredential(providerId: string) {
		const normId = providerId.toLowerCase().replace(/-api$/, '');
		const requestedMode = this.getExecutionMode();
		return await this.secrets.resolveProviderExecution(normId, requestedMode, this._cloudHostedAvailable);
	}

	async getProviderStatus(providerId?: string): Promise<ProviderStatusResult> {
		const targetId = (providerId ?? this.getActiveProviderId()).toLowerCase().replace(/-api$/, '');
		const adapter = this.registry.getAdapter(targetId);
		const credential = await this.resolveCredential(targetId);

		const displayName = adapter?.displayName ?? targetId;
		const configured = credential.configured;
		const executionMode = credential.executionMode;

		let effectiveSource: string;
		if (credential.source === 'local-env') {
			effectiveSource = 'PreBase root .env';
		} else if (credential.source === 'secret-storage') {
			effectiveSource = 'OS SecretStorage (BYOK)';
		} else if (credential.source === 'hosted') {
			effectiveSource = 'PreBase Hosted Gateway';
		} else if (credential.source === 'process-env') {
			effectiveSource = 'Process Environment';
		} else {
			effectiveSource = 'Unconfigured';
		}

		let safeStatusMessage: string;
		if (configured) {
			safeStatusMessage = `Connected (${effectiveSource})`;
		} else {
			safeStatusMessage = executionMode === 'development-env'
				? 'Not configured (Missing GEMINI_API_KEY in PreBase root .env)'
				: executionMode === 'hosted'
					? 'PreBase Cloud sign-in required'
					: 'Not configured (BYOK key missing)';
		}

		const cached = this.modelCache.get(targetId);
		const modelDiscovery = !configured
			? 'unconfigured'
			: cached?.source === 'live'
				? 'live'
				: cached?.source === 'fallback'
					? 'fallback'
					: 'cached';

		const modelCount = cached?.models.length ?? (adapter?.staticFallbackModels.length ?? 0);

		return {
			providerId: targetId,
			displayName,
			configured,
			executionMode,
			effectiveSource,
			modelDiscovery,
			modelCount,
			safeStatusMessage,
		};
	}

	async listModels(
		providerId?: string,
		forceRefresh?: boolean,
		token?: AICancellationToken,
	): Promise<NormalizedAIModel[]> {
		const targetId = (providerId ?? this.getActiveProviderId()).toLowerCase().replace(/-api$/, '');
		const adapter = this.registry.getAdapter(targetId);
		if (!adapter) {
			return [];
		}

		const cached = this.modelCache.get(targetId);
		if (!forceRefresh && cached && Date.now() - cached.cachedAt < MODEL_CACHE_TTL_MS) {
			return cached.models;
		}

		const credential = await this.resolveCredential(targetId);

		try {
			const discovered = await adapter.discoverModels(credential, token);
			if (discovered && discovered.length > 0) {
				// Prepend auto option if not present
				const hasAuto = discovered.some(m => m.id === 'auto');
				const fullList = hasAuto
					? discovered
					: [adapter.staticFallbackModels.find(m => m.id === 'auto') ?? adapter.staticFallbackModels[0], ...discovered];

				this.modelCache.set(targetId, {
					models: fullList,
					cachedAt: Date.now(),
					source: 'live',
				});
				return fullList;
			}
		} catch (err) {
			console.warn(`[PreBase AI Service] Model discovery warning for ${targetId}:`, err instanceof Error ? err.message : String(err));
		}

		// Return static fallback models on failure or unconfigured
		const fallbackList = [...adapter.staticFallbackModels];
		this.modelCache.set(targetId, {
			models: fallbackList,
			cachedAt: Date.now(),
			source: 'fallback',
		});
		return fallbackList;
	}

	async generateText(
		prompt: string,
		options?: { modelId?: string; maxTokens?: number; temperature?: number },
		token?: AICancellationToken,
	): Promise<string> {
		const providerId = this.getActiveProviderId();
		const adapter = this.registry.getAdapter(providerId);
		if (!adapter) {
			throw new Error(`AI Provider ${providerId} is not registered.`);
		}

		const credential = await this.resolveCredential(providerId);
		const modelId = options?.modelId ?? this.getActiveModelId();

		const result = await adapter.generate(
			{
				modelId,
				contents: [
					{
						role: 'user',
						parts: [{ text: prompt }],
					},
				],
				maxOutputTokens: options?.maxTokens,
				temperature: options?.temperature,
			},
			credential,
			token,
		);

		return result.text;
	}

	async describeFile(
		prompt: string,
		_filePath?: string,
		token?: AICancellationToken,
	): Promise<MagnusDescriptionResult> {
		const enabled = this.config.isEnabled();
		if (!enabled) {
			return {
				status: 'disabled',
				safeMessage: 'Agents is disabled in settings.',
				retryable: false,
			};
		}

		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
			return {
				status: 'skipped',
				safeMessage: 'No content available for description.',
				retryable: false,
			};
		}

		const providerId = this.getActiveProviderId();
		const adapter = this.registry.getAdapter(providerId);
		if (!adapter) {
			return {
				status: 'error',
				safeMessage: `AI Provider ${providerId} is not available.`,
				retryable: false,
			};
		}

		const credential = await this.resolveCredential(providerId);
		if (!credential.configured) {
			return {
				status: 'notConfigured',
				providerId,
				safeMessage: credential.executionMode === 'development-env'
					? 'AI description unavailable — no GEMINI_API_KEY in PreBase root .env.'
					: 'AI description unavailable — no provider credential configured.',
				retryable: false,
			};
		}

		const modelId = this.getActiveModelId();
		const resolvedModel = modelId === 'auto' ? adapter.resolveAutoModel(credential.executionMode) : modelId;

		try {
			const result = await adapter.generate(
				{
					modelId: resolvedModel,
					contents: [{ role: 'user', parts: [{ text: trimmedPrompt }] }],
					maxOutputTokens: 256,
					temperature: 0.2,
				},
				credential,
				token,
			);

			const text = result.text.trim();
			if (!text) {
				return {
					status: 'error',
					providerId,
					modelId: resolvedModel,
					safeMessage: 'AI model returned an empty description.',
					retryable: true,
				};
			}

			return {
				status: 'ready',
				text,
				providerId,
				modelId: resolvedModel,
				cacheIdentity: `${providerId}:${resolvedModel}`,
				retryable: false,
			};
		} catch (err) {
			const classification = adapter.normalizeError(err);
			return {
				status: classification.code === 'notConfigured'
					? 'notConfigured'
					: classification.code === 'authentication' || classification.code === 'authorization'
						? 'authError'
						: classification.code === 'rateLimited' || classification.code === 'quotaExceeded'
							? 'rateLimited'
							: classification.code === 'modelUnavailable'
								? 'modelUnavailable'
								: classification.code === 'cancelled'
									? 'cancelled'
									: 'error',
				providerId,
				modelId: resolvedModel,
				safeMessage: classification.safeMessage,
				retryable: classification.retryable,
			};
		}
	}

	async generateCandidate(
		request: {
			messages: AIContentMessage[];
			systemInstruction?: string;
			tools?: Array<{ name: string; description: string; parameters?: object }>;
			modelId?: string;
		},
		token?: AICancellationToken,
	): Promise<AIGenerateResult> {
		const providerId = this.getActiveProviderId();
		const adapter = this.registry.getAdapter(providerId);
		if (!adapter) {
			throw new Error(`AI Provider ${providerId} is not registered.`);
		}

		const credential = await this.resolveCredential(providerId);
		const modelId = request.modelId ?? this.getActiveModelId();

		return await adapter.generate(
			{
				modelId,
				contents: request.messages,
				systemInstruction: request.systemInstruction,
				tools: request.tools,
			},
			credential,
			token,
		);
	}

	async streamCandidate(
		request: {
			messages: AIContentMessage[];
			systemInstruction?: string;
			tools?: Array<{ name: string; description: string; parameters?: object }>;
			modelId?: string;
		},
		onChunk: (chunk: { text?: string; candidate?: import('./aiTypes').AIGenerateResponseCandidate }) => void,
		token?: AICancellationToken,
	): Promise<AIGenerateResult> {
		const providerId = this.getActiveProviderId();
		const adapter = this.registry.getAdapter(providerId);
		if (!adapter) {
			throw new Error(`AI Provider ${providerId} is not registered.`);
		}

		const credential = await this.resolveCredential(providerId);
		const modelId = request.modelId ?? this.getActiveModelId();

		if (adapter.streamGenerate) {
			return await adapter.streamGenerate(
				{
					modelId,
					contents: request.messages,
					systemInstruction: request.systemInstruction,
					tools: request.tools,
				},
				credential,
				onChunk,
				token,
			);
		}

		const result = await adapter.generate(
			{
				modelId,
				contents: request.messages,
				systemInstruction: request.systemInstruction,
				tools: request.tools,
			},
			credential,
			token,
		);

		if (result.text) {
			onChunk({ text: result.text });
		}
		if (result.candidate) {
			onChunk({ candidate: result.candidate });
		}
		return result;
	}

	async testConnection(
		providerId?: string,
		modelId?: string,
		token?: AICancellationToken,
	): Promise<{ ok: boolean; modelId?: string; reply?: string; error?: AIProviderErrorClassification }> {
		const targetId = (providerId ?? this.getActiveProviderId()).toLowerCase().replace(/-api$/, '');
		const adapter = this.registry.getAdapter(targetId);
		if (!adapter) {
			return {
				ok: false,
				error: {
					code: 'invalidRequest',
					safeMessage: `Provider ${targetId} is not registered.`,
					retryable: false,
				},
			};
		}

		const credential = await this.resolveCredential(targetId);
		const targetModel = modelId ?? this.getActiveModelId();

		return await adapter.testConnection(credential, targetModel, token);
	}
}

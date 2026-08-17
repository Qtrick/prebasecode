/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	AICancellationToken,
	AIContentMessage,
	AIGenerateResult,
	AIProviderErrorClassification,
	AIToolDeclaration,
	IPreBaseAIService,
	NormalizedAIModel,
	ProviderStatusResult,
} from './aiTypes';
import { AIProviderRegistry, globalAIProviderRegistry } from './aiProviderRegistry';
import type { PreBaseAIExecutionMode } from './secretCatalog';
import type { MagnusSecretStorage } from './secretStorage';
import type { MagnusDescriptionResult } from './models';
import { resolveSupportedReasoningEffort } from './modelPolicy';

interface CachedModelCatalog {
	readonly rawModels: NormalizedAIModel[];
	readonly consumerModels: NormalizedAIModel[];
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

export class VsCodeWorkspaceConfigProvider implements PreBaseAIConfigProvider {
	private readonly getConfiguration: () => { get<T>(section: string, defaultValue?: T): T; update?(section: string, value: unknown, target?: unknown): Thenable<void> };

	constructor(getConfiguration: () => { get<T>(section: string, defaultValue?: T): T; update?(section: string, value: unknown, target?: unknown): Thenable<void> }) {
		this.getConfiguration = getConfiguration;
	}

	getExecutionMode(): PreBaseAIExecutionMode {
		const cfg = this.getConfiguration();
		const val = cfg.get<string>('executionMode', 'auto');
		if (val === 'development-env' || val === 'byok' || val === 'hosted') {
			return val;
		}
		return 'auto';
	}

	async setExecutionMode(mode: PreBaseAIExecutionMode): Promise<void> {
		const cfg = this.getConfiguration();
		if (cfg.update) {
			await cfg.update('executionMode', mode, 1 /* ConfigurationTarget.Global */);
		}
	}

	getProvider(): string {
		const cfg = this.getConfiguration();
		return cfg.get<string>('provider', 'gemini') || 'gemini';
	}

	async setProvider(provider: string): Promise<void> {
		const cfg = this.getConfiguration();
		if (cfg.update) {
			await cfg.update('provider', provider, 1 /* ConfigurationTarget.Global */);
		}
	}

	getDefaultModel(): string {
		const cfg = this.getConfiguration();
		return cfg.get<string>('defaultModel', 'auto') || 'auto';
	}

	async setDefaultModel(model: string): Promise<void> {
		const cfg = this.getConfiguration();
		if (cfg.update) {
			await cfg.update('defaultModel', model, 1 /* ConfigurationTarget.Global */);
		}
	}

	isEnabled(): boolean {
		const cfg = this.getConfiguration();
		return cfg.get<boolean>('enabled', true) !== false;
	}
}

export class InMemoryConfigProvider implements PreBaseAIConfigProvider {
	private _executionMode: PreBaseAIExecutionMode;
	private _provider: string;
	private _defaultModel: string;
	private _enabled: boolean;

	constructor(initial?: { executionMode?: PreBaseAIExecutionMode; provider?: string; defaultModel?: string; enabled?: boolean }) {
		this._executionMode = initial?.executionMode ?? 'auto';
		this._provider = initial?.provider ?? 'gemini';
		this._defaultModel = initial?.defaultModel ?? 'auto';
		this._enabled = initial?.enabled ?? true;
	}

	getExecutionMode(): PreBaseAIExecutionMode { return this._executionMode; }
	async setExecutionMode(mode: PreBaseAIExecutionMode): Promise<void> { this._executionMode = mode; }
	getProvider(): string { return this._provider; }
	async setProvider(provider: string): Promise<void> { this._provider = provider; }
	getDefaultModel(): string { return this._defaultModel; }
	async setDefaultModel(model: string): Promise<void> { this._defaultModel = model; }
	isEnabled(): boolean { return this._enabled; }
	setEnabled(enabled: boolean): void { this._enabled = enabled; }
}

export class PreBaseAIService implements IPreBaseAIService {
	private readonly secrets: MagnusSecretStorage;
	private readonly registry: AIProviderRegistry;
	private readonly config: PreBaseAIConfigProvider;
	private readonly modelCache = new Map<string, CachedModelCatalog>();
	private readonly inFlightDiscovery = new Map<string, Promise<NormalizedAIModel[]>>();
	private _cloudHostedAvailable: boolean = false;

	constructor(
		secrets: MagnusSecretStorage,
		registry: AIProviderRegistry = globalAIProviderRegistry,
		config?: PreBaseAIConfigProvider,
	) {
		this.secrets = secrets;
		this.registry = registry;
		this.config = config ?? new InMemoryConfigProvider();
	}

	setCloudHostedAvailable(available: boolean): void {
		this._cloudHostedAvailable = available;
		this.invalidateModelCache();
	}

	isCloudHostedAvailable(): boolean {
		return this._cloudHostedAvailable;
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

	isEnabled(): boolean {
		return this.config.isEnabled();
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

		const modelCount = cached?.consumerModels.length ?? (adapter?.staticFallbackModels.length ?? 0);

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

	async listRawModels(
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
			return cached.rawModels;
		}

		// Single-flight deduplication
		const existingFlight = this.inFlightDiscovery.get(targetId);
		if (existingFlight && !forceRefresh) {
			return await existingFlight;
		}

		const discoveryPromise = (async (): Promise<NormalizedAIModel[]> => {
			const credential = await this.resolveCredential(targetId);

			try {
				const discovered = await adapter.discoverModels(credential, token);
				if (discovered && discovered.length > 0) {
					const consumerList = adapter.curateConsumerCatalog
						? adapter.curateConsumerCatalog(discovered)
						: discovered;

					this.modelCache.set(targetId, {
						rawModels: discovered,
						consumerModels: consumerList,
						cachedAt: Date.now(),
						source: 'live',
					});
					return discovered;
				}
			} catch (err) {
				console.warn(`[PreBase AI Service] Raw model discovery warning for ${targetId}:`, err instanceof Error ? err.message : String(err));
			}

			// Stale-while-revalidate: if live discovery transiently failed, keep previous cached catalog
			if (cached && cached.rawModels.length > 0) {
				return cached.rawModels;
			}

			const fallbackList = [...adapter.staticFallbackModels];
			this.modelCache.set(targetId, {
				rawModels: fallbackList,
				consumerModels: fallbackList,
				cachedAt: Date.now(),
				source: 'fallback',
			});
			return fallbackList;
		})();

		this.inFlightDiscovery.set(targetId, discoveryPromise);
		try {
			return await discoveryPromise;
		} finally {
			this.inFlightDiscovery.delete(targetId);
		}
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
			return cached.consumerModels;
		}

		await this.listRawModels(targetId, forceRefresh, token);
		return this.modelCache.get(targetId)?.consumerModels ?? [...adapter.staticFallbackModels];
	}

	async resolveModelForExecution(
		providerId: string,
		requestedModelId?: string,
		credential?: import('./secretResolver').ResolvedProviderExecution,
		token?: AICancellationToken,
		workload?: import('./aiTypes').ModelWorkload,
	): Promise<string> {
		const targetId = providerId.toLowerCase().replace(/-api$/, '');
		const adapter = this.registry.getAdapter(targetId);
		if (!adapter) {
			return 'gemini-2.5-flash';
		}

		const cred = credential ?? await this.resolveCredential(targetId);

		const isInternalWorkload = workload && workload !== 'general-agent' && workload !== 'fast-agent';
		let catalog: NormalizedAIModel[] | undefined;
		if (isInternalWorkload) {
			catalog = this.modelCache.get(targetId)?.rawModels;
			if (!catalog || catalog.length === 0) {
				try {
					catalog = await this.listRawModels(targetId, false, token);
				} catch {
					catalog = [...adapter.staticFallbackModels];
				}
			}
		} else {
			catalog = this.modelCache.get(targetId)?.consumerModels;
			if (!catalog || catalog.length === 0) {
				try {
					catalog = await this.listModels(targetId, false, token);
				} catch {
					catalog = [...adapter.staticFallbackModels];
				}
			}
		}

		const modelId = requestedModelId ?? this.getActiveModelId();

		// If user explicitly requested Auto, no model specified, or internal workload
		if (!modelId || modelId === 'auto' || isInternalWorkload) {
			return adapter.resolveAutoModel(cred.executionMode, catalog, workload);
		}

		const cleanModelId = modelId.replace(/^models\//, '');

		// If a specific model was requested, check if it is consumer-selectable in the active catalog
		const isSelectable = catalog.some(m => m.id === cleanModelId && (m.consumerSelectable ?? true));
		if (isSelectable) {
			return cleanModelId;
		}

		// If saved model was deprecated / hidden, fallback to auto
		return adapter.resolveAutoModel(cred.executionMode, catalog, workload);
	}

	async generateText(
		prompt: string,
		options?: { modelId?: string; maxTokens?: number; temperature?: number; reasoningEffort?: import('./aiTypes').AIReasoningEffort; workload?: import('./aiTypes').ModelWorkload },
		token?: AICancellationToken,
	): Promise<string> {
		const providerId = this.getActiveProviderId();
		const adapter = this.registry.getAdapter(providerId);
		if (!adapter) {
			throw new Error(`AI Provider ${providerId} is not registered.`);
		}

		const credential = await this.resolveCredential(providerId);
		const resolvedModel = await this.resolveModelForExecution(providerId, options?.modelId, credential, token, options?.workload);

		const result = await adapter.generate(
			{
				modelId: resolvedModel,
				contents: [
					{
						role: 'user',
						parts: [{ text: prompt }],
					},
				],
				maxOutputTokens: options?.maxTokens,
				temperature: options?.temperature,
				reasoningEffort: options?.reasoningEffort,
			},
			credential,
			token,
		);

		return result.text;
	}

	async getDescriptionContext(
		_filePath?: string,
	): Promise<import('./aiTypes').MagnusDescriptionContext> {
		const providerId = this.getActiveProviderId();
		const credential = await this.resolveCredential(providerId);
		const resolvedModel = await this.resolveModelForExecution(providerId, undefined, credential, undefined, 'description');
		const policyVersion = 'v7';
		const reasoningEffort: import('./aiTypes').AIReasoningEffort = 'low';
		const cacheIdentity = `${providerId}:${resolvedModel}:description-policy-${policyVersion}`;

		return {
			providerId,
			modelId: resolvedModel,
			executionMode: credential.executionMode,
			reasoningEffort,
			policyVersion,
			cacheIdentity,
		};
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

		// Use 'description' workload profile: routes to fast stable Flash model
		const resolvedModel = await this.resolveModelForExecution(providerId, undefined, credential, token, 'description');
		const policyVersion = 'v7';
		const cacheIdentity = `${providerId}:${resolvedModel}:description-policy-${policyVersion}`;

		// Attempt 1: standard bounded description profile (1024 token headroom, low reasoning)
		try {
			const result = await adapter.generate(
				{
					modelId: resolvedModel,
					contents: [{ role: 'user', parts: [{ text: trimmedPrompt }] }],
					maxOutputTokens: 1024,
					temperature: 0.2,
					reasoningEffort: 'low',
				},
				credential,
				token,
			);

			const text = result.text.trim();
			if (text) {
				return {
					status: 'ready',
					text,
					providerId,
					modelId: resolvedModel,
					cacheIdentity,
					retryable: false,
				};
			}

			// Empty result check: inspect finish reason and usage metadata for token starvation
			const finishReason = result.candidate?.finishReason;
			const isStarvation = finishReason === 'MAX_TOKENS' ||
				(result.usageMetadata?.thoughtsTokenCount && (!result.usageMetadata.candidatesTokenCount || result.usageMetadata.candidatesTokenCount <= 1));

			// Attempt 2: Bounded retry with expanded headroom if starvation occurred (resolving supported reasoning effort)
			if (isStarvation && !token?.isCancellationRequested) {
				try {
					const retryReasoning = resolveSupportedReasoningEffort(resolvedModel, 'minimal');
					const retryResult = await adapter.generate(
						{
							modelId: resolvedModel,
							contents: [{ role: 'user', parts: [{ text: trimmedPrompt }] }],
							maxOutputTokens: 2048,
							temperature: 0.2,
							reasoningEffort: retryReasoning,
						},
						credential,
						token,
					);

					const retryText = retryResult.text.trim();
					if (retryText) {
						return {
							status: 'ready',
							text: retryText,
							providerId,
							modelId: resolvedModel,
							cacheIdentity,
							retryable: false,
						};
					}
				} catch {
					// Fall through to error reporting below
				}
			}

			let safeMessage = 'AI model returned an empty description.';
			let retryable = true;
			if (finishReason === 'MAX_TOKENS') {
				safeMessage = 'AI description generation exhausted its response budget.';
			} else if (finishReason === 'SAFETY') {
				safeMessage = 'AI description generation was blocked by provider safety policy.';
				retryable = false;
			}

			return {
				status: 'error',
				providerId,
				modelId: resolvedModel,
				safeMessage,
				retryable,
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
			tools?: AIToolDeclaration[];
			modelId?: string;
			reasoningEffort?: import('./aiTypes').AIReasoningEffort;
			workload?: import('./aiTypes').ModelWorkload;
		},
		token?: AICancellationToken,
	): Promise<AIGenerateResult> {
		const providerId = this.getActiveProviderId();
		const adapter = this.registry.getAdapter(providerId);
		if (!adapter) {
			throw new Error(`AI Provider ${providerId} is not registered.`);
		}

		const credential = await this.resolveCredential(providerId);
		const resolvedModel = await this.resolveModelForExecution(providerId, request.modelId, credential, token, request.workload);

		return await adapter.generate(
			{
				modelId: resolvedModel,
				contents: request.messages,
				systemInstruction: request.systemInstruction,
				tools: request.tools,
				reasoningEffort: request.reasoningEffort,
			},
			credential,
			token,
		);
	}

	async streamCandidate(
		request: {
			messages: AIContentMessage[];
			systemInstruction?: string;
			tools?: AIToolDeclaration[];
			modelId?: string;
			reasoningEffort?: import('./aiTypes').AIReasoningEffort;
			workload?: import('./aiTypes').ModelWorkload;
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
		const resolvedModel = await this.resolveModelForExecution(providerId, request.modelId, credential, token, request.workload);

		if (adapter.streamGenerate) {
			return await adapter.streamGenerate(
				{
					modelId: resolvedModel,
					contents: request.messages,
					systemInstruction: request.systemInstruction,
					tools: request.tools,
					reasoningEffort: request.reasoningEffort,
				},
				credential,
				onChunk,
				token,
			);
		}

		const result = await adapter.generate(
			{
				modelId: resolvedModel,
				contents: request.messages,
				systemInstruction: request.systemInstruction,
				tools: request.tools,
				reasoningEffort: request.reasoningEffort,
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

	async diagnoseModelCatalog(providerId?: string): Promise<Record<string, unknown>> {
		const targetId = (providerId ?? this.getActiveProviderId()).toLowerCase().replace(/-api$/, '');
		const raw = await this.listRawModels(targetId, true);
		const adapter = this.registry.getAdapter(targetId);
		if (adapter && 'modelPolicy' in adapter && typeof (adapter as { modelPolicy: { formatDiagnostics: (catalog: NormalizedAIModel[]) => Record<string, unknown> } }).modelPolicy?.formatDiagnostics === 'function') {
			return (adapter as { modelPolicy: { formatDiagnostics: (catalog: NormalizedAIModel[]) => Record<string, unknown> } }).modelPolicy.formatDiagnostics(raw);
		}
		return {
			providerId: targetId,
			rawModelCount: raw.length,
			models: raw.map(m => ({ id: m.id, displayName: m.displayName })),
		};
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
		const resolvedModel = await this.resolveModelForExecution(targetId, modelId, credential, token);

		return await adapter.testConnection(credential, resolvedModel, token);
	}
}

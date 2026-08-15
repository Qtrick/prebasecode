/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import {
	PreBaseSecretResolver,
	type ResolvedProviderExecution,
	type ResolvedSecret,
	type SecretSourceType,
} from './secretResolver';
import type { PreBaseAIExecutionMode } from './secretCatalog';

const LEGACY_MODEL_PROVIDER_SECRET = 'prebase.magnus.modelProviderKey';
const PROVIDER_KEY_PREFIX = 'prebase.magnus.provider';

export function getProviderSecretKey(providerId: string): string {
	const norm = providerId.toLowerCase().replace(/-api$/, '');
	return `${PROVIDER_KEY_PREFIX}.${norm}.apiKey`;
}

export interface MagnusResolvedApiKey {
	readonly provider: string;
	readonly varName: string;
	readonly apiKey: string;
	readonly source: SecretSourceType;
}

/**
 * Resolves credentials with strict precedence:
 * In source development: PreBase root .env -> OS SecretStorage -> process.env fallback.
 * In packaged application: OS SecretStorage only.
 */
export class MagnusSecretStorage {
	private readonly secrets: vscode.SecretStorage;
	private readonly resolver: PreBaseSecretResolver;

	constructor(secrets: vscode.SecretStorage, resolver?: PreBaseSecretResolver) {
		this.secrets = secrets;
		this.resolver = resolver ?? new PreBaseSecretResolver();
	}

	getResolver(): PreBaseSecretResolver {
		return this.resolver;
	}

	refreshRootEnv(): void {
		this.resolver.refreshRootEnv();
	}

	/**
	 * Resolves the stored SecretStorage key for a provider.
	 * Migrates legacy un-scoped key to provider-scoped key if needed.
	 */
	async getSecretStorageProviderApiKey(providerId: string = 'gemini'): Promise<string | undefined> {
		const norm = providerId.toLowerCase().replace(/-api$/, '');
		const scopedSecretKey = getProviderSecretKey(norm);
		const existingScoped = (await this.secrets.get(scopedSecretKey))?.trim();
		if (existingScoped) {
			return existingScoped;
		}

		if (norm === 'gemini') {
			const legacyKey = (await this.secrets.get(LEGACY_MODEL_PROVIDER_SECRET))?.trim();
			if (legacyKey) {
				await this.secrets.store(scopedSecretKey, legacyKey);
				await this.secrets.delete(LEGACY_MODEL_PROVIDER_SECRET);
				return legacyKey;
			}
		}

		return undefined;
	}

	/**
	 * Resolves active API key for a provider with deterministic precedence.
	 */
	async getProviderApiKey(providerId: string = 'gemini'): Promise<string | undefined> {
		const norm = providerId.toLowerCase().replace(/-api$/, '');
		const storedKey = await this.getSecretStorageProviderApiKey(norm);
		if (norm === 'gemini') {
			const resolved = this.resolver.resolveGeminiKey(storedKey);
			return resolved?.key;
		}
		if (norm === 'linkup') {
			const resolved = this.resolver.resolveLinkupKey(storedKey);
			return resolved?.key;
		}
		return storedKey;
	}

	async getResolvedProviderApiKey(providerId: string = 'gemini'): Promise<ResolvedSecret | undefined> {
		const norm = providerId.toLowerCase().replace(/-api$/, '');
		const storedKey = await this.getSecretStorageProviderApiKey(norm);
		if (norm === 'gemini') {
			return this.resolver.resolveGeminiKey(storedKey);
		}
		if (norm === 'linkup') {
			return this.resolver.resolveLinkupKey(storedKey);
		}
		return storedKey ? { key: storedKey, source: 'secret-storage', varName: 'stored' } : undefined;
	}

	async resolveProviderExecution(
		providerId: string = 'gemini',
		requestedMode: PreBaseAIExecutionMode = 'auto',
		hostedAvailable?: boolean,
	): Promise<ResolvedProviderExecution> {
		const norm = providerId.toLowerCase().replace(/-api$/, '');
		const storedKey = await this.getSecretStorageProviderApiKey(norm);
		return this.resolver.resolveProviderExecution({
			providerId: norm,
			requestedMode,
			secretStorageKey: storedKey,
			hostedAvailable,
		});
	}

	async setProviderApiKey(providerId: string, apiKey: string): Promise<void> {
		const trimmed = apiKey.trim();
		if (!trimmed) {
			throw new Error('The model-provider credential cannot be empty.');
		}
		const norm = providerId.toLowerCase().replace(/-api$/, '');
		const scopedKey = getProviderSecretKey(norm);
		await this.secrets.store(scopedKey, trimmed);
		if (norm === 'gemini') {
			await this.secrets.delete(LEGACY_MODEL_PROVIDER_SECRET);
		}
	}

	async clearProviderApiKey(providerId: string): Promise<void> {
		const norm = providerId.toLowerCase().replace(/-api$/, '');
		const scopedKey = getProviderSecretKey(norm);
		await this.secrets.delete(scopedKey);
		if (norm === 'gemini') {
			await this.secrets.delete(LEGACY_MODEL_PROVIDER_SECRET);
		}
	}

	async hasProviderApiKey(providerId: string = 'gemini'): Promise<boolean> {
		const key = await this.getProviderApiKey(providerId);
		return !!key;
	}

	async getAnyKey(): Promise<MagnusResolvedApiKey | undefined> {
		const resolved = await this.getResolvedProviderApiKey('gemini');
		return resolved
			? { provider: 'gemini', varName: resolved.varName, apiKey: resolved.key, source: resolved.source }
			: undefined;
	}

	async getApiKey(): Promise<string | undefined> {
		return this.getProviderApiKey('gemini');
	}

	async getGeminiKeyOrMessage(): Promise<{ key?: string; message?: string; source?: SecretSourceType }> {
		const resolved = await this.getResolvedProviderApiKey('gemini');
		if (resolved) {
			return { key: resolved.key, source: resolved.source };
		}
		return {
			message: 'Agents has no configured Gemini credential. Configure a key in Agents Settings or provide GEMINI_API_KEY in PreBase root .env.',
		};
	}

	async getLinkupKeyOrMessage(): Promise<{ key?: string; message?: string; source?: SecretSourceType }> {
		const resolved = await this.getResolvedProviderApiKey('linkup');
		if (resolved) {
			return { key: resolved.key, source: resolved.source };
		}
		return {
			message: 'LinkUp web search has no configured credential. Provide LINKUP_API_KEY in PreBase root .env or configure in settings.',
		};
	}

	async hasApiKey(): Promise<boolean> {
		return this.hasProviderApiKey('gemini');
	}

	async setApiKey(apiKey: string): Promise<void> {
		return this.setProviderApiKey('gemini', apiKey);
	}

	async clearApiKey(): Promise<void> {
		return this.clearProviderApiKey('gemini');
	}

	async getDiagnostics(cloudHostedAvailable?: boolean, requestedMode: PreBaseAIExecutionMode = 'auto') {
		const storedGemini = await this.getSecretStorageProviderApiKey('gemini');
		const storedLinkup = await this.getSecretStorageProviderApiKey('linkup');
		return this.resolver.getDiagnostics(storedGemini, storedLinkup, cloudHostedAvailable, requestedMode);
	}
}

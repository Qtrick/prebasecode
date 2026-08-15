/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { MagnusProviderId } from './models.ts';

const LEGACY_MODEL_PROVIDER_SECRET = 'prebase.magnus.modelProviderKey';
const PROVIDER_KEY_PREFIX = 'prebase.magnus.provider';

export function getProviderSecretKey(providerId: string): string {
	return `${PROVIDER_KEY_PREFIX}.${providerId}.apiKey`;
}

export interface MagnusResolvedApiKey {
	readonly provider: string;
	readonly varName: 'stored';
	readonly apiKey: string;
	readonly source: 'secret-storage';
}

/** Stores user credentials in the OS-backed secret vault, never workspace files. */
export class MagnusSecretStorage {
	private readonly secrets: vscode.SecretStorage;

	constructor(secrets: vscode.SecretStorage) {
		this.secrets = secrets;
	}

	/**
	 * Resolves an API key for a specific provider.
	 * Automatically and idempotently migrates legacy un-scoped keys to provider-scoped keys.
	 */
	async getProviderApiKey(providerId: string = 'gemini'): Promise<string | undefined> {
		const scopedSecretKey = getProviderSecretKey(providerId);
		const existingScoped = (await this.secrets.get(scopedSecretKey))?.trim();
		if (existingScoped) {
			return existingScoped;
		}

		// Legacy migration: if reading default 'gemini' and no scoped key exists, check legacy key
		if (providerId === 'gemini') {
			const legacyKey = (await this.secrets.get(LEGACY_MODEL_PROVIDER_SECRET))?.trim();
			if (legacyKey) {
				// Migrate into scoped key and clean up legacy entry
				await this.secrets.store(scopedSecretKey, legacyKey);
				await this.secrets.delete(LEGACY_MODEL_PROVIDER_SECRET);
				return legacyKey;
			}
		}

		return undefined;
	}

	async setProviderApiKey(providerId: string, apiKey: string): Promise<void> {
		const trimmed = apiKey.trim();
		if (!trimmed) {
			throw new Error('The model-provider credential cannot be empty.');
		}
		const scopedKey = getProviderSecretKey(providerId);
		await this.secrets.store(scopedKey, trimmed);
		// Clean up legacy key if setting gemini key
		if (providerId === 'gemini') {
			await this.secrets.delete(LEGACY_MODEL_PROVIDER_SECRET);
		}
	}

	async clearProviderApiKey(providerId: string): Promise<void> {
		const scopedKey = getProviderSecretKey(providerId);
		await this.secrets.delete(scopedKey);
		if (providerId === 'gemini') {
			await this.secrets.delete(LEGACY_MODEL_PROVIDER_SECRET);
		}
	}

	async hasProviderApiKey(providerId: string = 'gemini'): Promise<boolean> {
		return !!(await this.getProviderApiKey(providerId));
	}

	async getAnyKey(): Promise<MagnusResolvedApiKey | undefined> {
		const apiKey = await this.getProviderApiKey('gemini');
		return apiKey ? { provider: 'gemini', varName: 'stored', apiKey, source: 'secret-storage' } : undefined;
	}

	async getApiKey(): Promise<string | undefined> {
		return this.getProviderApiKey('gemini');
	}

	async getGeminiKeyOrMessage(): Promise<{ key?: string; message?: string }> {
		const key = await this.getApiKey();
		return key ? { key } : { message: 'Agents has no configured Gemini credential. Use “Agents: Configure Model Provider” or “Agents: Import Provider Key from .env…”.' };
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
}


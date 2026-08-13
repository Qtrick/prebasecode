/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const MODEL_PROVIDER_SECRET = 'prebase.magnus.modelProviderKey';

export interface MagnusResolvedApiKey {
	readonly provider: 'configured';
	readonly varName: 'stored';
	readonly apiKey: string;
	readonly source: 'secret-storage';
}

/** Stores user credentials in the OS-backed secret vault, never workspace files. */
export class MagnusSecretStorage {
	constructor(private readonly secrets: vscode.SecretStorage) { }

	async getAnyKey(): Promise<MagnusResolvedApiKey | undefined> {
		const apiKey = (await this.secrets.get(MODEL_PROVIDER_SECRET))?.trim();
		return apiKey ? { provider: 'configured', varName: 'stored', apiKey, source: 'secret-storage' } : undefined;
	}

	async getApiKey(): Promise<string | undefined> {
		return (await this.getAnyKey())?.apiKey;
	}

	async getGeminiKeyOrMessage(): Promise<{ key?: string; message?: string }> {
		const key = await this.getApiKey();
		return key ? { key } : { message: 'Agents has no configured model provider. Use “Agents: Configure Model Provider”.' };
	}

	async hasApiKey(): Promise<boolean> {
		return !!(await this.getApiKey());
	}

	async setApiKey(apiKey: string): Promise<void> {
		const trimmed = apiKey.trim();
		if (!trimmed) {
			throw new Error('The model-provider credential cannot be empty.');
		}
		await this.secrets.store(MODEL_PROVIDER_SECRET, trimmed);
	}

	async clearApiKey(): Promise<void> {
		await this.secrets.delete(MODEL_PROVIDER_SECRET);
	}
}

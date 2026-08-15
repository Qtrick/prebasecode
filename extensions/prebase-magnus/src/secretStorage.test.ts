/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { test, suite } from 'node:test';
import type * as vscode from 'vscode';
import { MagnusSecretStorage, getProviderSecretKey } from './secretStorage.ts';

class MockSecretStorage implements vscode.SecretStorage {
	private readonly map = new Map<string, string>();
	readonly onDidChange = (() => ({ dispose: () => { } })) as unknown as vscode.Event<vscode.SecretStorageChangeEvent>;

	async get(key: string): Promise<string | undefined> {
		return this.map.get(key);
	}

	async store(key: string, value: string): Promise<void> {
		this.map.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.map.delete(key);
	}

	rawGet(key: string): string | undefined {
		return this.map.get(key);
	}

	rawSet(key: string, value: string): void {
		this.map.set(key, value);
	}
}

suite('MagnusSecretStorage & Migration', () => {
	test('getProviderSecretKey formats scoped keys correctly', () => {
		assert.strictEqual(getProviderSecretKey('gemini'), 'prebase.magnus.provider.gemini.apiKey');
		assert.strictEqual(getProviderSecretKey('custom'), 'prebase.magnus.provider.custom.apiKey');
	});

	test('stores and retrieves provider-scoped keys', async () => {
		const mock = new MockSecretStorage();
		const storage = new MagnusSecretStorage(mock);

		assert.strictEqual(await storage.hasApiKey(), false);
		await storage.setProviderApiKey('gemini', 'AIza-gemini-test-key');

		assert.strictEqual(await storage.hasApiKey(), true);
		assert.strictEqual(await storage.getApiKey(), 'AIza-gemini-test-key');
		assert.strictEqual(mock.rawGet('prebase.magnus.provider.gemini.apiKey'), 'AIza-gemini-test-key');
	});

	test('automatically and idempotently migrates legacy un-scoped key to scoped gemini key', async () => {
		const mock = new MockSecretStorage();
		mock.rawSet('prebase.magnus.modelProviderKey', 'AIza-legacy-secret-key');

		const storage = new MagnusSecretStorage(mock);

		// Reading apiKey triggers migration
		const key = await storage.getApiKey();
		assert.strictEqual(key, 'AIza-legacy-secret-key');

		// Scoped key is now populated in vault
		assert.strictEqual(mock.rawGet('prebase.magnus.provider.gemini.apiKey'), 'AIza-legacy-secret-key');
		// Legacy key is deleted
		assert.strictEqual(mock.rawGet('prebase.magnus.modelProviderKey'), undefined);

		// Subsequent read returns migrated key
		assert.strictEqual(await storage.getApiKey(), 'AIza-legacy-secret-key');
	});

	test('getGeminiKeyOrMessage returns clear guidance when unconfigured', async () => {
		const mock = new MockSecretStorage();
		const storage = new MagnusSecretStorage(mock);

		const result = await storage.getGeminiKeyOrMessage();
		assert.strictEqual(result.key, undefined);
		assert.ok(result.message?.includes('Agents has no configured Gemini credential'));
	});

	test('rejects empty API keys', async () => {
		const mock = new MockSecretStorage();
		const storage = new MagnusSecretStorage(mock);

		await assert.rejects(storage.setApiKey('   '), /cannot be empty/);
	});

	test('clearing provider key also cleans legacy key', async () => {
		const mock = new MockSecretStorage();
		mock.rawSet('prebase.magnus.provider.gemini.apiKey', 'AIza-key');
		mock.rawSet('prebase.magnus.modelProviderKey', 'AIza-key');

		const storage = new MagnusSecretStorage(mock);
		await storage.clearApiKey();

		assert.strictEqual(await storage.getApiKey(), undefined);
		assert.strictEqual(mock.rawGet('prebase.magnus.provider.gemini.apiKey'), undefined);
		assert.strictEqual(mock.rawGet('prebase.magnus.modelProviderKey'), undefined);
	});
});

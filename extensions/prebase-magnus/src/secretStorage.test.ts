/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { test, suite } from 'node:test';
import type * as vscode from 'vscode';
import { MagnusSecretStorage, getProviderSecretKey } from './secretStorage';
import { PreBaseSecretResolver, parseAllowlistedEnv, isPreBaseSourceRoot } from './secretResolver';

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

suite('MagnusSecretStorage & Precedence', () => {
	test('getProviderSecretKey formats scoped keys correctly', () => {
		assert.strictEqual(getProviderSecretKey('gemini'), 'prebase.magnus.provider.gemini.apiKey');
		assert.strictEqual(getProviderSecretKey('custom'), 'prebase.magnus.provider.custom.apiKey');
	});

	test('stores and retrieves provider-scoped keys in packaged mode', async () => {
		const mock = new MockSecretStorage();
		const isolatedResolver = new PreBaseSecretResolver({ forcePackaged: true });
		const storage = new MagnusSecretStorage(mock, isolatedResolver);

		assert.strictEqual(await storage.hasApiKey(), false);
		await storage.setProviderApiKey('gemini', 'test-gemini-key');

		assert.strictEqual(await storage.hasApiKey(), true);
		assert.strictEqual(await storage.getApiKey(), 'test-gemini-key');
		assert.strictEqual(mock.rawGet('prebase.magnus.provider.gemini.apiKey'), 'test-gemini-key');
	});

	test('automatically and idempotently migrates legacy un-scoped key to scoped gemini key', async () => {
		const mock = new MockSecretStorage();
		mock.rawSet('prebase.magnus.modelProviderKey', 'legacy-secret-key');

		const isolatedResolver = new PreBaseSecretResolver({ forcePackaged: true });
		const storage = new MagnusSecretStorage(mock, isolatedResolver);

		// Reading apiKey triggers migration
		const key = await storage.getApiKey();
		assert.strictEqual(key, 'legacy-secret-key');

		// Scoped key is now populated in vault
		assert.strictEqual(mock.rawGet('prebase.magnus.provider.gemini.apiKey'), 'legacy-secret-key');
		// Legacy key is deleted
		assert.strictEqual(mock.rawGet('prebase.magnus.modelProviderKey'), undefined);

		// Subsequent read returns migrated key
		assert.strictEqual(await storage.getApiKey(), 'legacy-secret-key');
	});

	test('getGeminiKeyOrMessage returns clear guidance when unconfigured', async () => {
		const mock = new MockSecretStorage();
		const isolatedResolver = new PreBaseSecretResolver({ forcePackaged: true });
		const storage = new MagnusSecretStorage(mock, isolatedResolver);

		const result = await storage.getGeminiKeyOrMessage();
		assert.strictEqual(result.key, undefined);
		assert.ok(result.message?.includes('Agents has no configured Gemini credential'));
	});

	test('rejects empty API keys', async () => {
		const mock = new MockSecretStorage();
		const isolatedResolver = new PreBaseSecretResolver({ forcePackaged: true });
		const storage = new MagnusSecretStorage(mock, isolatedResolver);

		await assert.rejects(storage.setApiKey('   '), /cannot be empty/);
	});

	test('clearing provider key also cleans legacy key', async () => {
		const mock = new MockSecretStorage();
		mock.rawSet('prebase.magnus.provider.gemini.apiKey', 'key-1');
		mock.rawSet('prebase.magnus.modelProviderKey', 'key-1');

		const isolatedResolver = new PreBaseSecretResolver({ forcePackaged: true });
		const storage = new MagnusSecretStorage(mock, isolatedResolver);
		await storage.clearApiKey();

		assert.strictEqual(await storage.getApiKey(), undefined);
		assert.strictEqual(mock.rawGet('prebase.magnus.provider.gemini.apiKey'), undefined);
		assert.strictEqual(mock.rawGet('prebase.magnus.modelProviderKey'), undefined);
	});

	test('parseAllowlistedEnv handles quotes, whitespace, comments, and filters variables', () => {
		const envContent = [
			'# Comment line',
			'  GEMINI_API_KEY = "test-gemini-key-123"  ',
			'GOOGLE_API_KEY=\'test-google-alias\'',
			'LINKUP_API_KEY=test-linkup-key',
			'AWS_SECRET_ACCESS_KEY=should-be-ignored',
			'DATABASE_URL=postgres://ignore:ignore@localhost/db',
			'EMPTY_VAR=',
			'INVALID_LINE',
		].join('\n');

		const parsed = parseAllowlistedEnv(envContent);
		assert.strictEqual(parsed.get('GEMINI_API_KEY'), 'test-gemini-key-123');
		assert.strictEqual(parsed.get('GOOGLE_API_KEY'), 'test-google-alias');
		assert.strictEqual(parsed.get('LINKUP_API_KEY'), 'test-linkup-key');
		assert.strictEqual(parsed.has('AWS_SECRET_ACCESS_KEY'), false);
		assert.strictEqual(parsed.has('DATABASE_URL'), false);
		assert.strictEqual(parsed.has('EMPTY_VAR'), false);
	});

	test('isPreBaseSourceRoot strictly rejects arbitrary workspace folders', () => {
		assert.strictEqual(isPreBaseSourceRoot('/tmp'), false);
		assert.strictEqual(isPreBaseSourceRoot('/nonexistent/path'), false);
	});
});

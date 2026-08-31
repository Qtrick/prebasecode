/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../../../base/test/common/utils.js";
import assert from 'assert';
import { newWriteableBufferStream, VSBuffer } from '../../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { isPreBaseCloudSyncAgentHistoryEnabled, resolvePreBaseCloudAuthConfig } from '../cloudConfiguration.js';
import { buildSupabaseAuthUrl, redactSensitiveForLog } from '../supabaseAuthRest.js';
import { PreBaseSupabaseAuthClient } from '../../../browser/cloud/prebaseSupabaseAuthClient.js';

suite('PreBase cloud configuration', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('missing url and key yields unconfigured', () => {
		const cfg = resolvePreBaseCloudAuthConfig(() => undefined);
		assert.strictEqual(cfg.mode, 'unconfigured');
	});

	test('supabase wins when url and publishable key are set', () => {
		const cfg = resolvePreBaseCloudAuthConfig(key => {
			if (key === 'prebase.cloud.url') {
				return 'https://example.supabase.co/';
			}
			if (key === 'prebase.cloud.publishableKey') {
				return 'pk-test';
			}
			if (key === 'prebase.account.apiBaseUrl') {
				return 'https://legacy.example.com';
			}
			return undefined;
		});
		assert.strictEqual(cfg.mode, 'supabase');
		assert.strictEqual(cfg.supabaseUrl, 'https://example.supabase.co');
		assert.strictEqual(cfg.publishableKey, 'pk-test');
	});

	test('legacy api base when cloud pair incomplete', () => {
		const cfg = resolvePreBaseCloudAuthConfig(key => {
			if (key === 'prebase.cloud.url') {
				return 'https://example.supabase.co';
			}
			if (key === 'prebase.account.apiBaseUrl') {
				return 'https://legacy.example.com/';
			}
			return undefined;
		});
		assert.strictEqual(cfg.mode, 'legacy');
		assert.strictEqual(cfg.legacyApiBaseUrl, 'https://legacy.example.com');
	});

	test('fails closed for insecure or incomplete Supabase configuration', () => {
		const insecure = resolvePreBaseCloudAuthConfig(key => {
			if (key === 'prebase.cloud.url') {
				return 'http://192.168.1.50:54321';
			}
			if (key === 'prebase.cloud.publishableKey') {
				return 'pk-test';
			}
			return undefined;
		});
		const incomplete = resolvePreBaseCloudAuthConfig(key => key === 'prebase.cloud.url' ? 'https://example.supabase.co' : undefined);

		assert.deepStrictEqual(insecure, { mode: 'unconfigured', configurationError: 'invalid-url' });
		assert.deepStrictEqual(incomplete, { mode: 'unconfigured', configurationError: 'incomplete' });
	});

	test('allows local Supabase loopback HTTP while rejecting elevated client credentials explicitly', () => {
		const local = resolvePreBaseCloudAuthConfig(key => key === 'prebase.cloud.url'
			? 'http://127.0.0.1:54321/'
			: key === 'prebase.cloud.publishableKey' ? 'sb_publishable_local' : undefined);
		const secret = resolvePreBaseCloudAuthConfig(key => key === 'prebase.cloud.url'
			? 'https://example.supabase.co'
			: key === 'prebase.cloud.publishableKey' ? ['sb', 'secret', 'do-not-use'].join('_') : undefined);

		assert.deepStrictEqual(local, { mode: 'supabase', supabaseUrl: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_local' });
		assert.deepStrictEqual(secret, { mode: 'unconfigured', configurationError: 'invalid-client-key' });
	});

	test('keeps agent-history synchronization opt-in', () => {
		assert.strictEqual(isPreBaseCloudSyncAgentHistoryEnabled(() => true), true);
		assert.strictEqual(isPreBaseCloudSyncAgentHistoryEnabled(() => 'true'), false);
		assert.strictEqual(isPreBaseCloudSyncAgentHistoryEnabled(() => 1), false);
		assert.strictEqual(isPreBaseCloudSyncAgentHistoryEnabled(() => undefined), false);
	});
});

suite('PreBase Supabase auth client helpers', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('buildSupabaseAuthUrl normalizes trailing slash', () => {
		const url = buildSupabaseAuthUrl('https://ref.supabase.co/', '/token?grant_type=password');
		assert.strictEqual(url, 'https://ref.supabase.co/auth/v1/token?grant_type=password');
	});

	test('redactSensitiveForLog masks bearer tokens', () => {
		const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
		const out = redactSensitiveForLog(`Authorization: Bearer ${jwt}`);
		assert.ok(!out.includes(jwt));
		assert.ok(out.includes('[redacted'));
	});

	test('builds a PKCE browser authorization URL with provider-specific, bounded scopes', () => {
		const client = new PreBaseSupabaseAuthClient('https://ref.supabase.co/', 'pk-test', {} as never);
		for (const [provider, expectedScopes] of [
			['github', 'read:user user:email'],
			['google', 'openid email profile'],
		] as const) {
			const url = new URL(client.createOAuthAuthorizationUrl(provider, 'prebase://auth/callback?sb_flow_id=flow-value', 'challenge-value'));
			assert.strictEqual(url.origin, 'https://ref.supabase.co');
			assert.strictEqual(url.pathname, '/auth/v1/authorize');
			assert.strictEqual(url.searchParams.get('provider'), provider);
			assert.strictEqual(url.searchParams.get('redirect_to'), 'prebase://auth/callback?sb_flow_id=flow-value');
			assert.strictEqual(url.searchParams.has('flow_type'), false);
			assert.strictEqual(url.searchParams.get('code_challenge'), 'challenge-value');
			assert.strictEqual(url.searchParams.get('code_challenge_method'), 's256');
			assert.strictEqual(url.searchParams.has('state'), false);
			assert.strictEqual(url.searchParams.get('scopes'), expectedScopes);
		}
	});

	test('exchanges an OAuth code only through the PKCE token endpoint', async () => {
		let options: { url: string; data?: string; headers?: Record<string, string> } | undefined;
		const requestService = {
			request: async (request: typeof options) => {
				options = request;
				const stream = newWriteableBufferStream();
				stream.end(VSBuffer.fromString('{"access_token":"access"}'));
				return { res: { statusCode: 200 }, stream };
			},
		};
		const client = new PreBaseSupabaseAuthClient('https://ref.supabase.co', 'pk-test', requestService as never);
		assert.deepStrictEqual(await client.exchangeCodeForSession('auth-code', 'verifier-value', CancellationToken.None), { access_token: 'access' });
		assert.ok(options);
		assert.strictEqual(options!.url, 'https://ref.supabase.co/auth/v1/token?grant_type=pkce');
		assert.deepStrictEqual(JSON.parse(options!.data!), { auth_code: 'auth-code', code_verifier: 'verifier-value' });
		assert.strictEqual(options!.headers!.apikey, 'pk-test');
	});
});

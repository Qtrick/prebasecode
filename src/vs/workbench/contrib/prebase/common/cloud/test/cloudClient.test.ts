/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { resolvePreBaseCloudAuthConfig } from '../cloudConfiguration.js';
import { buildSupabaseAuthUrl, redactSensitiveForLog } from '../supabaseAuthRest.js';

suite('PreBase cloud configuration', () => {
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
});

suite('PreBase Supabase auth client helpers', () => {
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
});

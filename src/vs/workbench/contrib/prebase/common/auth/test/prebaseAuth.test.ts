/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { consumePreBaseOAuthCallback, consumePreBaseOAuthErrorCallback, isPreBaseOAuthProvider, parsePreBaseOAuthCallback, PREBASE_OAUTH_PROVIDERS } from '../prebaseOAuth.js';
import { decidePreBaseStartup, type PreBaseStartupAccountState } from '../prebaseStartupAuth.js';

suite('PreBase startup authentication decision', () => {
	test('waits through initialization and signing-in, avoiding an auth-screen flash for an eventual signed-in session', () => {
		for (const state of ['initializing', 'signingIn'] as PreBaseStartupAccountState[]) {
			assert.strictEqual(decidePreBaseStartup(state, false, false), 'wait', state);
			assert.strictEqual(decidePreBaseStartup(state, true, true), 'wait', state);
		}
		assert.strictEqual(decidePreBaseStartup('signedIn', false, false), 'open-onboarding');
		assert.strictEqual(decidePreBaseStartup('signedIn', true, false), 'continue');
	});

	test('shows auth for every settled unauthenticated state unless this process has dismissed offline auth', () => {
		for (const state of ['signedOut', 'error', 'unconfigured'] as PreBaseStartupAccountState[]) {
			assert.strictEqual(decidePreBaseStartup(state, false, false), 'show-auth', state);
			assert.strictEqual(decidePreBaseStartup(state, true, false), 'show-auth', state);
			assert.strictEqual(decidePreBaseStartup(state, false, true), 'open-onboarding', state);
			assert.strictEqual(decidePreBaseStartup(state, true, true), 'continue', state);
		}
	});
});

suite('PreBase OAuth callback parser', () => {
	const scheme = 'prebase';
	const state = 'unpredictable-state';

	test('accepts only the exact registered callback with its matching state', () => {
		assert.deepStrictEqual(
			parsePreBaseOAuthCallback(URI.parse('prebase://auth/callback?code=exchange-code&state=unpredictable-state'), scheme, state),
			{ code: 'exchange-code', state },
		);
		for (const uri of [
			URI.parse('other://auth/callback?code=exchange-code&state=unpredictable-state'),
			URI.parse('prebase://other/callback?code=exchange-code&state=unpredictable-state'),
			URI.parse('prebase://auth/other?code=exchange-code&state=unpredictable-state'),
			URI.parse('prebase://auth/callback?code=exchange-code&state=wrong-state'),
			URI.parse('prebase://auth/callback?code=exchange-code'),
			URI.parse('prebase://auth/callback?state=unpredictable-state'),
			URI.parse('prebase://auth/callback?code=exchange-code&code=other-code&state=unpredictable-state'),
			URI.parse('prebase://auth/callback?code=exchange-code&state=unpredictable-state&state=other-state'),
			URI.parse('prebase://auth/callback?code=exchange-code&error=access_denied&state=unpredictable-state'),
		]) {
			assert.strictEqual(parsePreBaseOAuthCallback(uri, scheme, state), undefined, uri.toString());
		}
	});

	test('rejects overlong callback values while accepting values at the documented parser bounds', () => {
		const maximumCode = 'c'.repeat(4096);
		const maximumState = 's'.repeat(512);
		assert.deepStrictEqual(
			parsePreBaseOAuthCallback(URI.parse(`prebase://auth/callback?code=${maximumCode}&state=${maximumState}`), scheme, maximumState),
			{ code: maximumCode, state: maximumState },
		);
		assert.strictEqual(
			parsePreBaseOAuthCallback(URI.parse(`prebase://auth/callback?code=${'c'.repeat(4097)}&state=${state}`), scheme, state),
			undefined,
		);
		assert.strictEqual(
			parsePreBaseOAuthCallback(URI.parse(`prebase://auth/callback?code=code&state=${'s'.repeat(513)}`), scheme, 's'.repeat(513)),
			undefined,
		);
	});

	test('consumes only a live, unconsumed callback attempt and rejects replay after the caller clears it', () => {
		const uri = URI.parse('prebase://auth/callback?code=exchange-code&state=one-time-state');
		const attempt = { state: 'one-time-state', expiresAt: 1_000, consumed: false };
		assert.deepStrictEqual(consumePreBaseOAuthCallback(uri, scheme, attempt, 1_000), { code: 'exchange-code', state: 'one-time-state' });

		// Production clears/replaces the in-memory attempt synchronously before exchange.
		attempt.consumed = true;
		assert.strictEqual(consumePreBaseOAuthCallback(uri, scheme, attempt, 1_000), undefined);
		assert.strictEqual(consumePreBaseOAuthCallback(uri, scheme, undefined, 1_000), undefined);
	});

	test('rejects an expired callback attempt before parsing its code', () => {
		const uri = URI.parse('prebase://auth/callback?code=exchange-code&state=timed-state');
		assert.strictEqual(
			consumePreBaseOAuthCallback(uri, scheme, { state: 'timed-state', expiresAt: 999, consumed: false }, 1_000),
			undefined,
		);
	});

	test('accepts a matching terminal OAuth error so the caller can restore an interactive signed-out state', () => {
		const attempt = { state: 'one-time-state', expiresAt: 1_000, consumed: false };
		assert.deepStrictEqual(
			consumePreBaseOAuthErrorCallback(URI.parse('prebase://auth/callback?error=access_denied&state=one-time-state'), scheme, attempt, 1_000),
			{ state: 'one-time-state' },
		);
		for (const uri of [
			URI.parse('prebase://auth/callback?error=access_denied&state=wrong-state'),
			URI.parse('prebase://auth/callback?error=access_denied'),
			URI.parse('prebase://auth/callback?error=access_denied&error=other&state=one-time-state'),
		]) {
			assert.strictEqual(consumePreBaseOAuthErrorCallback(uri, scheme, attempt, 1_000), undefined, uri.toString());
		}
		assert.deepStrictEqual(
			consumePreBaseOAuthErrorCallback(URI.parse('prebase://auth/callback?code=exchange-code&error=access_denied&state=one-time-state'), scheme, attempt, 1_000),
			{ state: 'one-time-state' },
		);
	});

	test('does not let a stale terminal OAuth error end an expired or consumed sign-in attempt', () => {
		const uri = URI.parse('prebase://auth/callback?error=access_denied&state=one-time-state');
		assert.strictEqual(
			consumePreBaseOAuthErrorCallback(uri, scheme, { state: 'one-time-state', expiresAt: 999, consumed: false }, 1_000),
			undefined,
		);
		assert.strictEqual(
			consumePreBaseOAuthErrorCallback(uri, scheme, { state: 'one-time-state', expiresAt: 1_000, consumed: true }, 1_000),
			undefined,
		);
	});

	test('exposes GitHub and Google as the complete OAuth provider allowlist', () => {
		assert.deepStrictEqual(PREBASE_OAUTH_PROVIDERS, ['github', 'google']);
		assert.strictEqual(isPreBaseOAuthProvider('github'), true);
		assert.strictEqual(isPreBaseOAuthProvider('google'), true);
		assert.strictEqual(isPreBaseOAuthProvider('GitHub'), false);
		assert.strictEqual(isPreBaseOAuthProvider('microsoft'), false);
	});
});

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
	const flowId = 'unpredictable-flow';

	test('accepts only the exact registered callback with its matching application flow ID', () => {
		assert.deepStrictEqual(
			parsePreBaseOAuthCallback(URI.parse('prebase://auth/callback?sb_flow_id=unpredictable-flow&code=exchange-code'), scheme, flowId),
			{ code: 'exchange-code', flowId },
		);
		for (const uri of [
			URI.parse('other://auth/callback?sb_flow_id=unpredictable-flow&code=exchange-code'),
			URI.parse('prebase://other/callback?sb_flow_id=unpredictable-flow&code=exchange-code'),
			URI.parse('prebase://auth/other?sb_flow_id=unpredictable-flow&code=exchange-code'),
			URI.parse('prebase://auth/callback?sb_flow_id=wrong-flow&code=exchange-code'),
			URI.parse('prebase://auth/callback?code=exchange-code'),
			URI.parse('prebase://auth/callback?sb_flow_id=unpredictable-flow'),
			URI.parse('prebase://auth/callback?sb_flow_id=unpredictable-flow&code=exchange-code&code=other-code'),
			URI.parse('prebase://auth/callback?sb_flow_id=unpredictable-flow&sb_flow_id=other-flow&code=exchange-code'),
			URI.parse('prebase://auth/callback?sb_flow_id=unpredictable-flow&code=exchange-code&error=access_denied'),
			URI.parse('prebase://auth/callback?sb_flow_id=unpredictable-flow&code=exchange-code&state=provider-state'),
		]) {
			assert.strictEqual(parsePreBaseOAuthCallback(uri, scheme, flowId), undefined, uri.toString());
		}
	});

	test('rejects overlong callback values while accepting values at the documented parser bounds', () => {
		const maximumCode = 'c'.repeat(4096);
		const maximumFlowId = 'f'.repeat(512);
		assert.deepStrictEqual(
			parsePreBaseOAuthCallback(URI.parse(`prebase://auth/callback?sb_flow_id=${maximumFlowId}&code=${maximumCode}`), scheme, maximumFlowId),
			{ code: maximumCode, flowId: maximumFlowId },
		);
		assert.strictEqual(
			parsePreBaseOAuthCallback(URI.parse(`prebase://auth/callback?sb_flow_id=${flowId}&code=${'c'.repeat(4097)}`), scheme, flowId),
			undefined,
		);
		assert.strictEqual(
			parsePreBaseOAuthCallback(URI.parse(`prebase://auth/callback?sb_flow_id=${'f'.repeat(513)}&code=code`), scheme, 'f'.repeat(513)),
			undefined,
		);
	});

	test('consumes only a live, unconsumed callback attempt and rejects replay after the caller clears it', () => {
		const uri = URI.parse('prebase://auth/callback?sb_flow_id=one-time-flow&code=exchange-code');
		const attempt = { flowId: 'one-time-flow', expiresAt: 1_000, consumed: false };
		assert.deepStrictEqual(consumePreBaseOAuthCallback(uri, scheme, attempt, 1_000), { code: 'exchange-code', flowId: 'one-time-flow' });

		// Production clears/replaces the in-memory attempt synchronously before exchange.
		attempt.consumed = true;
		assert.strictEqual(consumePreBaseOAuthCallback(uri, scheme, attempt, 1_000), undefined);
		assert.strictEqual(consumePreBaseOAuthCallback(uri, scheme, undefined, 1_000), undefined);
	});

	test('rejects an expired callback attempt before parsing its code', () => {
		const uri = URI.parse('prebase://auth/callback?sb_flow_id=timed-flow&code=exchange-code');
		assert.strictEqual(
			consumePreBaseOAuthCallback(uri, scheme, { flowId: 'timed-flow', expiresAt: 999, consumed: false }, 1_000),
			undefined,
		);
	});

	test('accepts a matching terminal OAuth error so the caller can restore an interactive signed-out state', () => {
		const attempt = { flowId: 'one-time-flow', expiresAt: 1_000, consumed: false };
		assert.deepStrictEqual(
			consumePreBaseOAuthErrorCallback(URI.parse('prebase://auth/callback?sb_flow_id=one-time-flow&error=access_denied'), scheme, attempt, 1_000),
			{ flowId: 'one-time-flow' },
		);
		for (const uri of [
			URI.parse('prebase://auth/callback?sb_flow_id=wrong-flow&error=access_denied'),
			URI.parse('prebase://auth/callback?error=access_denied'),
			URI.parse('prebase://auth/callback?sb_flow_id=one-time-flow&error=access_denied&error=other'),
		]) {
			assert.strictEqual(consumePreBaseOAuthErrorCallback(uri, scheme, attempt, 1_000), undefined, uri.toString());
		}
		assert.deepStrictEqual(
			consumePreBaseOAuthErrorCallback(URI.parse('prebase://auth/callback?sb_flow_id=one-time-flow&code=exchange-code&error=access_denied'), scheme, attempt, 1_000),
			{ flowId: 'one-time-flow' },
		);
		assert.deepStrictEqual(
			consumePreBaseOAuthErrorCallback(URI.parse('prebase://auth/callback?sb_flow_id=one-time-flow&error=access_denied#error=access_denied&error_description=Denied'), scheme, attempt, 1_000),
			{ flowId: 'one-time-flow' },
		);
		assert.strictEqual(
			consumePreBaseOAuthErrorCallback(URI.parse('prebase://auth/callback?sb_flow_id=one-time-flow&error=access_denied#error=server_error'), scheme, attempt, 1_000),
			undefined,
		);
	});

	test('does not let a stale terminal OAuth error end an expired or consumed sign-in attempt', () => {
		const uri = URI.parse('prebase://auth/callback?sb_flow_id=one-time-flow&error=access_denied');
		assert.strictEqual(
			consumePreBaseOAuthErrorCallback(uri, scheme, { flowId: 'one-time-flow', expiresAt: 999, consumed: false }, 1_000),
			undefined,
		);
		assert.strictEqual(
			consumePreBaseOAuthErrorCallback(uri, scheme, { flowId: 'one-time-flow', expiresAt: 1_000, consumed: true }, 1_000),
			undefined,
		);
	});

	test('strictly rejects implicit grant tokens delivered via URL fragment', () => {
		for (const fragmentUri of [
			URI.parse('prebase://auth/callback#access_token=secret_token&sb_flow_id=unpredictable-flow'),
			URI.parse('prebase://auth/callback#id_token=jwt_id_token&sb_flow_id=unpredictable-flow'),
			URI.parse('prebase://auth/callback#refresh_token=refresh_tok&sb_flow_id=unpredictable-flow'),
			URI.parse('prebase://auth/callback?sb_flow_id=unpredictable-flow&code=code#access_token=secret_token'),
		]) {
			assert.strictEqual(
				parsePreBaseOAuthCallback(fragmentUri, scheme, flowId),
				undefined,
				`Should reject fragment token in: ${fragmentUri.toString()}`
			);
		}
	});

	test('exposes GitHub and Google as the complete OAuth provider allowlist', () => {
		assert.deepStrictEqual(PREBASE_OAUTH_PROVIDERS, ['github', 'google']);
		assert.strictEqual(isPreBaseOAuthProvider('github'), true);
		assert.strictEqual(isPreBaseOAuthProvider('google'), true);
		assert.strictEqual(isPreBaseOAuthProvider('GitHub'), false);
		assert.strictEqual(isPreBaseOAuthProvider('microsoft'), false);
	});
});

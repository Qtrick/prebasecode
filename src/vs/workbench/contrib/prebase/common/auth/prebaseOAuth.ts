/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';

export const PREBASE_OAUTH_PROVIDERS = ['github', 'google'] as const;
export type PreBaseOAuthProvider = typeof PREBASE_OAUTH_PROVIDERS[number];
export const PREBASE_OAUTH_CALLBACK_AUTHORITY = 'auth';
export const PREBASE_OAUTH_CALLBACK_PATH = '/callback';
export const PREBASE_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

export interface IPreBaseOAuthCallback {
	code: string;
	state: string;
}

export interface IPreBaseOAuthErrorCallback {
	state: string;
}

export interface IPreBaseOAuthAttempt {
	state: string;
	expiresAt: number;
	consumed: boolean;
}

/**
 * Validates state, expiration, and one-time use without retaining secrets in storage.
 * The caller owns the returned replacement attempt and clears it before token exchange.
 */
export function consumePreBaseOAuthCallback(
	uri: URI,
	expectedScheme: string,
	attempt: IPreBaseOAuthAttempt | undefined,
	now: number,
): IPreBaseOAuthCallback | undefined {
	if (!attempt || attempt.consumed || now > attempt.expiresAt) {
		return undefined;
	}
	return parsePreBaseOAuthCallback(uri, expectedScheme, attempt.state);
}

/**
 * Recognizes the terminal OAuth error response without exposing provider-supplied
 * error values. The state check prevents an arbitrary protocol URL from ending
 * an in-progress sign-in attempt.
 */
export function consumePreBaseOAuthErrorCallback(
	uri: URI,
	expectedScheme: string,
	attempt: IPreBaseOAuthAttempt | undefined,
	now: number,
): IPreBaseOAuthErrorCallback | undefined {
	if (!attempt || attempt.consumed || now > attempt.expiresAt) {
		return undefined;
	}
	if (uri.scheme !== expectedScheme || uri.authority !== PREBASE_OAUTH_CALLBACK_AUTHORITY || uri.path !== PREBASE_OAUTH_CALLBACK_PATH) {
		return undefined;
	}
	const values = new URLSearchParams(uri.query || '');
	const states = values.getAll('state');
	const errors = values.getAll('error');
	// An OAuth error takes precedence if a malformed provider response includes
	// both a code and an error. The caller must never redeem that code.
	if (states.length !== 1 || errors.length !== 1 || !states[0] || !errors[0] || states[0] !== attempt.state) {
		return undefined;
	}
	return { state: states[0] };
}

/** Strictly accepts the registered product callback via PKCE query; rejects implicit fragment tokens. */
export function parsePreBaseOAuthCallback(uri: URI, expectedScheme: string, expectedState: string): IPreBaseOAuthCallback | undefined {
	if (uri.scheme !== expectedScheme || uri.authority !== PREBASE_OAUTH_CALLBACK_AUTHORITY || uri.path !== PREBASE_OAUTH_CALLBACK_PATH) {
		return undefined;
	}

	// Strictly reject implicit grant tokens in URI fragment
	if (uri.fragment) {
		const fragmentParams = new URLSearchParams(uri.fragment.startsWith('?') ? uri.fragment.slice(1) : uri.fragment);
		if (fragmentParams.has('access_token') || fragmentParams.has('id_token') || fragmentParams.has('refresh_token')) {
			return undefined;
		}
	}

	const values = new URLSearchParams(uri.query || '');
	const codes = values.getAll('code');
	const states = values.getAll('state');
	if (values.has('error') || codes.length !== 1 || states.length !== 1) {
		return undefined;
	}
	const [code] = codes;
	const [state] = states;
	if (!code || !state || state !== expectedState || code.length > 4096 || state.length > 512) {
		return undefined;
	}
	return { code, state };
}

export function isPreBaseOAuthProvider(value: string): value is PreBaseOAuthProvider {
	return (PREBASE_OAUTH_PROVIDERS as readonly string[]).includes(value);
}

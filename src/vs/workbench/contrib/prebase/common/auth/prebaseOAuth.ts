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

/** Strictly accepts the one registered product callback; never exposes callback values to logs. */
export function parsePreBaseOAuthCallback(uri: URI, expectedScheme: string, expectedState: string): IPreBaseOAuthCallback | undefined {
	if (uri.scheme !== expectedScheme || uri.authority !== PREBASE_OAUTH_CALLBACK_AUTHORITY || uri.path !== PREBASE_OAUTH_CALLBACK_PATH) {
		return undefined;
	}
	const values = new URLSearchParams(uri.query);
	const codes = values.getAll('code');
	const states = values.getAll('state');
	if (codes.length !== 1 || states.length !== 1) {
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

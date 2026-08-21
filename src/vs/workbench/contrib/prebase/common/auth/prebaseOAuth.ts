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
	flowId: string;
}

export interface IPreBaseOAuthErrorCallback {
	flowId: string;
}

export interface IPreBaseOAuthAttempt {
	flowId: string;
	expiresAt: number;
	consumed: boolean;
}

/**
 * Validates the application flow ID, expiration, and one-time use without retaining secrets in storage.
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
	return parsePreBaseOAuthCallback(uri, expectedScheme, attempt.flowId);
}

/**
 * Recognizes the terminal OAuth error response without exposing provider-supplied
 * error values. The application flow ID prevents an arbitrary protocol URL from ending
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
	const flowIds = values.getAll('sb_flow_id');
	const fragmentValues = new URLSearchParams(uri.fragment || '');
	if (fragmentValues.has('access_token') || fragmentValues.has('id_token') || fragmentValues.has('refresh_token')) {
		return undefined;
	}
	const queryErrors = values.getAll('error');
	const fragmentErrors = fragmentValues.getAll('error');
	if (queryErrors.length > 1 || fragmentErrors.length > 1) {
		return undefined;
	}
	const errors = [...queryErrors, ...fragmentErrors];
	// An OAuth error takes precedence if a malformed provider response includes
	// both a code and an error. The caller must never redeem that code.
	if (
		flowIds.length !== 1 ||
		!flowIds[0] ||
		flowIds[0] !== attempt.flowId ||
		errors.length === 0 ||
		errors.some(error => !error || error !== errors[0])
	) {
		return undefined;
	}
	return { flowId: flowIds[0] };
}

/** Strictly accepts the registered product callback via PKCE query; rejects implicit fragment tokens. */
export function parsePreBaseOAuthCallback(uri: URI, expectedScheme: string, expectedFlowId: string): IPreBaseOAuthCallback | undefined {
	if (uri.scheme !== expectedScheme || uri.authority !== PREBASE_OAUTH_CALLBACK_AUTHORITY || uri.path !== PREBASE_OAUTH_CALLBACK_PATH) {
		return undefined;
	}

	// Strictly reject implicit grant tokens in URI fragment
	if (uri.fragment) {
		return undefined;
	}

	const values = new URLSearchParams(uri.query || '');
	const codes = values.getAll('code');
	const flowIds = values.getAll('sb_flow_id');
	const allowedKeys = new Set(['code', 'sb_flow_id']);
	if (values.has('error') || values.has('state') || codes.length !== 1 || flowIds.length !== 1 || Array.from(values.keys()).some(key => !allowedKeys.has(key))) {
		return undefined;
	}
	const [code] = codes;
	const [flowId] = flowIds;
	if (!code || !flowId || flowId !== expectedFlowId || code.length > 4096 || flowId.length > 512) {
		return undefined;
	}
	return { code, flowId };
}

export function isPreBaseOAuthProvider(value: string): value is PreBaseOAuthProvider {
	return (PREBASE_OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud auth modes for the workbench client.
 *
 * REST adapter: we intentionally avoid bundling `@supabase/supabase-js` in the workbench.
 * Supabase Auth and PostgREST are stable HTTP APIs; `IRequestService` is sufficient for
 * signup, password grant, user, refresh, and logout. See docs/SUPABASE_ARCHITECTURE.md.
 */

export type PreBaseCloudAuthMode = 'unconfigured' | 'legacy' | 'supabase';

export type PreBaseCloudConnectionState = 'unknown' | 'online' | 'offline';

export interface IPreBaseSupabaseSession {
	accessToken: string;
	refreshToken?: string;
	userId: string;
	email?: string;
}

export interface IPreBaseCloudAuthConfig {
	readonly mode: PreBaseCloudAuthMode;
	/** Safe configuration diagnostic; never contains credential material. */
	readonly configurationError?: 'invalid-url' | 'invalid-client-key' | 'incomplete';
	/** Normalized `https://…supabase.co` when mode is `supabase`. */
	readonly supabaseUrl?: string;
	readonly publishableKey?: string;
	/** Legacy PreBase account HTTP API when mode is `legacy`. */
	readonly legacyApiBaseUrl?: string;
}

/** Optional `product.json` fields (publishable keys are public; never commit secret keys). */
export interface IPreBaseProductCloudFields {
	prebaseCloudUrl?: string;
	prebaseCloudPublishableKey?: string;
	prebaseAccountApiBaseUrl?: string;
}

export interface ISupabaseAuthUserResponse {
	id: string;
	email?: string;
	user_metadata?: Record<string, unknown>;
}

export interface ISupabaseAuthTokenResponse {
	access_token?: string;
	refresh_token?: string;
	user?: ISupabaseAuthUserResponse;
	error?: string;
	error_description?: string;
	msg?: string;
	message?: string;
}

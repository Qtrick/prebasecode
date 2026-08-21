/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { asText, IRequestService } from '../../../../../platform/request/common/request.js';
import { cloudErrorMessageFromBody, PreBaseCloudError } from '../../common/cloud/cloudErrors.js';
import type { ISupabaseAuthTokenResponse, ISupabaseAuthUserResponse } from '../../common/cloud/cloudTypes.js';
import { buildSupabaseAuthUrl } from '../../common/cloud/supabaseAuthRest.js';

export type PreBaseSupabaseOAuthProvider = 'github' | 'google';

export { buildSupabaseAuthUrl, buildSupabaseRestUrl, redactSensitiveForLog } from '../../common/cloud/supabaseAuthRest.js';

export class PreBaseSupabaseAuthClient {
	constructor(
		private readonly supabaseUrl: string,
		private readonly publishableKey: string,
		private readonly requestService: IRequestService,
	) { }

	async signUp(email: string, password: string, cancel: CancellationToken): Promise<ISupabaseAuthTokenResponse> {
		return this._postJson(
			buildSupabaseAuthUrl(this.supabaseUrl, '/signup'),
			{ email, password },
			{ apikey: this.publishableKey },
			cancel,
		);
	}

	async signInWithPassword(email: string, password: string, cancel: CancellationToken): Promise<ISupabaseAuthTokenResponse> {
		return this._postJson(
			buildSupabaseAuthUrl(this.supabaseUrl, '/token?grant_type=password'),
			{ email, password },
			{ apikey: this.publishableKey },
			cancel,
		);
	}

	createOAuthAuthorizationUrl(provider: PreBaseSupabaseOAuthProvider, redirectTo: string, codeChallenge: string): string {
		const url = new URL(buildSupabaseAuthUrl(this.supabaseUrl, '/authorize'));
		url.searchParams.set('provider', provider);
		url.searchParams.set('redirect_to', redirectTo);
		url.searchParams.set('code_challenge', codeChallenge);
		url.searchParams.set('code_challenge_method', 's256');
		url.searchParams.set('scopes', provider === 'github' ? 'read:user user:email' : 'openid email profile');
		return url.toString();
	}

	async exchangeCodeForSession(code: string, codeVerifier: string, cancel: CancellationToken): Promise<ISupabaseAuthTokenResponse> {
		return this._postJson(
			buildSupabaseAuthUrl(this.supabaseUrl, '/token?grant_type=pkce'),
			{ auth_code: code, code_verifier: codeVerifier },
			{ apikey: this.publishableKey },
			cancel,
		);
	}

	async getUser(accessToken: string, cancel: CancellationToken): Promise<ISupabaseAuthUserResponse | undefined> {
		const context = await this.requestService.request({
			type: 'GET',
			url: buildSupabaseAuthUrl(this.supabaseUrl, '/user'),
			headers: {
				apikey: this.publishableKey,
				Authorization: `Bearer ${accessToken}`,
			},
			timeout: 15000,
			callSite: 'PreBaseSupabaseAuthClient.getUser',
		}, cancel);
		if (cancel.isCancellationRequested) {
			return undefined;
		}
		const status = context.res.statusCode ?? 0;
		const text = (await asText(context)) || '';
		if (status === 401 || status === 403) {
			return undefined;
		}
		if (status < 200 || status >= 300) {
			throw new PreBaseCloudError('http', `Supabase user request failed (${status})`);
		}
		try {
			return JSON.parse(text) as ISupabaseAuthUserResponse;
		} catch {
			throw new PreBaseCloudError('invalid_response', 'Supabase user response was not JSON');
		}
	}

	async refreshSession(refreshToken: string, cancel: CancellationToken): Promise<ISupabaseAuthTokenResponse> {
		return this._postJson(
			buildSupabaseAuthUrl(this.supabaseUrl, '/token?grant_type=refresh_token'),
			{ refresh_token: refreshToken },
			{ apikey: this.publishableKey },
			cancel,
		);
	}

	async signOut(accessToken: string, cancel: CancellationToken): Promise<void> {
		try {
			await this.requestService.request({
				type: 'POST',
				url: buildSupabaseAuthUrl(this.supabaseUrl, '/logout?scope=local'),
				headers: {
					apikey: this.publishableKey,
					Authorization: `Bearer ${accessToken}`,
				},
				timeout: 10000,
				callSite: 'PreBaseSupabaseAuthClient.signOut',
			}, cancel);
		} catch {
			// Best-effort remote logout; local secrets are cleared by the caller.
		}
	}

	private async _postJson(
		url: string,
		body: Record<string, string>,
		headers: Record<string, string>,
		cancel: CancellationToken,
	): Promise<ISupabaseAuthTokenResponse> {
		const context = await this.requestService.request({
			type: 'POST',
			url,
			data: JSON.stringify(body),
			headers: { ...headers, 'Content-Type': 'application/json' },
			timeout: 20000,
			callSite: 'PreBaseSupabaseAuthClient._postJson',
		}, cancel);
		if (cancel.isCancellationRequested) {
			return {};
		}
		const text = (await asText(context)) || '';
		const status = context.res.statusCode ?? 0;
		let parsed: ISupabaseAuthTokenResponse;
		try {
			parsed = JSON.parse(text) as ISupabaseAuthTokenResponse;
		} catch {
			throw new PreBaseCloudError('invalid_response', 'Supabase auth response was not JSON');
		}
		if (status < 200 || status >= 300) {
			throw new PreBaseCloudError(
				'auth',
				cloudErrorMessageFromBody(parsed, `Supabase auth request failed (${status})`),
			);
		}
		return parsed;
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { asText, IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { PreBaseCloudConfigKeys } from '../common/cloud/cloudConfiguration.js';
import { PreBaseConfigKeys } from '../common/prebaseConfiguration.js';
import { IPreBaseCloudService } from './cloud/prebaseCloudService.js';
import { redactSensitiveForLog } from '../common/cloud/supabaseAuthRest.js';
import { consumePreBaseOAuthCallback, type IPreBaseOAuthAttempt, isPreBaseOAuthProvider, PREBASE_OAUTH_CALLBACK_AUTHORITY, PREBASE_OAUTH_CALLBACK_PATH, type PreBaseOAuthProvider, PREBASE_OAUTH_TIMEOUT_MS } from '../common/auth/prebaseOAuth.js';

export type PreBaseAccountState = 'initializing' | 'signedOut' | 'signingIn' | 'signedIn' | 'error' | 'unconfigured';

export interface IPreBaseAccountInfo {
	displayName: string;
	email?: string;
	avatarUrl?: string;
}

export const IPreBaseAccountService = createDecorator<IPreBaseAccountService>('prebaseAccountService');

/** Menu/when clauses — never reuse Copilot/GitHub account context keys. */
export const PREBASE_ACCOUNT_STATE_CONTEXT_KEY = new RawContextKey<PreBaseAccountState>('prebaseAccountState', 'initializing');
export const PREBASE_ACCOUNT_CONFIGURED_CONTEXT_KEY = new RawContextKey<boolean>('prebaseAccountConfigured', false);

export const PreBaseAccountContext = {
	configured: PREBASE_ACCOUNT_CONFIGURED_CONTEXT_KEY.isEqualTo(true),
	unconfigured: PREBASE_ACCOUNT_CONFIGURED_CONTEXT_KEY.isEqualTo(false),
	signedIn: PREBASE_ACCOUNT_STATE_CONTEXT_KEY.isEqualTo('signedIn'),
	notSignedIn: PREBASE_ACCOUNT_STATE_CONTEXT_KEY.notEqualsTo('signedIn'),
};

export interface IPreBaseAccountService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<void>;
	readonly state: PreBaseAccountState;
	readonly account: IPreBaseAccountInfo | undefined;
	readonly lastError: string | undefined;
	readonly apiConfigured: boolean;
	whenInitialSessionResolved(): Promise<void>;
	isOnboardingComplete(): boolean;
	markOnboardingComplete(): void;
	resetOnboarding(): void;
	signIn(email: string, password: string): Promise<void>;
	signUp(email: string, password: string, displayName?: string): Promise<void>;
	signInWithProvider(provider: PreBaseOAuthProvider): Promise<void>;
	handleOAuthCallback(uri: URI): Promise<boolean>;
	signOut(): Promise<void>;
	restoreSession(): Promise<void>;
}

const STORAGE_ACCOUNT = 'prebase.account.profile';
const STORAGE_ONBOARDING = 'prebase.onboarding.completedVersion';
const ONBOARDING_VERSION = 1;

export class PreBaseAccountService extends Disposable implements IPreBaseAccountService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private _state: PreBaseAccountState = 'initializing';
	private _account: IPreBaseAccountInfo | undefined;
	private _lastError: string | undefined;
	private _requestCts: CancellationTokenSource | undefined;
	private readonly _stateKey: IContextKey<PreBaseAccountState>;
	private readonly _configuredKey: IContextKey<boolean>;
	private readonly _initialSessionResolved = new DeferredPromise<void>();
	private _oauthAttempt: (IPreBaseOAuthAttempt & { codeVerifier: string }) | undefined;
	private _oauthTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IRequestService private readonly requestService: IRequestService,
		@IProductService private readonly productService: IProductService,
		@ILogService private readonly logService: ILogService,
		@IPreBaseCloudService private readonly cloudService: IPreBaseCloudService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this._stateKey = PREBASE_ACCOUNT_STATE_CONTEXT_KEY.bindTo(contextKeyService);
		this._configuredKey = PREBASE_ACCOUNT_CONFIGURED_CONTEXT_KEY.bindTo(contextKeyService);
		this._syncContextKeys();
		void this.restoreSession();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(PreBaseConfigKeys.AccountApiBaseUrl) ||
				e.affectsConfiguration(PreBaseCloudConfigKeys.Url) ||
				e.affectsConfiguration(PreBaseCloudConfigKeys.PublishableKey)
			) {
				void this.restoreSession();
			}
		}));
	}

	override dispose(): void {
		this._cancelRequests();
		this._clearOAuthAttempt();
		super.dispose();
	}

	get state(): PreBaseAccountState { return this._state; }
	get account(): IPreBaseAccountInfo | undefined { return this._account; }
	get lastError(): string | undefined { return this._lastError; }
	get apiConfigured(): boolean { return this.cloudService.isAuthConfigured(); }
	whenInitialSessionResolved(): Promise<void> { return this._initialSessionResolved.p; }

	isOnboardingComplete(): boolean {
		const completed = this.storageService.getNumber(STORAGE_ONBOARDING, StorageScope.APPLICATION, 0);
		return Number.isFinite(completed) && completed >= ONBOARDING_VERSION;
	}

	markOnboardingComplete(): void {
		this.storageService.store(STORAGE_ONBOARDING, ONBOARDING_VERSION, StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangeState.fire();
	}

	resetOnboarding(): void {
		this.storageService.remove(STORAGE_ONBOARDING, StorageScope.APPLICATION);
		this._onDidChangeState.fire();
	}

	async restoreSession(): Promise<void> {
		const cancel = this._beginRequest();
		try {
			const auth = this.cloudService.getAuthConfig();
			if (auth.mode === 'unconfigured') {
				this._setState('unconfigured', undefined, undefined);
				return;
			}
			if (auth.mode === 'supabase') {
				await this._restoreSupabaseSession(cancel);
				return;
			}
			await this._restoreLegacySession(cancel);
		} catch (err) {
			if (!cancel.isCancellationRequested) {
				const message = err instanceof Error ? err.message : String(err);
				this.logService.warn(`[PreBaseAccount] restoreSession: ${redactSensitiveForLog(message)}`);
				this._setState('signedOut', undefined, undefined);
			}
		} finally {
			this._initialSessionResolved.complete();
		}
	}

	async signInWithProvider(provider: PreBaseOAuthProvider): Promise<void> {
		if (!isPreBaseOAuthProvider(provider)) {
			throw new Error(localize('prebase.account.invalidProvider', 'This sign-in provider is not available.'));
		}
		const client = this.cloudService.getAuthClient();
		if (!client) {
			const message = localize('prebase.account.oauthCloudUnconfigured', 'Cloud sign-in is not configured. You can continue locally.');
			this._setState('unconfigured', undefined, message);
			throw new Error(message);
		}
		if (this._oauthAttempt) {
			throw new Error(localize('prebase.account.oauthActive', 'A PreBase sign-in is already in progress.'));
		}
		const codeVerifier = this._randomUrlSafe(48);
		const state = this._randomUrlSafe(32);
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
		const challenge = encodeBase64(VSBuffer.wrap(new Uint8Array(digest)), false, true);
		this._oauthAttempt = { state, codeVerifier, expiresAt: Date.now() + PREBASE_OAUTH_TIMEOUT_MS, consumed: false };
		this._oauthTimer = setTimeout(() => {
			this._clearOAuthAttempt();
			if (this._state === 'signingIn') {
				this._setState('signedOut', undefined, localize('prebase.account.oauthTimedOut', 'Sign-in timed out. Try again.'));
			}
		}, PREBASE_OAUTH_TIMEOUT_MS);
		this._setState('signingIn', undefined, undefined);
		const callback = URI.from({ scheme: this.productService.urlProtocol, authority: PREBASE_OAUTH_CALLBACK_AUTHORITY, path: PREBASE_OAUTH_CALLBACK_PATH }).toString();
		try {
			const opened = await this.openerService.open(client.createOAuthAuthorizationUrl(provider, callback, challenge, state), { openExternal: true });
			if (opened) {
				return;
			}
		} catch {
			// Treat an opener failure exactly like a declined open; neither exposes OAuth values.
		}
		if (this._oauthAttempt) {
			this._clearOAuthAttempt();
			this._setState('signedOut', undefined, localize('prebase.account.browserFailed', 'Unable to open the system browser for sign-in.'));
		}
	}

	async handleOAuthCallback(uri: URI): Promise<boolean> {
		const attempt = this._oauthAttempt;
		const callback = consumePreBaseOAuthCallback(uri, this.productService.urlProtocol, attempt, Date.now());
		if (!callback || !attempt) {
			return false;
		}
		// Consume before the network exchange so deep-link replay cannot redeem the same code twice.
		this._clearOAuthAttempt();
		const cancel = this._beginRequest();
		try {
			const client = this.cloudService.getAuthClient();
			if (!client) {
				throw new Error(localize('prebase.account.oauthCloudUnconfigured', 'Cloud sign-in is not configured. You can continue locally.'));
			}
			const response = await client.exchangeCodeForSession(callback.code, attempt.codeVerifier, cancel);
			if (!response.access_token || cancel.isCancellationRequested) {
				throw new Error(localize('prebase.account.oauthNoToken', 'Account service did not return a session token.'));
			}
			await this.cloudService.getSessionAdapter().write({ accessToken: response.access_token, refreshToken: response.refresh_token });
			if (cancel.isCancellationRequested) {
				// A sign-out may have raced an unabortable SecretStorage write. Clear only
				// when no newer sign-in owns the session, matching the password flow.
				if (!this._requestCts || this._requestCts.token === cancel) {
					await this.cloudService.getSessionAdapter().clear();
				}
				this._abandonSigningInIfOwner(cancel);
				return true;
			}
			const info = await this._buildAccountFromSupabase(response.access_token, cancel) ?? { displayName: response.user?.email || 'PreBase', email: response.user?.email };
			if (cancel.isCancellationRequested) {
				if (!this._requestCts || this._requestCts.token === cancel) {
					await this.cloudService.getSessionAdapter().clear();
				}
				this._abandonSigningInIfOwner(cancel);
				return true;
			}
			this.storageService.store(STORAGE_ACCOUNT, JSON.stringify(info), StorageScope.APPLICATION, StorageTarget.USER);
			this._setState('signedIn', info, undefined);
			return true;
		} catch (err) {
			if (!cancel.isCancellationRequested) {
				this._setState('error', undefined, redactSensitiveForLog(err instanceof Error ? err.message : String(err)));
			}
			return true;
		}
	}

	async signIn(email: string, password: string): Promise<void> {
		const auth = this.cloudService.getAuthConfig();
		if (auth.mode === 'supabase') {
			await this._exchangeSupabaseCredentials('sign-in', email, password);
			return;
		}
		await this._exchangeCredentials('sign-in', email, password);
	}

	async signUp(email: string, password: string, displayName?: string): Promise<void> {
		const auth = this.cloudService.getAuthConfig();
		if (auth.mode === 'supabase') {
			await this._exchangeSupabaseCredentials('sign-up', email, password, displayName);
			return;
		}
		await this._exchangeCredentials('sign-up', email, password, displayName);
	}

	async signOut(): Promise<void> {
		this._cancelRequests();
		this._clearOAuthAttempt();
		const auth = this.cloudService.getAuthConfig();
		if (auth.mode === 'supabase') {
			const session = await this.cloudService.getSessionAdapter().read();
			const client = this.cloudService.getAuthClient();
			if (session?.accessToken && client) {
				const cts = new CancellationTokenSource();
				await client.signOut(session.accessToken, cts.token);
				cts.dispose();
			}
		}
		await this.cloudService.getSessionAdapter().clear();
		this.storageService.remove(STORAGE_ACCOUNT, StorageScope.APPLICATION);
		this._setState(this.cloudService.isAuthConfigured() ? 'signedOut' : 'unconfigured', undefined, undefined);
	}

	private _legacyApiBase(): string {
		const auth = this.cloudService.getAuthConfig();
		return auth.mode === 'legacy' ? (auth.legacyApiBaseUrl ?? '') : '';
	}

	private async _restoreLegacySession(cancel: CancellationToken): Promise<void> {
		const base = this._legacyApiBase();
		if (!base) {
			this._setState('unconfigured', undefined, undefined);
			return;
		}
		const session = await this.cloudService.getSessionAdapter().read();
		const token = session?.accessToken;
		if (cancel.isCancellationRequested) {
			return;
		}
		if (!token) {
			this.storageService.remove(STORAGE_ACCOUNT, StorageScope.APPLICATION);
			this._setState('signedOut', undefined, undefined);
			return;
		}
		const info = await this._validateLegacySession(base, token, cancel);
		if (cancel.isCancellationRequested) {
			return;
		}
		if (!info) {
			this.storageService.remove(STORAGE_ACCOUNT, StorageScope.APPLICATION);
			this._setState('signedOut', undefined, undefined);
			return;
		}
		this.storageService.store(STORAGE_ACCOUNT, JSON.stringify(info), StorageScope.APPLICATION, StorageTarget.USER);
		this._setState('signedIn', info, undefined);
	}

	private async _restoreSupabaseSession(cancel: CancellationToken): Promise<void> {
		const accessToken = await this.cloudService.refreshAccessTokenIfNeeded(cancel);
		if (cancel.isCancellationRequested) {
			return;
		}
		if (!accessToken) {
			this.storageService.remove(STORAGE_ACCOUNT, StorageScope.APPLICATION);
			this._setState('signedOut', undefined, undefined);
			return;
		}
		const info = await this._buildAccountFromSupabase(accessToken, cancel);
		if (cancel.isCancellationRequested) {
			return;
		}
		if (!info) {
			this.storageService.remove(STORAGE_ACCOUNT, StorageScope.APPLICATION);
			this._setState('signedOut', undefined, undefined);
			return;
		}
		this.storageService.store(STORAGE_ACCOUNT, JSON.stringify(info), StorageScope.APPLICATION, StorageTarget.USER);
		this._setState('signedIn', info, undefined);
	}

	private async _buildAccountFromSupabase(accessToken: string, cancel: CancellationToken): Promise<IPreBaseAccountInfo | undefined> {
		const client = this.cloudService.getAuthClient();
		if (!client) {
			return undefined;
		}
		const user = await client.getUser(accessToken, cancel);
		if (cancel.isCancellationRequested || !user?.id) {
			return undefined;
		}
		this.cloudService.markOnline();
		const profileRepo = this.cloudService.getProfileRepository();
		const profile = profileRepo ? await profileRepo.fetchProfile(user.id, accessToken, cancel) : undefined;
		const metaName = typeof user.user_metadata?.display_name === 'string' ? user.user_metadata.display_name : undefined;
		const displayName = profile?.display_name || metaName || user.email || 'PreBase';
		return {
			displayName,
			email: user.email,
			avatarUrl: profile?.avatar_url ?? undefined,
		};
	}

	private _beginRequest(): CancellationToken {
		this._cancelRequests();
		this._requestCts = new CancellationTokenSource();
		return this._requestCts.token;
	}

	private _cancelRequests(): void {
		this._requestCts?.cancel();
		this._requestCts?.dispose();
		this._requestCts = undefined;
	}

	private _clearOAuthAttempt(): void {
		this._oauthAttempt = undefined;
		if (this._oauthTimer !== undefined) {
			clearTimeout(this._oauthTimer);
			this._oauthTimer = undefined;
		}
	}

	private _randomUrlSafe(bytes: number): string {
		const value = crypto.getRandomValues(new Uint8Array(bytes));
		return encodeBase64(VSBuffer.wrap(value), false, true);
	}

	private async _validateLegacySession(base: string, token: string, cancel: CancellationToken): Promise<IPreBaseAccountInfo | undefined> {
		try {
			const context = await this.requestService.request({
				type: 'GET',
				url: `${base}/v1/account/session`,
				headers: { Authorization: `Bearer ${token}` },
				timeout: 15000,
				callSite: 'PreBaseAccountService._validateLegacySession',
			}, cancel);
			if (cancel.isCancellationRequested) {
				return undefined;
			}
			const status = context.res.statusCode ?? 0;
			if (status === 401 || status === 403) {
				this.logService.warn('[PreBaseAccount] session token rejected; clearing secrets');
				await this.cloudService.getSessionAdapter().clear();
				return undefined;
			}
			if (status < 200 || status >= 300) {
				this.logService.warn(`[PreBaseAccount] session validation failed with status ${status}`);
				return undefined;
			}
			const text = (await asText(context)) || '';
			let parsed: { displayName?: string; email?: string; avatarUrl?: string };
			try {
				parsed = JSON.parse(text);
			} catch {
				return undefined;
			}
			if (!parsed.displayName && !parsed.email) {
				return undefined;
			}
			return {
				displayName: parsed.displayName || parsed.email || 'PreBase',
				email: parsed.email,
				avatarUrl: parsed.avatarUrl,
			};
		} catch (err) {
			if (!cancel.isCancellationRequested) {
				this.logService.warn(`[PreBaseAccount] session validation error: ${redactSensitiveForLog(err instanceof Error ? err.message : String(err))}`);
			}
			return undefined;
		}
	}

	private async _exchangeSupabaseCredentials(
		kind: 'sign-in' | 'sign-up',
		email: string,
		password: string,
		displayName?: string,
	): Promise<void> {
		const client = this.cloudService.getAuthClient();
		if (!client) {
			const msg = localize(
				'prebase.account.cloudUnconfigured',
				"Cloud sign-in is not configured. Set prebase.cloud.url and prebase.cloud.publishableKey, or use Continue without signing in.",
			);
			this._setState('unconfigured', undefined, msg);
			throw new Error(msg);
		}
		if (!email.trim() || !password) {
			const msg = localize('prebase.account.missingCreds', "Email and password are required.");
			this._setState('error', this._account, msg);
			throw new Error(msg);
		}
		const cancel = this._beginRequest();
		this._setState('signingIn', this._account, undefined);
		try {
			const response = kind === 'sign-up'
				? await client.signUp(email.trim(), password, cancel)
				: await client.signInWithPassword(email.trim(), password, cancel);
			if (cancel.isCancellationRequested) {
				this._abandonSigningInIfOwner(cancel);
				return;
			}
			if (!response.access_token) {
				throw new Error(localize('prebase.account.noToken', "Account service did not return a session token."));
			}
			await this.cloudService.getSessionAdapter().write({
				accessToken: response.access_token,
				refreshToken: response.refresh_token,
			});
			const userId = response.user?.id;
			if (userId) {
				const profileRepo = this.cloudService.getProfileRepository();
				if (profileRepo) {
					await profileRepo.upsertProfile(userId, response.access_token, {
						displayName: displayName?.trim() || undefined,
					}, cancel);
				}
			}
			if (cancel.isCancellationRequested) {
				if (!this._requestCts || this._requestCts.token === cancel) {
					await this.cloudService.getSessionAdapter().clear();
					this._abandonSigningInIfOwner(cancel);
				}
				return;
			}
			const info = await this._buildAccountFromSupabase(response.access_token, cancel);
			const accountInfo: IPreBaseAccountInfo = info ?? {
				displayName: displayName?.trim() || response.user?.email || email.trim(),
				email: response.user?.email || email.trim(),
			};
			this.storageService.store(STORAGE_ACCOUNT, JSON.stringify(accountInfo), StorageScope.APPLICATION, StorageTarget.USER);
			this._setState('signedIn', accountInfo, undefined);
			this.cloudService.markOnline();
		} catch (err) {
			if (cancel.isCancellationRequested) {
				this._abandonSigningInIfOwner(cancel);
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			this._setState('error', undefined, message);
			throw err instanceof Error ? err : new Error(message);
		}
	}

	private async _exchangeCredentials(kind: 'sign-in' | 'sign-up', email: string, password: string, displayName?: string): Promise<void> {
		const base = this._legacyApiBase();
		if (!base) {
			const msg = localize(
				'prebase.account.unconfigured',
				"Account service is not configured. Set prebase.cloud.url and prebase.cloud.publishableKey for Supabase, or prebase.account.apiBaseUrl (deprecated) for a legacy HTTPS account API.",
			);
			this._setState('unconfigured', undefined, msg);
			throw new Error(msg);
		}
		if (!email.trim() || !password) {
			const msg = localize('prebase.account.missingCreds', "Email and password are required.");
			this._setState('error', this._account, msg);
			throw new Error(msg);
		}
		const cancel = this._beginRequest();
		this._setState('signingIn', this._account, undefined);
		try {
			const body = JSON.stringify({
				email: email.trim(),
				password,
				displayName: displayName?.trim() || undefined,
				product: this.productService.nameShort,
			});
			const context = await this.requestService.request({
				type: 'POST',
				url: `${base}/v1/account/${kind}`,
				data: body,
				headers: { 'Content-Type': 'application/json' },
				timeout: 20000,
				callSite: 'PreBaseAccountService._exchangeCredentials',
			}, cancel);
			if (cancel.isCancellationRequested) {
				this._abandonSigningInIfOwner(cancel);
				return;
			}
			const text = (await asText(context)) || '';
			if (context.res.statusCode && (context.res.statusCode < 200 || context.res.statusCode >= 300)) {
				this.logService.warn(`[PreBaseAccount] ${kind} failed with status ${context.res.statusCode}`);
				throw new Error(localize('prebase.account.httpError', "Account request failed ({0}).", context.res.statusCode));
			}
			let parsed: { accessToken?: string; refreshToken?: string; displayName?: string; email?: string; avatarUrl?: string };
			try {
				parsed = JSON.parse(text);
			} catch {
				throw new Error(localize('prebase.account.badResponse', "Account service returned an invalid response."));
			}
			if (!parsed.accessToken) {
				throw new Error(localize('prebase.account.noToken', "Account service did not return a session token."));
			}
			if (cancel.isCancellationRequested) {
				this._abandonSigningInIfOwner(cancel);
				return;
			}
			await this.cloudService.getSessionAdapter().write({
				accessToken: parsed.accessToken,
				refreshToken: parsed.refreshToken,
			});
			if (cancel.isCancellationRequested) {
				if (!this._requestCts || this._requestCts.token === cancel) {
					await this.cloudService.getSessionAdapter().clear();
					this._abandonSigningInIfOwner(cancel);
				}
				return;
			}
			const info: IPreBaseAccountInfo = {
				displayName: parsed.displayName || email.trim(),
				email: parsed.email || email.trim(),
				avatarUrl: parsed.avatarUrl,
			};
			this.storageService.store(STORAGE_ACCOUNT, JSON.stringify(info), StorageScope.APPLICATION, StorageTarget.USER);
			this._setState('signedIn', info, undefined);
		} catch (err) {
			if (cancel.isCancellationRequested) {
				this._abandonSigningInIfOwner(cancel);
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			this._setState('error', undefined, message);
			throw err instanceof Error ? err : new Error(message);
		}
	}

	private _abandonSigningInIfOwner(cancel: CancellationToken): void {
		if (this._state !== 'signingIn') {
			return;
		}
		if (this._requestCts && this._requestCts.token !== cancel) {
			return;
		}
		this._setState(this.cloudService.isAuthConfigured() ? 'signedOut' : 'unconfigured', undefined, undefined);
	}

	private _setState(state: PreBaseAccountState, account: IPreBaseAccountInfo | undefined, error: string | undefined): void {
		this._state = state;
		this._account = account;
		this._lastError = error;
		this._syncContextKeys();
		this._onDidChangeState.fire();
	}

	private _syncContextKeys(): void {
		this._stateKey.set(this._state);
		this._configuredKey.set(this.cloudService.isAuthConfigured());
	}
}

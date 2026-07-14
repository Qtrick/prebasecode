/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { asText, IRequestService } from '../../../../platform/request/common/request.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { PreBaseConfigKeys } from '../common/prebaseConfiguration.js';

export type PreBaseAccountState = 'signedOut' | 'signingIn' | 'signedIn' | 'error' | 'unconfigured';

export interface IPreBaseAccountInfo {
	displayName: string;
	email?: string;
	avatarUrl?: string;
}

export const IPreBaseAccountService = createDecorator<IPreBaseAccountService>('prebaseAccountService');

/** Menu/when clauses — never reuse Copilot/GitHub account context keys. */
export const PREBASE_ACCOUNT_STATE_CONTEXT_KEY = new RawContextKey<PreBaseAccountState>('prebaseAccountState', 'unconfigured');
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
	isOnboardingComplete(): boolean;
	markOnboardingComplete(): void;
	resetOnboarding(): void;
	signIn(email: string, password: string): Promise<void>;
	signUp(email: string, password: string, displayName?: string): Promise<void>;
	signOut(): Promise<void>;
	restoreSession(): Promise<void>;
}

const SECRET_ACCESS = 'prebase.account.accessToken';
const SECRET_REFRESH = 'prebase.account.refreshToken';
const STORAGE_ACCOUNT = 'prebase.account.profile';
const STORAGE_ONBOARDING = 'prebase.onboarding.completedVersion';
const ONBOARDING_VERSION = 1;

export class PreBaseAccountService extends Disposable implements IPreBaseAccountService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private _state: PreBaseAccountState = 'unconfigured';
	private _account: IPreBaseAccountInfo | undefined;
	private _lastError: string | undefined;
	private _requestCts: CancellationTokenSource | undefined;
	private readonly _stateKey: IContextKey<PreBaseAccountState>;
	private readonly _configuredKey: IContextKey<boolean>;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IStorageService private readonly storageService: IStorageService,
		@IRequestService private readonly requestService: IRequestService,
		@IProductService private readonly productService: IProductService,
		@ILogService private readonly logService: ILogService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this._stateKey = PREBASE_ACCOUNT_STATE_CONTEXT_KEY.bindTo(contextKeyService);
		this._configuredKey = PREBASE_ACCOUNT_CONFIGURED_CONTEXT_KEY.bindTo(contextKeyService);
		this._syncContextKeys();
		void this.restoreSession();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(PreBaseConfigKeys.AccountApiBaseUrl)) {
				void this.restoreSession();
			}
		}));
	}

	override dispose(): void {
		this._cancelRequests();
		super.dispose();
	}

	get state(): PreBaseAccountState { return this._state; }
	get account(): IPreBaseAccountInfo | undefined { return this._account; }
	get lastError(): string | undefined { return this._lastError; }
	get apiConfigured(): boolean { return !!this._apiBase(); }

	isOnboardingComplete(): boolean {
		const v = this.storageService.getNumber(STORAGE_ONBOARDING, StorageScope.APPLICATION, 0);
		return v >= ONBOARDING_VERSION;
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
		const base = this._apiBase();
		if (!base) {
			// Never present a synthetic signed-in session when the account API is unset.
			this._setState('unconfigured', undefined, undefined);
			return;
		}
		const token = await this.secretStorageService.get(SECRET_ACCESS);
		if (cancel.isCancellationRequested) {
			return;
		}
		if (!token) {
			this.storageService.remove(STORAGE_ACCOUNT, StorageScope.APPLICATION);
			this._setState('signedOut', undefined, undefined);
			return;
		}
		const info = await this._validateSession(base, token, cancel);
		if (cancel.isCancellationRequested) {
			return;
		}
		if (!info) {
			// Token present but not validated — do not claim signed-in from local profile alone.
			this.storageService.remove(STORAGE_ACCOUNT, StorageScope.APPLICATION);
			this._setState('signedOut', undefined, undefined);
			return;
		}
		this.storageService.store(STORAGE_ACCOUNT, JSON.stringify(info), StorageScope.APPLICATION, StorageTarget.USER);
		this._setState('signedIn', info, undefined);
	}

	async signIn(email: string, password: string): Promise<void> {
		await this._exchangeCredentials('sign-in', email, password);
	}

	async signUp(email: string, password: string, displayName?: string): Promise<void> {
		await this._exchangeCredentials('sign-up', email, password, displayName);
	}

	async signOut(): Promise<void> {
		this._cancelRequests();
		await this.secretStorageService.delete(SECRET_ACCESS);
		await this.secretStorageService.delete(SECRET_REFRESH);
		this.storageService.remove(STORAGE_ACCOUNT, StorageScope.APPLICATION);
		this._setState(this._apiBase() ? 'signedOut' : 'unconfigured', undefined, undefined);
	}

	private _apiBase(): string {
		const fromConfig = (this.configurationService.getValue<string>(PreBaseConfigKeys.AccountApiBaseUrl) || '').trim();
		const fromProduct = String((this.productService as unknown as { prebaseAccountApiBaseUrl?: string }).prebaseAccountApiBaseUrl || '').trim();
		const base = fromConfig || fromProduct;
		if (!base || !/^https:\/\//i.test(base)) {
			return '';
		}
		return base.replace(/\/$/, '');
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

	private async _validateSession(base: string, token: string, cancel: CancellationToken): Promise<IPreBaseAccountInfo | undefined> {
		try {
			const context = await this.requestService.request({
				type: 'GET',
				url: `${base}/v1/account/session`,
				headers: { Authorization: `Bearer ${token}` },
				timeout: 15000,
				callSite: 'PreBaseAccountService._validateSession',
			}, cancel);
			if (cancel.isCancellationRequested) {
				return undefined;
			}
			const status = context.res.statusCode ?? 0;
			if (status === 401 || status === 403) {
				this.logService.warn('[PreBaseAccount] session token rejected; clearing secrets');
				await this.secretStorageService.delete(SECRET_ACCESS);
				await this.secretStorageService.delete(SECRET_REFRESH);
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
				this.logService.warn(`[PreBaseAccount] session validation error: ${err instanceof Error ? err.message : String(err)}`);
			}
			return undefined;
		}
	}

	private async _exchangeCredentials(kind: 'sign-in' | 'sign-up', email: string, password: string, displayName?: string): Promise<void> {
		const base = this._apiBase();
		if (!base) {
			const msg = localize('prebase.account.unconfigured', "Account service is not configured. Set prebase.account.apiBaseUrl to an https endpoint.");
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
			// Tokens only in SecretStorage — never configuration, never profile storage, never logs.
			await this.secretStorageService.set(SECRET_ACCESS, parsed.accessToken);
			if (parsed.refreshToken) {
				await this.secretStorageService.set(SECRET_REFRESH, parsed.refreshToken);
			} else {
				await this.secretStorageService.delete(SECRET_REFRESH);
			}
			if (cancel.isCancellationRequested) {
				// Roll back only if this exchange still owns the request slot — never wipe a newer sign-in.
				if (!this._requestCts || this._requestCts.token === cancel) {
					await this.secretStorageService.delete(SECRET_ACCESS);
					await this.secretStorageService.delete(SECRET_REFRESH);
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

	/** Clear stuck `signingIn` only when this CTS still owns the service slot (or was disposed). */
	private _abandonSigningInIfOwner(cancel: CancellationToken): void {
		if (this._state !== 'signingIn') {
			return;
		}
		if (this._requestCts && this._requestCts.token !== cancel) {
			return;
		}
		this._setState(this._apiBase() ? 'signedOut' : 'unconfigured', undefined, undefined);
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
		this._configuredKey.set(!!this._apiBase());
	}
}

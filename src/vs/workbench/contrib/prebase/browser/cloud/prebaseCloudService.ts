/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import {
	isPreBaseCloudSyncPreferencesEnabled,
	PreBaseCloudConfigKeys,
	resolvePreBaseCloudAuthConfig,
} from '../../common/cloud/cloudConfiguration.js';
import type { IPreBaseCloudAuthConfig, IPreBaseProductCloudFields, PreBaseCloudConnectionState } from '../../common/cloud/cloudTypes.js';
import { PreBasePreferencesRepository } from './preferencesRepository.js';
import { PreBaseProfileRepository } from './profileRepository.js';
import { PreBaseSupabaseAuthClient } from './prebaseSupabaseAuthClient.js';
import { redactSensitiveForLog } from '../../common/cloud/supabaseAuthRest.js';
import { PreBaseCloudSessionAdapter } from './secretStorageSessionAdapter.js';

export const IPreBaseCloudService = createDecorator<IPreBaseCloudService>('prebaseCloudService');

export interface IPreBaseCloudService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeConnectionState: Event<void>;
	readonly connectionState: PreBaseCloudConnectionState;
	getAuthConfig(): IPreBaseCloudAuthConfig;
	isAuthConfigured(): boolean;
	isPreferencesSyncEnabled(): boolean;
	getAuthClient(): PreBaseSupabaseAuthClient | undefined;
	getProfileRepository(): PreBaseProfileRepository | undefined;
	getPreferencesRepository(): PreBasePreferencesRepository | undefined;
	getSessionAdapter(): PreBaseCloudSessionAdapter;
	/** Updates connection state after a successful HTTP round-trip. */
	markOnline(): void;
	/** Updates connection state after a failed network call (non-auth). */
	markOffline(): void;
	refreshAccessTokenIfNeeded(cancel: CancellationToken): Promise<string | undefined>;
}

export class PreBaseCloudService extends Disposable implements IPreBaseCloudService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConnectionState = this._register(new Emitter<void>());
	readonly onDidChangeConnectionState = this._onDidChangeConnectionState.event;

	private _connectionState: PreBaseCloudConnectionState = 'unknown';
	private _authClient: PreBaseSupabaseAuthClient | undefined;
	private _profileRepo: PreBaseProfileRepository | undefined;
	private _preferencesRepo: PreBasePreferencesRepository | undefined;
	private readonly _sessionAdapter: PreBaseCloudSessionAdapter;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
		@ISecretStorageService secretStorageService: ISecretStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._sessionAdapter = new PreBaseCloudSessionAdapter(secretStorageService);
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(PreBaseCloudConfigKeys.Url) ||
				e.affectsConfiguration(PreBaseCloudConfigKeys.PublishableKey)
			) {
				this._resetClients();
			}
		}));
	}

	get connectionState(): PreBaseCloudConnectionState {
		return this._connectionState;
	}

	getAuthConfig(): IPreBaseCloudAuthConfig {
		return resolvePreBaseCloudAuthConfig(
			key => this.configurationService.getValue(key),
			this.productService as unknown as IPreBaseProductCloudFields,
		);
	}

	isAuthConfigured(): boolean {
		const cfg = this.getAuthConfig();
		return cfg.mode === 'supabase' || cfg.mode === 'legacy';
	}

	isPreferencesSyncEnabled(): boolean {
		return isPreBaseCloudSyncPreferencesEnabled(key => this.configurationService.getValue(key));
	}

	getSessionAdapter(): PreBaseCloudSessionAdapter {
		return this._sessionAdapter;
	}

	getAuthClient(): PreBaseSupabaseAuthClient | undefined {
		const cfg = this.getAuthConfig();
		if (cfg.mode !== 'supabase' || !cfg.supabaseUrl || !cfg.publishableKey) {
			return undefined;
		}
		if (!this._authClient) {
			this._authClient = new PreBaseSupabaseAuthClient(cfg.supabaseUrl, cfg.publishableKey, this.requestService);
		}
		return this._authClient;
	}

	getProfileRepository(): PreBaseProfileRepository | undefined {
		const cfg = this.getAuthConfig();
		if (cfg.mode !== 'supabase' || !cfg.supabaseUrl || !cfg.publishableKey) {
			return undefined;
		}
		if (!this._profileRepo) {
			this._profileRepo = new PreBaseProfileRepository(cfg.supabaseUrl, cfg.publishableKey, this.requestService);
		}
		return this._profileRepo;
	}

	getPreferencesRepository(): PreBasePreferencesRepository | undefined {
		if (!this.isPreferencesSyncEnabled()) {
			return undefined;
		}
		const cfg = this.getAuthConfig();
		if (cfg.mode !== 'supabase' || !cfg.supabaseUrl || !cfg.publishableKey) {
			return undefined;
		}
		if (!this._preferencesRepo) {
			this._preferencesRepo = new PreBasePreferencesRepository(cfg.supabaseUrl, cfg.publishableKey, this.requestService);
		}
		return this._preferencesRepo;
	}

	markOnline(): void {
		if (this._connectionState !== 'online') {
			this._connectionState = 'online';
			this._onDidChangeConnectionState.fire();
		}
	}

	markOffline(): void {
		if (this._connectionState !== 'offline') {
			this._connectionState = 'offline';
			this._onDidChangeConnectionState.fire();
		}
	}

	private _inFlightRefresh?: Promise<string | undefined>;

	async refreshAccessTokenIfNeeded(cancel: CancellationToken): Promise<string | undefined> {
		if (!this._inFlightRefresh) {
			const promise = this._doRefreshAccessTokenIfNeeded(CancellationToken.None);
			this._inFlightRefresh = promise;
			const clearIfCurrent = () => {
				if (this._inFlightRefresh === promise) {
					this._inFlightRefresh = undefined;
				}
			};
			void promise.then(clearIfCurrent, clearIfCurrent);
		}
		const accessToken = await this._inFlightRefresh;
		return cancel.isCancellationRequested ? undefined : accessToken;
	}

	private async _doRefreshAccessTokenIfNeeded(cancel: CancellationToken): Promise<string | undefined> {
		const client = this.getAuthClient();
		if (!client) {
			return undefined;
		}
		const session = await this._sessionAdapter.read();
		if (!session?.accessToken) {
			return undefined;
		}
		let user;
		try {
			user = await client.getUser(session.accessToken, cancel);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logService.warn(`[PreBaseCloud] session validation error: ${redactSensitiveForLog(msg)}`);
			this.markOffline();
			return session.accessToken;
		}
		if (user) {
			this.markOnline();
			return session.accessToken;
		}
		if (!session.refreshToken) {
			await this._sessionAdapter.clear();
			return undefined;
		}
		try {
			const refreshed = await client.refreshSession(session.refreshToken, cancel);
			if (cancel.isCancellationRequested || !refreshed.access_token) {
				return undefined;
			}
			const currentSession = await this._sessionAdapter.read();
			if (currentSession?.refreshToken !== session.refreshToken) {
				return undefined;
			}
			await this._sessionAdapter.write({
				accessToken: refreshed.access_token,
				refreshToken: refreshed.refresh_token ?? session.refreshToken,
			});
			this.markOnline();
			return refreshed.access_token;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logService.warn(`[PreBaseCloud] token refresh failed: ${redactSensitiveForLog(msg)}`);
			const currentSession = await this._sessionAdapter.read();
			if (currentSession?.refreshToken === session.refreshToken) {
				await this._sessionAdapter.clear();
			}
			this.markOffline();
			return undefined;
		}
	}

	private _resetClients(): void {
		this._authClient = undefined;
		this._profileRepo = undefined;
		this._preferencesRepo = undefined;
		this._connectionState = 'unknown';
		this._onDidChangeConnectionState.fire();
	}
}

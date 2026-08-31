/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import type { IPreBaseCloudAuthConfig, IPreBaseProductCloudFields } from './cloudTypes.js';

export enum PreBaseCloudConfigKeys {
	Url = 'prebase.cloud.url',
	PublishableKey = 'prebase.cloud.publishableKey',
	SyncAgentHistory = 'prebase.cloud.sync.agentHistory',
	SyncPreferences = 'prebase.cloud.sync.preferences',
}

function normalizeCloudUrl(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) {
		return '';
	}
	try {
		const url = new URL(trimmed);
		const isLoopbackHttp = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1');
		if (url.protocol !== 'https:' && !isLoopbackHttp) {
			return '';
		}
		return trimmed.replace(/\/$/, '');
	} catch {
		return '';
	}
}

function nonEmpty(raw: unknown): string {
	return typeof raw === 'string' ? raw.trim() : '';
}

function safeDecodeBase64Url(base64Url: string): string | undefined {
	try {
		return decodeBase64(base64Url).toString();
	} catch {
		// Base64 decode failure
	}
	return undefined;
}

function isForbiddenSecretKey(key: string): boolean {
	const trimmed = key.trim();
	if (trimmed.startsWith('sb_secret_') || trimmed.startsWith('secret_')) {
		return true;
	}
	if (trimmed.toLowerCase().includes('service_role')) {
		return true;
	}
	try {
		const parts = trimmed.split('.');
		if (parts.length === 3) {
			const decoded = safeDecodeBase64Url(parts[1]);
			if (decoded) {
				const payload = JSON.parse(decoded);
				if (payload && (payload.role === 'service_role' || payload.role === 'supabase_admin')) {
					return true;
				}
			}
		}
	} catch {
		// Not a decodeable JWT payload
	}
	return false;
}

export function resolvePreBaseCloudAuthConfig(
	getConfigValue: (key: string) => unknown,
	product?: IPreBaseProductCloudFields,
): IPreBaseCloudAuthConfig {
	const rawCloudUrl = nonEmpty(getConfigValue(PreBaseCloudConfigKeys.Url)) || nonEmpty(product?.prebaseCloudUrl);
	const cloudUrl = normalizeCloudUrl(
		rawCloudUrl,
	);
	const rawPublishableKey =
		nonEmpty(getConfigValue(PreBaseCloudConfigKeys.PublishableKey)) ||
		nonEmpty(product?.prebaseCloudPublishableKey);

	const forbiddenClientKey = isForbiddenSecretKey(rawPublishableKey);
	const publishableKey = forbiddenClientKey ? '' : rawPublishableKey;

	if (cloudUrl && publishableKey) {
		return { mode: 'supabase', supabaseUrl: cloudUrl, publishableKey };
	}

	const legacy = normalizeCloudUrl(
		nonEmpty(getConfigValue('prebase.account.apiBaseUrl')) ||
		nonEmpty(product?.prebaseAccountApiBaseUrl),
	);
	if (legacy) {
		return { mode: 'legacy', legacyApiBaseUrl: legacy };
	}

	if (forbiddenClientKey) {
		return { mode: 'unconfigured', configurationError: 'invalid-client-key' };
	}
	if (rawCloudUrl && !cloudUrl) {
		return { mode: 'unconfigured', configurationError: 'invalid-url' };
	}
	if (rawCloudUrl || rawPublishableKey) {
		return { mode: 'unconfigured', configurationError: 'incomplete' };
	}
	return { mode: 'unconfigured' };
}

export function isPreBaseCloudSyncAgentHistoryEnabled(getConfigValue: (key: string) => unknown): boolean {
	return getConfigValue(PreBaseCloudConfigKeys.SyncAgentHistory) === true;
}

export function isPreBaseCloudSyncPreferencesEnabled(getConfigValue: (key: string) => unknown): boolean {
	return getConfigValue(PreBaseCloudConfigKeys.SyncPreferences) === true;
}

export function registerPreBaseCloudConfiguration(): void {
	const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
	configurationRegistry.registerConfiguration({
		id: 'prebaseCloud',
		order: 98,
		title: localize('prebaseCloudTitle', "PreBase Cloud"),
		type: 'object',
		properties: {
			[PreBaseCloudConfigKeys.Url]: {
				type: 'string',
				default: '',
				description: localize(
					'prebase.cloud.url',
					"HTTPS Supabase project URL (for example https://YOUR_REF.supabase.co). When set with a publishable key, sign-in uses Supabase Auth instead of the legacy account API.",
				),
			},
			[PreBaseCloudConfigKeys.PublishableKey]: {
				type: 'string',
				default: '',
				description: localize(
					'prebase.cloud.publishableKey',
					"Supabase public client publishable (or legacy anon) key. This value is safe to embed in a public client; never use a secret or service-role key. Required together with prebase.cloud.url for cloud sign-in.",
				),
			},
			[PreBaseCloudConfigKeys.SyncAgentHistory]: {
				type: 'boolean',
				default: false,
				description: localize(
					'prebase.cloud.sync.agentHistory',
					"Sync agent session history to Supabase when signed in. Off by default until explicitly enabled.",
				),
			},
			[PreBaseCloudConfigKeys.SyncPreferences]: {
				type: 'boolean',
				default: false,
				description: localize(
					'prebase.cloud.sync.preferences',
					"Sync user preferences to Supabase when signed in. Off by default; local settings remain authoritative when disabled.",
				),
			},
		},
	});
}

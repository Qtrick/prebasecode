/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import type { IPreBaseCloudAuthConfig, IPreBaseProductCloudFields } from './cloudTypes.js';

export enum PreBaseCloudConfigKeys {
	Url = 'prebase.cloud.url',
	PublishableKey = 'prebase.cloud.publishableKey',
	SyncAgentHistory = 'prebase.cloud.sync.agentHistory',
	SyncPreferences = 'prebase.cloud.sync.preferences',
}

const HTTPS_URL_RE = /^https:\/\//i;

function normalizeHttpsUrl(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed || !HTTPS_URL_RE.test(trimmed)) {
		return '';
	}
	return trimmed.replace(/\/$/, '');
}

function nonEmpty(raw: unknown): string {
	return typeof raw === 'string' ? raw.trim() : '';
}

export function resolvePreBaseCloudAuthConfig(
	getConfigValue: (key: string) => unknown,
	product?: IPreBaseProductCloudFields,
): IPreBaseCloudAuthConfig {
	const cloudUrl = normalizeHttpsUrl(
		nonEmpty(getConfigValue(PreBaseCloudConfigKeys.Url)) ||
		nonEmpty(product?.prebaseCloudUrl),
	);
	const publishableKey =
		nonEmpty(getConfigValue(PreBaseCloudConfigKeys.PublishableKey)) ||
		nonEmpty(product?.prebaseCloudPublishableKey);

	if (cloudUrl && publishableKey) {
		return { mode: 'supabase', supabaseUrl: cloudUrl, publishableKey };
	}

	const legacy = normalizeHttpsUrl(
		nonEmpty(getConfigValue('prebase.account.apiBaseUrl')) ||
		nonEmpty(product?.prebaseAccountApiBaseUrl),
	);
	if (legacy) {
		return { mode: 'legacy', legacyApiBaseUrl: legacy };
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
					"Supabase publishable (anon) key. Store in user settings or OS secret storage — never commit this value. Required together with prebase.cloud.url for cloud sign-in.",
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

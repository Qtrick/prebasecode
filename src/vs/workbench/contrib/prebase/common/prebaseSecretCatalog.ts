/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PreBaseSecretKind = 'model-provider' | 'tool-provider';

export interface PreBaseSecretDescriptor {
	readonly id: string;
	readonly kind: PreBaseSecretKind;
	readonly displayName: string;
	readonly localEnvNames: readonly string[];
	readonly cloudSecretNames: readonly string[];
	readonly consumers: readonly string[];
	readonly description: string;
}

/**
 * Non-secret declarative catalog of provider credentials supported by PreBase.
 * Contains no secrets, API keys, or URLs.
 */
export const PREBASE_SECRET_CATALOG: readonly PreBaseSecretDescriptor[] = [
	{
		id: 'gemini-api',
		kind: 'model-provider',
		displayName: 'Google Gemini',
		localEnvNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
		cloudSecretNames: ['GEMINI_API_KEY'],
		consumers: ['magnus', 'ai-descriptions', 'model-discovery'],
		description: 'API credential for Google Gemini language models (models.list, generateContent, chat, descriptions).',
	},
	{
		id: 'linkup-api',
		kind: 'tool-provider',
		displayName: 'LinkUp Search',
		localEnvNames: ['LINKUP_API_KEY'],
		cloudSecretNames: ['LINKUP_API_KEY'],
		consumers: ['magnus-web-search'],
		description: 'API credential for LinkUp web search tool.',
	},
];

/** Set of all allowlisted local .env variable names across all descriptors. */
export const ALLOWLISTED_LOCAL_ENV_VARIABLES: ReadonlySet<string> = new Set(
	PREBASE_SECRET_CATALOG.flatMap(d => d.localEnvNames)
);

/** Set of all allowlisted cloud secret names across all descriptors. */
export const ALLOWLISTED_CLOUD_SECRET_NAMES: ReadonlySet<string> = new Set(
	PREBASE_SECRET_CATALOG.flatMap(d => d.cloudSecretNames)
);

export function getSecretDescriptor(id: string): PreBaseSecretDescriptor | undefined {
	return PREBASE_SECRET_CATALOG.find(d => d.id === id);
}

export function getDescriptorForLocalEnv(varName: string): PreBaseSecretDescriptor | undefined {
	return PREBASE_SECRET_CATALOG.find(d => d.localEnvNames.includes(varName));
}

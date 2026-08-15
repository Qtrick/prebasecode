/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PreBaseSecretKind = 'model-provider' | 'tool-provider';
export type PreBaseSecretCategory = 'ai-provider' | 'web-search';
export type PreBaseAIExecutionMode = 'auto' | 'development-env' | 'byok' | 'hosted';

export interface PreBaseSecretDescriptor {
	readonly id: string;
	readonly kind: PreBaseSecretKind;
	readonly category: PreBaseSecretCategory;
	readonly displayName: string;
	readonly localEnvNames: readonly string[];
	readonly cloudSecretNames: readonly string[];
	readonly byokStorageKey: string;
	readonly hostedSecretName: string;
	readonly consumers: readonly string[];
	readonly description: string;
	readonly dormant?: boolean;
}

/**
 * Non-secret declarative catalog of provider credentials supported by PreBase.
 * Contains no secrets, API keys, or URLs.
 */
export const PREBASE_SECRET_CATALOG: readonly PreBaseSecretDescriptor[] = [
	{
		id: 'gemini',
		kind: 'model-provider',
		category: 'ai-provider',
		displayName: 'Google Gemini',
		localEnvNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
		cloudSecretNames: ['GEMINI_API_KEY'],
		byokStorageKey: 'prebase.magnus.provider.gemini.apiKey',
		hostedSecretName: 'GEMINI_API_KEY',
		consumers: ['magnus', 'ai-descriptions', 'model-discovery'],
		description: 'API credential for Google Gemini language models (models.list, generateContent, chat, descriptions).',
	},
	{
		id: 'linkup',
		kind: 'tool-provider',
		category: 'web-search',
		displayName: 'LinkUp Search',
		localEnvNames: ['LINKUP_API_KEY'],
		cloudSecretNames: ['LINKUP_API_KEY'],
		byokStorageKey: 'prebase.magnus.provider.linkup.apiKey',
		hostedSecretName: 'LINKUP_API_KEY',
		consumers: ['magnus-web-search'],
		description: 'API credential for LinkUp web search tool.',
	},
	{
		id: 'openai',
		kind: 'model-provider',
		category: 'ai-provider',
		displayName: 'OpenAI (Future)',
		localEnvNames: ['OPENAI_API_KEY'],
		cloudSecretNames: ['OPENAI_API_KEY'],
		byokStorageKey: 'prebase.magnus.provider.openai.apiKey',
		hostedSecretName: 'OPENAI_API_KEY',
		consumers: ['magnus', 'ai-descriptions'],
		description: 'API credential for OpenAI models (dormant until adapter implementation).',
		dormant: true,
	},
	{
		id: 'anthropic',
		kind: 'model-provider',
		category: 'ai-provider',
		displayName: 'Anthropic (Future)',
		localEnvNames: ['ANTHROPIC_API_KEY'],
		cloudSecretNames: ['ANTHROPIC_API_KEY'],
		byokStorageKey: 'prebase.magnus.provider.anthropic.apiKey',
		hostedSecretName: 'ANTHROPIC_API_KEY',
		consumers: ['magnus', 'ai-descriptions'],
		description: 'API credential for Anthropic Claude models (dormant until adapter implementation).',
		dormant: true,
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
	const normalized = id.toLowerCase().replace(/-api$/, '');
	return PREBASE_SECRET_CATALOG.find(d => d.id === normalized || d.id === id);
}

export function getDescriptorForLocalEnv(varName: string): PreBaseSecretDescriptor | undefined {
	return PREBASE_SECRET_CATALOG.find(d => d.localEnvNames.includes(varName));
}

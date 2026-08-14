/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Product-facing cloud capabilities. Public identity surfaces intentionally expose only GitHub and Google. */
export const PREBASE_CLOUD_CAPABILITIES = {
	emailPasswordAuth: false,
	oauthProviders: true,
	pkceDesktopOAuth: true,
	agentHistorySync: false,
	preferencesSync: false,
} as const;

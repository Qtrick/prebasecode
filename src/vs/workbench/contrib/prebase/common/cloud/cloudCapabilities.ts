/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Product-facing capability flags (Phase F — email/password only). */
export const PREBASE_CLOUD_CAPABILITIES = {
	emailPasswordAuth: true,
	oauthProviders: false,
	pkceDesktopOAuth: false,
	agentHistorySync: false,
	preferencesSync: false,
} as const;

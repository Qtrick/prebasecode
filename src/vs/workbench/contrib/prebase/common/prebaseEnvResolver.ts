/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ALLOWLISTED_LOCAL_ENV_VARIABLES } from './prebaseSecretCatalog.js';

/**
 * Pure parser for allowlisted .env variables.
 * Safe from shell injection, eval, or arbitrary variable expansion.
 */
export function parseAllowlistedEnv(content: string, allowlist: ReadonlySet<string> = ALLOWLISTED_LOCAL_ENV_VARIABLES): Map<string, string> {
	const result = new Map<string, string>();
	const lines = content.split(/\r?\n/);

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
			continue;
		}

		const eqIndex = trimmed.indexOf('=');
		const varName = trimmed.slice(0, eqIndex).trim();
		if (!allowlist.has(varName)) {
			continue;
		}

		let val = trimmed.slice(eqIndex + 1).trim();
		if (val.length >= 2) {
			const first = val[0];
			const last = val[val.length - 1];
			if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
				val = val.slice(1, -1);
			}
		}

		if (val.trim()) {
			result.set(varName, val.trim());
		}
	}

	return result;
}

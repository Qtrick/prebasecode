/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Evaluates whether the standalone Agents Window feature is enabled.
 *
 * Fail-closed policy:
 * - Returns `true` ONLY IF `env['PREBASE_ENABLE_AGENTS_WINDOW']` is truthy (and not '0' or 'false')
 *   OR `productConfig?.prebaseAgentsWindowEnabled === true`.
 * - Defaults to `false` when configuration is undefined, missing, false, or disabled.
 */
export function isAgentsWindowEnabled(
	productConfig?: { prebaseAgentsWindowEnabled?: boolean },
	env?: Record<string, string | undefined>,
): boolean {
	const activeEnv = env ?? (typeof process !== 'undefined' ? process.env : undefined);
	const envOverride = activeEnv?.['PREBASE_ENABLE_AGENTS_WINDOW'];
	if (envOverride && envOverride !== '0' && envOverride !== 'false') {
		return true;
	}
	return productConfig?.prebaseAgentsWindowEnabled === true;
}

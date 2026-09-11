/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Graph settings registration + keys (DOM-free).
 * Browser Settings UI panels: `./ui.ts` → `host/workbench/settings/graphSettingsUi.ts`.
 */
export {
	PREBASE_GRAPH_CHANNEL_ID,
	PREBASE_GRAPH_CHANNEL_LABEL,
	PREBASE_GRAPH_RESETTABLE_CONFIG_KEYS,
	PreBaseGraphConfigKeys,
} from '../common/configuration/graphConfigKeys.js';
export { registerPreBaseGraphConfiguration } from '../host/workbench/graphConfigurationContribution.js';

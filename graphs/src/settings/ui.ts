/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Browser Settings UI surface for PreBase graph panels.
 * Keep this separate from `./index.ts` so registration/key imports stay DOM-free.
 */
export {
	GRAPH_SUPPORTED_LANGUAGES,
	renderGraphAdvanced,
	renderGraphCategory,
	renderGraphInteractionControls,
	renderGraphPerformanceCategory,
	renderGraphReduceMotionRow,
} from '../host/workbench/settings/graphSettingsUi.js';
export type { IPreBaseGraphSettingsUiHost } from '../host/workbench/settings/graphSettingsUi.js';

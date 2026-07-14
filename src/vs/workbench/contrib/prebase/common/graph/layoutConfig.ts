/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Ported from PreBase core for VS Code workbench.
 *--------------------------------------------------------------------------------------------*/

import type { LayoutOrganizationMethod } from './layoutOrganization.js'

/** Runtime layout tuning passed from settings into the layout engine. */
export interface LayoutRuntimeConfig {
	layerRadiusScale: number
	maxNodesPerLayer: number
	layerGap: number
	centerClearance: number
	scatterRelaxIterations: number
	/** Multiplier from sidebar spacing control (compact / balanced / spacious). */
	spacingScale: number
	/** How files are ranked into rings/tiers (hierarchy & pyramid). */
	organizationMethod: LayoutOrganizationMethod
}

export const DEFAULT_LAYOUT_RUNTIME: LayoutRuntimeConfig = {
	layerRadiusScale: 1,
	maxNodesPerLayer: 24,
	layerGap: 52,
	centerClearance: 44,
	scatterRelaxIterations: 22,
	spacingScale: 1,
	organizationMethod: 'dependency-depth'
}

export function mergeLayoutRuntime(
	partial?: Partial<LayoutRuntimeConfig>
): LayoutRuntimeConfig {
	return { ...DEFAULT_LAYOUT_RUNTIME, ...partial }
}

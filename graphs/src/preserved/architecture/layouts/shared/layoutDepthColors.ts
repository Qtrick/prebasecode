/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { isUnreachableDepth } from '../../analysis/dependencyDepth.js'

/** Shared depth palette for Hierarchy rings and Pyramid bands. */

const ENTRY_COLOR = 'rgba(232,184,74,0.42)'
const UNREACHABLE_COLOR = 'rgba(148,163,184,0.30)'

/** Depth 1+ ring/band colors (entry uses ENTRY_COLOR). */
const DEPTH_COLORS = [
	'rgba(56,189,248,0.36)', // depth 1 — cyan
	'rgba(45,212,191,0.34)', // depth 2 — teal
	'rgba(167,139,250,0.32)', // depth 3 — purple
	'rgba(251,191,36,0.30)', // depth 4 — amber/orange
	'rgba(244,114,182,0.28)', // depth 5 — pink
	'rgba(74,222,128,0.26)', // depth 6 — green
	'rgba(196,181,253,0.24)',
	'rgba(148,163,184,0.22)'
] as const

/** Color for a depth level (0 = entry, 1 = innermost ring/band after entry). */
export function depthLevelColor(depth: number): string {
	if (isUnreachableDepth(depth)) return UNREACHABLE_COLOR
	if (depth <= 0) return ENTRY_COLOR
	return DEPTH_COLORS[(depth - 1) % DEPTH_COLORS.length]
}

/**
 * Pure RGB for a depth level — no alpha channel.
 * Use this in SVG stopColor / fill / stroke when you want to control
 * opacity exclusively through stopOpacity / fillOpacity / strokeOpacity,
 * avoiding the double-alpha multiplication that occurs when an rgba()
 * color is combined with a separate opacity attribute.
 */
export function depthLevelColorBase(depth: number): string {
	return depthLevelColor(depth).replace(
		/rgba\((\d+),\s*(\d+),\s*(\d+),[\d.]+\)/,
		'rgb($1,$2,$3)'
	)
}

/** Border color with higher opacity for selected state. */
export function depthLevelBorderColor(depth: number, selected = false): string {
	const base = depthLevelColor(depth)
	if (!selected) return base.replace(/[\d.]+\)$/, '0.48)')
	return base.replace(/[\d.]+\)$/, '0.72)')
}

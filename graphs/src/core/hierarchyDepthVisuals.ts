/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Ported from PreBase core for VS Code workbench.
 *--------------------------------------------------------------------------------------------*/

import type { HierarchyRingBand } from './hierarchyLayout.js'
import { ringBandKey } from './hierarchyLayout.js'

/** One visible colored ring per non-empty hierarchy depth. */
export interface HierarchyDepthVisual {
	key: string
	depth: number
	subRingIndex: number
	innerRadius: number
	outerRadius: number
	bandKeys: string[]
}

/** Consolidate layout bands into exactly one render/hit-test annulus per depth. */
export function consolidateHierarchyDepthVisuals(
	bands: HierarchyRingBand[],
	centerOuterRadius: number
): HierarchyDepthVisual[] {
	const byDepth = new Map<number, HierarchyDepthVisual>()

	for (const band of bands) {
		if (band.nodeIds.length === 0) continue
		if (band.outerRadius <= centerOuterRadius + 2) continue

		const inner = Math.max(centerOuterRadius, band.innerRadius)
		const existing = byDepth.get(band.semanticDepth)
		if (!existing) {
			byDepth.set(band.semanticDepth, {
				key: ringBandKey(band.semanticDepth, 0),
				depth: band.semanticDepth,
				subRingIndex: 0,
				innerRadius: inner,
				outerRadius: band.outerRadius,
				bandKeys: [band.key]
			})
			continue
		}

		existing.innerRadius = Math.min(existing.innerRadius, inner)
		existing.outerRadius = Math.max(existing.outerRadius, band.outerRadius)
		if (!existing.bandKeys.includes(band.key)) {
			existing.bandKeys.push(band.key)
		}
	}

	return [...byDepth.values()].sort((a, b) => a.depth - b.depth)
}

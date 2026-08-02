import type { LayoutMode } from '@core/types'
import type { LayoutRuntimeConfig } from '@core/layout/layout-config'
import { viewportFitForLayout } from '@core/layout/layout-constraints'
import { hierarchyFitPaddingBoost } from './hierarchy-fit-bounds'
import type { GraphSnapshot } from '@core/types'

export interface GraphViewportInsets {
  /** Right inspector panel width when open (overlays graph canvas). */
  rightPx: number
  /** Bottom padding for zoom bar / legend (px). */
  bottomPx?: number
}

/** Fit view options that account for floating UI and inspector overlay. */
export function architectureFitViewOptions(
  layoutMode: LayoutMode,
  insets: GraphViewportInsets,
  initialZoomCap: number,
  snapshot?: GraphSnapshot | null,
  runtime?: LayoutRuntimeConfig,
  userPositions?: Record<string, { x: number; y: number }>
): {
  padding: { top: number; right: number; bottom: number; left: number }
  minZoom: number
  maxZoom: number
} {
  const fit = viewportFitForLayout(layoutMode)
  const bottomNorm = Math.min(0.12, Math.max(0.05, (insets.bottomPx ?? 72) / 900))
  const inspectorNorm =
    insets.rightPx > 0 ? Math.min(0.22, Math.max(0.08, insets.rightPx / 880)) : 0
  const hierarchyCompact = layoutMode === 'hierarchy' ? 0.74 : 1
  const side = fit.padding * 0.42 + 0.04
  // Slight left-heavy padding nudges radial layouts right in the canvas (reduces empty right margin).
  const horizontalBias = layoutMode === 'hierarchy' ? 0.018 : layoutMode === 'pyramid' ? 0.012 : 0.008
  const ringBoost =
    snapshot && runtime
      ? hierarchyFitPaddingBoost(snapshot, layoutMode, runtime, userPositions)
      : 0

  return {
    padding: {
      top: (fit.padding * 0.72 + 0.03 + ringBoost * 0.35) * hierarchyCompact,
      right: (Math.max(0.04, side - horizontalBias) + inspectorNorm + ringBoost * 0.25) * hierarchyCompact,
      bottom: (fit.padding * 0.46 + bottomNorm + ringBoost * 0.35) * hierarchyCompact,
      left: (side + horizontalBias + ringBoost * 0.25) * hierarchyCompact
    },
    minZoom: fit.minZoom,
    maxZoom: Math.min(fit.maxZoom, Math.max(0.82, initialZoomCap))
  }
}

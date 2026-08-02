import type { GraphSnapshot } from '@core/types'
import { FLOW_NODE_HEIGHT, FLOW_NODE_WIDTH } from './flow-adapter'
import { computeEdgeRenderState } from './edge-render-strategy'
import { ARCHITECTURE_EDGE_LEGEND } from './file-type-colors'

export interface ArchitectureEdgeLegendItem {
  id: string
  label: string
  color: string
  dashed?: boolean
}

/** Edge types present in the current Architecture Graph snapshot. */
export function collectArchitectureEdgeLegend(snapshot: GraphSnapshot): ArchitectureEdgeLegendItem[] {
  const seen = new Set<string>()
  for (const edge of snapshot.edges) {
    const variant = computeEdgeRenderState(
      edge,
      snapshot,
      null,
      null,
      snapshot.positions,
      FLOW_NODE_WIDTH,
      FLOW_NODE_HEIGHT
    ).variant
    if (variant === 'highlighted' || variant === 'selected') {
      seen.add('import')
      continue
    }
    if (variant === 'folder-link') {
      seen.add('contains')
      continue
    }
    seen.add(variant)
  }

  return ARCHITECTURE_EDGE_LEGEND.filter((item) => seen.has(item.id))
}

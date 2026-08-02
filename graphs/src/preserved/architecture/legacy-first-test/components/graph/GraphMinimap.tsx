import { memo, useCallback } from 'react'
import { MiniMap, useNodes } from '@xyflow/react'
import { useGraphStore } from '../../state/graph-store'
import { useSettingsStore } from '../../state/settings-store'

function GraphMinimapComponent() {
  const showMinimap = useGraphStore((s) => s.showMinimap)
  const graphQuality = useSettingsStore((s) => s.graphQuality)
  const nodes = useNodes()

  const nodeColor = useCallback(
    (n: { data?: { color?: string } }) => (n.data as { color?: string })?.color ?? '#3f3f46',
    []
  )

  if (!showMinimap) return null
  if (graphQuality === 'performance' || nodes.length > 45) return null

  return (
    <MiniMap
      position="bottom-left"
      pannable={false}
      zoomable={false}
      className="!bottom-6 !left-6 !right-auto"
      nodeColor={nodeColor}
      nodeStrokeWidth={0}
      maskStrokeWidth={0}
    />
  )
}

export const GraphMinimap = memo(GraphMinimapComponent)

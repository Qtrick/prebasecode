import { useMemo } from 'react'
import { useViewport } from '@xyflow/react'
import { getPyramidDepthBands } from '@core/layout/hierarchy-layout'
import { depthLevelColorBase, depthLevelColor } from '@core/layout/layout-depth-colors'
import { useGraphStore } from '../../state/graph-store'
import { useSettingsStore } from '../../state/settings-store'
import { getEffectiveGraphPositions } from '../../utils/effective-graph-positions'
import { layoutRuntimeFromSettings } from '../../utils/layout-settings'

interface PyramidLabelsProps {
  hidden?: boolean
}

/**
 * Colored horizontal depth bands for Pyramid layout.
 * Rendered as an absolute SVG that covers the graph shell, using useViewport()
 * to convert graph→screen coordinates on every frame (no debounce, no lag).
 * Placed BEFORE <ReactFlow> in the DOM so it renders behind nodes.
 */
export function PyramidLabels({ hidden = false }: PyramidLabelsProps) {
  const snapshot = useGraphStore((s) => s.snapshot)
  const userPositions = useGraphStore((s) => s.userPositions)
  const layoutMode = useGraphStore((s) => s.layoutMode)
  const selectedRingKey = useGraphStore((s) => s.selectedRingKey)
  const settings = useSettingsStore()

  // Reactive viewport transform — updates on every pan/zoom frame, no debounce
  const { x: tx, y: ty, zoom } = useViewport()

  const bandData = useMemo(() => {
    if (layoutMode !== 'pyramid' || !snapshot?.entryNodeId) return null
    const positions = getEffectiveGraphPositions(snapshot, userPositions)
    const runtime = layoutRuntimeFromSettings(settings)
    const bands = getPyramidDepthBands(
      snapshot.nodes,
      snapshot.edges,
      snapshot.entryNodeId,
      positions,
      runtime,
      runtime.organizationMethod
    )
    return bands.length > 0 ? bands : null
  }, [snapshot, userPositions, layoutMode, settings])

  if (hidden || !bandData) return null

  return (
    <svg
      className="absolute inset-0 pointer-events-none pyramid-labels-layer"
      style={{ width: '100%', height: '100%', zIndex: 1, overflow: 'visible' }}
      aria-hidden
    >
      {bandData.map((band) => {
        const selected = selectedRingKey === band.key
        const color = depthLevelColor(band.depth)
        const baseColor = depthLevelColorBase(band.depth)
        // Convert graph-space band rect to screen-space
        const sx = band.x * zoom + tx
        const sy = band.y * zoom + ty
        const sw = band.width * zoom
        const sh = band.height * zoom
        const fillColor = color.replace(/[\d.]+\)$/, `${selected ? 0.22 : 0.14})`)
        return (
          <g key={band.key}>
            {/* Band background */}
            <rect
              x={sx}
              y={sy}
              width={sw}
              height={sh}
              rx={Math.max(3, 8 * zoom)}
              fill={fillColor}
              stroke={baseColor}
              strokeWidth={selected ? Math.max(1.2, 1.8 * zoom) : Math.max(0.6, 1.0 * zoom)}
              strokeOpacity={selected ? 0.80 : 0.50}
            />
            {/* Top accent line */}
            <line
              x1={sx + Math.max(6, 12 * zoom)}
              y1={sy}
              x2={sx + sw - Math.max(6, 12 * zoom)}
              y2={sy}
              stroke={baseColor}
              strokeWidth={selected ? Math.max(1.2, 2.0 * zoom) : Math.max(0.8, 1.2 * zoom)}
              strokeOpacity={selected ? 0.90 : 0.60}
            />
          </g>
        )
      })}
    </svg>
  )
}

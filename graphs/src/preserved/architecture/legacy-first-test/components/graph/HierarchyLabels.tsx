import { useMemo } from 'react'
import { useViewport } from '@xyflow/react'
import {
  getHierarchyCenterRadius,
  getHierarchyRingBandsForSnapshot
} from '@core/layout/hierarchy-layout'
import { consolidateHierarchyDepthVisuals } from '@core/layout/hierarchy-depth-visuals'
import { depthLevelColorBase } from '@core/layout/layout-depth-colors'
import { LAYOUT_NODE_BOX } from '@core/layout/layout-constraints'
import { useGraphStore } from '../../state/graph-store'
import { useSettingsStore } from '../../state/settings-store'
import { getEffectiveGraphPositions } from '../../utils/effective-graph-positions'
import { layoutRuntimeFromSettings } from '../../utils/layout-settings'

interface HierarchyLabelsProps {
  hidden?: boolean
}

function annulusPath(cx: number, cy: number, innerR: number, outerR: number): string {
  if (outerR <= innerR + 0.5) return ''
  return [
    `M ${cx + outerR} ${cy}`,
    `A ${outerR} ${outerR} 0 1 0 ${cx - outerR} ${cy}`,
    `A ${outerR} ${outerR} 0 1 0 ${cx + outerR} ${cy}`,
    `M ${cx + innerR} ${cy}`,
    `A ${innerR} ${innerR} 0 1 1 ${cx - innerR} ${cy}`,
    `A ${innerR} ${innerR} 0 1 1 ${cx + innerR} ${cy}`
  ].join(' ')
}

/**
 * Colored concentric ring depth guides for Hierarchy layout.
 * Rendered as an absolute SVG that covers the graph shell, using useViewport()
 * to convert graph→screen coordinates on every frame (no debounce, no lag).
 * Placed BEFORE <ReactFlow> in the DOM so it renders behind nodes.
 */
export function HierarchyLabels({ hidden = false }: HierarchyLabelsProps) {
  const snapshot = useGraphStore((s) => s.snapshot)
  const userPositions = useGraphStore((s) => s.userPositions)
  const layoutMode = useGraphStore((s) => s.layoutMode)
  const selectedRingKey = useGraphStore((s) => s.selectedRingKey)
  const settings = useSettingsStore()

  // Reactive viewport transform — updates on every pan/zoom frame, no debounce
  const { x: tx, y: ty, zoom } = useViewport()

  const ringData = useMemo(() => {
    if (layoutMode !== 'hierarchy' || !snapshot?.entryNodeId) return null
    const positions = getEffectiveGraphPositions(snapshot, userPositions)
    if (!positions[snapshot.entryNodeId]) return null

    const runtime = layoutRuntimeFromSettings(settings)
    const bands = getHierarchyRingBandsForSnapshot(
      snapshot.nodes,
      snapshot.edges,
      snapshot.entryNodeId,
      positions,
      runtime,
      runtime.organizationMethod
    )
    if (bands.length === 0) return null

    const centerRadius = getHierarchyCenterRadius(runtime)
    const depthVisuals = consolidateHierarchyDepthVisuals(bands, centerRadius)
    const entry = positions[snapshot.entryNodeId]
    // Graph-space center of the entry node
    const gcx = (entry?.x ?? 0) + LAYOUT_NODE_BOX.width / 2
    const gcy = (entry?.y ?? 0) + LAYOUT_NODE_BOX.height / 2

    const selectedDepth = bands.find((b) => b.key === selectedRingKey)?.semanticDepth
      ?? (selectedRingKey?.startsWith('h-')
        ? Number.parseInt(selectedRingKey.slice(2), 10)
        : null) ?? null

    return { depthVisuals, gcx, gcy, centerRadius, selectedDepth }
  }, [snapshot, userPositions, layoutMode, settings, selectedRingKey])

  if (hidden || !ringData) return null

  const { depthVisuals, gcx, gcy, centerRadius, selectedDepth } = ringData

  // Convert graph-space center to screen-space for the SVG overlay
  const scx = gcx * zoom + tx
  const scy = gcy * zoom + ty

  return (
    <svg
      className="absolute inset-0 pointer-events-none hierarchy-labels-layer"
      style={{ width: '100%', height: '100%', overflow: 'visible' }}
      aria-hidden
    >
      <defs>
        {depthVisuals.map((depthRing) => {
          const baseColor = depthLevelColorBase(depthRing.depth)
          const sr = depthRing.outerRadius * zoom
          const innerPct = Math.min(
            0.90,
            depthRing.innerRadius / Math.max(1, depthRing.outerRadius)
          )
          const selected = selectedDepth === depthRing.depth
          return (
            <radialGradient
              key={`grad-${depthRing.key}`}
              id={`h-ring-grad-${depthRing.key}`}
              cx={scx}
              cy={scy}
              r={sr}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset={`${innerPct * 100}%`} stopColor={baseColor} stopOpacity={selected ? 0.20 : 0.09} />
              <stop offset={`${(innerPct + (1 - innerPct) * 0.5) * 100}%`} stopColor={baseColor} stopOpacity={selected ? 0.28 : 0.15} />
              <stop offset="100%" stopColor={baseColor} stopOpacity={selected ? 0.40 : 0.22} />
            </radialGradient>
          )
        })}
      </defs>

      {/* Entry/root center — subtle highlight, not a hierarchy depth ring */}
      <circle
        cx={scx}
        cy={scy}
        r={centerRadius * zoom}
        fill="rgba(232,184,74,0.10)"
        stroke="rgba(232,184,74,0.45)"
        strokeWidth={Math.max(0.6, 0.9 * zoom)}
      />

      {depthVisuals.map((depthRing) => {
        const selected = selectedDepth === depthRing.depth
        const sir = depthRing.innerRadius * zoom
        const sor = depthRing.outerRadius * zoom
        const path = annulusPath(scx, scy, sir, sor)
        if (!path) return null
        return (
          <g key={depthRing.key}>
            <path
              d={path}
              fill={`url(#h-ring-grad-${depthRing.key})`}
              fillRule="evenodd"
            />
            {/* Single outer boundary per depth — inner edge is fill gradient only */}
            <circle
              cx={scx}
              cy={scy}
              r={sor}
              fill="none"
              stroke={depthLevelColorBase(depthRing.depth)}
              strokeWidth={selected ? Math.max(1.0, 1.5 * zoom) : Math.max(0.7, 0.9 * zoom)}
              strokeOpacity={selected ? 0.75 : 0.45}
            />
          </g>
        )
      })}
    </svg>
  )
}

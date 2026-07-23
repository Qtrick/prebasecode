import { useMemo } from 'react'
import { useGraphStore } from '../../state/graph-store'
import { useSettingsStore } from '../../state/settings-store'
import { collectArchitectureEdgeLegend } from '../../utils/architecture-edge-legend'
import { collectFileTypes } from '../../utils/file-type-colors'
import { useGraphViewportInsets } from '../graph-shared/useGraphViewportInsets'
import { GraphLegendShell, LegendChip, LegendSectionLabel } from '../graph-shared/GraphLegendShell'
import type { GraphNode } from '../../../../core/types'

const ENTRY_NODE_COLOR = '#e8b84a'

export function ArchitectureGraphLegend({ nodes }: { nodes: GraphNode[] }) {
  const showLegend = useGraphStore((s) => s.showLegend)
  const collapsed = useGraphStore((s) => s.legendCollapsed)
  const setCollapsed = useGraphStore((s) => s.setLegendCollapsed)
  const snapshot = useGraphStore((s) => s.snapshot)
  const dimAmount = useSettingsStore((s) => s.legendInteractionDimAmount)
  const { legendBottomPx, leftPx } = useGraphViewportInsets()

  const fileTypes = useMemo(
    () => collectFileTypes(nodes.filter((n) => n.kind !== 'folder').map((n) => n.path)),
    [nodes]
  )

  const edgeItems = useMemo(() => {
    if (!snapshot) return []
    return collectArchitectureEdgeLegend(snapshot)
  }, [snapshot])

  const hasEntryNode = useMemo(
    () => nodes.some((n) => n.isEntry || n.id === snapshot?.entryNodeId),
    [nodes, snapshot?.entryNodeId]
  )

  if (!showLegend) return null

  const dimOpacity = 1 - dimAmount / 100

  return (
    <div
      className="absolute z-[22] pointer-events-none graph-legend-overlay transition-[opacity,filter] duration-200 ease-out"
      style={{
        left: leftPx,
        bottom: legendBottomPx,
        ['--legend-dim-opacity' as string]: String(dimOpacity)
      }}
    >
      <GraphLegendShell collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)}>
        {(fileTypes.length > 0 || hasEntryNode) && (
          <>
            <LegendSectionLabel>File types</LegendSectionLabel>
            {fileTypes.map((t) => (
              <LegendChip key={t.id} color={t.color} label={t.name} />
            ))}
            {hasEntryNode && <LegendChip color={ENTRY_NODE_COLOR} label="Entry" />}
          </>
        )}
        {edgeItems.length > 0 && (
          <>
            <LegendSectionLabel>Edges</LegendSectionLabel>
            {edgeItems.map((item) => (
              <LegendChip
                key={item.id}
                color={item.color}
                label={item.label}
                dashed={item.dashed}
              />
            ))}
          </>
        )}
      </GraphLegendShell>
    </div>
  )
}

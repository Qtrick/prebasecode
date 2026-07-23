import { useMemo } from 'react'
import { useGraphStore } from '../../state/graph-store'
import { useSettingsStore } from '../../state/settings-store'
import { collectFileTypes } from '../../utils/file-type-colors'
import { getEdgeCategoryDefinition } from '../../utils/edge-categories'
import { buildNetworkModel } from '../../utils/network-model'
import { useGraphViewportInsets } from '../graph-shared/useGraphViewportInsets'
import { GraphLegendShell, LegendChip, LegendSectionLabel } from '../graph-shared/GraphLegendShell'
import type { GraphNode } from '../../../../core/types'

const ENTRY_NODE_COLOR = '#e8b84a'

export function NetworkGraphLegend({ nodes }: { nodes: GraphNode[] }) {
  const showLegend = useGraphStore((s) => s.showLegend)
  const collapsed = useGraphStore((s) => s.networkLegendCollapsed)
  const setCollapsed = useGraphStore((s) => s.setNetworkLegendCollapsed)
  const snapshot = useGraphStore((s) => s.snapshot)
  const filter = useGraphStore((s) => s.filter)
  const graphDepth = useGraphStore((s) => s.graphDepth)
  const layerVisibility = useGraphStore((s) => s.layerVisibility)
  const isolatedLayer = useGraphStore((s) => s.isolatedLayer)
  const hideLowImportance = useGraphStore((s) => s.hideLowImportance)
  const expandedFolderIds = useGraphStore((s) => s.expandedFolderIds)
  const visibleEdgeCategories = useSettingsStore((s) => s.visibleEdgeCategories)
  const visibleRelatedConnections = useSettingsStore((s) => s.visibleRelatedConnections)
  const maxRenderedNodes = useSettingsStore((s) => s.maxRenderedNodes)
  const { legendBottomPx, leftPx } = useGraphViewportInsets()

  const fileTypes = useMemo(
    () => collectFileTypes(nodes.filter((n) => n.kind !== 'folder').map((n) => n.path)),
    [nodes]
  )

  const visibleLegendCategories = useMemo(() => {
    if (!snapshot) return []
    const model = buildNetworkModel(snapshot, {
      searchQuery: '',
      focusedNodeId: null,
      selectedNodeId: null,
      filter,
      graphOrganizationMode: 'dependencies',
      graphDepth,
      layerVisibility,
      isolatedLayer,
      focusNeighborhood: false,
      hideLowImportance,
      userPositions: {},
      dimOnSearch: false,
      expandedFolderIds,
      dragEnabledNodeIds: new Set<string>(),
      showEdgeLabels: false,
      visibleRelatedConnections,
      maxRenderedNodes,
      visibleEdgeCategories
    })
    const used = new Set(model.links.map((l) => l.category))
    return visibleEdgeCategories.filter((id) => used.has(id))
  }, [
    snapshot,
    filter,
    graphDepth,
    layerVisibility,
    isolatedLayer,
    hideLowImportance,
    expandedFolderIds,
    visibleRelatedConnections,
    maxRenderedNodes,
    visibleEdgeCategories
  ])

  const hasEntryNode = useMemo(
    () => nodes.some((n) => n.isEntry || n.id === snapshot?.entryNodeId),
    [nodes, snapshot?.entryNodeId]
  )

  if (!showLegend) return null

  return (
    <div
      className="absolute z-[22] pointer-events-none graph-legend-overlay"
      style={{ left: leftPx, bottom: legendBottomPx }}
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
        {visibleLegendCategories.length > 0 && (
          <>
            <LegendSectionLabel>Visible edges</LegendSectionLabel>
            {visibleLegendCategories.map((id) => {
              const cat = getEdgeCategoryDefinition(id)
              return <LegendChip key={id} color={cat.color} label={cat.shortLabel} />
            })}
          </>
        )}
      </GraphLegendShell>
    </div>
  )
}

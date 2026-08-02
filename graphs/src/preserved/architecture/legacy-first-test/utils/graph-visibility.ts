import type { ArchitectureLayerId } from '../../../core/utils/architecture-layers'
import { computeNodeImportance } from '../../../core/utils/architecture-layers'
import { isLowImportancePath } from '../../../core/graph/graph-completeness'
import type { GraphNode, GraphSnapshot } from '../../../core/types'
import { getNodesWithinDepth } from '../../../core/layout/hierarchy-layout'
import { isNodeHiddenByCollapsedFolders } from './folder-expansion'
import type { GraphOrganizationMode } from '../state/graph-store'
import { isTreeGraphMode } from '../state/graph-store'

export interface VisibilityOptions {
  graphDepth: number
  layerVisibility: Record<ArchitectureLayerId, boolean>
  isolatedLayer: ArchitectureLayerId | null
  focusNeighborhood: boolean
  hideLowImportance: boolean
  focusedNodeId: string | null
  selectedNodeId: string | null
  graphOrganizationMode: GraphOrganizationMode
  expandedFolderIds: Set<string>
  maxRenderedNodes?: number
}

export function getVisibleNodeIds(
  snapshot: GraphSnapshot,
  options: VisibilityOptions
): Set<string> {
  const treeMode = isTreeGraphMode(options.graphOrganizationMode)
  const ids = new Set<string>()

  let depthSet: Set<string> | null = null
  if (snapshot.entryNodeId && options.graphDepth >= 0) {
    depthSet = getNodesWithinDepth(
      snapshot.entryNodeId,
      snapshot.edges,
      options.graphDepth
    )
    depthSet.add(snapshot.entryNodeId)
  }

  const focusId = options.focusNeighborhood
    ? (options.focusedNodeId ?? options.selectedNodeId)
    : null
  const neighborhood = focusId ? getNeighborhood(snapshot, focusId, 2) : null

  const importanceScores = new Map<string, number>()
  if (options.hideLowImportance) {
    for (const n of snapshot.nodes) {
      importanceScores.set(n.id, computeNodeImportance(n.id, snapshot.edges).score)
    }
  }

  const scores = [...importanceScores.values()].sort((a, b) => b - a)
  const threshold = scores[Math.floor(scores.length * 0.35)] ?? 0

  for (const node of snapshot.nodes) {
    if (node.kind === 'folder' && !treeMode) continue

    if (
      node.kind !== 'folder' &&
      isNodeHiddenByCollapsedFolders(
        node,
        snapshot,
        options.expandedFolderIds,
        treeMode
      )
    ) {
      continue
    }

    if (depthSet && node.kind !== 'folder' && !depthSet.has(node.id)) continue

    const layer = (node.meta?.architectureLayer as ArchitectureLayerId) ?? 'other'
    if (node.isEntry || node.id === snapshot.entryNodeId) {
      ids.add(node.id)
      continue
    }

    if (node.kind === 'folder') {
      ids.add(node.id)
      continue
    }

    if (options.hideLowImportance) {
      if (layer === 'tests') continue
      if (layer === 'config' || isLowImportancePath(node.path)) continue
      if (layer === 'utils') {
        const score = importanceScores.get(node.id) ?? 0
        if (score < threshold && node.id !== focusId) continue
      }
    }

    if (options.isolatedLayer) {
      if (layer !== options.isolatedLayer) continue
    } else if (!options.layerVisibility[layer]) {
      continue
    }

    if (neighborhood && !neighborhood.has(node.id)) continue

    ids.add(node.id)
  }

  const maxNodes = options.maxRenderedNodes ?? 0
  if (maxNodes > 0 && ids.size > maxNodes) {
    const ranked = [...ids]
      .map((id) => {
        const node = snapshot.nodes.find((n) => n.id === id)
        if (!node) return { id, score: 0 }
        if (node.isEntry || node.id === snapshot.entryNodeId) return { id, score: 10000 }
        if (node.kind === 'folder') return { id, score: 5000 }
        return {
          id,
          score: computeNodeImportance(id, snapshot.edges).score
        }
      })
      .sort((a, b) => b.score - a.score)

    const capped = new Set<string>()
    for (const { id } of ranked.slice(0, maxNodes)) {
      capped.add(id)
    }
    if (snapshot.entryNodeId) capped.add(snapshot.entryNodeId)
    if (options.focusedNodeId) capped.add(options.focusedNodeId)
    if (options.selectedNodeId) capped.add(options.selectedNodeId)
    return capped
  }

  return ids
}

function getNeighborhood(snapshot: GraphSnapshot, nodeId: string, hops: number): Set<string> {
  const set = new Set<string>([nodeId])
  let frontier = [nodeId]
  for (let h = 0; h < hops; h++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const e of snapshot.edges) {
        if (e.kind !== 'import' && e.kind !== 'dependency') continue
        const other = e.source === id ? e.target : e.target === id ? e.source : null
        if (other && !set.has(other)) {
          set.add(other)
          next.push(other)
        }
      }
    }
    frontier = next
  }
  return set
}

export function getNodeVisualWeight(node: GraphNode, snapshot: GraphSnapshot): number {
  if (node.isEntry || node.id === snapshot.entryNodeId) return 1.15
  const { score } = computeNodeImportance(node.id, snapshot.edges)
  const maxScore = 12
  const normalized = Math.min(score / maxScore, 1)
  const layer = node.meta?.architectureLayer
  if (layer === 'services' || layer === 'api') return 1 + normalized * 0.12
  if (layer === 'utils' || layer === 'config') return 0.92
  return 1 + normalized * 0.06
}

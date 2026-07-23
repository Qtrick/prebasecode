import { create } from 'zustand'
import {
  assignLayersToNodes,
  buildDefaultLayerVisibility,
  type ArchitectureLayerId
} from '../../../core/utils/architecture-layers'
import type { GraphSnapshot, IncrementalUpdate, LayoutMode } from '../../../core/types'
import { toProjectRelativePath } from '../utils/path-utils'
import { useEditorStore } from './editor-store'
import type { ArchitectureMode } from '../utils/architecture-modes'
import {
  DEFAULT_WORKSPACE_MODE,
  isValidViewMode,
  syncPreviewSurfaceVisibility
} from '../utils/workspace-modes'
import { useSettingsStore } from './settings-store'

export type FilterKind = 'all' | 'files' | 'components' | 'imports' | 'folders'
export type ViewMode = 'code' | 'graph' | 'preview' | 'settings'
export type CodeViewMode = 'flat' | 'tree'
export type GraphOrganizationMode = 'dependencies' | 'tree'
export type GraphViewMode = 'tree' | 'network'
export type ExplorerViewMode = 'flat' | 'tree'

interface GraphStore {
  snapshot: GraphSnapshot | null
  isLoading: boolean
  error: string | null
  viewMode: ViewMode
  codeViewMode: CodeViewMode
  graphOrganizationMode: GraphOrganizationMode
  graphViewMode: GraphViewMode
  architectureMode: ArchitectureMode
  explorerViewMode: ExplorerViewMode
  searchQuery: string
  focusedNodeId: string | null
  selectedNodeId: string | null
  selectedEdgeId: string | null
  /** Hierarchy ring guide key (depth-ringIndex-radius). */
  selectedRingKey: string | null
  filter: FilterKind
  layoutMode: LayoutMode
  graphDepth: number
  layerVisibility: Record<ArchitectureLayerId, boolean>
  isolatedLayer: ArchitectureLayerId | null
  focusNeighborhood: boolean
  hideLowImportance: boolean
  secondarySidebarCollapsed: boolean
  showMinimap: boolean
  showLegend: boolean
  legendCollapsed: boolean
  networkLegendCollapsed: boolean
  inspectorOpen: boolean
  activeCodePath: string | null
  /** Line to reveal after opening a file from Problems / search. */
  pendingRevealLine: number | null
  userPositions: Record<string, { x: number; y: number }>
  initialCameraDone: boolean
  expandedFolderIds: Set<string>

  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setSnapshot: (snapshot: GraphSnapshot) => void
  applyIncremental: (update: IncrementalUpdate) => void
  setViewMode: (mode: ViewMode) => void
  setCodeViewMode: (mode: CodeViewMode) => void
  setGraphOrganizationMode: (mode: GraphOrganizationMode) => void
  setGraphViewMode: (mode: GraphViewMode) => void
  setArchitectureMode: (mode: ArchitectureMode) => void
  setExplorerViewMode: (mode: ExplorerViewMode) => void
  selectNodeInGraph: (nodeId: string) => void
  setSearchQuery: (query: string) => void
  setFocusedNodeId: (id: string | null) => void
  setSelectedNodeId: (id: string | null) => void
  setSelectedEdgeId: (id: string | null) => void
  setSelectedRingKey: (key: string | null) => void
  applyLayoutPositions: (
    positions: Record<string, { x: number; y: number }>,
    options?: { resetCamera?: boolean }
  ) => void
  setFilter: (filter: FilterKind) => void
  setLayoutMode: (mode: LayoutMode) => void
  setGraphDepth: (depth: number) => void
  setLayerVisible: (layer: ArchitectureLayerId, visible: boolean) => void
  setAllLayersVisible: (visible: boolean) => void
  setIsolatedLayer: (layer: ArchitectureLayerId | null) => void
  setFocusNeighborhood: (on: boolean) => void
  setHideLowImportance: (on: boolean) => void
  toggleSecondarySidebar: () => void
  setShowMinimap: (show: boolean) => void
  setShowLegend: (show: boolean) => void
  setLegendCollapsed: (collapsed: boolean) => void
  setNetworkLegendCollapsed: (collapsed: boolean) => void
  setInspectorOpen: (open: boolean) => void
  setActiveCodePath: (path: string | null) => void
  consumePendingRevealLine: () => number | null
  openFileInCodeView: (nodeId: string) => void
  /** Open a project-relative path in Code View (runtime source candidates). */
  openPathInCodeView: (relativePath: string, line?: number) => void
  updateUserPosition: (nodeId: string, position: { x: number; y: number }) => void
  setInitialCameraDone: (done: boolean) => void
  toggleFolderExpand: (folderId: string) => void
  reset: () => void
}

const defaultLayerVisibility = buildDefaultLayerVisibility()

const VALID_LAYOUTS: LayoutMode[] = ['hierarchy', 'pyramid', 'scattered']

function sanitizeLayoutMode(mode: LayoutMode): LayoutMode {
  return VALID_LAYOUTS.includes(mode) ? mode : 'hierarchy'
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  snapshot: null,
  isLoading: false,
  error: null,
  viewMode: 'graph',
  codeViewMode: 'tree',
  graphOrganizationMode: 'dependencies',
  graphViewMode: 'tree',
  architectureMode: 'product',
  explorerViewMode: 'tree',
  searchQuery: '',
  focusedNodeId: null,
  selectedNodeId: null,
  selectedEdgeId: null,
  selectedRingKey: null,
  filter: 'all',
  layoutMode: 'hierarchy',
  graphDepth: -1,
  layerVisibility: { ...defaultLayerVisibility },
  isolatedLayer: null,
  focusNeighborhood: false,
  hideLowImportance: false,
  secondarySidebarCollapsed: false,
  showMinimap: true,
  showLegend: true,
  legendCollapsed: false,
  networkLegendCollapsed: false,
  inspectorOpen: false,
  activeCodePath: null,
  pendingRevealLine: null,
  userPositions: {},
  initialCameraDone: false,
  expandedFolderIds: new Set<string>(),

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  setSnapshot: (snapshot) => {
    const withLayers = {
      ...snapshot,
      nodes: assignLayersToNodes(snapshot.nodes, snapshot.entryNodeId)
    }

    set({
      // Root is used for layout/centering only — it is NOT auto-selected.
      // The graph opens in a clean, unselected state with the inspector closed.
      snapshot: withLayers,
      isLoading: false,
      error: null,
      userPositions: withLayers.positions,
      initialCameraDone: false,
      focusedNodeId: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      inspectorOpen: false,
      expandedFolderIds: new Set<string>()
    })
  },

  applyIncremental: (update) => {
    const current = get().snapshot
    if (!current) return

    const nodeMap = new Map(current.nodes.map((n) => [n.id, n]))
    for (const id of update.removedNodeIds) nodeMap.delete(id)
    for (const node of update.updatedNodes) nodeMap.set(node.id, node)
    for (const node of update.addedNodes) nodeMap.set(node.id, node)

    const edgeMap = new Map(current.edges.map((e) => [e.id, e]))
    for (const id of update.removedEdgeIds) edgeMap.delete(id)
    for (const edge of update.addedEdges) edgeMap.set(edge.id, edge)

    const positions = { ...current.positions, ...update.positions }
    for (const id of update.removedNodeIds) delete positions[id]

    const nodes = assignLayersToNodes([...nodeMap.values()], current.entryNodeId)

    set({
      snapshot: {
        ...current,
        nodes,
        edges: [...edgeMap.values()],
        positions,
        scannedAt: Date.now()
      },
      userPositions: { ...get().userPositions, ...update.positions }
    })
  },

  setViewMode: (mode) => {
    const codeBrowserSplitOpen = useSettingsStore.getState().codeBrowserSplitOpen
    if (!isValidViewMode(mode)) {
      if (import.meta.env.DEV) {
        console.warn('[graph-store] invalid viewMode rejected:', mode, '→', DEFAULT_WORKSPACE_MODE)
      }
      syncPreviewSurfaceVisibility(DEFAULT_WORKSPACE_MODE, codeBrowserSplitOpen)
      set({ viewMode: DEFAULT_WORKSPACE_MODE })
      return
    }
    syncPreviewSurfaceVisibility(mode, codeBrowserSplitOpen)
    set({ viewMode: mode })
  },
  setCodeViewMode: (codeViewMode) => set({ codeViewMode }),
  setGraphOrganizationMode: (graphOrganizationMode) => set({ graphOrganizationMode }),
  setGraphViewMode: (graphViewMode) => set({ graphViewMode }),
  setArchitectureMode: (architectureMode) => set({ architectureMode }),
  setExplorerViewMode: (explorerViewMode) => set({ explorerViewMode }),
  selectNodeInGraph: (nodeId) =>
    set({
      selectedNodeId: nodeId,
      focusedNodeId: nodeId,
      selectedEdgeId: null,
      selectedRingKey: null,
      inspectorOpen: false
    }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setFocusedNodeId: (focusedNodeId) => set({ focusedNodeId }),
  setSelectedNodeId: (selectedNodeId) =>
    set({
      selectedNodeId,
      focusedNodeId: selectedNodeId,
      selectedEdgeId: null,
      selectedRingKey: selectedNodeId !== null ? null : get().selectedRingKey,
      inspectorOpen: false
    }),
  setSelectedEdgeId: (selectedEdgeId) =>
    set({ selectedEdgeId, selectedNodeId: null, selectedRingKey: null, inspectorOpen: true }),
  setSelectedRingKey: (selectedRingKey) =>
    set({
      selectedRingKey,
      selectedNodeId: selectedRingKey === null ? get().selectedNodeId : null,
      focusedNodeId: selectedRingKey === null ? get().focusedNodeId : null,
      selectedEdgeId: null,
      inspectorOpen: selectedRingKey !== null
    }),
  applyLayoutPositions: (positions, options) => {
    const current = get().snapshot
    if (!current) return
    set({
      snapshot: { ...current, positions, scannedAt: Date.now() },
      userPositions: positions,
      ...(options?.resetCamera ? { initialCameraDone: false } : {})
    })
  },
  setFilter: (filter) => set({ filter }),
  setLayoutMode: (layoutMode) => set({ layoutMode: sanitizeLayoutMode(layoutMode) }),
  setGraphDepth: (graphDepth) => set({ graphDepth }),
  setLayerVisible: (layer, visible) =>
    set((s) => ({
      layerVisibility: { ...s.layerVisibility, [layer]: visible },
      isolatedLayer: s.isolatedLayer === layer && !visible ? null : s.isolatedLayer
    })),
  setAllLayersVisible: (visible) =>
    set((s) => {
      const layerVisibility = { ...s.layerVisibility }
      for (const key of Object.keys(layerVisibility) as ArchitectureLayerId[]) {
        if (key === 'entry') {
          layerVisibility.entry = true
          continue
        }
        layerVisibility[key] = visible
      }
      return { layerVisibility, isolatedLayer: visible ? s.isolatedLayer : null }
    }),
  setIsolatedLayer: (isolatedLayer) => set({ isolatedLayer }),
  setFocusNeighborhood: (focusNeighborhood) => set({ focusNeighborhood }),
  setHideLowImportance: (hideLowImportance) => set({ hideLowImportance }),
  toggleSecondarySidebar: () =>
    set((s) => ({ secondarySidebarCollapsed: !s.secondarySidebarCollapsed })),
  setShowMinimap: (showMinimap) => set({ showMinimap }),
  setShowLegend: (showLegend) => set({ showLegend }),
  setLegendCollapsed: (legendCollapsed) => set({ legendCollapsed }),
  setNetworkLegendCollapsed: (networkLegendCollapsed) => set({ networkLegendCollapsed }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setActiveCodePath: (activeCodePath) => set({ activeCodePath }),
  consumePendingRevealLine: () => {
    const line = get().pendingRevealLine
    if (line != null) set({ pendingRevealLine: null })
    return line
  },
  openFileInCodeView: (nodeId) => {
    const snap = get().snapshot
    if (!snap) return
    const node = snap.nodes.find((n) => n.id === nodeId)
    if (!node?.path) return
    if (node.kind !== 'file' && node.kind !== 'component') return
    const rel = toProjectRelativePath(snap.projectPath, node.path)
    if (!rel) return
    useEditorStore.getState().openTab(rel)
    get().setViewMode('code')
    set({
      activeCodePath: rel,
      selectedNodeId: nodeId,
      focusedNodeId: nodeId,
      inspectorOpen: true
    })
  },
  openPathInCodeView: (relativePath, line) => {
    const snap = get().snapshot
    if (!snap || !relativePath) return
    const node = snap.nodes.find((n) => {
      if (!n.path) return false
      const rel = toProjectRelativePath(snap.projectPath, n.path)
      return rel === relativePath || n.path === relativePath
    })
    useEditorStore.getState().openTab(relativePath)
    get().setViewMode('code')
    set({
      activeCodePath: relativePath,
      selectedNodeId: node?.id ?? null,
      focusedNodeId: node?.id ?? null,
      inspectorOpen: Boolean(node),
      pendingRevealLine: typeof line === 'number' ? line : null
    })
  },
  updateUserPosition: (nodeId, position) =>
    set((s) => ({
      userPositions: { ...s.userPositions, [nodeId]: position }
    })),
  setInitialCameraDone: (initialCameraDone) => set({ initialCameraDone }),
  toggleFolderExpand: (folderId) =>
    set((s) => {
      const next = new Set(s.expandedFolderIds)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return { expandedFolderIds: next }
    }),
  reset: () => {
    useEditorStore.getState().reset()
    syncPreviewSurfaceVisibility(DEFAULT_WORKSPACE_MODE, false)
    set({
      snapshot: null,
      isLoading: false,
      error: null,
      viewMode: DEFAULT_WORKSPACE_MODE,
      searchQuery: '',
      focusedNodeId: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      inspectorOpen: false,
      activeCodePath: null,
      pendingRevealLine: null,
      userPositions: {},
      initialCameraDone: false,
      expandedFolderIds: new Set(),
      architectureMode: 'product',
      graphOrganizationMode: 'dependencies',
      graphDepth: -1,
      hideLowImportance: false,
      layerVisibility: { ...defaultLayerVisibility },
      isolatedLayer: null,
      focusNeighborhood: false
    })
  }
}))

export function isTreeGraphMode(mode: GraphOrganizationMode): boolean {
  return mode === 'tree'
}

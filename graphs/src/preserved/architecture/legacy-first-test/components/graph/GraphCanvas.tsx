import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pointToRendererPoint } from '@xyflow/system'
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useStoreApi,
  MarkerType,
  type OnNodesChange,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AnimatePresence } from 'framer-motion'
import { ArchitectureNode } from '../nodes/ArchitectureNode'
import { ArchitectureEdge } from '../edges/ArchitectureEdge'
import { ArchitectureGraphLegend } from './GraphLegendBar'
import { ArchitectureOverview } from './ArchitectureOverview'
import { GraphMinimap } from './GraphMinimap'
import { HierarchyLabels } from './HierarchyLabels'
import { PyramidLabels } from './PyramidLabels'
import { GraphItemPopup, type PopupAnchor } from './GraphItemPopup'
import { NodeContextMenu } from './NodeContextMenu'
import { useGraphStore } from '../../state/graph-store'
import { useSettingsStore } from '../../state/settings-store'
import { architectureFitViewOptions } from '../../utils/graph-viewport-fit'
import {
  useGraphViewportInsets,
  magnusOccupiedInset
} from '../../features/graph-shared/useGraphViewportInsets'
import { architectureNodeZIndex, getNeighborhood, getRenderableNodeIds, styleForGraphEdge, toFlowEdges, toFlowNodes, FLOW_ENTRY_HEIGHT, FLOW_NODE_HEIGHT, FLOW_NODE_WIDTH } from '../../utils/flow-adapter'
import { searchHighlightStrength } from '../../utils/graph-search'
import { debugArchRender, debugGraphBounds, debugTilePressure } from '../../utils/graph-debug'
import { useLayoutTransition } from '../../hooks/use-layout-transition'
import { pickLayoutGroupAtPoint } from '../../utils/hierarchy-ring-hit'
import { layoutRuntimeFromSettings } from '../../utils/layout-settings'

const nodeTypes = { architecture: ArchitectureNode }
const edgeTypes = { architecture: ArchitectureEdge }

function InitialViewportController() {
  const { fitView, getNodes } = useReactFlow()
  const snapshot = useGraphStore((s) => s.snapshot)
  const layoutMode = useGraphStore((s) => s.layoutMode)
  const initialCameraDone = useGraphStore((s) => s.initialCameraDone)
  const setInitialCameraDone = useGraphStore((s) => s.setInitialCameraDone)
  const initialZoom = useSettingsStore((s) => s.initialZoom)
  const layoutAnimationDuration = useSettingsStore((s) => s.layoutAnimationDuration)
  const reduceMotion = useSettingsStore((s) => s.reduceMotion)
  const userPositions = useGraphStore((s) => s.userPositions)
  const settings = useSettingsStore()
  const { fitViewBottomPx, rightInset } = useGraphViewportInsets()

  useEffect(() => {
    if (!snapshot || initialCameraDone) return

    const runtime = layoutRuntimeFromSettings(settings)
    const fitOpts = architectureFitViewOptions(
      layoutMode,
      { rightPx: rightInset, bottomPx: fitViewBottomPx },
      initialZoom,
      snapshot,
      runtime,
      userPositions
    )
    const t = setTimeout(() => {
      const nodes = getNodes()
      if (nodes.length === 0) {
        setInitialCameraDone(true)
        return
      }

      const duration =
        reduceMotion || nodes.length > 40 ? 0 : layoutAnimationDuration
      void fitView({
        nodes,
        padding: fitOpts.padding,
        minZoom: fitOpts.minZoom,
        maxZoom: fitOpts.maxZoom,
        duration
      })
      window.setTimeout(() => setInitialCameraDone(true), duration + 160)
    }, 180)

    return () => clearTimeout(t)
  }, [
    snapshot,
    layoutMode,
    initialCameraDone,
    getNodes,
    fitView,
    setInitialCameraDone,
    initialZoom,
    layoutAnimationDuration,
    reduceMotion,
    fitViewBottomPx,
    rightInset,
    userPositions,
    settings
  ])

  return null
}

function LayoutTransitionController({
  shellRef,
  layoutTransitionRef
}: {
  shellRef: React.RefObject<HTMLDivElement | null>
  layoutTransitionRef: React.MutableRefObject<boolean>
}) {
  const snapshot = useGraphStore((s) => s.snapshot)
  const layoutMode = useGraphStore((s) => s.layoutMode)
  const architectureMode = useGraphStore((s) => s.architectureMode)
  const initialCameraDone = useGraphStore((s) => s.initialCameraDone)
  const reduceMotion = useSettingsStore((s) => s.reduceMotion)
  const layoutAnimationDuration = useSettingsStore((s) => s.layoutAnimationDuration)
  const initialZoom = useSettingsStore((s) => s.initialZoom)
  const inspectorOpen = useGraphStore((s) => s.inspectorOpen)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const selectedRingKey = useGraphStore((s) => s.selectedRingKey)
  const inspectorWidth = useSettingsStore((s) => s.inspectorPanelWidth)
  const magnusMode = useSettingsStore((s) => s.magnusMode)
  const magnusPanelState = useSettingsStore((s) => s.magnusPanelState)
  const userPositions = useGraphStore((s) => s.userPositions)
  const settings = useSettingsStore()
  const { fitView, getNodes } = useReactFlow()
  const { fitViewBottomPx } = useGraphViewportInsets()
  const duration = reduceMotion ? 0 : Math.min(layoutAnimationDuration, 520)
  const pendingFitRef = useRef<{ layout: import('@core/types').LayoutMode } | null>(null)
  const prevLayout = useRef(layoutMode)
  const prevMode = useRef(architectureMode)

  useEffect(() => {
    if (!initialCameraDone) return
    if (prevLayout.current === layoutMode && prevMode.current === architectureMode) return
    prevLayout.current = layoutMode
    prevMode.current = architectureMode
    pendingFitRef.current = { layout: layoutMode }
  }, [layoutMode, architectureMode, initialCameraDone])

  const onTransitionEnd = useCallback(() => {
    const pending = pendingFitRef.current
    if (!pending) return
    pendingFitRef.current = null
    const nodes = getNodes()
    if (nodes.length === 0) return
    const inspectorInset =
      inspectorOpen && (selectedNodeId !== null || selectedRingKey !== null) ? inspectorWidth : 0
    const rightInset = Math.max(inspectorInset, magnusOccupiedInset(magnusMode, magnusPanelState))
    const runtime = layoutRuntimeFromSettings(settings)
    const fitOpts = architectureFitViewOptions(
      pending.layout,
      { rightPx: rightInset, bottomPx: fitViewBottomPx },
      initialZoom,
      snapshot,
      runtime,
      userPositions
    )
    void fitView({
      nodes,
      padding: fitOpts.padding,
      minZoom: fitOpts.minZoom,
      maxZoom: fitOpts.maxZoom,
      duration: reduceMotion ? 0 : 420
    })
  }, [
    fitView,
    getNodes,
    initialZoom,
    reduceMotion,
    inspectorOpen,
    selectedNodeId,
    selectedRingKey,
    inspectorWidth,
    magnusMode,
    magnusPanelState,
    snapshot,
    userPositions,
    settings,
    fitViewBottomPx
  ])

  useLayoutTransition(
    snapshot?.positions,
    duration > 0 && initialCameraDone,
    duration,
    shellRef,
    layoutTransitionRef,
    onTransitionEnd
  )

  // When motion is reduced, skip animation but still fit view after layout change.
  useEffect(() => {
    if (!initialCameraDone || duration > 0 || !pendingFitRef.current) return
    const id = requestAnimationFrame(() => onTransitionEnd())
    return () => cancelAnimationFrame(id)
  }, [snapshot?.positions, layoutMode, architectureMode, duration, initialCameraDone, onTransitionEnd])

  return null
}

function FocusCameraController() {
  const { setCenter, getNode, getViewport } = useReactFlow()
  const focusedNodeId = useGraphStore((s) => s.focusedNodeId)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const initialCameraDone = useGraphStore((s) => s.initialCameraDone)
  const prevFocus = useRef<string | null>(null)

  useEffect(() => {
    if (!initialCameraDone) return
    const target = focusedNodeId ?? selectedNodeId
    if (!target || target === prevFocus.current) return
    prevFocus.current = target

    const node = getNode(target)
    if (!node) return
    const h =
      (node.data as { isEntry?: boolean })?.isEntry ? FLOW_ENTRY_HEIGHT : FLOW_NODE_HEIGHT

    const t = setTimeout(() => {
      const { zoom } = getViewport()
      void setCenter(node.position.x + FLOW_NODE_WIDTH / 2, node.position.y + h / 2, {
        zoom,
        duration: 450
      })
    }, 40)
    return () => clearTimeout(t)
  }, [focusedNodeId, selectedNodeId, initialCameraDone, getNode, setCenter, getViewport])

  return null
}

export function GraphCanvas() {
  const snapshot = useGraphStore((s) => s.snapshot)
  const searchQuery = useGraphStore((s) => s.searchQuery)
  const focusedNodeId = useGraphStore((s) => s.focusedNodeId)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const filter = useGraphStore((s) => s.filter)
  const graphOrganizationMode = useGraphStore((s) => s.graphOrganizationMode)
  const architectureMode = useGraphStore((s) => s.architectureMode)
  const graphDepth = useGraphStore((s) => s.graphDepth)
  const layerVisibility = useGraphStore((s) => s.layerVisibility)
  const isolatedLayer = useGraphStore((s) => s.isolatedLayer)
  const focusNeighborhood = useGraphStore((s) => s.focusNeighborhood)
  const hideLowImportance = useGraphStore((s) => s.hideLowImportance)
  const userPositions = useGraphStore((s) => s.userPositions)
  const expandedFolderIds = useGraphStore((s) => s.expandedFolderIds)
  const updateUserPosition = useGraphStore((s) => s.updateUserPosition)
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId)
  const setFocusedNodeId = useGraphStore((s) => s.setFocusedNodeId)
  const setSelectedRingKey = useGraphStore((s) => s.setSelectedRingKey)
  const selectedRingKey = useGraphStore((s) => s.selectedRingKey)
  const storeApi = useStoreApi()
  const toggleFolderExpand = useGraphStore((s) => s.toggleFolderExpand)

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(
    null
  )
  const panSensitivity = useSettingsStore((s) => s.panSensitivity)
  const nodeDragDelayMs = useSettingsStore((s) => s.nodeDragDelayMs)
  const showEdgeLabels = useSettingsStore((s) => s.showEdgeLabels)
  const reduceMotion = useSettingsStore((s) => s.reduceMotion)
  const graphQuality = useSettingsStore((s) => s.graphQuality)
  const edgeSimplificationThreshold = useSettingsStore((s) => s.edgeSimplificationThreshold)
  const visibleRelatedConnections = useSettingsStore((s) => s.visibleRelatedConnections)
  const folderExpansionRadius = useSettingsStore((s) => s.folderExpansionRadius)
  const maxRenderedNodes = useSettingsStore((s) => s.maxRenderedNodes)
  const renderThrottlingMs = useSettingsStore((s) => s.renderThrottlingMs)

  const [popupAnchor, setPopupAnchor] = useState<PopupAnchor | null>(null)
  const [dragReadyNodeId, setDragReadyNodeId] = useState<string | null>(null)
  const [selectionRefresh, setSelectionRefresh] = useState(0)
  const layoutMode = useGraphStore((s) => s.layoutMode)
  const initialCameraDone = useGraphStore((s) => s.initialCameraDone)
  const shellRef = useRef<HTMLDivElement>(null)
  const zoomEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layoutRecalcRef = useRef(0)
  const flowCountsRef = useRef({ nodes: 0, edges: 0 })
  const isZoomingRef = useRef(false)
  const layoutTransitionRef = useRef(false)
  const graphInteractTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current)
    },
    []
  )

  const dimOnSearch = searchQuery.trim().length > 0
  const nodeCount = snapshot?.nodes.length ?? 0
  const hugeProject = nodeCount > 900
  const performanceMode =
    graphQuality === 'performance' || reduceMotion || hugeProject
  const effectiveRenderThrottle =
    hugeProject && renderThrottlingMs < 24 ? 24 : renderThrottlingMs
  const edgeDebugMode =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('edgeDebug') === '1' ||
      window.localStorage.getItem('prebase:edge-debug') === '1')
  const edgeDiagnosticsEnabled =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('edgeDiag') === '1' ||
      window.localStorage.getItem('prebase:edge-diagnostics') === '1')

  const dragEnabledNodeIds = useMemo(() => {
    const ids = new Set<string>()
    if (dragReadyNodeId) ids.add(dragReadyNodeId)
    if (selectedNodeId) ids.add(selectedNodeId)
    return ids
  }, [dragReadyNodeId, selectedNodeId])

  // NOTE: `dragEnabledNodeIds` is intentionally NOT a dependency here. Hover-driven
  // drag-readiness must not regenerate the whole flow model every mouse move (that
  // caused the architecture-graph flicker). `canDrag` is synced separately, in place,
  // by the lightweight effect below.
  const EMPTY_DRAG_IDS = useMemo(() => new Set<string>(), [])

  const flowNodes = useMemo(() => {
    if (!snapshot) return []
    return toFlowNodes(snapshot, {
      searchQuery,
      focusedNodeId: null,
      selectedNodeId: null,
      filter,
      graphOrganizationMode,
      graphDepth,
      layerVisibility,
      isolatedLayer,
      focusNeighborhood,
      hideLowImportance,
      userPositions,
      dimOnSearch,
      expandedFolderIds,
      dragEnabledNodeIds: EMPTY_DRAG_IDS,
      showEdgeLabels,
      reduceAnimations: performanceMode,
      edgeDebugMode,
      visibleRelatedConnections,
      edgeSimplificationThreshold,
      folderExpansionRadius,
      maxRenderedNodes,
      architectureMode
    })
  }, [
    snapshot,
    searchQuery,
    filter,
    graphOrganizationMode,
    architectureMode,
    graphDepth,
    layerVisibility,
    isolatedLayer,
    focusNeighborhood,
    hideLowImportance,
    userPositions,
    dimOnSearch,
    expandedFolderIds,
    EMPTY_DRAG_IDS,
    showEdgeLabels,
    performanceMode,
    edgeDebugMode,
    visibleRelatedConnections,
    edgeSimplificationThreshold,
    folderExpansionRadius,
    maxRenderedNodes
  ])

  const flowOpts = useMemo(
    () => ({
      searchQuery,
      focusedNodeId: null as string | null,
      selectedNodeId: null as string | null,
      filter,
      graphOrganizationMode,
      graphDepth,
      layerVisibility,
      isolatedLayer,
      focusNeighborhood,
      hideLowImportance,
      userPositions,
      expandedFolderIds,
      dragEnabledNodeIds: EMPTY_DRAG_IDS,
      showEdgeLabels,
      reduceAnimations: performanceMode,
      edgeDebugMode,
      visibleRelatedConnections,
      edgeSimplificationThreshold,
      folderExpansionRadius,
      maxRenderedNodes,
      architectureMode,
      layoutMode
    }),
    [
      searchQuery,
      filter,
      graphOrganizationMode,
      architectureMode,
      layoutMode,
      graphDepth,
      layerVisibility,
      isolatedLayer,
      focusNeighborhood,
      hideLowImportance,
      userPositions,
      expandedFolderIds,
      EMPTY_DRAG_IDS,
      showEdgeLabels,
      performanceMode,
      edgeDebugMode,
      visibleRelatedConnections,
      edgeSimplificationThreshold,
      folderExpansionRadius,
      maxRenderedNodes
    ]
  )

  const renderableNodeIds = useMemo(() => {
    if (!snapshot) return new Set<string>()
    return getRenderableNodeIds(snapshot, {
      ...flowOpts,
      dimOnSearch: dimOnSearch
    })
  }, [snapshot, flowOpts, dimOnSearch])

  const flowEdges = useMemo(() => {
    if (!snapshot) return []
    return toFlowEdges(snapshot, { ...flowOpts, selectedEdgeId: null, renderableNodeIds })
  }, [snapshot, flowOpts, renderableNodeIds])

  flowCountsRef.current = { nodes: flowNodes.length, edges: flowEdges.length }

  const graphMaxZoom = useMemo(() => {
    const n = flowNodes.length
    const e = flowEdges.length
    if (n > 200 || e > 400) return 0.88
    if (n > 100 || e > 200) return 0.95
    return 1.15
  }, [flowNodes.length, flowEdges.length])

  useEffect(() => {
    if (!snapshot?.positions) return
    debugGraphBounds(`arch-${layoutMode}`, Object.values(snapshot.positions))
  }, [snapshot?.positions, layoutMode])

  useEffect(() => {
    if (!edgeDiagnosticsEnabled || !snapshot) return
    const totalImports = snapshot.edges.filter((e) => e.kind === 'import').length
    const totalContains = snapshot.edges.filter((e) => e.kind === 'contains').length
    const totalDeps = snapshot.edges.filter((e) => e.kind === 'dependency').length
    console.info('[EdgeDiag] Stage 4 snapshot edges', {
      total: snapshot.edges.length,
      import: totalImports,
      contains: totalContains,
      dependency: totalDeps
    })
    console.info('[EdgeDiag] Stage 5 ReactFlow nodes/edges', {
      nodes: flowNodes.length,
      renderableNodeIds: renderableNodeIds.size,
      edges: flowEdges.length,
      edgeDebugMode
    })
  }, [edgeDiagnosticsEnabled, snapshot, flowNodes.length, renderableNodeIds.size, flowEdges.length, edgeDebugMode])

  useEffect(() => {
    layoutRecalcRef.current++
    debugArchRender('flow-sync', {
      nodes: flowNodes.length,
      edges: flowEdges.length,
      layoutRecalcs: layoutRecalcRef.current
    })
  }, [flowNodes, flowEdges])

  const markGraphInteracting = useCallback(() => {
    const shell = shellRef.current
    if (!shell) return
    shell.classList.add('is-graph-interacting')
    if (graphInteractTimerRef.current) clearTimeout(graphInteractTimerRef.current)
    graphInteractTimerRef.current = setTimeout(() => {
      shell.classList.remove('is-graph-interacting')
    }, 340)
  }, [])

  const markViewportMoving = useCallback(() => {
    const shell = shellRef.current
    if (!shell) return
    isZoomingRef.current = true
    markGraphInteracting()
    if (!shell.classList.contains('is-zooming')) {
      shell.classList.add('is-zooming')
      debugArchRender('zoom-start')
    }
    debugTilePressure('arch-zoom', {
      nodes: flowCountsRef.current.nodes,
      edges: flowCountsRef.current.edges,
      layoutRecalcs: layoutRecalcRef.current
    })
    if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current)
    zoomEndTimerRef.current = setTimeout(() => {
      isZoomingRef.current = false
      shell.classList.remove('is-zooming')
      debugArchRender('zoom-end')
    }, 280)
  }, [markGraphInteracting])

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges)
  // Defer edges only during initial camera fit — never strip them during zoom/pan.
  const renderedEdges = initialCameraDone ? edges : []

  useEffect(() => {
    const apply = () => {
      setNodes(flowNodes)
      setEdges(flowEdges)
    }
    if (effectiveRenderThrottle <= 0) {
      apply()
      return
    }
    const t = setTimeout(apply, effectiveRenderThrottle)
    return () => clearTimeout(t)
  }, [flowNodes, flowEdges, setNodes, setEdges, effectiveRenderThrottle])

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes)
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          updateUserPosition(change.id, change.position)
        }
      }
    },
    [onNodesChange, updateUserPosition]
  )

  const onNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      const kind = (node.data as { kind?: string })?.kind
      if (kind === 'folder') {
        if (selectedNodeId === node.id) {
          toggleFolderExpand(node.id)
          setPopupAnchor(null)
        } else {
          setSelectedNodeId(node.id)
          setFocusedNodeId(node.id)
          setPopupAnchor({ x: event.clientX, y: event.clientY })
        }
        return
      }
      // Deterministic toggle: clicking the selected file again deselects it.
      if (selectedNodeId === node.id) {
        setSelectedNodeId(null)
        setFocusedNodeId(null)
        setPopupAnchor(null)
        return
      }
      setSelectedNodeId(node.id)
      setFocusedNodeId(node.id)
      setSelectedRingKey(null)
      setPopupAnchor({ x: event.clientX, y: event.clientY })
      markGraphInteracting()
    },
    [
      selectedNodeId,
      toggleFolderExpand,
      setSelectedNodeId,
      setFocusedNodeId,
      setSelectedRingKey,
      markGraphInteracting
    ]
  )

  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault()
      setSelectedNodeId(node.id)
      setFocusedNodeId(node.id)
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
    },
    [setSelectedNodeId, setFocusedNodeId]
  )

  const onPaneClick = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      setContextMenu(null)
      setDragReadyNodeId(null)

      if ((layoutMode === 'hierarchy' || layoutMode === 'pyramid') && snapshot?.entryNodeId) {
        const runtime = layoutRuntimeFromSettings(useSettingsStore.getState())
        const { transform, domNode } = storeApi.getState()
        if (domNode) {
          const rect = domNode.getBoundingClientRect()
          const { x: flowX, y: flowY } = pointToRendererPoint(
            { x: event.clientX - rect.left, y: event.clientY - rect.top },
            transform
          )
          const groupKey = pickLayoutGroupAtPoint(
            snapshot,
            runtime,
            layoutMode,
            flowX,
            flowY,
            useGraphStore.getState().userPositions
          )
          if (groupKey) {
            const next = selectedRingKey === groupKey ? null : groupKey
            setSelectedRingKey(next)
            setSelectedNodeId(null)
            setFocusedNodeId(null)
            if (next !== null) {
              setPopupAnchor({ x: event.clientX, y: event.clientY })
            } else {
              setPopupAnchor(null)
            }
            return
          }
        }
      }

      // Clicking empty space clears selection and closes popup
      setSelectedRingKey(null)
      setSelectedNodeId(null)
      setFocusedNodeId(null)
      setPopupAnchor(null)
    },
    [
      snapshot,
      layoutMode,
      selectedRingKey,
      setSelectedNodeId,
      setFocusedNodeId,
      setSelectedRingKey,
      storeApi
    ]
  )

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  const onNodeMouseEnter: NodeMouseHandler = useCallback(
    (_, node) => {
      clearHoverTimer()
      hoverTimerRef.current = setTimeout(() => {
        setDragReadyNodeId(node.id)
      }, nodeDragDelayMs)
    },
    [clearHoverTimer, nodeDragDelayMs]
  )

  const onNodeMouseLeave: NodeMouseHandler = useCallback(
    (_, node) => {
      clearHoverTimer()
      if (node.id === selectedNodeId) return
      hoverTimerRef.current = setTimeout(() => {
        setDragReadyNodeId((current) => (current === node.id ? null : current))
      }, 150)
    },
    [clearHoverTimer, selectedNodeId]
  )

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer])

  useEffect(() => {
    if (!snapshot || isZoomingRef.current || layoutTransitionRef.current) return
    const query = searchQuery.trim()
    const focusId = focusedNodeId ?? selectedNodeId
    const neighborhood =
      focusNeighborhood && focusId ? getNeighborhood(snapshot, focusId, 2) : null
    const selectionNeighbors =
      selectedNodeId && !query ? getNeighborhood(snapshot, selectedNodeId, 1) : null
    const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]))

    setNodes((current) =>
      current.map((n) => {
        const isSelected = n.id === selectedNodeId
        const isFocused = n.id === focusId
        const canDrag = dragEnabledNodeIds.has(n.id)
        const graphNode = nodeById.get(n.id)
        const highlightStrength =
          graphNode && query ? searchHighlightStrength(graphNode, query) : 'none'
        const isConnectedToSelection =
          selectionNeighbors !== null && selectionNeighbors.has(n.id) && !isSelected
        const dimmed = dimOnSearch && query.length > 0 && highlightStrength === 'none'
        const softDimmed =
          !dimmed &&
          ((neighborhood !== null && !neighborhood.has(n.id)) ||
            (selectionNeighbors !== null && !selectionNeighbors.has(n.id) && !isSelected))
        const highlighted = highlightStrength !== 'none' || isConnectedToSelection
        const isEntry = (n.data as { isEntry?: boolean }).isEntry
        const isFolder = (n.data as { isFolder?: boolean }).isFolder
        const zIndex = architectureNodeZIndex(layoutMode, { isEntry, isSelected, isFocused, isFolder })
        const data = n.data as Record<string, unknown>

        if (
          n.selected === isSelected &&
          n.zIndex === zIndex &&
          data.selected === isSelected &&
          data.focused === isFocused &&
          data.canDrag === canDrag &&
          data.dimmed === dimmed &&
          data.softDimmed === softDimmed &&
          data.highlighted === highlighted &&
          data.searchHighlight === highlightStrength
        ) {
          return n
        }

        return {
          ...n,
          selected: isSelected,
          zIndex,
          data: {
            ...n.data,
            selected: isSelected,
            focused: isFocused,
            canDrag,
            dimmed,
            softDimmed,
            highlighted,
            searchHighlight: highlightStrength
          }
        }
      })
    )
  }, [
    snapshot,
    searchQuery,
    dimOnSearch,
    focusNeighborhood,
    selectedNodeId,
    focusedNodeId,
    dragEnabledNodeIds,
    layoutMode,
    setNodes,
    selectionRefresh
  ])

  useEffect(() => {
    if (!snapshot || isZoomingRef.current || layoutTransitionRef.current) return
    const focusId = focusedNodeId ?? selectedNodeId
    const edgeById = new Map(snapshot.edges.map((e) => [e.id, e]))

    setEdges((current) =>
      current.map((edge) => {
        const graphEdge = edgeById.get(edge.id)
        if (!graphEdge) return edge
        const styled = styleForGraphEdge(graphEdge, snapshot, focusId, null, userPositions, layoutMode)
        const data = edge.data as { variant?: string; edgeEmphasis?: string; isHierarchyLayout?: boolean }
        const prev = edge.style ?? {}
        if (
          data.variant === styled.variant &&
          data.edgeEmphasis === styled.edgeEmphasis &&
          edge.zIndex === styled.zIndex &&
          prev.stroke === styled.stroke &&
          Number(prev.strokeWidth) === styled.strokeWidth &&
          Number(prev.opacity) === styled.opacity
        ) {
          return edge
        }
        return {
          ...edge,
          zIndex: styled.zIndex ?? edge.zIndex,
          style: {
            ...prev,
            stroke: styled.stroke,
            strokeWidth: styled.strokeWidth,
            opacity: styled.opacity,
            strokeDasharray: styled.dashed ? '6 4' : undefined
          },
          markerEnd:
            styled.showMarker === false
              ? undefined
              : {
                  type: MarkerType.ArrowClosed,
                  width: 14,
                  height: 14,
                  color: styled.stroke
                },
          data: {
            ...edge.data,
            variant: styled.variant,
            curvature: styled.curvature,
            edgeEmphasis: styled.edgeEmphasis,
            isHierarchyLayout: layoutMode === 'hierarchy'
          }
        }
      })
    )
  }, [snapshot, selectedNodeId, focusedNodeId, userPositions, layoutMode, setEdges, selectionRefresh])

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'architecture' as const,
      style: { stroke: 'rgba(255,255,255,0.42)', strokeWidth: 1.25 },
      markerEnd:
        flowEdges.length > 120
          ? undefined
          : {
              type: MarkerType.ArrowClosed,
              width: 14,
              height: 14,
              color: 'rgba(255,255,255,0.45)'
            }
    }),
    [flowEdges.length]
  )

  if (!snapshot) return null

  if (architectureMode === 'overview') {
    return (
      <div className="relative flex-1 h-full">
        <ArchitectureOverview />
      </div>
    )
  }

  return (
    <div
      ref={shellRef}
      className={`relative flex-1 h-full graph-dot-surface graph-viewport-shell${!initialCameraDone ? ' is-initializing' : ''}`}
    >
      {/* Ring/band guides rendered BEFORE ReactFlow so they paint behind nodes */}
      <HierarchyLabels hidden={!initialCameraDone || layoutMode !== 'hierarchy'} />
      <PyramidLabels hidden={!initialCameraDone || layoutMode !== 'pyramid'} />

      <ReactFlow
        nodes={nodes}
        edges={renderedEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        onMoveStart={markViewportMoving}
        onMove={markViewportMoving}
        onMoveEnd={() => {
          if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current)
          isZoomingRef.current = false
          shellRef.current?.classList.remove('is-zooming')
          setSelectionRefresh((n) => n + 1)
          debugArchRender('zoom-end')
        }}
        edgesReconnectable={false}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={{ x: 0, y: 0, zoom: 0.88 }}
        minZoom={0.2}
        maxZoom={graphMaxZoom}
        proOptions={{ hideAttribution: true }}
        onlyRenderVisibleElements
        elevateNodesOnSelect={false}
        panOnScroll={panSensitivity >= 1}
        zoomOnScroll
        panOnDrag
        noDragClassName="prebase-nodrag"
        selectionOnDrag={false}
        nodesDraggable
        nodeDragThreshold={3}
        edgesFocusable={false}
        autoPanOnNodeDrag={false}
        defaultEdgeOptions={defaultEdgeOptions}
        className="bg-transparent"
      >
        <InitialViewportController />
        <LayoutTransitionController shellRef={shellRef} layoutTransitionRef={layoutTransitionRef} />
        <FocusCameraController />
        <GraphMinimap />
      </ReactFlow>

      <ArchitectureGraphLegend nodes={snapshot.nodes} />

      <GraphItemPopup
        anchor={popupAnchor}
        onClose={() => {
          setPopupAnchor(null)
          setSelectedNodeId(null)
          setSelectedRingKey(null)
          setFocusedNodeId(null)
        }}
      />

      <AnimatePresence>
        {contextMenu && (
          <NodeContextMenu
            key={contextMenu.nodeId}
            x={contextMenu.x}
            y={contextMenu.y}
            nodeId={contextMenu.nodeId}
            onClose={() => setContextMenu(null)}
          />
        )}
      </AnimatePresence>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-full bg-[#141518] border border-border-subtle text-xs text-text-secondary pointer-events-none">
        <span>{flowNodes.length} visible</span>
        <span className="w-px h-3 bg-border-subtle" />
        <span>{flowEdges.filter((e) => (e.data as { variant?: string })?.variant !== 'contains').length} links</span>
      </div>
    </div>
  )
}

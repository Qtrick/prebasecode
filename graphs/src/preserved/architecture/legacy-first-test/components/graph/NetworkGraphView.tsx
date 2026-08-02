import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject
} from 'react-force-graph-2d'
import { useGraphStore } from '../../state/graph-store'
import { useSettingsStore } from '../../state/settings-store'
import { useNetworkControls } from '../../state/network-controls-store'
import { useNetworkOrbit } from '../../hooks/use-network-camera'
import {
  applyGraphRotation3D,
  FOCAL_LENGTH,
  IDENTITY_ORIENTATION,
  type Orientation3D
} from '../../utils/network-rotation'
import { type Point3D } from '../../utils/network-layout'
import { pickNetworkNodeAtScreenPoint } from '../../utils/network-picking'
import { buildNetworkModel, type NetworkLink, type NetworkNode } from '../../utils/network-model'
import type { FlowAdapterOptions } from '../../utils/flow-adapter'
import { GraphZoomControls } from '../../features/graph-shared/GraphZoomControls'
import { useGraphViewportInsets } from '../../features/graph-shared/useGraphViewportInsets'
import { NetworkGraphLegend } from '../../features/network-graph/NetworkGraphLegend'
import { buildPositionedNetworkGraph } from '../../features/network-graph/network-layout-engine'
import {
  applyDepthToRgba,
  depthOpacity,
  getEdgeCategoryColor,
  normalizeDepthScale,
  type GraphEdgeCategory
} from '../../utils/edge-categories'
import { debugNetworkLayout, debugNetworkEdge } from '../../utils/graph-debug'
import { GraphItemPopup, type PopupAnchor } from './GraphItemPopup'

const SELECTED_COLOR = '#2dd4bf'
const SELECTED_GLOW = 'rgba(45,212,191,0.5)'
// Layout computation is synchronous and fast (<1s even for large graphs) — if it
// hasn't resolved within a few seconds, something is genuinely stuck; fail fast
// with a retry option instead of leaving an infinite spinner.
const LAYOUT_SAFETY_MS = 6_000
const HYDRATION_SAFETY_MS = 4_000
// Desaturated whitish for unselected nodes when a selection is active.
const DIM_NODE = 'rgba(208,210,218,0.55)'

type SimNode = NetworkNode & NodeObject
type SimLink = NetworkLink & LinkObject & { category?: GraphEdgeCategory; edgeId?: string }

function resolveId(ref: unknown): string {
  if (typeof ref === 'string') return ref
  return (ref as { id: string }).id
}

/** Force-graph mutates link endpoints to node object refs — always pass fresh string IDs. */
function cloneLinksWithStringIds(links: NetworkLink[]): SimLink[] {
  return links.map((link) => ({
    kind: link.kind,
    source: resolveId(link.source),
    target: resolveId(link.target),
    category: link.category,
    edgeId: link.edgeId
  })) as SimLink[]
}

export function NetworkGraphView() {
  const snapshot = useGraphStore((s) => s.snapshot)
  const filter = useGraphStore((s) => s.filter)
  const graphDepth = useGraphStore((s) => s.graphDepth)
  const layerVisibility = useGraphStore((s) => s.layerVisibility)
  const isolatedLayer = useGraphStore((s) => s.isolatedLayer)
  const hideLowImportance = useGraphStore((s) => s.hideLowImportance)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const expandedFolderIds = useGraphStore((s) => s.expandedFolderIds)
  const selectNodeInGraph = useGraphStore((s) => s.selectNodeInGraph)
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId)
  const setFocusedNodeId = useGraphStore((s) => s.setFocusedNodeId)

  const [networkPopupAnchor, setNetworkPopupAnchor] = useState<PopupAnchor | null>(null)

  const maxRenderedNodes = useSettingsStore((s) => s.maxRenderedNodes)
  const visibleRelatedConnections = useSettingsStore((s) => s.visibleRelatedConnections)
  const reduceMotion = useSettingsStore((s) => s.reduceMotion)
  const nodeDragDelayMs = useSettingsStore((s) => s.nodeDragDelayMs)
  const networkDragDirection = useSettingsStore((s) => s.networkDragDirection)
  const networkIdleAutoRotate = useSettingsStore((s) => s.networkIdleAutoRotate)
  const lodThreshold = useSettingsStore((s) => s.networkLodNodeThreshold)
  const edgeOpacity = useSettingsStore((s) => s.networkEdgeOpacity)
  const visibleEdgeCategories = useSettingsStore((s) => s.visibleEdgeCategories)
  const { rightInset } = useGraphViewportInsets()

  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<ForceGraphMethods<SimNode, SimLink> | undefined>(undefined)
  const [dims, setDims] = useState({ width: 800, height: 600 })
  const controls = useNetworkControls()
  const networkLayoutMode = useNetworkControls((s) => s.layoutMode)
  const networkSpreadScale = useNetworkControls((s) => s.spreadScale)
  const networkLayoutRevision = useNetworkControls((s) => s.layoutRevision)
  const resetViewNonce = useNetworkControls((s) => s.resetViewNonce)
  const [controlsHydrated, setControlsHydrated] = useState(() =>
    useNetworkControls.persist.hasHydrated()
  )
  const [layoutReady, setLayoutReady] = useState(false)
  const [layoutError, setLayoutError] = useState<string | null>(null)
  const [layoutRetryNonce, setLayoutRetryNonce] = useState(0)
  const layoutPassRef = useRef(0)
  const [renderGraphData, setRenderGraphData] = useState<{ nodes: SimNode[]; links: SimLink[] }>({
    nodes: [],
    links: []
  })
  const renderNodesRef = useRef<SimNode[]>([])
  const nodeByIdRef = useRef<Map<string, SimNode>>(new Map())
  const edgeDebugRef = useRef(0)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [liveCanvasRedraw, setLiveCanvasRedraw] = useState(false)
  const liveCanvasRedrawRef = useRef(false)
  liveCanvasRedrawRef.current = liveCanvasRedraw

  const orbit = useNetworkOrbit(reduceMotion, networkIdleAutoRotate)
  const orbitResetRef = useRef(orbit.reset)
  const markOrbitInteractionRef = useRef(orbit.markInteraction)
  const setSelectionPausedRef = useRef(orbit.setSelectionPaused)
  const notifyLayoutReadyRef = useRef(orbit.notifyLayoutReady)
  orbitResetRef.current = orbit.reset
  markOrbitInteractionRef.current = orbit.markInteraction
  setSelectionPausedRef.current = orbit.setSelectionPaused
  notifyLayoutReadyRef.current = orbit.notifyLayoutReady

  // ── Refs that the render loop reads (no per-frame React state) ───────────
  const zoomRef = useRef(1)
  const hoverScaleRef = useRef(1)
  const targetHoverRef = useRef(1)
  const intentRef = useRef<string | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Uniform graph settle offset — keeps edges visually attached (Obsidian-style). */
  const settleRef = useRef({ ox: 0, oy: 0, vx: 0, vy: 0 })
  const SETTLE_MAX = 5.5
  const SETTLE_DECAY = 0.86
  const SETTLE_SPRING = 0.82

  const setAnimating = useCallback((on: boolean) => {
    if (liveCanvasRedrawRef.current === on) return
    liveCanvasRedrawRef.current = on
    setLiveCanvasRedraw(on)
    if (on) fgRef.current?.resumeAnimation()
  }, [])

  // Rotation freeze state — base positions live in 3D sphere space.
  const frozenRef = useRef(false)
  const baseRef = useRef<Map<string, Point3D>>(new Map())
  const depthRef = useRef<Map<string, number>>(new Map())
  const centroidRef = useRef({ x: 0, y: 0 })
  const rotatingRef = useRef(false)
  const wakeRafRef = useRef<() => void>(() => {})
  const layoutRevisionRef = useRef(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setDims({ width: el.clientWidth, height: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The model intentionally does NOT depend on selection/focus. buildNetworkModel
  // does not read them, and rebuilding on selection would discard node positions,
  // reset rotation, and re-fit the camera on every click (graph instability).
  // Selection styling is applied at draw time via selectedRef/neighborRef.
  const model = useMemo(() => {
    if (!snapshot) return { nodes: [], links: [] }
    const opts: FlowAdapterOptions = {
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
    }
    return buildNetworkModel(snapshot, opts)
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

  const neighborIds = useMemo(() => {
    const set = new Set<string>()
    if (!selectedNodeId) return set
    set.add(selectedNodeId)
    for (const link of model.links) {
      const s = resolveId(link.source)
      const t = resolveId(link.target)
      if (s === selectedNodeId) set.add(t)
      if (t === selectedNodeId) set.add(s)
    }
    return set
  }, [selectedNodeId, model.links])
  const neighborRef = useRef(neighborIds)
  neighborRef.current = neighborIds
  const selectedRef = useRef(selectedNodeId)
  selectedRef.current = selectedNodeId
  const hoveredRef = useRef(hoveredNodeId)
  hoveredRef.current = hoveredNodeId

  const nodeCount = renderGraphData.nodes.length
  const sphereRadiusRef = useRef(240)
  const hugeGraph = nodeCount > Math.max(800, lodThreshold)

  const getDisplayedNodePosition = useCallback((nodeId: string) => {
    const node = nodeByIdRef.current.get(nodeId)
    if (!node) return null
    const off = settleRef.current
    return {
      x: (node.x ?? 0) + off.ox,
      y: (node.y ?? 0) + off.oy
    }
  }, [])

  const impulseSettle = useCallback(
    (ax: number, ay: number, az: number, angle: number, boost = 1) => {
      const strength = Math.abs(angle) * 12 * boost
      if (strength < 0.0002) return
      const s = settleRef.current
      s.vx += (ax + az * 0.35) * angle * 180 * boost
      s.vy += (ay + az * 0.35) * angle * 180 * boost
      s.vx = Math.max(-SETTLE_MAX * 1.5, Math.min(SETTLE_MAX * 1.5, s.vx))
      s.vy = Math.max(-SETTLE_MAX * 1.5, Math.min(SETTLE_MAX * 1.5, s.vy))
      setAnimating(true)
      wakeRafRef.current()
    },
    [setAnimating]
  )
  const impulseSettleRef = useRef(impulseSettle)
  impulseSettleRef.current = impulseSettle

  // Pin simulation off — layout comes from the 3D sphere, not 2D force physics.
  useEffect(() => {
    const g = fgRef.current
    if (!g) return
    g.d3Force('charge')?.strength(0)
    g.d3Force('link')?.strength(0)
    g.d3Force('center')?.strength(0)
  }, [model])

  const applyNetworkLayout = useCallback(() => {
    const pass = ++layoutPassRef.current
    const startedAt = performance.now()
    const controlsState = useNetworkControls.getState()
    const projectPath = useGraphStore.getState().snapshot?.projectPath
    const edgeOpacitySetting = useSettingsStore.getState().networkEdgeOpacity
    const layoutModes = ['organic', 'sphere', 'constellation', 'clustered', 'radial'] as const
    const layoutRegistered = layoutModes.includes(controlsState.layoutMode)

    if (!model.nodes.length) {
      setRenderGraphData({ nodes: [], links: [] })
      renderNodesRef.current = []
      nodeByIdRef.current = new Map()
      setLayoutReady(false)
      setLayoutError(null)
      debugNetworkLayout({
        pass,
        phase: 'empty-model',
        projectPath,
        nodeCount: 0,
        edgeCount: 0,
        layoutMode: controlsState.layoutMode,
        layoutRegistered,
        spreadScale: controlsState.spreadScale,
        nodeScale: controlsState.nodeScale,
        linkWidth: controlsState.linkWidth,
        edgeOpacity: edgeOpacitySetting,
        loadingCleared: false
      })
      return
    }

    try {
      layoutRevisionRef.current = controlsState.layoutRevision
      const result = buildPositionedNetworkGraph(model.nodes, model.links)
      if (pass !== layoutPassRef.current) return

      sphereRadiusRef.current = result.sphereRadius
      baseRef.current = result.layout
      centroidRef.current = { x: 0, y: 0 }
      frozenRef.current = true

      const depths = depthRef.current
      depths.clear()
      for (const nd of result.nodes) {
        const base = result.layout.get(nd.id)
        if (!base) continue
        const projected = applyGraphRotation3D(base, 0, 0, IDENTITY_ORIENTATION)
        depths.set(nd.id, projected.depthScale)
      }

      const simNodes = result.nodes as SimNode[]
      renderNodesRef.current = simNodes
      const byId = new Map<string, SimNode>()
      for (const node of simNodes) byId.set(node.id, node)
      nodeByIdRef.current = byId
      setRenderGraphData({ nodes: simNodes, links: cloneLinksWithStringIds(model.links) })
      setLayoutReady(true)
      setLayoutError(null)
      setAnimating(true)
      notifyLayoutReadyRef.current()
      wakeRafRef.current()
      fgRef.current?.resumeAnimation()

      debugNetworkLayout({
        pass,
        phase: 'success',
        projectPath,
        durationMs: Math.round(performance.now() - startedAt),
        nodeCount: model.nodes.length,
        edgeCount: model.links.length,
        layoutMode: result.layoutMode,
        layoutRegistered,
        spreadScale: result.spreadScale,
        nodeScale: controlsState.nodeScale,
        linkWidth: controlsState.linkWidth,
        edgeOpacity: edgeOpacitySetting,
        usedFallback: result.usedFallback,
        renderedNodeCount: simNodes.length,
        loadingCleared: true
      })
    } catch (error) {
      if (pass !== layoutPassRef.current) return
      const message = error instanceof Error ? error.message : 'Network layout failed'
      setLayoutReady(false)
      setLayoutError(message)
      debugNetworkLayout({
        pass,
        phase: 'error',
        projectPath,
        durationMs: Math.round(performance.now() - startedAt),
        nodeCount: model.nodes.length,
        edgeCount: model.links.length,
        layoutMode: controlsState.layoutMode,
        layoutRegistered,
        spreadScale: controlsState.spreadScale,
        nodeScale: controlsState.nodeScale,
        linkWidth: controlsState.linkWidth,
        edgeOpacity: edgeOpacitySetting,
        error: message,
        loadingCleared: false
      })
      if (import.meta.env.DEV) {
        console.error('[NetworkGraphView] layout generation failed', error)
      }
    }
  }, [model.nodes, model.links, setAnimating])

  const applyNetworkLayoutRef = useRef(applyNetworkLayout)
  applyNetworkLayoutRef.current = applyNetworkLayout

  const fitView = useCallback(
    (durationMs = 400) => {
      const g = fgRef.current
      if (!g) return
      const bbox = g.getGraphBbox()
      if (!bbox) {
        g.zoomToFit(durationMs, 60)
        return
      }
      const w = Math.max(1, bbox.x[1] - bbox.x[0])
      const h = Math.max(1, bbox.y[1] - bbox.y[0])
      const pad = 72
      const usableW = Math.max(200, dims.width - rightInset - pad * 2)
      const usableH = Math.max(200, dims.height - pad * 2)
      const z = Math.max(0.6, Math.min(1.4, Math.min(usableW / w, usableH / h)))
      const cx = (bbox.x[0] + bbox.x[1]) / 2
      const cy = (bbox.y[0] + bbox.y[1]) / 2
      // Shift camera so bbox center sits in the middle of the visible canvas (excluding inspector).
      const panBias = rightInset / (2 * Math.max(z, 0.01))
      g.centerAt(cx + panBias, cy, durationMs)
      g.zoom(z, durationMs)
    },
    [dims.width, dims.height, rightInset]
  )
  const fitViewRef = useRef(fitView)
  fitViewRef.current = fitView

  useEffect(() => {
    const unsubFinish = useNetworkControls.persist.onFinishHydration(() => {
      setControlsHydrated(true)
    })
    setControlsHydrated(useNetworkControls.persist.hasHydrated())
    return unsubFinish
  }, [])

  // Defensive: if persisted-store hydration itself never resolves (e.g. storage
  // access throws in a sandboxed/first-run environment), don't let the graph stay
  // stuck on "Preparing network layout..." forever — fall back to in-memory defaults.
  useEffect(() => {
    if (controlsHydrated) return
    const t = window.setTimeout(() => {
      if (controlsHydrated) return
      if (import.meta.env.DEV) {
        console.warn(
          '[NetworkGraphView] network-controls store hydration timed out; proceeding with defaults'
        )
      }
      setControlsHydrated(true)
    }, HYDRATION_SAFETY_MS)
    return () => window.clearTimeout(t)
  }, [controlsHydrated])

  // Re-seed 3D layout when settings or graph data change (after persisted controls load).
  useEffect(() => {
    if (!controlsHydrated) return

    setLayoutError(null)
    edgeDebugRef.current = 0
    settleRef.current = { ox: 0, oy: 0, vx: 0, vy: 0 }
    frozenRef.current = false
    baseRef.current = new Map()
    depthRef.current = new Map()
    orbitResetRef.current()
    applyNetworkLayoutRef.current()
  }, [
    model,
    networkLayoutMode,
    networkSpreadScale,
    networkLayoutRevision,
    controlsHydrated,
    visibleRelatedConnections,
    layoutRetryNonce
  ])

  useEffect(() => {
    if (!controlsHydrated || layoutReady || layoutError) return
    const timeout = window.setTimeout(() => {
      if (layoutReady || layoutError) return
      const message = 'Network layout is taking longer than expected.'
      setLayoutError(message)
      debugNetworkLayout({
        phase: 'safety-timeout',
        nodeCount: model.nodes.length,
        edgeCount: model.links.length,
        layoutMode: networkLayoutMode,
        spreadScale: networkSpreadScale,
        loadingCleared: false
      })
    }, LAYOUT_SAFETY_MS)
    return () => window.clearTimeout(timeout)
  }, [
    controlsHydrated,
    layoutReady,
    layoutError,
    model.nodes.length,
    model.links.length,
    networkLayoutMode,
    networkSpreadScale,
    layoutRetryNonce
  ])

  useEffect(() => {
    setSelectionPausedRef.current(!!selectedNodeId)
  }, [selectedNodeId])

  useEffect(() => {
    if (layoutReady && frozenRef.current) {
      notifyLayoutReadyRef.current()
      wakeRafRef.current()
    }
  }, [layoutReady])

  useEffect(() => {
    if (!layoutReady || !model.nodes.length) return
    const t = setTimeout(() => fitViewRef.current(), 80)
    return () => clearTimeout(t)
  }, [layoutReady, model.nodes.length])

  // Re-center whenever the Magnus panel opens/closes/changes mode so the graph
  // never sits hidden behind it — Magnus is an overlay, not a flex sibling, so
  // the canvas dimensions don't change on their own.
  useEffect(() => {
    if (!layoutReady) return
    const t = setTimeout(() => fitViewRef.current(320), 60)
    return () => clearTimeout(t)
  }, [rightInset, layoutReady])

  // Explicit "Reset view" request from the sidebar → re-fit camera + rotation.
  useEffect(() => {
    if (resetViewNonce === 0) return
    markOrbitInteractionRef.current()
    orbit.reset()
    applyNetworkLayoutRef.current()
    applyRotationRef.current(IDENTITY_ORIENTATION)
    fitViewRef.current(400)
  }, [resetViewNonce, orbit])

  // Pause/resume simulation with tab visibility (CPU/GPU savings).
  useEffect(() => {
    const onVis = () => {
      const g = fgRef.current
      if (!g) return
      if (document.hidden) g.pauseAnimation()
      else g.resumeAnimation()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Attach orbit pointer handlers to the graph container (not the canvas — the
  // canvas may not exist on first paint and force-graph owns canvas events).
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    return orbit.attach(root)
  }, [orbit, dims.width, dims.height])

  const applyRotation = useCallback((orientation: Orientation3D) => {
    if (!frozenRef.current) return
    const { x: cx, y: cy } = centroidRef.current
    const depths = depthRef.current
    for (const nd of renderNodesRef.current) {
      const base = baseRef.current.get(nd.id)
      if (!base) continue
      const projected = applyGraphRotation3D(base, cx, cy, orientation)
      nd.x = projected.x
      nd.y = projected.y
      nd.fx = projected.x
      nd.fy = projected.y
      depths.set(nd.id, projected.depthScale)
    }
    fgRef.current?.resumeAnimation()
  }, [])

  const applyRotationRef = useRef(applyRotation)
  applyRotationRef.current = applyRotation

  const hitRadiusFor = useCallback(
    (node: SimNode) => Math.max(18, Math.sqrt(node.val) * controls.nodeScale * 3.2 + 10),
    [controls.nodeScale]
  )

  const pickNodeIdAt = useCallback(
    (clientX: number, clientY: number): string | null => {
      const g = fgRef.current
      const root = containerRef.current
      if (!g || !root) return null
      const rect = root.getBoundingClientRect()
      return pickNetworkNodeAtScreenPoint({
        clientX,
        clientY,
        containerRect: rect,
        screen2GraphCoords: (x, y) => g.screen2GraphCoords(x, y),
        nodes: renderNodesRef.current,
        settleOffset: { x: settleRef.current.ox, y: settleRef.current.oy },
        hitRadiusFor,
        depthFor: (id) => depthRef.current.get(id) ?? 0
      })
    },
    [hitRadiusFor]
  )
  const pickNodeIdAtRef = useRef(pickNodeIdAt)
  pickNodeIdAtRef.current = pickNodeIdAt

  const handleNetworkTap = useCallback(
    (clientX: number, clientY: number) => {
      markOrbitInteractionRef.current()
      const nodeId = pickNodeIdAtRef.current(clientX, clientY)
      if (nodeId) {
        if (selectedRef.current === nodeId) {
          setSelectedNodeId(null)
          setFocusedNodeId(null)
          setNetworkPopupAnchor(null)
        } else {
          selectNodeInGraph(nodeId)
          setNetworkPopupAnchor({ x: clientX, y: clientY })
        }
      } else {
        setSelectedNodeId(null)
        setFocusedNodeId(null)
        setNetworkPopupAnchor(null)
      }
      setAnimating(true)
      wakeRafRef.current()
    },
    [selectNodeInGraph, setSelectedNodeId, setFocusedNodeId, setAnimating]
  )
  const handleNetworkTapRef = useRef(handleNetworkTap)
  handleNetworkTapRef.current = handleNetworkTap

  useEffect(() => {
    orbit.setAttachOptions({
      onArm: () => {
        setAnimating(true)
        wakeRafRef.current()
      },
      onDragStart: () => {
        rotatingRef.current = true
        markOrbitInteractionRef.current()
        setAnimating(true)
        wakeRafRef.current()
      },
      onRotate: (orientation) => applyRotationRef.current(orientation),
      onDragEnd: (lastAngular) => {
        rotatingRef.current = false
        impulseSettleRef.current(
          lastAngular.ax,
          lastAngular.ay,
          lastAngular.az,
          lastAngular.angle,
          1.1
        )
      },
      onTap: (x, y) => handleNetworkTapRef.current(x, y),
      dragDirection: networkDragDirection
    })
  }, [orbit, networkDragDirection, setAnimating])

  // RAF: post-release momentum + hover scale only. Drag rotation is synchronous
  // on pointermove so it tracks the cursor in real time without teleporting.
  // Stops when idle to avoid burning CPU/GPU after prolonged inactivity.
  useEffect(() => {
    let raf = 0
    let lastTs = performance.now()
    const loop = (ts: number) => {
      const deltaSec = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000))
      lastTs = ts

      let needsRedraw = false
      const dragging = orbit.isDragging()

      if (!dragging) {
        const step = orbit.step(deltaSec)
        if (step.moving) needsRedraw = true
      } else {
        needsRedraw = true
      }

      let settling = false
      const s = settleRef.current
      s.ox += s.vx * 0.016
      s.oy += s.vy * 0.016
      s.vx *= SETTLE_DECAY
      s.vy *= SETTLE_DECAY
      s.ox *= SETTLE_SPRING
      s.oy *= SETTLE_SPRING
      if (Math.abs(s.vx) > 0.01 || Math.abs(s.vy) > 0.01 || Math.abs(s.ox) > 0.04) {
        settling = true
      } else {
        s.ox = 0
        s.oy = 0
        s.vx = 0
        s.vy = 0
      }
      s.ox = Math.max(-SETTLE_MAX, Math.min(SETTLE_MAX, s.ox))
      s.oy = Math.max(-SETTLE_MAX, Math.min(SETTLE_MAX, s.oy))

      if (settling) needsRedraw = true

      const target = targetHoverRef.current
      const cur = hoverScaleRef.current
      const hoverAnimating = Math.abs(cur - target) > 0.002
      if (hoverAnimating) {
        hoverScaleRef.current = cur + (target - cur) * 0.2
        needsRedraw = true
      } else if (cur !== target) {
        hoverScaleRef.current = target
        needsRedraw = true
      }

      if (needsRedraw) {
        setAnimating(true)
      } else if (!dragging && !rotatingRef.current) {
        setAnimating(false)
      }

      const active =
        needsRedraw ||
        dragging ||
        settling ||
        hoverAnimating ||
        rotatingRef.current ||
        (networkIdleAutoRotate && !reduceMotion && layoutReady && frozenRef.current)

      if (active) {
        raf = requestAnimationFrame(loop)
      } else {
        raf = 0
      }
    }

    wakeRafRef.current = () => {
      if (!raf) raf = requestAnimationFrame(loop)
    }

    if (layoutReady && networkIdleAutoRotate && !reduceMotion) {
      wakeRafRef.current()
    }

    return () => {
      wakeRafRef.current = () => {}
      if (raf) cancelAnimationFrame(raf)
    }
  }, [orbit, setAnimating, networkIdleAutoRotate, reduceMotion, layoutReady])

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  const onNodeHover = useCallback(
    (nodeId: string | null) => {
      setHoveredNodeId(nodeId)
      clearHoverTimer()
      if (!nodeId) {
        intentRef.current = null
        targetHoverRef.current = 1
        wakeRafRef.current()
        return
      }
      targetHoverRef.current = 1.08
      wakeRafRef.current()
      hoverTimerRef.current = setTimeout(() => {
        intentRef.current = nodeId
      }, nodeDragDelayMs)
    },
    [clearHoverTimer, nodeDragDelayMs]
  )
  const onNodeHoverRef = useRef(onNodeHover)
  onNodeHoverRef.current = onNodeHover

  // Unified hover picking — same pipeline as click (pointermove on container).
  useEffect(() => {
    const root = containerRef.current
    if (!root || !layoutReady || !controlsHydrated || layoutError) return

    const onPointerMove = (e: PointerEvent) => {
      if (orbit.isDragging()) return
      const nodeId = pickNodeIdAtRef.current(e.clientX, e.clientY)
      if (nodeId !== hoveredRef.current) {
        onNodeHoverRef.current(nodeId)
      }
    }

    const onPointerLeave = () => {
      onNodeHoverRef.current(null)
    }

    root.addEventListener('pointermove', onPointerMove)
    root.addEventListener('pointerleave', onPointerLeave)
    return () => {
      root.removeEventListener('pointermove', onPointerMove)
      root.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [orbit, layoutReady, controlsHydrated, layoutError])

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer])

  const nodeCanvasObject = useCallback(
    (node: SimNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const pos = getDisplayedNodePosition(node.id)
      if (!pos) return
      const x = pos.x
      const y = pos.y
      const depthScale = depthRef.current.get(node.id) ?? FOCAL_LENGTH / (FOCAL_LENGTH + 0)
      const sel = selectedRef.current
      const isSelected = node.id === sel
      const isHovered = node.id === hoveredRef.current
      const dimmed = sel !== null && !neighborRef.current.has(node.id) && !isSelected

      let scaleMul = Math.max(0.82, Math.min(1.14, 0.86 + normalizeDepthScale(depthScale) * 0.28))
      if (isHovered) scaleMul = Math.max(scaleMul, hoverScaleRef.current)
      if (isSelected) scaleMul = Math.max(scaleMul, 1.12)

      const r = (Math.sqrt(node.val) * controls.nodeScale * 1.7 + 1.6) * scaleMul
      const depthAlpha = depthOpacity(0.35, 1, depthScale)

      ctx.beginPath()
      ctx.arc(x, y, r, 0, 2 * Math.PI)
      ctx.fillStyle = isSelected ? SELECTED_COLOR : dimmed ? DIM_NODE : node.color
      ctx.globalAlpha = isSelected ? 1 : depthAlpha
      ctx.fill()
      ctx.globalAlpha = 1

      if (isSelected) {
        ctx.beginPath()
        ctx.arc(x, y, r + 2.5 / globalScale, 0, 2 * Math.PI)
        ctx.strokeStyle = SELECTED_GLOW
        ctx.lineWidth = 2.4 / globalScale
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(x, y, r + 4.5 / globalScale, 0, 2 * Math.PI)
        ctx.strokeStyle = 'rgba(94,234,212,0.3)'
        ctx.lineWidth = 1 / globalScale
        ctx.stroke()
      } else if (isHovered) {
        ctx.beginPath()
        ctx.arc(x, y, r + 1.8 / globalScale, 0, 2 * Math.PI)
        ctx.strokeStyle = 'rgba(94,234,212,0.45)'
        ctx.lineWidth = 1.2 / globalScale
        ctx.stroke()
      }

      if (isHovered) {
        const fontSize = Math.max(9, 10 / globalScale)
        ctx.font = `${fontSize}px system-ui, sans-serif`
        ctx.fillStyle = 'rgba(205,205,215,0.95)'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(node.label, x + r + 3, y)
      }
    },
    [controls.nodeScale, getDisplayedNodePosition]
  )

  const nodePointerAreaPaint = useCallback(
    (node: SimNode, color: string, ctx: CanvasRenderingContext2D) => {
      const pos = getDisplayedNodePosition(node.id)
      if (!pos) return
      const r = hitRadiusFor(node)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, r, 0, 2 * Math.PI)
      ctx.fill()
    },
    [hitRadiusFor, getDisplayedNodePosition]
  )

  const linkDepthAlpha = useCallback((srcId: string, tgtId: string) => {
    const srcDepth = depthRef.current.get(srcId) ?? 0.95
    const tgtDepth = depthRef.current.get(tgtId) ?? 0.95
    const avg = (srcDepth + tgtDepth) / 2
    return normalizeDepthScale(avg)
  }, [])

  const linkColor = useCallback(
    (l: SimLink) => {
      const s = resolveId(l.source)
      const t = resolveId(l.target)
      const depthT = linkDepthAlpha(s, t)
      const avgDepth =
        ((depthRef.current.get(s) ?? 0.95) + (depthRef.current.get(t) ?? 0.95)) / 2
      const category = l.category ?? 'import'
      const base = getEdgeCategoryColor(category)
      const sel = selectedRef.current
      if (!sel) {
        const tinted = applyDepthToRgba(base, avgDepth, 0.22)
        const m = tinted.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/)
        if (!m) return tinted
        const alpha = Math.min(0.72, Number(m[4]) * edgeOpacity * (0.55 + depthT * 0.45))
        return `rgba(${m[1]},${m[2]},${m[3]},${alpha.toFixed(3)})`
      }
      const connected = s === sel || t === sel
      if (connected) {
        const boost = applyDepthToRgba('rgba(94,234,212,0.85)', avgDepth, 0.35)
        return boost
      }
      const dim = applyDepthToRgba(base, avgDepth, 0.12)
      const m = dim.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/)
      if (!m) return dim
      return `rgba(${m[1]},${m[2]},${m[3]},${(Number(m[4]) * 0.45).toFixed(3)})`
    },
    [edgeOpacity, linkDepthAlpha]
  )

  const linkWidth = useCallback(
    (l: SimLink) => {
      const base = controls.linkWidth * 1.2
      const s = resolveId(l.source)
      const t = resolveId(l.target)
      const depthA = linkDepthAlpha(s, t)
      const scaled = base * (0.65 + depthA * 0.55)
      const sel = selectedRef.current
      if (!sel) return scaled
      return s === sel || t === sel ? scaled * 1.55 : scaled * 0.65
    },
    [controls.linkWidth, linkDepthAlpha]
  )

  const linkCanvasObject = useCallback(
    (link: SimLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const srcId = resolveId(link.source)
      const tgtId = resolveId(link.target)
      const srcPos = getDisplayedNodePosition(srcId)
      const tgtPos = getDisplayedNodePosition(tgtId)
      if (!srcPos || !tgtPos) return

      if (import.meta.env.DEV && edgeDebugRef.current < 3) {
        edgeDebugRef.current++
        const srcNode = nodeByIdRef.current.get(srcId)
        const tgtNode = nodeByIdRef.current.get(tgtId)
        debugNetworkEdge({
          srcId,
          tgtId,
          sourceBase: srcNode ? { x: srcNode.x, y: srcNode.y } : null,
          targetBase: tgtNode ? { x: tgtNode.x, y: tgtNode.y } : null,
          sourceDisplay: srcPos,
          targetDisplay: tgtPos,
          zoom: zoomRef.current,
          layoutMode: useNetworkControls.getState().layoutMode
        })
      }

      ctx.beginPath()
      ctx.moveTo(srcPos.x, srcPos.y)
      ctx.lineTo(tgtPos.x, tgtPos.y)
      ctx.strokeStyle = linkColor(link)
      ctx.lineWidth = linkWidth(link) / globalScale
      ctx.stroke()
    },
    [getDisplayedNodePosition, linkColor, linkWidth]
  )

  useEffect(() => {
    setLiveCanvasRedraw(true)
    fgRef.current?.resumeAnimation()
    const t = setTimeout(() => setLiveCanvasRedraw(false), 120)
    return () => clearTimeout(t)
  }, [selectedNodeId, hoveredNodeId])

  if (!snapshot) return null

  const graphReady = controlsHydrated && layoutReady && !layoutError
  // Distinct from a stuck/failed layout: filters legitimately produced zero nodes.
  // Without this, the loading spinner would spin forever since layoutReady can
  // never become true for an empty model.
  const isEmptyGraph = controlsHydrated && !layoutError && model.nodes.length === 0

  return (
    <div ref={containerRef} className="relative flex-1 h-full overflow-hidden bg-[#0d0e10]">
      {!graphReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0d0e10] text-text-muted text-sm z-10 px-6 text-center">
          {layoutError ? (
            <>
              <p className="text-text-secondary">{layoutError}</p>
              <button
                type="button"
                onClick={() => {
                  setLayoutError(null)
                  setLayoutRetryNonce((n) => n + 1)
                }}
                className="px-3 py-1.5 rounded-md text-xs font-medium border border-border-subtle bg-surface-overlay text-text-secondary hover:text-text-primary hover:border-border-default transition-colors"
              >
                Retry layout
              </button>
            </>
          ) : isEmptyGraph ? (
            <p className="text-text-secondary">
              No files match the current filters — adjust filters in the sidebar to see the
              network view.
            </p>
          ) : (
            <>
              <div className="w-5 h-5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
              <p>Preparing network layout…</p>
            </>
          )}
        </div>
      )}
      <ForceGraph2D
        ref={fgRef}
        width={dims.width}
        height={dims.height}
        graphData={renderGraphData}
        backgroundColor="rgba(13,14,16,0)"
        enableNodeDrag={false}
        enablePanInteraction={false}
        enableZoomInteraction
        autoPauseRedraw={!liveCanvasRedraw}
        nodeRelSize={1}
        nodeVal={(n: SimNode) => n.val}
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => 'replace'}
        nodePointerAreaPaint={nodePointerAreaPaint}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkCanvasObject={linkCanvasObject}
        linkCanvasObjectMode={() => 'replace'}
        linkDirectionalArrowLength={controls.showArrows ? 4 : 0}
        linkDirectionalArrowRelPos={1}
        linkDirectionalParticles={0}
        linkHoverPrecision={0}
        warmupTicks={0}
        cooldownTicks={0}
        cooldownTime={0}
        d3AlphaDecay={1}
        d3VelocityDecay={1}
        onZoom={(transform) => {
          zoomRef.current = transform.k
          markOrbitInteractionRef.current()
          setAnimating(true)
          wakeRafRef.current()
        }}
      />

      {graphReady && (
        <GraphZoomControls
          onZoomIn={() => {
            markOrbitInteractionRef.current()
            const g = fgRef.current
            if (!g) return
            const k = g.zoom()
            g.zoom(k * 1.25, 200)
            setAnimating(true)
          }}
          onZoomOut={() => {
            markOrbitInteractionRef.current()
            const g = fgRef.current
            if (!g) return
            const k = g.zoom()
            g.zoom(k / 1.25, 200)
            setAnimating(true)
          }}
          onFitView={() => {
            markOrbitInteractionRef.current()
            fitViewRef.current(400)
          }}
          onResetView={() => useNetworkControls.getState().requestResetView()}
        />
      )}

      <NetworkGraphLegend nodes={snapshot.nodes} />
      <GraphItemPopup
        anchor={networkPopupAnchor}
        onClose={() => {
          setNetworkPopupAnchor(null)
          setSelectedNodeId(null)
          setFocusedNodeId(null)
        }}
      />
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-full bg-[#141518] border border-border-subtle text-xs text-text-secondary pointer-events-none max-w-[90vw] flex-wrap justify-center">
        <span>{nodeCount} nodes</span>
        <span className="w-px h-3 bg-border-subtle" />
        <span>{renderGraphData.links.length} links</span>
        {hugeGraph && (
          <>
            <span className="w-px h-3 bg-border-subtle" />
            <span className="text-amber-400/90">performance mode</span>
          </>
        )}
        <span className="w-px h-3 bg-border-subtle" />
        <span className="text-text-muted">drag to rotate in 3D · scroll to zoom · click a node to inspect</span>
      </div>
    </div>
  )
}

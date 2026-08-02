import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Circle,
  Code2,
  FileCode,
  GripHorizontal,
  Layers,
  Loader2,
  Sparkles,
  X
} from 'lucide-react'
import { useGraphStore } from '../../state/graph-store'
import { useSettingsStore } from '../../state/settings-store'
import { layoutRuntimeFromSettings } from '../../utils/layout-settings'
import { getEffectiveGraphPositions } from '../../utils/effective-graph-positions'
import { getNodeInspectorData } from '../../utils/graph-metadata'
import { inferFileDescription } from '../../utils/file-description'
import {
  getHierarchyRingBandsForSnapshot,
  getPyramidDepthBands
} from '@core/layout/hierarchy-layout'
import {
  ringLayerTitle,
  ringLayerExplanation,
  pyramidLayerTitle,
  pyramidLayerExplanation
} from '../../utils/hierarchy-ring-metadata'

export interface PopupAnchor {
  x: number
  y: number
}

interface Props {
  anchor: PopupAnchor | null
  onClose: () => void
}

const POPUP_W = 340
const POPUP_H = 360

// Approximate dimensions of the Magnus AI panel when expanded.
// Used to avoid the popup overlapping Magnus.
const MAGNUS_W_APPROX = 360
const MAGNUS_H_APPROX = 500

/** Get the approximate bounding box of the Magnus panel (bottom-right corner). */
function getMagnusApproxBounds(): { left: number; top: number; right: number; bottom: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const right = vw - 16
  const bottom = vh - 16
  return {
    left: right - MAGNUS_W_APPROX,
    top: bottom - MAGNUS_H_APPROX,
    right,
    bottom
  }
}

/** Returns true when the popup at `pos` overlaps the Magnus area. */
function overlapsMagnus(pos: { left: number; top: number }): boolean {
  const m = getMagnusApproxBounds()
  return !(
    pos.left + POPUP_W <= m.left ||
    pos.left >= m.right ||
    pos.top + POPUP_H <= m.top ||
    pos.top >= m.bottom
  )
}

/** Clamp a raw position so the popup stays inside the graph viewport. */
function clampToViewport(pos: { left: number; top: number }): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const sidebarW = 228
  const titleBarH = 44
  const margin = 14
  return {
    left: Math.max(sidebarW + margin, Math.min(vw - POPUP_W - margin, pos.left)),
    top: Math.max(titleBarH + margin, Math.min(vh - POPUP_H - margin, pos.top))
  }
}

/**
 * Returns the popup's best position anchored near the click point,
 * avoiding Magnus and staying within the graph viewport.
 */
function clampPosition(ax: number, ay: number): { left: number; top: number } {
  const margin = 18

  // Four candidate positions to try in priority order:
  // 1. Right of anchor, vertically centered on click
  // 2. Left of anchor, vertically centered on click
  // 3. Above anchor, horizontally centered on click
  // 4. Below anchor, horizontally centered on click
  const candidates: Array<{ left: number; top: number }> = [
    { left: ax + margin, top: ay - POPUP_H / 2 },
    { left: ax - POPUP_W - margin, top: ay - POPUP_H / 2 },
    { left: ax - POPUP_W / 2, top: ay - POPUP_H - margin },
    { left: ax - POPUP_W / 2, top: ay + margin }
  ]

  for (const candidate of candidates) {
    const clamped = clampToViewport(candidate)
    if (!overlapsMagnus(clamped)) return clamped
  }

  // All four sides overlap Magnus — place above the Magnus area
  const magnus = getMagnusApproxBounds()
  return clampToViewport({ left: ax - POPUP_W / 2, top: magnus.top - POPUP_H - margin })
}

/** Clamp drag position to keep popup inside visible bounds. */
function clampDrag(x: number, y: number): { x: number; y: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const sidebarW = 228
  const titleBarH = 44
  const margin = 8
  return {
    x: Math.max(sidebarW + margin, Math.min(vw - POPUP_W - margin, x)),
    y: Math.max(titleBarH + margin, Math.min(vh - POPUP_H - margin, y))
  }
}

// ----- AI description hooks -----

function useFileAiDescription(
  projectRoot: string | undefined,
  projectName: string | undefined,
  relativeFilePath: string | undefined
): { description: string; loading: boolean } {
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const lastKeyRef = useRef('')

  useEffect(() => {
    if (!projectRoot || !projectName || !relativeFilePath) {
      setDescription('')
      setLoading(false)
      return
    }
    const key = `${projectRoot}::${relativeFilePath}`
    if (key === lastKeyRef.current) return
    lastKeyRef.current = key

    setDescription('')
    setLoading(true)
    window.prebase
      .describeFile({ projectRoot, projectName, relativeFilePath })
      .then((desc) => {
        if (lastKeyRef.current === key) {
          setDescription(desc)
          setLoading(false)
        }
      })
      .catch(() => {
        if (lastKeyRef.current === key) {
          setLoading(false)
        }
      })
  }, [projectRoot, projectName, relativeFilePath])

  return { description, loading }
}

function useLayerAiDescription(
  projectRoot: string | undefined,
  projectName: string | undefined,
  layoutType: 'hierarchy' | 'pyramid' | undefined,
  depth: number | undefined,
  fileIds: string[],
  filePaths: string[]
): { description: string; loading: boolean } {
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const lastKeyRef = useRef('')

  useEffect(() => {
    if (!projectRoot || !projectName || !layoutType || depth === undefined || fileIds.length === 0) {
      setDescription('')
      setLoading(false)
      return
    }
    const key = `${projectRoot}::layer::${layoutType}::${depth}::${fileIds.slice().sort().join(',')}`
    if (key === lastKeyRef.current) return
    lastKeyRef.current = key

    setDescription('')
    setLoading(true)
    window.prebase
      .describeLayer({ projectRoot, projectName, layoutType, depth, fileIds, filePaths })
      .then((desc) => {
        if (lastKeyRef.current === key) {
          setDescription(desc)
          setLoading(false)
        }
      })
      .catch(() => {
        if (lastKeyRef.current === key) {
          setLoading(false)
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectRoot, projectName, layoutType, depth, fileIds.join(','), filePaths.join(',')])

  return { description, loading }
}

// ----- Content sections -----

function AiDescriptionSection({
  description,
  loading,
  label = 'AI Description'
}: {
  description: string
  loading: boolean
  label?: string
}) {
  if (!loading && !description) return null
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles className="w-3 h-3 text-cyan-400/70 shrink-0" />
        <span className="text-[9px] uppercase tracking-wider text-text-muted">{label}</span>
      </div>
      {loading ? (
        <div className="flex items-center gap-1.5 py-1">
          <Loader2 className="w-3 h-3 text-cyan-400/50 animate-spin shrink-0" />
          <span className="text-[11px] text-text-muted italic">Generating…</span>
        </div>
      ) : (
        <p className="text-[11px] text-text-secondary leading-relaxed">{description}</p>
      )}
    </div>
  )
}

// ----- File popup content (file-first) -----

function FilePopupContent({ onClose }: { onClose: () => void }) {
  const snapshot = useGraphStore((s) => s.snapshot)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const layoutMode = useGraphStore((s) => s.layoutMode)
  const userPositions = useGraphStore((s) => s.userPositions)
  const openFileInCodeView = useGraphStore((s) => s.openFileInCodeView)
  const settings = useSettingsStore()

  const node = snapshot?.nodes.find((n) => n.id === selectedNodeId)
  const data = snapshot && selectedNodeId ? getNodeInspectorData(snapshot, selectedNodeId) : null

  // Determine the file's depth/layer
  const [layerTitle, setLayerTitle] = useState<string>('')
  const [layerDepth, setLayerDepth] = useState<number | undefined>(undefined)
  const [layerFileIds, setLayerFileIds] = useState<string[]>([])
  const [layerFilePaths, setLayerFilePaths] = useState<string[]>([])

  useEffect(() => {
    if (!snapshot || !selectedNodeId || !snapshot.entryNodeId) {
      setLayerTitle('')
      setLayerDepth(undefined)
      setLayerFileIds([])
      setLayerFilePaths([])
      return
    }
    const positions = getEffectiveGraphPositions(snapshot, userPositions)
    const runtime = layoutRuntimeFromSettings(settings)

    if (layoutMode === 'hierarchy') {
      const bands = getHierarchyRingBandsForSnapshot(
        snapshot.nodes, snapshot.edges, snapshot.entryNodeId, positions, runtime
      )
      const band = bands.find((b) => b.nodeIds.includes(selectedNodeId))
      if (band) {
        const subRingCount = bands.filter((b) => b.semanticDepth === band.semanticDepth).length
        setLayerTitle(ringLayerTitle(band.semanticDepth, band.subRingIndex, subRingCount))
        setLayerDepth(band.semanticDepth)
        setLayerFileIds(band.nodeIds)
        setLayerFilePaths(
          band.nodeIds
            .map((id) => snapshot.nodes.find((n) => n.id === id)?.path ?? '')
            .filter(Boolean)
        )
      }
    } else if (layoutMode === 'pyramid') {
      const bands = getPyramidDepthBands(
        snapshot.nodes, snapshot.edges, snapshot.entryNodeId, positions, runtime
      )
      const band = bands.find((b) => b.nodeIds.includes(selectedNodeId))
      if (band) {
        setLayerTitle(pyramidLayerTitle(band.depth))
        setLayerDepth(band.depth)
        setLayerFileIds(band.nodeIds)
        setLayerFilePaths(
          band.nodeIds
            .map((id) => snapshot.nodes.find((n) => n.id === id)?.path ?? '')
            .filter(Boolean)
        )
      }
    }
  }, [snapshot, selectedNodeId, layoutMode, userPositions])

  const relPath = node?.path ?? ''
  const projectRoot = snapshot?.projectPath ?? ''
  const projectName = snapshot?.projectPath ? snapshot.projectPath.split('/').pop() ?? '' : ''
  const ext = relPath.split('.').pop()?.toUpperCase() ?? ''

  const { description: aiDesc, loading: aiLoading } = useFileAiDescription(
    projectRoot || undefined,
    projectName || undefined,
    relPath || undefined
  )
  const { description: layerAiDesc, loading: layerAiLoading } = useLayerAiDescription(
    projectRoot || undefined,
    projectName || undefined,
    (layoutMode === 'hierarchy' || layoutMode === 'pyramid') ? layoutMode : undefined,
    layerDepth,
    layerFileIds,
    layerFilePaths
  )

  if (!node) return null

  const fallbackDesc = inferFileDescription(node)
  const incoming = data?.incomingConnections.slice(0, 5) ?? []
  const outgoing = data?.outgoingConnections.slice(0, 5) ?? []
  const depthDisplay = layerDepth !== undefined && layerDepth >= 10_000 ? 'Unlinked' : String(layerDepth ?? '—')
  const inCount = data?.incoming.length ?? 0
  const outCount = data?.outgoing.length ?? 0

  return (
    <>
      {/* Header — file name, path, type */}
      <div className="flex items-start justify-between gap-2 mb-2.5 shrink-0">
        <div className="flex items-start gap-2 min-w-0">
          <FileCode className="w-4 h-4 text-cyan-400/80 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary leading-tight truncate">{node.label}</p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {relPath && (
                <p className="text-[10px] text-text-muted font-mono break-all leading-tight truncate max-w-[180px]">{relPath}</p>
              )}
              {ext && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.07] text-text-muted font-mono border border-white/[0.06] shrink-0">
                  {ext}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-white/[0.08] text-text-muted shrink-0 -mt-0.5 -mr-0.5"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-0.5 sidebar-scroll">

        {/* AI file description — PRIMARY */}
        {(aiLoading || aiDesc) ? (
          <AiDescriptionSection description={aiDesc} loading={aiLoading} label="About this file" />
        ) : (
          /* Deterministic fallback when AI unavailable */
          <div>
            <p className="text-[9px] uppercase tracking-wider text-text-muted mb-1">About this file</p>
            <p className="text-[11px] text-text-secondary leading-relaxed">{fallbackDesc}</p>
          </div>
        )}

        {/* Import/used-by counts */}
        {(inCount > 0 || outCount > 0) && (
          <div className="flex items-center gap-3">
            {outCount > 0 && (
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/40 shrink-0" />
                <span className="text-[10px] text-text-muted">
                  <span className="text-text-secondary font-medium">{outCount}</span> import{outCount !== 1 ? 's' : ''}
                </span>
              </div>
            )}
            {inCount > 0 && (
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400/40 shrink-0" />
                <span className="text-[10px] text-text-muted">
                  used by <span className="text-text-secondary font-medium">{inCount}</span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Layer badge — compact, secondary */}
        {layerTitle && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] uppercase tracking-wider text-text-muted">Layer</span>
            <span className="text-[10px] bg-white/[0.07] border border-white/[0.06] rounded px-2 py-0.5 text-text-secondary font-medium">
              {layerTitle}
            </span>
            {layerDepth !== undefined && layerDepth < 10_000 && (
              <span className="text-[10px] text-text-muted font-mono">depth {depthDisplay}</span>
            )}
          </div>
        )}

        {/* Layer AI description — secondary, collapsible feel */}
        {(layerAiLoading || layerAiDesc) && layerTitle && (
          <div className="rounded-md bg-white/[0.03] border border-white/[0.05] px-2.5 py-2">
            <AiDescriptionSection
              description={layerAiDesc}
              loading={layerAiLoading}
              label="Layer context"
            />
          </div>
        )}

        {/* Connections */}
        {outgoing.length > 0 && (
          <div>
            <p className="text-[9px] uppercase tracking-wider text-text-muted mb-1">
              Imports ({outCount})
            </p>
            <ul className="space-y-0.5">
              {outgoing.map((c) => (
                <li key={c.nodeId} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                  <span className="w-1 h-1 rounded-full bg-cyan-400/40 shrink-0" />
                  <span className="truncate">{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {incoming.length > 0 && (
          <div>
            <p className="text-[9px] uppercase tracking-wider text-text-muted mb-1">
              Imported by ({inCount})
            </p>
            <ul className="space-y-0.5">
              {incoming.map((c) => (
                <li key={c.nodeId} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                  <span className="w-1 h-1 rounded-full bg-purple-400/40 shrink-0" />
                  <span className="truncate">{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer action */}
      {relPath && (
        <div className="mt-2.5 pt-2 border-t border-white/[0.06] shrink-0">
          <button
            onClick={() => {
              openFileInCodeView(node.id)
              onClose()
            }}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 transition-colors"
          >
            <Code2 className="w-3.5 h-3.5" />
            Open in Code View
          </button>
        </div>
      )}
    </>
  )
}

// ----- Layer popup content -----

function LayerPopupContent({ onClose }: { onClose: () => void }) {
  const snapshot = useGraphStore((s) => s.snapshot)
  const selectedRingKey = useGraphStore((s) => s.selectedRingKey)
  const layoutMode = useGraphStore((s) => s.layoutMode)
  const userPositions = useGraphStore((s) => s.userPositions)
  const openFileInCodeView = useGraphStore((s) => s.openFileInCodeView)
  const settings = useSettingsStore()

  if (!snapshot || !selectedRingKey || !snapshot.entryNodeId) return null

  const positions = getEffectiveGraphPositions(snapshot, userPositions)
  const runtime = layoutRuntimeFromSettings(settings)

  let title = ''
  let explanation = ''
  let depth = 0
  let fileIds: string[] = []
  let ringIndex = 0

  if (layoutMode === 'hierarchy') {
    const bands = getHierarchyRingBandsForSnapshot(
      snapshot.nodes, snapshot.edges, snapshot.entryNodeId, positions, runtime
    )
    const band = bands.find((b) => b.key === selectedRingKey)
    if (!band) return null
    const subRingCount = bands.filter((b) => b.semanticDepth === band.semanticDepth).length
    title = ringLayerTitle(band.semanticDepth, band.subRingIndex, subRingCount)
    explanation = ringLayerExplanation(band.semanticDepth, band.subRingIndex)
    depth = band.semanticDepth
    fileIds = band.nodeIds
    ringIndex = band.subRingIndex
  } else if (layoutMode === 'pyramid') {
    const bands = getPyramidDepthBands(
      snapshot.nodes, snapshot.edges, snapshot.entryNodeId, positions, runtime
    )
    const band = bands.find((b) => b.key === selectedRingKey)
    if (!band) return null
    title = pyramidLayerTitle(band.depth)
    explanation = pyramidLayerExplanation(band.depth)
    depth = band.depth
    fileIds = band.nodeIds
  }

  const files = fileIds
    .map((id) => snapshot.nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => !!n && n.kind !== 'folder')
    .sort((a, b) => a.label.localeCompare(b.label))

  const filePaths = files.map((f) => f.path ?? '')
  const projectRoot = snapshot.projectPath ?? ''
  const projectName = projectRoot.split('/').pop() ?? ''
  const layoutType = layoutMode === 'hierarchy' ? 'hierarchy' : 'pyramid'
  const depthDisplay = depth >= 10_000 ? '—' : depth

  const { description: layerAiDesc, loading: layerAiLoading } = useLayerAiDescription(
    projectRoot || undefined,
    projectName || undefined,
    layoutType as 'hierarchy' | 'pyramid',
    depth,
    fileIds,
    filePaths
  )

  const Icon = layoutMode === 'pyramid' ? Layers : Circle

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3 shrink-0">
        <div className="flex items-start gap-2 min-w-0">
          <Icon className="w-4 h-4 text-cyan-400/80 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary leading-tight">{title}</p>
            <p className="text-[10px] text-text-muted mt-0.5">
              {depth >= 10_000 ? 'Not reachable from entry' : `${files.length} file${files.length === 1 ? '' : 's'} · Depth ${depthDisplay}`}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-white/[0.08] text-text-muted shrink-0 -mt-0.5 -mr-0.5"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-0.5 sidebar-scroll">
        <div className="rounded-md bg-white/[0.04] border border-white/[0.06] px-2.5 py-2">
          <p className="text-[9px] uppercase tracking-wider text-text-muted mb-1">
            {layoutMode === 'hierarchy' ? 'What this ring means' : 'What this layer means'}
          </p>
          <p className="text-[11px] text-text-secondary leading-relaxed">{explanation}</p>
          {layoutMode === 'hierarchy' && ringIndex > 0 && (
            <p className="text-[10px] text-text-muted mt-1.5 italic">
              Overflow ring {String.fromCharCode(65 + ringIndex)} — same depth group, split for readability.
            </p>
          )}
        </div>

        <AiDescriptionSection description={layerAiDesc} loading={layerAiLoading} />

        {/* File list */}
        <div>
          <p className="text-[9px] uppercase tracking-wider text-text-muted mb-1.5">Files in this {layoutMode === 'hierarchy' ? 'ring' : 'group'}</p>
          <ul className="space-y-0.5">
            {files.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => openFileInCodeView(f.id)}
                  className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left text-[11px] text-text-secondary hover:bg-white/[0.06] transition-colors"
                >
                  <FileCode className="w-3 h-3 shrink-0 text-cyan-400/60" />
                  <span className="truncate">{f.label}</span>
                </button>
              </li>
            ))}
            {files.length === 0 && (
              <p className="text-[11px] text-text-muted px-1.5">No files in this group</p>
            )}
          </ul>
        </div>
      </div>
    </>
  )
}

// ----- Main popup -----

export function GraphItemPopup({ anchor, onClose }: Props) {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const selectedRingKey = useGraphStore((s) => s.selectedRingKey)
  const layoutMode = useGraphStore((s) => s.layoutMode)

  const hasSelection = !!(selectedNodeId || selectedRingKey)
  const isRing = !selectedNodeId && !!selectedRingKey
  const showRingPopup = isRing && (layoutMode === 'hierarchy' || layoutMode === 'pyramid')

  // --- Drag state ---
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, popupX: 0, popupY: 0 })

  // Reset drag position when anchor changes (new selection)
  useEffect(() => {
    setDragPos(null)
  }, [anchor])

  // Global pointer move/up for drag
  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return
      const dx = e.clientX - dragStartRef.current.mouseX
      const dy = e.clientY - dragStartRef.current.mouseY
      const raw = {
        x: dragStartRef.current.popupX + dx,
        y: dragStartRef.current.popupY + dy
      }
      setDragPos(clampDrag(raw.x, raw.y))
    }
    const handleUp = () => {
      isDraggingRef.current = false
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [])

  // Escape key dismissal
  useEffect(() => {
    if (!hasSelection) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [hasSelection, onClose])

  const basePos = anchor ? clampPosition(anchor.x, anchor.y) : { left: -9999, top: -9999 }
  const pos = dragPos ? { left: dragPos.x, top: dragPos.y } : basePos

  // Genie effect: transform-origin anchored toward the click/selection point,
  // plus a small directional translate so the popup "emerges from" the item.
  const txOriginX = anchor
    ? Math.max(0, Math.min(POPUP_W, anchor.x - basePos.left))
    : POPUP_W / 2
  const txOriginY = anchor
    ? Math.max(0, Math.min(POPUP_H, anchor.y - basePos.top))
    : 0
  const transformOrigin = `${txOriginX}px ${txOriginY}px`

  // Direction vector from popup center → anchor (normalised, clamped to ±16px offset)
  const popupCenterX = basePos.left + POPUP_W / 2
  const popupCenterY = basePos.top + POPUP_H / 2
  const rawDx = anchor ? anchor.x - popupCenterX : 0
  const rawDy = anchor ? anchor.y - popupCenterY : 0
  const dist = Math.sqrt(rawDx * rawDx + rawDy * rawDy) || 1
  const GENIE_OFFSET = 16
  const genieX = (rawDx / dist) * GENIE_OFFSET
  const genieY = (rawDy / dist) * GENIE_OFFSET

  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    isDraggingRef.current = true
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      popupX: pos.left,
      popupY: pos.top
    }
  }

  return (
    <AnimatePresence>
      {hasSelection && anchor && (
        <motion.div
          key="graph-item-popup"
          initial={{ opacity: 0, scale: 0.82, x: genieX, y: genieY }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, scale: 0.80, x: genieX * 0.7, y: genieY * 0.7 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            width: POPUP_W,
            height: POPUP_H,
            zIndex: 60,
            transformOrigin
          }}
          className="flex flex-col bg-[#12141a] border border-white/[0.10] rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.60)] overflow-hidden pointer-events-auto titlebar-no-drag"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Drag handle header strip */}
          <div
            className="flex items-center justify-center h-5 shrink-0 cursor-grab active:cursor-grabbing select-none border-b border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
            onPointerDown={handleHeaderPointerDown}
          >
            <GripHorizontal className="w-4 h-4 text-white/20" />
          </div>

          {/* Content — fills remaining height; inner components own their scroll areas */}
          <div className="flex flex-col flex-1 min-h-0 p-3.5 pt-3">
            {showRingPopup ? (
              <LayerPopupContent onClose={onClose} />
            ) : (
              <FilePopupContent onClose={onClose} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

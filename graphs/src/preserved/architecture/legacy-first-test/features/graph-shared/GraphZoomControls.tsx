import { Maximize2, Minus, Plus, RefreshCw, RotateCcw } from 'lucide-react'
import { useGraphViewportInsets, GRAPH_FLOAT_LEFT_PX } from './useGraphViewportInsets'

export interface GraphZoomControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
  /** Optional reset camera / rotation (Network Graph). */
  onResetView?: () => void
  /** Optional re-layout (Architecture Graph). */
  onRelayout?: () => void
}

export function GraphZoomControls({
  onZoomIn,
  onZoomOut,
  onFitView,
  onResetView,
  onRelayout
}: GraphZoomControlsProps) {
  const { zoomBottomPx } = useGraphViewportInsets()

  return (
    <div
      className="absolute z-20 flex items-center gap-1 p-1 rounded-xl border border-border-subtle bg-[#141518] shadow-panel titlebar-no-drag"
      style={{ left: GRAPH_FLOAT_LEFT_PX, bottom: zoomBottomPx }}
    >
      <button
        type="button"
        onClick={onZoomIn}
        className="p-2 rounded-lg hover:bg-surface-muted text-text-muted hover:text-text-primary transition-colors"
        title="Zoom in"
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onZoomOut}
        className="p-2 rounded-lg hover:bg-surface-muted text-text-muted hover:text-text-primary transition-colors"
        title="Zoom out"
      >
        <Minus className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onFitView}
        className="p-2 rounded-lg hover:bg-surface-muted text-text-muted hover:text-text-primary transition-colors"
        title="Fit view"
      >
        <Maximize2 className="w-4 h-4" />
      </button>
      {onResetView && (
        <>
          <div className="w-px h-5 bg-border-subtle mx-0.5" />
          <button
            type="button"
            onClick={onResetView}
            className="p-2 rounded-lg hover:bg-surface-muted text-text-muted hover:text-text-primary transition-colors"
            title="Reset view"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </>
      )}
      {onRelayout && (
        <>
          <div className="w-px h-5 bg-border-subtle mx-0.5" />
          <button
            type="button"
            onClick={onRelayout}
            className="p-2 rounded-lg hover:bg-surface-muted text-text-muted hover:text-text-primary transition-colors"
            title="Re-layout graph"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  )
}

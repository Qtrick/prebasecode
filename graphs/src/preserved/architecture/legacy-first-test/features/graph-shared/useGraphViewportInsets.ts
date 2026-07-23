import { useGraphStore } from '../../state/graph-store'
import { useSettingsStore, type MagnusMode, type MagnusPanelState } from '../../state/settings-store'
import { isTerminalAllowedInWorkspace } from '../../utils/terminal-visibility'

/** Shared spacing for lower-left floating graph controls (legend + zoom). */
export const GRAPH_FLOAT_LEFT_PX = 20
export const GRAPH_FLOAT_BOTTOM_PX = 20
export const GRAPH_ZOOM_BAR_HEIGHT_PX = 46
export const GRAPH_FLOAT_GAP_PX = 12

/**
 * Width (px) the Magnus panel actually occupies on the right edge of the graph
 * viewport right now. Magnus is an absolutely-positioned overlay (not a flex
 * sibling), so graph fit/centering math must subtract this manually or the
 * sidebar visually covers part of the graph.
 */
export function magnusOccupiedInset(_mode: MagnusMode, _panelState: MagnusPanelState): number {
  // Magnus is a flex sibling in docked mode — no overlay inset needed.
  return 0
}

/** Layout-aware insets for floating graph UI (legend, zoom, Magnus). */
export function useGraphViewportInsets() {
  const inspectorOpen = useGraphStore((s) => s.inspectorOpen)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const selectedRingKey = useGraphStore((s) => s.selectedRingKey)
  const inspectorWidth = useSettingsStore((s) => s.inspectorPanelWidth)
  const magnusMode = useSettingsStore((s) => s.magnusMode)
  const magnusPanelState = useSettingsStore((s) => s.magnusPanelState)
  const viewMode = useGraphStore((s) => s.viewMode)
  const terminalPanelOpen = useSettingsStore((s) => s.terminalPanelOpen)
  const terminalPanelHeight = useSettingsStore((s) => s.terminalPanelHeight)
  const terminalVisibility = useSettingsStore((s) => s.terminalVisibility)

  const rightPanelOpen =
    inspectorOpen && (selectedNodeId !== null || selectedRingKey !== null)
  const inspectorInset = rightPanelOpen ? inspectorWidth : 0
  const magnusInset = magnusOccupiedInset(magnusMode, magnusPanelState)
  const rightInset = Math.max(inspectorInset, magnusInset)
  /**
   * Graph canvas is a flex sibling above the terminal panel — its bottom edge
   * already sits above the terminal. Do NOT add terminal height to legend/zoom
   * CSS `bottom` offsets or controls float up into the middle of the graph.
   */
  const legendStackHeightPx =
    GRAPH_FLOAT_BOTTOM_PX + GRAPH_ZOOM_BAR_HEIGHT_PX + GRAPH_FLOAT_GAP_PX

  return {
    rightInset,
    leftPx: GRAPH_FLOAT_LEFT_PX,
    magnusRightPx: inspectorInset + 24,
    zoomBottomPx: GRAPH_FLOAT_BOTTOM_PX,
    legendBottomPx: legendStackHeightPx,
    /** Reserved clearance for fit-view padding (legend + zoom stack). */
    fitViewBottomPx: legendStackHeightPx + 8,
    terminalBottomInset:
      terminalPanelOpen && isTerminalAllowedInWorkspace(viewMode, terminalVisibility)
        ? terminalPanelHeight
        : 32
  }
}

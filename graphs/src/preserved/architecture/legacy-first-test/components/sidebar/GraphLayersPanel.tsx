import { Eye, EyeOff, Focus, Layers } from 'lucide-react'
import { ARCHITECTURE_LAYERS, countNodesPerLayer } from '../../../../core/utils/architecture-layers'
import { useGraphStore } from '../../state/graph-store'
import { useSettingsStore } from '../../state/settings-store'
import { InfoTooltip } from '../ui/InfoTooltip'
import {
  FOCUS_NEIGHBORHOOD_HELP,
  HIDE_LOW_IMPORTANCE_HELP,
  LAYERS_PANEL_HELP,
  VISIBLE_RELATED_CONNECTIONS_HELP
} from '../../constants/graph-help'
import {
  edgeVisibilityModeFromMaxRelated,
  type EdgeVisibilityMode
} from '../../utils/edge-render-strategy'

export function GraphLayersPanel() {
  const snapshot = useGraphStore((s) => s.snapshot)
  const layerVisibility = useGraphStore((s) => s.layerVisibility)
  const isolatedLayer = useGraphStore((s) => s.isolatedLayer)
  const focusNeighborhood = useGraphStore((s) => s.focusNeighborhood)
  const hideLowImportance = useGraphStore((s) => s.hideLowImportance)
  const setLayerVisible = useGraphStore((s) => s.setLayerVisible)
  const setAllLayersVisible = useGraphStore((s) => s.setAllLayersVisible)
  const setIsolatedLayer = useGraphStore((s) => s.setIsolatedLayer)
  const setFocusNeighborhood = useGraphStore((s) => s.setFocusNeighborhood)
  const setHideLowImportance = useGraphStore((s) => s.setHideLowImportance)
  const visibleRelatedConnections = useSettingsStore((s) => s.visibleRelatedConnections)
  const setVisibleRelatedConnections = useSettingsStore((s) => s.setVisibleRelatedConnections)
  const edgeDensityMode = edgeVisibilityModeFromMaxRelated(visibleRelatedConnections)

  const edgeDensityLabels: Record<EdgeVisibilityMode, string> = {
    minimal: 'Minimal',
    balanced: 'Balanced',
    detailed: 'Detailed'
  }

  if (!snapshot) return null

  const counts = countNodesPerLayer(snapshot.nodes)
  const layers = ARCHITECTURE_LAYERS.filter((l) => l.id !== 'entry' && (counts[l.id] ?? 0) > 0)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <p className="text-[10px] uppercase tracking-wider text-text-muted flex items-center gap-1">
          <Layers className="w-3 h-3" />
          Architecture layers
          <InfoTooltip
            title={LAYERS_PANEL_HELP.title}
            body={LAYERS_PANEL_HELP.body}
            side="bottom"
          />
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setAllLayersVisible(true)}
            className="text-[9px] text-text-muted hover:text-accent px-1"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setAllLayersVisible(false)}
            className="text-[9px] text-text-muted hover:text-accent px-1"
          >
            None
          </button>
        </div>
      </div>

      <div className="space-y-1 max-h-[200px] overflow-y-auto pr-0.5">
        {layers.map((layer) => {
          const visible = layerVisibility[layer.id]
          const isolated = isolatedLayer === layer.id
          const count = counts[layer.id] ?? 0

          return (
            <div
              key={layer.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-colors titlebar-no-drag ${
                isolated
                  ? 'border-accent/40 bg-accent-soft/40'
                  : visible
                    ? 'border-border-subtle bg-surface-overlay/40'
                    : 'border-transparent opacity-50'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: layer.color }}
              />
              <span className="flex-1 text-[11px] text-text-secondary truncate">{layer.label}</span>
              <span className="text-[9px] text-text-muted tabular-nums">{count}</span>
              <button
                type="button"
                title={visible ? 'Hide layer' : 'Show layer'}
                onClick={() => setLayerVisible(layer.id, !visible)}
                className="p-0.5 rounded hover:bg-surface-muted text-text-muted"
              >
                {visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              </button>
              <button
                type="button"
                title="Isolate layer"
                onClick={() => setIsolatedLayer(isolated ? null : layer.id)}
                className={`p-0.5 rounded hover:bg-surface-muted ${
                  isolated ? 'text-accent' : 'text-text-muted'
                }`}
              >
                <Focus className="w-3 h-3" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="space-y-1.5 pt-1 border-t border-border-subtle">
        <div className="space-y-1 titlebar-no-drag">
          <div className="flex items-center justify-between text-[11px] text-text-secondary">
            <span className="flex items-center gap-1">
              Edge density
              <InfoTooltip
                title={VISIBLE_RELATED_CONNECTIONS_HELP.title}
                body={VISIBLE_RELATED_CONNECTIONS_HELP.body}
                side="bottom"
              />
            </span>
            <span className="text-[10px] text-text-muted tabular-nums">
              {edgeDensityLabels[edgeDensityMode]}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            value={visibleRelatedConnections}
            onChange={(e) =>
              setVisibleRelatedConnections(Number(e.target.value) as 0 | 1 | 2)
            }
            className="w-full accent-teal-400"
            aria-label="Edge density"
          />
          <p className="text-[9px] text-text-muted leading-snug">
            {edgeDensityMode === 'minimal' &&
              'Root links only — calmest default view'}
            {edgeDensityMode === 'balanced' &&
              'Root link + 1 ranked link per file'}
            {edgeDensityMode === 'detailed' &&
              'Root link + 2 ranked links per file'}
          </p>
        </div>
        <label className="flex items-center justify-between text-[11px] text-text-secondary cursor-pointer titlebar-no-drag">
          <span className="flex items-center gap-1">
            Focus neighborhood
            <InfoTooltip
              title={FOCUS_NEIGHBORHOOD_HELP.title}
              body={FOCUS_NEIGHBORHOOD_HELP.body}
              side="bottom"
            />
          </span>
          <input
            type="checkbox"
            checked={focusNeighborhood}
            onChange={(e) => setFocusNeighborhood(e.target.checked)}
            className="accent-teal-400"
          />
        </label>
        <label className="flex items-center justify-between text-[11px] text-text-secondary cursor-pointer titlebar-no-drag">
          <span className="flex items-center gap-1">
            Hide low-importance
            <InfoTooltip
              title={HIDE_LOW_IMPORTANCE_HELP.title}
              body={HIDE_LOW_IMPORTANCE_HELP.body}
              side="bottom"
            />
          </span>
          <input
            type="checkbox"
            checked={hideLowImportance}
            onChange={(e) => setHideLowImportance(e.target.checked)}
            className="accent-teal-400"
          />
        </label>
      </div>
    </div>
  )
}

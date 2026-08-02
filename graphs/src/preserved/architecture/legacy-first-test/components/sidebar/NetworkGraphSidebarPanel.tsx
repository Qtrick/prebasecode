import { RotateCcw } from 'lucide-react'
import { useSettingsStore } from '../../state/settings-store'
import { useNetworkControls } from '../../state/network-controls-store'
import { InfoTooltip } from '../ui/InfoTooltip'
import { VISIBLE_RELATED_CONNECTIONS_HELP } from '../../constants/graph-help'
import { NETWORK_LAYOUT_OPTIONS } from '../../utils/network-layout'
import { EdgeCategoryPanel } from './EdgeCategoryPanel'
import { CollapsibleSidebarSection } from './CollapsibleSidebarSection'

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-text-secondary">
        <span>{label}</span>
        <span className="text-[10px] text-text-muted tabular-nums">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-teal-400"
      />
    </div>
  )
}

/** Sidebar controls shown only in Network graph mode. */
export function NetworkGraphSidebarPanel() {
  const visibleRelatedConnections = useSettingsStore((s) => s.visibleRelatedConnections)
  const setVisibleRelatedConnections = useSettingsStore((s) => s.setVisibleRelatedConnections)
  const edgeOpacity = useSettingsStore((s) => s.networkEdgeOpacity)
  const setEdgeOpacity = useSettingsStore((s) => s.setNetworkEdgeOpacity)
  const c = useNetworkControls()

  return (
    <div className="space-y-2 pt-0.5 border-t border-border-subtle">
      <div className="flex items-center justify-between px-0.5">
        <p className="text-[10px] uppercase tracking-wider text-text-muted">Network</p>
        <button
          type="button"
          onClick={c.requestResetView}
          className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary px-1.5 py-0.5 rounded hover:bg-surface-muted transition-colors"
        >
          <RotateCcw className="w-3 h-3" /> Reset view
        </button>
      </div>

      <CollapsibleSidebarSection sectionId="network-layout" title="Layout">
        <div className="grid grid-cols-2 gap-1">
          {NETWORK_LAYOUT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              title={opt.blurb}
              onClick={() => c.set({ layoutMode: opt.id })}
              className={`px-2 py-1 rounded-md text-[10px] font-medium text-left transition-colors ${
                c.layoutMode === opt.id
                  ? 'bg-accent-soft text-accent'
                  : 'bg-surface-overlay text-text-muted hover:text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </CollapsibleSidebarSection>

      <CollapsibleSidebarSection
        sectionId="network-edge-categories"
        title="Edge categories"
        hint="Select up to 2 relationship types to show on the graph."
      >
        <EdgeCategoryPanel embedded />
      </CollapsibleSidebarSection>

      <CollapsibleSidebarSection sectionId="network-display" title="Display">
        <div className="space-y-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-text-secondary">
              <span className="flex items-center gap-1">
                Related connections
                <InfoTooltip
                  title={VISIBLE_RELATED_CONNECTIONS_HELP.title}
                  body={VISIBLE_RELATED_CONNECTIONS_HELP.body}
                  side="bottom"
                />
              </span>
              <span className="text-[10px] text-text-muted tabular-nums">
                {visibleRelatedConnections}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={visibleRelatedConnections}
              onChange={(e) => setVisibleRelatedConnections(Number(e.target.value) as 0 | 1 | 2)}
              className="w-full accent-teal-400"
            />
          </div>
          <Slider
            label="Node distance"
            value={c.spreadScale}
            min={0.75}
            max={1.35}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(spreadScale) => c.set({ spreadScale })}
          />
          <Slider
            label="Node size"
            value={c.nodeScale}
            min={0.5}
            max={2.5}
            step={0.1}
            format={(v) => `${v.toFixed(1)}×`}
            onChange={(nodeScale) => c.set({ nodeScale })}
          />
          <Slider
            label="Edge thickness"
            value={c.linkWidth}
            min={0.2}
            max={2}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={(linkWidth) => c.set({ linkWidth })}
          />
          <Slider
            label="Edge opacity"
            value={edgeOpacity}
            min={0.1}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={setEdgeOpacity}
          />
          <label className="flex items-center justify-between text-[11px] text-text-secondary cursor-pointer py-0.5">
            <span>Directional arrows</span>
            <input
              type="checkbox"
              checked={c.showArrows}
              onChange={(e) => c.set({ showArrows: e.target.checked })}
              className="accent-teal-400"
            />
          </label>
        </div>
      </CollapsibleSidebarSection>
    </div>
  )
}

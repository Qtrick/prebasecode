import {
  FileCode,
  GitBranch,
  GitFork,
  Layers,
  LayoutGrid,
  Map,
  Network,
  Share2,
  SlidersHorizontal,
  Workflow
} from 'lucide-react'
import type { LayoutMode } from '../../../../core/types'
import {
  useGraphStore,
  type FilterKind,
  type GraphOrganizationMode,
  type GraphViewMode
} from '../../state/graph-store'
import { GraphLayersPanel } from './GraphLayersPanel'
import { NetworkGraphSidebarPanel } from './NetworkGraphSidebarPanel'
import { CollapsibleSidebarSection } from './CollapsibleSidebarSection'
import { ARCHITECTURE_MODES } from '../../utils/architecture-modes'
import { InfoTooltip } from '../ui/InfoTooltip'
import { CollapsibleSidebar } from '../layout/CollapsibleSidebar'
import { ResizableVerticalSplit } from '../layout/ResizableVerticalSplit'
import { ProjectExplorer } from '../shared/ProjectExplorer'
import { GraphSearchPanel } from '../graph/GraphSearchPanel'
import { LanguageCompositionBar } from '../shared/LanguageCompositionBar'
import {
  DEPTH_HELP,
  GRAPH_ORG_MODE_HELP,
  LAYOUT_MODE_HELP,
  LAYOUT_PRESETS,
  ORGANIZATION_METHOD_OPTIONS
} from '../../constants/graph-help'
import { useSettingsStore } from '../../state/settings-store'

const filters: { id: FilterKind; label: string; icon: typeof FileCode }[] = [
  { id: 'all', label: 'All', icon: LayoutGrid },
  { id: 'files', label: 'Files', icon: FileCode },
  { id: 'components', label: 'Components', icon: Layers },
  { id: 'imports', label: 'Dependencies', icon: GitBranch }
]

const orgModes: { id: GraphOrganizationMode; label: string; icon: typeof GitFork }[] = [
  { id: 'dependencies', label: 'Dependencies', icon: GitBranch },
  { id: 'tree', label: 'Tree', icon: GitFork }
]

const graphModes: { id: GraphViewMode; label: string; icon: typeof Network }[] = [
  { id: 'tree', label: 'Architecture', icon: Workflow },
  { id: 'network', label: 'Network', icon: Share2 }
]

interface GraphSidebarProps {
  onRelayout: (mode: LayoutMode, resetCamera?: boolean) => void
}

function GraphControls({ onRelayout }: GraphSidebarProps) {
  const filter = useGraphStore((s) => s.filter)
  const setFilter = useGraphStore((s) => s.setFilter)
  const graphDepth = useGraphStore((s) => s.graphDepth)
  const setGraphDepth = useGraphStore((s) => s.setGraphDepth)
  const showLegend = useGraphStore((s) => s.showLegend)
  const setShowLegend = useGraphStore((s) => s.setShowLegend)
  const showMinimap = useGraphStore((s) => s.showMinimap)
  const setShowMinimap = useGraphStore((s) => s.setShowMinimap)
  const graphOrganizationMode = useGraphStore((s) => s.graphOrganizationMode)
  const setGraphOrganizationMode = useGraphStore((s) => s.setGraphOrganizationMode)
  const graphViewMode = useGraphStore((s) => s.graphViewMode)
  const setGraphViewMode = useGraphStore((s) => s.setGraphViewMode)
  const architectureMode = useGraphStore((s) => s.architectureMode)
  const setArchitectureMode = useGraphStore((s) => s.setArchitectureMode)
  const layoutModeValue = useGraphStore((s) => s.layoutMode)
  const setLayoutMode = useGraphStore((s) => s.setLayoutMode)
  const snapshot = useGraphStore((s) => s.snapshot)
  const layoutSpacing = useSettingsStore((s) => s.layoutSpacing)
  const setLayoutSpacing = useSettingsStore((s) => s.setLayoutSpacing)
  const layoutOrganizationMethod = useSettingsStore((s) => s.layoutOrganizationMethod)
  const setLayoutOrganizationMethod = useSettingsStore((s) => s.setLayoutOrganizationMethod)
  const setDefaultLayout = useSettingsStore((s) => s.setDefaultLayout)

  const isNetwork = graphViewMode === 'network'
  const isOverview = !isNetwork && architectureMode === 'overview'
  const showArchLayout = !isNetwork && !isOverview
  const showLayoutOrganization =
    showArchLayout && (layoutModeValue === 'hierarchy' || layoutModeValue === 'pyramid')
  // Depth/organization controls only for file & dependency slices.
  const showStructureControls =
    !isNetwork && !isOverview && (architectureMode === 'file' || architectureMode === 'dependency')

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2 pt-2 shrink-0">
        <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1 px-0.5 flex items-center gap-1">
          <Network className="w-3 h-3" /> Graph mode
        </p>
        <div className="flex gap-0.5 p-0.5 bg-surface-overlay rounded-lg border border-border-subtle">
          {graphModes.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setGraphViewMode(id)}
              className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-medium transition-colors ${
                graphViewMode === id
                  ? 'bg-accent-soft text-accent shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll p-2 space-y-2.5">
        {!isNetwork && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1 px-0.5">
              Architecture mode
            </p>
            <div className="grid grid-cols-2 gap-1">
              {ARCHITECTURE_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  title={m.question}
                  onClick={() => setArchitectureMode(m.id)}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium text-left transition-colors ${
                    architectureMode === m.id
                      ? 'bg-accent-soft text-accent'
                      : 'bg-surface-overlay text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-text-muted mt-1 px-0.5 leading-snug">
              {ARCHITECTURE_MODES.find((m) => m.id === architectureMode)?.blurb}
            </p>
          </div>
        )}

        {snapshot && <LanguageCompositionBar nodes={snapshot.nodes} />}
        {snapshot && !isOverview && <GraphSearchPanel nodes={snapshot.nodes} />}

        {showStructureControls && (
          <CollapsibleSidebarSection
            sectionId="graph-organization"
            title="Organization"
            hint={`${GRAPH_ORG_MODE_HELP.dependencies.body} ${GRAPH_ORG_MODE_HELP.tree.body}`}
          >
            <div className="flex gap-0.5 p-0.5 bg-surface-overlay rounded-lg border border-border-subtle">
              {orgModes.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setGraphOrganizationMode(id)}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    graphOrganizationMode === id
                      ? 'bg-surface-muted text-text-primary shadow-sm'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </button>
              ))}
            </div>
          </CollapsibleSidebarSection>
        )}

        {!isOverview && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1 px-0.5">Filter</p>
          <div className="flex flex-wrap gap-1">
            {filters.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors ${
                  filter === id
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-muted hover:bg-surface-muted'
                }`}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>
        </div>
        )}

        {isNetwork ? (
          <NetworkGraphSidebarPanel />
        ) : (
          !isOverview && <GraphLayersPanel />
        )}

        {showStructureControls && (
        <CollapsibleSidebarSection sectionId="graph-depth" title="Depth" hint={DEPTH_HELP.body}>
          <div className="flex gap-1">
            {[1, 2, 3, -1].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setGraphDepth(d)}
                className={`flex-1 py-1 rounded text-[10px] transition-colors ${
                  graphDepth === d
                    ? 'bg-accent-soft text-accent'
                    : 'bg-surface-muted text-text-muted'
                }`}
              >
                {d < 0 ? 'All' : d}
              </button>
            ))}
          </div>
        </CollapsibleSidebarSection>
        )}

        {showArchLayout && (
          <CollapsibleSidebarSection sectionId="graph-layout" title="Layout">
            <div className="space-y-2">
                <div className="space-y-0.5">
                  {LAYOUT_PRESETS.map((mode) => (
                    <div key={mode} className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setLayoutMode(mode)
                          setDefaultLayout(mode)
                          onRelayout(mode, true)
                        }}
                        className={`flex-1 px-2 py-1 rounded text-[10px] capitalize transition-colors text-left ${
                          layoutModeValue === mode
                            ? 'bg-accent-soft text-accent'
                            : 'text-text-muted hover:bg-surface-muted'
                        }`}
                      >
                        {mode}
                      </button>
                      <InfoTooltip
                        title={LAYOUT_MODE_HELP[mode].title}
                        body={LAYOUT_MODE_HELP[mode].body}
                        side="right"
                      />
                    </div>
                  ))}
                </div>
                {showLayoutOrganization && (
                  <CollapsibleSidebarSection sectionId="graph-org-method" title="Organization method" className="border-0 rounded-none !overflow-visible">
                    <div className="space-y-0.5">
                      {ORGANIZATION_METHOD_OPTIONS.map((opt) => (
                        <div key={opt.id} className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              setLayoutOrganizationMethod(opt.id)
                              onRelayout(layoutModeValue, false)
                            }}
                            className={`flex-1 px-2 py-1 rounded text-[10px] transition-colors text-left ${
                              layoutOrganizationMethod === opt.id
                                ? 'bg-accent-soft text-accent'
                                : 'text-text-muted hover:bg-surface-muted'
                            }`}
                          >
                            {opt.label}
                          </button>
                          <InfoTooltip title={opt.label} body={opt.blurb} side="right" />
                        </div>
                      ))}
                    </div>
                  </CollapsibleSidebarSection>
                )}
                <div className="space-y-1 pt-1 border-t border-border-subtle/60">
                  <p className="text-[10px] uppercase tracking-wider text-text-muted px-0.5">
                    Node spacing
                  </p>
                  <div className="flex gap-0.5 p-0.5 bg-surface-overlay rounded-lg border border-border-subtle">
                    {(
                      [
                        { id: 'compact' as const, label: 'Compact' },
                        { id: 'balanced' as const, label: 'Balanced' },
                        { id: 'spacious' as const, label: 'Spacious' }
                      ] as const
                    ).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setLayoutSpacing(id)
                          onRelayout(layoutModeValue, false)
                        }}
                        className={`flex-1 py-1 rounded-md text-[10px] font-medium transition-colors ${
                          layoutSpacing === id
                            ? 'bg-accent-soft text-accent'
                            : 'text-text-muted hover:text-text-secondary'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
            </div>
          </CollapsibleSidebarSection>
        )}

        <div className="space-y-1 pt-0.5 border-t border-border-subtle">
          <label className="flex items-center justify-between text-[11px] text-text-secondary cursor-pointer py-0.5">
            <span className="flex items-center gap-1.5">
              <Map className="w-3 h-3" /> Legend
            </span>
            <input
              type="checkbox"
              checked={showLegend}
              onChange={(e) => setShowLegend(e.target.checked)}
              className="accent-teal-400"
            />
          </label>
          {!isNetwork && !isOverview && (
            <label className="flex items-center justify-between text-[11px] text-text-secondary cursor-pointer py-0.5">
              <span>Minimap</span>
              <input
                type="checkbox"
                checked={showMinimap}
                onChange={(e) => setShowMinimap(e.target.checked)}
                className="accent-teal-400"
              />
            </label>
          )}
        </div>
      </div>
    </div>
  )
}

function ExplorerSection() {
  const snapshot = useGraphStore((s) => s.snapshot)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const selectNodeInGraph = useGraphStore((s) => s.selectNodeInGraph)
  const openFileInCodeView = useGraphStore((s) => s.openFileInCodeView)
  const explorerViewMode = useGraphStore((s) => s.explorerViewMode)
  const setExplorerViewMode = useGraphStore((s) => s.setExplorerViewMode)

  if (!snapshot) return null

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1.5 px-3 h-7 shrink-0 border-b border-border-subtle">
        <FileCode className="w-3 h-3 text-text-muted" />
        <span className="text-[10px] uppercase tracking-wider text-text-muted">
          Project Explorer
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ProjectExplorer
          nodes={snapshot.nodes}
          projectPath={snapshot.projectPath}
          selectedId={selectedNodeId}
          onSelect={selectNodeInGraph}
          onOpen={openFileInCodeView}
          viewMode={explorerViewMode}
          onViewModeChange={setExplorerViewMode}
        />
      </div>
    </div>
  )
}

export function GraphSidebar({ onRelayout }: GraphSidebarProps) {
  const collapsed = useGraphStore((s) => s.secondarySidebarCollapsed)
  const toggle = useGraphStore((s) => s.toggleSecondarySidebar)

  return (
    <CollapsibleSidebar
      collapsed={collapsed}
      onToggle={toggle}
      title="Graph"
      railIcon={<SlidersHorizontal className="w-4 h-4" />}
      fill
    >
      <ResizableVerticalSplit
        storageKey="prebase:graph-sidebar-split"
        initialTopFraction={0.58}
        top={<GraphControls onRelayout={onRelayout} />}
        bottom={<ExplorerSection />}
      />
    </CollapsibleSidebar>
  )
}

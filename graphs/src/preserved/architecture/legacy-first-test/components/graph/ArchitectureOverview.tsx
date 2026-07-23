import { memo, useMemo } from 'react'
import { ArrowDown, Boxes, Database, FileCode, Network, Wrench } from 'lucide-react'
import { useGraphStore } from '../../state/graph-store'
import { tagNode, type ArchitectureMode } from '../../utils/architecture-modes'

interface ModeCard {
  id: Exclude<ArchitectureMode, 'overview'>
  label: string
  icon: typeof Boxes
  relation: string
  describe: string
}

const CARDS: ModeCard[] = [
  {
    id: 'product',
    label: 'Product View',
    icon: Boxes,
    relation: 'organizes',
    describe: 'Entry, routes, features, hooks & data flow'
  },
  {
    id: 'file',
    label: 'File View',
    icon: FileCode,
    relation: 'declares',
    describe: 'The source files that implement the product'
  },
  {
    id: 'dependency',
    label: 'Dependency View',
    icon: Network,
    relation: 'reveals',
    describe: 'How files import and depend on each other'
  },
  {
    id: 'state',
    label: 'State / Data View',
    icon: Database,
    relation: 'supported by',
    describe: 'Hooks, context, stores, APIs & data clients'
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure View',
    icon: Wrench,
    relation: '',
    describe: 'Configs, build tooling, package & env files'
  }
]

/**
 * Meta-architecture overview: a concise, static map of how the five architecture
 * modes relate. Pure DOM (no graph engine) so it is cheap to render and never
 * contributes to graph render pressure. Clicking a card switches to that mode.
 */
function ArchitectureOverviewComponent() {
  const snapshot = useGraphStore((s) => s.snapshot)
  const setArchitectureMode = useGraphStore((s) => s.setArchitectureMode)

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      product: 0,
      file: 0,
      dependency: 0,
      state: 0,
      infrastructure: 0
    }
    if (!snapshot) return c
    for (const node of snapshot.nodes) {
      if (node.kind === 'folder') continue
      const t = tagNode(node, snapshot.entryNodeId)
      if (t.source) c.file++
      if (t.source) c.dependency++
      if (t.route || t.component || t.hook || t.context || t.entry) c.product++
      if (t.data || t.entry) c.state++
      if (t.config || t.infra) c.infrastructure++
    }
    return c
  }, [snapshot])

  return (
    <div className="flex-1 h-full overflow-y-auto sidebar-scroll graph-dot-surface">
      <div className="max-w-xl mx-auto px-6 py-10">
        <div className="mb-6">
          <h2 className="text-base font-semibold text-text-primary">Architecture overview</h2>
          <p className="text-xs text-text-muted mt-1">
            PreBase splits the architecture into focused layers. Pick a layer to explore it.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-0">
          {CARDS.map((card, i) => {
            const Icon = card.icon
            return (
              <div key={card.id} className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => setArchitectureMode(card.id)}
                  className="w-full group flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-raised px-4 py-3 text-left hover:border-accent/40 hover:bg-surface-overlay transition-colors"
                >
                  <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-surface-muted text-accent shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-text-primary">{card.label}</span>
                      <span className="text-[10px] tabular-nums text-text-muted">
                        {counts[card.id]} nodes
                      </span>
                    </span>
                    <span className="block text-[11px] text-text-muted mt-0.5 truncate">
                      {card.describe}
                    </span>
                  </span>
                </button>
                {i < CARDS.length - 1 && (
                  <div className="flex flex-col items-center py-1 text-text-muted">
                    <ArrowDown className="w-3.5 h-3.5" />
                    {card.relation && (
                      <span className="text-[9px] uppercase tracking-wider -mt-0.5">
                        {card.relation}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const ArchitectureOverview = memo(ArchitectureOverviewComponent)

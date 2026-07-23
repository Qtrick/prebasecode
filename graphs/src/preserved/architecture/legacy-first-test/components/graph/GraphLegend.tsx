import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useGraphStore } from '../../state/graph-store'

const NODE_ITEMS = [
  { color: '#f59e0b', label: 'Entry' },
  { color: '#a78bfa', label: 'Component' },
  { color: '#6366f1', label: 'Module' },
  { color: '#71717a', label: 'Folder' }
]

const EDGE_ITEMS = [
  { color: 'rgba(255,255,255,0.32)', label: 'Import', dashed: false },
  { color: 'rgba(245,158,11,0.55)', label: 'Entry link', dashed: false },
  { color: 'rgba(52,211,153,0.55)', label: 'Service use', dashed: false },
  { color: 'rgba(113,113,122,0.55)', label: 'Utility', dashed: true },
  { color: 'rgba(167,139,250,0.5)', label: 'Component use', dashed: false },
  { color: 'rgba(168,85,247,0.55)', label: 'Dynamic import', dashed: true },
  { color: 'rgba(113,113,122,0.45)', label: 'Folder link', dashed: true },
  { color: 'rgba(113,113,122,0.28)', label: 'Contains', dashed: true },
  { color: 'rgba(45,212,191,0.65)', label: 'Focused', dashed: false }
]

export function GraphLegend() {
  const showLegend = useGraphStore((s) => s.showLegend)
  const collapsed = useGraphStore((s) => s.legendCollapsed)
  const setCollapsed = useGraphStore((s) => s.setLegendCollapsed)

  if (!showLegend) return null

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="absolute top-4 left-4 z-20 max-w-[210px]"
    >
      <div className="rounded-xl border border-border-subtle bg-surface-overlay/75 backdrop-blur-md shadow-panel overflow-hidden">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-between w-full px-3 py-2 text-[11px] font-medium text-text-secondary hover:bg-surface-muted/50 transition-colors"
        >
          <span>Legend</span>
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>

        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="px-3 pb-2.5 space-y-2"
            >
              <div>
                <p className="text-[9px] uppercase tracking-wider text-text-muted mb-1">Nodes</p>
                <div className="space-y-0.5">
                  {NODE_ITEMS.map((item) => (
                    <div key={item.label} className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-[10px] text-text-secondary">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-wider text-text-muted mb-1">Edges</p>
                <div className="space-y-0.5">
                  {EDGE_ITEMS.map((item) => (
                    <div key={item.label} className="flex items-center gap-1.5">
                      <span
                        className="w-5 h-0 shrink-0"
                        style={{
                          borderTop: item.dashed
                            ? `2px dashed ${item.color}`
                            : `2px solid ${item.color}`
                        }}
                      />
                      <span className="text-[10px] text-text-secondary">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

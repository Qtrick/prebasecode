import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { GraphNode } from '../../../../core/types'
import { rankGraphSearchResults } from '../../utils/graph-search'
import { useGraphStore } from '../../state/graph-store'

interface GraphSearchPanelProps {
  nodes: GraphNode[]
}

export function GraphSearchPanel({ nodes }: GraphSearchPanelProps) {
  const searchQuery = useGraphStore((s) => s.searchQuery)
  const setSearchQuery = useGraphStore((s) => s.setSearchQuery)
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId)
  const setFocusedNodeId = useGraphStore((s) => s.setFocusedNodeId)
  const setInspectorOpen = useGraphStore((s) => s.setInspectorOpen)

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(
    () => rankGraphSearchResults(nodes, searchQuery),
    [nodes, searchQuery]
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [searchQuery])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open, results.length])

  const selectResult = (nodeId: string) => {
    setSelectedNodeId(nodeId)
    setFocusedNodeId(nodeId)
    setInspectorOpen(true)
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault()
      selectResult(results[activeIndex].node.id)
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search files..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        onKeyDown={onKeyDown}
        className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-md bg-surface-overlay border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40"
      />
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-border-subtle bg-[#0f1012] shadow-[0_12px_28px_rgba(0,0,0,0.45)] overflow-hidden"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div
            ref={listRef}
            className="max-h-56 overflow-y-auto sidebar-scroll py-1"
          >
            {results.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-text-muted">No matching files</p>
            ) : (
              results.map(({ node, matchKind }, index) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => selectResult(node.id)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`w-full flex flex-col items-start px-3 py-1.5 text-left transition-colors ${
                    index === activeIndex
                      ? 'bg-accent-soft text-accent'
                      : 'text-text-secondary hover:bg-surface-muted/60'
                  }`}
                >
                  <span className="text-xs font-medium truncate w-full">{node.label}</span>
                  <span className="text-[10px] text-text-muted truncate w-full">
                    {node.path ?? ''}
                    {matchKind === 'exact' && (
                      <span className="ml-1 text-accent/70">· exact</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
          <p className="px-3 py-1 text-[9px] text-text-muted border-t border-border-subtle/60">
            {results.length} file{results.length !== 1 ? 's' : ''} · ↑↓ navigate · Enter select
          </p>
        </div>
      )}
    </div>
  )
}

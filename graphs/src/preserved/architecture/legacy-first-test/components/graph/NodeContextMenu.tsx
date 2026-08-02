import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Code2, Focus, Info } from 'lucide-react'
import { motion } from 'framer-motion'
import { useGraphStore } from '../../state/graph-store'

interface NodeContextMenuProps {
  x: number
  y: number
  nodeId: string
  onClose: () => void
}

export function NodeContextMenu({ x, y, nodeId, onClose }: NodeContextMenuProps) {
  const openFileInCodeView = useGraphStore((s) => s.openFileInCodeView)
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId)
  const setFocusedNodeId = useGraphStore((s) => s.setFocusedNodeId)
  const setInspectorOpen = useGraphStore((s) => s.setInspectorOpen)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const items = [
    {
      icon: Info,
      label: 'View details',
      action: () => {
        setSelectedNodeId(nodeId)
        setFocusedNodeId(nodeId)
        setInspectorOpen(true)
        onClose()
      }
    },
    {
      icon: Code2,
      label: 'Open in Code View',
      action: () => {
        openFileInCodeView(nodeId)
        onClose()
      }
    },
    {
      icon: Focus,
      label: 'Focus in graph',
      action: () => {
        setFocusedNodeId(nodeId)
        setSelectedNodeId(nodeId)
        setInspectorOpen(true)
        onClose()
      }
    }
  ]

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.12 }}
      style={{ position: 'fixed', top: y, left: x, zIndex: 10000 }}
      className="min-w-[180px] py-1 rounded-xl border border-border-subtle bg-surface-overlay shadow-panel titlebar-no-drag"
    >
      {items.map(({ icon: Icon, label, action }) => (
        <button
          key={label}
          type="button"
          onClick={action}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-surface-muted/80 transition-colors"
        >
          <Icon className="w-3.5 h-3.5 shrink-0 text-text-muted" />
          {label}
        </button>
      ))}
    </motion.div>,
    document.body
  )
}

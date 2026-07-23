import { memo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Box, ChevronRight, FileCode, Folder, FolderOpen, Layers, Star, Zap } from 'lucide-react'
import {
  FLOW_ENTRY_HEIGHT,
  FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH
} from '../../utils/flow-adapter'

export interface ArchitectureNodeData {
  label: string
  kind: string
  path?: string
  color: string
  dimmed?: boolean
  softDimmed?: boolean
  highlighted?: boolean
  searchHighlight?: 'none' | 'soft' | 'strong'
  focused?: boolean
  selected?: boolean
  canDrag?: boolean
  isEntry?: boolean
  isFolder?: boolean
  folderExpanded?: boolean
  childCount?: number
  description?: string
  meta?: {
    exports?: string[]
    imports?: string[]
    isComponent?: boolean
  }
}

const SIDE_HANDLES = [
  { side: 'top', position: Position.Top },
  { side: 'right', position: Position.Right },
  { side: 'bottom', position: Position.Bottom },
  { side: 'left', position: Position.Left }
] as const

const kindIcons: Record<string, typeof FileCode> = {
  folder: Folder,
  file: FileCode,
  component: Layers,
  function: Zap,
  service: Box,
  module: FileCode
}

function ArchitectureNodeComponent({ data, selected: rfSelected }: NodeProps) {
  const d = data as unknown as ArchitectureNodeData
  const [hovered, setHovered] = useState(false)
  const isSelected = d.selected || rfSelected
  const isFolder = d.isFolder || d.kind === 'folder'
  const canDrag = d.canDrag === true
  const Icon = d.isEntry
    ? Star
    : isFolder
      ? d.folderExpanded
        ? FolderOpen
        : Folder
      : (kindIcons[d.kind] ?? FileCode)

  const opacity = d.dimmed ? 0.6 : d.softDimmed ? 0.82 : 1
  const nodeHeight = d.isEntry ? FLOW_ENTRY_HEIGHT : FLOW_NODE_HEIGHT

  let boxShadow: string
  if (isSelected) {
    boxShadow = '0 0 0 2px rgba(45,212,191,0.7)'
  } else if (hovered) {
    boxShadow = '0 0 0 1px rgba(45,212,191,0.38)'
  } else if (d.focused) {
    boxShadow = '0 0 0 1px rgba(45,212,191,0.2)'
  } else if (d.searchHighlight === 'strong') {
    boxShadow = '0 0 0 1.5px rgba(45,212,191,0.45)'
  } else if (d.searchHighlight === 'soft') {
    boxShadow = '0 0 0 1px rgba(45,212,191,0.24)'
  } else if (d.highlighted) {
    boxShadow = '0 0 0 1px rgba(45,212,191,0.16)'
  } else if (d.isEntry) {
    boxShadow = '0 0 0 1px rgba(245,158,11,0.28)'
  } else if (isFolder && d.folderExpanded) {
    boxShadow = '0 0 0 1px rgba(113,113,122,0.22)'
  } else {
    boxShadow = 'none'
  }

  let background: string
  if (isSelected) {
    background = '#1a2422'
  } else if (d.isEntry) {
    background = '#1a1810'
  } else if (isFolder) {
    background = d.folderExpanded ? '#242428' : '#161618'
  } else if (d.searchHighlight === 'strong' && !isSelected) {
    background = '#181a1e'
  } else if (d.searchHighlight === 'soft' && !isSelected) {
    background = '#181a1e'
  } else if (d.highlighted && !isSelected) {
    background = '#181a1e'
  } else {
    background = '#161618'
  }

  let borderColor: string
  if (isSelected) {
    borderColor = 'rgba(45,212,191,0.78)'
  } else if (hovered) {
    borderColor = 'rgba(45,212,191,0.4)'
  } else if (d.focused && !isSelected) {
    borderColor = 'rgba(45,212,191,0.26)'
  } else if (d.isEntry) {
    borderColor = 'rgba(245,158,11,0.36)'
  } else if (isFolder) {
    borderColor = d.folderExpanded ? 'rgba(161,161,170,0.26)' : 'rgba(255,255,255,0.08)'
  } else if (d.searchHighlight === 'strong' && !isSelected) {
    borderColor = 'rgba(45,212,191,0.5)'
  } else if (d.searchHighlight === 'soft' && !isSelected) {
    borderColor = 'rgba(45,212,191,0.28)'
  } else if (d.highlighted && !isSelected) {
    borderColor = 'rgba(45,212,191,0.2)'
  } else {
    borderColor = 'rgba(255,255,255,0.06)'
  }

  const cursorClass = canDrag ? 'prebase-drag-ready' : 'prebase-nodrag'
  const tooltip = isFolder
    ? `${d.label} — click to select, click again to ${d.folderExpanded ? 'collapse' : 'expand'}`
    : [d.path, d.description].filter(Boolean).join('\n\n')

  return (
    <>
      {SIDE_HANDLES.map(({ side, position }) => (
        <Handle
          key={`s-${side}`}
          id={`s-${side}`}
          type="source"
          position={position}
          isConnectable={false}
          className="!opacity-0 !w-1.5 !h-1.5 !border-0 !bg-transparent !pointer-events-none"
        />
      ))}
      {SIDE_HANDLES.map(({ side, position }) => (
        <Handle
          key={`t-${side}`}
          id={`t-${side}`}
          type="target"
          position={position}
          isConnectable={false}
          className="!opacity-0 !w-1.5 !h-1.5 !border-0 !bg-transparent !pointer-events-none"
        />
      ))}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={tooltip || undefined}
        className={`architecture-node relative z-[1] flex flex-col items-center justify-center gap-0.5 rounded-md select-none px-1 py-1 border ${cursorClass} ${
          isSelected ? 'ring-1 ring-teal-400/35' : hovered ? 'ring-1 ring-teal-400/18' : ''
        }`}
        style={{
          width: FLOW_NODE_WIDTH,
          height: nodeHeight,
          minHeight: nodeHeight,
          maxHeight: nodeHeight,
          background,
          borderColor,
          boxShadow,
          opacity,
          transition:
            'background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease'
        }}
      >
        {isFolder && (
          <ChevronRight
            className="absolute left-1 top-1 w-2.5 h-2.5 text-text-muted shrink-0 transition-transform duration-200"
            style={{ transform: d.folderExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
        )}
        <div
          className="flex items-center justify-center w-6 h-6 rounded shrink-0"
          style={{ backgroundColor: `${d.color}1a` }}
        >
          <Icon className="w-3 h-3" style={{ color: d.color }} />
        </div>
        <span
          className={`text-[9px] font-medium truncate leading-tight text-center w-full px-0.5 ${
            isSelected ? 'text-teal-50' : 'text-text-primary'
          }`}
        >
          {d.label}
        </span>
        {d.isEntry ? (
          <span className="text-[7px] text-amber-400/80 uppercase tracking-wider -mt-0.5">
            Entry
          </span>
        ) : isFolder ? (
          <span className="text-[8px] text-text-muted -mt-0.5">{d.childCount ?? 0} items</span>
        ) : null}
        {d.meta?.imports && d.meta.imports.length > 0 && !d.isEntry && !isFolder && (
          <span
            className="absolute -top-1 -right-1 flex h-3 min-w-3 items-center justify-center rounded-full px-0.5 text-[7px] border"
            style={{
              background: isSelected ? 'rgba(45,212,191,0.2)' : 'rgba(36,36,40,1)',
              borderColor: isSelected ? 'rgba(45,212,191,0.4)' : 'rgba(255,255,255,0.08)',
              color: isSelected ? 'rgba(45,212,191,0.92)' : 'rgba(161,161,170,0.88)'
            }}
          >
            {d.meta.imports.length}
          </span>
        )}
      </div>
    </>
  )
}

export const ArchitectureNode = memo(ArchitectureNodeComponent)

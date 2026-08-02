import { memo } from 'react'
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import type { EdgeVisualVariant } from '../../utils/flow-adapter'

function ArchitectureEdgeComponent(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
    data
  } = props

  const variant = (data as { variant?: EdgeVisualVariant; curvature?: number })?.variant ?? 'import'
  const curvature =
    (data as { curvature?: number })?.curvature ??
    (variant === 'dynamic' ? 0.35 : 0.28)

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature
  })

  const stroke = (style.stroke as string) ?? 'rgba(255,255,255,0.35)'
  const strokeWidth = Number(style.strokeWidth ?? 1.15)
  const opacity = Number(style.opacity ?? 0.9)
  const isHierarchy = !!(data as { isHierarchyLayout?: boolean })?.isHierarchyLayout
  const edgeEmphasis = (data as { edgeEmphasis?: string })?.edgeEmphasis
  const isEmphasized =
    variant === 'highlighted' ||
    variant === 'selected' ||
    variant === 'entry' ||
    edgeEmphasis === 'connected' ||
    edgeEmphasis === 'primary'

  // Dark halo behind edge improves contrast over colored ring backgrounds
  const haloWidth =
    strokeWidth + (isHierarchy ? (isEmphasized ? 5.4 : 4.4) : 3.2)
  const haloOpacity = isHierarchy
    ? isEmphasized
      ? Math.min(1, opacity * 1.0)
      : Math.min(1, opacity * 0.96)
    : Math.min(1, opacity * 0.95)
  const haloStroke = isHierarchy
    ? isEmphasized
      ? 'rgba(1,1,3,0.92)'
      : 'rgba(2,2,4,0.86)'
    : 'rgba(6,6,8,0.72)'
  const isDashed = (style as { strokeDasharray?: string }).strokeDasharray != null ||
    variant === 'dynamic' || variant === 'utility' || variant === 'folder-link' || variant === 'contains'

  return (
    <g className="react-flow__edge" style={{ pointerEvents: 'none' }}>
      {/* Dark contrast halo rendered beneath the colored edge */}
      <path
        d={edgePath}
        fill="none"
        stroke={haloStroke}
        strokeWidth={haloWidth}
        strokeLinecap="round"
        strokeDasharray={isDashed ? (style as { strokeDasharray?: string }).strokeDasharray : undefined}
        opacity={haloOpacity}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={0}
        className="react-flow__edge-path"
        style={{
          ...style,
          stroke,
          strokeWidth,
          opacity,
          fill: 'none',
          pointerEvents: 'none'
        }}
      />
    </g>
  )
}

export const ArchitectureEdge = memo(ArchitectureEdgeComponent)

import type { NetworkLayoutMode } from '../../utils/network-layout'
import { layoutNetworkGraph } from '../../utils/network-layout'
import {
  applyGraphRotation3D,
  IDENTITY_ORIENTATION
} from '../../utils/network-rotation'
import { useNetworkControls } from '../../state/network-controls-store'
import type { NetworkLink, NetworkNode } from '../../utils/network-model'

export function computeNetworkSphereRadius(nodeCount: number, spreadScale: number): number {
  return Math.max(190, Math.min(310, Math.sqrt(Math.max(1, nodeCount)) * 22)) * spreadScale
}

export interface PositionedNetworkNode extends NetworkNode {
  x: number
  y: number
  fx: number
  fy: number
}

export interface PositionedNetworkGraphResult {
  layout: Map<string, import('../../utils/network-layout').Point3D>
  nodes: PositionedNetworkNode[]
  sphereRadius: number
  layoutMode: NetworkLayoutMode
  spreadScale: number
  usedFallback: boolean
}

function positionNodesFromLayout(
  nodes: NetworkNode[],
  layout: Map<string, import('../../utils/network-layout').Point3D>
): PositionedNetworkNode[] {
  return nodes.map((node) => {
    const base = layout.get(node.id)
    if (!base) {
      return { ...node, x: 0, y: 0, fx: 0, fy: 0 }
    }
    const projected = applyGraphRotation3D(base, 0, 0, IDENTITY_ORIENTATION)
    return {
      ...node,
      x: projected.x,
      y: projected.y,
      fx: projected.x,
      fy: projected.y
    }
  })
}

/** Read sidebar settings at call time and generate positioned nodes. */
export function buildPositionedNetworkGraph(
  nodes: NetworkNode[],
  links: NetworkLink[],
  overrides?: { layoutMode?: NetworkLayoutMode; spreadScale?: number }
): PositionedNetworkGraphResult {
  const controls = useNetworkControls.getState()
  const layoutMode = overrides?.layoutMode ?? controls.layoutMode
  const spreadScale = overrides?.spreadScale ?? controls.spreadScale
  const sphereRadius = computeNetworkSphereRadius(nodes.length, spreadScale)

  try {
    const layout = layoutNetworkGraph(layoutMode, nodes, links, sphereRadius)
    return {
      layout,
      nodes: positionNodesFromLayout(nodes, layout),
      sphereRadius,
      layoutMode,
      spreadScale,
      usedFallback: false
    }
  } catch (primaryError) {
    try {
      const fallbackLayout = layoutNetworkGraph('sphere', nodes, links, sphereRadius)
      return {
        layout: fallbackLayout,
        nodes: positionNodesFromLayout(nodes, fallbackLayout),
        sphereRadius,
        layoutMode: 'sphere',
        spreadScale,
        usedFallback: true
      }
    } catch {
      throw primaryError
    }
  }
}

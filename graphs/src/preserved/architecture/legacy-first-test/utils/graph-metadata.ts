import type { GraphEdge, GraphNode, GraphSnapshot } from '../../../core/types'

export interface NodeConnection {
  nodeId: string
  label: string
  path?: string
  relationship: string
  importSource?: string
  isDynamic?: boolean
}

export interface NodeInspectorData {
  node: GraphNode
  incoming: GraphEdge[]
  outgoing: GraphEdge[]
  incomingLabels: string[]
  outgoingLabels: string[]
  incomingConnections: NodeConnection[]
  outgoingConnections: NodeConnection[]
}

function describeRelationship(
  edge: GraphEdge,
  direction: 'incoming' | 'outgoing',
  other: GraphNode
): string {
  if (edge.meta?.isDynamic) return 'Dynamic import'
  if (other.kind === 'component' || other.meta?.isComponent) {
    return direction === 'outgoing' ? 'Imports component' : 'Imported by component'
  }
  if (other.meta?.architectureLayer === 'services' || other.kind === 'service') {
    return direction === 'outgoing' ? 'Uses service' : 'Used as service'
  }
  return direction === 'outgoing' ? 'Import dependency' : 'Dependent import'
}

function connectionFromEdge(
  snapshot: GraphSnapshot,
  edge: GraphEdge,
  direction: 'incoming' | 'outgoing'
): NodeConnection | null {
  const otherId = direction === 'incoming' ? edge.source : edge.target
  const other = snapshot.nodes.find((n) => n.id === otherId)
  if (!other) return null
  return {
    nodeId: other.id,
    label: other.label,
    path: other.path,
    relationship: describeRelationship(edge, direction, other),
    importSource: edge.meta?.importSource,
    isDynamic: edge.meta?.isDynamic
  }
}

export interface EdgeInspectorData {
  edge: GraphEdge
  sourceNode: GraphNode
  targetNode: GraphNode
  description: string
  reason: string
}

export function getNodeInspectorData(
  snapshot: GraphSnapshot,
  nodeId: string
): NodeInspectorData | null {
  const node = snapshot.nodes.find((n) => n.id === nodeId)
  if (!node) return null

  const incoming = snapshot.edges.filter((e) => e.target === nodeId && e.kind === 'import')
  const outgoing = snapshot.edges.filter((e) => e.source === nodeId && e.kind === 'import')

  const labelFor = (id: string) =>
    snapshot.nodes.find((n) => n.id === id)?.label ?? id.replace('file:', '')

  const incomingConnections = incoming
    .map((e) => connectionFromEdge(snapshot, e, 'incoming'))
    .filter((c): c is NodeConnection => c !== null)
  const outgoingConnections = outgoing
    .map((e) => connectionFromEdge(snapshot, e, 'outgoing'))
    .filter((c): c is NodeConnection => c !== null)

  return {
    node,
    incoming,
    outgoing,
    incomingLabels: incoming.map((e) => labelFor(e.source)),
    outgoingLabels: outgoing.map((e) => labelFor(e.target)),
    incomingConnections,
    outgoingConnections
  }
}

export function getEdgeInspectorData(
  snapshot: GraphSnapshot,
  edgeId: string
): EdgeInspectorData | null {
  const edge = snapshot.edges.find((e) => e.id === edgeId)
  if (!edge) return null

  const sourceNode = snapshot.nodes.find((n) => n.id === edge.source)
  const targetNode = snapshot.nodes.find((n) => n.id === edge.target)
  if (!sourceNode || !targetNode) return null

  const specifiers = edge.meta?.specifiers?.filter((s) => s !== 'require') ?? []
  const importLine = edge.meta?.importSource ?? ''
  const isDynamic = edge.meta?.isDynamic

  let description = `${sourceNode.label} imports ${targetNode.label}`
  if (importLine) description += ` via '${importLine}'`

  let reason = 'Module dependency — source file resolves and uses the target module.'
  if (isDynamic) {
    reason = 'Dynamic import — loaded at runtime rather than static bundling.'
  } else if (targetNode.meta?.isComponent || targetNode.kind === 'component') {
    reason = 'Component dependency — likely used in JSX/render tree of the source file.'
  } else if (specifiers.length > 0) {
    reason = `Imports named exports: ${specifiers.join(', ')}`
  } else if (edge.meta?.isDefault) {
    reason = 'Default import — primary export from the target module.'
  }

  return { edge, sourceNode, targetNode, description, reason }
}

export function buildFileTree(
  nodes: GraphNode[]
): Map<string, GraphNode[]> {
  const files = nodes.filter(
    (n) => n.kind === 'file' || n.kind === 'component' || n.kind === 'module'
  )
  const byDir = new Map<string, GraphNode[]>()

  for (const f of files) {
    const path = f.path ?? f.label
    const parts = path.split('/')
    parts.pop()
    const dir = parts.join('/') || '(root)'
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir)!.push(f)
  }

  return byDir
}

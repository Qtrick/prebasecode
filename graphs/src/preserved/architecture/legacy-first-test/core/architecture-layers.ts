import type { GraphEdge, GraphNode } from '../types'
import { isMetadataFile } from '../utils/project-files'

export type ArchitectureLayerId =
  | 'entry'
  | 'frontend'
  | 'ui'
  | 'components'
  | 'api'
  | 'auth'
  | 'services'
  | 'backend'
  | 'database'
  | 'utils'
  | 'config'
  | 'tests'
  | 'other'

export interface ArchitectureLayerDef {
  id: ArchitectureLayerId
  label: string
  color: string
  defaultEnabled: boolean
}

export const ARCHITECTURE_LAYERS: ArchitectureLayerDef[] = [
  { id: 'entry', label: 'Entry', color: '#f59e0b', defaultEnabled: true },
  { id: 'frontend', label: 'Frontend', color: '#818cf8', defaultEnabled: true },
  { id: 'ui', label: 'UI', color: '#a78bfa', defaultEnabled: true },
  { id: 'components', label: 'Components', color: '#c084fc', defaultEnabled: true },
  { id: 'api', label: 'API', color: '#38bdf8', defaultEnabled: true },
  { id: 'auth', label: 'Auth', color: '#f472b6', defaultEnabled: true },
  { id: 'services', label: 'Services', color: '#34d399', defaultEnabled: true },
  { id: 'backend', label: 'Backend', color: '#2dd4bf', defaultEnabled: true },
  { id: 'database', label: 'Database', color: '#fb923c', defaultEnabled: true },
  { id: 'utils', label: 'Utilities', color: '#71717a', defaultEnabled: true },
  { id: 'config', label: 'Config', color: '#52525b', defaultEnabled: true },
  { id: 'tests', label: 'Tests', color: '#52525b', defaultEnabled: true },
  { id: 'other', label: 'Other', color: '#6366f1', defaultEnabled: true }
]

function pathSegments(p: string): string[] {
  return p.split('/').filter(Boolean)
}

function hasSegment(p: string, ...names: string[]): boolean {
  const segs = pathSegments(p)
  return segs.some((s) => names.includes(s.toLowerCase()))
}

function classifyJvmLayer(p: string): ArchitectureLayerId | null {
  if (hasSegment(p, 'controller', 'controllers', 'rest', 'resource', 'resources')) return 'api'
  if (hasSegment(p, 'service', 'services')) return 'services'
  if (hasSegment(p, 'repository', 'repositories', 'dao', 'model', 'models', 'entity', 'entities', 'domain')) {
    return 'database'
  }
  if (hasSegment(p, 'config', 'configuration')) return 'config'
  if (hasSegment(p, 'util', 'utils', 'helper', 'helpers')) return 'utils'
  if (hasSegment(p, 'test', 'tests')) return 'tests'
  if (hasSegment(p, 'ui', 'view', 'views', 'screen', 'screens', 'activity', 'activities')) return 'ui'
  if (hasSegment(p, 'component', 'components')) return 'components'
  return null
}

function classifyPythonLayer(p: string): ArchitectureLayerId | null {
  if (hasSegment(p, 'api', 'routes', 'views', 'endpoints')) return 'api'
  if (hasSegment(p, 'services', 'service')) return 'services'
  if (hasSegment(p, 'models', 'model', 'db', 'database')) return 'database'
  if (hasSegment(p, 'utils', 'util', 'helpers', 'lib')) return 'utils'
  if (hasSegment(p, 'tests', 'test')) return 'tests'
  if (hasSegment(p, 'config', 'settings')) return 'config'
  return null
}

function classifyGoLayer(p: string): ArchitectureLayerId | null {
  if (hasSegment(p, 'cmd', 'main')) return 'backend'
  if (hasSegment(p, 'internal', 'pkg')) return 'services'
  if (hasSegment(p, 'api', 'handler', 'handlers', 'route', 'routes')) return 'api'
  if (hasSegment(p, 'model', 'models', 'store', 'repository')) return 'database'
  if (hasSegment(p, 'util', 'utils')) return 'utils'
  if (hasSegment(p, 'test', 'tests')) return 'tests'
  return null
}

function classifyRustLayer(p: string): ArchitectureLayerId | null {
  if (hasSegment(p, 'bin', 'main')) return 'backend'
  if (hasSegment(p, 'lib')) return 'services'
  if (hasSegment(p, 'api', 'handler', 'handlers')) return 'api'
  if (hasSegment(p, 'model', 'models', 'db')) return 'database'
  if (hasSegment(p, 'util', 'utils')) return 'utils'
  if (hasSegment(p, 'tests')) return 'tests'
  return null
}

export function classifyNodeLayer(path: string | undefined, isEntry?: boolean): ArchitectureLayerId {
  if (isEntry) return 'entry'
  const p = (path ?? '').toLowerCase().replace(/\\/g, '/')
  const ext = p.split('.').pop() ?? ''

  if (isMetadataFile(path ?? '')) return 'config'

  if (/\.(test|spec)\.(tsx?|jsx?|java|kt|kts|py|go|rs|cs|swift|rb|php)$/.test(p)) return 'tests'
  if (/__tests__|\/tests?\//.test(p)) return 'tests'

  if (ext === 'java' || ext === 'kt' || ext === 'kts') {
    const jvm = classifyJvmLayer(p)
    if (jvm) return jvm
  }
  if (ext === 'py') {
    const py = classifyPythonLayer(p)
    if (py) return py
  }
  if (ext === 'go') {
    const go = classifyGoLayer(p)
    if (go) return go
  }
  if (ext === 'rs') {
    const rs = classifyRustLayer(p)
    if (rs) return rs
  }

  if (/auth|login|session|oauth|passport/.test(p)) return 'auth'
  if (/\/api\/|\/routes\/|\/endpoints\/|\.route\.|\.controller\./.test(p)) return 'api'
  if (/prisma|database|db\/|\/models\/|drizzle|typeorm/.test(p)) return 'database'
  if (/\.service\.|\/services\/|\/service\//.test(p)) return 'services'
  if (/server\.|\/server\/|\/backend\/|express|fastify|hono/.test(p)) return 'backend'
  if (/components\/|\/components\/|\.component\./.test(p) || /[A-Z][a-zA-Z]+\.tsx$/.test(p)) {
    return 'components'
  }
  if (/pages\/|app\/|views\/|screens\/|layouts\//.test(p)) return 'ui'
  if (/src\/renderer|src\/ui|styles\/|\.css$|frontend/.test(p)) return 'frontend'
  if (/\/(utils?|helpers?|lib|common|shared)\//.test(p)) return 'utils'
  if (/hooks\/|store\/|state\//.test(p)) return 'frontend'

  return 'other'
}

export function assignLayersToNodes(nodes: GraphNode[], entryNodeId: string | null): GraphNode[] {
  return nodes.map((n) => {
    const isEntry = n.isEntry || n.id === entryNodeId
    const architectureLayer = classifyNodeLayer(n.path, isEntry)
    return {
      ...n,
      meta: { ...n.meta, architectureLayer }
    }
  })
}

export function buildDefaultLayerVisibility(): Record<ArchitectureLayerId, boolean> {
  const vis = {} as Record<ArchitectureLayerId, boolean>
  for (const layer of ARCHITECTURE_LAYERS) {
    vis[layer.id] = layer.defaultEnabled
  }
  return vis
}

export function countNodesPerLayer(nodes: GraphNode[]): Record<ArchitectureLayerId, number> {
  const counts = {} as Record<ArchitectureLayerId, number>
  for (const layer of ARCHITECTURE_LAYERS) counts[layer.id] = 0
  for (const n of nodes) {
    const id = (n.meta?.architectureLayer as ArchitectureLayerId) ?? 'other'
    counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}

export function computeNodeImportance(
  nodeId: string,
  edges: GraphEdge[]
): { inDegree: number; outDegree: number; score: number } {
  let inDegree = 0
  let outDegree = 0
  for (const e of edges) {
    if (e.kind !== 'import') continue
    if (e.target === nodeId) inDegree++
    if (e.source === nodeId) outDegree++
  }
  const score = inDegree * 1.2 + outDegree * 0.8
  return { inDegree, outDegree, score }
}

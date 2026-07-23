import type { GraphNode, GraphSnapshot } from '../../../core/types'
import type { ArchitectureLayerId } from '../../../core/utils/architecture-layers'
import { isMetadataFile } from '../../../core/utils/project-files'

export type ArchitectureMode =
  | 'product'
  | 'file'
  | 'dependency'
  | 'state'
  | 'infrastructure'
  | 'overview'

export interface ArchitectureModeDef {
  id: ArchitectureMode
  label: string
  blurb: string
  question: string
}

export const ARCHITECTURE_MODES: ArchitectureModeDef[] = [
  {
    id: 'product',
    label: 'Product',
    blurb: 'Entry → routes → features → hooks → data',
    question: 'How is the product structured?'
  },
  {
    id: 'file',
    label: 'File',
    blurb: 'Important source files, primitives collapsed',
    question: 'What files make up this part of the project?'
  },
  {
    id: 'dependency',
    label: 'Dependency',
    blurb: 'Imports & exports, top connections only',
    question: 'What depends on what?'
  },
  {
    id: 'state',
    label: 'State / Data',
    blurb: 'Hooks, context, stores, APIs, data clients',
    question: 'Where does data come from and how does state flow?'
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    blurb: 'Configs, build tools, package & env files',
    question: 'How is this project built, configured, and run?'
  },
  {
    id: 'overview',
    label: 'Overview',
    blurb: 'How the architecture modes relate',
    question: 'How do the architecture layers connect?'
  }
]

export interface NodeTags {
  entry: boolean
  route: boolean
  component: boolean
  hook: boolean
  context: boolean
  store: boolean
  api: boolean
  service: boolean
  supabase: boolean
  data: boolean
  uiPrimitive: boolean
  external: boolean
  config: boolean
  infra: boolean
  test: boolean
  style: boolean
  source: boolean
}

const CONFIG_FILE_RE =
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig.*\.json|jsconfig\.json|vite\.config\.[tj]s|webpack\.config\.[tj]s|rollup\.config\.[tj]s|electron\.vite\.config\.[tj]s|tailwind\.config\.[tj]s|postcss\.config\.[tj]s|\.eslintrc.*|eslint\.config\.[tj]s|\.prettierrc.*|prettier\.config\.[tj]s|babel\.config\.[tj]s|\.babelrc.*|jest\.config\.[tj]s|vitest\.config\.[tj]s|\.env.*|dockerfile|docker-compose\.ya?ml|\.gitignore|\.npmrc|netlify\.toml|vercel\.json)$/i

/** Classify a node into product/architecture tags using path + layer + label. */
export function tagNode(node: GraphNode, entryNodeId: string | null | undefined): NodeTags {
  const path = (node.path ?? '').toLowerCase().replace(/\\/g, '/')
  const label = node.label ?? ''
  const layer = node.meta?.architectureLayer as ArchitectureLayerId | undefined
  const ext = path.split('.').pop() ?? ''

  const entry = Boolean(node.isEntry || node.id === entryNodeId || layer === 'entry')
  const external = node.kind === 'module' || /node_modules\//.test(path)
  const config = !external && (isMetadataFile(node.path ?? '') || CONFIG_FILE_RE.test(path) || layer === 'config')
  const infra =
    config ||
    /(^|\/)(scripts?|build|deploy|\.github|ci)\//.test(path) ||
    /\.(yml|yaml|toml|sh)$/.test(path)
  const test = layer === 'tests' || /\.(test|spec)\.|__tests__|\/tests?\//.test(path)
  const style = /\.(css|scss|sass|less)$/.test(ext) || /\.(css|scss|sass|less)$/.test(path)

  const hook = /\/hooks?\//.test(path) || /^use[A-Z]/.test(label) || /\buse[A-Z]\w*\.[tj]sx?$/.test(path)
  const context =
    /context/i.test(path) || /provider/i.test(path) || /Context$|Provider$/.test(label) || layer === 'auth'
  const store = /\/(store|stores|state)\//.test(path) || /zustand|redux|\bstore\b/.test(path)
  const supabase = /supabase|firebase/.test(path)
  const api =
    layer === 'api' ||
    /\/api\//.test(path) ||
    /\bapi\.[tj]s$/.test(path) ||
    /client\.[tj]s$/.test(path) ||
    /\.(controller|route)\./.test(path)
  const service = layer === 'services' || /\.service\.|\/services?\//.test(path)
  const route =
    /\/(pages?|routes?|screens?|views?)\//.test(path) ||
    /\/app\/.*\/(page|layout|route)\.[tj]sx?$/.test(path)

  const uiPrimitive =
    !entry &&
    (/\/components?\/ui\//.test(path) || /\/(ui|primitives?|widgets?)\//.test(path)) &&
    layer !== 'entry'

  const component =
    !uiPrimitive &&
    (layer === 'components' ||
      layer === 'ui' ||
      (/[A-Z]\w+\.(tsx|jsx)$/.test(node.path ?? '') && !hook && !context))

  const data = api || service || supabase || store || context || hook

  const source =
    !external &&
    !config &&
    !infra &&
    (node.kind === 'file' || node.kind === 'component') &&
    /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rs|java|kt|rb|php|cs|swift)$/.test(path)

  return {
    entry,
    route,
    component,
    hook,
    context,
    store,
    api,
    service,
    supabase,
    data,
    uiPrimitive,
    external,
    config,
    infra,
    test,
    style,
    source
  }
}

/**
 * Resolve the focused set of node IDs to render for a given architecture mode.
 * This is the core of the "no longer show the entire project at once" redesign:
 * each mode renders only a relevant architectural slice. 'overview' is handled
 * by a dedicated component and returns an empty set here.
 */
export function getModeNodeIds(
  snapshot: GraphSnapshot,
  mode: ArchitectureMode
): Set<string> {
  const ids = new Set<string>()
  if (mode === 'overview') return ids

  const tagsById = new Map<string, NodeTags>()
  for (const node of snapshot.nodes) {
    if (node.kind === 'folder') continue
    tagsById.set(node.id, tagNode(node, snapshot.entryNodeId))
  }

  const include = (predicate: (t: NodeTags) => boolean) => {
    for (const [id, t] of tagsById) if (predicate(t)) ids.add(id)
  }

  switch (mode) {
    case 'product':
      // Entry → routes/pages → feature components → hooks/context → integrations.
      // UI primitives, externals, config/infra and tests are collapsed by default.
      include(
        (t) =>
          t.entry ||
          t.route ||
          (t.component && !t.uiPrimitive) ||
          t.hook ||
          t.context ||
          t.api ||
          t.service ||
          t.supabase ||
          t.store
      )
      break
    case 'file':
      // Important source files; UI primitives + externals + infra collapsed.
      include((t) => t.source && !t.uiPrimitive && !t.test)
      break
    case 'dependency':
      // Same source slice as File view — relationships are emphasized via edges.
      include((t) => t.source && !t.uiPrimitive && !t.test)
      break
    case 'state': {
      // Data/state nodes + their direct neighbors so flow (Component → hook → api) reads.
      include((t) => t.entry || t.data)
      const core = new Set(ids)
      for (const edge of snapshot.edges) {
        if (edge.kind !== 'import') continue
        if (core.has(edge.source) && tagsById.has(edge.target)) ids.add(edge.target)
        if (core.has(edge.target) && tagsById.has(edge.source)) ids.add(edge.source)
      }
      break
    }
    case 'infrastructure':
      include((t) => t.config || t.infra)
      break
  }

  // Never leave the slice empty (small projects / unusual layouts): fall back to
  // all non-folder nodes so the view is still useful.
  if (ids.size === 0) for (const id of tagsById.keys()) ids.add(id)
  return ids
}

export interface ModeControls {
  collapsePrimitives: boolean
  collapseExternal: boolean
}

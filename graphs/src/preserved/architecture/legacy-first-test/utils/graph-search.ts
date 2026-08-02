import type { GraphNode } from '../../../core/types'

export interface GraphSearchResult {
  node: GraphNode
  score: number
  matchKind: 'exact' | 'prefix' | 'partial' | 'fuzzy'
}

function fuzzyScore(query: string, text: string): number {
  let qi = 0
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++
  }
  if (qi < query.length) return 0
  return 20 + qi * 2
}

function scoreNode(node: GraphNode, query: string): GraphSearchResult | null {
  if (node.kind === 'folder') return null
  const label = node.label.toLowerCase()
  const path = (node.path ?? '').toLowerCase()
  const fileName = path.split('/').pop() ?? label

  if (label === query || fileName === query) {
    return { node, score: 1000, matchKind: 'exact' }
  }
  if (label.startsWith(query) || fileName.startsWith(query)) {
    return { node, score: 800 - (label.length - query.length), matchKind: 'prefix' }
  }
  if (label.includes(query) || path.includes(query)) {
    return { node, score: 500 - label.indexOf(query), matchKind: 'partial' }
  }
  const fuzzy = fuzzyScore(query, label) || fuzzyScore(query, fileName)
  if (fuzzy > 0) return { node, score: fuzzy, matchKind: 'fuzzy' }
  return null
}

/** Rank file nodes for graph search (empty query returns all files alphabetically). */
export function rankGraphSearchResults(
  nodes: GraphNode[],
  query: string,
  limit = 500
): GraphSearchResult[] {
  const fileNodes = nodes.filter(
    (n) => n.kind === 'file' || n.kind === 'component' || n.kind === 'module'
  )

  const q = query.trim().toLowerCase()

  if (!q) {
    return fileNodes
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      .slice(0, limit)
      .map((node) => ({ node, score: 0, matchKind: 'partial' as const }))
  }

  const results: GraphSearchResult[] = []
  for (const node of fileNodes) {
    const scored = scoreNode(node, q)
    if (scored) results.push(scored)
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function searchHighlightStrength(
  node: GraphNode,
  query: string
): 'none' | 'soft' | 'strong' {
  const q = query.trim().toLowerCase()
  if (!q) return 'none'
  const label = node.label.toLowerCase()
  const fileName = (node.path ?? '').split('/').pop()?.toLowerCase() ?? ''
  if (label === q || fileName === q) return 'strong'
  if (label.startsWith(q) || fileName.startsWith(q)) return 'strong'
  if (label.includes(q) || (node.path ?? '').toLowerCase().includes(q)) return 'soft'
  return 'none'
}

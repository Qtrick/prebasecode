import type { GraphSnapshot, ScannedFile } from '../types'
import { isMetadataFile } from '../utils/project-files'

export interface CompletenessReport {
  scannedCount: number
  nodeFileCount: number
  missingFromGraph: string[]
  extraInGraph: string[]
  folderCount: number
  isComplete: boolean
}

/** Compare scanned files against graph file nodes for audit / diagnostics. */
export function auditGraphCompleteness(
  scanned: ScannedFile[],
  snapshot: Pick<GraphSnapshot, 'nodes'>
): CompletenessReport {
  const scannedPaths = new Set(scanned.map((f) => f.relativePath))
  const graphFilePaths = new Set<string>()

  for (const node of snapshot.nodes) {
    if (node.kind === 'folder') continue
    if (!node.path) continue
    if (node.kind === 'module') continue
    graphFilePaths.add(node.path)
  }

  const missingFromGraph: string[] = []
  for (const path of scannedPaths) {
    if (!graphFilePaths.has(path)) missingFromGraph.push(path)
  }

  const extraInGraph: string[] = []
  for (const path of graphFilePaths) {
    if (!scannedPaths.has(path)) extraInGraph.push(path)
  }

  const folderCount = snapshot.nodes.filter((n) => n.kind === 'folder').length

  return {
    scannedCount: scanned.length,
    nodeFileCount: graphFilePaths.size,
    missingFromGraph: missingFromGraph.sort(),
    extraInGraph: extraInGraph.sort(),
    folderCount,
    isComplete: missingFromGraph.length === 0
  }
}

export function summarizeMissing(report: CompletenessReport): string {
  if (report.isComplete) {
    return `Graph complete: ${report.nodeFileCount} files, ${report.folderCount} folders`
  }
  const sample = report.missingFromGraph.slice(0, 5).join(', ')
  const more =
    report.missingFromGraph.length > 5
      ? ` (+${report.missingFromGraph.length - 5} more)`
      : ''
  return `Graph incomplete: ${report.missingFromGraph.length} scanned files missing (${sample}${more})`
}

export function isLowImportancePath(path: string | undefined): boolean {
  if (!path) return false
  const p = path.toLowerCase().replace(/\\/g, '/')
  const filename = p.split('/').pop() ?? p
  if (isMetadataFile(path)) return true
  if (/\.(test|spec)\.(tsx?|jsx?|java|kt|py|go|rs)$/.test(p)) return true
  if (/__tests__|\/tests?\//.test(p)) return true
  if (/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.lock)$/.test(filename)) return true
  if (/^\.(env|env\..*)$/.test(filename)) return true
  if (/^\.git(ignore|attributes|modules|keep)$/.test(filename)) return true
  if (/^(readme|changelog|license|contributing)(\.md)?$/i.test(filename)) return true
  if (/config|\.config\.|vite\.|webpack|tsconfig|eslint|prettier|babel|rollup|jest/.test(p)) {
    return true
  }
  if (/\/(utils?|helpers?|lib|common|shared)\//.test(p)) return true
  return false
}

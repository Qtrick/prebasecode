import type { GraphEdge } from '../../core/types'
import {
  getAnalysisEngineConfig,
  shouldUseRustFeature
} from '../native/analysisEngineConfig'
import { recordAnalysisTiming } from '../native/analysisEngineDiagnostics'
import { compareGraphCounts } from '../native/parity'
import { computeGraphMetricsNative, isNativeCoreLoaded } from '../native/prebaseCore'

export interface GraphMetricsResult {
  metrics: {
    fileCount: number
    edgeCount: number
    importEdgeCount: number
    connectedComponents: number
  }
  source: 'rust' | 'typescript'
  durationMs: number
}

export function computeGraphMetricsWithEngine(
  nodes: { id: string }[],
  edges: GraphEdge[]
): GraphMetricsResult {
  const config = getAnalysisEngineConfig()
  const nativeOk = isNativeCoreLoaded()
  const importEdges = edges.filter((e) => e.kind === 'import')
  const started = Date.now()

  if (shouldUseRustFeature(config, 'graphBuilder', nativeOk)) {
    const native = computeGraphMetricsNative(edges)
    if (native) {
      if (config.parityCheck) {
        compareGraphCounts(nodes.length, importEdges.length, native)
      }
      recordAnalysisTiming({
        stage: 'graph-metrics',
        source: 'rust',
        durationMs: native.durationMs || Date.now() - started,
        detail: `${native.importEdgeCount} import edges, ${native.connectedComponents} components`
      })
      return {
        metrics: {
          fileCount: native.fileCount,
          edgeCount: native.edgeCount,
          importEdgeCount: native.importEdgeCount,
          connectedComponents: native.connectedComponents
        },
        source: 'rust',
        durationMs: native.durationMs
      }
    }
  }

  const nodeIds = new Set<string>()
  for (const e of edges) {
    nodeIds.add(e.source)
    nodeIds.add(e.target)
  }
  const metrics = {
    fileCount: nodeIds.size,
    edgeCount: edges.length,
    importEdgeCount: importEdges.length,
    connectedComponents: 1
  }
  recordAnalysisTiming({
    stage: 'graph-metrics',
    source: 'typescript',
    durationMs: Date.now() - started,
    detail: `${metrics.importEdgeCount} import edges`
  })
  return { metrics, source: 'typescript', durationMs: Date.now() - started }
}

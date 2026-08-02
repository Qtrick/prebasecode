/** Dev-only graph instrumentation. Enable with localStorage `prebase:graph-debug=1`. */
export function graphDebug(section: string, data?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem('prebase:graph-debug') !== '1') return
  console.debug(`[GraphDebug:${section}]`, data ?? '')
}

let archRenderCount = 0
let lastArchLog = 0

export function debugArchRender(reason: string, extra?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem('prebase:graph-debug') !== '1') return
  archRenderCount++
  const now = performance.now()
  if (now - lastArchLog > 500) {
    console.debug(`[GraphDebug:arch-render] count=${archRenderCount} reason=${reason}`, extra)
    lastArchLog = now
  }
}

let networkMoveCount = 0
let lastNetworkLog = 0

export function debugNetworkDrag(data: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem('prebase:graph-debug') !== '1') return
  networkMoveCount++
  const now = performance.now()
  if (now - lastNetworkLog > 200) {
    console.debug(`[GraphDebug:network-drag] moves=${networkMoveCount}`, data)
    lastNetworkLog = now
  }
}

let tileWarnCount = 0

/** Hook into devtools — call from components when graph state changes. */
export function debugTilePressure(context: string, data: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem('prebase:graph-debug') !== '1') return
  tileWarnCount++
  if (tileWarnCount % 6 !== 0) return
  console.debug(`[GraphDebug:tile-pressure] ${context}`, {
    ...data,
    tileSamples: tileWarnCount
  })
}

export function debugNetworkEdge(data: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  if (import.meta.env.DEV) {
    console.debug('[NetworkEdge]', data)
    return
  }
  if (window.localStorage.getItem('prebase:graph-debug') !== '1') return
  console.debug('[NetworkEdge]', data)
}

export function debugNetworkLayout(data: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  if (import.meta.env.DEV) {
    console.debug('[NetworkLayout]', data)
    return
  }
  if (window.localStorage.getItem('prebase:graph-debug') !== '1') return
  console.debug('[NetworkLayout]', data)
}

export function debugGraphBounds(
  label: string,
  positions: Array<{ x: number; y: number }>
): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem('prebase:graph-debug') !== '1') return
  if (positions.length === 0) return
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of positions) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  console.debug(`[GraphDebug:bounds:${label}]`, {
    nodes: positions.length,
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY),
    maxExtent: Math.round(Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY)))
  })
}

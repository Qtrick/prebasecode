/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * DOM-free Code Graph queries for Magnus / Maps.
 * inspired by Graphify MIT concepts, PreBase reimplementation
 */

import type { EdgeConfidence, EdgeKind, GraphEdge, GraphNode } from '../../common/types/graphTypes.js'

export interface SearchNodesResult {
	nodes: GraphNode[]
	truncated: boolean
	seedMatch?: boolean
}

export interface ShortestPathHop {
	from: string
	to: string
	kind: EdgeKind
	confidence?: EdgeConfidence
	sourceFile?: string
	sourceLine?: number
	reason?: string
}

export interface ShortestPathResult {
	nodeIds: string[]
	edges: ShortestPathHop[]
	found: boolean
	/** True when BFS hit the visit budget before finding a path. */
	budgetExceeded?: boolean
}

export interface NeighborsResult {
	nodeIds: string[]
	truncated: boolean
}

export interface AffectedNodesResult {
	nodeIds: string[]
	truncated: boolean
}

function cmpId(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

function scoreMatch(node: GraphNode, q: string): number {
	const id = node.id.toLowerCase()
	const label = (node.label || '').toLowerCase()
	const path = (node.path || '').toLowerCase()
	if (id === q || path === q) return 1000
	if (id.endsWith(q) || path.endsWith(q) || label === q) return 800
	if (label.startsWith(q) || path.startsWith(q)) return 600
	if (label.includes(q) || path.includes(q) || id.includes(q)) return 400
	return 0
}

/** Ranked substring search; exact id/path match is seed-first. */
export function searchNodes(nodes: GraphNode[], query: string, limit = 20): SearchNodesResult {
	const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
	const max = Math.max(1, Math.min(Math.floor(limit), 100))
	if (!q) {
		return { nodes: [], truncated: false }
	}

	const seed = nodes.find((n) => n.id.toLowerCase() === q || (n.path && n.path.toLowerCase() === q))
	const scored = nodes
		.map((node) => ({ node, score: scoreMatch(node, q) }))
		.filter((row) => row.score > 0)
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score
			return cmpId(a.node.id, b.node.id)
		})

	const ordered: GraphNode[] = []
	const seen = new Set<string>()
	if (seed) {
		ordered.push(seed)
		seen.add(seed.id)
	}
	for (const row of scored) {
		if (seen.has(row.node.id)) continue
		ordered.push(row.node)
		seen.add(row.node.id)
	}

	return {
		nodes: ordered.slice(0, max),
		truncated: ordered.length > max,
		seedMatch: !!seed,
	}
}

function outgoingBySource(edges: GraphEdge[]): Map<string, GraphEdge[]> {
	const map = new Map<string, GraphEdge[]>()
	for (const edge of edges) {
		const list = map.get(edge.source)
		if (list) {
			list.push(edge)
		} else {
			map.set(edge.source, [edge])
		}
	}
	for (const list of map.values()) {
		list.sort((a, b) => cmpId(a.target, b.target) || cmpId(a.id, b.id))
	}
	return map
}

function incomingByTarget(edges: GraphEdge[]): Map<string, GraphEdge[]> {
	const map = new Map<string, GraphEdge[]>()
	for (const edge of edges) {
		const list = map.get(edge.target)
		if (list) {
			list.push(edge)
		} else {
			map.set(edge.target, [edge])
		}
	}
	for (const list of map.values()) {
		list.sort((a, b) => cmpId(a.source, b.source) || cmpId(a.id, b.id))
	}
	return map
}

/** Directed BFS shortest path; neighbor expansion sorted by target id. */
export function shortestPath(
	_nodes: GraphNode[],
	edges: GraphEdge[],
	fromId: string,
	toId: string,
	maxVisited = 5000
): ShortestPathResult {
	if (!fromId || !toId) {
		return { nodeIds: [], edges: [], found: false }
	}
	if (fromId === toId) {
		return { nodeIds: [fromId], edges: [], found: true }
	}
	const visitBudget = Math.max(2, Math.min(Math.floor(maxVisited), 20_000))
	const out = outgoingBySource(edges)
	const parent = new Map<string, { via: GraphEdge; from: string }>()
	const visited = new Set<string>([fromId])
	const queue = [fromId]
	let found = false
	let budgetExceeded = false
	while (queue.length) {
		const current = queue.shift()!
		const nextEdges = out.get(current) ?? []
		for (const edge of nextEdges) {
			if (visited.has(edge.target)) continue
			if (visited.size >= visitBudget) {
				budgetExceeded = true
				queue.length = 0
				break
			}
			visited.add(edge.target)
			parent.set(edge.target, { via: edge, from: current })
			if (edge.target === toId) {
				found = true
				queue.length = 0
				break
			}
			queue.push(edge.target)
		}
	}
	if (!found) {
		return { nodeIds: [], edges: [], found: false, budgetExceeded: budgetExceeded || undefined }
	}
	const hops: ShortestPathHop[] = []
	const nodeIds: string[] = [toId]
	let cursor = toId
	while (cursor !== fromId) {
		const step = parent.get(cursor)!
		const via = step.via
		hops.push({
			from: step.from,
			to: cursor,
			kind: via.kind,
			confidence: via.meta?.confidence,
			sourceFile: via.meta?.sourceFile,
			sourceLine: via.meta?.sourceLine ?? via.meta?.line,
			reason: via.meta?.reason,
		})
		nodeIds.push(step.from)
		cursor = step.from
	}
	nodeIds.reverse()
	hops.reverse()
	return { nodeIds, edges: hops, found: true }
}

export function neighbors(
	edges: GraphEdge[],
	nodeId: string,
	direction: 'in' | 'out' | 'both',
	limit = 50
): NeighborsResult {
	const max = Math.max(1, Math.min(Math.floor(limit), 200))
	const ids = new Set<string>()
	if (direction === 'out' || direction === 'both') {
		for (const edge of edges) {
			if (edge.source === nodeId) ids.add(edge.target)
		}
	}
	if (direction === 'in' || direction === 'both') {
		for (const edge of edges) {
			if (edge.target === nodeId) ids.add(edge.source)
		}
	}
	const ordered = [...ids].sort(cmpId)
	return {
		nodeIds: ordered.slice(0, max),
		truncated: ordered.length > max,
	}
}

/** Reverse-deps BFS (incoming edges); deterministic neighbor order. */
export function affectedNodes(edges: GraphEdge[], nodeId: string, maxNodes = 50): AffectedNodesResult {
	const max = Math.max(1, Math.min(Math.floor(maxNodes), 500))
	const incoming = incomingByTarget(edges)
	const ordered: string[] = []
	const visited = new Set<string>([nodeId])
	const queue = [nodeId]
	let truncated = false
	while (queue.length) {
		const current = queue.shift()!
		const preds = incoming.get(current) ?? []
		for (const edge of preds) {
			if (visited.has(edge.source)) continue
			if (ordered.length >= max) {
				truncated = true
				queue.length = 0
				break
			}
			visited.add(edge.source)
			ordered.push(edge.source)
			queue.push(edge.source)
		}
	}
	return { nodeIds: ordered, truncated }
}

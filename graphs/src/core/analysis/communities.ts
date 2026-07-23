/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic community detection for Code Graph.
 * inspired by Graphify MIT concepts, PreBase reimplementation
 * (label propagation on an undirected structural projection — no Graphify source).
 */

import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js'
import { basename } from '../resolution/paths.js'

/** Import/dependency only — contains would glue folder trees into fake communities. */
export const STRUCTURAL_EDGE_KINDS = new Set(['import', 'dependency'])

export interface CommunityAssignment {
	/** communityId → member node ids (sorted) */
	members: Map<number, string[]>
	/** nodeId → communityId */
	byNode: Map<string, number>
}

function structuralAdjacency(nodes: GraphNode[], edges: GraphEdge[]): Map<string, string[]> {
	const ids = new Set(nodes.map((n) => n.id))
	const adj = new Map<string, Set<string>>()
	for (const id of ids) {
		adj.set(id, new Set())
	}
	for (const edge of edges) {
		if (!STRUCTURAL_EDGE_KINDS.has(edge.kind)) continue
		if (!ids.has(edge.source) || !ids.has(edge.target)) continue
		if (edge.source === edge.target) continue
		adj.get(edge.source)!.add(edge.target)
		adj.get(edge.target)!.add(edge.source)
	}
	const out = new Map<string, string[]>()
	for (const [id, set] of adj) {
		out.set(id, [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
	}
	return out
}

/**
 * Label propagation with fixed node-id order (seed). Converges or stops at maxPasses.
 * ponytail: O(passes * (n+m)); ceiling is coarse communities, not Louvain quality.
 */
export function detectCommunities(nodes: GraphNode[], edges: GraphEdge[], maxPasses = 12): CommunityAssignment {
	const orderedIds = nodes.map((n) => n.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
	const adj = structuralAdjacency(nodes, edges)
	const label = new Map<string, string>()
	for (const id of orderedIds) {
		label.set(id, id)
	}

	for (let pass = 0; pass < maxPasses; pass++) {
		let changed = false
		for (const id of orderedIds) {
			const neighbors = adj.get(id) ?? []
			if (neighbors.length === 0) continue
			const votes = new Map<string, number>()
			for (const nb of neighbors) {
				const lb = label.get(nb)!
				votes.set(lb, (votes.get(lb) ?? 0) + 1)
			}
			let bestLabel = label.get(id)!
			let bestCount = -1
			// Deterministic: highest count, then lexicographically smallest label.
			const voteLabels = [...votes.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
			for (const lb of voteLabels) {
				const count = votes.get(lb)!
				if (count > bestCount || (count === bestCount && lb < bestLabel)) {
					bestCount = count
					bestLabel = lb
				}
			}
			if (bestLabel !== label.get(id)) {
				label.set(id, bestLabel)
				changed = true
			}
		}
		if (!changed) break
	}

	// Group by raw label, then assign stable communityId 0..n-1 by size desc, min member id asc.
	const rawGroups = new Map<string, string[]>()
	for (const id of orderedIds) {
		const lb = label.get(id)!
		const group = rawGroups.get(lb)
		if (group) {
			group.push(id)
		} else {
			rawGroups.set(lb, [id])
		}
	}
	const groups = [...rawGroups.values()].map((members) =>
		members.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
	)
	groups.sort((a, b) => {
		if (b.length !== a.length) return b.length - a.length
		const minA = a[0]
		const minB = b[0]
		return minA < minB ? -1 : minA > minB ? 1 : 0
	})

	const members = new Map<number, string[]>()
	const byNode = new Map<string, number>()
	groups.forEach((group, communityId) => {
		members.set(communityId, group)
		for (const id of group) {
			byNode.set(id, communityId)
		}
	})
	return { members, byNode }
}

export function computeDegreeStats(
	nodes: GraphNode[],
	edges: GraphEdge[]
): Map<string, { degree: number; inDegree: number; outDegree: number }> {
	const ids = new Set(nodes.map((n) => n.id))
	const stats = new Map<string, { degree: number; inDegree: number; outDegree: number }>()
	for (const id of ids) {
		stats.set(id, { degree: 0, inDegree: 0, outDegree: 0 })
	}
	const undirectedSeen = new Set<string>()
	for (const edge of edges) {
		if (!STRUCTURAL_EDGE_KINDS.has(edge.kind)) continue
		if (!ids.has(edge.source) || !ids.has(edge.target)) continue
		const src = stats.get(edge.source)!
		const tgt = stats.get(edge.target)!
		src.outDegree += 1
		tgt.inDegree += 1
		const a = edge.source < edge.target ? edge.source : edge.target
		const b = edge.source < edge.target ? edge.target : edge.source
		const key = `${a}\0${b}`
		if (!undirectedSeen.has(key)) {
			undirectedSeen.add(key)
			src.degree += 1
			if (edge.source !== edge.target) {
				tgt.degree += 1
			}
		}
	}
	return stats
}

export function labelCommunitiesByHub(
	nodes: GraphNode[],
	edges: GraphEdge[],
	communities: CommunityAssignment
): Map<number, string> {
	const byId = new Map(nodes.map((n) => [n.id, n]))
	const degrees = computeDegreeStats(nodes, edges)
	const labels = new Map<number, string>()
	for (const [communityId, memberIds] of communities.members) {
		let hubId = memberIds[0]
		let hubDegree = -1
		for (const id of memberIds) {
			const deg = degrees.get(id)?.degree ?? 0
			if (deg > hubDegree || (deg === hubDegree && id < hubId)) {
				hubDegree = deg
				hubId = id
			}
		}
		const hub = byId.get(hubId)
		const raw = hub?.label || (hub?.path ? basename(hub.path) : hubId)
		labels.set(communityId, raw)
	}
	return labels
}

/** Mutates node.meta with community + degree stats; returns the same array. */
export function applyCommunitiesToNodes(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
	const communities = detectCommunities(nodes, edges)
	const labels = labelCommunitiesByHub(nodes, edges, communities)
	const degrees = computeDegreeStats(nodes, edges)
	for (const node of nodes) {
		const communityId = communities.byNode.get(node.id)
		const deg = degrees.get(node.id)
		node.meta = {
			...node.meta,
			communityId,
			communityLabel: communityId === undefined ? undefined : labels.get(communityId),
			degree: deg?.degree,
			inDegree: deg?.inDegree,
			outDegree: deg?.outDegree,
		}
	}
	return nodes
}

/**
 * Prefer snapshot community meta so bridge/surprise/explain ids match Maps.
 * Full redetect only when no node has meta (never remap labeled communities).
 */
export function communityMapFromNodes(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
	const fromMeta = new Map<string, number>()
	for (const node of nodes) {
		const id = node.meta?.communityId
		if (typeof id === 'number' && Number.isFinite(id)) {
			fromMeta.set(node.id, id)
		}
	}
	if (fromMeta.size > 0) {
		return fromMeta
	}
	return detectCommunities(nodes, edges).byNode
}

export function countCommunities(nodes: GraphNode[]): number {
	const ids = new Set<number>()
	for (const node of nodes) {
		if (typeof node.meta?.communityId === 'number') {
			ids.add(node.meta.communityId)
		}
	}
	return ids.size
}

export interface CommunitySummary {
	id: number
	label: string
	count: number
}

/** True when node.meta.communityId is in the hidden set (missing id → never hidden). */
export function isNodeCommunityHidden(
	communityId: number | undefined,
	hiddenIds: ReadonlySet<number> | readonly number[]
): boolean {
	if (typeof communityId !== 'number') {
		return false
	}
	if (Array.isArray(hiddenIds)) {
		return (hiddenIds as readonly number[]).includes(communityId)
	}
	return (hiddenIds as ReadonlySet<number>).has(communityId)
}

/** Dedupe + sort for stable service/webview payloads. */
export function normalizeHiddenCommunityIds(ids: readonly number[]): number[] {
	const out = new Set<number>()
	for (const id of ids) {
		if (typeof id === 'number' && Number.isFinite(id)) {
			out.add(id)
		}
	}
	return [...out].sort((a, b) => a - b)
}

/** Summaries from node.meta.communityId/Label (after applyCommunitiesToNodes). Sorted count desc, then id. */
export function listCommunitySummaries(nodes: GraphNode[]): CommunitySummary[] {
	const map = new Map<number, { label: string; count: number }>()
	for (const node of nodes) {
		const id = node.meta?.communityId
		if (typeof id !== 'number') {
			continue
		}
		const existing = map.get(id)
		if (existing) {
			existing.count += 1
			continue
		}
		const label =
			typeof node.meta?.communityLabel === 'string' && node.meta.communityLabel
				? node.meta.communityLabel
				: `Community ${id}`
		map.set(id, { label, count: 1 })
	}
	return [...map.entries()]
		.map(([id, v]) => ({ id, label: v.label, count: v.count }))
		.sort((a, b) => (b.count !== a.count ? b.count - a.count : a.id - b.id))
}

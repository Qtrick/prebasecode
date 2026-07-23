/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cross-community bridge hubs for Code Graph.
 * inspired by Graphify MIT concepts, PreBase reimplementation
 */

import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js'
import { communityMapFromNodes, STRUCTURAL_EDGE_KINDS } from './communities.js'

export interface BridgeNodeHit {
	id: string
	label: string
	communities: number[]
	crossEdgeCount: number
	reason: string
}

/** Nodes with import/dependency edges into 2+ communities. Sort: crossEdgeCount desc, then id. */
export function findBridgeNodes(nodes: GraphNode[], edges: GraphEdge[], limit = 20): BridgeNodeHit[] {
	const max = Math.max(0, Math.min(Math.floor(limit), 100))
	const byNode = communityMapFromNodes(nodes, edges)
	const byId = new Map(nodes.map((n) => [n.id, n]))

	const communitiesTouched = new Map<string, Set<number>>()
	const crossCounts = new Map<string, number>()

	const touch = (nodeId: string, communityId: number) => {
		let set = communitiesTouched.get(nodeId)
		if (!set) {
			set = new Set()
			communitiesTouched.set(nodeId, set)
		}
		set.add(communityId)
	}

	for (const edge of edges) {
		if (!STRUCTURAL_EDGE_KINDS.has(edge.kind)) continue
		const srcC = byNode.get(edge.source)
		const tgtC = byNode.get(edge.target)
		if (srcC === undefined || tgtC === undefined || srcC === tgtC) continue
		crossCounts.set(edge.source, (crossCounts.get(edge.source) ?? 0) + 1)
		crossCounts.set(edge.target, (crossCounts.get(edge.target) ?? 0) + 1)
		touch(edge.source, srcC)
		touch(edge.source, tgtC)
		touch(edge.target, tgtC)
		touch(edge.target, srcC)
	}

	const hits: BridgeNodeHit[] = []
	for (const [id, communities] of communitiesTouched) {
		if (communities.size < 2) continue
		const node = byId.get(id)
		if (!node) continue
		const ordered = [...communities].sort((a, b) => a - b)
		const crossEdgeCount = crossCounts.get(id) ?? 0
		hits.push({
			id,
			label: node.label,
			communities: ordered,
			crossEdgeCount,
			reason: `bridges ${ordered.length} communities via ${crossEdgeCount} cross-community edges`,
		})
	}

	hits.sort((a, b) => {
		if (b.crossEdgeCount !== a.crossEdgeCount) return b.crossEdgeCount - a.crossEdgeCount
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
	})
	return hits.slice(0, max)
}

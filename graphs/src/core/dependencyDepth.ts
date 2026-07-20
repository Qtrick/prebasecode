/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Ported from PreBase core for VS Code workbench.
 *--------------------------------------------------------------------------------------------*/

import type { GraphEdge, GraphNode } from './types.js'

/** Sentinel depth for files not reachable from the entry via import edges. */
export const UNREACHABLE_DEPTH = 10_000

export function isUnreachableDepth(depth: number): boolean {
	return depth >= UNREACHABLE_DEPTH
}

export interface DependencyDepthResult {
	depth: Map<string, number>
	layers: Map<number, string[]>
	entryNodeId: string
	maxReachableDepth: number
}

/**
 * Shortest-path depth from entry over import relationships (undirected).
 * Shared by Hierarchy rings and Pyramid layers.
 */
export function computeEntryPointDepthGroups(
	nodes: GraphNode[],
	edges: GraphEdge[],
	entryNodeId: string
): DependencyDepthResult {
	const layoutNodes = nodes.filter((n) => n.kind !== 'folder')
	const nodeIds = new Set(layoutNodes.map((n) => n.id))
	const importEdges = edges.filter(
		(e) => e.kind === 'import' && nodeIds.has(e.source) && nodeIds.has(e.target)
	)

	const adj = new Map<string, string[]>()
	for (const id of nodeIds) adj.set(id, [])
	for (const e of importEdges) {
		adj.get(e.source)!.push(e.target)
		adj.get(e.target)!.push(e.source)
	}

	const depth = new Map<string, number>()
	const queue: string[] = []

	if (nodeIds.has(entryNodeId)) {
		depth.set(entryNodeId, 0)
		queue.push(entryNodeId)
	}

	while (queue.length > 0) {
		const current = queue.shift()!
		const d = depth.get(current)!
		for (const next of adj.get(current) ?? []) {
			if (!depth.has(next)) {
				depth.set(next, d + 1)
				queue.push(next)
			}
		}
	}

	const reachableDepths = [...depth.values()]
	const maxReachableDepth = reachableDepths.length > 0 ? Math.max(...reachableDepths) : 0

	for (const node of layoutNodes) {
		if (!depth.has(node.id)) {
			depth.set(node.id, UNREACHABLE_DEPTH)
		}
	}

	const layers = new Map<number, string[]>()
	for (const node of layoutNodes) {
		const d = depth.get(node.id) ?? 1
		if (!layers.has(d)) layers.set(d, [])
		layers.get(d)!.push(node.id)
	}

	return { depth, layers, entryNodeId, maxReachableDepth }
}

/** Alias for computeEntryPointDepthGroups. */
export function computeDependencyDepths(
	nodes: GraphNode[],
	edges: GraphEdge[],
	entryNodeId: string
): DependencyDepthResult {
	return computeEntryPointDepthGroups(nodes, edges, entryNodeId)
}

export function chunkArray<T>(items: T[], size: number): T[][] {
	if (items.length === 0) return []
	const chunks: T[][] = []
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size))
	}
	return chunks
}

export const HIERARCHY_LAYER_LABELS = [
	'Root',
	'Layer 1',
	'Layer 2',
	'Layer 3',
	'Layer 4',
	'Layer 5+'
] as const

export function labelForDepth(depth: number): string {
	if (depth <= 0) return HIERARCHY_LAYER_LABELS[0]
	if (depth < HIERARCHY_LAYER_LABELS.length) return HIERARCHY_LAYER_LABELS[depth]
	return `Layer ${depth}`
}

export function layerExplanationForDepth(depth: number): { title: string; body: string } {
	if (depth <= 0) {
		return {
			title: 'Root',
			body: 'The project entry point — the file PreBase identified as the architectural root (main, App, or index).'
		}
	}
	if (depth === 1) {
		return {
			title: 'Layer 1',
			body: 'Direct dependencies of the root. Files imported or referenced directly by the entry point.'
		}
	}
	return {
		title: `Layer ${depth}`,
		body: `Dependencies used by Layer ${depth - 1} files — ${depth} hops from the entry point along import edges.`
	}
}

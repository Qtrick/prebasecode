/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js'
import { classifyNodeLayer, type ArchitectureLayerId } from '../../core/analysis/architectureLayers.js'
import { computeEntryPointDepthGroups } from '../../core/analysis/dependencyDepth.js'

export type LayoutOrganizationMethod =
	| 'dependency-depth'
	| 'import-importance'
	| 'file-role'
	| 'directory-proximity'

export interface OrganizationLayerResult {
	layers: Map<number, string[]>
	entryNodeId: string
	ranks: Map<string, number>
}

const ROLE_RING_ORDER: ArchitectureLayerId[] = [
	'entry',
	'frontend',
	'ui',
	'components',
	'api',
	'auth',
	'services',
	'backend',
	'database',
	'utils',
	'config',
	'tests',
	'other'
]

function pathDepth(path: string | undefined): number {
	if (!path) return 99
	return path.replace(/\\/g, '/').split('/').filter(Boolean).length
}

function bucketByRank(
	nodeIds: string[],
	rankOf: (id: string) => number,
	entryNodeId: string
): Map<number, string[]> {
	const layers = new Map<number, string[]>()
	const ranks = new Map<string, number>()
	if (nodeIds.length === 0) return layers

	const sorted = [...nodeIds].sort((a, b) => {
		if (a === entryNodeId) return -1
		if (b === entryNodeId) return 1
		const dr = rankOf(a) - rankOf(b)
		return dr !== 0 ? dr : a.localeCompare(b)
	})

	const others = sorted.filter((id) => id !== entryNodeId)
	if (others.length === 0) {
		layers.set(0, [entryNodeId])
		ranks.set(entryNodeId, 0)
		return layers
	}

	const values = others.map(rankOf)
	const min = Math.min(...values)
	const max = Math.max(...values)
	const span = Math.max(1, max - min)
	const ringCount = Math.min(6, Math.max(2, Math.ceil(Math.sqrt(others.length))))

	layers.set(0, [entryNodeId])
	ranks.set(entryNodeId, 0)

	for (const id of others) {
		const v = rankOf(id)
		const t = (v - min) / span
		const ring = Math.min(ringCount, Math.max(1, 1 + Math.floor(t * ringCount)))
		ranks.set(id, ring)
		if (!layers.has(ring)) layers.set(ring, [])
		layers.get(ring)!.push(id)
	}

	return layers
}

export function computeOrganizationLayers(
	nodes: GraphNode[],
	edges: GraphEdge[],
	entryNodeId: string,
	method: LayoutOrganizationMethod
): OrganizationLayerResult {
	const layoutNodes = nodes.filter((n) => n.kind !== 'folder')
	const nodeIds = layoutNodes.map((n) => n.id)

	if (method === 'dependency-depth') {
		const result = computeEntryPointDepthGroups(nodes, edges, entryNodeId)
		return { layers: result.layers, entryNodeId, ranks: result.depth }
	}

	if (method === 'import-importance') {
		const importance = new Map<string, number>()
		for (const edge of edges) {
			if (edge.kind !== 'import') {
				continue
			}
			importance.set(edge.source, (importance.get(edge.source) ?? 0) + 1)
			importance.set(edge.target, (importance.get(edge.target) ?? 0) + 2)
		}
		const layers = bucketByRank(nodeIds, (id) => -(importance.get(id) ?? 0), entryNodeId)
		const ranks = new Map<string, number>()
		for (const [ring, ids] of layers) {
			for (const id of ids) ranks.set(id, ring)
		}
		return { layers, entryNodeId, ranks }
	}

	if (method === 'file-role') {
		const roleRank = new Map<string, number>()
		for (const node of layoutNodes) {
			const layer = (node.meta?.architectureLayer as ArchitectureLayerId) ??
				classifyNodeLayer(node.path, node.isEntry || node.id === entryNodeId)
			const idx = ROLE_RING_ORDER.indexOf(layer)
			roleRank.set(node.id, idx >= 0 ? idx : ROLE_RING_ORDER.length)
		}
		const layers = bucketByRank(nodeIds, (id) => roleRank.get(id) ?? 99, entryNodeId)
		const ranks = new Map<string, number>()
		for (const [ring, ids] of layers) {
			for (const id of ids) ranks.set(id, ring)
		}
		return { layers, entryNodeId, ranks }
	}

	// directory-proximity
	const nodeById = new Map(layoutNodes.map(node => [node.id, node]))
	const entryNode = nodeById.get(entryNodeId)
	const entryDepth = pathDepth(entryNode?.path)
	const layers = bucketByRank(
		nodeIds,
		id => pathDepth(nodeById.get(id)?.path) - entryDepth,
		entryNodeId
	)
	const ranks = new Map<string, number>()
	for (const [ring, ids] of layers) {
		for (const id of ids) ranks.set(id, ring)
	}
	return { layers, entryNodeId, ranks }
}

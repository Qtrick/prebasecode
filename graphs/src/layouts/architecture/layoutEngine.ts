/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GraphEdge, GraphNode, LayoutMode, LayoutPosition } from '../../common/types/graphTypes.js'
import {
	computeHierarchyLayout,
	computePyramidLayout,
	computeScatterLayout
} from './hierarchy/hierarchyLayout.js'
import { mergeLayoutRuntime, type LayoutRuntimeConfig } from '../shared/layoutConfig.js'

export interface LayoutOptions {
	mode?: LayoutMode
	preservePositions?: Record<string, LayoutPosition>
	entryNodeId?: string | null
	runtime?: Partial<LayoutRuntimeConfig>
}

export class LayoutEngine {
	private lastMode: LayoutMode = 'hierarchy'
	private lastRuntime: LayoutRuntimeConfig = mergeLayoutRuntime()

	async layout(
		nodes: GraphNode[],
		edges: GraphEdge[],
		options: LayoutOptions = {}
	): Promise<Record<string, LayoutPosition>> {
		const mode = options.mode ?? 'hierarchy'
		const runtime = mergeLayoutRuntime(options.runtime)
		this.lastMode = mode
		this.lastRuntime = runtime

		const layoutNodes = nodes.filter((n) => n.kind !== 'folder')
		if (layoutNodes.length === 0) return {}

		const entryNodeId = options.entryNodeId
		if (!entryNodeId) {
			return this.mergePreserved({}, nodes, options.preservePositions)
		}

		const layoutOpts = { entryNodeId, runtime }
		let positions: Record<string, LayoutPosition>
		switch (mode) {
			case 'pyramid':
				positions = computePyramidLayout(layoutNodes, edges, layoutOpts)
				break
			case 'scattered':
				positions = computeScatterLayout(layoutNodes, edges, layoutOpts)
				break
			case 'hierarchy':
			default:
				positions = computeHierarchyLayout(layoutNodes, edges, layoutOpts)
				break
		}

		return this.mergePreserved(positions, nodes, options.preservePositions)
	}

	async layoutIncremental(
		nodes: GraphNode[],
		edges: GraphEdge[],
		existingPositions: Record<string, LayoutPosition>,
		changedNodeIds: string[],
		entryNodeId?: string | null,
		mode?: LayoutMode,
		runtime?: Partial<LayoutRuntimeConfig>
	): Promise<Record<string, LayoutPosition>> {
		const changed = new Set(changedNodeIds)
		const hasNewNodes = nodes.some((n) => changed.has(n.id) || !existingPositions[n.id])

		if (hasNewNodes && entryNodeId) {
			const layoutMode = mode ?? this.lastMode
			const layoutRuntime = mergeLayoutRuntime(runtime ?? this.lastRuntime)
			const layoutNodes = nodes.filter((n) => n.kind !== 'folder')
			const layoutOpts = { entryNodeId, runtime: layoutRuntime }

			let fresh: Record<string, LayoutPosition>
			switch (layoutMode) {
				case 'pyramid':
					fresh = computePyramidLayout(layoutNodes, edges, layoutOpts)
					break
				case 'scattered':
					fresh = computeScatterLayout(layoutNodes, edges, layoutOpts)
					break
				default:
					fresh = computeHierarchyLayout(layoutNodes, edges, layoutOpts)
			}

			for (const id of Object.keys(existingPositions)) {
				if (!changed.has(id) && existingPositions[id]) {
					fresh[id] = existingPositions[id]
				}
			}
			return fresh
		}

		return { ...existingPositions }
	}

	private mergePreserved(
		positions: Record<string, LayoutPosition>,
		nodes: GraphNode[],
		preserve?: Record<string, LayoutPosition>
	): Record<string, LayoutPosition> {
		const merged = { ...positions }
		for (const node of nodes) {
			if (!merged[node.id] && preserve?.[node.id]) {
				merged[node.id] = preserve[node.id]
			}
		}
		return merged
	}
}

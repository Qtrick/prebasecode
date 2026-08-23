/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	TemporalStructuralDiff,
	TemporalRenderNode,
	TemporalRenderEdge,
	TemporalDisplayMode,
} from '../../temporal/view/temporalViewTypes.js';

export type TemporalContextFilterMode = 'focused' | 'full';

export interface TemporalFocusContextResult {
	readonly displayMode: TemporalDisplayMode;
	readonly contextFilterMode: TemporalContextFilterMode;
	readonly visibleNodes: readonly TemporalRenderNode[];
	readonly visibleEdges: readonly TemporalRenderEdge[];
	readonly changedNodeIds: ReadonlySet<string>;
	readonly directContextNodeIds: ReadonlySet<string>;
	readonly totalNodeCount: number;
	readonly totalEdgeCount: number;
}

/**
 * Computes Focus+Context projection for Temporal Graph.
 *
 * In Changes mode (Default: focused):
 * - Focus: All changed nodes (added, removed, modified, renamed).
 * - Context: 1-hop connected unchanged neighbors + connecting edges.
 * - Result: Developer immediately sees what changed without being overwhelmed by hundreds of unrelated files.
 *
 * In Changes mode (Full Context):
 * - Returns all nodes, but identifies direct context vs distant context.
 *
 * In State mode:
 * - Returns the complete target commit topology (excluding removed comparison ghosts).
 */
export function computeTemporalFocusContext(
	diff: TemporalStructuralDiff,
	displayMode: TemporalDisplayMode = 'changes',
	contextFilterMode: TemporalContextFilterMode = 'focused',
): TemporalFocusContextResult {
	const allNodes = diff.nodes || [];
	const allEdges = diff.edges || [];

	if (displayMode === 'state') {
		// State mode: full target state topology, no removed ghosts
		const visibleNodes = allNodes.filter(n => n.changeKind !== 'removed');
		const visibleNodeIdSet = new Set(visibleNodes.map(n => n.entityId));
		const visibleEdges = allEdges.filter(e => {
			if (e.changeKind === 'removed') return false;
			const src = e.sourceEntityId || (e as any).sourceId;
			const tgt = e.targetEntityId || (e as any).targetId;
			return visibleNodeIdSet.has(src) && visibleNodeIdSet.has(tgt);
		});

		return {
			displayMode: 'state',
			contextFilterMode,
			visibleNodes,
			visibleEdges,
			changedNodeIds: new Set(),
			directContextNodeIds: visibleNodeIdSet,
			totalNodeCount: visibleNodes.length,
			totalEdgeCount: visibleEdges.length,
		};
	}

	// Changes Mode: Identify changed nodes
	const changedNodeIds = new Set<string>();
	for (let i = 0; i < allNodes.length; i++) {
		const node = allNodes[i];
		if (node.changeKind !== 'unchanged') {
			changedNodeIds.add(node.entityId);
		}
	}

	// Build adjacency map
	const adjacency = new Map<string, Set<string>>();
	for (let i = 0; i < allEdges.length; i++) {
		const edge = allEdges[i];
		const src = edge.sourceEntityId || (edge as any).sourceId;
		const tgt = edge.targetEntityId || (edge as any).targetId;
		if (!src || !tgt) continue;

		let sSet = adjacency.get(src);
		if (!sSet) {
			sSet = new Set();
			adjacency.set(src, sSet);
		}
		sSet.add(tgt);

		let tSet = adjacency.get(tgt);
		if (!tSet) {
			tSet = new Set();
			adjacency.set(tgt, tSet);
		}
		tSet.add(src);
	}

	// Find 1-hop direct context nodes
	const directContextNodeIds = new Set<string>();
	for (const changedId of changedNodeIds) {
		const neighbors = adjacency.get(changedId);
		if (neighbors) {
			for (const neighborId of neighbors) {
				if (!changedNodeIds.has(neighborId)) {
					directContextNodeIds.add(neighborId);
				}
			}
		}
	}

	// Handle edge case: commit with 0 changes (e.g. root/clean or unchanged)
	if (changedNodeIds.size === 0) {
		// In focused mode with 0 changes, display top 20 hub nodes or all nodes if small
		const visibleNodes = allNodes.slice(0, Math.min(allNodes.length, 30));
		const visibleNodeIdSet = new Set(visibleNodes.map(n => n.entityId));
		const visibleEdges = allEdges.filter(e => {
			const src = e.sourceEntityId || (e as any).sourceId;
			const tgt = e.targetEntityId || (e as any).targetId;
			return visibleNodeIdSet.has(src) && visibleNodeIdSet.has(tgt);
		});

		return {
			displayMode: 'changes',
			contextFilterMode,
			visibleNodes,
			visibleEdges,
			changedNodeIds,
			directContextNodeIds: visibleNodeIdSet,
			totalNodeCount: allNodes.length,
			totalEdgeCount: allEdges.length,
		};
	}

	if (contextFilterMode === 'focused') {
		const visibleNodeIdSet = new Set<string>([...changedNodeIds, ...directContextNodeIds]);
		const visibleNodes = allNodes.filter(n => visibleNodeIdSet.has(n.entityId));
		const visibleEdges = allEdges.filter(e => {
			const src = e.sourceEntityId || (e as any).sourceId;
			const tgt = e.targetEntityId || (e as any).targetId;
			return visibleNodeIdSet.has(src) && visibleNodeIdSet.has(tgt);
		});

		return {
			displayMode: 'changes',
			contextFilterMode: 'focused',
			visibleNodes,
			visibleEdges,
			changedNodeIds,
			directContextNodeIds,
			totalNodeCount: allNodes.length,
			totalEdgeCount: allEdges.length,
		};
	}

	// Full Context mode in Changes
	return {
		displayMode: 'changes',
		contextFilterMode: 'full',
		visibleNodes: allNodes,
		visibleEdges: allEdges,
		changedNodeIds,
		directContextNodeIds,
		totalNodeCount: allNodes.length,
		totalEdgeCount: allEdges.length,
	};
}

/**
 * Computes visual radius for Temporal nodes.
 * Changed nodes are large and eye-catching (5.5 - 7.5px).
 * Unchanged context nodes are modest and quiet (3.0 - 4.0px).
 */
export function computeTemporalVisualRadius(
	node: TemporalRenderNode,
	options?: {
		readonly isSelected?: boolean;
		readonly isHovered?: boolean;
		readonly isChanged?: boolean;
	},
): number {
	const isChanged = options?.isChanged ?? (node.changeKind !== 'unchanged');
	let r = isChanged ? 6.5 : 3.5;

	if (options?.isHovered) {
		r *= 1.2;
	}
	if (options?.isSelected) {
		r *= 1.35;
	}

	return r;
}

/**
 * Computes mode-aware Fit View camera transform for Temporal Graph.
 */
export function computeTemporalFitTransform(
	visibleNodes: readonly TemporalRenderNode[],
	viewportWidth: number,
	viewportHeight: number,
	padding = 72,
): { readonly x: number; readonly y: number; readonly k: number } {
	if (visibleNodes.length === 0) {
		return { x: 0, y: 0, k: 1 };
	}

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (let i = 0; i < visibleNodes.length; i++) {
		const node = visibleNodes[i];
		const r = computeTemporalVisualRadius(node) + 4;
		const nx = node.x || 0;
		const ny = node.y || 0;
		minX = Math.min(minX, nx - r);
		minY = Math.min(minY, ny - r);
		maxX = Math.max(maxX, nx + r);
		maxY = Math.max(maxY, ny + r);
	}

	if (!Number.isFinite(minX)) {
		return { x: 0, y: 0, k: 1 };
	}

	const bw = Math.max(1, maxX - minX);
	const bh = Math.max(1, maxY - minY);
	const usableW = Math.max(100, viewportWidth - padding * 2);
	const usableH = Math.max(100, viewportHeight - padding * 2);

	const k = Math.min(usableW / (bw + 60), usableH / (bh + 60), 2.0);
	const clampedK = Math.max(0.15, Math.min(2.5, k));

	const x = (viewportWidth - bw * clampedK) / 2 - minX * clampedK;
	const y = (viewportHeight - bh * clampedK) / 2 - minY * clampedK;

	return { x, y, k: clampedK };
}

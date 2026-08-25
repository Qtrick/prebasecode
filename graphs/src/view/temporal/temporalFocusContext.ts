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
	readonly nodes: readonly TemporalRenderNode[];
	readonly edges: readonly TemporalRenderEdge[];
	readonly changedNodeIds: ReadonlySet<string>;
	readonly directContextNodeIds: ReadonlySet<string>;
	readonly focusSet: ReadonlySet<string>;
	readonly directContextSet: ReadonlySet<string>;
	readonly totalNodeCount: number;
	readonly totalEdgeCount: number;
	readonly hasZeroChanges: boolean;
}

export interface ViewportInsets {
	readonly top?: number;
	readonly bottom?: number;
	readonly left?: number;
	readonly right?: number;
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
	diff: TemporalStructuralDiff | null | undefined,
	displayMode: TemporalDisplayMode = 'changes',
	contextFilterMode: TemporalContextFilterMode = 'focused',
): TemporalFocusContextResult {
	if (!diff || !diff.nodes || diff.nodes.length === 0) {
		return {
			displayMode,
			contextFilterMode,
			visibleNodes: [],
			visibleEdges: [],
			nodes: [],
			edges: [],
			changedNodeIds: new Set(),
			directContextNodeIds: new Set(),
			focusSet: new Set(),
			directContextSet: new Set(),
			totalNodeCount: 0,
			totalEdgeCount: 0,
			hasZeroChanges: true,
		};
	}

	const allNodes = diff.nodes;
	const allEdges = diff.edges || [];

	if (displayMode === 'state') {
		// State mode: full target state topology, no removed ghosts
		const visibleNodes: TemporalRenderNode[] = [];
		const visibleNodeIdSet = new Set<string>();
		for (let i = 0; i < allNodes.length; i++) {
			const n = allNodes[i];
			if (n.changeKind !== 'removed') {
				visibleNodes.push(n);
				visibleNodeIdSet.add(n.entityId);
			}
		}

		const visibleEdges: TemporalRenderEdge[] = [];
		for (let i = 0; i < allEdges.length; i++) {
			const e = allEdges[i];
			if (e.changeKind === 'removed') {
				continue;
			}
			const src = e.sourceEntityId || (e as any).sourceId;
			const tgt = e.targetEntityId || (e as any).targetId;
			if (visibleNodeIdSet.has(src) && visibleNodeIdSet.has(tgt)) {
				visibleEdges.push(e);
			}
		}

		return {
			displayMode: 'state',
			contextFilterMode,
			visibleNodes,
			visibleEdges,
			nodes: visibleNodes,
			edges: visibleEdges,
			changedNodeIds: new Set(),
			directContextNodeIds: visibleNodeIdSet,
			focusSet: new Set(),
			directContextSet: visibleNodeIdSet,
			totalNodeCount: visibleNodes.length,
			totalEdgeCount: visibleEdges.length,
			hasZeroChanges: false,
		};
	}

	// Changes Mode: Identify changed nodes
	const changedNodeIds = new Set<string>();
	for (let i = 0; i < allNodes.length; i++) {
		const node = allNodes[i];
		if (node.changeKind && node.changeKind !== 'unchanged') {
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

	// Handle edge case: commit with 0 structural graph changes
	if (changedNodeIds.size === 0) {
		return {
			displayMode: 'changes',
			contextFilterMode,
			visibleNodes: [],
			visibleEdges: [],
			nodes: [],
			edges: [],
			changedNodeIds,
			directContextNodeIds,
			focusSet: changedNodeIds,
			directContextSet: directContextNodeIds,
			totalNodeCount: allNodes.length,
			totalEdgeCount: allEdges.length,
			hasZeroChanges: true,
		};
	}

	if (contextFilterMode === 'focused') {
		const visibleNodeIdSet = new Set<string>();
		for (const id of changedNodeIds) {
			visibleNodeIdSet.add(id);
		}
		for (const id of directContextNodeIds) {
			visibleNodeIdSet.add(id);
		}

		const visibleNodes: TemporalRenderNode[] = [];
		for (let i = 0; i < allNodes.length; i++) {
			const n = allNodes[i];
			if (visibleNodeIdSet.has(n.entityId)) {
				visibleNodes.push(n);
			}
		}

		const visibleEdges: TemporalRenderEdge[] = [];
		for (let i = 0; i < allEdges.length; i++) {
			const e = allEdges[i];
			const src = e.sourceEntityId || (e as any).sourceId;
			const tgt = e.targetEntityId || (e as any).targetId;
			if (visibleNodeIdSet.has(src) && visibleNodeIdSet.has(tgt)) {
				visibleEdges.push(e);
			}
		}

		return {
			displayMode: 'changes',
			contextFilterMode: 'focused',
			visibleNodes,
			visibleEdges,
			nodes: visibleNodes,
			edges: visibleEdges,
			changedNodeIds,
			directContextNodeIds,
			focusSet: changedNodeIds,
			directContextSet: directContextNodeIds,
			totalNodeCount: allNodes.length,
			totalEdgeCount: allEdges.length,
			hasZeroChanges: false,
		};
	}

	// Full Context mode in Changes
	return {
		displayMode: 'changes',
		contextFilterMode: 'full',
		visibleNodes: allNodes,
		visibleEdges: allEdges,
		nodes: allNodes,
		edges: allEdges,
		changedNodeIds,
		directContextNodeIds,
		focusSet: changedNodeIds,
		directContextSet: directContextNodeIds,
		totalNodeCount: allNodes.length,
		totalEdgeCount: allEdges.length,
		hasZeroChanges: false,
	};
}

/**
 * Computes visual radius for Temporal nodes.
 * Changed nodes are prominent (6.0 - 8.0px).
 * Unchanged context nodes are quiet (3.0 - 4.5px).
 */
export function computeTemporalVisualRadius(
	node: TemporalRenderNode,
	options?: {
		readonly isSelected?: boolean;
		readonly isHovered?: boolean;
		readonly isChanged?: boolean;
	},
): number {
	const isChanged = options?.isChanged ?? (node.changeKind && node.changeKind !== 'unchanged');
	let r = isChanged ? 7.0 : 3.8;

	if (options?.isHovered) {
		r *= 1.25;
	}
	if (options?.isSelected) {
		r *= 1.35;
	}

	return r;
}

/**
 * Computes mode-aware, overlay-aware Fit View camera transform for Temporal Graph.
 */
export function computeTemporalFitTransform(
	visibleNodes: readonly TemporalRenderNode[],
	viewportWidth: number,
	viewportHeight: number,
	options?: {
		readonly padding?: number;
		readonly insets?: ViewportInsets;
		readonly minZoom?: number;
		readonly maxZoom?: number;
	},
): { readonly x: number; readonly y: number; readonly k: number } {
	if (!visibleNodes || visibleNodes.length === 0) {
		return { x: 0, y: 0, k: 1 };
	}

	const padding = options?.padding ?? 64;
	const minZoom = options?.minZoom ?? 0.15;
	const maxZoom = options?.maxZoom ?? 2.0;

	const insets = {
		top: options?.insets?.top ?? 0,
		bottom: options?.insets?.bottom ?? 0,
		left: options?.insets?.left ?? 0,
		right: options?.insets?.right ?? 0,
	};

	const usableW = Math.max(100, viewportWidth - insets.left - insets.right);
	const usableH = Math.max(100, viewportHeight - insets.top - insets.bottom);
	const centerX = insets.left + usableW / 2;
	const centerY = insets.top + usableH / 2;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (let i = 0; i < visibleNodes.length; i++) {
		const node = visibleNodes[i];
		const r = computeTemporalVisualRadius(node) + 6;
		const nx = node.x || 0;
		const ny = node.y || 0;
		minX = Math.min(minX, nx - r);
		minY = Math.min(minY, ny - r);
		maxX = Math.max(maxX, nx + r);
		maxY = Math.max(maxY, ny + r);
	}

	if (!Number.isFinite(minX)) {
		return { x: centerX, y: centerY, k: 1 };
	}

	const bw = Math.max(1, maxX - minX);
	const bh = Math.max(1, maxY - minY);

	const fitW = Math.max(50, usableW - padding * 2);
	const fitH = Math.max(50, usableH - padding * 2);

	const rawK = Math.min(fitW / bw, fitH / bh);
	const clampedK = Math.max(minZoom, Math.min(maxZoom, rawK));

	const graphCenterX = (minX + maxX) / 2;
	const graphCenterY = (minY + maxY) / 2;

	const x = centerX - graphCenterX * clampedK;
	const y = centerY - graphCenterY * clampedK;

	return { x, y, k: clampedK };
}

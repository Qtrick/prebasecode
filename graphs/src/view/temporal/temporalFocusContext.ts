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

	function packFocusedClusters(nodes: TemporalRenderNode[], edges: TemporalRenderEdge[]): TemporalRenderNode[] {
		if (nodes.length < 2) {
			return nodes;
		}
		const index = new Map<string, number>();
		for (let i = 0; i < nodes.length; i++) {
			index.set(nodes[i].entityId, i);
		}
		const parent: number[] = [];
		for (let i = 0; i < nodes.length; i++) {
			parent.push(i);
		}
		function find(i: number): number {
			while (parent[i] !== i) {
				parent[i] = parent[parent[i]];
				i = parent[i];
			}
			return i;
		}
		function unite(a: number, b: number): void {
			const ra = find(a);
			const rb = find(b);
			if (ra !== rb) {
				parent[rb] = ra;
			}
		}
		for (let i = 0; i < edges.length; i++) {
			const src = edges[i].sourceEntityId || (edges[i] as TemporalRenderEdge & { sourceId?: string }).sourceId;
			const tgt = edges[i].targetEntityId || (edges[i] as TemporalRenderEdge & { targetId?: string }).targetId;
			const si = src ? index.get(src) : undefined;
			const ti = tgt ? index.get(tgt) : undefined;
			if (si !== undefined && ti !== undefined) {
				unite(si, ti);
			}
		}
		const groups = new Map<number, TemporalRenderNode[]>();
		for (let i = 0; i < nodes.length; i++) {
			const root = find(i);
			const list = groups.get(root) ?? [];
			list.push(nodes[i]);
			groups.set(root, list);
		}
		const clusters = Array.from(groups.values());
		clusters.sort(function (a, b) {
			return a[0].entityId < b[0].entityId ? -1 : 1;
		});
		if (clusters.length < 2) {
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (let i = 0; i < nodes.length; i++) {
				const n = nodes[i];
				if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
					continue;
				}
				minX = Math.min(minX, n.x);
				minY = Math.min(minY, n.y);
				maxX = Math.max(maxX, n.x);
				maxY = Math.max(maxY, n.y);
			}
			if (!Number.isFinite(minX) || ((maxX - minX) < 360 && (maxY - minY) < 360)) {
				return nodes;
			}
			const byDir = new Map<string, TemporalRenderNode[]>();
			for (let i = 0; i < nodes.length; i++) {
				const node = nodes[i];
				const parts = String(node.path || node.label || '').split(/[/\\]/).filter(Boolean);
				const key = parts.slice(0, 2).join('/') || node.entityId;
				const list = byDir.get(key) ?? [];
				list.push(node);
				byDir.set(key, list);
			}
			if (byDir.size < 2) {
				return nodes;
			}
			clusters.length = 0;
			const dirs = Array.from(byDir.keys()).sort();
			for (let i = 0; i < dirs.length; i++) {
				clusters.push(byDir.get(dirs[i])!);
			}
		}
		const stats: { cluster: TemporalRenderNode[]; cx: number; cy: number; w: number; h: number }[] = [];
		for (let c = 0; c < clusters.length; c++) {
			const cluster = clusters[c];
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (let i = 0; i < cluster.length; i++) {
				const n = cluster[i];
				if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
					continue;
				}
				minX = Math.min(minX, n.x);
				minY = Math.min(minY, n.y);
				maxX = Math.max(maxX, n.x);
				maxY = Math.max(maxY, n.y);
			}
			if (!Number.isFinite(minX)) {
				stats.push({ cluster, cx: 0, cy: 0, w: 48, h: 48 });
			} else {
				stats.push({
					cluster,
					cx: (minX + maxX) / 2,
					cy: (minY + maxY) / 2,
					w: Math.max(48, maxX - minX),
					h: Math.max(48, maxY - minY),
				});
			}
		}
		const cols = Math.max(1, Math.ceil(Math.sqrt(stats.length * 1.6)));
		const gap = 56;
		const colW: number[] = [];
		const rowH: number[] = [];
		for (let i = 0; i < stats.length; i++) {
			const col = i % cols;
			const row = Math.floor(i / cols);
			colW[col] = Math.max(colW[col] || 0, stats[i].w);
			rowH[row] = Math.max(rowH[row] || 0, stats[i].h);
		}
		const packed: TemporalRenderNode[] = [];
		let y = 0;
		for (let row = 0; row < rowH.length; row++) {
			let x = 0;
			for (let col = 0; col < cols; col++) {
				const i = row * cols + col;
				if (i >= stats.length) {
					break;
				}
				const item = stats[i];
				const destCx = x + (colW[col] || item.w) / 2;
				const destCy = y + (rowH[row] || item.h) / 2;
				const dx = destCx - item.cx;
				const dy = destCy - item.cy;
				for (let n = 0; n < item.cluster.length; n++) {
					const node = item.cluster[n];
					packed.push(Object.assign({}, node, {
						x: Number.isFinite(node.x) ? node.x + dx : node.x,
						y: Number.isFinite(node.y) ? node.y + dy : node.y,
					}));
				}
				x += (colW[col] || item.w) + gap;
			}
			y += (rowH[row] || 48) + gap;
		}
		return packed;
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

		const packedNodes = packFocusedClusters(visibleNodes, visibleEdges);

		return {
			displayMode: 'changes',
			contextFilterMode: 'focused',
			visibleNodes: packedNodes,
			visibleEdges,
			nodes: packedNodes,
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
 * Computes WORLD-SPACE visual radius for Temporal nodes.
 * Drawn after ctx.scale(zoom); zoom compensation keeps marks readable at Fit View.
 *
 * Changed nodes remain larger than unchanged context nodes.
 * Self-contained for webview serialization.
 */
export function computeTemporalVisualRadius(
	node: TemporalRenderNode,
	options?: {
		readonly isSelected?: boolean;
		readonly isHovered?: boolean;
		readonly isChanged?: boolean;
		readonly zoom?: number;
	},
): number {
	const isChanged = options && options.isChanged !== undefined
		? options.isChanged
		: Boolean(node && node.changeKind && node.changeKind !== 'unchanged');
	let baseScreen = isChanged ? 7.0 : 3.8;

	if (options && options.isHovered) {
		baseScreen *= 1.25;
	}
	if (options && options.isSelected) {
		baseScreen *= 1.35;
	}

	const zoom = options && typeof options.zoom === 'number' && Number.isFinite(options.zoom) ? options.zoom : 1;
	const k = Math.max(0.001, zoom);
	const minScreen = isChanged ? 4.5 : 3.2;
	const maxScreen = isChanged ? 22 : 16;
	const desired = Math.max(minScreen, Math.min(maxScreen, baseScreen * Math.pow(k, 0.5)));
	return desired / k;
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

	const padding = options && typeof options.padding === 'number' ? options.padding : 64;
	const minZoom = options && typeof options.minZoom === 'number' ? options.minZoom : 0.15;
	const maxZoom = options && typeof options.maxZoom === 'number' ? options.maxZoom : 2.0;

	const insetOpts = options ? options.insets : undefined;
	const insets = {
		top: insetOpts && typeof insetOpts.top === 'number' ? insetOpts.top : 0,
		bottom: insetOpts && typeof insetOpts.bottom === 'number' ? insetOpts.bottom : 0,
		left: insetOpts && typeof insetOpts.left === 'number' ? insetOpts.left : 0,
		right: insetOpts && typeof insetOpts.right === 'number' ? insetOpts.right : 0,
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
		if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
			continue;
		}
		const r = computeTemporalVisualRadius(node, { zoom: 1 }) + 6;
		const nx = node.x;
		const ny = node.y;
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

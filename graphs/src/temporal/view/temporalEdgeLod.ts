/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	TemporalRenderEdge,
	TemporalCommunityGuide,
	TemporalCommunityAggregateEdge,
} from './temporalViewTypes.js';

export interface EdgeLodStyle {
	readonly shouldRender: boolean;
	readonly opacity: number;
	readonly strokeWidth: number;
	readonly strokeDash: readonly number[];
	readonly isHighlighted: boolean;
	readonly isAggregate: boolean;
}

/**
 * Computes inter-community aggregate overview edges from fine-grained dependency edges.
 */
export function computeCommunityAggregateEdges(
	edges: readonly TemporalRenderEdge[],
	guides: readonly TemporalCommunityGuide[],
): TemporalCommunityAggregateEdge[] {
	if (!guides || guides.length < 2 || !edges || edges.length === 0) {
		return [];
	}

	const nodeToCommMap = new Map<string, string>();
	for (let g = 0; g < guides.length; g++) {
		const guide = guides[g];
		for (let m = 0; m < guide.nodeIds.length; m++) {
			nodeToCommMap.set(guide.nodeIds[m], guide.id);
		}
	}

	interface AggEntry {
		readonly sourceCommunityId: string;
		readonly targetCommunityId: string;
		count: number;
		changedCount: number;
		dominantKind: string;
	}

	const aggMap = new Map<string, AggEntry>();

	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		if (e.changeKind === 'removed') {continue;}

		const src = e.sourceEntityId || (e as any).sourceId;
		const tgt = e.targetEntityId || (e as any).targetId;
		if (!src || !tgt) {continue;}

		const srcComm = nodeToCommMap.get(src);
		const tgtComm = nodeToCommMap.get(tgt);
		if (!srcComm || !tgtComm || srcComm === tgtComm) {continue;}

		const key = srcComm + '::to::' + tgtComm;
		let entry = aggMap.get(key);
		if (!entry) {
			entry = {
				sourceCommunityId: srcComm,
				targetCommunityId: tgtComm,
				count: 0,
				changedCount: 0,
				dominantKind: e.kind || 'imports',
			};
			aggMap.set(key, entry);
		}

		entry.count++;
		if (e.changeKind && e.changeKind !== 'unchanged') {
			entry.changedCount++;
		}
	}

	const results: TemporalCommunityAggregateEdge[] = [];
	const sortedKeys = Array.from(aggMap.keys()).sort();

	for (let k = 0; k < sortedKeys.length; k++) {
		const entry = aggMap.get(sortedKeys[k])!;
		results.push({
			id: `agg::${entry.sourceCommunityId}::${entry.targetCommunityId}`,
			sourceCommunityId: entry.sourceCommunityId,
			targetCommunityId: entry.targetCommunityId,
			edgeCount: entry.count,
			changedEdgeCount: entry.changedCount,
			dominantKind: entry.dominantKind,
			isHighlighted: entry.changedCount > 0,
		});
	}

	return results;
}

/**
 * Determines Level of Detail (LOD) visibility and rendering style for an edge.
 */
export function computeEdgeLodStyle(
	edge: TemporalRenderEdge,
	zoom: number,
	options?: {
		readonly isConnectedToActive?: boolean;
		readonly isInteracting?: boolean;
		readonly isHighContrast?: boolean;
	},
): EdgeLodStyle {
	const isConnected = Boolean(options?.isConnectedToActive);
	const isInteracting = Boolean(options?.isInteracting);
	const isChanged = Boolean(edge.changeKind && edge.changeKind !== 'unchanged');

	// Active and Changed edges are ALWAYS rendered at 100% fidelity regardless of zoom
	if (isConnected) {
		return {
			shouldRender: true,
			opacity: 1.0,
			strokeWidth: 2.4,
			strokeDash: [],
			isHighlighted: true,
			isAggregate: false,
		};
	}

	if (isChanged) {
		const width = edge.changeKind === 'modified' ? 1.8 : (edge.changeKind === 'added' ? 1.8 : 1.4);
		const dash = edge.changeKind === 'removed' ? [4, 4] : [];
		return {
			shouldRender: true,
			opacity: 0.95,
			strokeWidth: width,
			strokeDash: dash,
			isHighlighted: false,
			isAggregate: false,
		};
	}

	// Unchanged background edges:
	// Overview mode (zoom < 0.60) or active panning/dragging: suppress dense background clutter
	if (zoom < 0.60 || isInteracting) {
		return {
			shouldRender: false,
			opacity: 0,
			strokeWidth: 0,
			strokeDash: [],
			isHighlighted: false,
			isAggregate: false,
		};
	}

	// Transition / Intermediate zoom (0.60 <= zoom < 1.05)
	if (zoom < 1.05) {
		const t = (zoom - 0.60) / 0.45;
		const opacity = 0.15 + t * 0.25;
		const strokeWidth = 0.8 + t * 0.25;
		return {
			shouldRender: true,
			opacity,
			strokeWidth,
			strokeDash: [],
			isHighlighted: false,
			isAggregate: false,
		};
	}

	// Full Detail zoom (zoom >= 1.05)
	return {
		shouldRender: true,
		opacity: 0.55,
		strokeWidth: 1.1,
		strokeDash: [],
		isHighlighted: false,
		isAggregate: false,
	};
}

/**
 * Deterministic community-aggregate quadratic control point.
 * Lane offsets prevent many vertical pairs from sharing one spear corridor.
 * Self-contained for webview serialization.
 */
export function computeAggregateEdgeRoute(
	srcX: number,
	srcY: number,
	tgtX: number,
	tgtY: number,
	srcRadius: number,
	tgtRadius: number,
	pairIndex: number,
	pairCount: number,
	sourceCommunityId: string,
	targetCommunityId: string,
): { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly cpX: number; readonly cpY: number } {
	const dx = tgtX - srcX;
	const dy = tgtY - srcY;
	const dist = Math.hypot(dx, dy) || 1;
	const ux = dx / dist;
	const uy = dy / dist;
	const x1 = srcX + ux * Math.min(srcRadius * 0.75, dist * 0.35);
	const y1 = srcY + uy * Math.min(srcRadius * 0.75, dist * 0.35);
	const x2 = tgtX - ux * Math.min(tgtRadius * 0.75, dist * 0.35);
	const y2 = tgtY - uy * Math.min(tgtRadius * 0.75, dist * 0.35);
	const midX = (x1 + x2) / 2;
	const midY = (y1 + y2) / 2;
	let hash = 2166136261;
	const key = String(sourceCommunityId) + '>' + String(targetCommunityId);
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	const laneFromId = ((hash >>> 0) % 11) - 5;
	// pairIndex/pairCount are local to one undirected community pair — clamp so a
	// mistaken global index cannot blow the corridor into a spear.
	const rawCentered = pairCount > 1 ? (pairIndex - (pairCount - 1) / 2) : 0;
	const centered = Math.max(-3, Math.min(3, rawCentered));
	const lane = laneFromId + centered;
	const base = 14 + Math.min(36, dist * 0.07);
	const offset = base + lane * 10;
	const reciprocal = sourceCommunityId > targetCommunityId ? -1 : 1;
	return {
		x1: x1,
		y1: y1,
		x2: x2,
		y2: y2,
		cpX: midX - uy * offset * reciprocal,
		cpY: midY + ux * offset * reciprocal,
	};
}

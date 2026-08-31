/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { TemporalCommunityGuide, TemporalRenderNode } from '../../temporal/view/temporalViewTypes.js';

export type TemporalProjectionTier = 'overview' | 'medium' | 'detail';

export interface TemporalProjectionViewport {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface TemporalProjectionOptions {
	readonly zoom: number;
	readonly displayMode?: string;
	readonly selectedEntityId?: string;
	readonly hoveredEntityId?: string;
	readonly searchQuery?: string;
	readonly expandedGuideId?: string;
	readonly viewport?: TemporalProjectionViewport;
	readonly currentFileEntityId?: string;
}

export interface TemporalProjectedLeaf {
	readonly kind: 'leaf';
	readonly entityId: string;
	readonly node: TemporalRenderNode;
	readonly x: number;
	readonly y: number;
}

export interface TemporalProjectedAggregate {
	readonly kind: 'aggregate';
	readonly entityId: string;
	readonly guideId: string;
	readonly label: string;
	readonly x: number;
	readonly y: number;
	readonly radius: number;
	readonly color: string;
	readonly nodeCount: number;
	readonly changedCount: number;
	readonly memberIds: readonly string[];
}

export type TemporalProjectedItem = TemporalProjectedLeaf | TemporalProjectedAggregate;

export interface TemporalProjection {
	readonly tier: TemporalProjectionTier;
	readonly items: readonly TemporalProjectedItem[];
	readonly receivedLeafNodeCount: number;
	readonly leafNodesDrawn: number;
	readonly aggregateNodesDrawn: number;
	readonly communitiesRepresented: number;
	readonly visibleChangedNodeCount: number;
	readonly visibleChangedAggregateCount: number;
	readonly culledLeafCount: number;
	readonly memberIdsByAggregateId: ReadonlyMap<string, readonly string[]>;
}

/**
 * Resolve semantic zoom tier. Small graphs stay leaf-visible; large Full Maps
 * use community aggregates at Fit-scale zooms.
 *
 * Self-contained for CSP webview serialization — no arrows, no module locals.
 */
export function resolveTemporalProjectionTier(
	zoom: number,
	leafCount: number,
	guideCount: number,
	displayMode?: string,
): TemporalProjectionTier {
	const k = typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : 1;
	if (displayMode === 'changes' || displayMode === 'focus') {
		return leafCount > 220 && k < 0.35 ? 'medium' : 'detail';
	}
	if (guideCount < 2 || leafCount <= 64) {
		return k < 0.22 ? 'medium' : 'detail';
	}
	if (leafCount > 400 && k < 0.5) {
		return 'overview';
	}
	if (k < 0.35) {
		return 'overview';
	}
	if (k < 0.85) {
		return 'medium';
	}
	return 'detail';
}

/**
 * View projection: canonical Temporal nodes stay exact. This only chooses what
 * to draw. Aggregates map 1:1 onto existing community guides.
 */
export function projectTemporalVisibleSet(
	visibleNodes: readonly TemporalRenderNode[] | undefined,
	guides: readonly TemporalCommunityGuide[] | undefined,
	options?: TemporalProjectionOptions,
): TemporalProjection {
	const nodes = visibleNodes || [];
	const guideList = guides || [];
	const zoom = options && typeof options.zoom === 'number' && Number.isFinite(options.zoom) ? options.zoom : 1;
	const displayMode = options && options.displayMode;
	const selectedId = options && options.selectedEntityId;
	const hoveredId = options && options.hoveredEntityId;
	const currentFileId = options && options.currentFileEntityId;
	const expandedGuideId = options && options.expandedGuideId;
	const query = options && options.searchQuery ? String(options.searchQuery).toLowerCase() : '';
	const viewport = options && options.viewport;

	const memberIdsByAggregateId = new Map();
	const nodeToGuide = new Map();
	for (let g = 0; g < guideList.length; g++) {
		const guide = guideList[g];
		const ids = guide.nodeIds || [];
		memberIdsByAggregateId.set(guide.id, ids);
		for (let m = 0; m < ids.length; m++) {
			nodeToGuide.set(ids[m], guide);
		}
	}

	const visibleIdSet = new Set();
	for (let i = 0; i < nodes.length; i++) {
		visibleIdSet.add(nodes[i].entityId);
	}

	function isChangedKind(kind: string | undefined): boolean {
		return Boolean(kind && kind !== 'unchanged');
	}

	function inViewport(x: number, y: number, pad: number): boolean {
		if (!viewport) {
			return true;
		}
		return x >= viewport.minX - pad && x <= viewport.maxX + pad && y >= viewport.minY - pad && y <= viewport.maxY + pad;
	}

	function isPiercing(node: TemporalRenderNode): boolean {
		if (selectedId && (node.entityId === selectedId || node.canonicalNodeId === selectedId)) {
			return true;
		}
		if (hoveredId && node.entityId === hoveredId) {
			return true;
		}
		if (currentFileId && node.entityId === currentFileId) {
			return true;
		}
		if (isChangedKind(node.changeKind)) {
			return true;
		}
		if (query) {
			const label = (node.label || '').toLowerCase();
			const path = (node.path || '').toLowerCase();
			if (label.indexOf(query) >= 0 || path.indexOf(query) >= 0) {
				return true;
			}
		}
		const guide = nodeToGuide.get(node.entityId);
		if (expandedGuideId && guide && guide.id === expandedGuideId) {
			return true;
		}
		return false;
	}

	function resolveTier(k: number, leafCount: number, guideCount: number, mode: string | undefined): TemporalProjectionTier {
		if (mode === 'changes' || mode === 'focus') {
			return leafCount > 220 && k < 0.35 ? 'medium' : 'detail';
		}
		if (guideCount < 2 || leafCount <= 64) {
			return k < 0.22 ? 'medium' : 'detail';
		}
		if (leafCount > 400 && k < 0.5) {
			return 'overview';
		}
		if (k < 0.35) {
			return 'overview';
		}
		if (k < 0.85) {
			return 'medium';
		}
		return 'detail';
	}

	const changedCountByGuide = new Map();
	for (let i = 0; i < nodes.length; i++) {
		if (!isChangedKind(nodes[i].changeKind)) {
			continue;
		}
		const changedGuide = nodeToGuide.get(nodes[i].entityId);
		if (changedGuide) {
			changedCountByGuide.set(changedGuide.id, (changedCountByGuide.get(changedGuide.id) || 0) + 1);
		}
	}

	const tier = resolveTier(zoom, nodes.length, guideList.length, displayMode);
	const items: TemporalProjectedItem[] = [];
	const drawnLeafIds = new Set();
	let visibleChangedAggregateCount = 0;
	let culledLeafCount = 0;

	function pushLeaf(node: TemporalRenderNode): void {
		if (drawnLeafIds.has(node.entityId)) {
			return;
		}
		if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
			return;
		}
		const pad = tier === 'detail' ? 80 : 140;
		if (!inViewport(node.x, node.y, pad)) {
			culledLeafCount++;
			return;
		}
		drawnLeafIds.add(node.entityId);
		items.push({
			kind: 'leaf',
			entityId: node.entityId,
			node: node,
			x: node.x,
			y: node.y,
		});
	}

	function pushAggregate(guide: TemporalCommunityGuide, nodeCount: number, radiusScale: number): void {
		const changedCount = changedCountByGuide.get(guide.id) || 0;
		if (changedCount > 0) {
			visibleChangedAggregateCount++;
		}
		items.push({
			kind: 'aggregate',
			entityId: 'agg:' + guide.id,
			guideId: guide.id,
			label: guide.label || guide.id,
			x: guide.x,
			y: guide.y,
			radius: Math.max(radiusScale < 1 ? 14 : 18, (guide.radius || (radiusScale < 1 ? 24 : 28)) * radiusScale),
			color: typeof guide.color === 'string' ? guide.color : '#6366f1',
			nodeCount: nodeCount,
			changedCount: changedCount,
			memberIds: guide.nodeIds || [],
		});
	}

	if (tier === 'overview' && guideList.length >= 2) {
		for (let g = 0; g < guideList.length; g++) {
			const guide = guideList[g];
			const memberIds = guide.nodeIds || [];
			let visibleMembers = 0;
			for (let m = 0; m < memberIds.length; m++) {
				if (visibleIdSet.has(memberIds[m])) {
					visibleMembers++;
				}
			}
			if (visibleMembers === 0) {
				continue;
			}
			pushAggregate(guide, visibleMembers, 1);
		}
		for (let i = 0; i < nodes.length; i++) {
			if (isPiercing(nodes[i]) || !nodeToGuide.has(nodes[i].entityId)) {
				pushLeaf(nodes[i]);
			}
		}
	} else if (tier === 'medium') {
		const representativeByGuide = new Map();
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (isPiercing(node) || !nodeToGuide.has(node.entityId)) {
				pushLeaf(node);
				continue;
			}
			const guide = nodeToGuide.get(node.entityId);
			const prev = representativeByGuide.get(guide.id);
			if (!prev || node.entityId < prev.entityId) {
				representativeByGuide.set(guide.id, node);
			}
		}
		representativeByGuide.forEach(function (node) {
			pushLeaf(node);
		});
		if (guideList.length >= 2 && nodes.length > 180) {
			for (let g = 0; g < guideList.length; g++) {
				const guide = guideList[g];
				const memberIds = guide.nodeIds || [];
				let remaining = 0;
				for (let m = 0; m < memberIds.length; m++) {
					if (visibleIdSet.has(memberIds[m]) && !drawnLeafIds.has(memberIds[m])) {
						remaining++;
					}
				}
				if (remaining <= 0) {
					continue;
				}
				pushAggregate(guide, remaining, 0.55);
			}
		}
	} else {
		for (let i = 0; i < nodes.length; i++) {
			pushLeaf(nodes[i]);
		}
	}

	let aggregateNodesDrawn = 0;
	let leafNodesDrawn = 0;
	let visibleChangedNodeCount = 0;
	for (let i = 0; i < items.length; i++) {
		if (items[i].kind === 'aggregate') {
			aggregateNodesDrawn++;
		} else {
			leafNodesDrawn++;
			const leaf = items[i];
			if (leaf.kind === 'leaf' && isChangedKind(leaf.node.changeKind)) {
				visibleChangedNodeCount++;
			}
		}
	}

	return {
		tier: tier,
		items: items,
		receivedLeafNodeCount: nodes.length,
		leafNodesDrawn: leafNodesDrawn,
		aggregateNodesDrawn: aggregateNodesDrawn,
		communitiesRepresented: aggregateNodesDrawn,
		visibleChangedNodeCount: visibleChangedNodeCount,
		visibleChangedAggregateCount: visibleChangedAggregateCount,
		culledLeafCount: culledLeafCount,
		memberIdsByAggregateId: memberIdsByAggregateId,
	};
}

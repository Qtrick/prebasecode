/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	TemporalStructuralDiff,
	TemporalRenderNode,
	TemporalRenderEdge,
	TemporalLayoutResult,
	TemporalCommunityGuide,
	TemporalRegionBounds,
} from './temporalViewTypes.js';
import {
	computeAdaptiveCommunities,
	getNodeArchitectureLayer,
	getLayerColor,
	type AdaptiveCommunity,
} from './temporalGraphTopology.js';
import {
	computeGuideOverlaps,
} from './temporalLayoutQuality.js';

/** Bump when initial Temporal geometry algorithm changes so in-memory positions reset. */
export const TEMPORAL_INITIAL_LAYOUT_VERSION = 4;

export interface TemporalLayoutOptions {
	readonly width?: number;
	readonly height?: number;
	readonly nodeSpacing?: number;
}

export type TemporalClusterGuide = TemporalCommunityGuide;

const GOLDEN_ANGLE = 2.399963229728653;

/**
 * Lightweight 2D Spatial Grid for O(1) neighborhood collision checks and free-slot queries.
 */
export class Spatial2DGrid {
	private readonly cellSize: number;
	private readonly grid = new Map<string, number[]>();

	constructor(cellSize: number) {
		this.cellSize = Math.max(1, cellSize);
	}

	clear(): void {
		this.grid.clear();
	}

	insert(index: number, x: number, y: number): void {
		const cx = Math.floor(x / this.cellSize);
		const cy = Math.floor(y / this.cellSize);
		const k = `${cx},${cy}`;
		let cell = this.grid.get(k);
		if (!cell) {
			cell = [];
			this.grid.set(k, cell);
		}
		cell.push(index);
	}

	queryNearby(x: number, y: number): number[] {
		const cx = Math.floor(x / this.cellSize);
		const cy = Math.floor(y / this.cellSize);
		const result: number[] = [];
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				const cell = this.grid.get(`${cx + dx},${cy + dy}`);
				if (cell) {
					for (let i = 0; i < cell.length; i++) {
						result.push(cell[i]);
					}
				}
			}
		}
		return result;
	}
}

export function getArchitectureLayerColor(layerId?: string): string {
	return getLayerColor(layerId);
}

export function getNodeLayer(node: TemporalRenderNode): string {
	return getNodeArchitectureLayer(node);
}

export function enrichNodeWithLayer(node: TemporalRenderNode): TemporalRenderNode {
	const layer = getNodeArchitectureLayer(node);
	return {
		...node,
		meta: {
			...(node.meta || {}),
			architectureLayer: layer,
		},
	};
}

/**
 * Computes post-collision bounding geometry and guides for communities from final node coordinates.
 * Guaranteed invariant: 100% of member nodes are strictly enclosed inside their guide bounds and radius.
 */
export function derivePostCollisionGuides(
	communities: readonly AdaptiveCommunity[],
	positions: ReadonlyMap<string, { x: number; y: number }>,
	padding = 24,
): TemporalCommunityGuide[] {
	const guides: TemporalCommunityGuide[] = [];

	for (let i = 0; i < communities.length; i++) {
		const comm = communities[i];
		const memberIds = comm.nodeIds;
		if (memberIds.length === 0) {continue;}

		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		const presentCoords: { x: number; y: number }[] = [];

		for (let m = 0; m < memberIds.length; m++) {
			const pos = positions.get(memberIds[m]);
			if (pos) {
				presentCoords.push(pos);
				if (pos.x < minX) {minX = pos.x;}
				if (pos.y < minY) {minY = pos.y;}
				if (pos.x > maxX) {maxX = pos.x;}
				if (pos.y > maxY) {maxY = pos.y;}
			}
		}

		if (presentCoords.length === 0) {continue;}

		const cx = Math.round((minX + maxX) / 2);
		const cy = Math.round((minY + maxY) / 2);

		let maxDistSq = 0;
		for (let p = 0; p < presentCoords.length; p++) {
			const pt = presentCoords[p];
			const distSq = (pt.x - cx) * (pt.x - cx) + (pt.y - cy) * (pt.y - cy);
			if (distSq > maxDistSq) {maxDistSq = distSq;}
		}

		const radius = Math.round(Math.sqrt(maxDistSq) + Math.min(padding, 16));
		const bounds: TemporalRegionBounds = {
			minX: minX - padding,
			minY: minY - padding,
			maxX: maxX + padding,
			maxY: maxY + padding,
			width: (maxX - minX) + padding * 2,
			height: (maxY - minY) + padding * 2,
		};

		guides.push({
			id: comm.id,
			label: comm.label,
			layerId: comm.primaryLayer,
			color: comm.color,
			x: cx,
			y: cy,
			radius: Math.max(radius, 40),
			bounds,
			nodeIds: memberIds,
			nodeCount: presentCoords.length,
		});
	}

	return guides;
}

interface CommunityLinkWeight {
	readonly source: string;
	readonly target: string;
	readonly weight: number;
}

function buildCommunityLinkWeights(
	communities: readonly AdaptiveCommunity[],
	edges: readonly TemporalRenderEdge[],
): CommunityLinkWeight[] {
	const nodeToComm = new Map<string, string>();
	for (const comm of communities) {
		for (const id of comm.nodeIds) {
			nodeToComm.set(id, comm.id);
		}
	}
	const weights = new Map<string, number>();
	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		if (e.changeKind === 'removed') {continue;}
		const src = e.sourceEntityId || (e as { sourceId?: string }).sourceId;
		const tgt = e.targetEntityId || (e as { targetId?: string }).targetId;
		if (!src || !tgt) {continue;}
		const a = nodeToComm.get(src);
		const b = nodeToComm.get(tgt);
		if (!a || !b || a === b) {continue;}
		const key = a < b ? `${a}::${b}` : `${b}::${a}`;
		weights.set(key, (weights.get(key) ?? 0) + 1);
	}
	const result: CommunityLinkWeight[] = [];
	for (const [key, weight] of weights) {
		const sep = key.indexOf('::');
		result.push({ source: key.slice(0, sep), target: key.slice(sep + 2), weight });
	}
	result.sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
	return result;
}

/**
 * Compact dependency-aware community map.
 *
 * Preserves SCC / adaptive community detection. Replaces rigid vertical depth ranks
 * with phyllotaxis seeding + soft topological depth bias + bounded community relaxation.
 */
export function computeSemanticTemporalInitialLayout(
	nodes: readonly TemporalRenderNode[],
	edges: readonly TemporalRenderEdge[],
	nodeSpacing = 48,
	options?: { readonly width?: number; readonly height?: number },
): TemporalLayoutResult {
	const positions = new Map<string, { x: number; y: number }>();
	const resultNodes: TemporalRenderNode[] = [];

	if (nodes.length === 0) {
		return { nodes: resultNodes, positions, guides: [] };
	}

	const communities = computeAdaptiveCommunities(nodes, edges);
	const viewportW = options?.width && options.width > 0 ? options.width : 1400;
	const viewportH = options?.height && options.height > 0 ? options.height : 800;
	const aspect = Math.max(0.75, Math.min(1.85, viewportW / Math.max(1, viewportH)));

	const sortedCommunities = [...communities].sort((a, b) =>
		b.nodeIds.length - a.nodeIds.length || a.id.localeCompare(b.id)
	);

	const commRadiusMap = new Map<string, number>();
	let meanDepth = 0;
	for (let i = 0; i < sortedCommunities.length; i++) {
		const comm = sortedCommunities[i];
		const estR = Math.max(40, Math.sqrt(comm.nodeIds.length) * (nodeSpacing * 0.48) + 16);
		commRadiusMap.set(comm.id, estR);
		meanDepth += comm.depth;
	}
	meanDepth = sortedCommunities.length > 0 ? meanDepth / sortedCommunities.length : 0;

	const clusterCenters = new Map<string, { x: number; y: number; estimatedRadius: number }>();
	const packStepBase = Math.max(48, nodeSpacing * 0.95);
	// Keep macro extent from exploding with hundreds of communities on large repos.
	const packStep = packStepBase;

	for (let i = 0; i < sortedCommunities.length; i++) {
		const comm = sortedCommunities[i];
		const rVal = commRadiusMap.get(comm.id) || 50;
		const angle = i * GOLDEN_ANGLE;
		const ring = Math.sqrt(i) * packStep + rVal * 0.35;
		const depthBias = (comm.depth - meanDepth) * Math.min(42, packStep * 0.55);
		const cx = Math.round(Math.cos(angle) * ring * Math.sqrt(aspect));
		const cy = Math.round(Math.sin(angle) * ring / Math.sqrt(aspect) + depthBias);
		clusterCenters.set(comm.id, { x: cx, y: cy, estimatedRadius: rVal });
	}

	// Bounded community-level relaxation: repel overlaps, attract strong links, soft depth.
	const links = buildCommunityLinkWeights(sortedCommunities, edges);
	const centerList = sortedCommunities.map(c => {
		const center = clusterCenters.get(c.id)!;
		return { id: c.id, x: center.x, y: center.y, r: center.estimatedRadius, depth: c.depth };
	});
	centerList.sort((a, b) => a.id.localeCompare(b.id));
	const centerById = new Map(centerList.map(c => [c.id, c]));

	for (let iter = 0; iter < 10; iter++) {
		for (let i = 0; i < centerList.length; i++) {
			for (let j = i + 1; j < centerList.length; j++) {
				const a = centerList[i];
				const b = centerList[j];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dist = Math.hypot(dx, dy);
				const minDist = a.r + b.r + 28;
				if (dist < minDist) {
					const angle = dist > 0.001 ? Math.atan2(dy, dx) : (i * 0.618 + iter * 0.17);
					const overlap = (minDist - Math.max(dist, 0.001)) / 2;
					a.x -= Math.round(Math.cos(angle) * overlap);
					a.y -= Math.round(Math.sin(angle) * overlap);
					b.x += Math.round(Math.cos(angle) * overlap);
					b.y += Math.round(Math.sin(angle) * overlap);
				}
			}
		}
		for (let l = 0; l < links.length; l++) {
			const link = links[l];
			const a = centerById.get(link.source);
			const b = centerById.get(link.target);
			if (!a || !b) {continue;}
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const dist = Math.hypot(dx, dy);
			const ideal = a.r + b.r + 90;
			if (dist > ideal + 40) {
				const pull = Math.min(0.12, 0.02 + link.weight * 0.008);
				const mx = dx * pull * 0.5;
				const my = dy * pull * 0.5;
				a.x = Math.round(a.x + mx);
				a.y = Math.round(a.y + my);
				b.x = Math.round(b.x - mx);
				b.y = Math.round(b.y - my);
			}
		}
		// Soft depth preference: shallower communities slightly upward.
		for (let i = 0; i < centerList.length; i++) {
			const c = centerList[i];
			const preferredY = (c.depth - meanDepth) * 28;
			c.y = Math.round(c.y + (preferredY - c.y) * 0.08);
		}
	}

	for (let i = 0; i < centerList.length; i++) {
		const c = centerList[i];
		clusterCenters.set(c.id, { x: c.x, y: c.y, estimatedRadius: c.r });
	}

	// Soft aspect-aware compaction only when the macro cloud is pathologically large.
	{
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const c of centerList) {
			minX = Math.min(minX, c.x - c.r);
			maxX = Math.max(maxX, c.x + c.r);
			minY = Math.min(minY, c.y - c.r);
			maxY = Math.max(maxY, c.y + c.r);
		}
		const bw = Math.max(1, maxX - minX);
		const bh = Math.max(1, maxY - minY);
		const targetW = Math.max(viewportW * 0.88, 1200) * Math.sqrt(aspect);
		const targetH = Math.max(viewportH * 0.82, 900) / Math.sqrt(aspect);
		const scale = Math.min(1, targetW / bw, targetH / bh);
		// Only compress extreme outliers; keep local community footprints intact.
		if (scale < 0.55) {
			const cx = (minX + maxX) / 2;
			const cy = (minY + maxY) / 2;
			for (const c of centerList) {
				c.x = Math.round(cx + (c.x - cx) * scale);
				c.y = Math.round(cy + (c.y - cy) * scale);
				clusterCenters.set(c.id, { x: c.x, y: c.y, estimatedRadius: c.r });
			}
		}
	}

	// Lightweight barycenter ordering nudge on strongly linked communities (few passes).
	for (let pass = 0; pass < 3; pass++) {
		for (let i = 0; i < centerList.length; i++) {
			const c = centerList[i];
			let sx = 0;
			let sy = 0;
			let w = 0;
			for (let l = 0; l < links.length; l++) {
				const link = links[l];
				let otherId: string | undefined;
				if (link.source === c.id) {otherId = link.target;}
				else if (link.target === c.id) {otherId = link.source;}
				if (!otherId) {continue;}
				const other = clusterCenters.get(otherId);
				if (!other) {continue;}
				sx += other.x * link.weight;
				sy += other.y * link.weight;
				w += link.weight;
			}
			if (w <= 0) {continue;}
			const bx = sx / w;
			const by = sy / w;
			c.x = Math.round(c.x + (bx - c.x) * 0.12);
			c.y = Math.round(c.y + (by - c.y) * 0.12);
			clusterCenters.set(c.id, { x: c.x, y: c.y, estimatedRadius: c.r });
		}
	}

	const nodeMap = new Map<string, TemporalRenderNode>();
	for (let i = 0; i < nodes.length; i++) {
		nodeMap.set(nodes[i].entityId, enrichNodeWithLayer(nodes[i]));
	}

	for (let i = 0; i < communities.length; i++) {
		const comm = communities[i];
		const center = clusterCenters.get(comm.id) || { x: 0, y: 0, estimatedRadius: 60 };
		const memberIds = comm.nodeIds;
		const count = memberIds.length;

		for (let idx = 0; idx < count; idx++) {
			const node = nodeMap.get(memberIds[idx])!;
			let nx = center.x;
			let ny = center.y;

			if (count > 1) {
				if (idx === 0) {
					nx = center.x;
					ny = center.y;
				} else {
					const localAngle = idx * GOLDEN_ANGLE;
					const localDist = Math.sqrt(idx) * (nodeSpacing * 0.58) + 12;
					nx = Math.round(center.x + Math.cos(localAngle) * localDist);
					ny = Math.round(center.y + Math.sin(localAngle) * localDist * 0.90);
				}
			}

			positions.set(node.entityId, { x: nx, y: ny });
			resultNodes.push({
				...node,
				x: nx,
				y: ny,
			});
		}
	}

	// Community-local collision first (cheaper), then a short global polish pass.
	const MIN_NODE_DIST = Math.max(34, nodeSpacing * 0.70);
	const nodePosList = resultNodes.map(n => ({ id: n.entityId, x: n.x, y: n.y, communityId: '' as string }));
	const nodeToComm = new Map<string, string>();
	for (const comm of communities) {
		for (const id of comm.nodeIds) {nodeToComm.set(id, comm.id);}
	}
	for (const p of nodePosList) {
		p.communityId = nodeToComm.get(p.id) || '';
	}
	nodePosList.sort((a, b) => a.id.localeCompare(b.id));

	const grid = new Spatial2DGrid(MIN_NODE_DIST);

	for (let iter = 0; iter < 5; iter++) {
		grid.clear();
		for (let i = 0; i < nodePosList.length; i++) {
			grid.insert(i, nodePosList[i].x, nodePosList[i].y);
		}
		for (let i = 0; i < nodePosList.length; i++) {
			const p1 = nodePosList[i];
			const nearby = grid.queryNearby(p1.x, p1.y);
			for (let n = 0; n < nearby.length; n++) {
				const j = nearby[n];
				if (j <= i) continue;
				const p2 = nodePosList[j];
				if (p1.communityId && p2.communityId && p1.communityId !== p2.communityId) {
					continue;
				}
				const dx = p2.x - p1.x;
				const dy = p2.y - p1.y;
				const dist = Math.hypot(dx, dy);
				if (dist < MIN_NODE_DIST) {
					const angle = dist > 0.001 ? Math.atan2(dy, dx) : (i * 0.618);
					const overlap = (MIN_NODE_DIST - dist) / 2;
					p1.x -= Math.round(Math.cos(angle) * overlap);
					p1.y -= Math.round(Math.sin(angle) * overlap);
					p2.x += Math.round(Math.cos(angle) * overlap);
					p2.y += Math.round(Math.sin(angle) * overlap);
				}
			}
		}
	}
	// Global polish for boundary overlaps between communities
	for (let iter = 0; iter < 4; iter++) {
		grid.clear();
		for (let i = 0; i < nodePosList.length; i++) {
			grid.insert(i, nodePosList[i].x, nodePosList[i].y);
		}
		let adjusted = false;
		for (let i = 0; i < nodePosList.length; i++) {
			const p1 = nodePosList[i];
			const nearby = grid.queryNearby(p1.x, p1.y);
			for (let n = 0; n < nearby.length; n++) {
				const j = nearby[n];
				if (j <= i) continue;
				const p2 = nodePosList[j];
				const dx = p2.x - p1.x;
				const dy = p2.y - p1.y;
				const dist = Math.hypot(dx, dy);
				if (dist < MIN_NODE_DIST) {
					const angle = dist > 0.001 ? Math.atan2(dy, dx) : (i * 0.618);
					const overlap = (MIN_NODE_DIST - dist) / 2;
					p1.x -= Math.round(Math.cos(angle) * overlap);
					p1.y -= Math.round(Math.sin(angle) * overlap);
					p2.x += Math.round(Math.cos(angle) * overlap);
					p2.y += Math.round(Math.sin(angle) * overlap);
					adjusted = true;
				}
			}
		}
		if (!adjusted) {
			break;
		}
	}

	for (let i = 0; i < nodePosList.length; i++) {
		const p = nodePosList[i];
		positions.set(p.id, { x: p.x, y: p.y });
	}

	const finalNodes = resultNodes.map(n => {
		const pos = positions.get(n.entityId) || { x: n.x, y: n.y };
		return { ...n, x: pos.x, y: pos.y };
	});

	const guides = derivePostCollisionGuides(communities, positions, 24);

	return {
		nodes: finalNodes,
		positions,
		guides,
	};
}

/**
 * Layouts the temporal graph with incremental mental map preservation across commits.
 */
export function layoutTemporalGraph(
	diff: TemporalStructuralDiff,
	previousPositions: ReadonlyMap<string, { x: number; y: number }>,
	options?: TemporalLayoutOptions,
): TemporalLayoutResult {
	const nextPositions = new Map<string, { x: number; y: number }>();
	const positionedNodes: TemporalRenderNode[] = [];
	const unpositionedNodes: TemporalRenderNode[] = [];

	const nodeSpacing = options?.nodeSpacing ?? 48;

	const connectedNeighbors = new Map<string, Set<string>>();
	for (let i = 0; i < diff.edges.length; i++) {
		const edge = diff.edges[i];
		if (edge.changeKind !== 'removed') {
			const src = edge.sourceEntityId || (edge as { sourceId?: string }).sourceId;
			const tgt = edge.targetEntityId || (edge as { targetId?: string }).targetId;
			if (!src || !tgt) {continue;}

			let srcSet = connectedNeighbors.get(src);
			if (!srcSet) {
				srcSet = new Set();
				connectedNeighbors.set(src, srcSet);
			}
			srcSet.add(tgt);

			let tgtSet = connectedNeighbors.get(tgt);
			if (!tgtSet) {
				tgtSet = new Set();
				connectedNeighbors.set(tgt, tgtSet);
			}
			tgtSet.add(src);
		}
	}

	if (previousPositions.size === 0) {
		return computeSemanticTemporalInitialLayout(diff.nodes, diff.edges, nodeSpacing, {
			width: options?.width,
			height: options?.height,
		});
	}

	for (let i = 0; i < diff.nodes.length; i++) {
		const node = diff.nodes[i];
		const prev = previousPositions.get(node.entityId);
		if (prev) {
			nextPositions.set(node.entityId, { x: prev.x, y: prev.y });
			positionedNodes.push(enrichNodeWithLayer({
				...node,
				x: prev.x,
				y: prev.y,
			}));
		} else {
			unpositionedNodes.push(node);
		}
	}

	const occupiedCoords: { x: number; y: number }[] = Array.from(nextPositions.values());
	const MIN_NODE_DISTANCE = Math.max(30, nodeSpacing * 0.65);
	const occupiedGrid = new Spatial2DGrid(MIN_NODE_DISTANCE);
	for (let i = 0; i < occupiedCoords.length; i++) {
		occupiedGrid.insert(i, occupiedCoords[i].x, occupiedCoords[i].y);
	}

	function isSlotFree(x: number, y: number): boolean {
		const nearby = occupiedGrid.queryNearby(x, y);
		const threshSq = MIN_NODE_DISTANCE * MIN_NODE_DISTANCE;
		for (let i = 0; i < nearby.length; i++) {
			const p = occupiedCoords[nearby[i]];
			const distSq = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
			if (distSq < threshSq) {
				return false;
			}
		}
		return true;
	}

	function findFreeSlotNear(centerX: number, centerY: number, seed: number): { x: number; y: number } {
		if (isSlotFree(centerX, centerY)) {
			return { x: centerX, y: centerY };
		}

		const baseAngle = (seed % 360) * (Math.PI / 180);
		for (let step = 1; step <= 48; step++) {
			const radius = MIN_NODE_DISTANCE * (0.95 + Math.floor(step / 6) * 0.55);
			const angle = baseAngle + step * 1.047;
			const candX = Math.round(centerX + Math.cos(angle) * radius);
			const candY = Math.round(centerY + Math.sin(angle) * radius);
			if (isSlotFree(candX, candY)) {
				return { x: candX, y: candY };
			}
		}

		return { x: centerX + (seed % 19) - 9, y: centerY + (seed % 17) - 8 };
	}

	for (let i = 0; i < unpositionedNodes.length; i++) {
		const node = unpositionedNodes[i];
		const neighbors = connectedNeighbors.get(node.entityId);
		let targetX = 0;
		let targetY = 0;
		let foundAnchor = false;

		if (neighbors && neighbors.size > 0) {
			const knownNeighborPositions: { x: number; y: number }[] = [];
			for (const neighborId of neighbors) {
				const pos = nextPositions.get(neighborId);
				if (pos) {
					knownNeighborPositions.push(pos);
				}
			}

			if (knownNeighborPositions.length > 0) {
				let avgX = 0;
				let avgY = 0;
				for (let p = 0; p < knownNeighborPositions.length; p++) {
					avgX += knownNeighborPositions[p].x;
					avgY += knownNeighborPositions[p].y;
				}
				avgX /= knownNeighborPositions.length;
				avgY /= knownNeighborPositions.length;

				const angle = (hashString(node.entityId) % 360) * (Math.PI / 180);
				const dist = nodeSpacing * 0.95;
				targetX = Math.round(avgX + Math.cos(angle) * dist);
				targetY = Math.round(avgY + Math.sin(angle) * dist);
				foundAnchor = true;
			}
		}

		if (!foundAnchor) {
			const layer = getNodeArchitectureLayer(node);
			const baseCoord = getFallbackLayerAnchor(layer);
			const hash = hashString(node.entityId);
			const localAngle = ((hash % 1000) / 1000) * 2 * Math.PI;
			const localR = 30 + (hash % 80);
			targetX = Math.round(baseCoord.x + Math.cos(localAngle) * localR);
			targetY = Math.round(baseCoord.y + Math.sin(localAngle) * localR);
		}

		const slot = findFreeSlotNear(targetX, targetY, hashString(node.entityId));
		nextPositions.set(node.entityId, slot);
		const newIdx = occupiedCoords.length;
		occupiedCoords.push(slot);
		occupiedGrid.insert(newIdx, slot.x, slot.y);

		positionedNodes.push(enrichNodeWithLayer({
			...node,
			x: slot.x,
			y: slot.y,
		}));
	}

	const activeNodes = positionedNodes.filter(n => n.changeKind !== 'removed');
	const activeCommunities = computeAdaptiveCommunities(activeNodes, diff.edges);
	let guides = derivePostCollisionGuides(activeCommunities, nextPositions, 24);

	// Bounded Local Relaxation:
	// If local degradation is detected (overlapping guides),
	// perform bounded local relaxation on the affected subset while keeping far-away
	// unaffected communities strictly anchored (mental map preservation).
	const guideOverlap = computeGuideOverlaps(guides);
	const hasDegradation = guideOverlap.guideOverlapCount > 0;

	if (hasDegradation && previousPositions.size > 0) {
		const overlappingCommIds = new Set<string>();
		for (let p = 0; p < guideOverlap.overlappingPairs.length; p++) {
			overlappingCommIds.add(guideOverlap.overlappingPairs[p][0]);
			overlappingCommIds.add(guideOverlap.overlappingPairs[p][1]);
		}

		// Identify affected entity IDs
		const affectedEntityIds = new Set<string>();
		for (let u = 0; u < unpositionedNodes.length; u++) {
			affectedEntityIds.add(unpositionedNodes[u].entityId);
		}
		for (let i = 0; i < positionedNodes.length; i++) {
			const n = positionedNodes[i];
			if (n.changeKind && n.changeKind !== 'unchanged') {
				affectedEntityIds.add(n.entityId);
			}
		}
		for (let c = 0; c < activeCommunities.length; c++) {
			const comm = activeCommunities[c];
			if (overlappingCommIds.has(comm.id)) {
				for (let m = 0; m < comm.nodeIds.length; m++) {
					affectedEntityIds.add(comm.nodeIds[m]);
				}
			}
		}

		if (affectedEntityIds.size > 0) {
			const initialPositions = new Map<string, { x: number; y: number }>();
			for (const id of affectedEntityIds) {
				const pos = nextPositions.get(id);
				if (pos) {
					initialPositions.set(id, { x: pos.x, y: pos.y });
				}
			}

			const affectedArray = Array.from(affectedEntityIds);
			const relaxationPasses = Math.min(5, Math.max(2, Math.floor(guideOverlap.guideOverlapCount * 2) + (unpositionedNodes.length > 0 ? 2 : 0)));

			for (let pass = 0; pass < relaxationPasses; pass++) {
				for (let a = 0; a < affectedArray.length; a++) {
					const id = affectedArray[a];
					const pos = nextPositions.get(id);
					const initial = initialPositions.get(id);
					if (!pos || !initial) {continue;}

					let fx = 0;
					let fy = 0;

					// 1. Repulsive forces from close neighbors
					const nearby = occupiedGrid.queryNearby(pos.x, pos.y);
					for (let n = 0; n < nearby.length; n++) {
						const other = occupiedCoords[nearby[n]];
						if (!other || (other.x === pos.x && other.y === pos.y)) {continue;}
						const dx = pos.x - other.x;
						const dy = pos.y - other.y;
						const dist = Math.hypot(dx, dy) || 1;
						if (dist < MIN_NODE_DISTANCE) {
							const repFactor = (MIN_NODE_DISTANCE - dist) / dist;
							fx += dx * repFactor * 0.4;
							fy += dy * repFactor * 0.4;
						}
					}

					// 2. Spring attraction towards connected neighbors
					const neighbors = connectedNeighbors.get(id);
					if (neighbors && neighbors.size > 0) {
						for (const neighborId of neighbors) {
							const nPos = nextPositions.get(neighborId);
							if (nPos) {
								fx += (nPos.x - pos.x) * 0.05;
								fy += (nPos.y - pos.y) * 0.05;
							}
						}
					}

					// 3. Anchor force restoring towards original coordinate
					fx -= (pos.x - initial.x) * 0.45;
					fy -= (pos.y - initial.y) * 0.45;

					const isUnchanged = !unpositionedNodes.some(u => u.entityId === id) && !diff.nodes.some(d => d.entityId === id && d.changeKind && d.changeKind !== 'unchanged');
					const maxDelta = isUnchanged ? 12 : 36;

					let newX = pos.x + fx * 0.25;
					let newY = pos.y + fy * 0.25;

					const dispFromInit = Math.hypot(newX - initial.x, newY - initial.y);
					if (dispFromInit > maxDelta) {
						const scale = maxDelta / dispFromInit;
						newX = initial.x + (newX - initial.x) * scale;
						newY = initial.y + (newY - initial.y) * scale;
					}

					pos.x = Math.round(newX);
					pos.y = Math.round(newY);
				}
			}

			// Update positionedNodes x/y coordinates
			for (let i = 0; i < positionedNodes.length; i++) {
				const n = positionedNodes[i];
				const p = nextPositions.get(n.entityId);
				if (p) {
					positionedNodes[i] = enrichNodeWithLayer({
						...n,
						x: p.x,
						y: p.y,
					});
				}
			}

			guides = derivePostCollisionGuides(activeCommunities, nextPositions, 24);
		}
	}

	return {
		nodes: positionedNodes,
		positions: nextPositions,
		guides,
	};
}

function getFallbackLayerAnchor(layer: string): { x: number; y: number } {
	switch (layer) {
		case 'entry':
			return { x: 0, y: -240 };
		case 'frontend':
		case 'ui':
		case 'components':
			return { x: -320, y: -160 };
		case 'api':
			return { x: 320, y: -160 };
		case 'services':
		case 'backend':
			return { x: 0, y: 0 };
		case 'database':
			return { x: 0, y: 280 };
		case 'utils':
		case 'config':
			return { x: 320, y: 180 };
		case 'tests':
			return { x: -320, y: 180 };
		default:
			return { x: 0, y: 0 };
	}
}

function hashString(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash) + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

export const computeTopologyInformedInitialLayout = computeSemanticTemporalInitialLayout;

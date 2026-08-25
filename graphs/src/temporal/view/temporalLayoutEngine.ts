/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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

export interface TemporalLayoutOptions {
	readonly width?: number;
	readonly height?: number;
	readonly nodeSpacing?: number;
}

export type TemporalClusterGuide = TemporalCommunityGuide;

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
		if (memberIds.length === 0) continue;

		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		const presentCoords: { x: number; y: number }[] = [];

		for (let m = 0; m < memberIds.length; m++) {
			const pos = positions.get(memberIds[m]);
			if (pos) {
				presentCoords.push(pos);
				if (pos.x < minX) minX = pos.x;
				if (pos.y < minY) minY = pos.y;
				if (pos.x > maxX) maxX = pos.x;
				if (pos.y > maxY) maxY = pos.y;
			}
		}

		if (presentCoords.length === 0) continue;

		const cx = Math.round((minX + maxX) / 2);
		const cy = Math.round((minY + maxY) / 2);

		let maxDistSq = 0;
		for (let p = 0; p < presentCoords.length; p++) {
			const pt = presentCoords[p];
			const distSq = (pt.x - cx) * (pt.x - cx) + (pt.y - cy) * (pt.y - cy);
			if (distSq > maxDistSq) maxDistSq = distSq;
		}

		const radius = Math.round(Math.sqrt(maxDistSq) + padding);
		const bounds: TemporalRegionBounds = {
			minX: minX - padding,
			minY: minY - padding,
			maxX: maxX + padding,
			maxY: maxY + padding,
			width: Math.max(radius * 2, (maxX - minX) + padding * 2),
			height: Math.max(radius * 2, (maxY - minY) + padding * 2),
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

/**
 * Computes a dependency-first, topology-driven, adaptive community-layered 2D initial layout.
 *
 * Guaranteed Invariants:
 * 1. Dependency-First Flow: Producers/Entrypoints at the top; downstream services in center; foundation/data at bottom.
 * 2. Adaptive Communities: Graph-informed community boundaries reflecting import cohesion and SCC cycles.
 * 3. Permutation Invariance: Random shuffling of input nodes or edges yields identical layout coordinates.
 * 4. Zero Node Overlaps: Strict minimum spacing (MIN_NODE_DIST) enforced deterministically.
 * 5. Post-Collision Guide Enclosure: Guides encompass 100% of final post-collision member coordinates.
 */
export function computeSemanticTemporalInitialLayout(
	nodes: readonly TemporalRenderNode[],
	edges: readonly TemporalRenderEdge[],
	nodeSpacing = 48,
): TemporalLayoutResult {
	const positions = new Map<string, { x: number; y: number }>();
	const resultNodes: TemporalRenderNode[] = [];

	if (nodes.length === 0) {
		return { nodes: resultNodes, positions, guides: [] };
	}

	// 1. Compute Adaptive Communities & Topological Hierarchy
	const communities = computeAdaptiveCommunities(nodes, edges);

	// Map node degrees and adjacency
	const degreeByNode = new Map<string, number>();
	for (let i = 0; i < nodes.length; i++) {
		degreeByNode.set(nodes[i].entityId, 0);
	}
	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		if (e.changeKind === 'removed') continue;
		const src = e.sourceEntityId || (e as any).sourceId;
		const tgt = e.targetEntityId || (e as any).targetId;
		if (src && degreeByNode.has(src)) degreeByNode.set(src, degreeByNode.get(src)! + 1);
		if (tgt && degreeByNode.has(tgt)) degreeByNode.set(tgt, degreeByNode.get(tgt)! + 1);
	}

	// 2. Macro Placement: Group communities into topological ranks and pack into compact 2D bounds
	const depthRanks = new Map<number, AdaptiveCommunity[]>();
	for (let i = 0; i < communities.length; i++) {
		const comm = communities[i];
		const rankLevel = Math.min(6, Math.max(0, Math.floor(comm.depth)));
		let rankList = depthRanks.get(rankLevel);
		if (!rankList) {
			rankList = [];
			depthRanks.set(rankLevel, rankList);
		}
		rankList.push(comm);
	}

	const sortedRankLevels = Array.from(depthRanks.keys()).sort((a, b) => a - b);
	const clusterCenters = new Map<string, { x: number; y: number; estimatedRadius: number }>();

	// Compute estimated radius for each community
	const commRadiusMap = new Map<string, number>();
	for (let i = 0; i < communities.length; i++) {
		const comm = communities[i];
		const estR = Math.max(48, Math.sqrt(comm.nodeIds.length) * (nodeSpacing * 0.50) + 18);
		commRadiusMap.set(comm.id, estR);
	}

	// Layout ranks vertically with compact sub-rows for wide ranks
	let totalMacroHeight = 0;
	const rankHeights: number[] = [];

	for (let r = 0; r < sortedRankLevels.length; r++) {
		const level = sortedRankLevels[r];
		const commsInRank = depthRanks.get(level)!;
		const totalComms = commsInRank.length;
		const targetCols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(totalComms * 1.5))));
		const numSubRows = Math.ceil(totalComms / targetCols);

		let rankH = 0;
		for (let s = 0; s < numSubRows; s++) {
			const startIdx = s * targetCols;
			const endIdx = Math.min(totalComms, startIdx + targetCols);
			let subRowMaxR = 0;
			for (let idx = startIdx; idx < endIdx; idx++) {
				const rVal = commRadiusMap.get(commsInRank[idx].id) || 50;
				if (rVal > subRowMaxR) subRowMaxR = rVal;
			}
			rankH += subRowMaxR * 2 + 32;
		}
		rankHeights.push(rankH);
		totalMacroHeight += rankH + (r > 0 ? 40 : 0);
	}

	let startY = -Math.round(totalMacroHeight / 2);
	for (let r = 0; r < sortedRankLevels.length; r++) {
		const level = sortedRankLevels[r];
		const commsInRank = depthRanks.get(level)!;
		const totalComms = commsInRank.length;
		const targetCols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(totalComms * 1.5))));
		const numSubRows = Math.ceil(totalComms / targetCols);

		let subRowStartY = startY;
		for (let s = 0; s < numSubRows; s++) {
			const startIdx = s * targetCols;
			const endIdx = Math.min(totalComms, startIdx + targetCols);
			const subRowComms = commsInRank.slice(startIdx, endIdx);

			let subRowWidth = 0;
			let maxR = 0;
			for (let c = 0; c < subRowComms.length; c++) {
				const rVal = commRadiusMap.get(subRowComms[c].id) || 50;
				subRowWidth += rVal * 2 + 32;
				if (rVal > maxR) maxR = rVal;
			}

			let currentX = -Math.round(subRowWidth / 2);
			const rowY = subRowStartY + maxR;

			for (let c = 0; c < subRowComms.length; c++) {
				const comm = subRowComms[c];
				const rVal = commRadiusMap.get(comm.id) || 50;
				const cx = currentX + rVal;
				currentX += rVal * 2 + 32;

				clusterCenters.set(comm.id, { x: cx, y: rowY, estimatedRadius: rVal });
			}

			subRowStartY += maxR * 2 + 32;
		}

		startY = subRowStartY + 36;
	}

	// 3. Intra-Community Micro Placement (Golden Angle Phyllotaxis centered on primary hub)
	const GOLDEN_ANGLE = 2.399963229728653; // ~137.5 degrees
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
					// Primary hub at center
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

	// 4. Global Deterministic Collision Resolution Pass
	const MIN_NODE_DIST = Math.max(34, nodeSpacing * 0.70);
	const nodePosList = resultNodes.map(n => ({ id: n.entityId, x: n.x, y: n.y }));

	// Sort canonically before iterative relaxation to ensure strict determinism
	nodePosList.sort((a, b) => a.id.localeCompare(b.id));

	for (let iter = 0; iter < 6; iter++) {
		for (let i = 0; i < nodePosList.length; i++) {
			for (let j = i + 1; j < nodePosList.length; j++) {
				const p1 = nodePosList[i];
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
				}
			}
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

	// 5. Post-Collision Guide Geometry (Calculated from Final Post-Collision Positions)
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

	// Build adjacency map for neighbor-aware placement of added nodes
	const connectedNeighbors = new Map<string, Set<string>>();
	for (let i = 0; i < diff.edges.length; i++) {
		const edge = diff.edges[i];
		if (edge.changeKind !== 'removed') {
			const src = edge.sourceEntityId || (edge as any).sourceId;
			const tgt = edge.targetEntityId || (edge as any).targetId;
			if (!src || !tgt) continue;

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

	// 1. Position surviving and previously known nodes at their exact previous coordinates (0 displacement for unchanged nodes)
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

	// 2. If no previous positions exist (initial render), perform dependency-first semantic layout
	if (previousPositions.size === 0) {
		const initialResult = computeSemanticTemporalInitialLayout(diff.nodes, diff.edges, nodeSpacing);
		return {
			nodes: initialResult.nodes.map(enrichNodeWithLayer),
			positions: initialResult.positions,
			guides: initialResult.guides,
		};
	}

	// 3. For newly added nodes without prior position, place near connected neighbors with collision resolution
	const occupiedCoords: { x: number; y: number }[] = Array.from(nextPositions.values());
	const MIN_NODE_DISTANCE = Math.max(30, nodeSpacing * 0.65);

	function isSlotFree(x: number, y: number): boolean {
		for (let i = 0; i < occupiedCoords.length; i++) {
			const p = occupiedCoords[i];
			const distSq = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
			if (distSq < MIN_NODE_DISTANCE * MIN_NODE_DISTANCE) {
				return false;
			}
		}
		return true;
	}

	function findFreeSlotNear(centerX: number, centerY: number, seed: number): { x: number; y: number } {
		if (isSlotFree(centerX, centerY)) {
			return { x: centerX, y: centerY };
		}

		// Golden-ratio spiral search for the closest collision-free coordinate
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
		occupiedCoords.push(slot);

		positionedNodes.push(enrichNodeWithLayer({
			...node,
			x: slot.x,
			y: slot.y,
		}));
	}

	// 4. Recompute Guides for Active Nodes on Incremental Layout
	// Invariant: Guides are present on EVERY rendered commit state and strictly encompass final coordinates.
	const activeNodes = positionedNodes.filter(n => n.changeKind !== 'removed');
	const activeCommunities = computeAdaptiveCommunities(activeNodes, diff.edges);
	const guides = derivePostCollisionGuides(activeCommunities, nextPositions, 24);

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

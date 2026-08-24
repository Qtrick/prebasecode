/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TemporalStructuralDiff, TemporalRenderNode, TemporalLayoutResult } from './temporalViewTypes.js';
import { classifyNodeLayer, ARCHITECTURE_LAYERS, type ArchitectureLayerId } from '../../core/analysis/architectureLayers.js';

export interface TemporalLayoutOptions {
	readonly width?: number;
	readonly height?: number;
	readonly nodeSpacing?: number;
}

export interface TemporalClusterGuide {
	readonly id: string;
	readonly label: string;
	readonly layerId: ArchitectureLayerId;
	readonly color: string;
	readonly x: number;
	readonly y: number;
	readonly radius: number;
	readonly nodeCount: number;
}

const LAYER_COLOR_MAP = new Map<ArchitectureLayerId, string>(
	ARCHITECTURE_LAYERS.map(l => [l.id, l.color])
);

export function getArchitectureLayerColor(layerId?: ArchitectureLayerId | string): string {
	return (layerId && LAYER_COLOR_MAP.get(layerId as ArchitectureLayerId)) || '#6366f1';
}

export function getNodeLayer(node: TemporalRenderNode): ArchitectureLayerId {
	if (node.meta?.architectureLayer) {
		return node.meta.architectureLayer as ArchitectureLayerId;
	}
	return classifyNodeLayer(node.path || node.label, Boolean(node.meta?.isEntry));
}

export function enrichNodeWithLayer(node: TemporalRenderNode): TemporalRenderNode {
	const layer = getNodeLayer(node);
	return {
		...node,
		meta: {
			...(node.meta || {}),
			architectureLayer: layer,
		},
	};
}

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
	for (const edge of diff.edges) {
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

	// 1. Position surviving and previously known nodes at their EXACT previous coordinates (0 displacement invariant)
	for (const node of diff.nodes) {
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

	// 2. If no previous positions exist (initial render), lay out all nodes deterministically via semantic community layout
	if (previousPositions.size === 0) {
		const initialResult = computeSemanticTemporalInitialLayout(diff.nodes, diff.edges, nodeSpacing);
		return {
			nodes: initialResult.nodes.map(enrichNodeWithLayer),
			positions: initialResult.positions,
			guides: initialResult.guides,
		};
	}

	// 3. For newly added nodes without prior position, place near connected neighbors in their community with collision resolution
	const occupiedCoords: { x: number; y: number }[] = Array.from(nextPositions.values());
	const MIN_NODE_DISTANCE = Math.max(26, nodeSpacing * 0.6);

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

		// Search in a golden-ratio spiral for the closest collision-free slot
		const baseAngle = (seed % 360) * (Math.PI / 180);
		for (let step = 1; step <= 48; step++) {
			const radius = MIN_NODE_DISTANCE * (0.95 + Math.floor(step / 6) * 0.55);
			const angle = baseAngle + step * 1.047; // ~60 degree increments with spiral growth
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
				for (const p of knownNeighborPositions) {
					avgX += p.x;
					avgY += p.y;
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
			// Place in a region corresponding to its architecture layer
			const layer = getNodeLayer(node);
			const baseCoord = getLayerBaseCoordinates(layer);
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

	return {
		nodes: positionedNodes,
		positions: nextPositions,
		guides: diff.guides,
	};
}

/**
 * Computes a semantic, architecture-layered, community-separated 2D layout.
 *
 * Design Principles:
 * 1. Community & Architectural Layer Separation:
 *    Instead of piling all directories in one overlapping center disk,
 *    directories and subsystems are grouped into spatial communities with clear separation.
 * 2. Topological Dependency Flow:
 *    Entry points and core hubs are centrally prominent; downstream implementation files
 *    radiate within their designated architectural sector.
 * 3. Guaranteed Minimum Node Spacing:
 *    Every node is placed with collision-free padding so node glyphs and badges do not overlap.
 * 4. Bounded Coordinate Scale:
 *    A ~280-node graph occupies a structured ~1200x800 bounding box with visible regions
 *    (UI, Services, Core, Git/Data, Utils, Tests).
 */
export function computeSemanticTemporalInitialLayout(
	nodes: readonly TemporalRenderNode[],
	edges: readonly { sourceEntityId?: string; sourceId?: string; targetEntityId?: string; targetId?: string }[],
	nodeSpacing = 48,
): TemporalLayoutResult & { guides?: TemporalClusterGuide[] } {
	const positions = new Map<string, { x: number; y: number }>();
	const resultNodes: TemporalRenderNode[] = [];

	if (nodes.length === 0) {
		return { nodes: resultNodes, positions, guides: [] };
	}

	// 1. Calculate degree and adjacency from topological edges
	const degreeByNode = new Map<string, number>();
	const adjacency = new Map<string, Set<string>>();

	for (const node of nodes) {
		degreeByNode.set(node.entityId, 0);
		adjacency.set(node.entityId, new Set());
	}

	for (const edge of edges) {
		const src = edge.sourceEntityId || (edge as any).sourceId;
		const tgt = edge.targetEntityId || (edge as any).targetId;
		if (src && tgt && degreeByNode.has(src) && degreeByNode.has(tgt)) {
			degreeByNode.set(src, (degreeByNode.get(src) || 0) + 1);
			degreeByNode.set(tgt, (degreeByNode.get(tgt) || 0) + 1);
			adjacency.get(src)?.add(tgt);
			adjacency.get(tgt)?.add(src);
		}
	}

	// 2. Partition nodes into Semantic Architectural Communities
	interface CommunityGroup {
		readonly id: string;
		readonly label: string;
		readonly primaryLayer: ArchitectureLayerId;
		readonly nodes: TemporalRenderNode[];
		totalDegree: number;
		maxDegree: number;
		hasEntry: boolean;
	}

	const communitiesMap = new Map<string, CommunityGroup>();

	for (const node of nodes) {
		const enriched = enrichNodeWithLayer(node);
		const layer = enriched.meta?.architectureLayer as ArchitectureLayerId || 'other';
		const dir = getSemanticSubsystem(node.path || node.label);
		const communityKey = `${dir}::${getLayerCategory(layer)}`;

		let group = communitiesMap.get(communityKey);
		if (!group) {
			const label = formatCommunityLabel(dir, layer);
			group = {
				id: communityKey,
				label,
				primaryLayer: layer,
				nodes: [],
				totalDegree: 0,
				maxDegree: 0,
				hasEntry: false,
			};
			communitiesMap.set(communityKey, group);
		}

		group.nodes.push(enriched);
		const deg = degreeByNode.get(node.entityId) || 0;
		group.totalDegree += deg;
		if (deg > group.maxDegree) group.maxDegree = deg;
		if (Boolean(node.meta?.isEntry) || layer === 'entry') group.hasEntry = true;
	}

	const sortedCommunities = Array.from(communitiesMap.values()).sort((a, b) => {
		if (a.hasEntry && !b.hasEntry) return -1;
		if (b.hasEntry && !a.hasEntry) return 1;
		if (b.maxDegree !== a.maxDegree) return b.maxDegree - a.maxDegree;
		if (b.totalDegree !== a.totalDegree) return b.totalDegree - a.totalDegree;
		return a.nodes.length - b.nodes.length;
	});

	// 3. Macro Placement of Communities with Architectural Regional Anchors
	// Regional Layout:
	// - Entry & UI/Frontend: Upper region (Y < 0)
	// - Core Services & Application Logic: Central region (-100 <= Y <= 150)
	// - Database, Git, Persistence: Lower region (Y > 150)
	// - Utils, Config, Tests: Outer wings
	const clusterCenters = new Map<string, { x: number; y: number; radius: number }>();
	const occupiedClusterHulls: { x: number; y: number; r: number }[] = [];

	const totalCommunities = sortedCommunities.length;

	for (let i = 0; i < totalCommunities; i++) {
		const comm = sortedCommunities[i];
		const count = comm.nodes.length;
		// Estimate cluster radius based on node count
		const estimatedR = Math.max(60, Math.sqrt(count) * (nodeSpacing * 0.65) + 30);

		// Determine base anchor coordinate by architectural layer
		const baseAnchor = getLayerBaseCoordinates(comm.primaryLayer);
		let cx = baseAnchor.x;
		let cy = baseAnchor.y;

		if (i > 0) {
			// Offset multiple communities within the same layer region
			const angle = (i * 137.5) * (Math.PI / 180);
			const spread = Math.min(480, Math.sqrt(i) * 140);
			cx = Math.round(baseAnchor.x * 0.4 + Math.cos(angle) * spread);
			cy = Math.round(baseAnchor.y * 0.4 + Math.sin(angle) * spread * 0.75);
		}

		// Relax cluster center to avoid overlapping macro cluster hulls
		let finalX = cx;
		let finalY = cy;
		for (let step = 0; step < 24; step++) {
			let collision = false;
			for (const hull of occupiedClusterHulls) {
				const dx = finalX - hull.x;
				const dy = finalY - hull.y;
				const dist = Math.hypot(dx, dy);
				const minDist = estimatedR + hull.r + 40;
				if (dist < minDist) {
					collision = true;
					const pushAngle = dist > 1 ? Math.atan2(dy, dx) : (step * 1.05);
					const pushDist = (minDist - dist) + 20;
					finalX += Math.round(Math.cos(pushAngle) * pushDist);
					finalY += Math.round(Math.sin(pushAngle) * pushDist);
					break;
				}
			}
			if (!collision) break;
		}

		clusterCenters.set(comm.id, { x: finalX, y: finalY, radius: estimatedR });
		occupiedClusterHulls.push({ x: finalX, y: finalY, r: estimatedR });
	}

	// 4. Intra-Cluster Node Placement:
	// High degree hubs at cluster center; connected nodes placed in structured phyllotaxis orbits
	const guides: TemporalClusterGuide[] = [];

	for (const comm of sortedCommunities) {
		const centerInfo = clusterCenters.get(comm.id) || { x: 0, y: 0, radius: 80 };
		const commNodes = comm.nodes;

		// Sort nodes inside community: entry/hub first, then degree, then path
		commNodes.sort((a, b) => {
			if (Boolean(a.meta?.isEntry) && !Boolean(b.meta?.isEntry)) return -1;
			if (Boolean(b.meta?.isEntry) && !Boolean(a.meta?.isEntry)) return 1;
			const da = degreeByNode.get(a.entityId) || 0;
			const db = degreeByNode.get(b.entityId) || 0;
			if (db !== da) return db - da;
			return (a.path || a.label).localeCompare(b.path || b.label);
		});

		const count = commNodes.length;
		const GOLDEN_ANGLE = 2.399963229728653; // ~137.5 degrees

		for (let idx = 0; idx < count; idx++) {
			const node = commNodes[idx];
			let nx = centerInfo.x;
			let ny = centerInfo.y;

			if (count > 1) {
				if (idx === 0) {
					nx = centerInfo.x;
					ny = centerInfo.y;
				} else {
					const localAngle = idx * GOLDEN_ANGLE;
					const localDist = Math.sqrt(idx) * (nodeSpacing * 0.62) + 12;
					nx = Math.round(centerInfo.x + Math.cos(localAngle) * localDist);
					ny = Math.round(centerInfo.y + Math.sin(localAngle) * localDist * 0.85);
				}
			}

			positions.set(node.entityId, { x: nx, y: ny });
			resultNodes.push({
				...node,
				x: nx,
				y: ny,
			});
		}

		if (count >= 2) {
			guides.push({
				id: comm.id,
				label: comm.label,
				layerId: comm.primaryLayer,
				color: getArchitectureLayerColor(comm.primaryLayer),
				x: centerInfo.x,
				y: centerInfo.y,
				radius: centerInfo.radius,
				nodeCount: count,
			});
		}
	}

	// 5. Global Collision Resolution Pass
	const MIN_NODE_DIST = Math.max(30, nodeSpacing * 0.65);
	const nodePosList = resultNodes.map(n => ({ id: n.entityId, x: n.x, y: n.y }));

	for (let iter = 0; iter < 4; iter++) {
		for (let i = 0; i < nodePosList.length; i++) {
			for (let j = i + 1; j < nodePosList.length; j++) {
				const p1 = nodePosList[i];
				const p2 = nodePosList[j];
				const dx = p2.x - p1.x;
				const dy = p2.y - p1.y;
				const dist = Math.hypot(dx, dy);
				if (dist < MIN_NODE_DIST) {
					const angle = dist > 0.1 ? Math.atan2(dy, dx) : (i * 0.5);
					const overlap = (MIN_NODE_DIST - dist) / 2;
					p1.x -= Math.round(Math.cos(angle) * overlap);
					p1.y -= Math.round(Math.sin(angle) * overlap);
					p2.x += Math.round(Math.cos(angle) * overlap);
					p2.y += Math.round(Math.sin(angle) * overlap);
				}
			}
		}
	}

	for (const p of nodePosList) {
		positions.set(p.id, { x: p.x, y: p.y });
	}

	const finalNodes = resultNodes.map(n => {
		const pos = positions.get(n.entityId) || { x: n.x, y: n.y };
		return { ...n, x: pos.x, y: pos.y };
	});

	return {
		nodes: finalNodes,
		positions,
		guides,
	};
}

/**
 * Map initial layout anchors by architecture layer.
 */
function getLayerBaseCoordinates(layer: ArchitectureLayerId): { x: number; y: number } {
	switch (layer) {
		case 'entry':
			return { x: 0, y: -240 };
		case 'frontend':
		case 'ui':
		case 'components':
			return { x: -360, y: -160 };
		case 'api':
			return { x: 360, y: -160 };
		case 'services':
		case 'backend':
			return { x: 0, y: 40 };
		case 'database':
			return { x: 0, y: 320 };
		case 'utils':
		case 'config':
			return { x: 380, y: 220 };
		case 'tests':
			return { x: -380, y: 220 };
		case 'auth':
			return { x: 260, y: -60 };
		default:
			return { x: 0, y: 0 };
	}
}

function getLayerCategory(layer: ArchitectureLayerId): string {
	switch (layer) {
		case 'frontend':
		case 'ui':
		case 'components':
			return 'ui';
		case 'api':
		case 'services':
		case 'backend':
		case 'auth':
			return 'services';
		case 'database':
			return 'data';
		case 'tests':
			return 'tests';
		case 'utils':
		case 'config':
			return 'utils';
		case 'entry':
			return 'entry';
		default:
			return 'core';
	}
}

function getSemanticSubsystem(filePath: string): string {
	if (!filePath) return 'root';
	const normalized = filePath.replace(/\\/g, '/');
	const parts = normalized.split('/').filter(Boolean);
	if (parts.length <= 1) return 'root';

	// Special handling for common project structures
	if (parts[0] === 'src' && parts.length > 2) {
		return `${parts[0]}/${parts[1]}`;
	}
	if (parts[0] === 'graphs' && parts.length > 2) {
		return `${parts[0]}/${parts[1]}`;
	}
	return parts[0];
}

function formatCommunityLabel(dir: string, layer: ArchitectureLayerId): string {
	const dirName = dir === 'root' ? 'Core' : dir.replace(/^src\//, '').replace(/^graphs\//, '');
	const layerDef = ARCHITECTURE_LAYERS.find(l => l.id === layer);
	const layerLabel = layerDef ? layerDef.label : 'Module';
	if (dir === 'root') {
		return `${layerLabel}`;
	}
	return `${dirName} · ${layerLabel}`;
}

function hashString(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash) + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

/**
 * Backward compatibility alias for semantic initial layout calculation.
 */
export const computeTopologyInformedInitialLayout = computeSemanticTemporalInitialLayout;

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

const LAYER_COLOR_MAP = new Map<ArchitectureLayerId, string>(
	ARCHITECTURE_LAYERS.map(l => [l.id, l.color])
);

export function getArchitectureLayerColor(layerId?: ArchitectureLayerId): string {
	return (layerId && LAYER_COLOR_MAP.get(layerId)) || '#6366f1';
}

export function getNodeLayer(node: TemporalRenderNode): ArchitectureLayerId {
	if (node.meta?.architectureLayer) {
		return node.meta.architectureLayer as ArchitectureLayerId;
	}
	return classifyNodeLayer(node.path || node.label, Boolean(node.meta?.isEntry));
}

function enrichNodeWithLayer(node: TemporalRenderNode): TemporalRenderNode {
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

	// 2. If no previous positions exist (initial render), lay out all nodes deterministically via topology-informed anchors
	if (previousPositions.size === 0) {
		const initialResult = computeTopologyInformedInitialLayout(diff.nodes, diff.edges, nodeSpacing);
		return {
			nodes: initialResult.nodes.map(enrichNodeWithLayer),
			positions: initialResult.positions,
		};
	}

	// 3. For newly added nodes without prior position, place near connected neighbors with collision resolution
	const occupiedCoords: { x: number; y: number }[] = Array.from(nextPositions.values());
	const MIN_NODE_DISTANCE = Math.max(22, nodeSpacing * 0.55);

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
		for (let step = 1; step <= 36; step++) {
			const radius = MIN_NODE_DISTANCE * (0.9 + Math.floor(step / 6) * 0.6);
			const angle = baseAngle + step * 1.047; // ~60 degree increments with spiral growth
			const candX = Math.round(centerX + Math.cos(angle) * radius);
			const candY = Math.round(centerY + Math.sin(angle) * radius);
			if (isSlotFree(candX, candY)) {
				return { x: candX, y: candY };
			}
		}

		return { x: centerX + (seed % 15) - 7, y: centerY + (seed % 17) - 8 };
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
				const dist = nodeSpacing * 0.9;
				targetX = Math.round(avgX + Math.cos(angle) * dist);
				targetY = Math.round(avgY + Math.sin(angle) * dist);
				foundAnchor = true;
			}
		}

		if (!foundAnchor) {
			// Place in a compact interior ring around centroid
			const hash = hashString(node.entityId);
			const ring = 1 + (hash % 5);
			const angle = ((hash % 1000) / 1000) * 2 * Math.PI;
			const radius = ring * nodeSpacing * 1.1;
			targetX = Math.round(Math.cos(angle) * radius);
			targetY = Math.round(Math.sin(angle) * radius);
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
	};
}

/**
 * Computes a deterministic, topology-informed 2D layout.
 *
 * Replaces the old directory-wheel algorithm (which scaled linearly as dirs * 80,
 * creating an empty annulus with 2000px diameter).
 *
 * New Design:
 * - Topological community & directory clustering.
 * - Central placement of high-degree hubs and core modules.
 * - Sublinear radial growth (proportional to sqrt(node count)), preventing the horseshoe/annulus defect.
 * - Bounded coordinate space (nodes comfortably fill a 600x400 organic region).
 */
export function computeTopologyInformedInitialLayout(
	nodes: readonly TemporalRenderNode[],
	edges: readonly { sourceEntityId?: string; sourceId?: string; targetEntityId?: string; targetId?: string }[],
	nodeSpacing = 48,
): TemporalLayoutResult {
	const positions = new Map<string, { x: number; y: number }>();
	const resultNodes: TemporalRenderNode[] = [];

	if (nodes.length === 0) {
		return { nodes: resultNodes, positions };
	}

	// 1. Calculate degree for each node from topological edges
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

	// 2. Group nodes by directory
	const dirGroups = new Map<string, TemporalRenderNode[]>();
	for (const node of nodes) {
		const dir = getDirectory(node.path || node.label);
		let list = dirGroups.get(dir);
		if (!list) {
			list = [];
			dirGroups.set(dir, list);
		}
		list.push(node);
	}

	// Sort directories: directory with the entry/root node comes first (center), then highest individual hub, then total degrees
	const rootNodeId = nodes[0]?.entityId;
	const sortedDirs = Array.from(dirGroups.keys()).sort((a, b) => {
		const aNodes = dirGroups.get(a) || [];
		const bNodes = dirGroups.get(b) || [];

		const aHasRoot = aNodes.some(n => n.entityId === rootNodeId || Boolean(n.meta?.isEntry));
		const bHasRoot = bNodes.some(n => n.entityId === rootNodeId || Boolean(n.meta?.isEntry));
		if (aHasRoot && !bHasRoot) return -1;
		if (bHasRoot && !aHasRoot) return 1;

		const aMaxDeg = aNodes.reduce((max, n) => Math.max(max, degreeByNode.get(n.entityId) || 0), 0);
		const bMaxDeg = bNodes.reduce((max, n) => Math.max(max, degreeByNode.get(n.entityId) || 0), 0);
		if (bMaxDeg !== aMaxDeg) return bMaxDeg - aMaxDeg;

		const aDeg = aNodes.reduce((sum, n) => sum + (degreeByNode.get(n.entityId) || 0), 0);
		const bDeg = bNodes.reduce((sum, n) => sum + (degreeByNode.get(n.entityId) || 0), 0);
		if (bDeg !== aDeg) return bDeg - aDeg;
		return a.localeCompare(b);
	});

	// 3. Compact 2D Phyllotaxis / Sunflower cluster placement for directory centers
	// Radius grows sublinearly: R ~ c * sqrt(dirIndex), ensuring interior density without a hollow ring
	const totalDirs = sortedDirs.length;
	const GOLDEN_ANGLE = 2.399963229728653; // ~137.5 degrees
	const dirCenters = new Map<string, { x: number; y: number }>();

	for (let i = 0; i < totalDirs; i++) {
		const dir = sortedDirs[i];
		if (i === 0) {
			dirCenters.set(dir, { x: 0, y: 0 });
		} else {
			// Sublinear radius scaling: max radius ~240-320px even for 40+ directories
			const clusterR = Math.min(320, Math.sqrt(i) * nodeSpacing * 1.15);
			const clusterAngle = i * GOLDEN_ANGLE;
			const cx = Math.round(Math.cos(clusterAngle) * clusterR);
			const cy = Math.round(Math.sin(clusterAngle) * clusterR * 0.78); // Slight aspect ratio bias
			dirCenters.set(dir, { x: cx, y: cy });
		}
	}

	// 4. Place nodes within each directory cluster
	for (const dir of sortedDirs) {
		const dirNodes = dirGroups.get(dir) || [];
		const center = dirCenters.get(dir) || { x: 0, y: 0 };

		// Sort nodes inside directory: highest degree at center
		dirNodes.sort((a, b) => {
			const da = degreeByNode.get(a.entityId) || 0;
			const db = degreeByNode.get(b.entityId) || 0;
			if (db !== da) return db - da;
			return (a.path || a.label).localeCompare(b.path || b.label);
		});

		const count = dirNodes.length;
		for (let i = 0; i < count; i++) {
			const node = dirNodes[i];
			let x = center.x;
			let y = center.y;

			if (count > 1) {
				// Sunflower distribution inside directory cluster
				const localAngle = i * GOLDEN_ANGLE;
				const localDist = Math.min(160, Math.sqrt(i) * (nodeSpacing * 0.65));
				x = Math.round(center.x + Math.cos(localAngle) * localDist);
				y = Math.round(center.y + Math.sin(localAngle) * localDist);
			}

			positions.set(node.entityId, { x, y });
			resultNodes.push({
				...node,
				x,
				y,
			});
		}
	}

	return {
		nodes: resultNodes,
		positions,
	};
}

function getDirectory(filePath: string): string {
	if (!filePath) return '.';
	const normalized = filePath.replace(/\\/g, '/');
	const lastSlash = normalized.lastIndexOf('/');
	return lastSlash >= 0 ? normalized.slice(0, lastSlash) : '.';
}

function hashString(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash) + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

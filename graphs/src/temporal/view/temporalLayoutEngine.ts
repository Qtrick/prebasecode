/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TemporalStructuralDiff, TemporalRenderNode, TemporalLayoutResult } from './temporalViewTypes.js';

export interface TemporalLayoutOptions {
	readonly width?: number;
	readonly height?: number;
	readonly nodeSpacing?: number;
}

export function layoutTemporalGraph(
	diff: TemporalStructuralDiff,
	previousPositions: ReadonlyMap<string, { x: number; y: number }>,
	options?: TemporalLayoutOptions,
): TemporalLayoutResult {
	const nextPositions = new Map<string, { x: number; y: number }>();
	const positionedNodes: TemporalRenderNode[] = [];
	const unpositionedNodes: TemporalRenderNode[] = [];

	const width = options?.width ?? 1200;
	const height = options?.height ?? 800;
	const nodeSpacing = options?.nodeSpacing ?? 80;

	// Build adjacency map for neighbor-aware placement of added nodes
	const connectedNeighbors = new Map<string, Set<string>>();
	for (const edge of diff.edges) {
		if (edge.changeKind !== 'removed') {
			let srcSet = connectedNeighbors.get(edge.sourceEntityId);
			if (!srcSet) {
				srcSet = new Set();
				connectedNeighbors.set(edge.sourceEntityId, srcSet);
			}
			srcSet.add(edge.targetEntityId);

			let tgtSet = connectedNeighbors.get(edge.targetEntityId);
			if (!tgtSet) {
				tgtSet = new Set();
				connectedNeighbors.set(edge.targetEntityId, tgtSet);
			}
			tgtSet.add(edge.sourceEntityId);
		}
	}

	// 1. Position surviving and previously known nodes at their EXACT previous coordinates (0 displacement)
	for (const node of diff.nodes) {
		const prev = previousPositions.get(node.entityId);
		if (prev) {
			nextPositions.set(node.entityId, { x: prev.x, y: prev.y });
			positionedNodes.push({
				...node,
				x: prev.x,
				y: prev.y,
			});
		} else {
			unpositionedNodes.push(node);
		}
	}

	// 2. If no previous positions exist (initial render), lay out all nodes deterministically
	if (previousPositions.size === 0) {
		const initialResult = computeDeterministicInitialLayout(diff.nodes, width, height, nodeSpacing);
		return initialResult;
	}

	// 3. For newly added nodes without prior position, place near connected neighbors or in balanced clusters
	for (let i = 0; i < unpositionedNodes.length; i++) {
		const node = unpositionedNodes[i];
		const neighbors = connectedNeighbors.get(node.entityId);
		let placed = false;

		if (neighbors && neighbors.size > 0) {
			// Find known neighbor positions
			const knownNeighborPositions: { x: number; y: number }[] = [];
			for (const neighborId of neighbors) {
				const pos = nextPositions.get(neighborId);
				if (pos) {
					knownNeighborPositions.push(pos);
				}
			}

			if (knownNeighborPositions.length > 0) {
				// Compute center of known neighbors
				let avgX = 0;
				let avgY = 0;
				for (const p of knownNeighborPositions) {
					avgX += p.x;
					avgY += p.y;
				}
				avgX /= knownNeighborPositions.length;
				avgY /= knownNeighborPositions.length;

				// Deterministic angle based on entityId hash
				const angle = (hashString(node.entityId) % 360) * (Math.PI / 180);
				const dist = nodeSpacing * 1.25;
				const posX = Math.round(avgX + Math.cos(angle) * dist);
				const posY = Math.round(avgY + Math.sin(angle) * dist);

				nextPositions.set(node.entityId, { x: posX, y: posY });
				positionedNodes.push({
					...node,
					x: posX,
					y: posY,
				});
				placed = true;
			}
		}

		if (!placed) {
			// Place in an open ring around center
			const hash = hashString(node.entityId);
			const ring = 1 + (hash % 4);
			const angle = ((hash % 1000) / 1000) * 2 * Math.PI;
			const radius = ring * nodeSpacing * 2;
			const posX = Math.round(Math.cos(angle) * radius);
			const posY = Math.round(Math.sin(angle) * radius);

			nextPositions.set(node.entityId, { x: posX, y: posY });
			positionedNodes.push({
				...node,
				x: posX,
				y: posY,
			});
		}
	}

	return {
		nodes: positionedNodes,
		positions: nextPositions,
	};
}

function computeDeterministicInitialLayout(
	nodes: readonly TemporalRenderNode[],
	width: number,
	height: number,
	nodeSpacing: number,
): TemporalLayoutResult {
	const positions = new Map<string, { x: number; y: number }>();
	const resultNodes: TemporalRenderNode[] = [];

	// Group by directory path
	const groups = new Map<string, TemporalRenderNode[]>();
	for (const node of nodes) {
		const dir = getDirectory(node.path);
		let list = groups.get(dir);
		if (!list) {
			list = [];
			groups.set(dir, list);
		}
		list.push(node);
	}

	const sortedDirs = Array.from(groups.keys()).sort();
	const totalDirs = sortedDirs.length || 1;
	const clusterRadius = Math.max(180, totalDirs * nodeSpacing * 0.8);

	for (let dirIndex = 0; dirIndex < sortedDirs.length; dirIndex++) {
		const dir = sortedDirs[dirIndex];
		const dirNodes = groups.get(dir) || [];
		const dirAngle = (dirIndex / totalDirs) * 2 * Math.PI;
		const dirCenterX = Math.round(Math.cos(dirAngle) * clusterRadius);
		const dirCenterY = Math.round(Math.sin(dirAngle) * clusterRadius);

		// Sort nodes inside directory deterministically
		dirNodes.sort((a, b) => a.path.localeCompare(b.path));

		const count = dirNodes.length;
		for (let i = 0; i < count; i++) {
			const node = dirNodes[i];
			let x = dirCenterX;
			let y = dirCenterY;

			if (count > 1) {
				const nodeAngle = (i / count) * 2 * Math.PI;
				const nodeDist = Math.min(nodeSpacing * 0.9 + Math.floor(i / 8) * (nodeSpacing * 0.6), 300);
				x = Math.round(dirCenterX + Math.cos(nodeAngle) * nodeDist);
				y = Math.round(dirCenterY + Math.sin(nodeAngle) * nodeDist);
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
	const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
	return lastSlash >= 0 ? filePath.slice(0, lastSlash) : '.';
}

function hashString(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash) + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

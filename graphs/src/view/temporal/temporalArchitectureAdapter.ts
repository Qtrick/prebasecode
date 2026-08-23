/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GraphEdge, GraphNode, LayoutPosition } from '../../common/types/graphTypes.js';
import {
	computeHierarchyLayout,
	getHierarchyRingBandsForSnapshot,
	getHierarchyRingGuides,
	type HierarchyRingBand,
	type HierarchyRingGuide,
} from '../../layouts/architecture/hierarchy/hierarchyLayout.js';
import { classifyNodeLayer, ARCHITECTURE_LAYERS, type ArchitectureLayerId } from '../../core/analysis/architectureLayers.js';
import type {
	TemporalRenderNode,
	TemporalRenderEdge,
	TemporalStructuralDiff,
	TemporalLayoutResult,
	TemporalDisplayMode,
} from '../../temporal/view/temporalViewTypes.js';

export interface TemporalArchitectureLayoutOptions {
	readonly mode?: TemporalDisplayMode | 'changes' | 'full' | 'state';
	readonly showContext?: boolean;
	readonly entryNodeId?: string;
	readonly nodeSpacing?: number;
	readonly previousPositions?: ReadonlyMap<string, { x: number; y: number }>;
}

export interface TemporalArchitectureLayoutResult extends TemporalLayoutResult {
	readonly bands: readonly HierarchyRingBand[];
	readonly guides: readonly HierarchyRingGuide[];
	readonly entryEntityId?: string;
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
	return classifyNodeLayer(node.path, Boolean(node.meta?.isEntry));
}

/**
 * Finds or derives the authoritative entry entity ID for a set of temporal render nodes and edges.
 */
export function deriveEntryEntityId(
	nodes: readonly TemporalRenderNode[],
	edges: readonly TemporalRenderEdge[],
	explicitEntryId?: string
): string | undefined {
	if (explicitEntryId && nodes.some(n => n.entityId === explicitEntryId)) {
		return explicitEntryId;
	}

	// 1. Explicit entry flag in metadata
	const markedEntry = nodes.find(n => Boolean(n.meta?.isEntry));
	if (markedEntry) {
		return markedEntry.entityId;
	}

	// 2. Common root/entry filenames
	const entryPatterns = [
		/(^|\/)(index|main|app|entry|server|bootstrap|root)\.(ts|tsx|js|jsx|py|go|rs)$/i,
		/(^|\/)src\/(index|main|app)\.(ts|tsx|js|jsx)$/i,
	];
	for (const pattern of entryPatterns) {
		const match = nodes.find(n => pattern.test(n.path));
		if (match) {
			return match.entityId;
		}
	}

	// 3. Highest out-degree / fan-out node
	const outDegrees = new Map<string, number>();
	for (const e of edges) {
		outDegrees.set(e.sourceEntityId, (outDegrees.get(e.sourceEntityId) ?? 0) + 1);
	}

	let bestNode: TemporalRenderNode | undefined;
	let maxOut = -1;
	for (const n of nodes) {
		const deg = outDegrees.get(n.entityId) ?? 0;
		if (deg > maxOut) {
			maxOut = deg;
			bestNode = n;
		}
	}

	return bestNode?.entityId ?? nodes[0]?.entityId;
}

/**
 * Computes an Architecture-backed 2D layout for Temporal Graph,
 * placing nodes into hierarchy depth rings, computing layer bands,
 * and maintaining visual continuity across commits.
 */
export function computeArchitectureTemporalLayout(
	diff: TemporalStructuralDiff,
	options: TemporalArchitectureLayoutOptions = {}
): TemporalArchitectureLayoutResult {
	const previousPositions = options.previousPositions ?? new Map<string, { x: number; y: number }>();

	const activeNodes = diff.nodes;
	const activeEdges = diff.edges;

	if (activeNodes.length === 0) {
		return {
			nodes: [],
			positions: new Map(),
			bands: [],
			guides: [],
		};
	}

	// Map TemporalRenderNodes to GraphNodes for the preserved layout engine
	const graphNodes: GraphNode[] = activeNodes.map(n => {
		const layer = getNodeLayer(n);
		const exportsList: string[] = Array.isArray(n.meta?.exports)
			? (n.meta.exports as string[])
			: (n.meta?.exports ? Object.keys(n.meta.exports) : []);
		const importsList: string[] = Array.isArray(n.meta?.imports)
			? (n.meta.imports as string[])
			: (n.meta?.imports ? Object.keys(n.meta.imports) : []);
		return {
			id: n.entityId,
			kind: (n.kind as any) || 'file',
			label: n.label || n.path,
			path: n.path,
			isEntry: Boolean(n.meta?.isEntry),
			meta: {
				...(n.meta || {}),
				architectureLayer: layer,
				language: n.meta?.language ?? undefined,
				exports: exportsList,
				imports: importsList,
			},
		};
	});

	const graphEdges: GraphEdge[] = activeEdges.map(e => ({
		id: e.edgeId,
		source: e.sourceEntityId,
		target: e.targetEntityId,
		kind: (e.kind as any) || 'import',
		meta: (e.edgeData?.meta as any) || {},
	}));

	const entryEntityId = deriveEntryEntityId(activeNodes, activeEdges, options.entryNodeId);
	let positionsRecord: Record<string, LayoutPosition> = {};
	let bands: HierarchyRingBand[] = [];
	let guides: HierarchyRingGuide[] = [];

	if (entryEntityId) {
		try {
			positionsRecord = computeHierarchyLayout(graphNodes, graphEdges, {
				entryNodeId: entryEntityId,
			});
			bands = getHierarchyRingBandsForSnapshot(
				graphNodes,
				graphEdges,
				entryEntityId,
				positionsRecord
			);
			guides = getHierarchyRingGuides(
				graphNodes,
				graphEdges,
				entryEntityId
			);
		} catch {
			// Fallback if graph is disconnected or entry calculation fails
			positionsRecord = {};
		}
	}

	const nextPositions = new Map<string, { x: number; y: number }>();
	const finalNodes: TemporalRenderNode[] = [];

	// Merge with previous positions to preserve regional stability when applicable
	for (const node of activeNodes) {
		let x: number;
		let y: number;

		const freshPos = positionsRecord[node.entityId];
		const prevPos = previousPositions.get(node.entityId);

		if (freshPos) {
			x = Math.round(freshPos.x);
			y = Math.round(freshPos.y);
		} else if (prevPos) {
			x = prevPos.x;
			y = prevPos.y;
		} else {
			x = 0;
			y = 0;
		}

		nextPositions.set(node.entityId, { x, y });
		const layer = getNodeLayer(node);
		finalNodes.push({
			...node,
			x,
			y,
			meta: {
				...(node.meta || {}),
				architectureLayer: layer,
			},
		});
	}

	return {
		nodes: finalNodes,
		positions: nextPositions,
		bands,
		guides,
		entryEntityId,
	};
}

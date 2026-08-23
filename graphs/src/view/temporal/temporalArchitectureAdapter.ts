/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { classifyNodeLayer, ARCHITECTURE_LAYERS, type ArchitectureLayerId } from '../../core/analysis/architectureLayers.js';
import type {
	HierarchyRingBand,
	HierarchyRingGuide,
} from '../../layouts/architecture/hierarchy/hierarchyLayout.js';
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

import { layoutTemporalGraph } from '../../temporal/view/temporalLayoutEngine.js';

/**
 * Computes an authoritative 2D layout for Temporal Graph, maintaining
 * continuity and compact topology across commits.
 */
export function computeArchitectureTemporalLayout(
	diff: TemporalStructuralDiff,
	options: TemporalArchitectureLayoutOptions = {}
): TemporalArchitectureLayoutResult {
	const previousPositions = options.previousPositions ?? new Map<string, { x: number; y: number }>();
	const layoutResult = layoutTemporalGraph(diff, previousPositions, {
		nodeSpacing: options.nodeSpacing ?? 48,
	});

	return {
		nodes: layoutResult.nodes,
		positions: layoutResult.positions,
		bands: [],
		guides: [],
		entryEntityId: deriveEntryEntityId(diff.nodes, diff.edges, options.entryNodeId),
	};
}


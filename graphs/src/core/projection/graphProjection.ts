/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CanonicalGraphSnapshot } from '../../common/types/canonicalTypes.js';
import type { GraphEdge, GraphNode, GraphSnapshot } from '../../common/types/graphTypes.js';
import { getFileTypeInfo } from '../../common/constants/fileTypeColors.js';
import {
	computeNetworkSphereRadius,
	layoutNetworkGraph,
	type NetworkLayoutMode,
	type NetworkLayoutRuntimeConfig,
} from '../../layouts/network/index.js';

export interface NetworkProjectionOptions {
	readonly maxRenderedNodes?: number;
	readonly maxRenderedEdges?: number;
	readonly hideLowImportance?: boolean;
	readonly networkLayoutMode?: NetworkLayoutMode;
	readonly spreadScale?: number;
	readonly collisionRadius?: number;
	readonly linkDistance?: number;
	readonly forceStrength?: number;
	readonly layoutRevision?: number;
}

export interface NodeImportance {
	inDegree: number;
	outDegree: number;
	score: number;
}

const EmptyNodeImportance: NodeImportance = { inDegree: 0, outDegree: 0, score: 0 };

export function projectNetworkGraph(
	canonical: CanonicalGraphSnapshot,
	options: NetworkProjectionOptions = {}
): GraphSnapshot {
	const maxNodes = options.maxRenderedNodes ?? 280;
	const maxEdges = options.maxRenderedEdges ?? 420;
	const hideLow = options.hideLowImportance === true;
	const networkLayoutMode: NetworkLayoutMode = options.networkLayoutMode ?? 'organic';

	// Filter to file-level nodes for rendering
	const layoutNodes = canonical.nodes.filter(n => n.kind !== 'folder' && n.kind !== 'function');
	const layoutEdges = canonical.edges.filter(e => e.kind === 'import' || e.kind === 'dependency');

	const importanceByNode = computeImportanceByNode(layoutEdges);

	let nodes = layoutNodes;
	if (hideLow && canonical.entryNodeId) {
		nodes = layoutNodes.filter(n => {
			if (n.id === canonical.entryNodeId || n.isEntry) {
				return true;
			}
			const imp = importanceByNode.get(n.id) ?? EmptyNodeImportance;
			return imp.score >= 1;
		});
	}

	if (nodes.length > maxNodes) {
		nodes = pickLayoutNodes(nodes, canonical.entryNodeId, maxNodes, importanceByNode);
	}

	const nodeIds = new Set(nodes.map(n => n.id));
	const edges = canonical.edges
		.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
		.slice(0, maxEdges);

	const computed = computeNetworkPositions(nodes, edges, networkLayoutMode, options);

	return {
		nodes,
		edges,
		positions: computed.positions2d,
		positions3d: computed.positions3d,
		networkLayoutMode,
		layoutRevision: options.layoutRevision ?? 1,
		projectPath: canonical.projectPath,
		projectName: canonical.projectName,
		entryNodeId: canonical.entryNodeId,
		scannedAt: canonical.analyzedAt,
	};
}

export function computeImportanceByNode(edges: readonly GraphEdge[]): Map<string, NodeImportance> {
	const importanceByNode = new Map<string, NodeImportance>();
	for (const edge of edges) {
		if (edge.kind !== 'import' && edge.kind !== 'dependency') {
			continue;
		}
		const source = importanceByNode.get(edge.source) ?? { inDegree: 0, outDegree: 0, score: 0 };
		source.outDegree++;
		importanceByNode.set(edge.source, source);
		const target = importanceByNode.get(edge.target) ?? { inDegree: 0, outDegree: 0, score: 0 };
		target.inDegree++;
		importanceByNode.set(edge.target, target);
	}
	for (const importance of importanceByNode.values()) {
		importance.score = importance.inDegree * 1.2 + importance.outDegree * 0.8;
	}
	return importanceByNode;
}

export function pickLayoutNodes(
	nodes: readonly GraphNode[],
	entryNodeId: string | null,
	maxNodes: number,
	importanceByNode: Map<string, NodeImportance>
): GraphNode[] {
	const fileNodes = nodes.filter(n => n.kind !== 'folder');
	if (fileNodes.length <= maxNodes) {
		return [...fileNodes];
	}

	const scored = fileNodes.map(n => {
		const imp = importanceByNode.get(n.id) ?? EmptyNodeImportance;
		const entryBoost = entryNodeId && (n.id === entryNodeId || n.isEntry) ? 1_000_000 : 0;
		return { n, score: imp.score + entryBoost };
	});

	scored.sort((a, b) => b.score - a.score || a.n.id.localeCompare(b.n.id));
	const picked = scored.slice(0, maxNodes).map(s => s.n);

	if (entryNodeId && !picked.some(n => n.id === entryNodeId)) {
		const entry = fileNodes.find(n => n.id === entryNodeId);
		if (entry) {
			picked[picked.length - 1] = entry;
		}
	}

	return picked;
}

function computeNetworkPositions(
	nodes: readonly GraphNode[],
	edges: readonly GraphEdge[],
	mode: NetworkLayoutMode,
	options: NetworkProjectionOptions
): { positions2d: Record<string, { x: number; y: number }>; positions3d: Record<string, { x: number; y: number; z: number }> } {
	const importanceByNode = computeImportanceByNode(edges);
	const layoutNodes = nodes
		.filter(n => n.kind !== 'folder' && n.kind !== 'function')
		.map(n => {
			const ft = getFileTypeInfo(n.path);
			const imp = importanceByNode.get(n.id) ?? EmptyNodeImportance;
			const degree = imp.inDegree + imp.outDegree;
			return {
				id: n.id,
				fileTypeId: ft.id,
				isEntry: !!n.isEntry,
				val: n.isEntry ? 10 : Math.max(1.5, 1.2 + Math.sqrt(degree) * 1.4),
			};
		});

	const nodeIds = new Set(layoutNodes.map(n => n.id));
	const links = edges
		.filter(e => (e.kind === 'import' || e.kind === 'dependency') && nodeIds.has(e.source) && nodeIds.has(e.target))
		.map(e => ({ source: e.source, target: e.target }));

	const spread = Math.max(0.4, Math.min(2.5, options.spreadScale ?? 1));
	const radius = computeNetworkSphereRadius(layoutNodes.length, spread);
	const layoutConfig: NetworkLayoutRuntimeConfig = {
		sphereRadius: radius,
		collisionRadius: Math.max(2, options.collisionRadius ?? 24),
		linkDistance: Math.max(4, options.linkDistance ?? 80),
		forceStrength: Math.max(0, Math.min(2, options.forceStrength ?? 0.35)),
	};

	const layout = layoutNetworkGraph(mode, layoutNodes, links, layoutConfig);
	const positions2d: Record<string, { x: number; y: number }> = {};
	const positions3d: Record<string, { x: number; y: number; z: number }> = {};

	for (const [id, p] of layout) {
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
			continue;
		}
		positions3d[id] = { x: p.x, y: p.y, z: p.z };
		positions2d[id] = { x: p.x - 14, y: p.y - 14 };
	}

	return { positions2d, positions3d };
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { TemporalRenderNode, TemporalRenderEdge } from './temporalViewTypes.js';
import { classifyNodeLayer, ARCHITECTURE_LAYERS, type ArchitectureLayerId } from '../../core/analysis/architectureLayers.js';

export interface StronglyConnectedComponent {
	readonly id: string;
	readonly members: readonly string[];
	readonly isCycle: boolean;
	readonly primaryNodeId: string;
}

export interface CondensedDag {
	readonly sccs: readonly StronglyConnectedComponent[];
	readonly nodeToSccId: ReadonlyMap<string, string>;
	readonly sccAdjacency: ReadonlyMap<string, ReadonlySet<string>>;
	readonly sccPredecessors: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface AdaptiveCommunity {
	readonly id: string;
	readonly label: string;
	readonly primaryLayer: ArchitectureLayerId;
	readonly color: string;
	readonly nodeIds: readonly string[];
	readonly primaryHubId: string;
	readonly depth: number;
	readonly hasEntry: boolean;
	readonly totalDegree: number;
	readonly maxDegree: number;
}

const LAYER_COLOR_MAP = new Map<ArchitectureLayerId, string>(
	ARCHITECTURE_LAYERS.map(l => [l.id, l.color])
);

export function getLayerColor(layerId?: ArchitectureLayerId | string): string {
	return (layerId && LAYER_COLOR_MAP.get(layerId as ArchitectureLayerId)) || '#6366f1';
}

export function getNodeArchitectureLayer(node: TemporalRenderNode): ArchitectureLayerId {
	if (node.meta?.architectureLayer) {
		return node.meta.architectureLayer as ArchitectureLayerId;
	}
	return classifyNodeLayer(node.path || node.label, Boolean(node.meta?.isEntry));
}

/**
 * Computes Strongly Connected Components (SCCs) using Tarjan's algorithm.
 * Deterministic guarantee: input node/edge order does NOT affect SCC partition or ID ordering.
 */
export function computeStronglyConnectedComponents(
	nodes: readonly TemporalRenderNode[],
	edges: readonly TemporalRenderEdge[],
): StronglyConnectedComponent[] {
	if (nodes.length === 0) {
		return [];
	}

	// Canonical node map and sorted keys for strict determinism
	const nodeMap = new Map<string, TemporalRenderNode>();
	for (let i = 0; i < nodes.length; i++) {
		nodeMap.set(nodes[i].entityId, nodes[i]);
	}

	const sortedNodeIds = Array.from(nodeMap.keys()).sort();

	// Build directed adjacency map (u -> v where u imports v)
	const adj = new Map<string, string[]>();
	for (let i = 0; i < sortedNodeIds.length; i++) {
		adj.set(sortedNodeIds[i], []);
	}

	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		if (e.changeKind === 'removed') {continue;}
		const src = e.sourceEntityId || (e as any).sourceId;
		const tgt = e.targetEntityId || (e as any).targetId;
		if (src && tgt && nodeMap.has(src) && nodeMap.has(tgt) && src !== tgt) {
			adj.get(src)!.push(tgt);
		}
	}

	// Deduplicate and sort neighbor lists canonically
	for (let i = 0; i < sortedNodeIds.length; i++) {
		const id = sortedNodeIds[i];
		const neighbors = Array.from(new Set(adj.get(id)!)).sort();
		adj.set(id, neighbors);
	}

	let currentIndex = 0;
	const indices = new Map<string, number>();
	const lowlink = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const rawSccs: string[][] = [];

	function strongConnect(v: string): void {
		indices.set(v, currentIndex);
		lowlink.set(v, currentIndex);
		currentIndex++;
		stack.push(v);
		onStack.add(v);

		const neighbors = adj.get(v) || [];
		for (let i = 0; i < neighbors.length; i++) {
			const w = neighbors[i];
			if (!indices.has(w)) {
				strongConnect(w);
				lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
			} else if (onStack.has(w)) {
				lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
			}
		}

		if (lowlink.get(v) === indices.get(v)) {
			const sccMembers: string[] = [];
			while (stack.length > 0) {
				const w = stack.pop()!;
				onStack.delete(w);
				sccMembers.push(w);
				if (w === v) {break;}
			}
			sccMembers.sort();
			rawSccs.push(sccMembers);
		}
	}

	for (let i = 0; i < sortedNodeIds.length; i++) {
		const v = sortedNodeIds[i];
		if (!indices.has(v)) {
			strongConnect(v);
		}
	}

	// Sort SCCs canonically by their first member
	rawSccs.sort((a, b) => a[0].localeCompare(b[0]));

	return rawSccs.map((members, idx) => {
		const isCycle = members.length > 1;
		// Pick primary node (entry > highest degree > canonical path)
		let primaryNodeId = members[0];
		let bestRank = -1;
		for (let m = 0; m < members.length; m++) {
			const mid = members[m];
			const node = nodeMap.get(mid);
			const isEntry = Boolean(node?.meta?.isEntry);
			const deg = (adj.get(mid)?.length || 0);
			const rank = (isEntry ? 10000 : 0) + deg;
			if (rank > bestRank) {
				bestRank = rank;
				primaryNodeId = mid;
			}
		}

		return {
			id: `scc_${idx}_${primaryNodeId}`,
			members,
			isCycle,
			primaryNodeId,
		};
	});
}

/**
 * Condenses an SCC partition into an acyclic Directed Acyclic Graph (DAG).
 */
export function condenseToDag(
	nodes: readonly TemporalRenderNode[],
	edges: readonly TemporalRenderEdge[],
	sccs: readonly StronglyConnectedComponent[],
): CondensedDag {
	const nodeToSccId = new Map<string, string>();
	for (let i = 0; i < sccs.length; i++) {
		const scc = sccs[i];
		for (let m = 0; m < scc.members.length; m++) {
			nodeToSccId.set(scc.members[m], scc.id);
		}
	}

	const sccAdjacency = new Map<string, Set<string>>();
	const sccPredecessors = new Map<string, Set<string>>();
	for (let i = 0; i < sccs.length; i++) {
		sccAdjacency.set(sccs[i].id, new Set<string>());
		sccPredecessors.set(sccs[i].id, new Set<string>());
	}

	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		if (e.changeKind === 'removed') {continue;}
		const src = e.sourceEntityId || (e as any).sourceId;
		const tgt = e.targetEntityId || (e as any).targetId;
		if (!src || !tgt) {continue;}

		const srcScc = nodeToSccId.get(src);
		const tgtScc = nodeToSccId.get(tgt);
		if (srcScc && tgtScc && srcScc !== tgtScc) {
			sccAdjacency.get(srcScc)!.add(tgtScc);
			sccPredecessors.get(tgtScc)!.add(srcScc);
		}
	}

	return {
		sccs,
		nodeToSccId,
		sccAdjacency,
		sccPredecessors,
	};
}

/**
 * Computes topological producer-to-consumer dependency depths on a condensed DAG.
 * Roots (producers / consumers with no incoming dependency from other SCCs) have depth 0.
 * Downstream dependencies receive depth = max(parent_depth) + 1.
 */
export function computeTopologicalDepths(
	dag: CondensedDag,
	nodes: readonly TemporalRenderNode[],
): Map<string, number> {
	const sccDepth = new Map<string, number>();
	const inDegree = new Map<string, number>();

	for (let i = 0; i < dag.sccs.length; i++) {
		const scc = dag.sccs[i];
		const preds = dag.sccPredecessors.get(scc.id);
		inDegree.set(scc.id, preds ? preds.size : 0);
	}

	// Roots: inDegree === 0
	const queue: string[] = [];
	for (let i = 0; i < dag.sccs.length; i++) {
		const sccId = dag.sccs[i].id;
		if (inDegree.get(sccId) === 0) {
			queue.push(sccId);
			sccDepth.set(sccId, 0);
		}
	}

	// Kahn's-style longest-path leveling
	while (queue.length > 0) {
		const u = queue.shift()!;
		const uDepth = sccDepth.get(u) || 0;
		const neighbors = Array.from(dag.sccAdjacency.get(u) || []).sort();

		for (let i = 0; i < neighbors.length; i++) {
			const v = neighbors[i];
			const curVDepth = sccDepth.get(v) ?? 0;
			sccDepth.set(v, Math.max(curVDepth, uDepth + 1));

			const remainingIn = (inDegree.get(v) || 1) - 1;
			inDegree.set(v, remainingIn);
			if (remainingIn === 0) {
				queue.push(v);
			}
		}
	}

	// Assign depth to individual nodes
	const nodeDepths = new Map<string, number>();
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		const sccId = dag.nodeToSccId.get(n.entityId);
		let d = sccId ? (sccDepth.get(sccId) ?? 0) : 0;

		// Soft layer compensation for unranked or isolated nodes
		if (d === 0) {
			const layer = getNodeArchitectureLayer(n);
			if (layer === 'entry') {d = 0;}
			else if (layer === 'frontend' || layer === 'ui' || layer === 'components') {d = 1;}
			else if (layer === 'api') {d = 2;}
			else if (layer === 'services' || layer === 'backend') {d = 3;}
			else if (layer === 'database') {d = 4;}
			else if (layer === 'utils' || layer === 'config') {d = 5;}
			else if (layer === 'tests') {d = 6;}
		}

		nodeDepths.set(n.entityId, d);
	}

	return nodeDepths;
}

/**
 * Adaptive community detection combining:
 * 1. Topological connectivity & import graph cohesion
 * 2. Adaptive directory hierarchy granularity
 * 3. Strongly Connected Component (SCC) co-location
 * 4. Architectural layer majority voting
 */
export function computeAdaptiveCommunities(
	nodes: readonly TemporalRenderNode[],
	edges: readonly TemporalRenderEdge[],
): AdaptiveCommunity[] {
	if (nodes.length === 0) {
		return [];
	}

	const sccs = computeStronglyConnectedComponents(nodes, edges);
	const dag = condenseToDag(nodes, edges, sccs);
	const nodeDepths = computeTopologicalDepths(dag, nodes);

	// Map node degrees
	const degreeByNode = new Map<string, number>();
	for (let i = 0; i < nodes.length; i++) {
		degreeByNode.set(nodes[i].entityId, 0);
	}
	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		if (e.changeKind === 'removed') {continue;}
		const src = e.sourceEntityId || (e as any).sourceId;
		const tgt = e.targetEntityId || (e as any).targetId;
		if (src && degreeByNode.has(src)) {degreeByNode.set(src, degreeByNode.get(src)! + 1);}
		if (tgt && degreeByNode.has(tgt)) {degreeByNode.set(tgt, degreeByNode.get(tgt)! + 1);}
	}

	// 1. Initial adaptive prefix clustering based on directory depth and node count
	interface CommunityBucket {
		readonly pathPrefix: string;
		readonly nodeIds: string[];
		readonly layerCounts: Map<ArchitectureLayerId, number>;
		totalDegree: number;
		maxDegree: number;
		hasEntry: boolean;
		primaryHubId: string;
		depthSum: number;
	}

	// Determine directory hierarchy tree
	const rawPathToNode = new Map<string, TemporalRenderNode>();
	for (let i = 0; i < nodes.length; i++) {
		rawPathToNode.set(nodes[i].entityId, nodes[i]);
	}

	// Helper to extract adaptive path prefix
	function getAdaptivePrefix(path: string): string {
		if (!path) {return 'root';}
		const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
		if (parts.length <= 1) {return 'root';}
		const dirParts = parts.slice(0, -1);
		if (dirParts.length === 0) {return 'root';}

		if (dirParts[0] === 'src' && dirParts.length >= 4 && dirParts[1] === 'vs') {
			// e.g. src/vs/workbench/contrib or src/vs/platform/configuration
			return dirParts.slice(0, Math.min(dirParts.length, 4)).join('/');
		}
		if (dirParts[0] === 'graphs' && dirParts.length >= 3 && dirParts[1] === 'src') {
			// e.g. graphs/src/core or graphs/src/temporal
			return dirParts.slice(0, Math.min(dirParts.length, 3)).join('/');
		}
		if (dirParts.length >= 3) {
			return dirParts.slice(0, 3).join('/');
		}
		return dirParts.join('/');
	}

	const buckets = new Map<string, CommunityBucket>();

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const prefix = getAdaptivePrefix(node.path || node.label);
		const layer = getNodeArchitectureLayer(node);
		const deg = degreeByNode.get(node.entityId) || 0;
		const isEntry = Boolean(node.meta?.isEntry) || layer === 'entry';
		const depth = nodeDepths.get(node.entityId) || 0;

		let bucket = buckets.get(prefix);
		if (!bucket) {
			bucket = {
				pathPrefix: prefix,
				nodeIds: [],
				layerCounts: new Map(),
				totalDegree: 0,
				maxDegree: 0,
				hasEntry: false,
				primaryHubId: node.entityId,
				depthSum: 0,
			};
			buckets.set(prefix, bucket);
		}

		bucket.nodeIds.push(node.entityId);
		bucket.layerCounts.set(layer, (bucket.layerCounts.get(layer) || 0) + 1);
		bucket.totalDegree += deg;
		bucket.depthSum += depth;
		if (isEntry) {bucket.hasEntry = true;}
		if (deg >= bucket.maxDegree) {
			bucket.maxDegree = deg;
			bucket.primaryHubId = node.entityId;
		}
	}

	// 2. Co-locate SCC members if any multi-node SCC spans multiple buckets
	for (let i = 0; i < sccs.length; i++) {
		const scc = sccs[i];
		if (!scc.isCycle) {continue;}

		// Find the bucket containing the primary node of the SCC
		const targetBucketPrefix = getAdaptivePrefix(rawPathToNode.get(scc.primaryNodeId)?.path || '');
		const targetBucket = buckets.get(targetBucketPrefix);
		if (!targetBucket) {continue;}

		for (let m = 0; m < scc.members.length; m++) {
			const memberId = scc.members[m];
			const memberNode = rawPathToNode.get(memberId);
			if (!memberNode) {continue;}
			const currentPrefix = getAdaptivePrefix(memberNode.path || '');
			if (currentPrefix !== targetBucketPrefix) {
				const currentBucket = buckets.get(currentPrefix);
				if (currentBucket) {
					const idx = currentBucket.nodeIds.indexOf(memberId);
					if (idx >= 0) {
						currentBucket.nodeIds.splice(idx, 1);
						targetBucket.nodeIds.push(memberId);
					}
				}
			}
		}
	}

	// 3. Format final communities
	const resultCommunities: AdaptiveCommunity[] = [];

	const sortedPrefixes = Array.from(buckets.keys()).sort();
	for (let i = 0; i < sortedPrefixes.length; i++) {
		const bucket = buckets.get(sortedPrefixes[i])!;
		if (bucket.nodeIds.length === 0) {continue;}

		// Sort members canonically
		bucket.nodeIds.sort((a, b) => {
			const na = rawPathToNode.get(a);
			const nb = rawPathToNode.get(b);
			const da = degreeByNode.get(a) || 0;
			const db = degreeByNode.get(b) || 0;
			if (Boolean(na?.meta?.isEntry) && !Boolean(nb?.meta?.isEntry)) {return -1;}
			if (Boolean(nb?.meta?.isEntry) && !Boolean(na?.meta?.isEntry)) {return 1;}
			if (db !== da) {return db - da;}
			return a.localeCompare(b);
		});

		// Recompute metadata truthfully on the final member set post-SCC co-location
		const layerCounts = new Map<ArchitectureLayerId, number>();
		let totalDegree = 0;
		let maxDegree = -1;
		let primaryHubId = bucket.nodeIds[0] || '';
		let hasEntry = false;
		let depthSum = 0;

		for (let j = 0; j < bucket.nodeIds.length; j++) {
			const nid = bucket.nodeIds[j];
			const node = rawPathToNode.get(nid);
			const layer = node ? getNodeArchitectureLayer(node) : 'other';
			const deg = degreeByNode.get(nid) || 0;
			const isEntry = Boolean(node?.meta?.isEntry) || layer === 'entry';
			const depth = nodeDepths.get(nid) || 0;

			layerCounts.set(layer, (layerCounts.get(layer) || 0) + 1);
			totalDegree += deg;
			depthSum += depth;
			if (isEntry) {hasEntry = true;}
			if (deg > maxDegree) {
				maxDegree = deg;
				primaryHubId = nid;
			}
		}

		// Determine majority layer
		let majorityLayer: ArchitectureLayerId = 'other';
		let maxCount = -1;
		for (const [l, count] of layerCounts.entries()) {
			if (count > maxCount) {
				maxCount = count;
				majorityLayer = l;
			}
		}

		const label = formatAdaptiveCommunityLabel(bucket.pathPrefix, majorityLayer);
		const avgDepth = depthSum / bucket.nodeIds.length;

		resultCommunities.push({
			id: `comm::${bucket.pathPrefix}::${majorityLayer}`,
			label,
			primaryLayer: majorityLayer,
			color: getLayerColor(majorityLayer),
			nodeIds: bucket.nodeIds,
			primaryHubId,
			depth: avgDepth,
			hasEntry,
			totalDegree,
			maxDegree: Math.max(0, maxDegree),
		});
	}

	// Sort communities canonically by entry, then topological depth, then totalDegree, then label
	resultCommunities.sort((a, b) => {
		if (a.hasEntry && !b.hasEntry) {return -1;}
		if (b.hasEntry && !a.hasEntry) {return 1;}
		if (Math.abs(a.depth - b.depth) > 0.01) {return a.depth - b.depth;}
		if (b.totalDegree !== a.totalDegree) {return b.totalDegree - a.totalDegree;}
		return a.id.localeCompare(b.id);
	});

	return resultCommunities;
}

function formatAdaptiveCommunityLabel(prefix: string, layer: ArchitectureLayerId): string {
	if (prefix === 'root') {
		const layerDef = ARCHITECTURE_LAYERS.find(l => l.id === layer);
		return layerDef ? layerDef.label : 'Core Module';
	}
	const clean = prefix
		.replace(/^src\/vs\//, '')
		.replace(/^src\//, '')
		.replace(/^graphs\/src\//, '')
		.replace(/^graphs\//, '');

	const parts = clean.split('/').map(p => p.charAt(0).toUpperCase() + p.slice(1));
	const name = parts.join(' · ');

	const layerDef = ARCHITECTURE_LAYERS.find(l => l.id === layer);
	const layerLabel = layerDef ? layerDef.label : '';

	if (layerLabel && !name.toLowerCase().includes(layerLabel.toLowerCase())) {
		return `${name} · ${layerLabel}`;
	}
	return name;
}

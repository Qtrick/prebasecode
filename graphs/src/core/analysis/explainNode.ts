/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Local, DOM-free node explanation for Code Graph / Magnus.
 * inspired by Graphify MIT concepts, PreBase reimplementation
 * (no AI — structured neighborhood + community + confidence only).
 */

import type { EdgeConfidence, EdgeKind, GraphEdge, GraphNode } from '../../common/types/graphTypes.js';
import { computeDegreeStats } from './communities.js';
import { rankImportantNodes } from './importantNodes.js';

export interface ExplainNeighborRef {
	id: string;
	label: string;
	kind: EdgeKind;
	confidence?: EdgeConfidence;
}

export interface ExplainNodeResult {
	id: string;
	label: string;
	kind: GraphNode['kind'];
	path?: string;
	communityId?: number;
	communityLabel?: string;
	degrees: { degree: number; inDegree: number; outDegree: number };
	inbound: Record<string, ExplainNeighborRef[]>;
	outbound: Record<string, ExplainNeighborRef[]>;
	confidence: { EXTRACTED: number; INFERRED: number; AMBIGUOUS: number; unknown: number };
	important?: { rank: number; degree: number; reason: string };
	truncated: boolean;
	notice?: string;
	found: true;
}

export interface ExplainNodeMissing {
	found: false;
	nodeId: string;
}

const PER_KIND_LIMIT = 12;

function cmpId(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function pushGrouped(
	bucket: Record<string, ExplainNeighborRef[]>,
	kind: EdgeKind,
	ref: ExplainNeighborRef
): boolean {
	const list = bucket[kind] ?? (bucket[kind] = []);
	if (list.length >= PER_KIND_LIMIT) {
		return false;
	}
	list.push(ref);
	return true;
}

/** Structured local explanation; uses node.meta community/degree when present. */
export function explainNode(
	nodes: GraphNode[],
	edges: GraphEdge[],
	nodeId: string
): ExplainNodeResult | ExplainNodeMissing {
	const node = nodes.find((n) => n.id === nodeId);
	if (!node) {
		return { found: false, nodeId };
	}

	const byId = new Map(nodes.map((n) => [n.id, n]));
	const inbound: Record<string, ExplainNeighborRef[]> = {};
	const outbound: Record<string, ExplainNeighborRef[]> = {};
	const confidence = { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0, unknown: 0 };
	let truncated = false;

	const incident = edges
		.filter((e) => e.source === nodeId || e.target === nodeId)
		.sort((a, b) => cmpId(a.id, b.id));

	for (const edge of incident) {
		const conf = edge.meta?.confidence;
		if (conf === 'EXTRACTED' || conf === 'INFERRED' || conf === 'AMBIGUOUS') {
			confidence[conf] += 1;
		} else {
			confidence.unknown += 1;
		}
		if (edge.source === nodeId) {
			const other = byId.get(edge.target);
			if (!pushGrouped(outbound, edge.kind, {
				id: edge.target,
				label: other?.label ?? edge.target,
				kind: edge.kind,
				confidence: conf,
			})) {
				truncated = true;
			}
		} else {
			const other = byId.get(edge.source);
			if (!pushGrouped(inbound, edge.kind, {
				id: edge.source,
				label: other?.label ?? edge.source,
				kind: edge.kind,
				confidence: conf,
			})) {
				truncated = true;
			}
		}
	}

	for (const key of Object.keys(inbound)) {
		inbound[key].sort((a, b) => cmpId(a.id, b.id));
	}
	for (const key of Object.keys(outbound)) {
		outbound[key].sort((a, b) => cmpId(a.id, b.id));
	}

	const degreeStats = computeDegreeStats(nodes, edges);
	const computed = degreeStats.get(nodeId);
	const degrees = {
		degree: typeof node.meta?.degree === 'number' ? node.meta.degree : (computed?.degree ?? 0),
		inDegree: typeof node.meta?.inDegree === 'number' ? node.meta.inDegree : (computed?.inDegree ?? 0),
		outDegree: typeof node.meta?.outDegree === 'number' ? node.meta.outDegree : (computed?.outDegree ?? 0),
	};

	const importantRanked = rankImportantNodes(nodes, edges, 20);
	const importantIdx = importantRanked.findIndex((h) => h.id === nodeId);
	const important =
		importantIdx >= 0
			? {
					rank: importantIdx + 1,
					degree: importantRanked[importantIdx]!.degree,
					reason: importantRanked[importantIdx]!.reason,
				}
			: undefined;

	return {
		id: node.id,
		label: node.label,
		kind: node.kind,
		path: node.path,
		communityId: typeof node.meta?.communityId === 'number' ? node.meta.communityId : undefined,
		communityLabel:
			typeof node.meta?.communityLabel === 'string' ? node.meta.communityLabel : undefined,
		degrees,
		inbound,
		outbound,
		confidence,
		important,
		truncated,
		notice: truncated
			? `Neighbor lists truncated to ${PER_KIND_LIMIT} per edge kind.`
			: undefined,
		found: true,
	};
}

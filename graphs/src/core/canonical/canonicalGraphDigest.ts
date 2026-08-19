/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';
import { computePureSha256 } from './pureSha256.js';

export interface CanonicalGraphStructuralPayload {
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	readonly entryNodeId: string | null;
}

function stableCompare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function computeCanonicalGraphDigest(payload: CanonicalGraphStructuralPayload): string {
	const sortedNodes = [...payload.nodes].sort((a, b) => stableCompare(a.id, b.id));
	const sortedEdges = [...payload.edges].sort((a, b) => stableCompare(a.id, b.id));

	const normalized = {
		entryNodeId: payload.entryNodeId,
		nodes: sortedNodes.map(n => ({
			id: n.id,
			kind: n.kind,
			path: n.path,
			isEntry: !!n.isEntry,
			architectureLayer: n.meta?.architectureLayer ?? null,
			language: n.meta?.language ?? null,
			exports: n.meta?.exports ? [...n.meta.exports].sort(stableCompare) : [],
			imports: n.meta?.imports ? [...n.meta.imports].sort(stableCompare) : [],
		})),
		edges: sortedEdges.map(e => ({
			id: e.id,
			source: e.source,
			target: e.target,
			kind: e.kind,
			specifiers: e.meta?.specifiers ? [...e.meta.specifiers].sort(stableCompare) : [],
		})),
	};

	const serialized = JSON.stringify(normalized);
	return computePureSha256(serialized);
}

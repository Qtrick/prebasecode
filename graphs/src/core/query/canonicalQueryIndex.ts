/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CanonicalGraphSnapshot } from '../../common/types/canonicalTypes.js';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';

export interface AdjacentEdgeInfo {
	readonly edge: GraphEdge;
	readonly isOutgoing: boolean;
	readonly isIncoming: boolean;
}

export class CanonicalQueryIndex {
	readonly nodeById = new Map<string, GraphNode>();
	readonly nodeByPath = new Map<string, GraphNode>();
	readonly incomingEdges = new Map<string, GraphEdge[]>();
	readonly outgoingEdges = new Map<string, GraphEdge[]>();
	readonly adjacentEdges = new Map<string, AdjacentEdgeInfo[]>();
	readonly nodesByLayer = new Map<string, GraphNode[]>();
	readonly nodeDegree = new Map<string, number>();
	readonly languages: readonly string[];

	readonly snapshot: CanonicalGraphSnapshot;

	constructor(snapshot: CanonicalGraphSnapshot) {
		this.snapshot = snapshot;
		const languageSet = new Set<string>();

		for (const node of snapshot.nodes) {
			this.nodeById.set(node.id, node);
			if (node.path) {
				this.nodeByPath.set(node.path, node);
				this.nodeByPath.set(`file:${node.path}`, node);
			}

			const layer = node.meta?.architectureLayer ?? 'other';
			const layerNodes = this.nodesByLayer.get(layer);
			if (layerNodes) {
				layerNodes.push(node);
			} else {
				this.nodesByLayer.set(layer, [node]);
			}

			if (node.meta?.language) {
				languageSet.add(node.meta.language);
			}
		}

		this.languages = [...languageSet].sort();

		for (const edge of snapshot.edges) {
			// Outgoing from source
			const outList = this.outgoingEdges.get(edge.source);
			if (outList) {
				outList.push(edge);
			} else {
				this.outgoingEdges.set(edge.source, [edge]);
			}

			// Incoming to target
			const inList = this.incomingEdges.get(edge.target);
			if (inList) {
				inList.push(edge);
			} else {
				this.incomingEdges.set(edge.target, [edge]);
			}

			// Degree tracking
			this.nodeDegree.set(edge.source, (this.nodeDegree.get(edge.source) ?? 0) + 1);
			this.nodeDegree.set(edge.target, (this.nodeDegree.get(edge.target) ?? 0) + 1);

			// Adjacent info
			const outAdj: AdjacentEdgeInfo = {
				edge,
				isOutgoing: true,
				isIncoming: edge.source === edge.target,
			};
			const sourceAdj = this.adjacentEdges.get(edge.source);
			if (sourceAdj) {
				sourceAdj.push(outAdj);
			} else {
				this.adjacentEdges.set(edge.source, [outAdj]);
			}

			if (edge.source !== edge.target) {
				const inAdj: AdjacentEdgeInfo = {
					edge,
					isOutgoing: false,
					isIncoming: true,
				};
				const targetAdj = this.adjacentEdges.get(edge.target);
				if (targetAdj) {
					targetAdj.push(inAdj);
				} else {
					this.adjacentEdges.set(edge.target, [inAdj]);
				}
			}
		}
	}

	findNode(idOrPath: string): GraphNode | undefined {
		if (!idOrPath) return undefined;
		const trimmed = idOrPath.trim();
		return this.nodeById.get(trimmed) ?? this.nodeByPath.get(trimmed);
	}
}

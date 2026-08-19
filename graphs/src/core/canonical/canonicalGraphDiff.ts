/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CanonicalGraphSnapshot } from '../../common/types/canonicalTypes.js';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';

export interface CanonicalGraphDiff {
	readonly addedNodes: readonly GraphNode[];
	readonly removedNodeIds: readonly string[];
	readonly updatedNodes: readonly GraphNode[];
	readonly addedEdges: readonly GraphEdge[];
	readonly removedEdgeIds: readonly string[];
	readonly updatedEdges: readonly GraphEdge[];
	readonly isIdentical: boolean;
	readonly oldDigest: string;
	readonly newDigest: string;
}

export function computeCanonicalGraphDiff(
	oldSnapshot: Pick<CanonicalGraphSnapshot, 'nodes' | 'edges' | 'digest'>,
	newSnapshot: Pick<CanonicalGraphSnapshot, 'nodes' | 'edges' | 'digest'>
): CanonicalGraphDiff {
	const oldNodeMap = new Map<string, GraphNode>();
	for (const node of oldSnapshot.nodes) {
		oldNodeMap.set(node.id, node);
	}

	const newNodeMap = new Map<string, GraphNode>();
	for (const node of newSnapshot.nodes) {
		newNodeMap.set(node.id, node);
	}

	const oldEdgeMap = new Map<string, GraphEdge>();
	for (const edge of oldSnapshot.edges) {
		oldEdgeMap.set(edge.id, edge);
	}

	const newEdgeMap = new Map<string, GraphEdge>();
	for (const edge of newSnapshot.edges) {
		newEdgeMap.set(edge.id, edge);
	}

	const addedNodes: GraphNode[] = [];
	const updatedNodes: GraphNode[] = [];
	const removedNodeIds: string[] = [];

	for (const [id, newNode] of newNodeMap) {
		const oldNode = oldNodeMap.get(id);
		if (!oldNode) {
			addedNodes.push(newNode);
		} else if (!areNodesStructurallyEqual(oldNode, newNode)) {
			updatedNodes.push(newNode);
		}
	}

	for (const id of oldNodeMap.keys()) {
		if (!newNodeMap.has(id)) {
			removedNodeIds.push(id);
		}
	}

	const addedEdges: GraphEdge[] = [];
	const updatedEdges: GraphEdge[] = [];
	const removedEdgeIds: string[] = [];

	for (const [id, newEdge] of newEdgeMap) {
		const oldEdge = oldEdgeMap.get(id);
		if (!oldEdge) {
			addedEdges.push(newEdge);
		} else if (!areEdgesStructurallyEqual(oldEdge, newEdge)) {
			updatedEdges.push(newEdge);
		}
	}

	for (const id of oldEdgeMap.keys()) {
		if (!newEdgeMap.has(id)) {
			removedEdgeIds.push(id);
		}
	}

	const isIdentical =
		addedNodes.length === 0 &&
		removedNodeIds.length === 0 &&
		updatedNodes.length === 0 &&
		addedEdges.length === 0 &&
		removedEdgeIds.length === 0 &&
		updatedEdges.length === 0;

	return {
		addedNodes,
		removedNodeIds,
		updatedNodes,
		addedEdges,
		removedEdgeIds,
		updatedEdges,
		isIdentical,
		oldDigest: oldSnapshot.digest,
		newDigest: newSnapshot.digest,
	};
}

function areNodesStructurallyEqual(a: GraphNode, b: GraphNode): boolean {
	if (
		a.id !== b.id ||
		a.kind !== b.kind ||
		a.label !== b.label ||
		a.path !== b.path ||
		a.parentId !== b.parentId ||
		!!a.isEntry !== !!b.isEntry
	) {
		return false;
	}

	const aMeta = a.meta;
	const bMeta = b.meta;
	if (!aMeta && !bMeta) {
		return true;
	}
	if (!aMeta || !bMeta) {
		return false;
	}

	if (
		aMeta.architectureLayer !== bMeta.architectureLayer ||
		aMeta.language !== bMeta.language ||
		aMeta.isComponent !== bMeta.isComponent ||
		aMeta.isMetadata !== bMeta.isMetadata
	) {
		return false;
	}

	return (
		areStringArraysEqual(aMeta.imports, bMeta.imports) &&
		areStringArraysEqual(aMeta.exports, bMeta.exports)
	);
}

function areEdgesStructurallyEqual(a: GraphEdge, b: GraphEdge): boolean {
	if (
		a.id !== b.id ||
		a.source !== b.source ||
		a.target !== b.target ||
		a.kind !== b.kind
	) {
		return false;
	}

	const aMeta = a.meta;
	const bMeta = b.meta;
	if (!aMeta && !bMeta) {
		return true;
	}
	if (!aMeta || !bMeta) {
		return false;
	}

	if (
		aMeta.importSource !== bMeta.importSource ||
		aMeta.isDefault !== bMeta.isDefault ||
		aMeta.isDynamic !== bMeta.isDynamic
	) {
		return false;
	}

	return areStringArraysEqual(aMeta.specifiers, bMeta.specifiers);
}

function areStringArraysEqual(a?: readonly string[], b?: readonly string[]): boolean {
	if (!a && !b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	if (a.length !== b.length) {
		return false;
	}
	const sortedA = [...a].sort();
	const sortedB = [...b].sort();
	for (let i = 0; i < sortedA.length; i++) {
		if (sortedA[i] !== sortedB[i]) {
			return false;
		}
	}
	return true;
}

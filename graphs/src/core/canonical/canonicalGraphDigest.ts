/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';

export interface StructuralDigestPayload {
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	readonly entryNodeId: string | null;
}

export function computeCanonicalGraphDigest(payload: StructuralDigestPayload): string {
	const normalizedNodes = [...payload.nodes]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map(node => ({
			id: node.id,
			kind: node.kind,
			label: node.label,
			path: node.path ? normalizeDigestPath(node.path) : undefined,
			parentId: node.parentId,
			isEntry: !!node.isEntry,
			meta: node.meta ? {
				architectureLayer: node.meta.architectureLayer,
				language: node.meta.language,
				isComponent: node.meta.isComponent,
				isMetadata: node.meta.isMetadata,
				imports: node.meta.imports ? [...node.meta.imports].sort() : undefined,
				exports: node.meta.exports ? [...node.meta.exports].sort() : undefined,
			} : undefined
		}));

	const normalizedEdges = [...payload.edges]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map(edge => ({
			id: edge.id,
			source: edge.source,
			target: edge.target,
			kind: edge.kind,
			meta: edge.meta ? {
				importSource: edge.meta.importSource,
				specifiers: edge.meta.specifiers ? [...edge.meta.specifiers].sort() : undefined,
				isDefault: edge.meta.isDefault,
				isDynamic: edge.meta.isDynamic,
			} : undefined
		}));

	const normalizedData = {
		entryNodeId: payload.entryNodeId,
		nodes: normalizedNodes,
		edges: normalizedEdges,
	};

	const json = JSON.stringify(normalizedData);
	return createHash('sha256').update(json, 'utf8').digest('hex');
}

function normalizeDigestPath(rawPath: string): string {
	return rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

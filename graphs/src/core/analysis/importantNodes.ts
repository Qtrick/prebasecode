/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Rank structural hubs for Code Graph / Magnus overview.
 * inspired by Graphify MIT concepts, PreBase reimplementation
 */

import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';
import { computeDegreeStats } from './communities.js';

export interface ImportantNodeHit {
	id: string;
	label: string;
	path?: string;
	degree: number;
	reason: string;
}

function isExcluded(node: GraphNode): boolean {
	// Folders dominate via contains edges; overview hubs should be code units.
	if (node.kind === 'folder' || node.meta?.isMetadata) {return true;}
	const path = (node.path || node.id).toLowerCase();
	return (
		path.includes('node_modules/') ||
		path.includes('/node_modules') ||
		path.startsWith('node_modules') ||
		path.includes('__generated__') ||
		path.includes('/.git/')
	);
}

/** Top-N by undirected import/dependency degree (not contains), excluding folders/metadata/generated. */
export function rankImportantNodes(nodes: GraphNode[], edges: GraphEdge[], limit = 10): ImportantNodeHit[] {
	const max = Math.max(0, Math.min(Math.floor(limit), 100));
	// computeDegreeStats already ignores contains / non-structural kinds.
	const degrees = computeDegreeStats(nodes, edges);
	const ranked = nodes
		.filter((n) => !isExcluded(n))
		.map((n) => {
			const degree = degrees.get(n.id)?.degree ?? 0;
			return {
				id: n.id,
				label: n.label,
				path: n.path,
				degree,
				reason: `import/dependency degree ${degree}`,
			} satisfies ImportantNodeHit;
		})
		.sort((a, b) => {
			if (b.degree !== a.degree) {return b.degree - a.degree;}
			return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
		});
	return ranked.slice(0, max);
}

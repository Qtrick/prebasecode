/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { NetworkLayoutLink, NetworkLayoutNode, NetworkLayoutRuntimeConfig, Point3D } from './types.js';
import { centerPositions, fibonacciShell, relaxLinksTowardDistance } from './networkNormalization.js';

export function layoutConstellation(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	config: NetworkLayoutRuntimeConfig
): Map<string, Point3D> {
	const positions = fibonacciShell(nodes, config.sphereRadius, (node, i) =>
		0.35 + 0.45 * (((node.id.charCodeAt(0) + i * 7) % 97) / 97)
	);
	// Light link pull only — heavy relax was crushing Z into a flat sheet.
	relaxLinksTowardDistance(positions, links, config.linkDistance, 6, config.forceStrength * 0.06);
	centerPositions(positions);
	return positions;
}

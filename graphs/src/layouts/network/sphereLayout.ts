/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { NetworkLayoutLink, NetworkLayoutNode, NetworkLayoutRuntimeConfig, Point3D } from './types.js';
import { centerPositions, fibonacciShell, minimumShellRadius, relaxLinksTowardDistance } from './networkNormalization.js';

/** Tight geometric shell — minimal relaxation preserves the sphere silhouette. */
export function layoutSphere(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	config: NetworkLayoutRuntimeConfig
): Map<string, Point3D> {
	const shellRadius = Math.max(config.sphereRadius * 0.58, minimumShellRadius(nodes.length, config.collisionRadius * 2));
	const positions = fibonacciShell(nodes, shellRadius, () => 1);
	relaxLinksTowardDistance(positions, links, config.linkDistance, 2, config.forceStrength * 0.012);
	centerPositions(positions);
	return positions;
}

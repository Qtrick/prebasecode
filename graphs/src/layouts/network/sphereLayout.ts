/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { NetworkLayoutLink, NetworkLayoutNode, Point3D } from './types.js'
import { centerPositions, fibonacciShell, relaxLinks } from './networkNormalization.js'

/** Tight geometric shell — minimal relaxation preserves the sphere silhouette. */
export function layoutSphere(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	sphereRadius: number
): Map<string, Point3D> {
	const positions = fibonacciShell(nodes, sphereRadius, () => 0.58)
	relaxLinks(positions, links, sphereRadius * 0.94, 2, 0.008)
	centerPositions(positions)
	return positions
}

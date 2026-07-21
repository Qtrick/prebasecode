/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { NetworkLayoutLink, NetworkLayoutNode, Point3D } from './types.js'
import { centerPositions, fibonacciShell, relaxLinks } from './networkNormalization.js'

export function layoutConstellation(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	sphereRadius: number
): Map<string, Point3D> {
	const positions = fibonacciShell(nodes, sphereRadius, (node, i) =>
		0.35 + 0.45 * (((node.id.charCodeAt(0) + i * 7) % 97) / 97)
	)
	// Light link pull only — heavy relax was crushing Z into a flat sheet.
	relaxLinks(positions, links, sphereRadius, 6, 0.02)
	centerPositions(positions)
	return positions
}

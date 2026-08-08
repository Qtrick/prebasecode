/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type {
	NetworkLayoutLink,
	NetworkLayoutMode,
	NetworkLayoutNode,
	Point3D,
} from './types.js'

import type { NetworkLayoutLink, NetworkLayoutMode, NetworkLayoutNode, Point3D } from './types.js'
import { layoutClustered } from './clusteredLayout.js'
import { layoutConstellation } from './constellationLayout.js'
import { layoutOrganic } from './organicLayout.js'
import { layoutRadial } from './radialLayout.js'
import { layoutSphere } from './sphereLayout.js'

export function computeNetworkSphereRadius(nodeCount: number, spreadScale: number): number {
	return Math.max(220, Math.min(420, Math.sqrt(Math.max(1, nodeCount)) * 26)) * spreadScale;
}

export function layoutNetworkGraph(
	mode: NetworkLayoutMode,
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	sphereRadius = 240
): Map<string, Point3D> {
	switch (mode) {
		case 'sphere':
			return layoutSphere(nodes, links, sphereRadius)
		case 'constellation':
			return layoutConstellation(nodes, links, sphereRadius)
		case 'clustered':
			return layoutClustered(nodes, links, sphereRadius)
		case 'radial':
			return layoutRadial(nodes, links, sphereRadius)
		case 'organic':
		default:
			return layoutOrganic(nodes, links, sphereRadius)
	}
}

export const NETWORK_LAYOUT_OPTIONS: {
	id: NetworkLayoutMode
	label: string
	blurb: string
}[] = [
	{
		id: 'organic',
		label: 'Organic',
		blurb: 'Balanced natural cloud — default startup arrangement.'
	},
	{
		id: 'sphere',
		label: 'Sphere',
		blurb: 'Tight even 3D shell with minimal link pull.'
	},
	{
		id: 'constellation',
		label: 'Constellation',
		blurb: 'Connected files pull closer in 3D space.'
	},
	{
		id: 'clustered',
		label: 'Clustered',
		blurb: 'Groups by file type in separate 3D clusters.'
	},
	{
		id: 'radial',
		label: 'Radial',
		blurb: 'Important files near center, others outward.'
	}
]

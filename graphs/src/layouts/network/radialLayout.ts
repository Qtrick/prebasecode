/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { NetworkLayoutLink, NetworkLayoutNode, Point3D } from './types.js';
import { GOLDEN_ANGLE, centerPositions, clampToSphere, relaxLinks } from './networkNormalization.js';

export function layoutRadial(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	sphereRadius: number
): Map<string, Point3D> {
	const sorted = [...nodes].sort((a, b) => (b.val ?? 0) - (a.val ?? 0));
	const positions = new Map<string, Point3D>();
	const n = sorted.length;
	if (n === 0) {return positions;}
	const denom = Math.max(1, n - 1);

	for (let i = 0; i < n; i++) {
		const node = sorted[i];
		const t = (i + 0.5) / n;
		const y = 1 - 2 * t;
		const ring = Math.sqrt(Math.max(0, 1 - y * y));
		const theta = GOLDEN_ANGLE * i * 1.07;
		const radial = sphereRadius * (0.22 + 0.78 * Math.pow(i / denom, 0.65));
		positions.set(
			node.id,
			clampToSphere(
				{
					x: Math.cos(theta) * ring * radial,
					y: y * radial * 0.85,
					z: Math.sin(theta) * ring * radial
				},
				sphereRadius
			)
		);
	}

	relaxLinks(positions, links, sphereRadius, 6, 0.03);
	centerPositions(positions);
	return positions;
}

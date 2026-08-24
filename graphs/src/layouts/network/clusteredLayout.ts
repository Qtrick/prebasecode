/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { NetworkLayoutLink, NetworkLayoutNode, NetworkLayoutRuntimeConfig, Point3D } from './types.js';
import { GOLDEN_ANGLE, centerPositions, clampToSphere, relaxLinksTowardDistance } from './networkNormalization.js';
import { classifyNodeLayer } from '../../core/analysis/architectureLayers.js';

export function getSoftwareArchitectureClusterKey(node: NetworkLayoutNode): string {
	if (node.isEntry) {
		return 'entry';
	}
	if (node.architectureLayer && node.architectureLayer !== 'other') {
		return node.architectureLayer;
	}
	const p = node.path || (node.id.startsWith('file:') ? node.id.slice(5) : node.id);
	const layer = classifyNodeLayer(p, node.isEntry);
	if (layer && layer !== 'other') {
		return layer;
	}

	if (p) {
		const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
		const parts = norm.split('/').filter(Boolean);
		if (parts.length > 1) {
			const root = parts[0];
			if (root === 'src' && parts.length > 2) {
				return parts[1]; // e.g. components, services, lib, stores, app
			}
			return root; // e.g. apps, packages, scripts, src-tauri
		}
	}

	return node.fileTypeId || 'other';
}

export function layoutClustered(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	config: NetworkLayoutRuntimeConfig
): Map<string, Point3D> {
	const sphereRadius = config.sphereRadius;
	const groups = new Map<string, NetworkLayoutNode[]>();

	for (const node of nodes) {
		const key = getSoftwareArchitectureClusterKey(node);
		const list = groups.get(key) ?? [];
		list.push(node);
		groups.set(key, list);
	}

	// Sort cluster keys deterministically by size and key name
	const clusterKeys = [...groups.keys()].sort((a, b) => {
		const sa = groups.get(a)?.length ?? 0;
		const sb = groups.get(b)?.length ?? 0;
		return sb - sa || a.localeCompare(b);
	});

	const positions = new Map<string, Point3D>();
	const clusterRadius = sphereRadius * 0.72;

	clusterKeys.forEach((key, ci) => {
		const members = groups.get(key) ?? [];
		const t = (ci + 0.5) / Math.max(1, clusterKeys.length);
		const cy = 1 - 2 * t;
		const ring = Math.sqrt(Math.max(0, 1 - cy * cy));
		const theta = GOLDEN_ANGLE * ci;
		const cx = Math.cos(theta) * ring * clusterRadius;
		const cz = Math.sin(theta) * ring * clusterRadius;
		const localR = Math.min(sphereRadius * 0.32, 48 + members.length * 5);

		members.forEach((node, mi) => {
			const lt = (mi + 0.5) / Math.max(1, members.length);
			const ly = 1 - 2 * lt;
			const lring = Math.sqrt(Math.max(0, 1 - ly * ly));
			const ltheta = GOLDEN_ANGLE * mi;
			positions.set(
				node.id,
				clampToSphere(
					{
						x: cx + Math.cos(ltheta) * lring * localR,
						y: cy * clusterRadius * 0.35 + ly * localR * 0.55,
						z: cz + Math.sin(ltheta) * lring * localR,
					},
					sphereRadius
				)
			);
		});
	});

	relaxLinksTowardDistance(positions, links, config.linkDistance, 8, config.forceStrength * 0.09);
	centerPositions(positions);
	return positions;
}

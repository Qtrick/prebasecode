/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { NetworkLayoutLink, NetworkLayoutNode, NetworkLayoutRuntimeConfig, Point3D } from './types.js';
import { GOLDEN_ANGLE, minimumPairDistance3D, minimumShellRadius, relaxLinksTowardDistance, resolveCollisions3D } from './networkNormalization.js';

interface RadialComponent {
	root: NetworkLayoutNode;
	nodesByDepth: Map<number, NetworkLayoutNode[]>;
	size: number;
}

function compareImportance(a: NetworkLayoutNode, b: NetworkLayoutNode, degree: ReadonlyMap<string, number>): number {
	if (a.isEntry !== b.isEntry) {
		return a.isEntry ? -1 : 1;
	}
	const valueDifference = (b.val ?? 0) - (a.val ?? 0);
	if (valueDifference !== 0) {
		return valueDifference;
	}
	const degreeDifference = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
	return degreeDifference || a.id.localeCompare(b.id);
}

function unitShellPoint(index: number, total: number, phase: number): Point3D {
	const t = (index + 0.5) / Math.max(1, total);
	// A single-node BFS layer still needs deterministic depth; otherwise chains
	// collapse into a planar spoke despite being structurally radial.
	const y = total === 1 ? Math.sin(phase * 1.71) * 0.46 : 1 - 2 * t;
	const ring = Math.sqrt(Math.max(0, 1 - y * y));
	const theta = GOLDEN_ANGLE * index + phase;
	return { x: Math.cos(theta) * ring, y, z: Math.sin(theta) * ring };
}

/**
 * Structure-first network layout. A deterministic entry/importance root remains
 * at the origin; undirected breadth-first distance becomes explicit 3D shells.
 * Disconnected components are placed in stable outer sectors instead of being
 * mixed into the main component's final layer.
 */
export function layoutRadial(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	config: NetworkLayoutRuntimeConfig
): Map<string, Point3D> {
	const positions = new Map<string, Point3D>();
	if (nodes.length === 0) {
		return positions;
	}

	const byId = new Map(nodes.map(node => [node.id, node]));
	const adjacency = new Map<string, string[]>();
	const degree = new Map<string, number>();
	for (const node of nodes) {
		adjacency.set(node.id, []);
		degree.set(node.id, 0);
	}
	for (const link of links) {
		if (!byId.has(link.source) || !byId.has(link.target) || link.source === link.target) {
			continue;
		}
		adjacency.get(link.source)!.push(link.target);
		adjacency.get(link.target)!.push(link.source);
		degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
		degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
	}
	for (const neighbours of adjacency.values()) {
		neighbours.sort();
	}

	const orderedNodes = [...nodes].sort((a, b) => compareImportance(a, b, degree));
	const globalRoot = orderedNodes[0];
	const visited = new Set<string>();
	const components: RadialComponent[] = [];

	for (const seed of orderedNodes) {
		if (visited.has(seed.id)) {
			continue;
		}
		const members: NetworkLayoutNode[] = [];
		const queue = [seed.id];
		visited.add(seed.id);
		for (let cursor = 0; cursor < queue.length; cursor++) {
			const id = queue[cursor];
			members.push(byId.get(id)!);
			for (const neighbour of adjacency.get(id) ?? []) {
				if (!visited.has(neighbour)) {
					visited.add(neighbour);
					queue.push(neighbour);
				}
			}
		}
		const root = members.some(node => node.id === globalRoot.id)
			? globalRoot
			: [...members].sort((a, b) => compareImportance(a, b, degree))[0];
		const depths = new Map<string, number>([[root.id, 0]]);
		const bfs = [root.id];
		for (let cursor = 0; cursor < bfs.length; cursor++) {
			const id = bfs[cursor];
			const depth = depths.get(id)!;
			for (const neighbour of adjacency.get(id) ?? []) {
				if (!depths.has(neighbour)) {
					depths.set(neighbour, depth + 1);
					bfs.push(neighbour);
				}
			}
		}
		const nodesByDepth = new Map<number, NetworkLayoutNode[]>();
		for (const member of members) {
			const depth = depths.get(member.id) ?? 0;
			const layer = nodesByDepth.get(depth) ?? [];
			layer.push(member);
			nodesByDepth.set(depth, layer);
		}
		for (const layer of nodesByDepth.values()) {
			layer.sort((a, b) => a.id.localeCompare(b.id));
		}
		components.push({ root, nodesByDepth, size: members.length });
	}

	components.sort((a, b) => (a.root.id === globalRoot.id ? -1 : b.root.id === globalRoot.id ? 1 : b.size - a.size || a.root.id.localeCompare(b.root.id)));
	const mainComponent = components[0];
	const mainDepth = Math.max(...mainComponent.nodesByDepth.keys());
	const minimumDistance = config.collisionRadius * 2;
	const layerSpacing = Math.max(config.linkDistance, minimumDistance * 1.35);

	for (const [depth, layer] of mainComponent.nodesByDepth) {
		if (depth === 0) {
			positions.set(globalRoot.id, { x: 0, y: 0, z: 0 });
			continue;
		}
		const shellRadius = Math.max(depth * layerSpacing, minimumShellRadius(layer.length, minimumDistance));
		for (let index = 0; index < layer.length; index++) {
			const direction = unitShellPoint(index, layer.length, depth * 0.43);
			positions.set(layer[index].id, {
				x: direction.x * shellRadius,
				y: direction.y * shellRadius,
				z: direction.z * shellRadius,
			});
		}
	}

	const disconnectedComponents = components.slice(1);
	const disconnectedNodeCount = disconnectedComponents.reduce((total, component) => total + component.size, 0);
	// Components share a bounded outer shell. Serial global shells make a graph
	// with many isolated files enormous and shrink the meaningful component to a dot.
	const disconnectedShellRadius = Math.max(
		(mainDepth + 3) * layerSpacing,
		minimumShellRadius(disconnectedNodeCount, minimumDistance * 2),
	);
	for (let componentIndex = 0; componentIndex < disconnectedComponents.length; componentIndex++) {
		const component = disconnectedComponents[componentIndex];
		const componentDirection = unitShellPoint(componentIndex, disconnectedComponents.length, GOLDEN_ANGLE);
		const center = {
			x: componentDirection.x * disconnectedShellRadius,
			y: componentDirection.y * disconnectedShellRadius,
			z: componentDirection.z * disconnectedShellRadius,
		};
		for (const [depth, layer] of component.nodesByDepth) {
			const localRadius = depth === 0 ? 0 : Math.max(depth * layerSpacing, minimumShellRadius(layer.length, minimumDistance));
			for (let index = 0; index < layer.length; index++) {
				const direction = unitShellPoint(index, layer.length, GOLDEN_ANGLE * (componentIndex + 1) + depth * 0.43);
				positions.set(layer[index].id, {
					x: center.x + direction.x * localRadius,
					y: center.y + direction.y * localRadius,
					z: center.z + direction.z * localRadius,
				});
			}
		}
	}

	const pinnedIds = new Set([globalRoot.id]);
	// A small bounded spring reduces very long cross-links while preserving BFS shells.
	relaxLinksTowardDistance(positions, links, config.linkDistance, 2, config.forceStrength * 0.018, pinnedIds);
	resolveCollisions3D(positions, minimumDistance, 10, pinnedIds);
	// The pairwise resolver is deliberately bounded. If a very dense shell still
	// needs room, expand the whole radial structure rather than violate spacing.
	const actualMinimum = minimumPairDistance3D(positions);
	if (actualMinimum < minimumDistance && actualMinimum > 0) {
		const scale = minimumDistance / actualMinimum;
		for (const [id, position] of positions) {
			if (!pinnedIds.has(id)) {
				positions.set(id, { x: position.x * scale, y: position.y * scale, z: position.z * scale });
			}
		}
	}
	return positions;
}

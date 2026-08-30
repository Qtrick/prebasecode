/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { NetworkLayoutLink, NetworkLayoutNode, NetworkLayoutRuntimeConfig, Point3D } from './types.js';
import { relaxLinksTowardDistance, resolveCollisions3D } from './networkNormalization.js';

/** Bumped with Radial geometry semantics; callers may invalidate caches alongside GRAPH_LAYOUT_VERSION. */
export const RADIAL_LAYOUT_VERSION = 3;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

interface RadialComponent {
	root: NetworkLayoutNode;
	nodesByDepth: Map<number, NetworkLayoutNode[]>;
	parentOf: Map<string, string>;
	members: NetworkLayoutNode[];
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

/** Place a BFS layer across one or more concentric rings so dense layers stay compact. */
function placeLayerOnConcentricRings(
	layer: NetworkLayoutNode[],
	depth: number,
	minimumDistance: number,
	layerSpacing: number,
	angleOf: Map<string, number>,
	parentOf: ReadonlyMap<string, string>,
	target: Map<string, Point3D>,
): number {
	if (layer.length === 0) {
		return 0;
	}
	const depthRadius = layerSpacing * (depth + 0.35 * Math.sqrt(Math.max(0, depth - 1)));
	let ringR = Math.max(depthRadius, minimumDistance * 0.9);
	let index = 0;
	let maxR = 0;
	while (index < layer.length) {
		const capacity = Math.max(8, Math.floor((2 * Math.PI * ringR) / (minimumDistance * 0.88)));
		const batch = layer.slice(index, index + capacity);
		for (let i = 0; i < batch.length; i++) {
			const node = batch[i];
			const parentId = parentOf.get(node.id);
			const parentAngle = parentId !== undefined ? (angleOf.get(parentId) ?? 0) : 0;
			const even = ((index + i) / Math.max(1, layer.length)) * Math.PI * 2 + depth * 0.11;
			const local = (i / Math.max(1, batch.length)) * Math.PI * 2;
			const angle = batch.length === 1 ? parentAngle : local * 0.7 + even * 0.15 + parentAngle * 0.15;
			angleOf.set(node.id, angle);
			const z = Math.sin(angle * 1.7 + depth) * Math.min(layerSpacing * 0.18, 14);
			target.set(node.id, {
				x: Math.cos(angle) * ringR,
				y: Math.sin(angle) * ringR,
				z,
			});
			maxR = Math.max(maxR, ringR);
		}
		index += batch.length;
		ringR += minimumDistance * 0.88;
	}
	return maxR;
}

function layoutComponentLocally(
	component: RadialComponent,
	minimumDistance: number,
	layerSpacing: number,
): { locals: Map<string, Point3D>; radius: number } {
	const locals = new Map<string, Point3D>();
	const angleOf = new Map<string, number>();
	let localExtent = 0;
	for (const [depth, layer] of [...component.nodesByDepth.entries()].sort((a, b) => a[0] - b[0])) {
		if (depth === 0) {
			locals.set(component.root.id, { x: 0, y: 0, z: 0 });
			angleOf.set(component.root.id, 0);
			continue;
		}
		localExtent = Math.max(localExtent, placeLayerOnConcentricRings(
			layer,
			depth,
			minimumDistance,
			layerSpacing * 0.85,
			angleOf,
			component.parentOf,
			locals,
		));
	}
	if (component.size > 1) {
		resolveCollisions3D(locals, minimumDistance * 0.95, 4, new Set([component.root.id]));
		for (const p of locals.values()) {
			localExtent = Math.max(localExtent, Math.hypot(p.x, p.y));
		}
	}
	const pad = Math.max(minimumDistance * 0.5, 10);
	return { locals, radius: localExtent + pad };
}

/**
 * Structure-first Radial layout: concentric BFS rings for the main component,
 * individually laid-out disconnected components packed in a bounded outer band.
 *
 * Collision resolution is LOCAL (per component). There is no global scale pass.
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
		const parentOf = new Map<string, string>();
		for (let cursor = 0; cursor < bfs.length; cursor++) {
			const id = bfs[cursor];
			const depth = depths.get(id)!;
			for (const neighbour of adjacency.get(id) ?? []) {
				if (!depths.has(neighbour)) {
					depths.set(neighbour, depth + 1);
					parentOf.set(neighbour, id);
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
		for (const [depth, layer] of nodesByDepth) {
			if (depth === 0) {
				layer.sort((a, b) => a.id.localeCompare(b.id));
				continue;
			}
			layer.sort((a, b) => {
				const pa = parentOf.get(a.id) ?? '';
				const pb = parentOf.get(b.id) ?? '';
				return pa.localeCompare(pb) || a.id.localeCompare(b.id);
			});
		}
		components.push({ root, nodesByDepth, parentOf, members, size: members.length });
	}

	components.sort((a, b) => (a.root.id === globalRoot.id ? -1 : b.root.id === globalRoot.id ? 1 : b.size - a.size || a.root.id.localeCompare(b.root.id)));
	const mainComponent = components[0];
	const minimumDistance = config.collisionRadius * 2;
	const layerSpacing = Math.max(config.linkDistance, minimumDistance * 1.15);

	const angleOf = new Map<string, number>();
	let mainExtent = 0;
	const mainLocals = new Map<string, Point3D>();

	for (const [depth, layer] of [...mainComponent.nodesByDepth.entries()].sort((a, b) => a[0] - b[0])) {
		if (depth === 0) {
			mainLocals.set(globalRoot.id, { x: 0, y: 0, z: 0 });
			angleOf.set(globalRoot.id, 0);
			continue;
		}
		const layerMax = placeLayerOnConcentricRings(
			layer,
			depth,
			minimumDistance,
			layerSpacing,
			angleOf,
			mainComponent.parentOf,
			mainLocals,
		);
		mainExtent = Math.max(mainExtent, layerMax);
	}

	const pinnedIds = new Set([globalRoot.id]);
	const mainIds = new Set(mainComponent.members.map(m => m.id));
	// Collision + mild link polish BEFORE packing disconnected comps so main never expands into them.
	resolveCollisions3D(mainLocals, minimumDistance * 0.95, 4, pinnedIds);
	for (const [id, p] of mainLocals) {
		positions.set(id, { ...p });
	}
	const mainLinks = links.filter(l => mainIds.has(l.source) && mainIds.has(l.target));
	relaxLinksTowardDistance(positions, mainLinks, config.linkDistance, 2, config.forceStrength * 0.012, pinnedIds);
	const mainOnly = new Map<string, Point3D>();
	for (const id of mainIds) {
		const p = positions.get(id);
		if (p) {
			mainOnly.set(id, { ...p });
		}
	}
	resolveCollisions3D(mainOnly, minimumDistance * 0.95, 3, pinnedIds);
	mainExtent = 0;
	for (const [id, p] of mainOnly) {
		positions.set(id, p);
		mainExtent = Math.max(mainExtent, Math.hypot(p.x, p.y));
	}

	const disconnected = components.slice(1);
	const isolates: NetworkLayoutNode[] = [];
	const multiPacked: Array<{ locals: Map<string, Point3D>; radius: number }> = [];
	for (const component of disconnected) {
		if (component.size === 1) {
			isolates.push(component.root);
		} else {
			multiPacked.push(layoutComponentLocally(component, minimumDistance, layerSpacing));
		}
	}
	isolates.sort((a, b) => a.id.localeCompare(b.id));

	// Multi-node disconnected components: compact arc packing just outside the main rings.
	const gap = Math.max(minimumDistance * 0.55, 10);
	let multiRing = mainExtent + gap + (multiPacked[0]?.radius ?? 0);
	let multiAngle = 0;
	for (let i = 0; i < multiPacked.length; i++) {
		const { locals, radius } = multiPacked[i];
		const stepAngle = Math.max(
			(radius * 2 + gap) / Math.max(multiRing, 1),
			(2 * Math.PI) / Math.max(10, multiPacked.length * 1.2),
		);
		if (multiAngle + stepAngle > Math.PI * 2 && i > 0) {
			multiRing += gap + radius * 0.85;
			multiAngle = 0;
		}
		const angle = multiAngle + i * 0.02;
		multiAngle += stepAngle;
		const cx = Math.cos(angle) * multiRing;
		const cy = Math.sin(angle) * multiRing;
		const cz = Math.sin(angle * 1.9) * Math.min(8, gap * 0.2);
		for (const [id, local] of locals) {
			positions.set(id, { x: cx + local.x, y: cy + local.y, z: cz + local.z });
		}
	}

	// Isolates: compact sunflower lobes beside the main component — NOT distant full outer shells.
	// Two side lobes keep Fit bounds dominated by the readable radial core.
	const isoSep = minimumDistance * 0.92;
	const lobeCount = Math.max(1, Math.min(3, Math.ceil(isolates.length / 56)));
	const perLobe = Math.ceil(isolates.length / lobeCount);
	const baseClearance = Math.max(
		mainExtent,
		multiPacked.length > 0 ? multiRing : mainExtent,
	) + gap;
	for (let lobe = 0; lobe < lobeCount; lobe++) {
		const slice = isolates.slice(lobe * perLobe, (lobe + 1) * perLobe);
		if (slice.length === 0) {
			continue;
		}
		const lobeRadius = Math.sqrt(slice.length) * isoSep * 0.72;
		const lobeAngle = Math.PI * (0.5 + lobe / Math.max(1, lobeCount - 0.5));
		const cx = Math.cos(lobeAngle) * (baseClearance + lobeRadius * 0.35);
		const cy = Math.sin(lobeAngle) * (baseClearance + lobeRadius * 0.35);
		for (let i = 0; i < slice.length; i++) {
			const r = Math.sqrt(i + 0.5) * isoSep * 0.72;
			const angle = i * GOLDEN_ANGLE;
			positions.set(slice[i].id, {
				x: cx + Math.cos(angle) * r,
				y: cy + Math.sin(angle) * r,
				z: Math.sin(angle * 1.7 + lobe) * Math.min(6, isoSep * 0.12),
			});
		}
	}

	return positions;
}

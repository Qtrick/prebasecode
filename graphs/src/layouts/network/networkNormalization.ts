/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { NetworkLayoutLink, NetworkLayoutNode, Point3D } from './types.js';

export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function hash01(id: string, salt = 0): number {
	let h = salt;
	for (let i = 0; i < id.length; i++) {h = (h * 31 + id.charCodeAt(i)) | 0;}
	return ((h >>> 0) % 1000) / 1000;
}

export function clampToSphere(p: Point3D, maxRadius: number): Point3D {
	const d = Math.hypot(p.x, p.y, p.z);
	if (d <= maxRadius || d === 0) {return p;}
	const k = maxRadius / d;
	return { x: p.x * k, y: p.y * k, z: p.z * k };
}

/** Conservative shell radius needed for evenly distributed points at a given separation. */
export function minimumShellRadius(nodeCount: number, minimumDistance: number): number {
	if (nodeCount <= 1) {
		return 0;
	}
	return minimumDistance * Math.sqrt(nodeCount / (4 * Math.PI)) * 1.28;
}

export function centerPositions(positions: Map<string, Point3D>): void {
	let sx = 0;
	let sy = 0;
	let sz = 0;
	const n = positions.size;
	if (!n) {return;}
	for (const p of positions.values()) {
		sx += p.x;
		sy += p.y;
		sz += p.z;
	}
	const inv = 1 / n;
	sx *= inv;
	sy *= inv;
	sz *= inv;
	for (const [id, p] of positions) {
		positions.set(id, { x: p.x - sx, y: p.y - sy, z: p.z - sz });
	}
}

/**
 * Bounded spring relaxation. Unlike the former pure attraction pass, this uses a
 * preferred length and pushes links apart when they are shorter than that length.
 */
export function relaxLinksTowardDistance(
	positions: Map<string, Point3D>,
	links: NetworkLayoutLink[],
	linkDistance: number,
	passes: number,
	strength: number,
	pinnedIds: ReadonlySet<string> = new Set<string>()
): void {
	for (let pass = 0; pass < passes; pass++) {
		for (const link of links) {
			const s = positions.get(link.source);
			const t = positions.get(link.target);
			if (!s || !t) {continue;}
			let dx = t.x - s.x;
			let dy = t.y - s.y;
			let dz = t.z - s.z;
			let distance = Math.hypot(dx, dy, dz);
			if (distance < 1e-6) {
				const angle = hash01(`${link.source}|${link.target}`, pass) * Math.PI * 2;
				dx = Math.cos(angle);
				dy = Math.sin(angle);
				dz = hash01(`${link.target}|${link.source}`, pass) - 0.5;
				distance = Math.hypot(dx, dy, dz);
			}
			const amount = ((distance - linkDistance) / distance) * strength;
			const sourcePinned = pinnedIds.has(link.source);
			const targetPinned = pinnedIds.has(link.target);
			const sourceShare = sourcePinned ? 0 : targetPinned ? 1 : 0.5;
			const targetShare = targetPinned ? 0 : sourcePinned ? 1 : 0.5;
			s.x += dx * amount * sourceShare;
			s.y += dy * amount * sourceShare;
			s.z += dz * amount * sourceShare;
			t.x -= dx * amount * targetShare;
			t.y -= dy * amount * targetShare;
			t.z -= dz * amount * targetShare;
		}
	}
}

/**
 * Deterministic, bounded 3D separation pass. It deliberately does not clamp to
 * an enclosing sphere: callers must preserve spacing by choosing adequate shell
 * capacity rather than reintroducing overlaps through a final clamp.
 */
export function resolveCollisions3D(
	positions: Map<string, Point3D>,
	minimumDistance: number,
	maximumPasses = 8,
	pinnedIds: ReadonlySet<string> = new Set<string>()
): void {
	const ids = [...positions.keys()].sort();
	for (let pass = 0; pass < maximumPasses; pass++) {
		let adjusted = false;
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const sourceId = ids[i];
				const targetId = ids[j];
				const source = positions.get(sourceId)!;
				const target = positions.get(targetId)!;
				let dx = target.x - source.x;
				let dy = target.y - source.y;
				let dz = target.z - source.z;
				let distance = Math.hypot(dx, dy, dz);
				if (distance >= minimumDistance) {
					continue;
				}
				if (distance < 1e-6) {
					const angle = hash01(`${sourceId}|${targetId}`, pass) * Math.PI * 2;
					dx = Math.cos(angle);
					dy = Math.sin(angle);
					dz = hash01(`${targetId}|${sourceId}`, pass) - 0.5;
					distance = Math.hypot(dx, dy, dz);
				}
				const adjustment = (minimumDistance - distance) / distance;
				const sourcePinned = pinnedIds.has(sourceId);
				const targetPinned = pinnedIds.has(targetId);
				if (sourcePinned && targetPinned) {
					continue;
				}
				const sourceShare = sourcePinned ? 0 : targetPinned ? 1 : 0.5;
				const targetShare = targetPinned ? 0 : sourcePinned ? 1 : 0.5;
				source.x -= dx * adjustment * sourceShare;
				source.y -= dy * adjustment * sourceShare;
				source.z -= dz * adjustment * sourceShare;
				target.x += dx * adjustment * targetShare;
				target.y += dy * adjustment * targetShare;
				target.z += dz * adjustment * targetShare;
				adjusted = true;
			}
		}
		if (!adjusted) {
			return;
		}
	}
}

/** Returns the smallest center-to-center distance in a layout, or infinity for fewer than two nodes. */
export function minimumPairDistance3D(positions: ReadonlyMap<string, Point3D>): number {
	const values = [...positions.values()];
	let minimum = Infinity;
	for (let i = 0; i < values.length; i++) {
		for (let j = i + 1; j < values.length; j++) {
			minimum = Math.min(minimum, Math.hypot(
				values[i].x - values[j].x,
				values[i].y - values[j].y,
				values[i].z - values[j].z,
			));
		}
	}
	return minimum;
}

export function fibonacciShell(
	nodes: NetworkLayoutNode[],
	sphereRadius: number,
	radialFn: (node: NetworkLayoutNode, index: number, total: number) => number
): Map<string, Point3D> {
	const positions = new Map<string, Point3D>();
	const n = nodes.length;
	for (let i = 0; i < n; i++) {
		const node = nodes[i];
		const t = (i + 0.5) / Math.max(1, n);
		const y = 1 - 2 * t;
		const ring = Math.sqrt(Math.max(0, 1 - y * y));
		const theta = GOLDEN_ANGLE * i;
		const radial = sphereRadius * radialFn(node, i, n);
		positions.set(
			node.id,
			clampToSphere(
				{
					x: Math.cos(theta) * ring * radial,
					y: y * radial * 0.92,
					z: Math.sin(theta) * ring * radial
				},
				sphereRadius
			)
		);
	}
	return positions;
}

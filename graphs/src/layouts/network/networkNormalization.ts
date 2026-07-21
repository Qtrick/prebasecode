/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { NetworkLayoutLink, NetworkLayoutNode, Point3D } from './types.js'

export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export function hash01(id: string, salt = 0): number {
	let h = salt
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
	return ((h >>> 0) % 1000) / 1000
}

export function clampToSphere(p: Point3D, maxRadius: number): Point3D {
	const d = Math.hypot(p.x, p.y, p.z)
	if (d <= maxRadius || d === 0) return p
	const k = maxRadius / d
	return { x: p.x * k, y: p.y * k, z: p.z * k }
}

export function centerPositions(positions: Map<string, Point3D>): void {
	let sx = 0
	let sy = 0
	let sz = 0
	const n = positions.size
	if (!n) return
	for (const p of positions.values()) {
		sx += p.x
		sy += p.y
		sz += p.z
	}
	const inv = 1 / n
	sx *= inv
	sy *= inv
	sz *= inv
	for (const [id, p] of positions) {
		positions.set(id, { x: p.x - sx, y: p.y - sy, z: p.z - sz })
	}
}

export function relaxLinks(
	positions: Map<string, Point3D>,
	links: NetworkLayoutLink[],
	sphereRadius: number,
	passes: number,
	pull: number
): void {
	for (let pass = 0; pass < passes; pass++) {
		for (const link of links) {
			const s = positions.get(link.source)
			const t = positions.get(link.target)
			if (!s || !t) continue
			const dx = t.x - s.x
			const dy = t.y - s.y
			const dz = t.z - s.z
			s.x += dx * pull
			s.y += dy * pull
			s.z += dz * pull
			t.x -= dx * pull
			t.y -= dy * pull
			t.z -= dz * pull
			positions.set(link.source, clampToSphere(s, sphereRadius))
			positions.set(link.target, clampToSphere(t, sphereRadius))
		}
	}
}

export function fibonacciShell(
	nodes: NetworkLayoutNode[],
	sphereRadius: number,
	radialFn: (node: NetworkLayoutNode, index: number, total: number) => number
): Map<string, Point3D> {
	const positions = new Map<string, Point3D>()
	const n = nodes.length
	for (let i = 0; i < n; i++) {
		const node = nodes[i]
		const t = (i + 0.5) / Math.max(1, n)
		const y = 1 - 2 * t
		const ring = Math.sqrt(Math.max(0, 1 - y * y))
		const theta = GOLDEN_ANGLE * i
		const radial = sphereRadius * radialFn(node, i, n)
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
		)
	}
	return positions
}

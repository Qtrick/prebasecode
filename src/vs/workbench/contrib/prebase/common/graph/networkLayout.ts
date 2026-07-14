/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Ported from PreBase V1.1 network-layout for the VS Code fork.
 *--------------------------------------------------------------------------------------------*/

export interface NetworkLayoutNode {
	id: string;
	fileTypeId?: string;
	val?: number;
	isEntry?: boolean;
}

export interface NetworkLayoutLink {
	source: string;
	target: string;
}

export type NetworkLayoutMode =
	| 'organic'
	| 'sphere'
	| 'constellation'
	| 'clustered'
	| 'radial'

export interface Point3D {
	x: number
	y: number
	z: number
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

function hash01(id: string, salt = 0): number {
	let h = salt
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
	return ((h >>> 0) % 1000) / 1000
}

function clampToSphere(p: Point3D, maxRadius: number): Point3D {
	const d = Math.hypot(p.x, p.y, p.z)
	if (d <= maxRadius || d === 0) return p
	const k = maxRadius / d
	return { x: p.x * k, y: p.y * k, z: p.z * k }
}

function centerPositions(positions: Map<string, Point3D>): void {
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

function relaxLinks(
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

function fibonacciShell(
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

/** Balanced cloud — initialize on a 3D shell, then 3D repulsion + link springs. */
function layoutOrganic(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	sphereRadius: number
): Map<string, Point3D> {
	const positions = new Map<string, Point3D>()
	const n = nodes.length
	if (n === 0) return positions

	const degree = new Map<string, number>()
	for (const node of nodes) degree.set(node.id, 0)
	for (const link of links) {
		degree.set(link.source, (degree.get(link.source) ?? 0) + 1)
		degree.set(link.target, (degree.get(link.target) ?? 0) + 1)
	}
	const maxDeg = Math.max(1, ...degree.values())
	const maxR = sphereRadius * 0.88
	const minDist = Math.max(16, sphereRadius / Math.max(8, Math.sqrt(n) * 1.15))
	const linkIdeal = minDist * 2.0

	// Seed from an even 3D distribution so the result cannot collapse to a plane.
	const seed = fibonacciShell(nodes, sphereRadius, (node) => {
		const d = degree.get(node.id) ?? 0
		const hubT = d / maxDeg
		return 0.28 + 0.55 * (1 - hubT) + hash01(node.id, 3) * 0.12
	})
	for (const [id, p] of seed) {
		positions.set(id, { ...p })
	}

	const ids = [...positions.keys()]
	const iterations = Math.min(120, 50 + Math.floor(n * 0.45))

	for (let iter = 0; iter < iterations; iter++) {
		const cooling = 1 - iter / iterations

		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const a = positions.get(ids[i])!
				const b = positions.get(ids[j])!
				let dx = b.x - a.x
				let dy = b.y - a.y
				let dz = b.z - a.z
				let dist = Math.hypot(dx, dy, dz)
				if (dist < 0.001) {
					dx = hash01(ids[i], j) - 0.5
					dy = hash01(ids[j], i) - 0.5
					dz = hash01(ids[i], i + j) - 0.5
					dist = 0.15
				}
				if (dist < minDist) {
					const push = ((minDist - dist) / dist) * 0.55 * cooling
					a.x -= dx * push
					a.y -= dy * push
					a.z -= dz * push
					b.x += dx * push
					b.y += dy * push
					b.z += dz * push
				} else if (dist < minDist * 2.4) {
					const push = ((minDist * 2.4 - dist) / dist) * 0.1 * cooling
					a.x -= dx * push
					a.y -= dy * push
					a.z -= dz * push
					b.x += dx * push
					b.y += dy * push
					b.z += dz * push
				}
			}
		}

		for (const link of links) {
			const s = positions.get(link.source)
			const t = positions.get(link.target)
			if (!s || !t) continue
			const dx = t.x - s.x
			const dy = t.y - s.y
			const dz = t.z - s.z
			const dist = Math.hypot(dx, dy, dz) || 0.001
			const pull = ((dist - linkIdeal) / dist) * 0.05 * cooling
			s.x += dx * pull
			s.y += dy * pull
			s.z += dz * pull
			t.x -= dx * pull
			t.y -= dy * pull
			t.z -= dz * pull
		}

		for (const [id, p] of positions) {
			positions.set(id, clampToSphere(p, maxR))
		}
	}

	centerPositions(positions)

	let maxDist = 0
	for (const p of positions.values()) {
		maxDist = Math.max(maxDist, Math.hypot(p.x, p.y, p.z))
	}
	if (maxDist > maxR && maxDist > 0) {
		const scale = maxR / maxDist
		for (const [id, p] of positions) {
			positions.set(id, { x: p.x * scale, y: p.y * scale, z: p.z * scale })
		}
	}

	return positions
}

/** Tight geometric shell — minimal relaxation preserves the sphere silhouette. */
function layoutSphere(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	sphereRadius: number
): Map<string, Point3D> {
	const positions = fibonacciShell(nodes, sphereRadius, () => 0.58)
	relaxLinks(positions, links, sphereRadius * 0.94, 2, 0.008)
	centerPositions(positions)
	return positions
}

function layoutConstellation(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	sphereRadius: number
): Map<string, Point3D> {
	const positions = fibonacciShell(nodes, sphereRadius, (node, i) =>
		0.35 + 0.45 * (((node.id.charCodeAt(0) + i * 7) % 97) / 97)
	)
	relaxLinks(positions, links, sphereRadius, 22, 0.06)
	centerPositions(positions)
	return positions
}

function layoutClustered(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	sphereRadius: number
): Map<string, Point3D> {
	const groups = new Map<string, NetworkLayoutNode[]>()
	for (const node of nodes) {
		const key = node.fileTypeId || 'other'
		const list = groups.get(key) ?? []
		list.push(node)
		groups.set(key, list)
	}

	const clusterKeys = [...groups.keys()]
	const positions = new Map<string, Point3D>()
	const clusterRadius = sphereRadius * 0.72

	clusterKeys.forEach((key, ci) => {
		const members = groups.get(key) ?? []
		const t = (ci + 0.5) / Math.max(1, clusterKeys.length)
		const cy = 1 - 2 * t
		const ring = Math.sqrt(Math.max(0, 1 - cy * cy))
		const theta = GOLDEN_ANGLE * ci
		const cx = Math.cos(theta) * ring * clusterRadius
		const cz = Math.sin(theta) * ring * clusterRadius
		const localR = Math.min(sphereRadius * 0.32, 48 + members.length * 5)

		members.forEach((node, mi) => {
			const lt = (mi + 0.5) / Math.max(1, members.length)
			const ly = 1 - 2 * lt
			const lring = Math.sqrt(Math.max(0, 1 - ly * ly))
			const ltheta = GOLDEN_ANGLE * mi
			positions.set(
				node.id,
				clampToSphere(
					{
						x: cx + Math.cos(ltheta) * lring * localR,
						y: cy * clusterRadius * 0.35 + ly * localR * 0.55,
						z: cz + Math.sin(ltheta) * lring * localR
					},
					sphereRadius
				)
			)
		})
	})

	relaxLinks(positions, links, sphereRadius, 8, 0.035)
	centerPositions(positions)
	return positions
}

function layoutRadial(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	sphereRadius: number
): Map<string, Point3D> {
	const sorted = [...nodes].sort((a, b) => (b.val ?? 0) - (a.val ?? 0))
	const positions = new Map<string, Point3D>()
	const n = sorted.length
	if (n === 0) return positions
	const denom = Math.max(1, n - 1)

	for (let i = 0; i < n; i++) {
		const node = sorted[i]
		const t = (i + 0.5) / n
		const y = 1 - 2 * t
		const ring = Math.sqrt(Math.max(0, 1 - y * y))
		const theta = GOLDEN_ANGLE * i * 1.07
		const radial = sphereRadius * (0.22 + 0.78 * Math.pow(i / denom, 0.65))
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
		)
	}

	relaxLinks(positions, links, sphereRadius, 6, 0.03)
	centerPositions(positions)
	return positions
}

export function computeNetworkSphereRadius(nodeCount: number, spreadScale: number): number {
	return Math.max(190, Math.min(310, Math.sqrt(Math.max(1, nodeCount)) * 22)) * spreadScale;
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { NetworkLayoutLink, NetworkLayoutNode, Point3D } from './types.js'
import { centerPositions, clampToSphere, hash01, relaxLinks } from './networkNormalization.js'

/**
 * Community Force — place communities as 3D clusters, members near each centroid.
 * Deterministic (hash jitter only). Falls back to a single community when ids missing.
 */
export function layoutCommunityForce(
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	sphereRadius: number
): Map<string, Point3D> {
	const positions = new Map<string, Point3D>()
	if (nodes.length === 0) {
		return positions
	}

	// Guard bad radius (NaN/≤0) so hash/trig never produce NaN positions.
	const radius = Number.isFinite(sphereRadius) && sphereRadius > 0 ? sphereRadius : 240

	const groups = new Map<number, NetworkLayoutNode[]>()
	const communityById = new Map<string, number>()
	for (const node of nodes) {
		const key = typeof node.communityId === 'number' && Number.isFinite(node.communityId) ? node.communityId : 0
		const list = groups.get(key) ?? []
		list.push(node)
		groups.set(key, list)
		communityById.set(node.id, key)
	}

	// Stable order: community id ascending; members by id.
	const communityKeys = [...groups.keys()].sort((a, b) => a - b)
	for (const key of communityKeys) {
		groups.get(key)!.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
	}

	const nComm = Math.max(1, communityKeys.length)
	const ringR = radius * 0.58

	communityKeys.forEach((cid, ci) => {
		const members = groups.get(cid) ?? []
		// Circle of centroids + small deterministic hash offsets (hex-ish scatter).
		const baseAngle = (2 * Math.PI * ci) / nComm
		const angle = baseAngle + (hash01(`comm:${cid}`, 1) - 0.5) * (Math.PI / Math.max(6, nComm))
		const r = ringR * (0.82 + hash01(`comm:${cid}`, 2) * 0.28)
		const cx = Math.cos(angle) * r
		const cz = Math.sin(angle) * r
		const cy = (hash01(`comm:${cid}`, 3) - 0.5) * radius * 0.32
		const localR = Math.min(radius * 0.28, 36 + Math.sqrt(members.length) * 9)

		for (const node of members) {
			const jx = (hash01(node.id, 11) - 0.5) * localR * 2
			const jy = (hash01(node.id, 12) - 0.5) * localR * 1.4
			const jz = (hash01(node.id, 13) - 0.5) * localR * 2
			positions.set(
				node.id,
				clampToSphere(
					{
						x: cx + jx,
						y: cy + jy,
						z: cz + jz,
					},
					radius
				)
			)
		}
	})

	// Intra-community pull only — cross edges would dissolve the clusters.
	const intraLinks = links.filter((link) => {
		const a = communityById.get(link.source)
		const b = communityById.get(link.target)
		return a !== undefined && a === b
	})
	relaxLinks(positions, intraLinks, radius, 6, 0.028)
	centerPositions(positions)
	return positions
}

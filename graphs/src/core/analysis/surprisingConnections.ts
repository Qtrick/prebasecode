/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cross-community surprising import/dependency edges for Code Graph.
 * inspired by Graphify MIT concepts, PreBase reimplementation
 * (rank by crossEdge surprise — no Graphify source).
 */

import type { EdgeConfidence, GraphEdge, GraphNode } from '../../common/types/graphTypes.js'
import { communityMapFromNodes, computeDegreeStats, STRUCTURAL_EDGE_KINDS } from './communities.js'

export interface SurprisingConnectionHit {
	edgeId: string
	sourceId: string
	targetId: string
	sourceLabel: string
	targetLabel: string
	sourceCommunity: number
	targetCommunity: number
	kind: 'import' | 'dependency'
	confidence: EdgeConfidence | undefined
	/** Higher = more surprising. Deterministic integer. */
	surprise: number
	reason: string
}

function confidenceBonus(confidence: EdgeConfidence | undefined): number {
	if (confidence === 'AMBIGUOUS') {
		return 3
	}
	if (confidence === 'INFERRED') {
		return 2
	}
	return 1
}

function pairKey(a: number, b: number): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`
}

/**
 * Import/dependency edges whose endpoints sit in different communities.
 * Score (crossEdge surprise): confidence + pair rarity + peripheral→hub.
 * One representative edge per community pair (highest surprise, then edgeId).
 * Sort: surprise desc, then edgeId. Top N.
 */
export function findSurprisingConnections(
	nodes: GraphNode[],
	edges: GraphEdge[],
	limit = 10
): SurprisingConnectionHit[] {
	const max = Math.max(0, Math.min(Math.floor(limit), 100))
	if (max === 0 || nodes.length === 0) {
		return []
	}

	const byNode = communityMapFromNodes(nodes, edges)
	const byId = new Map(nodes.map((n) => [n.id, n]))
	const degrees = computeDegreeStats(nodes, edges)

	type Candidate = {
		edge: GraphEdge
		srcC: number
		tgtC: number
		pair: string
	}
	const candidates: Candidate[] = []
	const pairCounts = new Map<string, number>()

	for (const edge of edges) {
		if (!STRUCTURAL_EDGE_KINDS.has(edge.kind)) {
			continue
		}
		const srcC = byNode.get(edge.source)
		const tgtC = byNode.get(edge.target)
		if (srcC === undefined || tgtC === undefined || srcC === tgtC) {
			continue
		}
		const pair = pairKey(srcC, tgtC)
		pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1)
		candidates.push({ edge, srcC, tgtC, pair })
	}

	const scored: SurprisingConnectionHit[] = []
	for (const { edge, srcC, tgtC, pair } of candidates) {
		const source = byId.get(edge.source)
		const target = byId.get(edge.target)
		if (!source || !target) {
			continue
		}
		const conf = edge.meta?.confidence
		const confPart = confidenceBonus(conf) * 10
		const pairCount = pairCounts.get(pair) ?? 1
		// Rarer community-pair cuts score higher; floor keeps dense pairs visible.
		// Cap must sit above floor(100/2)=50 so count=1 outranks count=2.
		const rarityPart = Math.max(5, Math.min(80, Math.floor(100 / pairCount)))
		const degSrc = degrees.get(edge.source)?.degree ?? 0
		const degTgt = degrees.get(edge.target)?.degree ?? 0
		const peripheralPart = Math.min(degSrc, degTgt) <= 2 && Math.max(degSrc, degTgt) >= 5 ? 5 : 0
		const surprise = confPart + rarityPart + peripheralPart

		const reasons: string[] = [
			`cross-community ${srcC}→${tgtC}`,
			`pair rarity ${pairCount} edge(s)`,
		]
		if (conf === 'AMBIGUOUS' || conf === 'INFERRED') {
			reasons.push(`${conf.toLowerCase()} confidence`)
		}
		if (peripheralPart > 0) {
			reasons.push('peripheral↔hub')
		}

		scored.push({
			edgeId: edge.id,
			sourceId: edge.source,
			targetId: edge.target,
			sourceLabel: source.label,
			targetLabel: target.label,
			sourceCommunity: srcC,
			targetCommunity: tgtC,
			kind: edge.kind as 'import' | 'dependency',
			confidence: conf,
			surprise,
			reason: reasons.join('; '),
		})
	}

	scored.sort((a, b) => {
		if (b.surprise !== a.surprise) {
			return b.surprise - a.surprise
		}
		return a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0
	})

	// One hit per unordered community pair so hubs don't dominate top N.
	const seenPairs = new Set<string>()
	const deduped: SurprisingConnectionHit[] = []
	for (const hit of scored) {
		const key = pairKey(hit.sourceCommunity, hit.targetCommunity)
		if (seenPairs.has(key)) {
			continue
		}
		seenPairs.add(key)
		deduped.push(hit)
		if (deduped.length >= max) {
			break
		}
	}
	return deduped
}

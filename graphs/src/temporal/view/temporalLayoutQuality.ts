/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	TemporalLayoutResult,
	TemporalStructuralDiff,
	TemporalLayoutMetrics,
	TemporalRenderEdge,
	TemporalCommunityGuide,
} from './temporalViewTypes.js';

export interface LayoutQualityReport extends TemporalLayoutMetrics {
	readonly totalNodes: number;
	readonly totalEdges: number;
	readonly totalCommunities: number;
	readonly boundingBox: {
		readonly minX: number;
		readonly minY: number;
		readonly maxX: number;
		readonly maxY: number;
		readonly width: number;
		readonly height: number;
	};
}

/**
 * Calculates comprehensive mathematical quality metrics for a temporal graph layout.
 */
export function measureLayoutQuality(
	layout: TemporalLayoutResult,
	diff?: TemporalStructuralDiff,
	viewport?: { width: number; height: number },
	previousPositions?: ReadonlyMap<string, { x: number; y: number }>,
): LayoutQualityReport {
	const nodes = layout.nodes.filter(n => n.changeKind !== 'removed');
	const totalNodes = nodes.length;

	if (totalNodes === 0) {
		return {
			nodeOverlapCount: 0,
			minNodeSpacing: 0,
			communitySeparationRatio: 1,
			screenUtilization: 0,
			edgeCrossingCount: 0,
			dependencyDirectionRatio: 1,
			totalNodes: 0,
			totalEdges: 0,
			totalCommunities: 0,
			boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
		};
	}

	// 1. Node Bounding Box & Minimum Spacing
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	let minSpacing = Infinity;
	let nodeOverlapCount = 0;
	const TARGET_MIN_SPACING = 30;

	for (let i = 0; i < totalNodes; i++) {
		const p1 = nodes[i];
		if (p1.x < minX) {minX = p1.x;}
		if (p1.y < minY) {minY = p1.y;}
		if (p1.x > maxX) {maxX = p1.x;}
		if (p1.y > maxY) {maxY = p1.y;}

		for (let j = i + 1; j < totalNodes; j++) {
			const p2 = nodes[j];
			const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
			if (dist < minSpacing) {
				minSpacing = dist;
			}
			if (dist < TARGET_MIN_SPACING) {
				nodeOverlapCount++;
			}
		}
	}

	const width = Math.max(1, maxX - minX);
	const height = Math.max(1, maxY - minY);

	// 2. Screen Utilization
	const vpW = viewport?.width ?? 1200;
	const vpH = viewport?.height ?? 800;
	const graphArea = width * height;
	const vpArea = vpW * vpH;
	const screenUtilization = Math.min(1, Math.max(0.05, graphArea / (vpArea * 2.5)));

	// 3. Community Separation Ratio
	const guides = (layout.guides || []) as readonly TemporalCommunityGuide[];
	let communitySeparationRatio = 1.0;

	if (guides.length >= 2) {
		let totalInterDist = 0;
		let interCount = 0;
		for (let i = 0; i < guides.length; i++) {
			for (let j = i + 1; j < guides.length; j++) {
				totalInterDist += Math.hypot(guides[j].x - guides[i].x, guides[j].y - guides[i].y);
				interCount++;
			}
		}
		const avgInterDist = interCount > 0 ? (totalInterDist / interCount) : 100;

		let totalIntraDist = 0;
		let intraCount = 0;
		for (let i = 0; i < guides.length; i++) {
			const g = guides[i];
			for (let m = 0; m < g.nodeIds.length; m++) {
				const pos = layout.positions.get(g.nodeIds[m]);
				if (pos) {
					totalIntraDist += Math.hypot(pos.x - g.x, pos.y - g.y);
					intraCount++;
				}
			}
		}
		const avgIntraDist = intraCount > 0 ? (totalIntraDist / intraCount) : 40;
		communitySeparationRatio = avgIntraDist > 0 ? (avgInterDist / avgIntraDist) : 2.5;
	}

	// 4. Edge Crossings & Direction Flow
	const edges: TemporalRenderEdge[] = (diff?.edges || []).filter(e => e.changeKind !== 'removed');
	const totalEdges = edges.length;
	let edgeCrossingCount = 0;
	let correctDirectionCount = 0;
	let directedEdgeTotal = 0;

	const nodePosMap = layout.positions;

	// Check dependency direction (producers -> consumers should flow downwards, y_target >= y_source - 20)
	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		const src = nodePosMap.get(e.sourceEntityId || (e as any).sourceId);
		const tgt = nodePosMap.get(e.targetEntityId || (e as any).targetId);
		if (src && tgt) {
			directedEdgeTotal++;
			if (tgt.y >= src.y - 40) {
				correctDirectionCount++;
			}
		}
	}

	const dependencyDirectionRatio = directedEdgeTotal > 0 ? (correctDirectionCount / directedEdgeTotal) : 1.0;

	// Segment-segment crossing check (sampled for performance if edges > 300)
	const sampleLimit = Math.min(edges.length, 120);
	for (let i = 0; i < sampleLimit; i++) {
		const e1 = edges[i];
		const p1 = nodePosMap.get(e1.sourceEntityId || (e1 as any).sourceId);
		const p2 = nodePosMap.get(e1.targetEntityId || (e1 as any).targetId);
		if (!p1 || !p2) {continue;}

		for (let j = i + 1; j < sampleLimit; j++) {
			const e2 = edges[j];
			if (e1.sourceEntityId === e2.sourceEntityId || e1.targetEntityId === e2.targetEntityId ||
				e1.sourceEntityId === e2.targetEntityId || e1.targetEntityId === e2.sourceEntityId) {
				continue;
			}
			const p3 = nodePosMap.get(e2.sourceEntityId || (e2 as any).sourceId);
			const p4 = nodePosMap.get(e2.targetEntityId || (e2 as any).targetId);
			if (!p3 || !p4) {continue;}

			if (doLineSegmentsIntersect(p1, p2, p3, p4)) {
				edgeCrossingCount++;
			}
		}
	}

	// 5. Mental Map Displacement (if previous positions provided)
	let medianDisplacement: number | undefined;
	let p95Displacement: number | undefined;
	let maxDisplacement: number | undefined;

	if (previousPositions && previousPositions.size > 0) {
		const displacements: number[] = [];
		for (let i = 0; i < nodes.length; i++) {
			const n = nodes[i];
			const prev = previousPositions.get(n.entityId);
			if (prev && n.changeKind === 'unchanged') {
				const cur = nodePosMap.get(n.entityId);
				if (cur) {
					displacements.push(Math.hypot(cur.x - prev.x, cur.y - prev.y));
				}
			}
		}

		if (displacements.length > 0) {
			displacements.sort((a, b) => a - b);
			medianDisplacement = displacements[Math.floor(displacements.length / 2)];
			p95Displacement = displacements[Math.floor(displacements.length * 0.95)];
			maxDisplacement = displacements[displacements.length - 1];
		}
	}

	return {
		nodeOverlapCount,
		minNodeSpacing: Number.isFinite(minSpacing) ? minSpacing : 48,
		communitySeparationRatio,
		screenUtilization,
		edgeCrossingCount,
		dependencyDirectionRatio,
		medianDisplacement,
		p95Displacement,
		maxDisplacement,
		totalNodes,
		totalEdges,
		totalCommunities: guides.length,
		boundingBox: {
			minX,
			minY,
			maxX,
			maxY,
			width,
			height,
		},
	};
}

function doLineSegmentsIntersect(
	p1: { x: number; y: number },
	p2: { x: number; y: number },
	p3: { x: number; y: number },
	p4: { x: number; y: number },
): boolean {
	function ccw(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
		return (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
	}

	const d1 = ccw(p1, p3, p4);
	const d2 = ccw(p2, p3, p4);
	const d3 = ccw(p1, p2, p3);
	const d4 = ccw(p1, p2, p4);

	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
		((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

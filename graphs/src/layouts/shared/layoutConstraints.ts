/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { LayoutPosition } from '../../common/types/graphTypes.js';

/** Shared node bounding box used across all layout modes (matches rendered card size in graphEditor). */
export const LAYOUT_NODE_BOX = {
	width: 140,
	height: 36,
	/** Minimum center-to-center distance between nodes. */
	minDist: 160,
	/** Gap between node rectangles when resolving collisions. */
	gap: 16
} as const;

export interface LayoutConstraintOptions {
	collisionPasses?: number;
	minDist?: number;
	maxSpread?: number;
}

export function cellWidth(): number {
	return LAYOUT_NODE_BOX.width + LAYOUT_NODE_BOX.gap;
}

export function cellHeight(): number {
	return LAYOUT_NODE_BOX.height + LAYOUT_NODE_BOX.gap;
}

/** Convert layout anchor points (node centers) to React Flow top-left positions. */
export function convertCentersToTopLeft(
	positions: Record<string, LayoutPosition>,
	boxW: number,
	boxH: number
): void {
	const ox = boxW / 2;
	const oy = boxH / 2;
	for (const id of Object.keys(positions)) {
		positions[id] = { x: positions[id].x - ox, y: positions[id].y - oy };
	}
}

export function boxesOverlap(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	boxW: number,
	boxH: number,
	gap: number
): boolean {
	return (
		ax < bx + boxW + gap &&
		bx < ax + boxW + gap &&
		ay < by + boxH + gap &&
		by < ay + boxH + gap
	);
}

/** Axis-aligned box collision for top-left React Flow coordinates. */
export function resolveRectCollisions(
	positions: Record<string, LayoutPosition>,
	boxW: number,
	boxH: number,
	passes: number,
	gap = LAYOUT_NODE_BOX.gap
): void {
	const ids = Object.keys(positions);

	for (let pass = 0; pass < passes; pass++) {
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const a = positions[ids[i]];
				const b = positions[ids[j]];
				if (!boxesOverlap(a.x, a.y, b.x, b.y, boxW, boxH, gap)) {continue;}

				const overlapX = Math.min(a.x + boxW + gap - b.x, b.x + boxW + gap - a.x);
				const overlapY = Math.min(a.y + boxH + gap - b.y, b.y + boxH + gap - a.y);
				if (overlapX <= 0 || overlapY <= 0) {continue;}

				if (overlapX < overlapY) {
					const push = overlapX;
					const sign = a.x <= b.x ? -1 : 1;
					a.x -= sign * push * 0.5;
					b.x += sign * push * 0.5;
				} else {
					const push = overlapY;
					const sign = a.y <= b.y ? -1 : 1;
					a.y -= sign * push * 0.5;
					b.y += sign * push * 0.5;
				}
			}
		}
	}
}

/** Pyramid tiers: prefer horizontal separation within a row. */
export function resolvePyramidCollisions(
	positions: Record<string, LayoutPosition>,
	boxW: number,
	boxH: number,
	passes: number,
	gap = LAYOUT_NODE_BOX.gap
): void {
	const ids = Object.keys(positions);
	const rowBand = boxH + gap * 0.65;

	for (let pass = 0; pass < passes; pass++) {
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const a = positions[ids[i]];
				const b = positions[ids[j]];
				if (!boxesOverlap(a.x, a.y, b.x, b.y, boxW, boxH, gap)) {continue;}

				const overlapX = Math.min(a.x + boxW + gap - b.x, b.x + boxW + gap - a.x);
				const overlapY = Math.min(a.y + boxH + gap - b.y, b.y + boxH + gap - a.y);
				if (overlapX <= 0 || overlapY <= 0) {continue;}

				const sameRow = Math.abs(a.y - b.y) < rowBand;
				if (sameRow || overlapX <= overlapY) {
					const push = overlapX / 2;
					const sign = a.x <= b.x ? -1 : 1;
					a.x -= sign * push;
					b.x += sign * push;
				} else {
					const push = overlapY / 2;
					const sign = a.y <= b.y ? -1 : 1;
					a.y -= sign * push;
					b.y += sign * push;
				}
			}
		}
	}
}

/** Minimum-distance spacing for ring / scatter groups. */
export function enforceMinimumSpacing(
	positions: Record<string, LayoutPosition>,
	ids: string[],
	minDist: number,
	iterations: number
): void {
	if (ids.length < 2) {return;}
	for (let pass = 0; pass < iterations; pass++) {
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const a = positions[ids[i]];
				const b = positions[ids[j]];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dist = Math.hypot(dx, dy) || 0.001;
				if (dist >= minDist) {continue;}
				const push = (minDist - dist) / 2;
				const nx = dx / dist;
				const ny = dy / dist;
				a.x -= nx * push;
				a.y -= ny * push;
				b.x += nx * push;
				b.y += ny * push;
			}
		}
	}
}

/** Scale layout down uniformly if axis-aligned bounds exceed limit (reduces tile memory). */
export function normalizeGraphBounds(
	positions: Record<string, LayoutPosition>,
	maxExtent = 320
): void {
	if (Object.keys(positions).length === 0) {return;}
	let maxR = 0;
	for (const p of Object.values(positions)) {
		maxR = Math.max(maxR, Math.abs(p.x), Math.abs(p.y));
	}
	if (maxR <= maxExtent || maxR === 0) {return;}
	const k = maxExtent / maxR;
	for (const id of Object.keys(positions)) {
		positions[id] = { x: positions[id].x * k, y: positions[id].y * k };
	}
}

/** Compress vertical span of a layout (pyramid tiers) to reduce SVG/tile memory pressure. */
export function compressVerticalExtent(
	positions: Record<string, LayoutPosition>,
	maxHeight: number,
	boxH: number
): void {
	const ids = Object.keys(positions);
	if (ids.length === 0) {return;}

	let minY = Infinity;
	let maxY = -Infinity;
	for (const p of Object.values(positions)) {
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y + boxH);
	}
	const height = maxY - minY;
	if (height <= maxHeight || height === 0) {return;}

	const k = maxHeight / height;
	for (const id of ids) {
		positions[id] = { x: positions[id].x, y: minY + (positions[id].y - minY) * k };
	}
}

/** Compress horizontal span (pyramid wide rows) to reduce compositor tile pressure. */
export function compressHorizontalExtent(
	positions: Record<string, LayoutPosition>,
	maxWidth: number,
	boxW: number
): void {
	const ids = Object.keys(positions);
	if (ids.length === 0) {return;}

	let minX = Infinity;
	let maxX = -Infinity;
	for (const p of Object.values(positions)) {
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x + boxW);
	}
	const width = maxX - minX;
	if (width <= maxWidth || width === 0) {return;}

	const k = maxWidth / width;
	for (const id of ids) {
		positions[id] = { x: minX + (positions[id].x - minX) * k, y: positions[id].y };
	}
}

export function pyramidMaxHeight(nodeCount: number, spacingScale = 1): number {
	const n = Math.max(1, nodeCount);
	return Math.min(480, 140 + Math.sqrt(n) * 34) * spacingScale;
}

/** Target axis-aligned bounds for layout output (reduces Chromium tile memory pressure). */
export function layoutMaxBounds(nodeCount: number, spacingScale = 1): {
	width: number;
	height: number;
} {
	const n = Math.max(1, nodeCount);
	const side = Math.min(920, 200 + Math.sqrt(n) * 68) * spacingScale;
	return {
		width: side,
		height: Math.min(780, 180 + Math.sqrt(n) * 56) * spacingScale
	};
}

export function measureAxisAlignedBounds(
	positions: Record<string, LayoutPosition>,
	boxW: number,
	boxH: number
): { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number } {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const p of Object.values(positions)) {
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x + boxW);
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y + boxH);
	}
	if (!Number.isFinite(minX)) {return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };}
	return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/** Scale all nodes radially from the entry center to fit within a max disc radius. */
export function capRadialLayoutFromCenter(
	positions: Record<string, LayoutPosition>,
	entryNodeId: string,
	maxRadius: number,
	boxW: number,
	boxH: number
): void {
	const entry = positions[entryNodeId];
	if (!entry || maxRadius <= 0) {return;}

	const cx = entry.x + boxW / 2;
	const cy = entry.y + boxH / 2;
	const nodeExtent = Math.hypot(boxW, boxH) / 2;

	let maxDist = 0;
	for (const [id, p] of Object.entries(positions)) {
		if (id === entryNodeId) {continue;}
		const dist = Math.hypot(p.x + boxW / 2 - cx, p.y + boxH / 2 - cy) + nodeExtent;
		maxDist = Math.max(maxDist, dist);
	}

	if (maxDist <= maxRadius || maxDist === 0) {return;}

	const scale = maxRadius / maxDist;
	for (const [id, p] of Object.entries(positions)) {
		if (id === entryNodeId) {continue;}
		const dx = p.x + boxW / 2 - cx;
		const dy = p.y + boxH / 2 - cy;
		positions[id] = {
			x: cx + dx * scale - boxW / 2,
			y: cy + dy * scale - boxH / 2
		};
	}
}

/** Uniformly scale layout around its center to fit within max width/height. */
export function capLayoutBoundingBox(
	positions: Record<string, LayoutPosition>,
	maxW: number,
	maxH: number,
	boxW: number,
	boxH: number
): void {
	const b = measureAxisAlignedBounds(positions, boxW, boxH);
	if (b.width === 0 && b.height === 0) {return;}
	const k = Math.min(maxW / Math.max(1, b.width), maxH / Math.max(1, b.height), 1);
	if (k >= 0.999) {return;}
	const cx = (b.minX + b.maxX) / 2;
	const cy = (b.minY + b.maxY) / 2;
	for (const id of Object.keys(positions)) {
		const p = positions[id];
		const px = p.x + boxW / 2;
		const py = p.y + boxH / 2;
		positions[id] = {
			x: cx + (px - cx) * k - boxW / 2,
			y: cy + (py - cy) * k - boxH / 2
		};
	}
}

/** Clamp node positions to a bounded disc so SVG/compositor layers stay finite. */
export function clampLayoutSpread(
	positions: Record<string, LayoutPosition>,
	maxRadius = 320
): void {
	for (const id of Object.keys(positions)) {
		const p = positions[id];
		const d = Math.hypot(p.x, p.y);
		if (d > maxRadius) {
			const k = maxRadius / d;
			positions[id] = { x: p.x * k, y: p.y * k };
		}
	}
}

/** Light spacing pass while positions use node-center anchors. */
export function applyUniversalLayoutConstraints(
	positions: Record<string, LayoutPosition>,
	options: LayoutConstraintOptions = {}
): void {
	const ids = Object.keys(positions);
	if (ids.length === 0) {return;}

	const spacing = options.minDist ?? LAYOUT_NODE_BOX.minDist;
	const passes = options.collisionPasses ?? 24;
	enforceMinimumSpacing(positions, ids, spacing, passes);
}

/** Count overlapping node pairs (top-left React Flow coordinates). */
export function countLayoutOverlaps(
	positions: Record<string, LayoutPosition>,
	boxW: number,
	boxH: number,
	gap = LAYOUT_NODE_BOX.gap
): number {
	const ids = Object.keys(positions);
	let count = 0;
	for (let i = 0; i < ids.length; i++) {
		for (let j = i + 1; j < ids.length; j++) {
			const a = positions[ids[i]];
			const b = positions[ids[j]];
			if (boxesOverlap(a.x, a.y, b.x, b.y, boxW, boxH, gap)) {count++;}
		}
	}
	return count;
}

export function defaultMaxSpread(nodeCount: number): number {
	if (nodeCount > 80) {return 300;}
	if (nodeCount > 40) {return 280;}
	return 260;
}

/** Maximum scatter disc radius from node count and spacing (keeps SVG layers bounded). */
export function scatterMaxRadius(nodeCount: number, spacingScale = 1): number {
	const n = Math.max(1, nodeCount);
	const minDist = LAYOUT_NODE_BOX.minDist;
	const needed = Math.sqrt(n) * minDist * 0.58 + 48;
	return Math.min(480, Math.max(150, needed)) * spacingScale;
}

/** Pull nodes outside the main cluster back into the scatter disc. */
export function pullScatterOutliers(
	positions: Record<string, LayoutPosition>,
	maxRadius: number
): void {
	const ids = Object.keys(positions);
	if (ids.length === 0) {return;}

	let cx = 0;
	let cy = 0;
	for (const id of ids) {
		cx += positions[id].x;
		cy += positions[id].y;
	}
	cx /= ids.length;
	cy /= ids.length;

	const radii = ids
		.map((id) => Math.hypot(positions[id].x - cx, positions[id].y - cy))
		.sort((a, b) => a - b);
	const p90 = radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.9))] ?? maxRadius;
	const softLimit = Math.min(maxRadius, Math.max(maxRadius * 0.72, p90 * 1.06));

	for (const id of ids) {
		const p = positions[id];
		const dx = p.x - cx;
		const dy = p.y - cy;
		const d = Math.hypot(dx, dy);
		if (d <= softLimit || d === 0) {continue;}
		const k = softLimit / d;
		positions[id] = { x: cx + dx * k, y: cy + dy * k };
	}

	clampLayoutSpread(positions, maxRadius);
}

/** Scatter-specific finalize — bounded disc, no unbounded radial expansion. */
export function finalizeScatterLayout(
	positions: Record<string, LayoutPosition>,
	options: LayoutConstraintOptions = {}
): void {
	const ids = Object.keys(positions);
	if (ids.length === 0) {return;}

	const { width, height, gap } = LAYOUT_NODE_BOX;
	const n = ids.length;
	// Collision resolution is O(n²) per pass — keep budgets tiny for large graphs.
	const defaultPasses = n > 400 ? 6 : n > 220 ? 12 : n > 120 ? 24 : 48;
	const boxPasses = options.collisionPasses ?? defaultPasses;
	const maxSpread = options.maxSpread ?? scatterMaxRadius(n, 1);
	const minCenterDist = Math.hypot(width + gap, height + gap) * 0.98;
	const spacingPasses = n > 300 ? 12 : n > 150 ? 24 : 48;
	const resolveAttempts = n > 300 ? 4 : n > 150 ? 8 : 16;
	const zeroPasses = n > 300 ? 8 : n > 150 ? 24 : 48;

	// Positions are node-center anchors until convertCentersToTopLeft.
	enforceMinimumSpacing(positions, ids, minCenterDist, spacingPasses);
	pullScatterOutliers(positions, maxSpread + width / 2);
	clampLayoutSpread(positions, maxSpread + width / 2);

	convertCentersToTopLeft(positions, width, height);

	for (let attempt = 0; attempt < resolveAttempts; attempt++) {
		resolveRectCollisions(positions, width, height, boxPasses);
		if (countLayoutOverlaps(positions, width, height) === 0) {
			break;
		}
	}

	ensureZeroOverlaps(positions, width, height, zeroPasses);

	const bounds = layoutMaxBounds(n);
	const measured = measureAxisAlignedBounds(positions, width, height);
	if (measured.width > bounds.width || measured.height > bounds.height) {
		capLayoutBoundingBox(positions, bounds.width, bounds.height, width, height);
		ensureZeroOverlaps(positions, width, height, Math.min(48, zeroPasses * 2));
	}
}

/** Push overlapping top-left boxes apart along the center-to-center axis. */
export function separateOverlappingBoxes(
	positions: Record<string, LayoutPosition>,
	boxW: number,
	boxH: number,
	gap = LAYOUT_NODE_BOX.gap,
	passes = 4
): void {
	const ids = Object.keys(positions);
	const minCenterDist = Math.hypot(boxW + gap, boxH + gap) * 0.98;
	for (let pass = 0; pass < passes; pass++) {
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const a = positions[ids[i]];
				const b = positions[ids[j]];
				if (!boxesOverlap(a.x, a.y, b.x, b.y, boxW, boxH, gap)) {continue;}
				const acx = a.x + boxW / 2;
				const acy = a.y + boxH / 2;
				const bcx = b.x + boxW / 2;
				const bcy = b.y + boxH / 2;
				let dx = bcx - acx;
				let dy = bcy - acy;
				let dist = Math.hypot(dx, dy);
				if (dist < 0.001) {
					dx = (i - j) * 0.17;
					dy = ((i + j) % 3) * 0.13 + 0.05;
					dist = Math.hypot(dx, dy);
				}
				const push = (minCenterDist - dist) / 2;
				if (push <= 0) {continue;}
				const nx = dx / dist;
				const ny = dy / dist;
				a.x -= nx * push;
				a.y -= ny * push;
				b.x += nx * push;
				b.y += ny * push;
			}
		}
	}
}

/** Run collision resolution until overlaps are eliminated or passes exhausted. */
export function ensureZeroOverlaps(
	positions: Record<string, LayoutPosition>,
	boxW: number,
	boxH: number,
	maxRounds = 48
): void {
	const gap = LAYOUT_NODE_BOX.gap;
	for (let round = 0; round < maxRounds; round++) {
		separateOverlappingBoxes(positions, boxW, boxH, gap, 3);
		resolveRectCollisions(positions, boxW, boxH, 6, gap);
		if (countLayoutOverlaps(positions, boxW, boxH, gap) === 0) {return;}
	}
}

/** Final pass after positions are React Flow top-left coordinates. */
export function finalizeLayoutPositions(
	positions: Record<string, LayoutPosition>,
	options: LayoutConstraintOptions = {}
): void {
	const ids = Object.keys(positions);
	if (ids.length === 0) {return;}

	const { width, height } = LAYOUT_NODE_BOX;
	const passes = options.collisionPasses ?? 80;

	for (let attempt = 0; attempt < 32; attempt++) {
		resolveRectCollisions(positions, width, height, passes);
		if (countLayoutOverlaps(positions, width, height) === 0) {break;}
	}

	ensureZeroOverlaps(positions, width, height, 96);

	const bounds = layoutMaxBounds(ids.length);
	const measured = measureAxisAlignedBounds(positions, width, height);
	if (measured.width > bounds.width || measured.height > bounds.height) {
		capLayoutBoundingBox(positions, bounds.width, bounds.height, width, height);
		ensureZeroOverlaps(positions, width, height, 120);
	}
}

/** Pyramid-specific finalize — grid is pre-spaced; convert only unless overlap remains. */
export function finalizePyramidLayout(
	positions: Record<string, LayoutPosition>,
	options: LayoutConstraintOptions = {}
): void {
	const ids = Object.keys(positions);
	const { width, height } = LAYOUT_NODE_BOX;
	const passes = options.collisionPasses ?? 48;

	convertCentersToTopLeft(positions, width, height);

	for (let attempt = 0; attempt < 24; attempt++) {
		resolvePyramidCollisions(positions, width, height, passes);
		if (countLayoutOverlaps(positions, width, height) === 0) {break;}
	}

	ensureZeroOverlaps(positions, width, height, 96);

	const bounds = layoutMaxBounds(ids.length);
	const measured = measureAxisAlignedBounds(positions, width, height);
	if (measured.width > bounds.width || measured.height > bounds.height) {
		capLayoutBoundingBox(positions, bounds.width, bounds.height, width, height);
		ensureZeroOverlaps(positions, width, height, 120);
	}
}

/** Pyramid finalize when positions are already React Flow top-left coordinates. */
export function finalizePyramidLayoutTopLeft(
	positions: Record<string, LayoutPosition>,
	options: { nodeCount?: number; spacingScale?: number } = {}
): void {
	const ids = Object.keys(positions);
	if (ids.length === 0) {return;}

	const { width, height } = LAYOUT_NODE_BOX;
	const nodeCount = options.nodeCount ?? ids.length;
	const scale = options.spacingScale ?? 1;
	const bounds = layoutMaxBounds(nodeCount, scale);
	const measured = measureAxisAlignedBounds(positions, width, height);

	if (measured.width <= bounds.width && measured.height <= bounds.height) {return;}

	const saved = Object.fromEntries(ids.map((id) => [id, { ...positions[id] }]));
	capLayoutBoundingBox(positions, bounds.width, bounds.height, width, height);
	if (countLayoutOverlaps(positions, width, height) === 0) {return;}

	for (const id of ids) {positions[id] = saved[id];}
}

export function centerGraph(positions: Record<string, LayoutPosition>): void {
	const vals = Object.values(positions);
	if (vals.length === 0) {return;}
	const cx = vals.reduce((s, p) => s + p.x, 0) / vals.length;
	const cy = vals.reduce((s, p) => s + p.y, 0) / vals.length;
	for (const id of Object.keys(positions)) {
		positions[id] = { x: positions[id].x - cx, y: positions[id].y - cy };
	}
}

/** Center horizontally only — preserves vertical pyramid tiers. */
export function centerGraphHorizontally(positions: Record<string, LayoutPosition>): void {
	const vals = Object.values(positions);
	if (vals.length === 0) {return;}
	const cx = vals.reduce((s, p) => s + p.x, 0) / vals.length;
	for (const id of Object.keys(positions)) {
		positions[id] = { x: positions[id].x - cx, y: positions[id].y };
	}
}

/** Center layout using axis-aligned bounding box (top-left coordinates). */
export function centerLayoutHorizontally(
	positions: Record<string, LayoutPosition>,
	boxW: number,
	boxH: number
): void {
	const b = measureAxisAlignedBounds(positions, boxW, boxH);
	if (b.width === 0 && b.height === 0) {return;}
	const centerX = (b.minX + b.maxX) / 2;
	for (const id of Object.keys(positions)) {
		positions[id] = { x: positions[id].x - centerX, y: positions[id].y };
	}
}

/** Place entry node near the top of the layout (pyramid anchor). */
export function anchorEntryTop(
	positions: Record<string, LayoutPosition>,
	entryNodeId: string,
	topPad = 48,
	boxH = LAYOUT_NODE_BOX.height
): void {
	const entry = positions[entryNodeId];
	if (!entry) {return;}
	const targetCenterY = topPad + boxH / 2;
	const dy = targetCenterY - entry.y;
	for (const id of Object.keys(positions)) {
		positions[id] = { x: positions[id].x, y: positions[id].y + dy };
	}
}

/** Viewport fit parameters per layout mode. */
export function viewportFitForLayout(mode: string): {
	padding: number;
	minZoom: number;
	maxZoom: number;
} {
	switch (mode) {
		case 'pyramid':
			return { padding: 0.1, minZoom: 0.48, maxZoom: 0.95 };
		case 'scattered':
			return { padding: 0.12, minZoom: 0.52, maxZoom: 1.0 };
		case 'hierarchy':
		default:
			return { padding: 0.08, minZoom: 0.68, maxZoom: 1.0 };
	}
}

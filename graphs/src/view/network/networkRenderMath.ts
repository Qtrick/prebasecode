/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Point3D {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export interface ProjectedPoint {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly depthScale: number;
	readonly normalizedDepth: number;
}

export interface NetworkNodeLike {
	readonly id: string;
	readonly label?: string;
	readonly path?: string;
	readonly isEntry?: boolean;
	readonly importance?: number;
	readonly degree?: number;
	readonly val?: number;
	readonly meta?: {
		readonly importance?: number;
		readonly architectureLayer?: string;
		readonly language?: string;
	};
}

export const NETWORK_FOCAL_LENGTH = 850;

/**
 * Clamp a number to a bounded [min, max] range.
 */
export function clamp(val: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, val));
}

/**
 * Normalizes depthScale into a smooth, bounded [0, 1] range.
 * Near nodes approach 1.0, far nodes approach 0.0.
 */
export function normalizeDepthScale(depthScale: number): number {
	return clamp((depthScale - 0.65) / 0.85, 0, 1);
}

/**
 * Computes depth factor for node sizing.
 * Perspective influences node glyphs sublinearly so nodes do not balloon into giant circles.
 * Output is strictly bounded between [0.78, 1.28].
 */
export function computeNetworkDepthSizeFactor(depthScale: number): number {
	const norm = normalizeDepthScale(depthScale);
	return clamp(0.78 + norm * 0.46, 0.78, 1.28);
}

/**
 * Computes depth alpha for subtle 3D depth cueing without hiding distant topology.
 * Output is bounded in [minAlpha, maxAlpha].
 */
export function computeDepthAlpha(depthScale: number, minAlpha = 0.45, maxAlpha = 1.0): number {
	const norm = normalizeDepthScale(depthScale);
	return minAlpha + norm * (maxAlpha - minAlpha);
}

/**
 * 3D point projection with continuous perspective.
 */
export function projectPoint3D(
	x: number,
	y: number,
	z: number,
	yaw: number,
	pitch: number,
	focalLength: number = NETWORK_FOCAL_LENGTH,
): ProjectedPoint {
	const cp = Math.cos(pitch);
	const sp = Math.sin(pitch);
	const y1 = y * cp - z * sp;
	const z1 = y * sp + z * cp;

	const cy = Math.cos(yaw);
	const sy = Math.sin(yaw);
	const x2 = x * cy + z1 * sy;
	const z2 = -x * sy + z1 * cy;

	const distance = Math.max(focalLength * 0.25, focalLength + z2);
	const depthScale = focalLength / distance;
	const normalizedDepth = normalizeDepthScale(depthScale);

	return {
		x: x2 * depthScale,
		y: y1 * depthScale,
		z: z2,
		depthScale,
		normalizedDepth,
	};
}

/**
 * Computes the semantic node weight based on architectural importance, degree, or entry status.
 */
export function computeNetworkSemanticWeight(node: NetworkNodeLike, entryNodeId?: string): number {
	if (typeof node.val === 'number' && Number.isFinite(node.val) && node.val > 0) {
		return node.val;
	}

	const isEntry = Boolean(node.isEntry || (entryNodeId && node.id === entryNodeId));
	if (isEntry) {
		return 10;
	}

	const importance = node.importance ?? node.meta?.importance ?? 0;
	const degree = node.degree ?? 0;

	if (importance > 0 || degree > 0) {
		const impWeight = importance > 0
			? (importance <= 1.0 ? 1.2 + Math.sqrt(importance * 10) * 1.8 : 1.2 + Math.sqrt(importance) * 1.8)
			: 0;
		const degWeight = degree > 0 ? 1.2 + Math.sqrt(degree) * 1.4 : 0;
		return Math.max(1.5, impWeight, degWeight);
	}

	return 1.5;
}

/**
 * Computes the VISUAL screen-space radius of a node glyph.
 * Invariants:
 * - Ordinary file nodes: ~3-6px radius
 * - Hub nodes: ~6-10px radius
 * - Entry nodes: ~7-11px radius
 * - Perspective effect is bounded by computeNetworkDepthSizeFactor.
 * - Ordinary nodes NEVER explode into 30-100px bubbles.
 */
export function computeNetworkVisualRadius(
	node: NetworkNodeLike,
	depthScale: number,
	options?: {
		readonly entryNodeId?: string;
		readonly isSelected?: boolean;
		readonly isHovered?: boolean;
		readonly nodeScale?: number;
	},
): number {
	const nodeScale = options?.nodeScale ?? 1.0;
	const weight = computeNetworkSemanticWeight(node, options?.entryNodeId);
	const depthFactor = computeNetworkDepthSizeFactor(depthScale);

	// Base formula matching known-good PreBase: sqrt(weight) * scale * 1.6 + 1.6
	let radius = (Math.sqrt(weight) * nodeScale * 1.6 + 1.6) * depthFactor;

	if (options?.isHovered) {
		radius *= 1.15;
	}
	if (options?.isSelected) {
		radius *= 1.25;
	}

	// Clamp within sane visual bounds: ordinary nodes never exceed 20px base glyph
	return clamp(radius, 2.5, 20);
}

/**
 * Computes the PICK / HIT radius of a node for mouse/touch interaction.
 * Hit target is intentionally much larger than visual radius (~16-24px) for comfortable picking.
 */
export function computeNetworkPickRadius(
	node: NetworkNodeLike,
	depthScale: number,
	options?: {
		readonly entryNodeId?: string;
		readonly nodeScale?: number;
	},
): number {
	const visualR = computeNetworkVisualRadius(node, depthScale, options);
	return Math.max(18, visualR * 2.2 + 8);
}

/**
 * Computes bounded fitView bounds and camera transform.
 * Uses bounded glyph extents rather than raw unconstrained depth-scale multiplier.
 */
export function computeNetworkFitTransform(
	nodes: readonly NetworkNodeLike[],
	projectedMap: Readonly<Record<string, { x: number; y: number; depthScale: number }>>,
	viewportWidth: number,
	viewportHeight: number,
	options?: {
		readonly padding?: number;
		readonly initialZoom?: number;
		readonly nodeScale?: number;
	},
): { readonly x: number; readonly y: number; readonly k: number } {
	const pad = options?.padding ?? 72;
	const initialZoom = options?.initialZoom ?? 1.0;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let count = 0;

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const p = projectedMap[node.id];
		if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

		const r = computeNetworkVisualRadius(node, p.depthScale, { nodeScale: options?.nodeScale });
		minX = Math.min(minX, p.x - r);
		minY = Math.min(minY, p.y - r);
		maxX = Math.max(maxX, p.x + r);
		maxY = Math.max(maxY, p.y + r);
		count++;
	}

	if (count === 0 || !Number.isFinite(minX)) {
		return { x: 0, y: 0, k: 1 };
	}

	const boxW = Math.max(1, maxX - minX);
	const boxH = Math.max(1, maxY - minY);
	const usableW = Math.max(100, viewportWidth - pad * 2);
	const usableH = Math.max(100, viewportHeight - pad * 2);

	const scale = Math.min(usableW / boxW, usableH / boxH, 2.0) * initialZoom;
	const k = clamp(scale, 0.2, 2.5);

	const centerX = (minX + maxX) / 2;
	const centerY = (minY + maxY) / 2;

	const x = (viewportWidth / 2) - centerX * k;
	const y = (viewportHeight / 2) - centerY * k;

	return { x, y, k };
}

/**
 * Determines whether a label is eligible to be shown at the current LOD zoom level.
 */
export function isNetworkLabelEligible(
	node: NetworkNodeLike,
	transformK: number,
	isMoving: boolean,
	options: {
		readonly isSelected?: boolean;
		readonly isHovered?: boolean;
		readonly isEntry?: boolean;
		readonly isSearchResult?: boolean;
	},
): boolean {
	if (options.isSelected || options.isHovered || options.isSearchResult) {
		return true;
	}

	if (isMoving) {
		// During active rotation/pan, only show selected/hovered to maintain 60fps and avoid visual noise
		return false;
	}

	if (options.isEntry && transformK >= 0.35) {
		return true;
	}

	const importance = node.importance ?? node.meta?.importance ?? 0;
	const degree = node.degree ?? 0;
	const isHub = importance >= 0.6 || degree >= 5;

	if (isHub && transformK >= 0.65) {
		return true;
	}

	// General node labels only visible at deeper zoom
	return transformK >= 1.2;
}

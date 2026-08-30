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

export const NETWORK_FOCAL_LENGTH = 1100;

/**
 * Clamp a number to a bounded [min, max] range.
 * Self-contained for webview serialization.
 */
export function clamp(val: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, val));
}

/**
 * Normalizes depthScale into a smooth, bounded [0, 1] range.
 * Matches production webview historical mapping.
 */
export function normalizeDepthScale(depthScale: number): number {
	if (!Number.isFinite(depthScale)) {
		return 0.5;
	}
	return Math.max(0, Math.min(1, (depthScale - 0.65) / 0.85));
}

/**
 * Computes depth factor for node sizing. Bounded [0.78, 1.28].
 */
export function computeNetworkDepthSizeFactor(depthScale: number): number {
	const norm = normalizeDepthScale(depthScale);
	return Math.max(0.78, Math.min(1.28, 0.78 + norm * 0.46));
}

/**
 * Computes depth alpha for subtle 3D depth cueing.
 * Self-contained for webview serialization.
 */
export function computeDepthAlpha(depthScale: number, minAlpha = 0.45, maxAlpha = 1.0): number {
	const norm = !Number.isFinite(depthScale) ? 0.5 : Math.max(0, Math.min(1, (depthScale - 0.65) / 0.85));
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
 * Self-contained body for serialization.
 */
export function computeNetworkSemanticWeight(node: NetworkNodeLike, entryNodeId?: string): number {
	if (!node) {
		return 1.5;
	}
	if (typeof node.val === 'number' && Number.isFinite(node.val) && node.val > 0) {
		return node.val;
	}
	if (node.isEntry || (entryNodeId && node.id === entryNodeId)) {
		return 10;
	}
	const importance = typeof node.importance === 'number' && Number.isFinite(node.importance)
		? node.importance
		: (node.meta && typeof node.meta.importance === 'number' ? node.meta.importance : 0);
	const degree = typeof node.degree === 'number' && Number.isFinite(node.degree) ? node.degree : 0;
	const impWeight = importance > 0
		? (importance <= 1.0 ? 1.2 + Math.sqrt(importance * 10) * 1.8 : 1.2 + Math.sqrt(importance) * 1.8)
		: 0;
	const degWeight = degree > 0 ? 1.2 + Math.sqrt(degree) * 1.4 : 0;
	return Math.max(1.5, impWeight, degWeight);
}

/**
 * WORLD-SPACE visual radius for network node glyphs.
 *
 * `zoom` is the canvas transform.k. Returned values are drawn AFTER ctx.scale(zoom),
 * so screen radius ≈ returnValue * zoom. Zoom compensation keeps ordinary nodes
 * readable at Fit View without turning them into giant bubbles when zoomed in.
 *
 * Hierarchy: ordinary < hub < entry < selected (via options).
 *
 * Self-contained for webview serialization — do not reference other module symbols.
 */
export function computeNetworkVisualRadius(
	node: NetworkNodeLike,
	depthScale: number,
	options?: {
		readonly entryNodeId?: string;
		readonly isSelected?: boolean;
		readonly isHovered?: boolean;
		readonly nodeScale?: number;
		readonly zoom?: number;
	},
): number {
	const nodeScale = options && typeof options.nodeScale === 'number' && Number.isFinite(options.nodeScale)
		? Math.max(0.5, Math.min(2.0, options.nodeScale))
		: 1.0;
	const entryId = options ? options.entryNodeId : undefined;
	let weight = 1.5;
	if (node) {
		if (typeof node.val === 'number' && Number.isFinite(node.val) && node.val > 0) {
			weight = node.val;
		} else if (node.isEntry || (entryId && node.id === entryId)) {
			weight = 10;
		} else {
			const importance = typeof node.importance === 'number' && Number.isFinite(node.importance)
				? node.importance
				: (node.meta && typeof node.meta.importance === 'number' ? node.meta.importance : 0);
			const degree = typeof node.degree === 'number' && Number.isFinite(node.degree) ? node.degree : 0;
			const impWeight = importance > 0
				? (importance <= 1.0 ? 1.2 + Math.sqrt(importance * 10) * 1.8 : 1.2 + Math.sqrt(importance) * 1.8)
				: 0;
			const degWeight = degree > 0 ? 1.2 + Math.sqrt(degree) * 1.4 : 0;
			weight = Math.max(1.5, impWeight, degWeight);
		}
	}
	const depthNorm = !Number.isFinite(depthScale) ? 0.5 : Math.max(0, Math.min(1, (depthScale - 0.65) / 0.85));
	const depthFactor = Math.max(0.78, Math.min(1.28, 0.78 + depthNorm * 0.46));
	let baseScreen = (Math.sqrt(weight) * nodeScale * 1.6 + 1.6) * depthFactor;
	if (options && options.isHovered) {
		baseScreen *= 1.15;
	}
	if (options && options.isSelected) {
		baseScreen *= 1.25;
	}
	baseScreen = Math.max(2.5, Math.min(20, baseScreen));

	const zoom = options && typeof options.zoom === 'number' && Number.isFinite(options.zoom) ? options.zoom : 1;
	const k = Math.max(0.001, zoom);
	const desiredScreen = Math.max(2.8, Math.min(26, baseScreen * Math.pow(k, 0.5)));
	return desiredScreen / k;
}

/**
 * WORLD-SPACE pick radius. Ensures comfortable ~16–24px screen targets across zoom.
 * Self-contained for webview serialization.
 */
export function computeNetworkPickRadius(
	node: NetworkNodeLike,
	depthScale: number,
	options?: {
		readonly entryNodeId?: string;
		readonly nodeScale?: number;
		readonly zoom?: number;
	},
): number {
	const visualR = computeNetworkVisualRadius(node, depthScale, options);
	const zoom = options && typeof options.zoom === 'number' && Number.isFinite(options.zoom) ? options.zoom : 1;
	const k = Math.max(0.001, zoom);
	const minScreenPick = 18;
	return Math.max(visualR * 2.2 + 8 / k, minScreenPick / k);
}

/**
 * Fit View transform matching production webview semantics (insets + node-count zoom cap).
 * Self-contained for webview serialization except it calls computeNetworkVisualRadius above
 * — when injecting into the webview, inject BOTH and bind locally.
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
		readonly entryNodeId?: string;
		readonly insets?: { readonly top?: number; readonly bottom?: number; readonly left?: number; readonly right?: number };
		readonly minZoom?: number;
		readonly maxZoom?: number;
	},
): { readonly x: number; readonly y: number; readonly k: number } {
	const pad = options && typeof options.padding === 'number' ? options.padding : 48;
	const initialZoom = options && typeof options.initialZoom === 'number' ? options.initialZoom : 1.0;
	const nodeScale = options ? options.nodeScale : undefined;
	const entryNodeId = options ? options.entryNodeId : undefined;
	const insetOpts = options ? options.insets : undefined;
	const insets = {
		top: insetOpts && typeof insetOpts.top === 'number' ? insetOpts.top : 0,
		bottom: insetOpts && typeof insetOpts.bottom === 'number' ? insetOpts.bottom : 0,
		left: insetOpts && typeof insetOpts.left === 'number' ? insetOpts.left : 0,
		right: insetOpts && typeof insetOpts.right === 'number' ? insetOpts.right : 0,
	};
	const usableW = Math.max(100, viewportWidth - insets.left - insets.right);
	const usableH = Math.max(100, viewportHeight - insets.top - insets.bottom);
	const centerX = insets.left + usableW / 2;
	const centerY = insets.top + usableH / 2;
	const minZoom = options && typeof options.minZoom === 'number' ? options.minZoom : 0.15;
	const maxZoom = options && typeof options.maxZoom === 'number'
		? options.maxZoom
		: (nodes.length <= 10 ? 3.2 : 2.4);

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let count = 0;

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const p = projectedMap[node.id];
		if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
			continue;
		}
		// Fit uses zoom=1 world radii (layout extents). Screen-aware sizing applies at draw time.
		const r = computeNetworkVisualRadius(node, p.depthScale, {
			nodeScale: nodeScale,
			entryNodeId: entryNodeId,
			zoom: 1,
		});
		minX = Math.min(minX, p.x - r);
		minY = Math.min(minY, p.y - r);
		maxX = Math.max(maxX, p.x + r);
		maxY = Math.max(maxY, p.y + r);
		count++;
	}

	if (count === 0 || !Number.isFinite(minX)) {
		return { x: centerX, y: centerY, k: 1 };
	}

	const boxW = Math.max(1, maxX - minX);
	const boxH = Math.max(1, maxY - minY);
	const scale = Math.min((usableW - pad * 2) / boxW, (usableH - pad * 2) / boxH) * initialZoom;
	const k = Math.max(minZoom, Math.min(maxZoom, scale));

	const graphCenterX = (minX + maxX) / 2;
	const graphCenterY = (minY + maxY) / 2;

	return {
		x: centerX - graphCenterX * k,
		y: centerY - graphCenterY * k,
		k,
	};
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
		return false;
	}

	if (options.isEntry && transformK >= 0.5) {
		return true;
	}

	const importance = node.importance ?? node.meta?.importance ?? 0;
	const degree = node.degree ?? 0;
	const isHub = importance >= 0.6 || degree >= 5;

	if (isHub && transformK >= 0.85) {
		return true;
	}

	return transformK >= 1.6;
}

/**
 * World-space font size so text remains readable after ctx.scale(zoom).
 * Self-contained for webview serialization.
 */
export function computeNetworkLabelWorldFontSize(
	baseScreenPx: number,
	zoom: number,
	options?: { readonly minScreenPx?: number; readonly maxScreenPx?: number },
): number {
	const k = Math.max(0.001, Number.isFinite(zoom) ? zoom : 1);
	const minScreen = options && typeof options.minScreenPx === 'number' ? options.minScreenPx : 9;
	const maxScreen = options && typeof options.maxScreenPx === 'number' ? options.maxScreenPx : 18;
	const desired = Math.max(minScreen, Math.min(maxScreen, baseScreenPx * Math.pow(k, 0.5)));
	return desired / k;
}

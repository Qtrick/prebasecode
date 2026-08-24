/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Transform2D {
	readonly x: number;
	readonly y: number;
	readonly k: number;
}

export interface Rect2D {
	readonly minX: number;
	readonly maxX: number;
	readonly minY: number;
	readonly maxY: number;
}

export interface ViewportInsets {
	readonly top?: number;
	readonly right?: number;
	readonly bottom?: number;
	readonly left?: number;
}

export interface WheelZoomInput {
	readonly deltaY: number;
	readonly deltaMode: number;
	readonly ctrlKey?: boolean;
	readonly sensitivity?: number;
	readonly minZoom?: number;
	readonly maxZoom?: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3.5;
export const DEFAULT_ZOOM = 1.0;

// DOM Delta Modes from standard UI Events spec
export const DOM_DELTA_PIXEL = 0;
export const DOM_DELTA_LINE = 1;
export const DOM_DELTA_PAGE = 2;

// Calibrated baseline coefficients for smooth, continuous scaling
const PIXEL_COEFFICIENT = 1.0;
const LINE_COEFFICIENT = 24.0; // 1 notch on standard mouse wheel ~24px
const PAGE_COEFFICIENT = 400.0;
const PINCH_COEFFICIENT = 1.5; // Trackpad pinch-to-zoom in Chromium emits ctrlKey with high-res deltaY
const BASE_EXPONENT_STEP = 0.0025; // 2^(-delta * 0.0025) yields ~0.03% per 0.2px tick, ~4.2% per line notch
const MAX_SINGLE_EVENT_DELTA = 320; // Clamps hardware spike jumps

/**
 * Clamps a number to [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Normalizes raw WheelEvent properties into an effective continuous delta value.
 * Correctly accounts for magnitude, deltaMode (pixel/line/page), ctrlKey pinch gestures, and user sensitivity.
 */
export function normalizeWheelZoomDelta(input: WheelZoomInput): number {
	const rawDeltaY = input.deltaY;
	if (!Number.isFinite(rawDeltaY) || rawDeltaY === 0) {
		return 0;
	}

	let unitMultiplier = PIXEL_COEFFICIENT;
	if (input.deltaMode === DOM_DELTA_LINE) {
		unitMultiplier = LINE_COEFFICIENT;
	} else if (input.deltaMode === DOM_DELTA_PAGE) {
		unitMultiplier = PAGE_COEFFICIENT;
	}

	let effectiveDelta = rawDeltaY * unitMultiplier;

	if (input.ctrlKey) {
		effectiveDelta *= PINCH_COEFFICIENT;
	}

	// Clamp absurd single-event spikes to prevent disorientation
	effectiveDelta = clamp(effectiveDelta, -MAX_SINGLE_EVENT_DELTA, MAX_SINGLE_EVENT_DELTA);

	const sensitivity = input.sensitivity !== undefined && Number.isFinite(input.sensitivity) && input.sensitivity > 0
		? input.sensitivity
		: 1.0;

	return effectiveDelta * sensitivity;
}

/**
 * Converts a normalized delta into a continuous exponential multiplier (2^exponent).
 * Preserves smooth continuous scaling across high-frequency trackpad streams.
 */
export function computeContinuousZoomFactor(normalizedDelta: number): number {
	if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
		return 1.0;
	}
	const exponent = -normalizedDelta * BASE_EXPONENT_STEP;
	return Math.pow(2, exponent);
}

/**
 * Applies cursor-anchored zoom transform when Keep Centered is OFF.
 * The world point beneath (cursorX, cursorY) remains stationary on screen.
 */
export function applyZoomAroundCursor(
	transform: Transform2D,
	factor: number,
	cursorX: number,
	cursorY: number,
	minZoom = MIN_ZOOM,
	maxZoom = MAX_ZOOM,
): Transform2D {
	const prevK = transform.k;
	if (!Number.isFinite(prevK) || prevK <= 0) {
		return { x: cursorX, y: cursorY, k: clamp(factor, minZoom, maxZoom) };
	}

	const nextK = clamp(prevK * factor, minZoom, maxZoom);
	if (nextK === prevK) {
		return transform;
	}

	const ratio = nextK / prevK;
	const nextX = cursorX - (cursorX - transform.x) * ratio;
	const nextY = cursorY - (cursorY - transform.y) * ratio;

	return {
		x: nextX,
		y: nextY,
		k: nextK,
	};
}

/**
 * Applies viewport-center anchored zoom transform when Keep Centered is ON.
 * The center of the usable viewport remains stationary on screen.
 */
export function applyZoomAroundCenter(
	transform: Transform2D,
	factor: number,
	viewportWidth: number,
	viewportHeight: number,
	minZoom = MIN_ZOOM,
	maxZoom = MAX_ZOOM,
	insets?: ViewportInsets,
): Transform2D {
	const insetLeft = insets?.left ?? 0;
	const insetRight = insets?.right ?? 0;
	const insetTop = insets?.top ?? 0;
	const insetBottom = insets?.bottom ?? 0;

	const usableCenterX = insetLeft + Math.max(1, viewportWidth - insetLeft - insetRight) / 2;
	const usableCenterY = insetTop + Math.max(1, viewportHeight - insetTop - insetBottom) / 2;

	return applyZoomAroundCursor(transform, factor, usableCenterX, usableCenterY, minZoom, maxZoom);
}

/**
 * Computes bounding rectangle from projected 2D node coordinates.
 */
export function computeGraphBounds(
	nodes: readonly { readonly x: number; readonly y: number; readonly radius?: number }[],
): Rect2D | null {
	if (!nodes || nodes.length === 0) {
		return null;
	}

	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	let validCount = 0;

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
		const r = node.radius ?? 0;
		minX = Math.min(minX, node.x - r);
		maxX = Math.max(maxX, node.x + r);
		minY = Math.min(minY, node.y - r);
		maxY = Math.max(maxY, node.y + r);
		validCount++;
	}

	if (validCount === 0 || !Number.isFinite(minX)) {
		return null;
	}

	return { minX, maxX, minY, maxY };
}

/**
 * Computes center-locked translation (x, y) given visible graph bounds, viewport dimensions, and current zoom k.
 * Preserves the exact current zoom k and adjusts translation so graph centroid sits at usable viewport center.
 */
export function computeCenterLockedTransform(
	bounds: Rect2D | null,
	viewportWidth: number,
	viewportHeight: number,
	currentK: number,
	insets?: ViewportInsets,
): Transform2D {
	const k = Number.isFinite(currentK) && currentK > 0 ? currentK : 1.0;
	const insetLeft = insets?.left ?? 0;
	const insetRight = insets?.right ?? 0;
	const insetTop = insets?.top ?? 0;
	const insetBottom = insets?.bottom ?? 0;

	const usableCenterX = insetLeft + Math.max(1, viewportWidth - insetLeft - insetRight) / 2;
	const usableCenterY = insetTop + Math.max(1, viewportHeight - insetTop - insetBottom) / 2;

	if (!bounds) {
		return { x: usableCenterX, y: usableCenterY, k };
	}

	const graphCenterX = (bounds.minX + bounds.maxX) / 2;
	const graphCenterY = (bounds.minY + bounds.maxY) / 2;

	const x = usableCenterX - graphCenterX * k;
	const y = usableCenterY - graphCenterY * k;

	return { x, y, k };
}

/**
 * Tests if the spatial displacement between current and target transforms is within the dead-zone threshold.
 * Prevents micro-jitter during continuous 3D rotation or subtle Temporal state updates.
 */
export function isCenterDeadZone(current: Transform2D, target: Transform2D, thresholdPx = 0.5): boolean {
	const dx = current.x - target.x;
	const dy = current.y - target.y;
	const dk = Math.abs(current.k - target.k);
	return (dx * dx + dy * dy) <= (thresholdPx * thresholdPx) && dk < 0.001;
}

/**
 * Standard cubic ease-out for smooth programmatic camera transitions.
 */
export function easeOutCubic(t: number): number {
	const clamped = clamp(t, 0, 1);
	return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Interpolates smoothly between two 2D viewport transforms.
 */
export function interpolateViewport(from: Transform2D, to: Transform2D, progress: number): Transform2D {
	const t = clamp(progress, 0, 1);
	return {
		x: from.x + (to.x - from.x) * t,
		y: from.y + (to.y - from.y) * t,
		k: from.k + (to.k - from.k) * t,
	};
}

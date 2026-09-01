/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export interface NetworkRotation {
	readonly yaw: number;
	readonly pitch: number;
}

export interface NetworkTransform {
	readonly x: number;
	readonly y: number;
	readonly k: number;
}

export interface NetworkWorldPosition {
	readonly x: number;
	readonly y: number;
	readonly z?: number;
}

export interface NetworkRenderMetricsSnapshot {
	readonly transform: NetworkTransform;
	readonly rotation?: NetworkRotation;
	readonly lodTier?: string;
	readonly labelsDrawn?: number;
	readonly labelCount?: number;
	readonly edgesDrawn?: number;
	readonly nodesDrawn?: number;
	readonly projectedBounds?: {
		readonly minX: number;
		readonly minY: number;
		readonly maxX: number;
		readonly maxY: number;
		readonly width: number;
		readonly height: number;
	} | null;
	readonly screenUtilization?: number;
}

const DEFAULT_ROTATION_TOLERANCE = 0.01;
const DEFAULT_NODE_TOLERANCE = 0.001;
const DEFAULT_TRANSFORM_TOLERANCE = 0.5;

function finiteRotation(rotation: NetworkRotation | null | undefined): rotation is NetworkRotation {
	return Boolean(
		rotation
		&& Number.isFinite(rotation.yaw)
		&& Number.isFinite(rotation.pitch),
	);
}

function boundsChanged(
	before: NetworkRenderMetricsSnapshot['projectedBounds'],
	after: NetworkRenderMetricsSnapshot['projectedBounds'],
	tolerance = 0.5,
): boolean {
	if (!before || !after) {
		return false;
	}
	return Math.abs(before.minX - after.minX) > tolerance
		|| Math.abs(before.minY - after.minY) > tolerance
		|| Math.abs(before.maxX - after.maxX) > tolerance
		|| Math.abs(before.maxY - after.maxY) > tolerance
		|| Math.abs(before.width - after.width) > tolerance
		|| Math.abs(before.height - after.height) > tolerance;
}

/**
 * Returns true only when both yaw and pitch remain within tolerance.
 * Any single-axis drift or missing coordinate fails closed.
 */
export function cameraRotationStable(
	before: NetworkRotation | null | undefined,
	after: NetworkRotation | null | undefined,
	tolerance = DEFAULT_ROTATION_TOLERANCE,
): boolean {
	if (!finiteRotation(before) || !finiteRotation(after)) {
		return false;
	}
	return Math.abs(after.yaw - before.yaw) <= tolerance
		&& Math.abs(after.pitch - before.pitch) <= tolerance;
}

/**
 * Returns true when orbit motion is proven on at least one axis.
 */
export function rotationProven(
	before: NetworkRotation | null | undefined,
	after: NetworkRotation | null | undefined,
	minDelta = 0.005,
): boolean {
	if (!finiteRotation(before) || !finiteRotation(after)) {
		return false;
	}
	const yawDelta = Math.abs(after.yaw - before.yaw);
	const pitchDelta = Math.abs(after.pitch - before.pitch);
	return yawDelta > minDelta || pitchDelta > minDelta;
}

/**
 * Shift-pan must move the viewport transform while keeping camera rotation
 * and node world coordinates stable.
 */
export function shiftPanProven(input: {
	readonly beforeTransform: NetworkTransform;
	readonly afterTransform: NetworkTransform;
	readonly beforeRotation: NetworkRotation;
	readonly afterRotation: NetworkRotation;
	readonly beforeNodeWorld: NetworkWorldPosition;
	readonly afterNodeWorld: NetworkWorldPosition;
	readonly transformTolerance?: number;
	readonly rotationTolerance?: number;
	readonly nodeTolerance?: number;
}): boolean {
	const transformTolerance = input.transformTolerance ?? DEFAULT_TRANSFORM_TOLERANCE;
	const rotationTolerance = input.rotationTolerance ?? DEFAULT_ROTATION_TOLERANCE;
	const nodeTolerance = input.nodeTolerance ?? DEFAULT_NODE_TOLERANCE;

	const transformMoved = Math.hypot(
		input.afterTransform.x - input.beforeTransform.x,
		input.afterTransform.y - input.beforeTransform.y,
	) > transformTolerance;

	if (!transformMoved) {
		return false;
	}

	if (!cameraRotationStable(input.beforeRotation, input.afterRotation, rotationTolerance)) {
		return false;
	}

	const nodeDelta = Math.hypot(
		input.afterNodeWorld.x - input.beforeNodeWorld.x,
		input.afterNodeWorld.y - input.beforeNodeWorld.y,
	);
	const nodeZDelta = Math.abs((input.afterNodeWorld.z ?? 0) - (input.beforeNodeWorld.z ?? 0));
	return nodeDelta <= nodeTolerance && nodeZDelta <= nodeTolerance;
}

/**
 * Pointer capture must release after gesture completion.
 */
export function pointerCaptureLifecycleProven(input: {
	readonly hasPointerCaptureAfterRelease: boolean;
	readonly hasPointerCaptureOnBody?: boolean;
}): boolean {
	if (input.hasPointerCaptureAfterRelease) {
		return false;
	}
	if (input.hasPointerCaptureOnBody) {
		return false;
	}
	return true;
}

/**
 * Semantic zoom requires zoom-scale change plus a real LOD/label/edge/bounds response.
 * A lone transform.k change without semantic deltas fails closed.
 */
export function semanticZoomProven(
	before: NetworkRenderMetricsSnapshot,
	after: NetworkRenderMetricsSnapshot,
	options?: {
		readonly zoomTolerance?: number;
		readonly boundsTolerance?: number;
	},
): boolean {
	const zoomTolerance = options?.zoomTolerance ?? 0.0001;
	if (!before?.transform || !after?.transform) {
		return false;
	}
	if (!Number.isFinite(before.transform.k) || !Number.isFinite(after.transform.k)) {
		return false;
	}

	const zoomChanged = Math.abs(after.transform.k - before.transform.k) > zoomTolerance;
	if (!zoomChanged) {
		return false;
	}

	const lodChanged = before.lodTier !== after.lodTier;
	const labelsBefore = before.labelCount ?? before.labelsDrawn ?? 0;
	const labelsAfter = after.labelCount ?? after.labelsDrawn ?? 0;
	const labelsChanged = labelsBefore !== labelsAfter;
	const edgesChanged = (before.edgesDrawn ?? 0) !== (after.edgesDrawn ?? 0);
	const boundsMeaningfullyChanged = boundsChanged(
		before.projectedBounds,
		after.projectedBounds,
		options?.boundsTolerance,
	);

	const semanticDelta = lodChanged || labelsChanged || edgesChanged || boundsMeaningfullyChanged;
	if (!semanticDelta) {
		return false;
	}

	return Boolean(
		after.projectedBounds
		&& before.projectedBounds
		&& Number.isFinite(after.screenUtilization)
		&& (after.screenUtilization ?? 0) > 0,
	);
}

/**
 * Label density must be positive and bounded by rendered node count.
 */
export function labelDensityProven(metrics: {
	readonly labelsDrawn?: number;
	readonly labelCount?: number;
	readonly nodesDrawn?: number;
} | null | undefined): boolean {
	if (!metrics) {
		return false;
	}
	const labels = metrics.labelCount ?? metrics.labelsDrawn ?? 0;
	const nodes = metrics.nodesDrawn ?? 0;
	if (!Number.isFinite(labels) || !Number.isFinite(nodes)) {
		return false;
	}
	return labels > 0 && nodes > 0 && labels <= nodes;
}

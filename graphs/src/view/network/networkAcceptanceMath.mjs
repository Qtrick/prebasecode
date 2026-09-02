/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Canonical executable network acceptance math (single source for unit tests + live harness).
 *--------------------------------------------------------------------------------------------*/

const DEFAULT_ROTATION_TOLERANCE = 0.01;
const DEFAULT_NODE_TOLERANCE = 0.001;
const DEFAULT_TRANSFORM_TOLERANCE = 0.5;

function finiteRotation(rotation) {
	return Boolean(
		rotation
		&& Number.isFinite(rotation.yaw)
		&& Number.isFinite(rotation.pitch),
	);
}

function boundsChanged(before, after, tolerance = 0.5) {
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

/** Returns true only when both yaw and pitch remain within tolerance. */
export function cameraRotationStable(before, after, tolerance = DEFAULT_ROTATION_TOLERANCE) {
	if (!finiteRotation(before) || !finiteRotation(after)) {
		return false;
	}
	return Math.abs(after.yaw - before.yaw) <= tolerance
		&& Math.abs(after.pitch - before.pitch) <= tolerance;
}

/** Returns true when orbit motion is proven on at least one axis. */
export function rotationProven(before, after, minDelta = 0.005) {
	if (!finiteRotation(before) || !finiteRotation(after)) {
		return false;
	}
	const yawDelta = Math.abs(after.yaw - before.yaw);
	const pitchDelta = Math.abs(after.pitch - before.pitch);
	return yawDelta > minDelta || pitchDelta > minDelta;
}

function finiteWorldPosition(pos) {
	return Boolean(
		pos
		&& Number.isFinite(pos.x)
		&& Number.isFinite(pos.y)
		&& Number.isFinite(pos.z),
	);
}

function finiteTransform(transform) {
	return Boolean(
		transform
		&& Number.isFinite(transform.x)
		&& Number.isFinite(transform.y),
	);
}

/** Shift-pan must move viewport transform while camera rotation and node world stay stable. */
export function shiftPanProven(input) {
	if (!finiteTransform(input.beforeTransform) || !finiteTransform(input.afterTransform)) {
		return false;
	}
	if (!finiteRotation(input.beforeRotation) || !finiteRotation(input.afterRotation)) {
		return false;
	}
	if (!finiteWorldPosition(input.beforeNodeWorld) || !finiteWorldPosition(input.afterNodeWorld)) {
		return false;
	}

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
	const nodeZDelta = Math.abs(input.afterNodeWorld.z - input.beforeNodeWorld.z);
	return nodeDelta <= nodeTolerance && nodeZDelta <= nodeTolerance;
}

/** Pointer capture must release after gesture completion. */
export function pointerCaptureLifecycleProven(input) {
	if (input.hasPointerCaptureAfterRelease) {
		return false;
	}
	if (input.hasPointerCaptureOnBody) {
		return false;
	}
	if (input.captureAcquired !== true) {
		return false;
	}
	if (input.captureReleased !== true && input.pointerCaptureReleased !== true) {
		return false;
	}
	return true;
}

/** Semantic zoom requires transform.k change plus LOD/label/edge/bounds response. */
export function semanticZoomProven(before, after, options = {}) {
	const zoomTolerance = options.zoomTolerance ?? 0.0001;
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
		options.boundsTolerance,
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

function labelCountFromMetrics(metrics) {
	return metrics.labelCount ?? metrics.labelsDrawn ?? 0;
}

function nodesDrawnFromMetrics(metrics) {
	return metrics.nodesDrawn ?? 0;
}

/** Single-snapshot sanity: labels present and bounded by rendered nodes. */
export function labelDensitySnapshotProven(metrics) {
	if (!metrics) {
		return false;
	}
	const labels = labelCountFromMetrics(metrics);
	const nodes = nodesDrawnFromMetrics(metrics);
	if (!Number.isFinite(labels) || !Number.isFinite(nodes)) {
		return false;
	}
	return labels > 0 && nodes > 0 && labels <= nodes;
}

/**
 * Multi-zoom label LOD: requires distinct zoom levels with a real labelsDrawn delta.
 * LOD tier changes alone are insufficient — the network renderer contract keys off placed labels.
 */
export function labelDensityProven(metricsOrSamples) {
	const samples = Array.isArray(metricsOrSamples) ? metricsOrSamples : [metricsOrSamples];
	if (!samples.length) {
		return false;
	}
	for (const sample of samples) {
		if (!labelDensitySnapshotProven(sample)) {
			return false;
		}
	}
	if (samples.length === 1) {
		return true;
	}

	const ks = samples.map(sample => sample.transform?.k).filter(k => Number.isFinite(k));
	const uniqueK = new Set(ks.map(k => Math.round(k * 1000) / 1000));
	if (uniqueK.size < 2) {
		return false;
	}

	const labelCounts = samples.map(labelCountFromMetrics);
	const minLabels = Math.min(...labelCounts);
	const maxLabels = Math.max(...labelCounts);
	return maxLabels > minLabels;
}

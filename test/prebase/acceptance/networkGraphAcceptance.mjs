#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Live harness mirror of graphs/src/view/network/networkAcceptanceMath.ts
 *--------------------------------------------------------------------------------------------*/

export function cameraRotationStable(before, after, tolerance = 0.01) {
	if (!before || !after || !Number.isFinite(before.yaw) || !Number.isFinite(after.yaw)
		|| !Number.isFinite(before.pitch) || !Number.isFinite(after.pitch)) {
		return false;
	}
	return Math.abs(after.yaw - before.yaw) <= tolerance
		&& Math.abs(after.pitch - before.pitch) <= tolerance;
}

export function rotationProven(before, after, minDelta = 0.005) {
	if (!before || !after || !Number.isFinite(before.yaw) || !Number.isFinite(after.yaw)
		|| !Number.isFinite(before.pitch) || !Number.isFinite(after.pitch)) {
		return false;
	}
	return Math.abs(after.yaw - before.yaw) > minDelta || Math.abs(after.pitch - before.pitch) > minDelta;
}

export function worldPositionFinite(hit) {
	if (!hit) {
		return false;
	}
	const x = hit.worldX ?? hit.world?.x;
	const y = hit.worldY ?? hit.world?.y;
	const z = hit.worldZ ?? hit.world?.z;
	return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

export function worldDisplacement(hitBefore, hitAfter, epsilon = 0.001) {
	if (!worldPositionFinite(hitBefore) || !worldPositionFinite(hitAfter)) {
		return null;
	}
	const bx = hitBefore.worldX ?? hitBefore.world.x;
	const by = hitBefore.worldY ?? hitBefore.world.y;
	const bz = hitBefore.worldZ ?? hitBefore.world.z;
	const ax = hitAfter.worldX ?? hitAfter.world.x;
	const ay = hitAfter.worldY ?? hitAfter.world.y;
	const az = hitAfter.worldZ ?? hitAfter.world.z;
	return Math.hypot(ax - bx, ay - by, az - bz);
}

export function shiftPanProven(input) {
	const transformTolerance = input.transformTolerance ?? 0.5;
	const rotationTolerance = input.rotationTolerance ?? 0.01;
	const nodeTolerance = input.nodeTolerance ?? 0.001;
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

export function pointerCaptureLifecycleProven(input) {
	if (input.hasPointerCaptureAfterRelease) {
		return false;
	}
	if (input.hasPointerCaptureOnBody) {
		return false;
	}
	return true;
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

export function semanticZoomProven(before, after, options = {}) {
	const zoomTolerance = options.zoomTolerance ?? 0.0001;
	if (!before?.transform || !after?.transform) {
		return false;
	}
	if (!Number.isFinite(before.transform.k) || !Number.isFinite(after.transform.k)) {
		return false;
	}
	if (Math.abs(after.transform.k - before.transform.k) <= zoomTolerance) {
		return false;
	}
	const lodChanged = before.lodTier !== after.lodTier;
	const labelsBefore = before.labelCount ?? before.labelsDrawn ?? 0;
	const labelsAfter = after.labelCount ?? after.labelsDrawn ?? 0;
	const semanticDelta = lodChanged
		|| labelsBefore !== labelsAfter
		|| (before.edgesDrawn ?? 0) !== (after.edgesDrawn ?? 0)
		|| boundsChanged(before.projectedBounds, after.projectedBounds, options.boundsTolerance);
	if (!semanticDelta) {
		return false;
	}
	return Boolean(after.projectedBounds && before.projectedBounds
		&& Number.isFinite(after.screenUtilization) && after.screenUtilization > 0);
}

export function labelDensityProven(metrics) {
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

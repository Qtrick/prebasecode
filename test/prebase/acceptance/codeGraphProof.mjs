#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Fail-closed proof helpers for Code Graph live acceptance (Campaign XII).
 *--------------------------------------------------------------------------------------------*/

/** Node hit includes canonical world-space coordinates, not just screen projection. */
export function nodeHitHasWorldCoords(hit) {
	return Boolean(
		hit &&
		typeof hit.id === 'string' &&
		Number.isFinite(hit.worldX) &&
		Number.isFinite(hit.worldY) &&
		Number.isFinite(hit.worldZ),
	);
}

/** Unselected-node drag must leave world XYZ invariant (fail-closed on missing coords). */
export function worldInvarianceProven(hitBefore, hitAfter, maxDisplacement = 0.001) {
	if (!nodeHitHasWorldCoords(hitBefore) || !nodeHitHasWorldCoords(hitAfter)) {
		return false;
	}
	const displacement = Math.hypot(
		hitAfter.worldX - hitBefore.worldX,
		hitAfter.worldY - hitBefore.worldY,
		hitAfter.worldZ - hitBefore.worldZ,
	);
	return Number.isFinite(displacement) && displacement <= maxDisplacement;
}

/** Selected-node drag must move world XYZ; screen-only delta is a false-green. */
export function worldDragProven(hitBefore, hitAfter, minWorldDelta = 0.5) {
	if (!nodeHitHasWorldCoords(hitBefore) || !nodeHitHasWorldCoords(hitAfter)) {
		return false;
	}
	const worldDelta = Math.hypot(
		hitAfter.worldX - hitBefore.worldX,
		hitAfter.worldY - hitBefore.worldY,
		hitAfter.worldZ - hitBefore.worldZ,
	);
	if (worldDelta <= minWorldDelta) {
		return false;
	}
	// Reject false-greens where only screen coords moved while world stayed fixed.
	const screenDelta = Math.hypot(
		(hitAfter.x ?? 0) - (hitBefore.x ?? 0),
		(hitAfter.y ?? 0) - (hitBefore.y ?? 0),
	);
	const worldMoved = worldDelta > 0.01;
	const screenOnly = screenDelta > 1 && worldDelta < 0.01;
	return worldMoved && !screenOnly;
}

/** Camera rotate gesture must change both yaw and pitch (horizontal + vertical components). */
export function rotationProven(before, after, minDelta = 0.005) {
	const yawDelta = Math.abs(Number(after?.yaw ?? 0) - Number(before?.yaw ?? 0));
	const pitchDelta = Math.abs(Number(after?.pitch ?? 0) - Number(before?.pitch ?? 0));
	return yawDelta > minDelta && pitchDelta > minDelta;
}

/** Idle selection lock must freeze both yaw and pitch. */
export function selectionRotationLockProven(picked, atSelection, afterWait, tolerance = 0.05) {
	if (!picked) {
		return false;
	}
	const yawLocked = Math.abs(Number(afterWait?.yaw ?? 0) - Number(atSelection?.yaw ?? 0)) < tolerance;
	const pitchLocked = Math.abs(Number(afterWait?.pitch ?? 0) - Number(atSelection?.pitch ?? 0)) < tolerance;
	return yawLocked && pitchLocked;
}

/** Shift+drag pan must move the viewport transform, not merely rotate. */
export function shiftPanProven(beforeTransform, afterTransform, minDelta = 2) {
	const bx = Number(beforeTransform?.x);
	const by = Number(beforeTransform?.y);
	const ax = Number(afterTransform?.x);
	const ay = Number(afterTransform?.y);
	if (![bx, by, ax, ay].every(Number.isFinite)) {
		return false;
	}
	return Math.abs(ax - bx) > minDelta || Math.abs(ay - by) > minDelta;
}

/** Semantic zoom must prove LOD or scale change across zoom in/out, not static bounds alone. */
export function semanticZoomLodProven(beforeMetrics, afterZoomIn, afterZoomOut) {
	const kIn = Number(afterZoomIn?.transform?.k ?? afterZoomIn?.k);
	const kOut = Number(afterZoomOut?.transform?.k ?? afterZoomOut?.k);
	const kBefore = Number(beforeMetrics?.transform?.k ?? beforeMetrics?.k);
	const zoomedIn = Number.isFinite(kBefore) && Number.isFinite(kIn) && kIn > kBefore + 0.02;
	const zoomedOut = Number.isFinite(kIn) && Number.isFinite(kOut) && kOut < kIn - 0.02;
	const lodChanged = Boolean(
		beforeMetrics?.lodTier &&
		afterZoomIn?.lodTier &&
		(beforeMetrics.lodTier !== afterZoomIn.lodTier || afterZoomIn.lodTier !== afterZoomOut?.lodTier),
	);
	return (zoomedIn && zoomedOut) || lodChanged;
}

/** Dynamic label density must drop when zooming out, not merely be > 0. */
export function labelDensityDynamicProven(beforeMetrics, afterZoomOut) {
	const beforeCount = Number(beforeMetrics?.labelCount ?? beforeMetrics?.labelsDrawn);
	const afterCount = Number(afterZoomOut?.labelCount ?? afterZoomOut?.labelsDrawn);
	return Number.isFinite(beforeCount) && Number.isFinite(afterCount) && beforeCount > 0 && afterCount < beforeCount;
}

/** Pointer capture must be on the graph canvas element, not document. */
export function pointerCaptureOnCanvasProven(captureHost) {
	return captureHost === 'netCanvas' || captureHost === '#netCanvas';
}

export function startupOnboardingProven(result) {
	return Boolean(
		result &&
		typeof result === 'object' &&
		typeof result.onboardingDismissed === 'boolean' &&
		typeof result.onboardingVisible === 'boolean',
	);
}

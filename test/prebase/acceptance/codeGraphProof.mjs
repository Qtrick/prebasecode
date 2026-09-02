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

/** Idle selection lock must freeze both yaw and pitch. */
export function selectionRotationLockProven(picked, atSelection, afterWait, tolerance = 0.05) {
	if (!picked) {
		return false;
	}
	if (!atSelection || !afterWait || !Number.isFinite(atSelection.yaw) || !Number.isFinite(atSelection.pitch)
		|| !Number.isFinite(afterWait.yaw) || !Number.isFinite(afterWait.pitch)) {
		return false;
	}
	const yawLocked = Math.abs(afterWait.yaw - atSelection.yaw) < tolerance;
	const pitchLocked = Math.abs(afterWait.pitch - atSelection.pitch) < tolerance;
	return yawLocked && pitchLocked;
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

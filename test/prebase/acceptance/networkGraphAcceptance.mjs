#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Graph live harness helpers + re-exports from canonical networkAcceptanceMath.mjs.
 *--------------------------------------------------------------------------------------------*/

export {
	cameraRotationStable,
	rotationProven,
	shiftPanProven,
	pointerCaptureLifecycleProven,
	semanticZoomProven,
	labelDensityProven,
	labelDensitySnapshotProven,
} from '../../../graphs/src/view/network/networkAcceptanceMath.mjs';

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

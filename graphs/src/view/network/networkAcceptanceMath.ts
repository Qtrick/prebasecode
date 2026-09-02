/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Type surface for canonical networkAcceptanceMath.mjs (implementation lives in .mjs).
 *--------------------------------------------------------------------------------------------*/

export type {
	NetworkRotation,
	NetworkTransform,
	NetworkWorldPosition,
	NetworkRenderMetricsSnapshot,
} from './networkAcceptanceMathTypes.js';

export {
	cameraRotationStable,
	rotationProven,
	shiftPanProven,
	pointerCaptureLifecycleProven,
	semanticZoomProven,
	labelDensityProven,
	labelDensitySnapshotProven,
} from './networkAcceptanceMath.mjs';

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	cameraRotationStable,
	rotationProven,
	shiftPanProven,
	pointerCaptureLifecycleProven,
	semanticZoomProven,
	labelDensityProven,
	labelDensitySnapshotProven,
	type NetworkRenderMetricsSnapshot,
} from '../../view/network/networkAcceptanceMath.js';

suite('NetworkAcceptanceMath (Unit - Live Acceptance Truth)', () => {
	const baseRotation = { yaw: 0.55, pitch: 0.28 };

	suite('cameraRotationStable', () => {
		test('passes when both yaw and pitch remain stable', () => {
			assert.equal(cameraRotationStable(baseRotation, { yaw: 0.5505, pitch: 0.2802 }), true);
		});

		test('fails on yaw-only drift', () => {
			assert.equal(cameraRotationStable(baseRotation, { yaw: 0.72, pitch: 0.28 }), false);
		});

		test('fails on pitch-only drift', () => {
			assert.equal(cameraRotationStable(baseRotation, { yaw: 0.55, pitch: 0.41 }), false);
		});

		test('fails when coordinates are missing', () => {
			assert.equal(cameraRotationStable(baseRotation, { yaw: Number.NaN, pitch: 0.28 }), false);
			assert.equal(cameraRotationStable(undefined, baseRotation), false);
		});
	});

	suite('rotationProven', () => {
		test('passes for yaw-only orbit above minDelta', () => {
			assert.equal(rotationProven({ yaw: 0.1, pitch: 0.2 }, { yaw: 0.2, pitch: 0.2 }), true);
		});

		test('passes for pitch-only orbit above minDelta', () => {
			assert.equal(rotationProven({ yaw: 0.1, pitch: 0.2 }, { yaw: 0.1, pitch: 0.35 }), true);
		});

		test('fails when neither axis exceeds minDelta', () => {
			assert.equal(rotationProven(baseRotation, { yaw: 0.5501, pitch: 0.2801 }), false);
			assert.equal(rotationProven({ yaw: 0.1, pitch: 0.2 }, { yaw: 0.105, pitch: 0.204 }), false);
		});

		test('fails closed when rotation coordinates are missing or non-finite', () => {
			assert.equal(rotationProven(undefined, baseRotation), false);
			assert.equal(rotationProven(baseRotation, { yaw: Number.NaN, pitch: 0.28 }), false);
		});

		test('uses strict greater-than at minDelta boundary', () => {
			assert.equal(rotationProven({ yaw: 0, pitch: 0 }, { yaw: 0.005, pitch: 0 }), false);
			assert.equal(rotationProven({ yaw: 0, pitch: 0 }, { yaw: 0.0051, pitch: 0 }), true);
		});

		test('single-axis orbit passes rotationProven but fails cameraRotationStable', () => {
			const before = { yaw: 0.1, pitch: 0.2 };
			const yawOnlyAfter = { yaw: 0.2, pitch: 0.2 };
			assert.equal(rotationProven(before, yawOnlyAfter), true);
			assert.equal(cameraRotationStable(before, yawOnlyAfter), false);
		});
	});

	suite('shiftPanProven', () => {
		const baseTransform = { x: 10, y: 20, k: 1.0 };
		const nodeWorld = { x: 120, y: -40, z: 5 };

		test('passes when transform moved with stable camera and node', () => {
			assert.equal(shiftPanProven({
				beforeTransform: baseTransform,
				afterTransform: { x: 48, y: 62, k: 1.0 },
				beforeRotation: baseRotation,
				afterRotation: baseRotation,
				beforeNodeWorld: nodeWorld,
				afterNodeWorld: nodeWorld,
			}), true);
		});

		test('fails when rotation occurs during pan', () => {
			assert.equal(shiftPanProven({
				beforeTransform: baseTransform,
				afterTransform: { x: 48, y: 62, k: 1.0 },
				beforeRotation: baseRotation,
				afterRotation: { yaw: 0.90, pitch: 0.28 },
				beforeNodeWorld: nodeWorld,
				afterNodeWorld: nodeWorld,
			}), false);
		});
	});

	suite('pointerCaptureLifecycleProven', () => {
		test('passes when capture is released after gesture', () => {
			assert.equal(pointerCaptureLifecycleProven({
				hasPointerCaptureAfterRelease: false,
				hasPointerCaptureOnBody: false,
			}), true);
		});

		test('fails when pointer capture remains stuck', () => {
			assert.equal(pointerCaptureLifecycleProven({
				hasPointerCaptureAfterRelease: true,
			}), false);
			assert.equal(pointerCaptureLifecycleProven({
				hasPointerCaptureAfterRelease: false,
				hasPointerCaptureOnBody: true,
			}), false);
		});
	});

	suite('semanticZoomProven', () => {
		function metrics(overrides: Partial<NetworkRenderMetricsSnapshot>): NetworkRenderMetricsSnapshot {
			return {
				transform: { x: 0, y: 0, k: 1.0 },
				lodTier: 'medium',
				labelsDrawn: 12,
				edgesDrawn: 40,
				projectedBounds: { minX: 0, minY: 0, maxX: 400, maxY: 300, width: 400, height: 300 },
				screenUtilization: 0.42,
				...overrides,
			};
		}

		test('fails when k changes alone without semantic deltas', () => {
			const before = metrics({ transform: { x: 0, y: 0, k: 0.8 } });
			const after = metrics({ transform: { x: 0, y: 0, k: 1.2 } });
			assert.equal(semanticZoomProven(before, after), false);
		});

		test('passes when zoom change is accompanied by LOD transition', () => {
			const before = metrics({ transform: { x: 0, y: 0, k: 0.25 }, lodTier: 'low' });
			const after = metrics({ transform: { x: 0, y: 0, k: 0.95 }, lodTier: 'high' });
			assert.equal(semanticZoomProven(before, after), true);
		});

		test('passes when zoom change updates projected bounds', () => {
			const before = metrics({
				transform: { x: 0, y: 0, k: 0.5 },
				projectedBounds: { minX: 0, minY: 0, maxX: 200, maxY: 150, width: 200, height: 150 },
			});
			const after = metrics({
				transform: { x: 0, y: 0, k: 1.5 },
				projectedBounds: { minX: 10, minY: 20, maxX: 620, maxY: 480, width: 610, height: 460 },
			});
			assert.equal(semanticZoomProven(before, after), true);
		});
	});

	suite('labelDensityProven', () => {
		test('passes single-snapshot sanity when labels are drawn within node budget', () => {
			assert.equal(labelDensitySnapshotProven({ nodesDrawn: 120, labelsDrawn: 18 }), true);
			assert.equal(labelDensitySnapshotProven({ nodesDrawn: 120, labelCount: 18 }), true);
			assert.equal(labelDensityProven({ nodesDrawn: 120, labelsDrawn: 18 }), true);
		});

		test('fails when labels are absent or exceed node count', () => {
			assert.equal(labelDensitySnapshotProven({ nodesDrawn: 120, labelsDrawn: 0 }), false);
			assert.equal(labelDensitySnapshotProven({ nodesDrawn: 10, labelsDrawn: 25 }), false);
			assert.equal(labelDensityProven(null), false);
			assert.equal(labelDensityProven({ nodesDrawn: 120, labelsDrawn: 0 }), false);
		});

		test('requires multi-zoom semantic progression when multiple samples are provided', () => {
			assert.equal(labelDensityProven([
				{ nodesDrawn: 120, labelsDrawn: 24, transform: { x: 0, y: 0, k: 0.4 }, lodTier: 'low' },
				{ nodesDrawn: 120, labelsDrawn: 12, transform: { x: 0, y: 0, k: 1.1 }, lodTier: 'high' },
			]), true);
			assert.equal(labelDensityProven([
				{ nodesDrawn: 120, labelsDrawn: 12, transform: { x: 0, y: 0, k: 0.8 }, lodTier: 'medium' },
				{ nodesDrawn: 120, labelsDrawn: 12, transform: { x: 0, y: 0, k: 0.81 }, lodTier: 'medium' },
			]), false);
		});
	});
});

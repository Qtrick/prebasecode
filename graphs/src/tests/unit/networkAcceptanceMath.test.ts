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

		test('fails closed when transform or node world coordinates are missing or non-finite', () => {
			assert.equal(shiftPanProven({
				beforeTransform: baseTransform,
				afterTransform: { x: 48, y: 62, k: 1.0 },
				beforeRotation: baseRotation,
				afterRotation: baseRotation,
				beforeNodeWorld: { x: 120, y: -40 },
				afterNodeWorld: nodeWorld,
			}), false, 'missing z must not coerce to zero');
			assert.equal(shiftPanProven({
				beforeTransform: baseTransform,
				afterTransform: { x: Number.NaN, y: 62, k: 1.0 },
				beforeRotation: baseRotation,
				afterRotation: baseRotation,
				beforeNodeWorld: nodeWorld,
				afterNodeWorld: nodeWorld,
			}), false);
			assert.equal(shiftPanProven({
				beforeTransform: baseTransform,
				afterTransform: { x: 48, y: 62, k: 1.0 },
				beforeRotation: baseRotation,
				afterRotation: baseRotation,
				beforeNodeWorld: { x: 120, y: -40, z: Number.NaN },
				afterNodeWorld: nodeWorld,
			}), false);
			assert.equal(shiftPanProven({
				beforeTransform: baseTransform,
				afterTransform: { x: 48, y: 62, k: 1.0 },
				beforeRotation: baseRotation,
				afterRotation: baseRotation,
				beforeNodeWorld: nodeWorld,
				afterNodeWorld: { x: 120, y: Number.POSITIVE_INFINITY, z: 5 },
			}), false, 'Infinity world coordinates must fail');
		});

		test('passes with stable finite XYZ world coordinates within tolerance', () => {
			assert.equal(shiftPanProven({
				beforeTransform: baseTransform,
				afterTransform: { x: 48, y: 62, k: 1.0 },
				beforeRotation: baseRotation,
				afterRotation: baseRotation,
				beforeNodeWorld: nodeWorld,
				afterNodeWorld: { x: 120.0005, y: -39.9995, z: 5.0002 },
			}), true);
		});
	});

	suite('pointerCaptureLifecycleProven', () => {
		const releasedGesture = {
			hasPointerCaptureAfterRelease: false,
			hasPointerCaptureOnBody: false,
			captureAcquired: true,
			captureReleased: true,
			pointerCaptureReleased: true,
		};

		test('passes when capture is released after gesture with acquisition proof', () => {
			assert.equal(pointerCaptureLifecycleProven(releasedGesture), true);
		});

		test('fails closed when capture was never acquired', () => {
			assert.equal(pointerCaptureLifecycleProven({
				...releasedGesture,
				captureAcquired: false,
			}), false);
			assert.equal(pointerCaptureLifecycleProven({
				hasPointerCaptureAfterRelease: false,
				hasPointerCaptureOnBody: false,
				captureReleased: true,
				pointerCaptureReleased: true,
			}), false, 'missing acquisition must fail even when release flags are set');
		});

		test('fails closed when release was not recorded on stale metrics', () => {
			assert.equal(pointerCaptureLifecycleProven({
				hasPointerCaptureAfterRelease: false,
				hasPointerCaptureOnBody: false,
				captureAcquired: true,
				captureReleased: false,
				pointerCaptureReleased: false,
			}), false);
		});

		test('fails when pointer capture remains stuck on canvas or body', () => {
			assert.equal(pointerCaptureLifecycleProven({
				...releasedGesture,
				hasPointerCaptureAfterRelease: true,
			}), false);
			assert.equal(pointerCaptureLifecycleProven({
				...releasedGesture,
				hasPointerCaptureOnBody: true,
			}), false);
		});

		test('fails when stuck capture is checked against wrong pointer id (false negative on release)', () => {
			// Simulates live harness reading hasPointerCapture(staleId) while canvas still holds the active id.
			assert.equal(pointerCaptureLifecycleProven({
				captureAcquired: true,
				captureReleased: true,
				pointerCaptureReleased: true,
				hasPointerCaptureAfterRelease: true,
				hasPointerCaptureOnBody: false,
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

		test('fails when only LOD tier changes without labelsDrawn delta', () => {
			assert.equal(labelDensityProven([
				{ nodesDrawn: 120, labelsDrawn: 12, transform: { x: 0, y: 0, k: 0.25 }, lodTier: 'low' },
				{ nodesDrawn: 120, labelsDrawn: 12, transform: { x: 0, y: 0, k: 1.2 }, lodTier: 'high' },
			]), false, 'network renderer contract keys off placed labels, not lodTier alone');
		});

		test('edges alone must not prove label density at multiple zoom levels', () => {
			const edgeOnlySamples = [
				{ nodesDrawn: 120, labelsDrawn: 12, transform: { x: 0, y: 0, k: 0.4 }, lodTier: 'medium', edgesDrawn: 80 },
				{ nodesDrawn: 120, labelsDrawn: 12, transform: { x: 0, y: 0, k: 1.1 }, lodTier: 'medium', edgesDrawn: 220 },
			];
			assert.equal(labelDensityProven(edgeOnlySamples), false);
			assert.equal(semanticZoomProven(edgeOnlySamples[0], edgeOnlySamples[1]), false,
				'edge-only deltas must not satisfy semantic zoom either');
		});

		test('label-specific LOD progression passes when label counts change across zoom', () => {
			assert.equal(labelDensityProven([
				{ nodesDrawn: 200, labelsDrawn: 6, transform: { x: 0, y: 0, k: 0.25 }, lodTier: 'low' },
				{ nodesDrawn: 200, labelsDrawn: 48, transform: { x: 0, y: 0, k: 1.2 }, lodTier: 'high', edgesDrawn: 40 },
			]), true);
		});
	});
});

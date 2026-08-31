/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { suite, test } from 'mocha';
import assert from 'node:assert/strict';
import {
	normalizeWheelZoomDelta,
	computeContinuousZoomFactor,
	applyZoomAroundCursor,
	applyZoomAroundCenter,
	computeGraphBounds,
	computeCenterLockedTransform,
	isCenterDeadZone,
	interpolateViewport,
	easeOutCubic,
	DOM_DELTA_PIXEL,
	DOM_DELTA_LINE,
	DOM_DELTA_PAGE,
	MIN_ZOOM,
	MAX_ZOOM,
} from '../../view/viewport/graphViewportMath.js';

suite('GraphViewportMath (Unit - Viewport & Interaction Mathematics)', () => {
	test('1. Pixel trackpad deltas produce tiny proportionate zoom changes without runaway', () => {
		// Single tiny trackpad tick (e.g. -0.2px)
		const deltaTiny = normalizeWheelZoomDelta({ deltaY: -0.2, deltaMode: DOM_DELTA_PIXEL });
		const factorTiny = computeContinuousZoomFactor(deltaTiny);

		// Must be very close to 1.0 (sub-0.1% change), NOT an abrupt 10% jump (1.10)
		assert.ok(factorTiny > 1.0 && factorTiny < 1.001, `factor ${factorTiny} must be subtly above 1.0`);

		// Medium trackpad scroll (-15px)
		const deltaMed = normalizeWheelZoomDelta({ deltaY: -15, deltaMode: DOM_DELTA_PIXEL });
		const factorMed = computeContinuousZoomFactor(deltaMed);
		assert.ok(factorMed > 1.02 && factorMed < 1.04, `factor ${factorMed} should be ~1.026`);

		// Negative vs positive delta symmetry
		const deltaZoomOut = normalizeWheelZoomDelta({ deltaY: 15, deltaMode: DOM_DELTA_PIXEL });
		const factorZoomOut = computeContinuousZoomFactor(deltaZoomOut);
		assert.ok(Math.abs(factorMed * factorZoomOut - 1.0) < 0.001, 'zoom in and zoom out factors must be multiplicative inverses');
	});

	test('2. Rapid 50-event trackpad stream behaves smoothly without infinite runaway', () => {
		let currentK = 1.0;
		let currentOldK = 1.0;

		// Simulate 50 small trackpad ticks (-0.5px each)
		for (let i = 0; i < 50; i++) {
			// New normalized algorithm
			const delta = normalizeWheelZoomDelta({ deltaY: -0.5, deltaMode: DOM_DELTA_PIXEL, sensitivity: 1.0 });
			const factor = computeContinuousZoomFactor(delta);
			currentK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentK * factor));

			// Old broken algorithm (sign-only 1.1x per tick)
			currentOldK = Math.min(MAX_ZOOM, currentOldK * 1.1);
		}

		// Old algorithm hits maxZoom (3.5x) or runaway after only 13 ticks (1.1^13 > 3.45)
		assert.strictEqual(currentOldK, MAX_ZOOM, 'old algorithm prematurely blew up to maxZoom');

		// New continuous algorithm advanced smoothly: -0.5 * 50 = -25 total px -> 2^(25 * 0.0025) = 2^0.0625 ≈ 1.044x zoom
		assert.ok(currentK > 1.03 && currentK < 1.06, `new algorithm zoom ${currentK} should be smooth (~1.044)`);
	});

	test('3. Mouse wheel line mode and page mode normalization', () => {
		// 1 line notch on mouse wheel (deltaY = -1, deltaMode = LINE)
		const deltaLine = normalizeWheelZoomDelta({ deltaY: -1, deltaMode: DOM_DELTA_LINE });
		const factorLine = computeContinuousZoomFactor(deltaLine);
		// 1 line notch should feel like ~4% zoom
		assert.ok(factorLine > 1.03 && factorLine < 1.06, `line factor ${factorLine} should be ~1.042`);

		// Page mode (deltaY = -1, deltaMode = PAGE)
		const deltaPage = normalizeWheelZoomDelta({ deltaY: -1, deltaMode: DOM_DELTA_PAGE });
		const factorPage = computeContinuousZoomFactor(deltaPage);
		assert.ok(Number.isFinite(factorPage) && factorPage <= 2.5, 'page factor must be safely bounded');
	});

	test('4. Pinch gesture with ctrlKey accounts for pinch ratio', () => {
		const deltaNormal = normalizeWheelZoomDelta({ deltaY: -10, deltaMode: DOM_DELTA_PIXEL, ctrlKey: false });
		const deltaPinch = normalizeWheelZoomDelta({ deltaY: -10, deltaMode: DOM_DELTA_PIXEL, ctrlKey: true });

		assert.ok(Math.abs(deltaPinch) > Math.abs(deltaNormal), 'pinch gesture should apply pinch coefficient');
	});

	test('5. Zoom sensitivity scaling (0.5x vs 1.0x vs 2.0x)', () => {
		const deltaLow = normalizeWheelZoomDelta({ deltaY: -20, deltaMode: DOM_DELTA_PIXEL, sensitivity: 0.5 });
		const deltaNorm = normalizeWheelZoomDelta({ deltaY: -20, deltaMode: DOM_DELTA_PIXEL, sensitivity: 1.0 });
		const deltaHigh = normalizeWheelZoomDelta({ deltaY: -20, deltaMode: DOM_DELTA_PIXEL, sensitivity: 2.0 });

		assert.strictEqual(deltaLow * 2, deltaNorm);
		assert.strictEqual(deltaNorm * 2, deltaHigh);
	});

	test('6. Cursor-anchored zoom keeps world point under pointer invariant', () => {
		const initial = { x: 100, y: 80, k: 1.0 };
		const cursor = { x: 400, y: 300 };

		// World point before zoom:
		const worldX = (cursor.x - initial.x) / initial.k; // (400 - 100) / 1 = 300
		const worldY = (cursor.y - initial.y) / initial.k; // (300 - 80) / 1 = 220

		const factor = 1.5;
		const next = applyZoomAroundCursor(initial, factor, cursor.x, cursor.y);

		assert.strictEqual(next.k, 1.5);

		// Projected world point after zoom:
		const screenXAfter = next.x + worldX * next.k;
		const screenYAfter = next.y + worldY * next.k;

		assert.ok(Math.abs(screenXAfter - cursor.x) < 1e-9, 'cursor screen X must remain unchanged');
		assert.ok(Math.abs(screenYAfter - cursor.y) < 1e-9, 'cursor screen Y must remain unchanged');
	});

	test('7. Center-locked transform centers bounds at usable viewport center while preserving zoom', () => {
		const nodes = [
			{ x: -50, y: -20, radius: 10 },
			{ x: 50, y: 80, radius: 10 },
		];

		const bounds = computeGraphBounds(nodes);
		assert.ok(bounds);
		assert.strictEqual(bounds.minX, -60);
		assert.strictEqual(bounds.maxX, 60);
		assert.strictEqual(bounds.minY, -30);
		assert.strictEqual(bounds.maxY, 90);

		const graphCenterX = (bounds.minX + bounds.maxX) / 2; // 0
		const graphCenterY = (bounds.minY + bounds.maxY) / 2; // 30

		const viewportWidth = 800;
		const viewportHeight = 600;
		const currentK = 1.25;

		const centered = computeCenterLockedTransform(bounds, viewportWidth, viewportHeight, currentK);

		assert.strictEqual(centered.k, currentK, 'current zoom must be preserved');
		assert.strictEqual(centered.x, 400 - graphCenterX * currentK); // 400
		assert.strictEqual(centered.y, 300 - graphCenterY * currentK); // 300 - 30 * 1.25 = 262.5

		// Projected centroid screen coordinate:
		const screenCentroidX = centered.x + graphCenterX * centered.k;
		const screenCentroidY = centered.y + graphCenterY * centered.k;
		assert.strictEqual(screenCentroidX, 400);
		assert.strictEqual(screenCentroidY, 300);
	});

	test('8. Center dead-zone prevents micro-jitter repaint triggers', () => {
		const current = { x: 400.0, y: 300.0, k: 1.0 };
		const microMove = { x: 400.2, y: 300.1, k: 1.0 };
		const macroMove = { x: 405.0, y: 300.0, k: 1.0 };

		assert.strictEqual(isCenterDeadZone(current, microMove, 0.5), true, 'sub-pixel shift is dead zone');
		assert.strictEqual(isCenterDeadZone(current, macroMove, 0.5), false, '5px shift is outside dead zone');
	});

	test('9. Smooth viewport interpolation and cubic ease-out', () => {
		const from = { x: 0, y: 0, k: 1.0 };
		const to = { x: 100, y: 200, k: 2.0 };

		const start = interpolateViewport(from, to, easeOutCubic(0));
		assert.strictEqual(start.x, 0);
		assert.strictEqual(start.k, 1.0);

		const mid = interpolateViewport(from, to, easeOutCubic(0.5));
		assert.ok(mid.x > 50, 'ease-out cubic should be past midpoint at t=0.5');

		const end = interpolateViewport(from, to, easeOutCubic(1.0));
		assert.strictEqual(end.x, 100);
		assert.strictEqual(end.y, 200);
		assert.strictEqual(end.k, 2.0);
	});

	test('10. applyZoomAroundCenter anchors zoom at usable viewport center with insets', () => {
		const initial = { x: 100, y: 50, k: 1.0 };
		const width = 800;
		const height = 600;
		const insets = { top: 40, right: 10, bottom: 20, left: 10 };
		// Usable center: cx = 10 + (800 - 20)/2 = 400; cy = 40 + (600 - 60)/2 = 310
		const factor = 2.0;

		const worldCenterX = (400 - initial.x) / initial.k; // 300
		const worldCenterY = (310 - initial.y) / initial.k; // 260

		const next = applyZoomAroundCenter(initial, factor, width, height, MIN_ZOOM, MAX_ZOOM, insets);
		assert.strictEqual(next.k, 2.0);

		const screenCenterXAfter = next.x + worldCenterX * next.k;
		const screenCenterYAfter = next.y + worldCenterY * next.k;

		assert.ok(Math.abs(screenCenterXAfter - 400) < 1e-9, 'usable center X remains invariant');
		assert.ok(Math.abs(screenCenterYAfter - 310) < 1e-9, 'usable center Y remains invariant');
	});
});

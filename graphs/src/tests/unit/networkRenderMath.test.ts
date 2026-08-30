/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	projectPoint3D,
	normalizeDepthScale,
	computeNetworkDepthSizeFactor,
	computeDepthAlpha,
	computeNetworkSemanticWeight,
	computeNetworkVisualRadius,
	computeNetworkPickRadius,
	computeNetworkFitTransform,
	isNetworkLabelEligible,
	type NetworkNodeLike,
} from '../../view/network/networkRenderMath.js';

suite('NetworkRenderMath (Unit - Visual Fidelity & Radius Invariants)', () => {
	test('1. Bounded Depth Scaling: Depth factor strictly clamped in [0.78, 1.28] for extreme depths', () => {
		const extremeDepths = [-100, 0, 0.1, 0.65, 1.0, 1.5, 5.0, 10.0, 1000.0];
		for (const depthScale of extremeDepths) {
			const norm = normalizeDepthScale(depthScale);
			assert.ok(norm >= 0 && norm <= 1, `Normalized depth must be in [0, 1] for depthScale ${depthScale}, got ${norm}`);

			const factor = computeNetworkDepthSizeFactor(depthScale);
			assert.ok(
				factor >= 0.78 && factor <= 1.28,
				`Depth factor must be in [0.78, 1.28] for depthScale ${depthScale}, got ${factor}`
			);

			const alpha = computeDepthAlpha(depthScale);
			assert.ok(
				alpha >= 0.45 && alpha <= 1.0,
				`Depth alpha must be in [0.45, 1.0] for depthScale ${depthScale}, got ${alpha}`
			);
		}
	});

	test('2. Visual Radius Invariants: Ordinary/hub/entry hierarchy with screen-aware zoom', () => {
		const ordinaryNode: NetworkNodeLike = {
			id: 'file:src/utils/math.ts',
			label: 'math.ts',
			path: 'src/utils/math.ts',
			degree: 1,
			importance: 0.1,
		};

		const hubNode: NetworkNodeLike = {
			id: 'file:src/index.ts',
			label: 'index.ts',
			path: 'src/index.ts',
			degree: 28,
			importance: 0.95,
		};

		const entryNode: NetworkNodeLike = {
			id: 'file:src/main.ts',
			label: 'main.ts',
			path: 'src/main.ts',
			isEntry: true,
		};

		assert.equal(computeNetworkSemanticWeight(entryNode), 10);
		assert.ok(computeNetworkSemanticWeight(hubNode) > 2.0);

		// At zoom=1, world radius ≈ intended screen base size.
		for (const depthScale of [0.7, 1.0, 1.3]) {
			const ordR = computeNetworkVisualRadius(ordinaryNode, depthScale, { entryNodeId: 'file:src/main.ts', zoom: 1 });
			assert.ok(ordR >= 2.8 && ordR <= 7.0, `Ordinary node radius must be readable, got ${ordR} at depthScale ${depthScale}`);

			const hubR = computeNetworkVisualRadius(hubNode, depthScale, { entryNodeId: 'file:src/main.ts', zoom: 1 });
			assert.ok(hubR >= 4.5 && hubR <= 12.0, `Hub node radius must be ~5-12px, got ${hubR} at depthScale ${depthScale}`);

			const entryR = computeNetworkVisualRadius(entryNode, depthScale, { entryNodeId: 'file:src/main.ts', zoom: 1 });
			assert.ok(entryR >= 5.0 && entryR <= 12.0, `Entry node radius must be ~5-12px, got ${entryR} at depthScale ${depthScale}`);

			assert.ok(hubR > ordR, 'Hub must exceed ordinary');
			assert.ok(entryR >= hubR * 0.85, 'Entry must be at least comparable to hub');

			const hoverR = computeNetworkVisualRadius(ordinaryNode, depthScale, { entryNodeId: 'file:src/main.ts', isHovered: true, zoom: 1 });
			assert.ok(hoverR <= 9.0, `Hovered node must not balloon into giant bubble, got ${hoverR}`);

			const selR = computeNetworkVisualRadius(hubNode, depthScale, { entryNodeId: 'file:src/main.ts', isSelected: true, zoom: 1 });
			assert.ok(selR <= 16.0, `Selected hub must not balloon into giant bubble, got ${selR}`);
		}

		// Screen-space contract: ordinary nodes stay above ~2.8px across Fit View zooms.
		for (const zoom of [0.15, 0.25, 0.5, 1, 2, 3.5]) {
			const world = computeNetworkVisualRadius(ordinaryNode, 1.0, { zoom });
			const screen = world * zoom;
			assert.ok(screen >= 2.75 && screen <= 26.5, `ordinary screen radius at k=${zoom} was ${screen}`);
		}
	});

	test('3. Generous Pick Radius: Hit test target is at least 18px and strictly larger than visual radius', () => {
		const node: NetworkNodeLike = {
			id: 'file:src/small.ts',
			label: 'small.ts',
			path: 'src/small.ts',
			degree: 0,
		};

		for (const depthScale of [0.5, 1.0, 1.5]) {
			const visualR = computeNetworkVisualRadius(node, depthScale);
			const pickR = computeNetworkPickRadius(node, depthScale);

			assert.ok(pickR >= 18, `Pick radius must be >= 18px for comfortable clicking, got ${pickR}`);
			assert.ok(pickR > visualR * 2.0, `Pick radius (${pickR}) must exceed visual radius (${visualR}) by comfortable margin`);
		}
	});

	test('4. 3D Projection: Perspective projection maintains depth ordering and positive depthScale', () => {
		const projNear = projectPoint3D(0, 0, -200, 0, 0);
		const projCenter = projectPoint3D(0, 0, 0, 0, 0);
		const projFar = projectPoint3D(0, 0, 200, 0, 0);

		assert.ok(projNear.depthScale > projCenter.depthScale, 'Near point must have larger depth scale than center');
		assert.ok(projCenter.depthScale > projFar.depthScale, 'Center point must have larger depth scale than far');
		assert.ok(projFar.depthScale > 0, 'Far point depth scale must remain positive');
	});

	test('5. Non-Distorting Fit View: Correctly encompasses 280-node / 420-edge topology without zero or NaN transforms', () => {
		const nodes: NetworkNodeLike[] = [];
		const projectedPositions: Record<string, { x: number; y: number; depthScale: number }> = {};

		for (let i = 0; i < 280; i++) {
			const id = `file:src/node_${i}.ts`;
			const node: NetworkNodeLike = {
				id,
				label: `node_${i}.ts`,
				path: `src/node_${i}.ts`,
				degree: i % 10,
				importance: (i % 20) / 20,
			};
			nodes.push(node);

			const angle = (i / 280) * Math.PI * 2 * 8;
			const radius = Math.sqrt(i) * 35;
			projectedPositions[id] = {
				x: Math.cos(angle) * radius,
				y: Math.sin(angle) * radius,
				depthScale: 0.8 + (i % 5) * 0.1,
			};
		}

		const transform = computeNetworkFitTransform(
			nodes,
			projectedPositions,
			1200,
			800,
			{ padding: 72, initialZoom: 1.0 }
		);

		assert.ok(Number.isFinite(transform.k), 'Scale k must be finite');
		assert.ok(Number.isFinite(transform.x), 'Transform X must be finite');
		assert.ok(Number.isFinite(transform.y), 'Transform Y must be finite');
		// Production MIN_ZOOM is 0.15 — do not false-green by requiring a higher floor.
		assert.ok(transform.k >= 0.15 && transform.k <= 2.5, `Scale k (${transform.k}) must be in usable range [0.15, 2.5]`);
	});

	test('6. Label LOD Policy: Overview mode displays only high-importance nodes; deep zoom shows detail', () => {
		const entryNode: NetworkNodeLike = { id: 'file:src/main.ts', isEntry: true };
		const hubNode: NetworkNodeLike = { id: 'file:src/hub.ts', importance: 0.85, degree: 8 };
		const smallNode: NetworkNodeLike = { id: 'file:src/leaf.ts', importance: 0.1, degree: 1 };

		// At overview (zoom k = 0.5):
		assert.ok(isNetworkLabelEligible(entryNode, 0.5, false, { isEntry: true }), 'Entry node should be labeled at k=0.5');
		assert.ok(!isNetworkLabelEligible(smallNode, 0.5, false, {}), 'Leaf node should NOT be labeled at k=0.5');

		// At medium zoom (zoom k = 0.9):
		assert.ok(isNetworkLabelEligible(hubNode, 0.9, false, {}), 'Hub node should be labeled at k=0.9');

		// At overview / normal zoom (zoom k = 1.2):
		assert.ok(!isNetworkLabelEligible(smallNode, 1.2, false, {}), 'Leaf node should NOT be labeled at overview zoom k=1.2');

		// At deep zoom (zoom k = 1.7):
		assert.ok(isNetworkLabelEligible(smallNode, 1.7, false, {}), 'Leaf node should be labeled at deep zoom k=1.7');

		// Hovered and selected are always labeled:
		assert.ok(isNetworkLabelEligible(smallNode, 0.2, false, { isSelected: true }), 'Selected node is always labeled');
		assert.ok(isNetworkLabelEligible(smallNode, 0.2, false, { isHovered: true }), 'Hovered node is always labeled');

		// Moving suppresses non-selected labels:
		assert.ok(!isNetworkLabelEligible(smallNode, 1.5, true, {}), 'Moving suppresses unselected labels');
	});
});

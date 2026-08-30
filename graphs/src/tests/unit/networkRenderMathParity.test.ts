/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import vm from 'node:vm';
import {
	serializeNetworkVisualRadiusSource,
	serializeNetworkFitTransformSource,
	serializeNetworkLabelWorldFontSizeSource,
} from '../../host/workbench/networkRenderMathRuntime.js';
import {
	computeNetworkVisualRadius,
	computeNetworkFitTransform,
	computeNetworkLabelWorldFontSize,
	type NetworkNodeLike,
} from '../../view/network/networkRenderMath.js';

/**
 * Production webview injects serialized copies of network visual/fit math.
 * These tests execute the exact host-injected strings and assert parity with the module.
 */
suite('NetworkRenderMath production parity', () => {
	function loadRuntime() {
		const context = vm.createContext({});
		return vm.runInContext(
			`(() => {
				const computeNetworkVisualRadius = (${serializeNetworkVisualRadiusSource()});
				const computeNetworkFitTransform = (${serializeNetworkFitTransformSource()});
				const computeNetworkLabelWorldFontSize = (${serializeNetworkLabelWorldFontSizeSource()});
				return { computeNetworkVisualRadius, computeNetworkFitTransform, computeNetworkLabelWorldFontSize };
			})()`,
			context,
		) as {
			computeNetworkVisualRadius: typeof computeNetworkVisualRadius;
			computeNetworkFitTransform: typeof computeNetworkFitTransform;
			computeNetworkLabelWorldFontSize: typeof computeNetworkLabelWorldFontSize;
		};
	}

	test('serialized visual radius matches module across zoom and hierarchy', () => {
		const runtime = loadRuntime();
		const ordinary: NetworkNodeLike = { id: 'leaf', degree: 1, importance: 0.1 };
		const hub: NetworkNodeLike = { id: 'hub', degree: 28, importance: 0.95 };
		const entry: NetworkNodeLike = { id: 'main', isEntry: true };

		for (const zoom of [0.15, 0.2, 0.5, 1, 2.4]) {
			for (const node of [ordinary, hub, entry]) {
				const moduleR = computeNetworkVisualRadius(node, 1, { zoom, entryNodeId: 'main' });
				const runtimeR = runtime.computeNetworkVisualRadius(node, 1, { zoom, entryNodeId: 'main' });
				assert.equal(runtimeR, moduleR, `radius drift for ${node.id} at k=${zoom}`);
			}
		}
	});

	test('serialized Fit View transform matches module and stays below old helper floor', () => {
		const runtime = loadRuntime();
		const nodes: NetworkNodeLike[] = Array.from({ length: 80 }, (_, i) => ({ id: `n${i}`, degree: 1 }));
		const projected: Record<string, { x: number; y: number; depthScale: number }> = {};
		for (let i = 0; i < nodes.length; i++) {
			projected[nodes[i].id] = { x: (i % 20) * 120, y: Math.floor(i / 20) * 120, depthScale: 1 };
		}
		const opts = {
			padding: 48,
			minZoom: 0.15,
			maxZoom: 2.4,
			insets: { top: 40, bottom: 20, left: 10, right: 10 },
		};
		const moduleT = computeNetworkFitTransform(nodes, projected, 1400, 800, opts);
		const runtimeT = runtime.computeNetworkFitTransform(nodes, projected, 1400, 800, opts);
		// VM realm objects are not === to module Object.prototype; compare plain values.
		assert.equal(runtimeT.k, moduleT.k);
		assert.equal(runtimeT.x, moduleT.x);
		assert.equal(runtimeT.y, moduleT.y);
		assert.ok(moduleT.k < 0.6, `production Fit must zoom below old 0.6 helper band (k=${moduleT.k})`);
	});

	test('serialized label font size matches module at low Fit zoom', () => {
		const runtime = loadRuntime();
		for (const zoom of [0.15, 0.2, 1, 2]) {
			assert.equal(
				runtime.computeNetworkLabelWorldFontSize(10, zoom),
				computeNetworkLabelWorldFontSize(10, zoom),
			);
		}
	});
});

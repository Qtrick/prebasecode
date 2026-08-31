/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { serializeNetworkEdgeVisualSource } from '../../host/workbench/networkEdgeVisualRuntime.js';
import { resolveNetworkEdgeVisual } from '../../view/network/networkEdgeVisual.js';
import { NetworkEdgeRenderStrategy } from '../../view/network/networkEdgeRenderStrategy.js';
import vm from 'node:vm';

/**
 * Production-parity contract: the webview receives `resolveNetworkEdgeVisual` via
 * serialized injection. These tests execute the EXACT string the production host injects
 * and assert it behaves identically to the module resolver and produces descriptors
 * consistent with the typed strategy wrapper. Any edit that makes the function
 * non-serializable (external references) or changes one consumer without the other fails
 * here instead of shipping divergent edge rendering.
 */
suite('NetworkEdgeVisual production parity', () => {

	test('serialized source round-trips through Function() and matches the module resolver', () => {
		const src = serializeNetworkEdgeVisualSource();
		assert.ok(src.length > 100, 'serializer returned a real function body');
		assert.ok(!src.includes('=>'), 'webview runtime targets plain ES2017-safe output');

		const context = vm.createContext({});
		const runtimeCopy = vm.runInContext(`(${src})`, context) as typeof resolveNetworkEdgeVisual;
		assert.equal(typeof runtimeCopy, 'function');

		const edgeMatrix = [
			{ id: 'e1', source: 'a', target: 'b' },
			{ id: 'e2', source: 'a', target: 'b', kind: 'contains' },
			{ id: 'e3', source: 'a', target: 'b', kind: 'dependency' },
			{ id: 'e4', source: 'a', target: 'b', kind: 'reference' },
			{ id: 'e5', source: 'a', target: 'b', kind: 'export' },
			{ id: 'e6', source: 'a', target: 'b', meta: { isDynamic: true } },
			{ id: 'e7', source: 'a', target: 'b', meta: { isEntryRelated: true } },
			{ id: 'e8', source: 'a', target: 'b', meta: { isEntry: true } },
		];
		const zooms = [0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0, 1.2, 2.5];
		const opacities = [undefined as number | undefined | null, null, 0, 0.2, 0.55, 0.85, 1.5];

		for (const edge of edgeMatrix) {
			for (const zoom of zooms) {
				for (const opacity of opacities) {
					// Normalize to plain structures: the runtime copy executes in a separate
					// vm realm, so deepStrictEqual would reject its Array/Object prototypes.
					const norm = (d: { color: string; width: number; alpha: number; priority: number; showArrow: boolean; dash: readonly number[] } | null | undefined) =>
						d === null || d === undefined
							? d
							: { color: d.color, width: d.width, alpha: d.alpha, priority: d.priority, showArrow: d.showArrow, dash: [...(d.dash || [])] };
					assert.deepEqual(norm(runtimeCopy(edge, false, null, zoom, opacity)), norm(resolveNetworkEdgeVisual(edge, false, null, zoom, opacity)),
						`parity drift for ${edge.id} zoom=${zoom} opacity=${opacity}`);
					// Highlighted / dimmed paths too
					assert.deepEqual(norm(runtimeCopy(edge, true, 'a', zoom, opacity)), norm(resolveNetworkEdgeVisual(edge, true, 'a', zoom, opacity)));
				}
			}
		}
	});

	test('strategy wrapper stays consistent with the shared resolver contract', () => {
		const edge = { id: 'x', source: 'n1', target: 'n2', kind: 'dependency' as const };
		const base = resolveNetworkEdgeVisual(edge, false, null, 1.0, 0.55)!;
		const wrapped = NetworkEdgeRenderStrategy.evaluate(edge, { zoom: 1.0, edgeOpacitySetting: 0.55 });

		assert.equal(wrapped.variant, 'dependency');
		assert.equal(wrapped.strokeStyle, base.color);
		assert.equal(wrapped.lineWidth, base.width);
		assert.equal(wrapped.alpha, base.alpha);
		assert.deepEqual([...wrapped.dash], [...base.dash]);
		assert.equal(wrapped.priority, base.priority);
		assert.equal(wrapped.hasArrow, base.showArrow);
	});

	test('LOD suppression is identical between strategy visibility and runtime null', () => {
		// Below import LOD threshold both must agree the edge is not drawable.
		const edge = { id: 'y', source: 'a', target: 'b', kind: 'import' as const };
		const hidden = NetworkEdgeRenderStrategy.evaluate(edge, { zoom: 0.25 });
		assert.equal(hidden.visibleAtLOD, false);

		const context = vm.createContext({});
		const runtimeCopy = vm.runInContext(`(${serializeNetworkEdgeVisualSource()})`, context) as typeof resolveNetworkEdgeVisual;
		assert.equal(runtimeCopy(edge, false, null, 0.25, undefined), null);
	});

	test('entryNodeId parameter parity: runtime copy derives entry emphasis exactly like the module resolver', () => {
		const src = serializeNetworkEdgeVisualSource();
		const context = vm.createContext({});
		const runtimeCopy = vm.runInContext(`(${src})`, context) as typeof resolveNetworkEdgeVisual;

		const edges = [
			{ id: 'in', source: 'entry-1', target: 'dep' },
			{ id: 'out', source: 'other', target: 'entry-1' },
			{ id: 'far', source: 'x', target: 'y' },
			// meta.isEntry must behave identically to derived entry incidence
			{ id: 'flagged', source: 'x', target: 'y', meta: { isEntry: true } },
		];
		const entryIds = ['entry-1', null, undefined] as (string | null | undefined)[];
		const zooms = [0.2, 0.5, 1.0];

		for (const edge of edges) {
			for (const entryId of entryIds) {
				for (const zoom of zooms) {
					const norm = (d: { color: string; width: number; alpha: number; priority: number; showArrow: boolean; dash: readonly number[] } | null) =>
						d === null ? d : { color: d.color, width: d.width, alpha: d.alpha, priority: d.priority, showArrow: d.showArrow, dash: [...(d.dash || [])] };
					assert.deepEqual(
						norm(runtimeCopy(edge as any, false, null, zoom, 0.55, entryId)),
						norm(resolveNetworkEdgeVisual(edge as any, false, null, zoom, 0.55, entryId)),
						`entry parity drift for ${edge.id} entry=${String(entryId)} zoom=${zoom}`);
				}
			}
		}

		// Behavior anchor: entry incidence actually changes the descriptor
		// (amber entry styling at a zoom where a plain import would be LOD-hidden).
		const incident = resolveNetworkEdgeVisual(edges[0], false, null, 0.3, 0.55, 'entry-1');
		assert.ok(incident && incident.priority === 9 && incident.color.includes('245, 158, 11'),
			`edge incident to entryNodeId gets amber entry styling at macro zoom (got ${JSON.stringify(incident)})`);
		const nonEntry = resolveNetworkEdgeVisual(edges[0], false, null, 0.3, 0.55, 'unrelated');
		assert.equal(nonEntry, null, 'same edge without entry incidence stays LOD-hidden');
	});
});

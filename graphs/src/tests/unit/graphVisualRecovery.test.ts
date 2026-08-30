/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { layoutNetworkGraph, DEFAULT_NETWORK_LAYOUT_CONFIG } from '../../layouts/network/index.js';
import { RADIAL_LAYOUT_VERSION } from '../../layouts/network/radialLayout.js';
import {
	computeNetworkVisualRadius,
	computeNetworkFitTransform,
	computeNetworkLabelWorldFontSize,
} from '../../view/network/networkRenderMath.js';
import { computeSemanticTemporalInitialLayout, TEMPORAL_INITIAL_LAYOUT_VERSION } from '../../temporal/view/temporalLayoutEngine.js';
import { computeTemporalVisualRadius } from '../../view/temporal/temporalFocusContext.js';
import { computeAggregateEdgeRoute } from '../../temporal/view/temporalEdgeLod.js';
import { GRAPH_LAYOUT_VERSION } from '../../core/canonical/versioning.js';
import {
	serializeNetworkVisualRadiusSource,
	serializeNetworkPickRadiusSource,
	serializeNetworkFitTransformSource,
	serializeNetworkDepthAlphaSource,
	serializeNetworkLabelWorldFontSizeSource,
} from '../../host/workbench/networkRenderMathRuntime.js';
import { serializeTemporalAggregateEdgeRouteSource } from '../../host/workbench/temporalRuntimeContracts.js';

suite('Graph visual recovery contracts', () => {
	function buildStressNetwork() {
		const nodes: Array<{ id: string; isEntry?: boolean; val?: number }> = [];
		const links: Array<{ source: string; target: string }> = [];
		const mainN = 160;
		nodes.push({ id: 'entry', isEntry: true, val: 12 });
		for (let i = 1; i < mainN; i++) {
			nodes.push({ id: `m${i}`, val: i % 13 === 0 ? 9 : 1.5 });
		}
		for (let i = 1; i <= 25; i++) {
			links.push({ source: 'entry', target: `m${i}` });
		}
		for (let i = 26; i < mainN; i++) {
			links.push({ source: `m${1 + (i % 25)}`, target: `m${i}` });
			if (i % 5 === 0) {
				links.push({ source: `m${1 + ((i * 3) % 25)}`, target: `m${i}` });
			}
		}
		for (let c = 0; c < 8; c++) {
			nodes.push({ id: `c${c}r`, val: 5 });
			for (let j = 1; j <= 6; j++) {
				nodes.push({ id: `c${c}_${j}` });
				links.push({ source: `c${c}r`, target: `c${c}_${j}` });
			}
		}
		for (let i = 0; i < 72; i++) {
			nodes.push({ id: `iso${i}` });
		}
		return { nodes, links };
	}

	function extentOf(layout: Map<string, { x: number; y: number; z: number }>, ids?: Iterable<string>) {
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		const iter = ids ? ids : layout.keys();
		for (const id of iter) {
			const p = layout.get(id);
			if (!p) {
				continue;
			}
			minX = Math.min(minX, p.x);
			maxX = Math.max(maxX, p.x);
			minY = Math.min(minY, p.y);
			maxY = Math.max(maxY, p.y);
		}
		const w = maxX - minX;
		const h = maxY - minY;
		return { w, h, max: Math.max(w, h) };
	}

	function maxRadius(layout: Map<string, { x: number; y: number; z: number }>): number {
		let max = 0;
		for (const p of layout.values()) {
			max = Math.max(max, Math.hypot(p.x, p.y));
		}
		return max;
	}

	test('radial ~280-node stress stays bounded and readable under production Fit View', () => {
		const g = buildStressNetwork();
		assert.ok(g.nodes.length >= 250 && g.nodes.length <= 320);
		const cfg = { ...DEFAULT_NETWORK_LAYOUT_CONFIG, collisionRadius: 24, linkDistance: 48, forceStrength: 0.35 };
		const radial = layoutNetworkGraph('radial', g.nodes, g.links, cfg);
		const organic = layoutNetworkGraph('organic', g.nodes, g.links, cfg);
		assert.strictEqual(radial.size, g.nodes.length);
		const er = extentOf(radial);
		const eo = extentOf(organic);
		const ratio = er.max / Math.max(1, eo.max);
		assert.ok(ratio < 5.5, `radial/organic extent ratio ${ratio.toFixed(2)} must stay bounded`);
		assert.ok(er.w < 1800 && er.h < 1800, `radial bbox ${er.w.toFixed(0)}x${er.h.toFixed(0)} must not explode`);

		// Production Fit path (not a bbox-only helper) — insets + node radii included.
		const projected: Record<string, { x: number; y: number; depthScale: number }> = {};
		for (const [id, p] of radial) {
			projected[id] = { x: p.x, y: p.y, depthScale: 1 };
		}
		const nodesLike = g.nodes.map(n => ({
			id: n.id,
			degree: 1,
			importance: 0.1,
			isEntry: Boolean(n.isEntry),
			val: n.val,
		}));
		const fit = computeNetworkFitTransform(nodesLike, projected, 1400, 800, {
			padding: 48,
			minZoom: 0.15,
			maxZoom: 2.4,
			insets: { top: 40, bottom: 20, left: 10, right: 10 },
		});
		assert.ok(fit.k >= 0.15 && fit.k <= 2.4, `production Fit k=${fit.k}`);

		const ordinary = { id: 'leaf', degree: 1, importance: 0.1 };
		const worldR = computeNetworkVisualRadius(ordinary, 1, { zoom: fit.k });
		const screenR = worldR * fit.k;
		assert.ok(screenR >= 2.75, `ordinary screen radius at production Fit k=${fit.k.toFixed(3)} was ${screenR}`);

		// Naive world*k without zoom compensation would go subpixel at typical Fit zooms.
		const uncompensated = computeNetworkVisualRadius(ordinary, 1, { zoom: 1 }) * fit.k;
		assert.ok(uncompensated < 2.75 || fit.k >= 0.95, `uncompensated screen ${uncompensated} must expose the Fit risk`);

		assert.deepStrictEqual(radial.get('entry'), { x: 0, y: 0, z: 0 });
		const near = Math.hypot(radial.get('m1')!.x, radial.get('m1')!.y);
		const far = Math.hypot(radial.get('m50')!.x, radial.get('m50')!.y);
		assert.ok(near < far, 'BFS depth one must precede deeper nodes');
		assert.ok(RADIAL_LAYOUT_VERSION >= 2 && GRAPH_LAYOUT_VERSION >= 2);
	});

	test('radial has no global scale explosion: collision grows locally, isolates leave main intact', () => {
		const mainNodes = [
			{ id: 'entry', isEntry: true },
			...Array.from({ length: 40 }, (_, i) => ({ id: `n${i}` })),
		];
		const mainLinks = Array.from({ length: 40 }, (_, i) => ({ source: 'entry', target: `n${i}` }));
		const mainIds = mainNodes.map(n => n.id);

		const tight = layoutNetworkGraph('radial', mainNodes, mainLinks, {
			sphereRadius: 240, collisionRadius: 8, linkDistance: 24, forceStrength: 0,
		});
		const loose = layoutNetworkGraph('radial', mainNodes, mainLinks, {
			sphereRadius: 240, collisionRadius: 24, linkDistance: 72, forceStrength: 0,
		});
		const growth = extentOf(loose, mainIds).max / Math.max(1, extentOf(tight, mainIds).max);
		// Local collision/link spacing expands geometry, but must not 5×+ rescale the whole graph.
		assert.ok(growth > 1.2, `collision must materially expand spacing (got ${growth.toFixed(2)})`);
		assert.ok(growth < 4.5, `collision growth ${growth.toFixed(2)} must stay local, not a global explosion`);

		const cfg = { sphereRadius: 240, collisionRadius: 16, linkDistance: 48, forceStrength: 0 };
		const mainOnly = layoutNetworkGraph('radial', mainNodes, mainLinks, cfg);
		const withIsolates = layoutNetworkGraph(
			'radial',
			[...mainNodes, ...Array.from({ length: 80 }, (_, i) => ({ id: `iso${i}` }))],
			mainLinks,
			cfg,
		);
		const mainExtentAlone = extentOf(mainOnly, mainIds).max;
		const mainExtentWithIso = extentOf(withIsolates, mainIds).max;
		const mainDrift = mainExtentWithIso / Math.max(1, mainExtentAlone);
		assert.ok(mainDrift < 1.08, `isolates must not rescale main rings (drift ${mainDrift.toFixed(3)})`);
	});

	test('radial packs disconnected components without O(n) giant bounds', () => {
		const base = [{ id: 'entry', isEntry: true }, { id: 'leaf' }];
		const links = [{ source: 'entry', target: 'leaf' }];
		const cfg = { sphereRadius: 240, collisionRadius: 12, linkDistance: 40, forceStrength: 0 };

		const multi = [
			...base,
			{ id: 'a0', val: 8 }, { id: 'a1' }, { id: 'a2' }, { id: 'a3' },
			{ id: 'b0', val: 6 }, { id: 'b1' }, { id: 'b2' },
			{ id: 'c0' },
		];
		const multiLinks = [
			...links,
			{ source: 'a0', target: 'a1' }, { source: 'a1', target: 'a2' }, { source: 'a2', target: 'a3' },
			{ source: 'b0', target: 'b1' }, { source: 'b1', target: 'b2' },
		];
		const packed = layoutNetworkGraph('radial', multi, multiLinks, cfg);
		const packedExtent = extentOf(packed).max;
		assert.ok(packedExtent < 900, `multi-component pack ${packedExtent.toFixed(0)} must stay bounded`);
		assert.ok(Math.hypot(packed.get('a0')!.x, packed.get('a0')!.y) > Math.hypot(packed.get('leaf')!.x, packed.get('leaf')!.y));

		const r20 = layoutNetworkGraph('radial', [...base, ...Array.from({ length: 20 }, (_, i) => ({ id: `i${i}` }))], links, cfg);
		const r200 = layoutNetworkGraph('radial', [...base, ...Array.from({ length: 200 }, (_, i) => ({ id: `i${i}` }))], links, cfg);
		const growth = maxRadius(r200) / Math.max(1, maxRadius(r20));
		const linear = 200 / 20;
		assert.ok(growth < linear * 0.35, `isolate growth ${growth.toFixed(2)} must be sub-linear (<< ${linear})`);
		assert.ok(growth < Math.sqrt(linear) * 1.35, `isolate growth ${growth.toFixed(2)} should track ~sqrt(n)`);
	});

	test('network screen-aware radii stay readable at Fit zooms; uncompensated vanishes at k=0.2', () => {
		const node = { id: 'a', degree: 2, importance: 0.2 };
		const baseWorld = computeNetworkVisualRadius(node, 1, { zoom: 1 });
		assert.ok(baseWorld * 0.2 < 1.5, `uncompensated screen at k=0.2 was ${baseWorld * 0.2} (must be subpixel-class)`);

		for (const zoom of [0.15, 0.2, 0.25, 0.5, 1, 2, 3.5]) {
			const world = computeNetworkVisualRadius(node, 1, { zoom });
			const screen = world * zoom;
			assert.ok(screen >= 2.75 && screen <= 26.5, `node screen ${screen} at k=${zoom}`);
			const fontWorld = computeNetworkLabelWorldFontSize(10, zoom);
			const fontScreen = fontWorld * zoom;
			assert.ok(fontScreen >= 8.5 && fontScreen <= 18.5, `label screen ${fontScreen} at k=${zoom}`);
		}
	});

	test('network fit transform uses production clamps and rejects the old 0.6–1.4 helper band', () => {
		const nodes = Array.from({ length: 80 }, (_, i) => ({ id: `n${i}`, degree: 1 }));
		const projected: Record<string, { x: number; y: number; depthScale: number }> = {};
		for (let i = 0; i < nodes.length; i++) {
			projected[nodes[i].id] = { x: (i % 20) * 120, y: Math.floor(i / 20) * 120, depthScale: 1 };
		}
		const t = computeNetworkFitTransform(nodes, projected, 1400, 800, {
			padding: 48,
			minZoom: 0.15,
			maxZoom: 2.4,
			insets: { top: 40, bottom: 20, left: 10, right: 10 },
		});
		assert.ok(t.k >= 0.15 && t.k <= 2.4);
		assert.ok(t.k < 0.6, `large graph Fit k=${t.k} must zoom below the old 0.6 helper floor`);
		assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));

		// Fit must account for node radii — zero-radius bbox scale would differ.
		const tinyProjected: Record<string, { x: number; y: number; depthScale: number }> = {
			a: { x: 0, y: 0, depthScale: 1 },
			b: { x: 40, y: 0, depthScale: 1 },
		};
		const withRadii = computeNetworkFitTransform(
			[{ id: 'a', val: 12, isEntry: true }, { id: 'b', degree: 1 }],
			tinyProjected,
			400,
			400,
			{ padding: 20, minZoom: 0.15, maxZoom: 3.2 },
		);
		const pointsOnlyBox = 40;
		const pointsOnlyK = Math.min((400 - 40) / pointsOnlyBox, (400 - 40) / pointsOnlyBox);
		assert.ok(withRadii.k < pointsOnlyK * 0.95, 'Fit including glyph radii must zoom out vs point-only bbox');
	});

	test('temporal deep community chain stays compact (not a tall vertical stripe)', () => {
		const nodes: Array<{ entityId: string; path: string; label: string; changeKind: 'unchanged' | 'modified' }> = [];
		const edges: Array<{ sourceEntityId: string; targetEntityId: string; changeKind: 'unchanged' | 'modified' }> = [];
		// Realistic layered dependency fan: many communities chained by depth (would become a spear under hard ranks).
		const sizes = [6, 14, 10, 28, 8, 22, 12, 35, 7, 18, 9, 30, 8, 16, 11, 24, 6, 20];
		const ids: string[][] = [];
		for (let c = 0; c < sizes.length; c++) {
			const group: string[] = [];
			for (let i = 0; i < sizes[c]; i++) {
				const id = `pkg${c}/mod${i}.ts`;
				nodes.push({
					entityId: id,
					path: id,
					label: `mod${i}`,
					changeKind: i === 0 && c % 4 === 0 ? 'modified' : 'unchanged',
				});
				group.push(id);
			}
			ids.push(group);
			for (let i = 1; i < group.length; i++) {
				edges.push({ sourceEntityId: group[0], targetEntityId: group[i], changeKind: 'unchanged' });
			}
			if (c > 0) {
				for (let i = 0; i < Math.min(8, group.length); i++) {
					edges.push({
						sourceEntityId: ids[c - 1][i % ids[c - 1].length],
						targetEntityId: group[i],
						changeKind: i < 2 ? 'modified' : 'unchanged',
					});
				}
			}
		}
		assert.ok(nodes.length > 200, 'fixture must be large enough to expose rank stacking');

		const layout = computeSemanticTemporalInitialLayout(nodes as any, edges as any, 48, { width: 1400, height: 800 });
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const p of layout.positions.values()) {
			minX = Math.min(minX, p.x);
			maxX = Math.max(maxX, p.x);
			minY = Math.min(minY, p.y);
			maxY = Math.max(maxY, p.y);
		}
		const w = maxX - minX;
		const h = maxY - minY;
		const aspect = w / Math.max(1, h);
		assert.ok(aspect > 0.7 && aspect < 2.2, `aspect ${aspect.toFixed(3)} must not be a vertical spear`);
		assert.ok(h < 1400, `height ${h} must stay compact vs hard vertical ranks`);
		assert.ok(w > h * 0.55, 'width must remain comparable — not a thin stripe');

		const fitK = Math.min(2.4, Math.min(1304 / w, 704 / h));
		const world = computeTemporalVisualRadius({ entityId: 'x', changeKind: 'unchanged' } as any, { zoom: fitK });
		assert.ok(world * fitK >= 3.0, `unchanged screen radius ${(world * fitK).toFixed(2)} at k=${fitK.toFixed(3)}`);

		const atZoom = computeTemporalVisualRadius({ entityId: 'y', changeKind: 'unchanged' } as any, { zoom: 0.2 });
		assert.ok(atZoom * 0.2 >= 3.0, `temporal screen radius must survive k=0.2 (got ${atZoom * 0.2})`);
		assert.ok(TEMPORAL_INITIAL_LAYOUT_VERSION >= 2);
	});

	test('aggregate edge routes fan into distinct lanes instead of one shared spear', () => {
		// Same community pair, varying lane index — must separate by the lane step (~11px).
		const samePair = Array.from({ length: 5 }, (_, i) =>
			computeAggregateEdgeRoute(0, 0, 0, 400, 40, 40, i, 5, 'cA', 'cB'),
		);
		for (let i = 1; i < samePair.length; i++) {
			const sep = Math.hypot(samePair[i].cpX - samePair[i - 1].cpX, samePair[i].cpY - samePair[i - 1].cpY);
			assert.ok(sep >= 10, `adjacent lane sep ${sep.toFixed(2)} must be ≥ lane step`);
		}
		const samePairSpan = Math.max(...samePair.map(r => r.cpX)) - Math.min(...samePair.map(r => r.cpX));
		assert.ok(samePairSpan >= 40, `same-pair lane fan span ${samePairSpan} must not collapse to one spear`);

		// Distinct community hashes along one vertical corridor — must not all share one control point.
		const corridor = [
			['svcA', 'svcB'],
			['uiA', 'uiB'],
			['dataA', 'dataB'],
			['coreA', 'coreB'],
			['utilA', 'utilB'],
			['apiA', 'apiB'],
			['authA', 'authB'],
			['opsA', 'opsB'],
		] as const;
		const routes = corridor.map(([src, tgt], i) =>
			computeAggregateEdgeRoute(100, 0, 100, 500, 30, 30, i % 3, 3, src, tgt),
		);
		const keys = new Set(routes.map(r => `${r.cpX.toFixed(1)},${r.cpY.toFixed(1)}`));
		assert.ok(keys.size >= 4, `corridor control points must diversify (unique=${keys.size})`);
		const cpXs = routes.map(r => r.cpX);
		assert.ok(Math.max(...cpXs) - Math.min(...cpXs) >= 30, 'lateral spread must leave the shared vertical mid-line');

		// Mistaken global pairIndex must not create a spear (lane is clamped).
		const spearish = computeAggregateEdgeRoute(0, 0, 0, 400, 40, 40, 40, 80, 'cA', 'cB');
		assert.ok(Math.abs(spearish.cpX) < 120, 'lane clamp must prevent global-index spear blowout');
	});

	test('network/temporal visual math serializers stay portable for CSP webview injection', () => {
		const sources = [
			serializeNetworkVisualRadiusSource(),
			serializeNetworkPickRadiusSource(),
			serializeNetworkFitTransformSource(),
			serializeNetworkDepthAlphaSource(),
			serializeNetworkLabelWorldFontSizeSource(),
			serializeTemporalAggregateEdgeRouteSource(),
		];
		for (const src of sources) {
			assert.ok(src.startsWith('function'), `expected function keyword serialization, got ${src.slice(0, 48)}`);
			assert.ok(!src.includes('=>'), 'arrow functions are not portable into the CSP webview');
		}
		const radiusFn = new Function(`return (${serializeNetworkVisualRadiusSource()})`)();
		const moduleR = computeNetworkVisualRadius({ id: 'n', degree: 2 }, 1, { zoom: 0.25 });
		assert.strictEqual(radiusFn({ id: 'n', degree: 2 }, 1, { zoom: 0.25 }), moduleR);
	});
});

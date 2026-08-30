/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	computeNetworkSphereRadius,
	layoutNetworkGraph,
	normalizeNetworkLayoutMode,
	isLegacyNetworkLayoutMode,
	NETWORK_LAYOUT_MODES,
	NETWORK_LAYOUT_OPTIONS,
	LEGACY_NETWORK_LAYOUT_MODES,
	type Point3D,
} from '../../layouts/network/index.js';

suite('PreBase networkLayout', () => {
	function makeGraph(n: number) {
		const nodes = Array.from({ length: n }, (_, i) => ({
			id: `n${i}`,
			fileTypeId: i % 2 === 0 ? 'typescript' : 'javascript',
			val: 1 + (i % 5),
			isEntry: i === 0,
		}));
		const links = [];
		for (let i = 1; i < n; i++) {
			links.push({ source: `n${i - 1}`, target: `n${i}` });
			if (i > 2) {
				links.push({ source: `n${i}`, target: `n${i % 3}` });
			}
		}
		return { nodes, links };
	}

	function metrics(layout: Map<string, Point3D>) {
		const pts = [...layout.values()];
		assert.ok(pts.length > 0);
		for (const p of pts) {
			assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
		}
		const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
		const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
		const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
		const vars = ['x', 'y', 'z'].map(axis => {
			const mean = axis === 'x' ? cx : axis === 'y' ? cy : cz;
			return pts.reduce((s, p) => s + (p[axis as keyof Point3D] - mean) ** 2, 0) / pts.length;
		});
		let minNN = Infinity;
		for (let i = 0; i < pts.length; i++) {
			for (let j = i + 1; j < pts.length; j++) {
				minNN = Math.min(minNN, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z));
			}
		}
		return { cx, cy, cz, vars, minNN };
	}

	function totalLinkLength(layout: Map<string, Point3D>, links: Array<{ source: string; target: string }>): number {
		return links.reduce((total, link) => total + Math.hypot(
			layout.get(link.source)!.x - layout.get(link.target)!.x,
			layout.get(link.source)!.y - layout.get(link.target)!.y,
			layout.get(link.source)!.z - layout.get(link.target)!.z,
		), 0);
	}

	test('sphere radius scales with node count and spread', () => {
		assert.ok(computeNetworkSphereRadius(10, 1) < computeNetworkSphereRadius(400, 1));
		assert.ok(computeNetworkSphereRadius(100, 2) > computeNetworkSphereRadius(100, 1));
	});

	for (const mode of NETWORK_LAYOUT_MODES) {
		test(`${mode} is deterministic and 3D`, () => {
			const g = makeGraph(48);
			const r = computeNetworkSphereRadius(g.nodes.length, 1);
			const a = layoutNetworkGraph(mode, g.nodes, g.links, r);
			const b = layoutNetworkGraph(mode, g.nodes, g.links, r);
			assert.strictEqual(a.size, g.nodes.length);
			for (const id of a.keys()) {
				const p1 = a.get(id)!;
				const p2 = b.get(id)!;
				assert.deepStrictEqual(p1, p2);
			}
			const m = metrics(a);
			assert.ok(Math.hypot(m.cx, m.cy, m.cz) < 1e-6);
			assert.ok(m.vars[0] > 1);
			assert.ok(m.vars[1] > 1);
			assert.ok(m.vars[2] > (mode === 'organic' ? 0.5 : 1));
			assert.ok(m.minNN > 0.5);
		});
	}

	test('organic keeps a high-degree hub central in three dimensions', () => {
		const nodes = [
			{ id: 'hub', fileTypeId: 'typescript', val: 100, isEntry: true },
			...Array.from({ length: 48 }, (_, i) => ({ id: `leaf${i}`, fileTypeId: 'typescript', val: 1, isEntry: false })),
		];
		const links = nodes.slice(1).map(node => ({ source: 'hub', target: node.id }));
		const layout = layoutNetworkGraph('organic', nodes, links, 240);
		const hub = layout.get('hub')!;
		const hubDistanceFromCenter = Math.hypot(hub.x, hub.y, hub.z);
		const nearestLeafDistanceFromCenter = Math.min(...nodes.slice(1).map(node => {
			const position = layout.get(node.id)!;
			return Math.hypot(position.x, position.y, position.z);
		}));

		assert.ok(hubDistanceFromCenter < nearestLeafDistanceFromCenter);
	});

	test('organic normalizes its final bounds uniformly across all axes', () => {
		const graph = makeGraph(96);
		const radius = 240;
		const layout = layoutNetworkGraph('organic', graph.nodes, graph.links, radius);
		for (const position of layout.values()) {
			assert.ok(Math.hypot(position.x, position.y, position.z) <= radius * 0.88 + 1e-6);
		}
	});

	test('network layouts retain all nodes and finite volumetric positions with dangling links', () => {
		const nodes = [
			{ id: 'isolated', fileTypeId: 'typescript', val: 1, isEntry: true },
			{ id: 'connected', fileTypeId: 'javascript', val: 2, isEntry: false },
		];
		const links = [
			{ source: 'connected', target: 'missing' },
			{ source: 'missing', target: 'isolated' },
		];

		for (const mode of NETWORK_LAYOUT_MODES) {
			const layout = layoutNetworkGraph(mode, nodes, links, 240);
			assert.strictEqual(layout.size, nodes.length, mode);
			for (const node of nodes) {
				const position = layout.get(node.id)!;
				assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z), `${mode}:${node.id}`);
			}
		}
	});

	test('legacy persisted radial falls back to organic and is not a live layout mode', () => {
		assert.strictEqual(normalizeNetworkLayoutMode('radial'), 'organic');
		assert.strictEqual(normalizeNetworkLayoutMode('RADIAL'), 'organic');
		assert.strictEqual(normalizeNetworkLayoutMode(undefined), 'organic');
		assert.strictEqual(normalizeNetworkLayoutMode('clustered'), 'clustered');
		assert.ok(isLegacyNetworkLayoutMode('radial'));
		assert.equal(isLegacyNetworkLayoutMode('organic'), false);
		assert.ok(!(NETWORK_LAYOUT_MODES as readonly string[]).includes('radial'));
		const g = makeGraph(16);
		const viaOrganic = layoutNetworkGraph('organic', g.nodes, g.links, 240);
		const viaNormalized = layoutNetworkGraph(normalizeNetworkLayoutMode('radial'), g.nodes, g.links, 240);
		assert.deepStrictEqual([...viaNormalized.entries()], [...viaOrganic.entries()]);
		const viaDefaultCase = layoutNetworkGraph('radial' as any, g.nodes, g.links, 240);
		assert.deepStrictEqual([...viaDefaultCase.entries()], [...viaOrganic.entries()]);
	});

	test('NETWORK_LAYOUT_OPTIONS and live modes exclude retired radial', () => {
		assert.deepStrictEqual([...LEGACY_NETWORK_LAYOUT_MODES], ['radial']);
		assert.deepStrictEqual(NETWORK_LAYOUT_OPTIONS.map(o => o.id), [...NETWORK_LAYOUT_MODES]);
		assert.ok(!NETWORK_LAYOUT_OPTIONS.some(o => /radial/i.test(o.id) || /radial/i.test(o.label)));
	});

	test('network runtime collision, link-distance, and force controls retain all nodes', () => {
		const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, fileTypeId: 'typescript', val: 1, isEntry: index === 0 }));
		const links = nodes.slice(1).map(node => ({ source: 'n0', target: node.id }));
		for (const mode of NETWORK_LAYOUT_MODES) {
			const close = layoutNetworkGraph(mode, nodes, links, { sphereRadius: 240, collisionRadius: 8, linkDistance: 24, forceStrength: 0 });
			const spaced = layoutNetworkGraph(mode, nodes, links, { sphereRadius: 240, collisionRadius: 40, linkDistance: 136, forceStrength: 0 });
			assert.strictEqual(close.size, nodes.length, `${mode} must keep every node at tight collision`);
			assert.strictEqual(spaced.size, nodes.length, `${mode} must keep every node at loose collision`);
		}

		const noForce = layoutNetworkGraph('constellation', nodes, links, { sphereRadius: 240, collisionRadius: 16, linkDistance: 24, forceStrength: 0 });
		const strongForce = layoutNetworkGraph('constellation', nodes, links, { sphereRadius: 240, collisionRadius: 16, linkDistance: 24, forceStrength: 2 });
		assert.ok(Math.abs(totalLinkLength(noForce, links) - totalLinkLength(strongForce, links)) > 1, 'force strength must affect constellation link geometry');
	});
});

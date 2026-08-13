/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	computeNetworkSphereRadius,
	layoutNetworkGraph,
	type NetworkLayoutMode,
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

	function radius(position: Point3D): number {
		return Math.hypot(position.x, position.y, position.z);
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

	for (const mode of ['organic', 'sphere', 'constellation', 'clustered', 'radial'] as NetworkLayoutMode[]) {
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
			if (mode !== 'radial') {
				assert.ok(Math.hypot(m.cx, m.cy, m.cz) < 1e-6);
			}
			// Every active layout must preserve meaningful depth; Organic is force-solved in XYZ.
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

		for (const mode of ['organic', 'sphere', 'constellation', 'clustered', 'radial'] as NetworkLayoutMode[]) {
			const layout = layoutNetworkGraph(mode, nodes, links, 240);
			assert.strictEqual(layout.size, nodes.length, mode);
			for (const node of nodes) {
				const position = layout.get(node.id)!;
				assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z), `${mode}:${node.id}`);
			}
		}
	});

	test('radial pins the entry root and orders undirected BFS shells, unlike the even sphere shell', () => {
		const nodes = [
			{ id: 'entry', fileTypeId: 'typescript', val: 1, isEntry: true },
			{ id: 'near-a', fileTypeId: 'typescript', val: 20, isEntry: false },
			{ id: 'near-b', fileTypeId: 'typescript', val: 2, isEntry: false },
			{ id: 'far-a', fileTypeId: 'typescript', val: 100, isEntry: false },
			{ id: 'far-b', fileTypeId: 'typescript', val: 1, isEntry: false },
		];
		const links = [
			{ source: 'entry', target: 'near-a' },
			{ source: 'entry', target: 'near-b' },
			{ source: 'near-a', target: 'far-a' },
			{ source: 'near-b', target: 'far-b' },
		];
		const config = { sphereRadius: 240, collisionRadius: 16, linkDistance: 80, forceStrength: 0.35 };
		const radial = layoutNetworkGraph('radial', nodes, links, config);
		const sphere = layoutNetworkGraph('sphere', nodes, links, config);

		assert.deepStrictEqual(radial.get('entry'), { x: 0, y: 0, z: 0 });
		const nearRadius = Math.max(radius(radial.get('near-a')!), radius(radial.get('near-b')!));
		const farRadius = Math.min(radius(radial.get('far-a')!), radius(radial.get('far-b')!));
		assert.ok(nearRadius < farRadius, `BFS depth one (${nearRadius}) must precede depth two (${farRadius})`);
		assert.ok(radius(sphere.get('entry')!) > 1, 'sphere must not adopt radial root-at-origin semantics');
		assert.ok(Math.abs(radius(sphere.get('near-a')!) - radius(sphere.get('far-a')!)) < farRadius - nearRadius, 'sphere remains a tighter shell than BFS radial layers');
	});

	test('radial keeps disconnected components distinct on a bounded outer shell', () => {
		const nodes = [
			{ id: 'entry', isEntry: true },
			{ id: 'main-leaf' },
			{ id: 'a-root', val: 10 },
			{ id: 'a-1' },
			{ id: 'a-2' },
			{ id: 'a-3' },
			{ id: 'b-root', val: 1 },
		];
		const links = [
			{ source: 'entry', target: 'main-leaf' },
			{ source: 'a-root', target: 'a-1' },
			{ source: 'a-1', target: 'a-2' },
			{ source: 'a-2', target: 'a-3' },
		];
		const layout = layoutNetworkGraph('radial', nodes, links, { sphereRadius: 240, collisionRadius: 2, linkDistance: 50, forceStrength: 0 });
		const mainRadius = radius(layout.get('main-leaf')!);
		const aRoot = layout.get('a-root')!;
		const bRoot = layout.get('b-root')!;
		assert.ok(Math.min(radius(aRoot), radius(bRoot)) > mainRadius, 'disconnected components must remain outside the entry component');
		assert.ok(Math.hypot(aRoot.x - bRoot.x, aRoot.y - bRoot.y, aRoot.z - bRoot.z) >= 4, 'disconnected component roots must not overlap');
	});

	test('network runtime collision, link-distance, and force controls materially change geometry without dropping nodes', () => {
		const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, fileTypeId: 'typescript', val: 1, isEntry: index === 0 }));
		const links = nodes.slice(1).map(node => ({ source: 'n0', target: node.id }));
		const closeRadial = layoutNetworkGraph('radial', nodes, links, { sphereRadius: 240, collisionRadius: 8, linkDistance: 24, forceStrength: 0 });
		const spacedRadial = layoutNetworkGraph('radial', nodes, links, { sphereRadius: 240, collisionRadius: 40, linkDistance: 136, forceStrength: 0 });
		assert.strictEqual(closeRadial.size, nodes.length);
		assert.strictEqual(spacedRadial.size, nodes.length);
		assert.ok(metrics(spacedRadial).minNN > metrics(closeRadial).minNN * 2, 'collision radius and link distance must expand radial spacing');
		assert.ok(metrics(spacedRadial).minNN >= 79.9, 'radial collision pass must preserve approximately twice the configured radius');

		const noForce = layoutNetworkGraph('constellation', nodes, links, { sphereRadius: 240, collisionRadius: 16, linkDistance: 24, forceStrength: 0 });
		const strongForce = layoutNetworkGraph('constellation', nodes, links, { sphereRadius: 240, collisionRadius: 16, linkDistance: 24, forceStrength: 2 });
		assert.ok(Math.abs(totalLinkLength(noForce, links) - totalLinkLength(strongForce, links)) > 1, 'force strength must affect link relaxation geometry');
	});
});

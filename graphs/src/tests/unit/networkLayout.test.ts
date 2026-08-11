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
			assert.ok(Math.hypot(m.cx, m.cy, m.cz) < 1e-6);
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
});

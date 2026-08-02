/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	ARCH_MIN_HIT_PX,
	ARCH_NODE_H,
	ARCH_NODE_W,
	architectureHitRadiusScreen,
	pickArchitectureNodeAt,
} from '../interaction/architecturePick.js';

suite('Architecture pick', () => {
	test('hit radius never drops below min CSS pixels when zoomed out', () => {
		const r = architectureHitRadiusScreen(0.2);
		assert.ok(r >= ARCH_MIN_HIT_PX);
		assert.strictEqual(r, ARCH_MIN_HIT_PX);
	});

	test('hit radius grows with visual size when zoomed in', () => {
		const r = architectureHitRadiusScreen(2);
		const visual = Math.hypot(ARCH_NODE_W / 2, ARCH_NODE_H / 2) * 2 + 4;
		assert.ok(r >= visual - 0.01);
	});

	test('world halo expands when zoomed out so screen min stays ~10px', () => {
		const zoom = 0.25;
		const hitWorld = architectureHitRadiusScreen(zoom) / zoom;
		assert.ok(hitWorld * zoom >= ARCH_MIN_HIT_PX - 0.001);
		assert.ok(hitWorld > architectureHitRadiusScreen(1));
	});

	test('picks node within halo and prefers closer center', () => {
		const nodes = [
			{ id: 'a', x: 0, y: 0 },
			{ id: 'b', x: 100, y: 0 },
		];
		const zoom = 1;
		const cx = ARCH_NODE_W / 2;
		const cy = ARCH_NODE_H / 2;
		const hit = pickArchitectureNodeAt(cx + 8, cy + 2, nodes, zoom);
		assert.ok(hit);
		assert.strictEqual(hit!.id, 'a');
	});

	test('miss outside halo', () => {
		const nodes = [{ id: 'a', x: 0, y: 0 }];
		const zoom = 1;
		const hitR = architectureHitRadiusScreen(zoom);
		const cx = ARCH_NODE_W / 2;
		const cy = ARCH_NODE_H / 2;
		const miss = pickArchitectureNodeAt(cx + hitR + 5, cy, nodes, zoom);
		assert.strictEqual(miss, null);
	});

	test('stable tie-break by id', () => {
		const nodes = [
			{ id: 'b', x: 0, y: 0 },
			{ id: 'a', x: 0, y: 0 },
		];
		const hit = pickArchitectureNodeAt(ARCH_NODE_W / 2, ARCH_NODE_H / 2, nodes, 1);
		assert.strictEqual(hit!.id, 'a');
	});

	test('zoomed-out pick still hits near node (not world-fixed Network radius)', () => {
		const nodes = [{ id: 'a', x: 0, y: 0 }];
		const zoom = 0.2;
		const cx = ARCH_NODE_W / 2;
		const cy = ARCH_NODE_H / 2;
		// 30 world units ≈ 6 CSS px at zoom 0.2 — inside 10px screen min, outside a tiny world halo.
		const hit = pickArchitectureNodeAt(cx + 30, cy, nodes, zoom);
		assert.ok(hit);
		assert.strictEqual(hit!.id, 'a');
	});
});

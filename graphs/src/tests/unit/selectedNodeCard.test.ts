/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	SELECTED_NODE_CARD_HEIGHT,
	SELECTED_NODE_CARD_WIDTH,
	SELECTED_NODE_ENTRY_HEIGHT,
	clampMorphDeltaSeconds,
	hitTestNodePresentation,
	interpolateNodePresentation,
	resolveSelectedNodeCardColors,
} from '../../presentation/selectedNodeCard.js';

suite('selectedNodeCard morph', () => {
	test('t=0 is a square matching the dot diameter', () => {
		const p = interpolateNodePresentation(0, { dotDiameter: 12 });
		assert.strictEqual(p.width, 12);
		assert.strictEqual(p.height, 12);
		assert.ok(Math.abs(p.cornerRadius - 6) < 1e-9);
		assert.strictEqual(p.iconOpacity, 0);
		assert.strictEqual(p.labelOpacity, 0);
	});

	test('t=1 matches First Test card dimensions', () => {
		const p = interpolateNodePresentation(1, { dotDiameter: 12 });
		assert.strictEqual(p.width, SELECTED_NODE_CARD_WIDTH);
		assert.strictEqual(p.height, SELECTED_NODE_CARD_HEIGHT);
		assert.ok(p.iconOpacity >= 0.99);
		assert.ok(p.labelOpacity >= 0.99);
		const entry = interpolateNodePresentation(1, { dotDiameter: 12, isEntry: true });
		assert.strictEqual(entry.height, SELECTED_NODE_ENTRY_HEIGHT);
	});

	test('intermediate values remain finite and in range', () => {
		for (const t of [0.1, 0.33, 0.5, 0.77]) {
			const p = interpolateNodePresentation(t, { dotDiameter: 10, isEntry: false });
			assert.ok(Number.isFinite(p.width) && p.width >= 10 && p.width <= SELECTED_NODE_CARD_WIDTH);
			assert.ok(Number.isFinite(p.height) && p.height >= 10);
			assert.ok(p.cornerRadius >= 0);
			assert.ok(p.iconOpacity >= 0 && p.iconOpacity <= 1);
			assert.ok(p.labelOpacity >= 0 && p.labelOpacity <= 1);
		}
	});

	test('hit testing matches interpolated bounds', () => {
		const p = interpolateNodePresentation(1, { dotDiameter: 8 });
		assert.strictEqual(hitTestNodePresentation(0, 0, 0, 0, p), true);
		assert.strictEqual(hitTestNodePresentation(40, 0, 0, 0, p), false);
		const dot = interpolateNodePresentation(0, { dotDiameter: 8 });
		assert.strictEqual(hitTestNodePresentation(3, 3, 0, 0, dot), true);
		assert.strictEqual(hitTestNodePresentation(20, 0, 0, 0, dot), false);
	});

	test('delta clamp bounds sleep spikes', () => {
		assert.strictEqual(clampMorphDeltaSeconds(1), 0.05);
		assert.strictEqual(clampMorphDeltaSeconds(0.01), 0.01);
		assert.strictEqual(clampMorphDeltaSeconds(-1), 0);
	});

	test('theme color helper falls back without getProperty', () => {
		const colors = resolveSelectedNodeCardColors();
		assert.ok(colors.selectionRing.includes('2dd4bf') || colors.selectionRing.length > 0);
		assert.ok(colors.surface.length > 0);
		assert.ok(colors.label.length > 0);
		const themed = resolveSelectedNodeCardColors((name) => name === '--vscode-foreground' ? '#abc' : '');
		assert.strictEqual(themed.label, '#abc');
	});
});

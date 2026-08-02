/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { isCodeGraphCanvas, normalizeToCodeGraphType } from '../../common/types/graphProduct.js';

suite('PreBase graphProduct', () => {
	test('normalizeToCodeGraphType maps legacy and unknown to code', () => {
		assert.strictEqual(normalizeToCodeGraphType('architecture'), 'code');
		assert.strictEqual(normalizeToCodeGraphType('network'), 'code');
		assert.strictEqual(normalizeToCodeGraphType('code'), 'code');
		assert.strictEqual(normalizeToCodeGraphType(undefined), 'code');
		assert.strictEqual(normalizeToCodeGraphType(null), 'code');
		assert.strictEqual(normalizeToCodeGraphType(''), 'code');
		assert.strictEqual(normalizeToCodeGraphType({}), 'code');
		assert.strictEqual(normalizeToCodeGraphType(0), 'code');
		assert.strictEqual(normalizeToCodeGraphType(['network']), 'code');
	});

	test('isCodeGraphCanvas is true for code and network', () => {
		assert.strictEqual(isCodeGraphCanvas('code'), true);
		assert.strictEqual(isCodeGraphCanvas('network'), true);
		assert.strictEqual(isCodeGraphCanvas('architecture'), false);
		assert.strictEqual(isCodeGraphCanvas(undefined), false);
		assert.strictEqual(isCodeGraphCanvas(null), false);
		assert.strictEqual(isCodeGraphCanvas(''), false);
	});

	test('code canvas path excludes architecture-only product type', () => {
		// ponytail: guards webview/service enrichment — architecture must not take the 3D canvas branch.
		assert.strictEqual(isCodeGraphCanvas(normalizeToCodeGraphType('architecture')), true);
		assert.strictEqual(isCodeGraphCanvas(normalizeToCodeGraphType('network')), true);
	});
});

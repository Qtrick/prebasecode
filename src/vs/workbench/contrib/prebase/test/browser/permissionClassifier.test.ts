/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { classifyNavigateUrl, validatePreviewUrl } from '../../common/runtime/permissionClassifier.js';

suite('Runtime Preview URL permission classifier', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('allows only canonical local preview origins without confirmation', () => {
		for (const url of ['http://localhost:5173/', 'https://127.0.0.1:8443/path', 'http://[::1]:3000/preview']) {
			const result = classifyNavigateUrl(url, false);
			assert.deepStrictEqual(
				{ allowed: result.allowed, requiresApproval: result.requiresApproval, blocked: result.blocked },
				{ allowed: true, requiresApproval: false, blocked: false },
				url,
			);
		}
	});

	test('requires approval for non-canonical loopback and private-network addresses', () => {
		for (const url of ['http://127.0.0.2:5173', 'http://10.0.0.1:5173', 'http://192.168.1.10:5173', 'http://[fd00::1]:5173']) {
			const result = classifyNavigateUrl(url, false);
			assert.deepStrictEqual(
				{ allowed: result.allowed, requiresApproval: result.requiresApproval, blocked: result.blocked },
				{ allowed: false, requiresApproval: true, blocked: false },
				url,
			);
		}
	});

	test('blocks non-HTTP(S) and malformed navigation targets before a preview request can start', () => {
		for (const url of ['javascript:alert(1)', 'file:///tmp/project/index.html', 'data:text/html,unsafe', 'not a url']) {
			const result = classifyNavigateUrl(url, false);
			assert.deepStrictEqual(
				{ allowed: result.allowed, requiresApproval: result.requiresApproval, blocked: result.blocked },
				{ allowed: false, requiresApproval: false, blocked: true },
				url,
			);
		}
	});

	test('preserves a validated local path and query while normalizing a trailing origin slash', () => {
		assert.deepStrictEqual(validatePreviewUrl(' http://localhost:5173/ '), {
			ok: true,
			url: 'http://localhost:5173',
			isLocal: true,
		});
		assert.deepStrictEqual(validatePreviewUrl('http://localhost:5173/app/?view=mobile'), {
			ok: true,
			url: 'http://localhost:5173/app/?view=mobile',
			isLocal: true,
		});
	});
});

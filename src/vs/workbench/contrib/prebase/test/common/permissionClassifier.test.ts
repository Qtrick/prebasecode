/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { classifyNavigateUrl, isLocalhostUrl, validatePreviewUrl } from '../../common/runtime/permissionClassifier.js';

suite('permissionClassifier', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('rewrites wildcard bind hosts to loopback and keeps them local', () => {
		const v4 = validatePreviewUrl('http://0.0.0.0:5173');
		assert.ok(v4.ok);
		assert.strictEqual(v4.url, 'http://127.0.0.1:5173');
		assert.strictEqual(v4.isLocal, true);

		const v6 = validatePreviewUrl('http://[::]:5173/');
		assert.ok(v6.ok);
		assert.strictEqual(v6.url, 'http://[::1]:5173');
		assert.strictEqual(v6.isLocal, true);
	});

	test('treats the whole loopback range as local', () => {
		assert.strictEqual(isLocalhostUrl('http://localhost:3000'), true);
		assert.strictEqual(isLocalhostUrl('http://127.0.0.1:3000'), true);
		assert.strictEqual(isLocalhostUrl('http://127.0.0.2:3000'), true);
		assert.strictEqual(isLocalhostUrl('http://[::1]:3000'), true);
	});

	test('does not treat other hosts as local', () => {
		for (const url of [
			'http://192.168.1.10:3000',
			'http://10.0.0.5:3000',
			'https://example.com',
			'http://localhost.evil.com'
		]) {
			assert.strictEqual(isLocalhostUrl(url), false, url);
		}
	});

	test('external URLs require approval unless explicitly allowed', () => {
		const blocked = classifyNavigateUrl('https://example.com', false);
		assert.strictEqual(blocked.allowed, false);
		assert.strictEqual(blocked.requiresApproval, true);

		const allowed = classifyNavigateUrl('https://example.com', true);
		assert.strictEqual(allowed.allowed, true);
		assert.strictEqual(allowed.requiresApproval, false);
	});

	test('wildcard bind hosts do not bypass the external-URL gate for real remotes', () => {
		const wildcard = classifyNavigateUrl('http://0.0.0.0:8080', false);
		assert.strictEqual(wildcard.allowed, true, 'a dev server bound to every interface stays frictionless');

		const remote = classifyNavigateUrl('http://203.0.113.10:8080', false);
		assert.strictEqual(remote.allowed, false);
		assert.strictEqual(remote.requiresApproval, true);
	});

	test('rejects non-http protocols', () => {
		for (const url of ['file:///etc/passwd', 'vscode://x', 'javascript:alert(1)']) {
			const result = validatePreviewUrl(url);
			assert.strictEqual(result.ok, false, url);
		}
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { selectOwnedCdpPageWebSocketUrl, validateCdpPngScreenshotData } from '../../../../../platform/prebaseDesktop/common/cdpScreenshot.js';

suite('PreBase external CDP screenshots', () => {
	test('selects only a renderer target served by the exact owned loopback port', () => {
		const targets = [
			{ type: 'page', url: 'devtools://devtools', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/devtools' },
			{ type: 'page', url: 'http://localhost:3000', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/wrong-port' },
			{ type: 'service_worker', url: 'http://localhost:3000', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/worker' },
			{ type: 'page', url: 'http://localhost:3000', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/renderer' },
		];

		assert.strictEqual(selectOwnedCdpPageWebSocketUrl(targets, 9222), 'ws://127.0.0.1:9222/devtools/page/renderer');
		assert.strictEqual(selectOwnedCdpPageWebSocketUrl([{ type: 'page', webSocketDebuggerUrl: 'ws://example.com:9222/page' }], 9222), undefined);
	});

	test('accepts bounded base64 and rejects malformed or oversized data', () => {
		assert.strictEqual(validateCdpPngScreenshotData('iVBORw0KGgo='), 'iVBORw0KGgo=');
		assert.throws(() => validateCdpPngScreenshotData('not base64!'), /valid base64/);
		assert.throws(() => validateCdpPngScreenshotData('YWJjZA==', 3), /exceeds/);
	});
});

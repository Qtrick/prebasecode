/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	createRuntimeWebviewControlMessage,
	isRuntimeWebviewControlMessage,
} from '../../common/runtime/runtimeWebviewProtocol.js';

suite('Runtime Preview webview control protocol', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const channel = 'host-only-channel';

	test('accepts host-created commands for each supported lifecycle operation', () => {
		const commands = [
			createRuntimeWebviewControlMessage(channel, 'setUrl', { url: 'http://localhost:5173/app' }),
			createRuntimeWebviewControlMessage(channel, 'clear', { reason: 'Preview stopped' }),
			createRuntimeWebviewControlMessage(channel, 'back'),
			createRuntimeWebviewControlMessage(channel, 'forward'),
			createRuntimeWebviewControlMessage(channel, 'reload'),
		];

		for (const command of commands) {
			assert.strictEqual(isRuntimeWebviewControlMessage(command, channel), true, command.type);
		}
	});

	test('rejects iframe-originated commands that do not carry this webview channel', () => {
		assert.strictEqual(isRuntimeWebviewControlMessage({ channel: 'iframe-controlled', type: 'setUrl', url: 'https://attacker.invalid' }, channel), false);
		assert.strictEqual(isRuntimeWebviewControlMessage({ type: 'reload' }, channel), false);
	});

	test('rejects unknown operations and malformed URL/reason payloads', () => {
		const invalidMessages: unknown[] = [
			{ channel, type: 'navigate', url: 'http://localhost:5173' },
			{ channel, type: 'setUrl', url: 42 },
			{ channel, type: 'clear', reason: ['not', 'a', 'string'] },
			{ channel, type: 'reload', url: { toString: () => 'http://localhost:5173' } },
			null,
			'not an object',
		];

		for (const message of invalidMessages) {
			assert.strictEqual(isRuntimeWebviewControlMessage(message, channel), false);
		}
	});

	test('does not accept a control message after its webview channel has been retired', () => {
		const message = createRuntimeWebviewControlMessage(channel, 'reload');
		assert.strictEqual(isRuntimeWebviewControlMessage(message, channel), true);
		assert.strictEqual(isRuntimeWebviewControlMessage(message, 'new-webview-channel'), false);
	});
});

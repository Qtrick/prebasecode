/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CdpConnection, type MinimalWebSocket } from '../../../../../platform/prebaseDesktop/common/cdpConnection.js';

class FakeWebSocket implements MinimalWebSocket {
	private messageListener: ((raw: unknown) => void) | undefined;
	readonly sent: string[] = [];

	on(event: 'open' | 'close', listener: () => void): void;
	on(event: 'message', listener: (raw: unknown) => void): void;
	on(event: 'error', listener: (error: Error) => void): void;
	on(event: 'open' | 'close' | 'message' | 'error', listener: (() => void) | ((raw: unknown) => void) | ((error: Error) => void)): void {
		if (event === 'message') {
			this.messageListener = listener as (raw: unknown) => void;
		}
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void { }

	emitMessage(message: unknown): void {
		this.messageListener?.(JSON.stringify(message));
	}
}

suite('CdpConnection', () => {
	test('settles a request only from its matching response id', async () => {
		const socket = new FakeWebSocket();
		const connection = new CdpConnection(socket);
		const result = connection.request<{ value: string }>('Runtime.evaluate');
		let settled = false;
		void result.then(() => settled = true);

		assert.deepStrictEqual(JSON.parse(socket.sent[0]), { id: 1, method: 'Runtime.evaluate' });
		connection.handleMessage(JSON.stringify({ method: 'Runtime.consoleAPICalled', params: {} }));
		connection.handleMessage(JSON.stringify({ id: 99, result: { value: 'stale' } }));
		await Promise.resolve();
		assert.strictEqual(settled, false);

		connection.handleMessage(JSON.stringify({ id: 1, result: { value: 'current' } }));
		assert.deepStrictEqual(await result, { value: 'current' });
	});

	test('rejects pending requests on cleanup and ignores their stale responses', async () => {
		const socket = new FakeWebSocket();
		const connection = new CdpConnection(socket);
		const disconnected = connection.request('Runtime.enable');
		connection.rejectAll(new Error('CDP connection closed'));
		await assert.rejects(disconnected, /CDP connection closed/);

		const active = connection.request('Runtime.evaluate');
		let settled = false;
		void active.then(() => settled = true, () => settled = true);
		connection.handleMessage(JSON.stringify({ id: 1, result: {} }));
		await Promise.resolve();
		assert.strictEqual(settled, false);
		connection.rejectAll(new Error('test cleanup'));
		await assert.rejects(active, /test cleanup/);
	});
});

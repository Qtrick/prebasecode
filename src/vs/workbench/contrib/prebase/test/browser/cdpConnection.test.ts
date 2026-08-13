/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import type { IDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CdpConnection, type MinimalWebSocket } from '../../../../../platform/prebaseDesktop/common/cdpConnection.js';

class FakeWebSocket implements MinimalWebSocket {
	private messageListener: ((raw: unknown) => void) | undefined;
	readonly sent: string[] = [];
	throwOnSend: Error | undefined;
	closed = false;

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
		if (this.throwOnSend) {
			throw this.throwOnSend;
		}
	}

	close(): void { this.closed = true; }

	emitMessage(message: unknown): void {
		this.messageListener?.(JSON.stringify(message));
	}
}

class TestCancellationToken implements CancellationToken {
	private readonly _listeners = new Set<(event: void) => unknown>();
	isCancellationRequested = false;

	onCancellationRequested = (listener: (event: void) => unknown, thisArgs?: unknown): IDisposable => {
		const callback = thisArgs === undefined ? listener : (event: void) => listener.call(thisArgs, event);
		this._listeners.add(callback);
		return { dispose: () => this._listeners.delete(callback) };
	};

	cancel(): void {
		this.isCancellationRequested = true;
		for (const listener of [...this._listeners]) {
			listener(undefined);
		}
	}

	get listenerCount(): number {
		return this._listeners.size;
	}
}

suite('CdpConnection', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
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

	test('times out an unanswered request, removes it, and ignores its late response', async () => {
		const socket = new FakeWebSocket();
		const connection = new CdpConnection(socket, 5);
		const timedOut = connection.request('Runtime.evaluate');

		await assert.rejects(timedOut, /CDP request timed out: Runtime\.evaluate/);
		connection.handleMessage(JSON.stringify({ id: 1, result: { stale: true } }));

		const current = connection.request<{ current: true }>('Runtime.enable');
		connection.handleMessage(JSON.stringify({ id: 2, result: { current: true } }));
		assert.deepStrictEqual(await current, { current: true });
	});

	test('clears request timers during rejectAll so cleanup is the only rejection cause', async () => {
		const socket = new FakeWebSocket();
		const connection = new CdpConnection(socket, 5);
		const pending = connection.request('Runtime.enable');
		connection.rejectAll(new Error('socket closed'));

		await assert.rejects(pending, /socket closed/);
		await new Promise(resolve => setTimeout(resolve, 10));
	});

	test('enforces the pending request limit without sending an untracked request and releases a slot after settlement', async () => {
		const socket = new FakeWebSocket();
		const connection = new CdpConnection(socket, 100, 2);
		const first = connection.request('Runtime.enable');
		const second = connection.request('Runtime.evaluate');

		await assert.rejects(connection.request('Runtime.getProperties'), /CDP pending request limit exceeded \(2\)/);
		assert.strictEqual(socket.sent.length, 2);
		connection.handleMessage(JSON.stringify({ id: 1, result: {} }));
		await first;

		const replacement = connection.request<{ active: true }>('Runtime.getProperties');
		assert.strictEqual(socket.sent.length, 3);
		connection.handleMessage(JSON.stringify({ id: 3, result: { active: true } }));
		assert.deepStrictEqual(await replacement, { active: true });
		connection.rejectAll(new Error('test cleanup'));
		await assert.rejects(second, /test cleanup/);
	});

	test('rejects every pending request when an oversized UTF-8 inbound frame arrives and ignores its stale results', async () => {
		const socket = new FakeWebSocket();
		const connection = new CdpConnection(socket, 100, 4, 100);
		const first = connection.request('Runtime.enable');
		const second = connection.request('Runtime.evaluate');
		// Attach handlers before the synchronous rejection so Node does not treat
		// either pending protocol promise as an unhandled rejection.
		void first.catch(() => undefined);
		void second.catch(() => undefined);

		connection.handleMessage('€'.repeat(34));
		await assert.rejects(first, /CDP inbound message exceeds the 0\.09765625 KiB limit/);
		await assert.rejects(second, /CDP inbound message exceeds the 0\.09765625 KiB limit/);
		assert.strictEqual(socket.closed, true);
		connection.handleMessage(JSON.stringify({ id: 1, result: { stale: true } }));

		const current = connection.request<{ current: true }>('Runtime.enable');
		connection.handleMessage(JSON.stringify({ id: 3, result: { current: true } }));
		assert.deepStrictEqual(await current, { current: true });
	});

	test('rejects malformed protocol input and releases the request slot for a later request', async () => {
		const socket = new FakeWebSocket();
		const connection = new CdpConnection(socket, 100, 1);
		const pending = connection.request('Runtime.enable');
		const rejected = assert.rejects(pending, /JSON|Expected property/);
		connection.handleMessage('{not json');
		await rejected;

		const current = connection.request<{ current: true }>('Runtime.evaluate');
		connection.handleMessage(JSON.stringify({ id: 2, result: { current: true } }));
		assert.deepStrictEqual(await current, { current: true });
	});

	test('cleans up a request whose websocket send throws so its pending slot is not retained', async () => {
		const socket = new FakeWebSocket();
		socket.throwOnSend = new Error('websocket send failed');
		const connection = new CdpConnection(socket, 100, 1);
		await assert.rejects(connection.request('Runtime.enable'), /websocket send failed/);

		socket.throwOnSend = undefined;
		const current = connection.request<{ current: true }>('Runtime.enable');
		connection.handleMessage(JSON.stringify({ id: 2, result: { current: true } }));
		assert.deepStrictEqual(await current, { current: true });
	});

	test('does not send or register an already-cancelled request', async () => {
		const socket = new FakeWebSocket();
		const connection = new CdpConnection(socket, 100, 1);
		const token = new TestCancellationToken();
		token.cancel();

		await assert.rejects(connection.request('Runtime.enable', undefined, token), CancellationError);
		assert.strictEqual(socket.sent.length, 0);
		assert.strictEqual(token.listenerCount, 0);

		const current = connection.request<{ current: true }>('Runtime.enable');
		connection.handleMessage(JSON.stringify({ id: 1, result: { current: true } }));
		assert.deepStrictEqual(await current, { current: true });
	});

	test('cancels only its own in-flight request, releases its slot, and ignores its late response', async () => {
		const socket = new FakeWebSocket();
		const connection = new CdpConnection(socket, 100, 2);
		const cancelledToken = new TestCancellationToken();
		const activeToken = new TestCancellationToken();
		const cancelled = connection.request('Runtime.enable', undefined, cancelledToken);
		const active = connection.request<{ active: true }>('Runtime.evaluate', undefined, activeToken);

		assert.strictEqual(cancelledToken.listenerCount, 1);
		assert.strictEqual(activeToken.listenerCount, 1);
		cancelledToken.cancel();
		await assert.rejects(cancelled, CancellationError);
		assert.strictEqual(cancelledToken.listenerCount, 0);
		connection.handleMessage(JSON.stringify({ id: 1, result: { stale: true } }));
		connection.handleMessage(JSON.stringify({ id: 2, result: { active: true } }));
		assert.deepStrictEqual(await active, { active: true });
		assert.strictEqual(activeToken.listenerCount, 0);

		const replacement = connection.request<{ replacement: true }>('Runtime.getProperties');
		connection.handleMessage(JSON.stringify({ id: 3, result: { replacement: true } }));
		assert.deepStrictEqual(await replacement, { replacement: true });
	});

	test('disposes cancellation registrations after timeout, rejectAll, and send failure', async () => {
		const timedSocket = new FakeWebSocket();
		const timedConnection = new CdpConnection(timedSocket, 5);
		const timedToken = new TestCancellationToken();
		await assert.rejects(timedConnection.request('Runtime.enable', undefined, timedToken), /CDP request timed out/);
		assert.strictEqual(timedToken.listenerCount, 0);

		const cleanupSocket = new FakeWebSocket();
		const cleanupConnection = new CdpConnection(cleanupSocket);
		const cleanupToken = new TestCancellationToken();
		const pending = cleanupConnection.request('Runtime.enable', undefined, cleanupToken);
		cleanupConnection.rejectAll(new Error('socket closed'));
		await assert.rejects(pending, /socket closed/);
		assert.strictEqual(cleanupToken.listenerCount, 0);

		const failingSocket = new FakeWebSocket();
		failingSocket.throwOnSend = new Error('send failed');
		const failingConnection = new CdpConnection(failingSocket);
		const failingToken = new TestCancellationToken();
		await assert.rejects(failingConnection.request('Runtime.enable', undefined, failingToken), /send failed/);
		assert.strictEqual(failingToken.listenerCount, 0);
	});
});

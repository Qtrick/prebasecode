/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import type { IDisposable } from '../../../../../base/common/lifecycle.js';
import { newWriteableBufferStream, VSBuffer, type VSBufferReadableStream } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { readRuntimeResponseText } from '../../common/runtime/runtimeResponseReader.js';

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

function trackedStream(): { stream: VSBufferReadableStream; write(chunk: VSBuffer): void; end(): void; error(error: Error): void; get destroyCount(): number; get removeCount(): number } {
	const stream = newWriteableBufferStream();
	const originalDestroy = stream.destroy.bind(stream);
	const originalRemoveListener = stream.removeListener.bind(stream);
	let destroyCount = 0;
	let removeCount = 0;
	stream.destroy = () => {
		destroyCount++;
		originalDestroy();
	};
	stream.removeListener = (event: string, listener: Function) => {
		removeCount++;
		originalRemoveListener(event, listener);
	};
	return {
		stream,
		write: chunk => stream.write(chunk),
		end: () => stream.end(),
		error: error => stream.error(error),
		get destroyCount() { return destroyCount; },
		get removeCount() { return removeCount; },
	};
}

suite('Runtime Preview bounded response reader', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('reads a below-cap multi-chunk response and disposes all listeners', async () => {
		const source = trackedStream();
		const token = new TestCancellationToken();
		const reading = readRuntimeResponseText(source.stream, 10, token);
		source.write(VSBuffer.fromString('hel'));
		source.write(VSBuffer.fromString('lo'));
		source.end();

		assert.deepStrictEqual(await reading, { text: 'hello', bytesRead: 5, tooLarge: false });
		assert.strictEqual(source.removeCount, 3);
		assert.strictEqual(token.listenerCount, 0);
	});

	test('accepts a response exactly at the byte cap', async () => {
		const source = trackedStream();
		const reading = readRuntimeResponseText(source.stream, 5, new TestCancellationToken());
		source.write(VSBuffer.fromString('hello'));
		source.end();

		assert.deepStrictEqual(await reading, { text: 'hello', bytesRead: 5, tooLarge: false });
	});

	test('destroys and reports a response one byte over the cap without retaining its oversized chunk', async () => {
		const source = trackedStream();
		const reading = readRuntimeResponseText(source.stream, 5, new TestCancellationToken());
		source.write(VSBuffer.fromString('four'));
		source.write(VSBuffer.fromString('56'));

		assert.deepStrictEqual(await reading, { text: '', bytesRead: 4, tooLarge: true });
		assert.strictEqual(source.destroyCount, 1);
	});

	test('uses replacement characters for malformed UTF-8 while retaining the byte count', async () => {
		const source = trackedStream();
		const reading = readRuntimeResponseText(source.stream, 10, new TestCancellationToken());
		source.write(VSBuffer.wrap(new Uint8Array([0xC3, 0x28])));
		source.end();

		const result = await reading;
		assert.strictEqual(result.text, '\uFFFD(');
		assert.strictEqual(result.bytesRead, 2);
		assert.strictEqual(result.tooLarge, false);
	});

	test('propagates stream errors and releases cancellation/listener resources', async () => {
		const source = trackedStream();
		const token = new TestCancellationToken();
		const reading = readRuntimeResponseText(source.stream, 10, token);
		source.error(new Error('preview stream failed'));

		await assert.rejects(reading, /preview stream failed/);
		assert.strictEqual(source.removeCount, 3);
		assert.strictEqual(token.listenerCount, 0);
	});

	test('rejects both pre-cancelled and mid-stream cancellation while destroying the response', async () => {
		const preCancelled = trackedStream();
		const preToken = new TestCancellationToken();
		preToken.cancel();
		await assert.rejects(readRuntimeResponseText(preCancelled.stream, 10, preToken), CancellationError);
		assert.strictEqual(preCancelled.destroyCount, 1);
		assert.strictEqual(preToken.listenerCount, 0);

		const midStream = trackedStream();
		const midToken = new TestCancellationToken();
		const reading = readRuntimeResponseText(midStream.stream, 10, midToken);
		midStream.write(VSBuffer.fromString('partial'));
		midToken.cancel();
		await assert.rejects(reading, CancellationError);
		assert.strictEqual(midStream.destroyCount, 1);
		assert.strictEqual(midToken.listenerCount, 0);
	});
});

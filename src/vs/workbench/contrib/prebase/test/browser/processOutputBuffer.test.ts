/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../../base/test/common/utils.js";
import assert from 'assert';
import { MAX_PROCESS_OUTPUT_ENTRIES, MAX_PROCESS_OUTPUT_ENTRY_BYTES, ProcessOutputBuffer } from '../../../../../platform/prebaseDesktop/common/processOutputBuffer.js';

const encoder = new TextEncoder();

suite('ProcessOutputBuffer', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('frames stdout and stderr independently across chunks and preserves timestamps', () => {
		const output = new ProcessOutputBuffer();
		output.append('stdout', encoder.encode('out one\r\npartial'), 10);
		output.append('stderr', encoder.encode('error one\n'), 11);
		output.append('stdout', encoder.encode(' two\n'), 12);

		assert.deepStrictEqual(output.getEntries(10), {
			entries: [
				{ stream: 'stdout', timestamp: 10, text: 'out one', truncated: false },
				{ stream: 'stderr', timestamp: 11, text: 'error one', truncated: false },
				{ stream: 'stdout', timestamp: 12, text: 'partial two', truncated: false },
			],
			droppedCount: 0,
			truncated: false,
		});
	});

	test('decodes a UTF-8 character split across chunks without replacement text', () => {
		const output = new ProcessOutputBuffer();
		const bytes = encoder.encode('ready \u{1F680}\n');
		output.append('stdout', bytes.slice(0, 7), 20);
		output.append('stdout', bytes.slice(7), 21);

		assert.strictEqual(output.getEntries().entries[0].text, 'ready \u{1F680}');
	});

	test('redacts complete secret-bearing output even when its value spans chunks', () => {
		const output = new ProcessOutputBuffer();
		output.append('stderr', encoder.encode('authorization: Bearer abcdefghijkl'), 30);
		output.append('stderr', encoder.encode('mnop\napi_key="should-not-appear"\n'), 31);
		output.append('stdout', encoder.encode('cookie=session-secret\n'), 32);

		assert.deepStrictEqual(output.getEntries(10).entries.map(entry => entry.text), [
			'authorization=[redacted]',
			'api_key=[redacted]',
			'cookie=[redacted]',
		]);
	});

	test('flushes unterminated stdout and stderr fragments on process exit', () => {
		const output = new ProcessOutputBuffer();
		output.append('stdout', encoder.encode('last stdout'), 40);
		output.append('stderr', encoder.encode('last stderr'), 41);
		output.flush(42);

		assert.deepStrictEqual(output.getEntries(10).entries, [
			{ stream: 'stdout', timestamp: 42, text: 'last stdout', truncated: false },
			{ stream: 'stderr', timestamp: 42, text: 'last stderr', truncated: false },
		]);
	});

	test('evicts oldest output at the ring limit and reports both retained-window and historical drops', () => {
		const output = new ProcessOutputBuffer();
		for (let index = 0; index < MAX_PROCESS_OUTPUT_ENTRIES + 2; index++) {
			output.append('stdout', encoder.encode(`line-${index}\n`), index);
		}

		const all = output.getEntries(MAX_PROCESS_OUTPUT_ENTRIES);
		assert.strictEqual(all.entries.length, MAX_PROCESS_OUTPUT_ENTRIES);
		assert.strictEqual(all.entries[0].text, 'line-2');
		assert.strictEqual(all.droppedCount, 2);
		assert.strictEqual(all.truncated, true);

		const latest = output.getEntries(3);
		assert.deepStrictEqual(latest.entries.map(entry => entry.text), ['line-199', 'line-200', 'line-201']);
		assert.strictEqual(latest.droppedCount, MAX_PROCESS_OUTPUT_ENTRIES - 3 + 2);
		assert.strictEqual(latest.truncated, true);
	});

	test('truncates a single oversized unframed entry by byte limit', () => {
		const output = new ProcessOutputBuffer();
		output.append('stderr', encoder.encode('x'.repeat(MAX_PROCESS_OUTPUT_ENTRY_BYTES + 1)), 50);

		const entry = output.getEntries().entries[0];
		assert.strictEqual(entry.truncated, true);
		assert.strictEqual(new TextEncoder().encode(entry.text).byteLength, MAX_PROCESS_OUTPUT_ENTRY_BYTES);
	});

	test('never exceeds the byte cap when truncation falls inside a UTF-8 character', () => {
		const output = new ProcessOutputBuffer();
		output.append('stdout', encoder.encode('x'.repeat(MAX_PROCESS_OUTPUT_ENTRY_BYTES - 2) + '\u{1F680}'), 60);

		const entry = output.getEntries().entries[0];
		assert.strictEqual(entry.truncated, true);
		assert.ok(encoder.encode(entry.text).byteLength <= MAX_PROCESS_OUTPUT_ENTRY_BYTES);
		assert.ok(!entry.text.endsWith('\uFFFD'));
	});
});

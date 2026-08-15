/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { suite, test } from 'node:test';
import { formatProcessOutputForTool, MAX_PROCESS_OUTPUT_TOOL_ENTRIES, MAX_PROCESS_OUTPUT_TOOL_ENTRY_CHARACTERS } from './processOutputFormatter.js';

suite('Magnus process output formatter', () => {
	test('returns JSON-safe process output when unexpected values contain cycles and bigints', () => {
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		const formatted = formatProcessOutputForTool({
			entries: [{ stream: 'stderr', text: 'safe', extra: cyclic }],
			droppedCount: 1n,
		});

		const parsed = JSON.parse(JSON.stringify(formatted)) as { droppedCount: string; entries: Array<{ extra: { self: string } }> };
		assert.strictEqual(parsed.droppedCount, '1');
		assert.strictEqual(parsed.entries[0].extra.self, '[circular]');
	});

	test('retains only the newest bounded output entries and marks tool truncation', () => {
		const formatted = formatProcessOutputForTool({
			entries: Array.from({ length: MAX_PROCESS_OUTPUT_TOOL_ENTRIES + 2 }, (_, index) => ({ text: `line-${index}` })),
		}) as { entries: Array<{ text: string }>; truncated: boolean; toolOutputTruncated: boolean };

		assert.deepStrictEqual(formatted.entries.map(entry => entry.text), Array.from({ length: MAX_PROCESS_OUTPUT_TOOL_ENTRIES }, (_, index) => `line-${index + 2}`));
		assert.strictEqual(formatted.truncated, true);
		assert.strictEqual(formatted.toolOutputTruncated, true);
	});

	test('truncates an oversized entry and preserves explicit upstream truncation', () => {
		const formatted = formatProcessOutputForTool({
			truncated: true,
			entries: [{ text: 'x'.repeat(MAX_PROCESS_OUTPUT_TOOL_ENTRY_CHARACTERS + 1), truncated: false }],
		}) as { entries: Array<{ text: string; truncated: boolean }>; truncated: boolean; toolOutputTruncated: boolean };

		assert.strictEqual(formatted.entries[0].text.length, MAX_PROCESS_OUTPUT_TOOL_ENTRY_CHARACTERS);
		assert.strictEqual(formatted.entries[0].truncated, true);
		assert.strictEqual(formatted.truncated, true);
		assert.strictEqual(formatted.toolOutputTruncated, true);
	});
});

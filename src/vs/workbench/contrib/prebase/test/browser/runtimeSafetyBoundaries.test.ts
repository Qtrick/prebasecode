/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../../base/test/common/utils.js";
import assert from 'assert';
import {
	appendRuntimeEvidence,
	MAX_RUNTIME_EVIDENCE_CHARACTERS,
	MAX_RUNTIME_EVIDENCE_ENTRIES,
	MAX_RUNTIME_EVIDENCE_ENTRY_CHARACTERS,
} from '../../common/runtime/evidenceBuffer.js';
import { stopDesktopSessionForMagnus, type DesktopSessionTerminator } from '../../common/runtime/desktopStopForMagnus.js';

suite('PreBase Runtime safety boundaries', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('bounds evidence by entry count while retaining the newest tail', () => {
		let entries: string[] = [];
		let droppedCount = 0;
		for (let index = 0; index < MAX_RUNTIME_EVIDENCE_ENTRIES + 20; index++) {
			const result = appendRuntimeEvidence(entries, `line-${index}`);
			entries = result.entries;
			droppedCount += result.droppedCount;
		}

		assert.ok(entries.length <= MAX_RUNTIME_EVIDENCE_ENTRIES);
		assert.strictEqual(entries.at(-1), `line-${MAX_RUNTIME_EVIDENCE_ENTRIES + 19}`);
		assert.ok(droppedCount > 0);
	});

	test('bounds oversized evidence by total characters and individual entry size', () => {
		let entries: string[] = [];
		for (let index = 0; index < 30; index++) {
			entries = appendRuntimeEvidence(entries, `${index}:${'x'.repeat(3_000)}`).entries;
		}
		const result = appendRuntimeEvidence(entries, `latest:${'y'.repeat(MAX_RUNTIME_EVIDENCE_ENTRY_CHARACTERS + 1_000)}`);

		assert.ok(result.entries.reduce((total, entry) => total + entry.length, 0) <= MAX_RUNTIME_EVIDENCE_CHARACTERS);
		assert.ok(result.entries.every(entry => entry.length <= MAX_RUNTIME_EVIDENCE_ENTRY_CHARACTERS));
		assert.strictEqual(result.entries.at(-1)?.length, MAX_RUNTIME_EVIDENCE_ENTRY_CHARACTERS);
		assert.ok(result.droppedCount > 0);
	});

	test('always uses confirmation-aware kill even when a legacy force argument is supplied', async () => {
		let killCalls = 0;
		const desktop: DesktopSessionTerminator & { stop(): Promise<void> } = {
			kill: async () => { killCalls++; },
			stop: async () => { throw new Error('confirmation bypassed'); },
		};

		await (stopDesktopSessionForMagnus as (value: DesktopSessionTerminator, legacyForce?: boolean) => Promise<void>)(desktop, true);
		assert.strictEqual(killCalls, 1);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const MAX_RUNTIME_EVIDENCE_ENTRIES = 200;
export const MAX_RUNTIME_EVIDENCE_ENTRY_CHARACTERS = 4_000;
export const MAX_RUNTIME_EVIDENCE_CHARACTERS = 64_000;

export interface RuntimeEvidenceAppendResult {
	entries: string[];
	droppedCount: number;
}

/**
 * Retain a bounded tail of Runtime Preview evidence so a noisy workspace cannot
 * keep growing renderer memory or agent context indefinitely.
 */
export function appendRuntimeEvidence(entries: readonly string[], entry: string): RuntimeEvidenceAppendResult {
	const next = [...entries, entry.slice(-MAX_RUNTIME_EVIDENCE_ENTRY_CHARACTERS)];
	let retainedCharacters = 0;
	let start = next.length;
	while (start > 0 && retainedCharacters + next[start - 1].length <= MAX_RUNTIME_EVIDENCE_CHARACTERS && next.length - start < MAX_RUNTIME_EVIDENCE_ENTRIES) {
		start--;
		retainedCharacters += next[start].length;
	}
	return { entries: next.slice(start), droppedCount: start };
}

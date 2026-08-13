/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const MAX_PROCESS_OUTPUT_TOOL_ENTRIES = 10;
export const MAX_PROCESS_OUTPUT_TOOL_ENTRY_CHARACTERS = 1_024;

function jsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'bigint') {
		return value.toString();
	}
	if (Array.isArray(value)) {
		return value.map(item => jsonSafe(item, seen));
	}
	if (value && typeof value === 'object') {
		if (seen.has(value)) {
			return '[circular]';
		}
		seen.add(value);
		const result: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (entry !== undefined && typeof entry !== 'function' && typeof entry !== 'symbol') {
				result[key] = jsonSafe(entry, seen);
			}
		}
		seen.delete(value);
		return result;
	}
	return undefined;
}

/** Bounds process output and guarantees a value that can be serialized for a language-model tool. */
export function formatProcessOutputForTool(value: unknown): unknown {
	if (!value || typeof value !== 'object') {
		return jsonSafe(value ?? { ok: false });
	}
	const output = value as { entries?: unknown; truncated?: unknown; [key: string]: unknown };
	if (!Array.isArray(output.entries)) {
		return jsonSafe(output);
	}
	let toolOutputTruncated = output.entries.length > MAX_PROCESS_OUTPUT_TOOL_ENTRIES;
	const entries = output.entries.slice(-MAX_PROCESS_OUTPUT_TOOL_ENTRIES).map(entry => {
		const safeEntry = jsonSafe(entry);
		if (!safeEntry || typeof safeEntry !== 'object' || Array.isArray(safeEntry)) {
			return safeEntry;
		}
		const outputEntry = safeEntry as { text?: unknown; truncated?: unknown; [key: string]: unknown };
		if (typeof outputEntry.text !== 'string' || outputEntry.text.length <= MAX_PROCESS_OUTPUT_TOOL_ENTRY_CHARACTERS) {
			return outputEntry;
		}
		toolOutputTruncated = true;
		return {
			...outputEntry,
			text: outputEntry.text.slice(0, MAX_PROCESS_OUTPUT_TOOL_ENTRY_CHARACTERS),
			truncated: true,
		};
	});
	const safeOutput = jsonSafe(output) as Record<string, unknown>;
	return {
		...safeOutput,
		entries,
		truncated: output.truncated === true || toolOutputTruncated,
		toolOutputTruncated,
	};
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const MAX_PROCESS_OUTPUT_ENTRIES = 200;
export const MAX_PROCESS_OUTPUT_BYTES = 128 * 1024;
export const MAX_PROCESS_OUTPUT_ENTRY_BYTES = 4 * 1024;

export type ProcessOutputStream = 'stdout' | 'stderr';

export interface ProcessOutputEntry {
	readonly stream: ProcessOutputStream;
	readonly timestamp: number;
	readonly text: string;
	readonly truncated: boolean;
}

function redactProcessOutput(value: string): string {
	return value
		.replace(/\b(authorization|cookie|set-cookie)\b\s*[:=]\s*[^\r\n]*/gi, '$1=[redacted]')
		.replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [redacted]')
		.replace(/\b(api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|secret)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1=[redacted]')
		.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted-jwt]');
}

/** Bounded, redacted line buffer for PreBase-owned external process output. */
export class ProcessOutputBuffer {
	private readonly _decoders: Record<ProcessOutputStream, TextDecoder> = {
		stdout: new TextDecoder(),
		stderr: new TextDecoder(),
	};
	private readonly _pending: Record<ProcessOutputStream, string> = { stdout: '', stderr: '' };
	private _entries: ProcessOutputEntry[] = [];
	private _bytes = 0;
	private _droppedCount = 0;

	append(stream: ProcessOutputStream, data: Uint8Array, timestamp = Date.now()): void {
		this._appendText(stream, this._decoders[stream].decode(data, { stream: true }), timestamp);
	}

	flush(timestamp = Date.now()): void {
		for (const stream of ['stdout', 'stderr'] as const) {
			this._appendText(stream, this._decoders[stream].decode(), timestamp);
			if (this._pending[stream]) {
				this._record(stream, this._pending[stream], timestamp);
				this._pending[stream] = '';
			}
		}
	}

	getEntries(maximumEntries = 100): { entries: ProcessOutputEntry[]; droppedCount: number; truncated: boolean } {
		const maximum = Math.max(1, Math.min(MAX_PROCESS_OUTPUT_ENTRIES, Math.floor(maximumEntries)));
		const entries = this._entries.slice(-maximum);
		return { entries, droppedCount: this._droppedCount + this._entries.length - entries.length, truncated: this._droppedCount > 0 || entries.length !== this._entries.length };
	}

	private _appendText(stream: ProcessOutputStream, text: string, timestamp: number): void {
		if (!text) {
			return;
		}
		const combined = this._pending[stream] + text;
		const lines = combined.split(/\r?\n/);
		this._pending[stream] = lines.pop() ?? '';
		for (const line of lines) {
			this._record(stream, line, timestamp);
		}
		if (new TextEncoder().encode(this._pending[stream]).byteLength > MAX_PROCESS_OUTPUT_ENTRY_BYTES) {
			this._record(stream, this._pending[stream], timestamp);
			this._pending[stream] = '';
		}
	}

	private _record(stream: ProcessOutputStream, text: string, timestamp: number): void {
		let redacted = redactProcessOutput(text);
		let truncated = false;
		const encoded = new TextEncoder().encode(redacted);
		if (encoded.byteLength > MAX_PROCESS_OUTPUT_ENTRY_BYTES) {
			redacted = new TextDecoder().decode(encoded.slice(0, MAX_PROCESS_OUTPUT_ENTRY_BYTES));
			truncated = true;
		}
		const bytes = new TextEncoder().encode(redacted).byteLength;
		this._entries.push({ stream, timestamp, text: redacted, truncated });
		this._bytes += bytes;
		while (this._entries.length > MAX_PROCESS_OUTPUT_ENTRIES || this._bytes > MAX_PROCESS_OUTPUT_BYTES) {
			const dropped = this._entries.shift()!;
			this._bytes -= new TextEncoder().encode(dropped.text).byteLength;
			this._droppedCount++;
		}
	}
}

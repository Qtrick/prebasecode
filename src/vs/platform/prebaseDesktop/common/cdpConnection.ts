/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface MinimalWebSocket {
	on(event: 'open' | 'close', listener: () => void): void;
	on(event: 'message', listener: (raw: unknown) => void): void;
	on(event: 'error', listener: (error: Error) => void): void;
	send(data: string): void;
	close(): void;
}

export const MAX_CDP_INBOUND_MESSAGE_BYTES = 1 * 1024 * 1024;
export const MAX_CDP_PENDING_REQUESTS = 64;

interface CdpResponse {
	id?: number;
	result?: unknown;
	error?: { message?: string };
}

function utf8ByteLength(value: string, stopAfter: number): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code < 0x80) {
			bytes += 1;
		} else if (code < 0x800) {
			bytes += 2;
		} else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF) {
			bytes += 4;
			index++;
		} else {
			bytes += 3;
		}
		if (bytes > stopAfter) {
			return bytes;
		}
	}
	return bytes;
}

/** Correlates CDP responses by request id and safely ignores protocol events. */
export class CdpConnection {
	private _nextId = 1;
	private readonly _pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

	constructor(
		private readonly _webSocket: MinimalWebSocket,
		private readonly _requestTimeoutMs = 8_000,
		private readonly _maxPendingRequests = MAX_CDP_PENDING_REQUESTS,
		private readonly _maxInboundMessageBytes = MAX_CDP_INBOUND_MESSAGE_BYTES,
	) { }

	request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
		if (this._pending.size >= this._maxPendingRequests) {
			return Promise.reject(new Error(`CDP pending request limit exceeded (${this._maxPendingRequests}).`));
		}
		const id = this._nextId++;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this._pending.delete(id)) {
					reject(new Error(`CDP request timed out: ${method}`));
				}
			}, this._requestTimeoutMs);
			this._pending.set(id, { resolve: value => resolve(value as T), reject, timer });
			try {
				this._webSocket.send(JSON.stringify({ id, method, params }));
			} catch (error) {
				clearTimeout(timer);
				this._pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	handleMessage(raw: unknown): void {
		const rawBytes = typeof raw === 'string'
			? utf8ByteLength(raw, this._maxInboundMessageBytes)
			: raw instanceof Uint8Array
				? raw.byteLength
				: undefined;
		if (rawBytes !== undefined && rawBytes > this._maxInboundMessageBytes) {
			this.rejectAll(new Error(`CDP inbound message exceeds the ${this._maxInboundMessageBytes / 1024} KiB limit.`));
			this._webSocket.close();
			return;
		}
		let message: CdpResponse;
		try {
			message = JSON.parse(String(raw)) as CdpResponse;
		} catch (error) {
			this.rejectAll(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		if (typeof message.id !== 'number') {
			return;
		}
		const pending = this._pending.get(message.id);
		if (!pending) {
			return;
		}
		this._pending.delete(message.id);
		clearTimeout(pending.timer);
		if (message.error) {
			pending.reject(new Error(message.error.message || 'CDP error'));
			return;
		}
		pending.resolve(message.result);
	}

	rejectAll(error: Error): void {
		for (const pending of this._pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this._pending.clear();
	}
}

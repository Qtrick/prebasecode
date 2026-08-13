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

interface CdpResponse {
	id?: number;
	result?: unknown;
	error?: { message?: string };
}

/** Correlates CDP responses by request id and safely ignores protocol events. */
export class CdpConnection {
	private _nextId = 1;
	private readonly _pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

	constructor(private readonly _webSocket: MinimalWebSocket, private readonly _requestTimeoutMs = 8_000) { }

	request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
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

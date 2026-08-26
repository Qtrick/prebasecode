/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Decouple network SSE arrival from UI reveal.
 *
 * Raw Gemini/Copilot streams arrive in bursty chunks; rendering them directly makes
 * replies "pop" all at once. Buffer incoming text and drip characters at a steady,
 * readable pace. This module is the sole presentation pacing owner — provider
 * transports must emit source data as quickly as received.
 */

export interface PaceOptions {
	/** Characters revealed each tick. Default 3. */
	readonly charsPerTick?: number;
	/** Milliseconds between ticks. Default 22 (~136 chars/sec). */
	readonly intervalMs?: number;
	readonly token?: { readonly isCancellationRequested: boolean; readonly onCancellationRequested?: (listener: () => void) => { dispose(): void } };
	/** Optional injected sleep function for deterministic unit testing. */
	readonly sleepFn?: (ms: number) => Promise<void>;
	/** Soft cap on buffered source characters before adaptive catch-up saturates. */
	readonly maxBacklogChars?: number;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xD800 && code <= 0xDBFF;
}

const DEFAULT_MAX_BACKLOG = 262_144;
const SOURCE_HALT_MS = 50;

/**
 * Consume an async text stream, buffer it, and yield paced character batches.
 * Cancellation stops both the display loop and the source iterator (return()).
 * The hidden reader is never awaited without a bound after cancellation.
 */
export async function* paceTextStream(
	source: AsyncIterable<string>,
	options: PaceOptions = {},
): AsyncGenerator<string, void, unknown> {
	const baseCharsPerTick = Math.max(1, options.charsPerTick ?? 3);
	const intervalMs = Math.max(1, options.intervalMs ?? 22);
	const token = options.token;
	const sleep = options.sleepFn ?? defaultSleep;
	const maxBacklog = Math.max(1024, options.maxBacklogChars ?? DEFAULT_MAX_BACKLOG);

	let buffer = '';
	let bufferIndex = 0;
	let sourceDone = false;
	let sourceError: unknown;
	let progressWaiter: (() => void) | undefined;
	const iterator = source[Symbol.asyncIterator]();

	const notifyProgress = () => {
		progressWaiter?.();
		progressWaiter = undefined;
	};

	const waitForProgress = () => new Promise<void>(resolve => {
		if (sourceDone || bufferIndex < buffer.length || token?.isCancellationRequested) {
			resolve();
			return;
		}
		progressWaiter = resolve;
		if (sourceDone || bufferIndex < buffer.length || token?.isCancellationRequested) {
			notifyProgress();
		}
	});

	const cancelSub = token?.onCancellationRequested?.(() => {
		notifyProgress();
	});

	const paceWait = () => new Promise<void>(resolve => {
		let settled = false;
		let sub: { dispose(): void } | undefined;
		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			sub?.dispose();
			resolve();
		};
		sub = token?.onCancellationRequested?.(finish);
		void sleep(intervalMs).then(finish);
		if (token?.isCancellationRequested) {
			finish();
		}
	});

	const reader = (async () => {
		try {
			while (!token?.isCancellationRequested) {
				const next = await iterator.next();
				if (next.done) {
					return;
				}
				if (token?.isCancellationRequested) {
					return;
				}
				if (next.value) {
					if (bufferIndex > 4096 && bufferIndex > (buffer.length >> 1)) {
						buffer = buffer.slice(bufferIndex);
						bufferIndex = 0;
					}
					buffer += next.value;
					const pending = buffer.length - bufferIndex;
					if (pending > maxBacklog) {
						bufferIndex += pending - maxBacklog;
					}
					notifyProgress();
				}
			}
		} catch (err) {
			sourceError = err;
		} finally {
			sourceDone = true;
			notifyProgress();
		}
	})();

	const stopSource = async () => {
		if (sourceDone) {
			notifyProgress();
			return;
		}
		sourceDone = true;
		notifyProgress();
		// Halt bound uses wall-clock sleep, not the pacing sleepFn (tests inject a no-op).
		const halted = Promise.resolve()
			.then(() => iterator.return?.())
			.then(() => undefined, () => undefined);
		await Promise.race([halted, defaultSleep(SOURCE_HALT_MS)]);
		await Promise.race([reader, defaultSleep(SOURCE_HALT_MS)]);
	};

	try {
		while (!sourceDone || bufferIndex < buffer.length) {
			if (token?.isCancellationRequested) {
				await stopSource();
				return;
			}

			const remaining = buffer.length - bufferIndex;
			if (remaining === 0) {
				if (sourceDone) {
					break;
				}
				// Park until the reader has data. Never spin on a no-op sleepFn.
				await waitForProgress();
				continue;
			}

			let takeCount = baseCharsPerTick;
			if (sourceDone) {
				takeCount = Math.max(baseCharsPerTick, Math.min(64, Math.ceil(remaining / 8)));
			} else if (remaining > 100) {
				takeCount = Math.min(48, Math.max(baseCharsPerTick, Math.floor(remaining / 15)));
			}
			if (remaining > 10_000) {
				takeCount = Math.min(remaining, Math.max(takeCount, 96));
			}

			takeCount = Math.min(takeCount, remaining);

			const targetEndIndex = bufferIndex + takeCount;
			if (targetEndIndex < buffer.length) {
				const lastCharCode = buffer.charCodeAt(targetEndIndex - 1);
				if (isHighSurrogate(lastCharCode)) {
					takeCount++;
				}
			}

			const take = buffer.slice(bufferIndex, bufferIndex + takeCount);
			bufferIndex += takeCount;
			yield take;

			if (bufferIndex < buffer.length || !sourceDone) {
				await paceWait();
			}
		}
	} finally {
		cancelSub?.dispose();
		await stopSource();
	}

	if (sourceError) {
		throw sourceError;
	}
}

export interface LivePacedSink {
	push(text: string): void;
	discard(): void;
	close(): Promise<void>;
}

/**
 * Bounded live sink: provider chunks enqueue here while paceTextStream drains to UI.
 * discard() drops unread backlog (tool-call turns must not become visible text).
 */
export function createLivePacedSink(
	write: (piece: string) => void,
	options: PaceOptions = {},
): LivePacedSink {
	const chunks: string[] = [];
	let pendingChars = 0;
	let closed = false;
	let discarded = false;
	let waiter: (() => void) | undefined;
	const maxBacklog = Math.max(1024, options.maxBacklogChars ?? DEFAULT_MAX_BACKLOG);

	const isStopped = () => discarded || Boolean(options.token?.isCancellationRequested);

	const wake = () => {
		waiter?.();
		waiter = undefined;
	};

	async function* source(): AsyncGenerator<string, void, unknown> {
		while (!closed || chunks.length > 0) {
			if (isStopped()) {
				return;
			}
			if (chunks.length > 0) {
				const next = chunks.shift()!;
				pendingChars = Math.max(0, pendingChars - next.length);
				yield next;
				continue;
			}
			await new Promise<void>(resolve => {
				if (isStopped() || closed || chunks.length > 0) {
					resolve();
					return;
				}
				waiter = resolve;
			});
		}
	}

	options.token?.onCancellationRequested?.(() => {
		discarded = true;
		closed = true;
		wake();
	});
	if (options.token?.isCancellationRequested) {
		discarded = true;
		closed = true;
	}

	const paced = (async () => {
		for await (const piece of paceTextStream(source(), options)) {
			if (isStopped()) {
				return;
			}
			write(piece);
		}
	})();

	return {
		push(text: string) {
			if (closed || discarded || !text) {
				return;
			}
			chunks.push(text);
			pendingChars += text.length;
			while (pendingChars > maxBacklog && chunks.length > 1) {
				pendingChars -= chunks.shift()!.length;
			}
			if (pendingChars < 0) {
				pendingChars = 0;
			}
			wake();
		},
		discard() {
			discarded = true;
			chunks.length = 0;
			pendingChars = 0;
			closed = true;
			wake();
		},
		async close() {
			closed = true;
			wake();
			await paced;
		},
	};
}

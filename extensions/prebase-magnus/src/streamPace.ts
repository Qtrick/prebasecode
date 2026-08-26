/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Decouple network SSE arrival from UI reveal.
 *
 * Raw Gemini/Copilot streams arrive in bursty chunks; rendering them directly makes
 * replies "pop" all at once. Buffer incoming text and drip characters at a steady,
 * readable pace (~reading speed), matching PreBase V1.1 / common chat UX guidance
 * (~30–60 tokens/sec ≈ 150–200 chars/sec upper bound; we target the comfortable
 * midrange so long answers remain scannable).
 */

export interface PaceOptions {
	/** Characters revealed each tick. Default 3. */
	readonly charsPerTick?: number;
	/** Milliseconds between ticks. Default 22 (~136 chars/sec). */
	readonly intervalMs?: number;
	readonly token?: { readonly isCancellationRequested: boolean };
	/** Optional injected sleep function for deterministic unit testing. */
	readonly sleepFn?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xD800 && code <= 0xDBFF;
}

/**
 * Consume an async text stream, buffer it, and yield paced character batches.
 * Features O(1) buffer streaming, UTF-16 surrogate-pair safety, adaptive catch-up for large backlogs,
 * and instant cancellation.
 */
export async function* paceTextStream(
	source: AsyncIterable<string>,
	options: PaceOptions = {},
): AsyncGenerator<string, void, unknown> {
	const baseCharsPerTick = Math.max(1, options.charsPerTick ?? 3);
	const intervalMs = Math.max(1, options.intervalMs ?? 22);
	const token = options.token;
	const sleep = options.sleepFn ?? defaultSleep;

	// Buffer management using character index cursor to avoid O(N^2) substring slicing
	let buffer = '';
	let bufferIndex = 0;
	let sourceDone = false;
	let sourceError: unknown;

	const reader = (async () => {
		try {
			for await (const chunk of source) {
				if (token?.isCancellationRequested) {
					return;
				}
				if (chunk) {
					// Compact buffer if consumed index passed halfway and buffer is large
					if (bufferIndex > 4096 && bufferIndex > (buffer.length >> 1)) {
						buffer = buffer.slice(bufferIndex);
						bufferIndex = 0;
					}
					buffer += chunk;
				}
			}
		} catch (err) {
			sourceError = err;
		} finally {
			sourceDone = true;
		}
	})();

	try {
		while (!sourceDone || bufferIndex < buffer.length) {
			if (token?.isCancellationRequested) {
				return;
			}

			const remaining = buffer.length - bufferIndex;
			if (remaining === 0) {
				if (sourceDone) {
					break;
				}
				await sleep(intervalMs);
				continue;
			}

			// Adaptive pacing: catch up dynamically if source completed or large backlog accumulated
			let takeCount = baseCharsPerTick;
			if (sourceDone) {
				// Rapidly drain remaining buffer in bounded ticks (~10-15 ticks) once generation finishes
				takeCount = Math.max(baseCharsPerTick, Math.min(64, Math.ceil(remaining / 8)));
			} else if (remaining > 100) {
				// Smooth acceleration for large in-flight backlog
				takeCount = Math.min(48, Math.max(baseCharsPerTick, Math.floor(remaining / 15)));
			}

			takeCount = Math.min(takeCount, remaining);

			// UTF-16 surrogate-pair safety: do not split high surrogate from low surrogate
			const targetEndIndex = bufferIndex + takeCount;
			if (targetEndIndex < buffer.length) {
				const lastCharCode = buffer.charCodeAt(targetEndIndex - 1);
				if (isHighSurrogate(lastCharCode)) {
					// Include matching low surrogate in current tick
					takeCount++;
				}
			}

			const take = buffer.slice(bufferIndex, bufferIndex + takeCount);
			bufferIndex += takeCount;
			yield take;

			if (bufferIndex < buffer.length || !sourceDone) {
				await sleep(intervalMs);
			}
		}
	} finally {
		await reader;
	}

	if (sourceError) {
		throw sourceError;
	}
}

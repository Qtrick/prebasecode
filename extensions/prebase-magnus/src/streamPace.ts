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
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Consume an async text stream, buffer it, and yield paced character batches.
 */
export async function* paceTextStream(
	source: AsyncIterable<string>,
	options: PaceOptions = {},
): AsyncGenerator<string, void, unknown> {
	const charsPerTick = Math.max(1, options.charsPerTick ?? 3);
	const intervalMs = Math.max(8, options.intervalMs ?? 22);
	const token = options.token;

	let buffer = '';
	let sourceDone = false;
	let sourceError: unknown;

	const reader = (async () => {
		try {
			for await (const chunk of source) {
				if (token?.isCancellationRequested) {
					return;
				}
				if (chunk) {
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
		while (!sourceDone || buffer.length > 0) {
			if (token?.isCancellationRequested) {
				return;
			}
			if (!buffer.length) {
				await sleep(intervalMs);
				continue;
			}
			const take = buffer.slice(0, charsPerTick);
			buffer = buffer.slice(charsPerTick);
			yield take;
			await sleep(intervalMs);
		}
	} finally {
		await reader;
	}

	if (sourceError) {
		throw sourceError;
	}
}

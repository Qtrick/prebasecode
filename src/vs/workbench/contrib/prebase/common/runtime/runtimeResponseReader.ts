/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { VSBuffer, type VSBufferReadableStream } from '../../../../../base/common/buffer.js';

export const MAX_RUNTIME_INSPECTION_RESPONSE_BYTES = 512 * 1024;

export interface RuntimeResponseText {
	readonly text: string;
	readonly bytesRead: number;
	readonly tooLarge: boolean;
}

/**
 * Reads a response incrementally so a preview server cannot allocate an
 * unbounded response before Runtime Preview creates its semantic outline.
 */
export function readRuntimeResponseText(
	stream: VSBufferReadableStream,
	maxBytes: number,
	token: CancellationToken,
): Promise<RuntimeResponseText> {
	return new Promise((resolve, reject) => {
		const chunks: VSBuffer[] = [];
		let bytesRead = 0;
		let settled = false;
		const finish = (result?: RuntimeResponseText, error?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			stream.removeListener('data', onData);
			stream.removeListener('error', onError);
			stream.removeListener('end', onEnd);
			cancellation.dispose();
			if (error) {
				reject(error);
			} else {
				resolve(result!);
			}
		};
		const onData = (chunk: VSBuffer) => {
			if (bytesRead + chunk.byteLength > maxBytes) {
				stream.destroy();
				finish({ text: '', bytesRead, tooLarge: true });
				return;
			}
			bytesRead += chunk.byteLength;
			chunks.push(chunk);
		};
		const onError = (error: Error) => finish(undefined, error);
		const onEnd = () => finish({ text: VSBuffer.concat(chunks, bytesRead).toString(), bytesRead, tooLarge: false });
		const cancellation = token.onCancellationRequested(() => {
			stream.destroy();
			finish(undefined, new CancellationError());
		});

		if (token.isCancellationRequested) {
			stream.destroy();
			finish(undefined, new CancellationError());
			return;
		}
		stream.on('error', onError);
		stream.on('end', onEnd);
		stream.on('data', onData);
	});
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const MAX_EXTERNAL_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const MAX_EXTERNAL_SCREENSHOT_BASE64_CHARACTERS = Math.ceil(MAX_EXTERNAL_SCREENSHOT_BYTES / 3) * 4;
// Page.captureScreenshot returns JSON containing the base64 data plus a small envelope.
export const MAX_EXTERNAL_SCREENSHOT_CDP_MESSAGE_BYTES = MAX_EXTERNAL_SCREENSHOT_BASE64_CHARACTERS + 64 * 1024;

export interface CdpDiscoveryTarget {
	readonly type?: string;
	readonly url?: string;
	readonly webSocketDebuggerUrl?: string;
}

function isLoopbackHost(hostname: string): boolean {
	return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
}

/** Selects only a renderer page served by the exact PreBase-owned debugging port. */
export function selectOwnedCdpPageWebSocketUrl(targets: readonly CdpDiscoveryTarget[], debugPort: number): string | undefined {
	for (const target of targets) {
		if (target.type !== 'page' || !target.webSocketDebuggerUrl || target.url?.startsWith('devtools://')) {
			continue;
		}
		try {
			const endpoint = new URL(target.webSocketDebuggerUrl);
			if (endpoint.protocol === 'ws:' && isLoopbackHost(endpoint.hostname) && endpoint.port === String(debugPort)) {
				return target.webSocketDebuggerUrl;
			}
		} catch {
			// Ignore malformed discovery entries and continue looking for the owned page.
		}
	}
	return undefined;
}

function isBase64Character(code: number): boolean {
	return (code >= 0x41 && code <= 0x5A) // A-Z
		|| (code >= 0x61 && code <= 0x7A) // a-z
		|| (code >= 0x30 && code <= 0x39) // 0-9
		|| code === 0x2B // +
		|| code === 0x2F; // /
}

/** Ensures a CDP screenshot is valid base64 and stays within the IPC image bound. */
export function validateCdpPngScreenshotData(data: unknown, maximumBytes = MAX_EXTERNAL_SCREENSHOT_BYTES): string {
	if (typeof data !== 'string' || data.length === 0 || data.length % 4 !== 0) {
		throw new Error('CDP screenshot did not return valid base64 PNG data.');
	}
	if (data.length > Math.ceil(maximumBytes / 3) * 4) {
		throw new Error(`CDP screenshot exceeds the ${maximumBytes / (1024 * 1024)} MiB IPC limit.`);
	}

	const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
	for (let index = 0; index < data.length - padding; index++) {
		if (!isBase64Character(data.charCodeAt(index))) {
			throw new Error('CDP screenshot did not return valid base64 PNG data.');
		}
	}
	for (let index = data.length - padding; index < data.length; index++) {
		if (data.charCodeAt(index) !== 0x3D) { // =
			throw new Error('CDP screenshot did not return valid base64 PNG data.');
		}
	}

	const decodedBytes = (data.length / 4) * 3 - padding;
	if (decodedBytes <= 0 || decodedBytes > maximumBytes) {
		throw new Error(`CDP screenshot exceeds the ${maximumBytes / (1024 * 1024)} MiB IPC limit.`);
	}
	return data;
}

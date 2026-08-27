/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type RuntimeWebviewControlType = 'setUrl' | 'clear' | 'back' | 'forward' | 'reload';

export interface RuntimeWebviewControlMessage {
	readonly channel: string;
	readonly type: RuntimeWebviewControlType;
	readonly url?: string;
	readonly reason?: string;
	readonly navigationId?: number;
}

export function createRuntimeWebviewControlMessage(channel: string, type: RuntimeWebviewControlType, data: Pick<RuntimeWebviewControlMessage, 'url' | 'reason' | 'navigationId'> = {}): RuntimeWebviewControlMessage {
	return { channel, type, ...data };
}

export function isRuntimeWebviewControlMessage(value: unknown, channel: string): value is RuntimeWebviewControlMessage {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as { channel?: unknown; type?: unknown; url?: unknown; reason?: unknown };
	if (candidate.channel !== channel || !['setUrl', 'clear', 'back', 'forward', 'reload'].includes(String(candidate.type))) {
		return false;
	}
	return (candidate.url === undefined || typeof candidate.url === 'string')
		&& (candidate.reason === undefined || typeof candidate.reason === 'string')
		&& (candidate.navigationId === undefined || typeof candidate.navigationId === 'number');
}

export interface RuntimePreviewStatusMessage {
	readonly type?: string;
	readonly url?: string;
	readonly ok?: boolean;
	readonly detail?: string;
	readonly navigationId?: number;
}

/**
 * Webview → host preview status. Iframe `load` is user-visible truth; a successful
 * no-cors probe may connect earlier. Probe failures are ignored because vscode-webview
 * fetches to loopback often fail after the page has already rendered.
 */
export function handleRuntimePreviewStatusMessage(
	message: RuntimePreviewStatusMessage | undefined,
	markLoaded: (url: string, ok: boolean, detail?: string, navigationId?: number) => void,
): void {
	if (!message?.type) {
		return;
	}
	if ((message.type === 'load' || (message.type === 'probe' && message.ok === true)) && message.url) {
		markLoaded(message.url, true, undefined, message.navigationId);
		return;
	}
	if (message.type === 'probe') {
		return;
	}
	if (message.type === 'error' && message.url) {
		markLoaded(message.url, false, message.detail, message.navigationId);
	}
}

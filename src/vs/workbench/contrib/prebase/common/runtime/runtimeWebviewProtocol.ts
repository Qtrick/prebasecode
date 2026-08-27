/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type RuntimePreviewUiStatus = 'starting' | 'connected' | 'disconnected' | 'stopped' | 'error';

export function deriveRuntimePreviewUiStatus(facts: {
	running: boolean;
	serverRunning: boolean;
	httpReachable: boolean;
	frameLoaded: boolean;
	error?: boolean;
}): RuntimePreviewUiStatus {
	if (facts.error) {
		return 'error';
	}
	if (facts.frameLoaded && (facts.running || facts.serverRunning)) {
		return 'connected';
	}
	if (facts.running || facts.serverRunning) {
		return 'starting';
	}
	if (facts.frameLoaded) {
		return 'disconnected';
	}
	return 'stopped';
}

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
	const candidate = value as { channel?: unknown; type?: unknown; url?: unknown; reason?: unknown; navigationId?: unknown };
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
 * Webview → host preview status. Probe and iframe load are separate facts.
 * A successful no-cors probe must not mark the preview Connected; iframe `load`
 * is the user-visible connected signal. Probe failures after a loaded frame are
 * ignored because vscode-webview fetches to loopback often fail after render.
 */
export function handleRuntimePreviewStatusMessage(
	message: RuntimePreviewStatusMessage | undefined,
	markLoaded: (url: string, ok: boolean, detail?: string, navigationId?: number, kind?: 'probe' | 'load' | 'error') => void,
): void {
	if (!message?.type || !message.url) {
		return;
	}
	if (message.type === 'probe') {
		markLoaded(message.url, message.ok === true, message.detail, message.navigationId, 'probe');
		return;
	}
	if (message.type === 'load') {
		markLoaded(message.url, true, undefined, message.navigationId, 'load');
		return;
	}
	if (message.type === 'error') {
		markLoaded(message.url, false, message.detail, message.navigationId, 'error');
	}
}

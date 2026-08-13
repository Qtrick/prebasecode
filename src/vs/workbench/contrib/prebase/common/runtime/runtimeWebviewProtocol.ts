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
}

export function createRuntimeWebviewControlMessage(channel: string, type: RuntimeWebviewControlType, data: Pick<RuntimeWebviewControlMessage, 'url' | 'reason'> = {}): RuntimeWebviewControlMessage {
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
		&& (candidate.reason === undefined || typeof candidate.reason === 'string');
}

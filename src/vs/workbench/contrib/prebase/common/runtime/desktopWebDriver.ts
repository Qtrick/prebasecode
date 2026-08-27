/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';

export interface WebDriverSession {
	sessionId: string;
	baseUrl: string;
}

function assertLoopback(url: string): URL {
	const parsed = new URL(url);
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('Desktop WebDriver endpoints must be http(s) on loopback.');
	}
	const host = parsed.hostname.replace(/^\[|\]$/g, '');
	if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
		throw new Error('Desktop WebDriver endpoints must bind to loopback.');
	}
	return parsed;
}

async function delay(ms: number, token: CancellationToken): Promise<void> {
	if (token.isCancellationRequested) {
		throw new CancellationError();
	}
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			dispose.dispose();
			resolve();
		}, ms);
		const dispose = token.onCancellationRequested(() => {
			clearTimeout(timer);
			reject(new CancellationError());
		});
	});
}

/** W3C WebDriver Status: HTTP success + JSON success body + `ready === true`. */
export function isWebDriverReadyStatus(status: number, body: unknown): boolean {
	if (!Number.isInteger(status) || status < 200 || status >= 300) {
		return false;
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return false;
	}
	const envelope = body as Record<string, unknown>;
	if (typeof envelope.error === 'string') {
		return false;
	}
	if (envelope.value && typeof envelope.value === 'object' && envelope.value !== null && typeof (envelope.value as { error?: unknown }).error === 'string') {
		return false;
	}
	if (envelope.value && typeof envelope.value === 'object' && !Array.isArray(envelope.value)) {
		return (envelope.value as { ready?: unknown }).ready === true;
	}
	return envelope.ready === true;
}

async function requestJson(url: string, init: RequestInit, token: CancellationToken, timeoutMs = 5_000): Promise<{ status: number; body: unknown; json: boolean }> {
	assertLoopback(url);
	if (token.isCancellationRequested) {
		throw new CancellationError();
	}
	const abort = new AbortController();
	const cancel = token.onCancellationRequested(() => abort.abort());
	const timer = setTimeout(() => abort.abort(), Math.max(1, timeoutMs));
	try {
		const response = await fetch(url, { ...init, signal: abort.signal, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
		const text = await response.text();
		if (!text) {
			return { status: response.status, body: undefined, json: false };
		}
		try {
			return { status: response.status, body: JSON.parse(text), json: true };
		} catch {
			return { status: response.status, body: undefined, json: false };
		}
	} finally {
		clearTimeout(timer);
		cancel.dispose();
	}
}

export class DesktopWebDriverClient {
	constructor(private readonly _baseUrl: string) {
		assertLoopback(_baseUrl);
	}

	async waitUntilReady(timeoutMs: number, token: CancellationToken = CancellationToken.None): Promise<void> {
		const started = Date.now();
		let last = '';
		while (Date.now() - started <= timeoutMs) {
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			try {
				const remaining = Math.max(1, timeoutMs - (Date.now() - started));
				const result = await requestJson(`${this._baseUrl.replace(/\/$/, '')}/status`, { method: 'GET' }, token, Math.min(5_000, remaining));
				if (result.json && isWebDriverReadyStatus(result.status, result.body)) {
					return;
				}
				last = result.json ? `HTTP ${result.status} ready=false` : `HTTP ${result.status} invalid JSON`;
			} catch (error) {
				if (token.isCancellationRequested) {
					throw new CancellationError();
				}
				last = error instanceof Error ? error.message : String(error);
			}
			await delay(250, token);
		}
		throw new Error(`Tauri WebDriver did not become ready: ${last}`);
	}

	async newSession(token: CancellationToken = CancellationToken.None): Promise<WebDriverSession> {
		const result = await requestJson(`${this._baseUrl.replace(/\/$/, '')}/session`, {
			method: 'POST',
			body: JSON.stringify({ capabilities: { alwaysMatch: {} } }),
		}, token);
		if (!result.json || result.status >= 400) {
			throw new Error(`Tauri WebDriver did not create a session (HTTP ${result.status}).`);
		}
		const body = result.body as { value?: { sessionId?: string } | string; sessionId?: string };
		const sessionId = typeof body?.value === 'object' ? body.value?.sessionId : (body?.sessionId ?? (typeof body?.value === 'string' ? body.value : undefined));
		if (!sessionId) {
			throw new Error('Tauri WebDriver did not return a session id.');
		}
		return { sessionId, baseUrl: this._baseUrl.replace(/\/$/, '') };
	}

	async execute(session: WebDriverSession, script: string, token: CancellationToken = CancellationToken.None): Promise<unknown> {
		const result = await requestJson(`${session.baseUrl}/session/${encodeURIComponent(session.sessionId)}/execute/sync`, {
			method: 'POST',
			body: JSON.stringify({ script, args: [] }),
		}, token);
		const body = result.body as { value?: unknown };
		if (!result.json || result.status >= 400) {
			throw new Error(`WebDriver execute failed (${result.status}).`);
		}
		return body?.value;
	}

	async screenshot(session: WebDriverSession, token: CancellationToken = CancellationToken.None): Promise<string> {
		const result = await requestJson(`${session.baseUrl}/session/${encodeURIComponent(session.sessionId)}/screenshot`, { method: 'GET' }, token);
		const body = result.body as { value?: string };
		if (typeof body?.value !== 'string' || body.value.length < 8) {
			throw new Error('WebDriver screenshot did not return PNG data.');
		}
		return body.value;
	}

	async deleteSession(session: WebDriverSession, token: CancellationToken = CancellationToken.None): Promise<void> {
		await requestJson(`${session.baseUrl}/session/${encodeURIComponent(session.sessionId)}`, { method: 'DELETE' }, token, 1_500);
	}

	async performActions(session: WebDriverSession, actions: unknown, token: CancellationToken = CancellationToken.None): Promise<void> {
		const result = await requestJson(`${session.baseUrl}/session/${encodeURIComponent(session.sessionId)}/actions`, {
			method: 'POST',
			body: JSON.stringify({ actions }),
		}, token);
		if (!result.json || result.status >= 400) {
			throw new Error(`WebDriver actions failed (HTTP ${result.status}).`);
		}
	}
}

export function webDriverBaseUrl(port: number): string {
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error('Invalid WebDriver port.');
	}
	return `http://127.0.0.1:${port}`;
}

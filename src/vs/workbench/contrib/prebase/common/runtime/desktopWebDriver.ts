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

async function requestJson(url: string, init: RequestInit, token: CancellationToken): Promise<{ status: number; body: unknown }> {
	assertLoopback(url);
	if (token.isCancellationRequested) {
		throw new CancellationError();
	}
	const abort = new AbortController();
	const cancel = token.onCancellationRequested(() => abort.abort());
	const timer = setTimeout(() => abort.abort(), 5_000);
	try {
		const response = await fetch(url, { ...init, signal: abort.signal, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
		const text = await response.text();
		let body: unknown = undefined;
		if (text) {
			try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
		}
		return { status: response.status, body };
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
				const result = await requestJson(`${this._baseUrl.replace(/\/$/, '')}/status`, { method: 'GET' }, token);
				if (result.status > 0 && result.status < 500) {
					return;
				}
				last = `HTTP ${result.status}`;
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
		if (result.status >= 400) {
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
		if (result.status >= 400) {
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
		await requestJson(`${session.baseUrl}/session/${encodeURIComponent(session.sessionId)}`, { method: 'DELETE' }, token);
	}
}

export function webDriverBaseUrl(port: number): string {
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error('Invalid WebDriver port.');
	}
	return `http://127.0.0.1:${port}`;
}

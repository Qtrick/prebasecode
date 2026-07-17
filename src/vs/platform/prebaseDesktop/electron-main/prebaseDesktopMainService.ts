/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, WebContentsView } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import * as http from 'http';
import * as net from 'net';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import type { DesktopLaunchRequest, ManagedWindowState } from '../common/prebaseDesktopTypes.js';
import { IPreBaseDesktopMainService, type IPreBaseDesktopSpawnResult } from '../common/prebaseDesktop.js';

const STRIP_HEIGHT = 38;

interface ManagedSession {
	window: BrowserWindow;
	stripView: WebContentsView;
	appView: WebContentsView;
	request: DesktopLaunchRequest;
}

function stripHtml(title: string): string {
	const safeTitle = title.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\'': '&#39;' }[ch] ?? ch));
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;font:12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;gap:8px;padding:0 10px;height:${STRIP_HEIGHT}px;box-sizing:border-box;border-bottom:1px solid #334155;}
.label{flex:1;opacity:.92;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
button{background:#155e75;color:#ecfeff;border:1px solid #334155;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;}
button:hover{background:#0e7490;}
</style></head><body>
<span class="label">Opened through PreBase · ${safeTitle}</span>
<button onclick="location.href='prebase-strip://reload'">Reload</button>
<button onclick="location.href='prebase-strip://restart'">Restart</button>
<button onclick="location.href='prebase-strip://inspect'">Inspect</button>
<button onclick="location.href='prebase-strip://kill'">Kill</button>
</body></html>`;
}

export class PreBaseDesktopMainService extends Disposable implements IPreBaseDesktopMainService {
	declare readonly _serviceBrand: undefined;

	private readonly _managed = new Map<string, ManagedSession>();
	private readonly _ownedPids = new Set<number>();
	private readonly _ownedDebugPorts = new Set<number>();
	private readonly _externalChildren = new Map<number, ChildProcess>();

	private readonly _onDidCloseManagedWindow = this._register(new Emitter<{ sessionId: string }>());
	readonly onDidCloseManagedWindow = this._onDidCloseManagedWindow.event;

	private readonly _onDidStripAction = this._register(new Emitter<{ sessionId: string; action: 'reload' | 'restart' | 'inspect' | 'kill' }>());
	readonly onDidStripAction = this._onDidStripAction.event;

	override dispose(): void {
		for (const session of this._managed.values()) {
			this._destroyManagedSession(session, false);
		}
		this._managed.clear();
		for (const child of this._externalChildren.values()) {
			try {
				child.kill('SIGTERM');
			} catch {
				// ignore
			}
		}
		this._externalChildren.clear();
		this._ownedPids.clear();
		this._ownedDebugPorts.clear();
		super.dispose();
	}

	async openManagedWindow(request: DesktopLaunchRequest): Promise<ManagedWindowState> {
		await this.closeManagedWindow(request.sessionId);
		this._assertManagedRendererUrl(request.rendererUrl);

		const stripView = new WebContentsView({
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
			}
		});
		const appView = new WebContentsView({
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
			}
		});

		const window = new BrowserWindow({
			width: 1280,
			height: 840,
			show: true,
			frame: true,
			title: request.title,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
			}
		});

		// App content first; management strip last so it stays above the renderer in z-order.
		window.contentView.addChildView(appView);
		window.contentView.addChildView(stripView);

		const layout = () => {
			const { width, height } = window.getContentBounds();
			const showBar = request.showManagementBar;
			const barHeight = showBar ? STRIP_HEIGHT : 0;
			stripView.setBounds({ x: 0, y: 0, width, height: barHeight });
			appView.setBounds({ x: 0, y: barHeight, width, height: Math.max(0, height - barHeight) });
		};
		window.on('resize', layout);
		layout();

		const session: ManagedSession = { window, stripView, appView, request };
		this._managed.set(request.sessionId, session);

		if (request.showManagementBar) {
			stripView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(stripHtml(request.title))}`);
			stripView.webContents.on('will-navigate', (event, url) => {
				if (!url.startsWith('prebase-strip://')) {
					return;
				}
				event.preventDefault();
				const actionPath = url.slice('prebase-strip://'.length);
				if (actionPath !== 'reload' && actionPath !== 'restart' && actionPath !== 'inspect' && actionPath !== 'kill') {
					return;
				}
				const action = actionPath;
				this._onDidStripAction.fire({ sessionId: request.sessionId, action });
			});
		} else {
			stripView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
		}

		const loadingHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0b1220;color:#e2e8f0;font:14px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
.card{max-width:420px;padding:24px}
h1{font-size:18px;margin:0 0 8px}
p{opacity:.75;margin:0;line-height:1.45}
</style></head><body><div class="card"><h1>Starting application…</h1><p>${request.title.replace(/[<>&]/g, '')}</p><p>Waiting for renderer…</p></div></body></html>`;
		await appView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`);
		try {
			await appView.webContents.loadURL(request.rendererUrl);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const errorHtml = `<!DOCTYPE html><html><body style="font:14px sans-serif;background:#111;color:#fecaca;padding:24px">
<h1>Failed to start application</h1><p>${message.replace(/[<>&]/g, '')}</p>
<p>URL: ${request.rendererUrl.replace(/[<>&]/g, '')}</p></body></html>`;
			await appView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
			throw err;
		}

		window.on('closed', () => {
			if (this._managed.get(request.sessionId) === session) {
				this._managed.delete(request.sessionId);
				this._onDidCloseManagedWindow.fire({ sessionId: request.sessionId });
			}
		});

		return {
			sessionId: request.sessionId,
			windowId: window.id,
			rendererUrl: request.rendererUrl,
			title: request.title,
		};
	}

	async closeManagedWindow(sessionId: string): Promise<void> {
		const session = this._managed.get(sessionId);
		if (!session) {
			return;
		}
		this._destroyManagedSession(session, true);
		this._managed.delete(sessionId);
	}

	async reloadManagedWindow(sessionId: string): Promise<void> {
		const session = this._managed.get(sessionId);
		if (!session) {
			return;
		}
		await session.appView.webContents.reload();
	}

	async restartManagedWindow(sessionId: string, request: DesktopLaunchRequest): Promise<ManagedWindowState> {
		await this.closeManagedWindow(sessionId);
		return this.openManagedWindow(request);
	}

	async inspectManagedWindow(sessionId: string): Promise<void> {
		const session = this._managed.get(sessionId);
		if (!session) {
			return;
		}
		session.appView.webContents.openDevTools({ mode: 'detach' });
	}

	async evaluateInManagedWindow(sessionId: string, expression: string): Promise<unknown> {
		const session = this._managed.get(sessionId);
		if (!session) {
			throw new Error('Managed desktop session not found.');
		}
		const value = await session.appView.webContents.executeJavaScript(expression, true);
		return this._marshalForIpc(value);
	}

	async captureManagedScreenshot(sessionId: string): Promise<string> {
		const session = this._managed.get(sessionId);
		if (!session) {
			throw new Error('Managed desktop session not found.');
		}
		const image = await session.appView.webContents.capturePage();
		return image.toPNG().toString('base64');
	}

	async evaluateViaCdp(debugPort: number, expression: string): Promise<unknown> {
		if (!Number.isInteger(debugPort) || debugPort <= 0 || debugPort > 65535) {
			throw new Error('Invalid debug port.');
		}
		if (!this._ownedDebugPorts.has(debugPort)) {
			throw new Error('CDP evaluate is limited to PreBase-owned localhost debugging ports.');
		}
		const targets = await this._fetchJson<Array<{ type?: string; webSocketDebuggerUrl?: string }>>(`http://127.0.0.1:${debugPort}/json`);
		const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl) ?? targets.find(t => t.webSocketDebuggerUrl);
		if (!page?.webSocketDebuggerUrl) {
			throw new Error('No CDP page target is available for this owned session.');
		}
		const value = await this._cdpEvaluate(page.webSocketDebuggerUrl, expression);
		return this._marshalForIpc(value);
	}

	async spawnExternal(command: string, cwd: string, debugPort: number, env: Record<string, string> = {}): Promise<IPreBaseDesktopSpawnResult> {
		const port = debugPort > 0 ? debugPort : await this._allocateDebugPort();
		// Electron reads --remote-debugging-port from argv. npm scripts need `--` separator.
		// ELECTRON_EXTRA_LAUNCH_ARGS is honored by many Electron templates as a secondary path.
		const hasDebugFlag = /--remote-debugging-port\s*=?\s*\d+/.test(command);
		const launchCommand = hasDebugFlag
			? command
			: /(?:^|\s)--(?:\s|$)/.test(command)
				? `${command} --remote-debugging-port=${port}`
				: `${command} -- --remote-debugging-port=${port}`;
		const priorExtra = process.env.ELECTRON_EXTRA_LAUNCH_ARGS ?? '';
		const child = spawn(launchCommand, {
			cwd,
			shell: true,
			env: {
				...process.env,
				...env,
				ELECTRON_EXTRA_LAUNCH_ARGS: `${priorExtra} --remote-debugging-port=${port}`.trim(),
			},
			detached: false,
			stdio: 'ignore',
		});
		if (!child.pid) {
			throw new Error('Failed to spawn external Electron process.');
		}
		this._ownedPids.add(child.pid);
		this._ownedDebugPorts.add(port);
		this._externalChildren.set(child.pid, child);
		child.on('exit', () => {
			if (child.pid) {
				this._ownedPids.delete(child.pid);
				this._externalChildren.delete(child.pid);
			}
			this._ownedDebugPorts.delete(port);
		});
		return { pid: child.pid, debugPort: port };
	}

	async killOwnedProcess(pid: number): Promise<void> {
		if (!this._ownedPids.has(pid)) {
			return;
		}
		const child = this._externalChildren.get(pid);
		if (child) {
			try {
				child.kill('SIGTERM');
			} catch {
				// ignore
			}
		}
		this._ownedPids.delete(pid);
		this._externalChildren.delete(pid);
	}

	async killAllOwned(): Promise<void> {
		const pids = [...this._ownedPids];
		await Promise.all(pids.map(pid => this.killOwnedProcess(pid)));
	}

	private _allocateDebugPort(): Promise<number> {
		return new Promise((resolve, reject) => {
			const server = net.createServer();
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => {
				const address = server.address();
				const port = typeof address === 'object' && address ? address.port : 0;
				server.close(closeError => {
					if (closeError) {
						reject(closeError);
						return;
					}
					if (!port) {
						reject(new Error('Failed to allocate localhost debug port.'));
						return;
					}
					resolve(port);
				});
			});
		});
	}

	private _isLocalhostUrl(url: string): boolean {
		try {
			const parsed = new URL(url);
			return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1';
		} catch {
			return false;
		}
	}

	private _isLocalCdpWebSocketUrl(url: string): boolean {
		try {
			const parsed = new URL(url);
			return parsed.protocol === 'ws:' && this._isLocalhostUrl(url);
		} catch {
			return false;
		}
	}

	private _assertManagedRendererUrl(rendererUrl: string): void {
		if (rendererUrl.startsWith('data:')) {
			return;
		}
		try {
			const parsed = new URL(rendererUrl);
			if (parsed.protocol === 'file:') {
				return;
			}
			if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && this._isLocalhostUrl(rendererUrl)) {
				return;
			}
		} catch {
			// fall through
		}
		throw new Error('Managed desktop windows may only load local renderer URLs.');
	}

	private _marshalForIpc(value: unknown): unknown {
		if (value === undefined) {
			return undefined;
		}
		try {
			return JSON.parse(JSON.stringify(value));
		} catch {
			return String(value);
		}
	}

	private _fetchJson<T>(url: string): Promise<T> {
		if (!this._isLocalhostUrl(url)) {
			return Promise.reject(new Error('CDP discovery is limited to localhost.'));
		}
		return new Promise((resolve, reject) => {
			const req = http.get(url, res => {
				const chunks: Buffer[] = [];
				res.on('data', (c: Buffer) => chunks.push(c));
				res.on('end', () => {
					try {
						resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
					} catch (err) {
						reject(err);
					}
				});
			});
			req.on('error', reject);
			req.setTimeout(2500, () => {
				req.destroy(new Error('CDP target discovery timed out'));
			});
		});
	}

	private async _cdpEvaluate(wsUrl: string, expression: string): Promise<unknown> {
		if (!this._isLocalCdpWebSocketUrl(wsUrl)) {
			throw new Error('CDP websocket must target localhost.');
		}
		const wsModule = await import('ws') as { default?: new (url: string) => MinimalWs; WebSocket?: new (url: string) => MinimalWs };
		type MinimalWs = {
			on(event: string, listener: (...args: any[]) => void): void;
			send(data: string): void;
			close(): void;
		};
		const WebSocketCtor = wsModule.default ?? wsModule.WebSocket;
		if (!WebSocketCtor) {
			throw new Error('WebSocket implementation unavailable for CDP.');
		}
		return new Promise((resolve, reject) => {
			const ws = new WebSocketCtor(wsUrl);
			let id = 1;
			const timer = setTimeout(() => {
				ws.close();
				reject(new Error('CDP evaluate timed out'));
			}, 8000);
			ws.on('open', () => {
				ws.send(JSON.stringify({ id: id++, method: 'Runtime.enable' }));
				ws.send(JSON.stringify({
					id: id++,
					method: 'Runtime.evaluate',
					params: { expression, returnByValue: true, awaitPromise: true },
				}));
			});
			ws.on('message', (raw: unknown) => {
				try {
					const msg = JSON.parse(String(raw)) as { id?: number; result?: { result?: { value?: unknown }; exceptionDetails?: unknown }; error?: { message?: string } };
					if (msg.error) {
						clearTimeout(timer);
						ws.close();
						reject(new Error(msg.error.message || 'CDP error'));
						return;
					}
					if (msg.id && msg.result) {
						clearTimeout(timer);
						ws.close();
						if (msg.result.exceptionDetails) {
							reject(new Error('CDP expression threw'));
							return;
						}
						resolve(msg.result.result?.value);
					}
				} catch (err) {
					clearTimeout(timer);
					ws.close();
					reject(err);
				}
			});
			ws.on('error', (err: Error) => {
				clearTimeout(timer);
				reject(err);
			});
		});
	}

	private _destroyManagedSession(session: ManagedSession, closeWindow: boolean): void {
		try {
			session.window.contentView.removeChildView(session.stripView);
			session.window.contentView.removeChildView(session.appView);
			session.stripView.webContents.close();
			session.appView.webContents.close();
		} catch {
			// ignore
		}
		if (closeWindow && !session.window.isDestroyed()) {
			session.window.close();
		}
	}
}

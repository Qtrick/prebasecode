/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, WebContentsView } from 'electron';
import { execFile, spawn, type ChildProcess } from 'child_process';
import * as net from 'net';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import type { DesktopLaunchRequest, ExternalLaunchRequest, ManagedWindowState } from '../common/prebaseDesktopTypes.js';
import { IPreBaseDesktopMainService, type IPreBaseDesktopSpawnResult } from '../common/prebaseDesktop.js';
import { CdpConnection, type MinimalWebSocket } from '../common/cdpConnection.js';
import { MAX_EXTERNAL_SCREENSHOT_CDP_MESSAGE_BYTES, selectOwnedCdpPageWebSocketUrl, validateCdpPngScreenshotData, type CdpDiscoveryTarget } from '../common/cdpScreenshot.js';
import { existsSync } from 'fs';
import { resolveExternalLaunchCommand } from '../common/externalLaunchResolver.js';
import { ProcessOutputBuffer } from '../common/processOutputBuffer.js';
import { terminateOwnedProcess, resolveDesktopShutdownPolicy, POSIX_OWNED_PROCESS_TERMINATION_BUDGET_MS, type ProcessTerminationSignal } from '../common/processTermination.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';

/** Windows taskkill itself can hang; bound the helper process, then wait for the child. */
const WINDOWS_TASKKILL_EXEC_TIMEOUT_MS = 4_000;
const WINDOWS_TASKKILL_EXIT_WAIT_MS = 3_000;
/** Ceiling for the memoized owned-process shutdown joiner (POSIX 6s or Windows ~7s). */
const OWNED_PROCESS_SHUTDOWN_CEILING_MS = Math.max(POSIX_OWNED_PROCESS_TERMINATION_BUDGET_MS, WINDOWS_TASKKILL_EXEC_TIMEOUT_MS + WINDOWS_TASKKILL_EXIT_WAIT_MS) + 500;

const STRIP_HEIGHT = 38;
const MAX_CDP_DISCOVERY_BYTES = 1 * 1024 * 1024;
const MAX_MANAGED_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const MAX_DESKTOP_EVALUATION_EXPRESSION_BYTES = 64 * 1024;
const MAX_DESKTOP_EVALUATION_RESULT_BYTES = 1 * 1024 * 1024;
const MAX_RETAINED_EXTERNAL_OUTPUTS = 32;

interface ManagedSession {
	window: BrowserWindow;
	stripView: WebContentsView;
	appView: WebContentsView;
	request: DesktopLaunchRequest;
	purpose: 'preview' | 'test';
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
	private readonly _ownedPurpose = new Map<number, 'preview' | 'test'>();
	private readonly _ownedPortsByPid = new Map<number, number>();
	private readonly _externalChildren = new Map<number, ChildProcess>();
	private readonly _externalOutput = new Map<number, ProcessOutputBuffer>();
	private _shutdownPromise: Promise<void> | undefined;

	private readonly _onDidCloseManagedWindow = this._register(new Emitter<{ sessionId: string }>());
	readonly onDidCloseManagedWindow = this._onDidCloseManagedWindow.event;

	private readonly _onDidStripAction = this._register(new Emitter<{ sessionId: string; action: 'reload' | 'restart' | 'inspect' | 'kill' }>());
	readonly onDidStripAction = this._onDidStripAction.event;

	constructor(
		@ILifecycleMainService lifecycleMainService?: ILifecycleMainService,
		@ILogService private readonly _logService?: ILogService,
		@IConfigurationService private readonly _configurationService?: IConfigurationService,
	) {
		super();
		if (lifecycleMainService) {
			this._register(lifecycleMainService.onWillShutdown(event => {
				event.join('PreBaseDesktopMainService', this._onWillShutdown());
			}));
		}
	}

	private async _onWillShutdown(): Promise<void> {
		if (!this._shutdownPromise) {
			this._shutdownPromise = this._shutdownOnce();
		}
		return this._shutdownPromise;
	}

	private async _shutdownOnce(): Promise<void> {
		this._logService?.trace('[PreBase Desktop] onWillShutdown joiner active; applying managed/external process policy');
		const stopManaged = this._configurationService?.getValue<boolean>('prebase.runtime.stopManagedAppsOnExit') ?? true;
		const stopExternal = this._configurationService?.getValue<boolean>('prebase.runtime.stopExternalAppsOnExit') ?? false;
		const policy = resolveDesktopShutdownPolicy(stopManaged, stopExternal);

		for (const [sessionId, session] of [...this._managed]) {
			if (policy.closeManagedWindows || session.purpose === 'test') {
				this._destroyManagedSession(session, true);
				this._managed.delete(sessionId);
			}
		}

		const previewPids = [...this._ownedPids].filter(pid => (this._ownedPurpose.get(pid) ?? 'preview') === 'preview');
		const testPids = [...this._ownedPids].filter(pid => this._ownedPurpose.get(pid) === 'test');
		const killPids = new Set(testPids);
		if (policy.terminateOwnedChildren) {
			for (const pid of previewPids) {
				killPids.add(pid);
			}
		} else {
			for (const pid of previewPids) {
				const child = this._externalChildren.get(pid);
				if (child) {
					try { child.unref(); } catch { /* ignore */ }
				}
				const port = this._ownedPortsByPid.get(pid);
				if (port) {
					this._ownedDebugPorts.delete(port);
				}
				this._ownedPids.delete(pid);
				this._externalChildren.delete(pid);
				this._externalOutput.delete(pid);
				this._ownedPurpose.delete(pid);
				this._ownedPortsByPid.delete(pid);
			}
		}
		if (killPids.size) {
			await this._killListedOwnedProcesses([...killPids]);
		}
	}

	private async _killListedOwnedProcesses(pids: number[]): Promise<void> {
		if (pids.length === 0) {
			return;
		}
		const kills = pids.map(async pid => {
			try {
				const stopped = await this._killProcessTree(pid);
				if (stopped) {
					this._externalChildren.delete(pid);
					this._externalOutput.delete(pid);
					this._ownedPids.delete(pid);
					this._ownedPurpose.delete(pid);
					this._ownedPortsByPid.delete(pid);
				} else {
					this._logService?.warn(`[PreBase Desktop] Owned process ${pid} did not confirm exit within the ${OWNED_PROCESS_SHUTDOWN_CEILING_MS}ms budget`);
				}
			} catch (err) {
				this._logService?.warn(`[PreBase Desktop] Failed to terminate owned process ${pid}:`, err);
			}
		});
		await Promise.all(kills);
	}

	override dispose(): void {
		void this._onWillShutdown();
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

		const session: ManagedSession = { window, stripView, appView, request, purpose: request.purpose ?? 'preview' };
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

		appView.webContents.on('unresponsive', () => {
			this._logService?.warn(`[PreBase Desktop] Managed window session '${request.sessionId}' became unresponsive.`);
		});
		appView.webContents.on('responsive', () => {
			this._logService?.trace(`[PreBase Desktop] Managed window session '${request.sessionId}' regained responsiveness.`);
		});
		appView.webContents.on('render-process-gone', (_event, details) => {
			this._logService?.error(`[PreBase Desktop] Managed window session '${request.sessionId}' render process gone: ${details.reason} (exitCode: ${details.exitCode})`);
		});

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
		this._assertEvaluationExpression(expression);
		const value = await session.appView.webContents.executeJavaScript(expression, true);
		return this._marshalForIpc(value);
	}

	async captureManagedScreenshot(sessionId: string): Promise<string> {
		const session = this._managed.get(sessionId);
		if (!session) {
			throw new Error('Managed desktop session not found.');
		}
		const image = await session.appView.webContents.capturePage();
		const png = image.toPNG();
		if (png.byteLength > MAX_MANAGED_SCREENSHOT_BYTES) {
			throw new Error('Managed screenshot exceeds the 10 MiB IPC limit.');
		}
		return png.toString('base64');
	}

	async evaluateViaCdp(debugPort: number, expression: string): Promise<unknown> {
		this._assertEvaluationExpression(expression);
		const value = await this._cdpEvaluate(await this._getOwnedCdpPageWebSocketUrl(debugPort), expression);
		return this._marshalForIpc(value);
	}

	async captureScreenshotViaCdp(debugPort: number): Promise<string> {
		const pngBase64 = await this._cdpCaptureScreenshot(await this._getOwnedCdpPageWebSocketUrl(debugPort));
		const png = Buffer.from(pngBase64, 'base64');
		if (png.byteLength < 8 || !png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
			throw new Error('CDP screenshot did not return PNG data.');
		}
		return pngBase64;
	}

	async dispatchOwnedPointer(target: { sessionId?: string; debugPort?: number }, x: number, y: number, clickCount = 1): Promise<void> {
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			throw new Error('Owned pointer input requires finite coordinates.');
		}
		const count = clickCount <= 1 ? 1 : 2;
		const managed = target.sessionId ? this._managed.get(target.sessionId) : undefined;
		if (managed) {
			for (let i = 0; i < count; i++) {
				managed.appView.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: i + 1 });
				managed.appView.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: i + 1 });
			}
			return;
		}
		if (!target.debugPort) {
			throw new Error('Owned pointer input requires a managed session or CDP port.');
		}
		await this._withCdpConnection(await this._getOwnedCdpPageWebSocketUrl(target.debugPort), 'pointer', 64 * 1024, async connection => {
			for (let i = 0; i < count; i++) {
				const params = { x, y, button: 'left', clickCount: i + 1, pointerType: 'mouse' };
				await connection.request('Input.dispatchMouseEvent', { ...params, type: 'mousePressed' });
				await connection.request('Input.dispatchMouseEvent', { ...params, type: 'mouseReleased' });
			}
		});
	}

	async dispatchOwnedKey(target: { sessionId?: string; debugPort?: number }, key: string, modifiers: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}): Promise<void> {
		if (typeof key !== 'string' || !key || key.includes('\0') || key.length > 40) {
			throw new Error('Owned key input is limited to a short named key or single character.');
		}
		const electronModifiers = [
			modifiers.ctrl ? 'control' : undefined,
			modifiers.meta ? 'meta' : undefined,
			modifiers.alt ? 'alt' : undefined,
			modifiers.shift ? 'shift' : undefined,
		].filter((value): value is string => Boolean(value));
		const electronKey = key === ' ' || key === 'Space' ? 'Space' : key;
		const managed = target.sessionId ? this._managed.get(target.sessionId) : undefined;
		if (managed) {
			managed.appView.webContents.sendInputEvent({ type: 'keyDown', keyCode: electronKey, modifiers: electronModifiers });
			managed.appView.webContents.sendInputEvent({ type: 'keyUp', keyCode: electronKey, modifiers: electronModifiers });
			return;
		}
		if (!target.debugPort) {
			throw new Error('Owned key input requires a managed session or CDP port.');
		}
		const bits = (modifiers.alt ? 1 : 0) + (modifiers.ctrl ? 2 : 0) + (modifiers.meta ? 4 : 0) + (modifiers.shift ? 8 : 0);
		const named: Record<string, { code: string; vk: number }> = {
			Enter: { code: 'Enter', vk: 13 }, Tab: { code: 'Tab', vk: 9 }, Escape: { code: 'Escape', vk: 27 },
			Backspace: { code: 'Backspace', vk: 8 }, Delete: { code: 'Delete', vk: 46 }, Space: { code: 'Space', vk: 32 },
			Home: { code: 'Home', vk: 36 }, End: { code: 'End', vk: 35 }, ArrowLeft: { code: 'ArrowLeft', vk: 37 },
			ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowRight: { code: 'ArrowRight', vk: 39 }, ArrowDown: { code: 'ArrowDown', vk: 40 },
			PageUp: { code: 'PageUp', vk: 33 }, PageDown: { code: 'PageDown', vk: 34 },
		};
		const info = named[key === ' ' ? 'Space' : key];
		const isChar = key.length === 1;
		const insertText = isChar ? key : (key === 'Enter' ? '\r' : (key === 'Space' || key === ' ' ? ' ' : ''));
		const params = {
			key: key === 'Space' || key === ' ' ? ' ' : key,
			code: info?.code ?? (isChar ? `Key${key.toUpperCase()}` : key),
			windowsVirtualKeyCode: info?.vk ?? (isChar ? key.toUpperCase().charCodeAt(0) : 0),
			nativeVirtualKeyCode: info?.vk ?? (isChar ? key.toUpperCase().charCodeAt(0) : 0),
			modifiers: bits,
		};
		await this._withCdpConnection(await this._getOwnedCdpPageWebSocketUrl(target.debugPort), 'key', 64 * 1024, async connection => {
			await connection.request('Input.dispatchKeyEvent', { ...params, type: info ? 'rawKeyDown' : 'keyDown', text: insertText });
			if (isChar || key === 'Space' || key === ' ') {
				await connection.request('Input.dispatchKeyEvent', { ...params, type: 'char', text: isChar ? key : ' ' });
			}
			await connection.request('Input.dispatchKeyEvent', { ...params, type: 'keyUp', text: '' });
		});
	}

	async dispatchOwnedInsertText(target: { sessionId?: string; debugPort?: number }, text: string): Promise<void> {
		if (typeof text !== 'string' || text.includes('\0')) {
			throw new Error('Owned text input must be a string without NUL bytes.');
		}
		if (Buffer.byteLength(text, 'utf8') > MAX_DESKTOP_EVALUATION_EXPRESSION_BYTES) {
			throw new Error(`Owned text input exceeds the ${MAX_DESKTOP_EVALUATION_EXPRESSION_BYTES / 1024} KiB limit.`);
		}
		const managed = target.sessionId ? this._managed.get(target.sessionId) : undefined;
		if (managed) {
			for (const character of text) {
				managed.appView.webContents.sendInputEvent({ type: 'char', keyCode: character });
			}
			return;
		}
		if (!target.debugPort) {
			throw new Error('Owned text input requires a managed session or CDP port.');
		}
		await this._withCdpConnection(await this._getOwnedCdpPageWebSocketUrl(target.debugPort), 'insertText', 64 * 1024, async connection => {
			await connection.request('Input.insertText', { text });
		});
	}

	async spawnExternal(request: ExternalLaunchRequest, cwd: string, debugPort: number, env: Record<string, string> = {}, extras?: { purpose?: 'preview' | 'test'; electronCdp?: boolean; webDriver?: boolean }): Promise<IPreBaseDesktopSpawnResult> {
		const electronCdp = extras?.electronCdp ?? true;
		const webDriver = extras?.webDriver === true && !electronCdp;
		const purpose = extras?.purpose ?? 'preview';
		if (!request.command.trim() || request.command.includes('\0') || request.args.some(arg => arg.includes('\0'))) {
			throw new Error('Invalid external launch command.');
		}
		const args = [...request.args];
		const childEnv: Record<string, string> = { ...process.env as Record<string, string>, ...env };
		delete childEnv.TAURI_WEBDRIVER_PORT;
		const needsPort = electronCdp || webDriver;
		const port = needsPort ? (debugPort > 0 ? debugPort : await this._allocateDebugPort()) : 0;
		if (electronCdp) {
			if (!args.some(arg => /^--remote-debugging-port(?:=|$)/.test(arg))) {
				args.push(`--remote-debugging-port=${port}`);
			}
			if (!args.some(arg => /^--remote-debugging-address(?:=|$)/.test(arg))) {
				args.push('--remote-debugging-address=127.0.0.1');
			}
			const priorExtra = process.env.ELECTRON_EXTRA_LAUNCH_ARGS ?? '';
			childEnv.ELECTRON_EXTRA_LAUNCH_ARGS = `${priorExtra} --remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`.trim();
		} else if (webDriver) {
			childEnv.TAURI_WEBDRIVER_PORT = String(port);
		}
		const command = resolveExternalLaunchCommand(request, cwd, process.platform, existsSync);
		const child = spawn(command, args, {
			cwd,
			env: childEnv,
			detached: process.platform !== 'win32',
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		if (!child.pid) {
			throw new Error('Failed to spawn owned desktop process.');
		}
		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => {
				child.removeListener('spawn', onSpawn);
				reject(error);
			};
			const onSpawn = () => {
				child.removeListener('error', onError);
				resolve();
			};
			child.once('error', onError);
			child.once('spawn', onSpawn);
		});
		const output = new ProcessOutputBuffer();
		child.stdout?.on('data', chunk => output.append('stdout', chunk));
		child.stderr?.on('data', chunk => output.append('stderr', chunk));
		this._ownedPids.add(child.pid);
		this._ownedPurpose.set(child.pid, purpose);
		if (electronCdp) {
			this._ownedDebugPorts.add(port);
			this._ownedPortsByPid.set(child.pid, port);
		}
		this._externalChildren.set(child.pid, child);
		child.on('exit', () => {
			if (child.pid) {
				this._ownedPids.delete(child.pid);
				this._externalChildren.delete(child.pid);
				this._ownedPurpose.delete(child.pid);
				this._ownedPortsByPid.delete(child.pid);
			}
			if (port) {
				this._ownedDebugPorts.delete(port);
			}
		});
		child.once('close', () => output.flush());
		this._rememberProcessOutput(child.pid, output);
		return {
			pid: child.pid,
			debugPort: electronCdp ? port : undefined,
			webDriverPort: webDriver ? port : undefined,
		};
	}

	async getOwnedProcessOutput(pid: number, maximumEntries = 100): Promise<{ entries: ReturnType<ProcessOutputBuffer['getEntries']>['entries']; droppedCount: number; truncated: boolean }> {
		return this._externalOutput.get(pid)?.getEntries(maximumEntries) ?? { entries: [], droppedCount: 0, truncated: false };
	}

	private _rememberProcessOutput(pid: number, output: ProcessOutputBuffer): void {
		this._externalOutput.delete(pid);
		this._externalOutput.set(pid, output);
		while (this._externalOutput.size > MAX_RETAINED_EXTERNAL_OUTPUTS) {
			const oldestPid = this._externalOutput.keys().next().value;
			if (oldestPid === undefined) {
				return;
			}
			this._externalOutput.delete(oldestPid);
		}
	}

	async killOwnedProcess(pid: number): Promise<void> {
		if (!this._ownedPids.has(pid)) {
			return;
		}
		const stopped = await this._killProcessTree(pid);
		if (!stopped) {
			throw new Error(`PreBase could not confirm termination of owned process ${pid}.`);
		}
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

	private async _getOwnedCdpPageWebSocketUrl(debugPort: number): Promise<string> {
		if (!Number.isInteger(debugPort) || debugPort <= 0 || debugPort > 65535) {
			throw new Error('Invalid debug port.');
		}
		if (!this._ownedDebugPorts.has(debugPort)) {
			throw new Error('CDP is limited to PreBase-owned localhost debugging ports.');
		}
		const targets = await this._fetchJson<CdpDiscoveryTarget[]>(`http://127.0.0.1:${debugPort}/json`);
		const webSocketDebuggerUrl = selectOwnedCdpPageWebSocketUrl(targets, debugPort);
		if (!webSocketDebuggerUrl) {
			throw new Error('No renderer CDP page target is available for this owned session.');
		}
		return webSocketDebuggerUrl;
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
		let serialized: string;
		try {
			serialized = JSON.stringify(value) ?? String(value);
		} catch {
			serialized = String(value);
		}
		if (Buffer.byteLength(serialized, 'utf8') > MAX_DESKTOP_EVALUATION_RESULT_BYTES) {
			throw new Error(`Desktop evaluation result exceeds the ${MAX_DESKTOP_EVALUATION_RESULT_BYTES / 1024} KiB IPC limit.`);
		}
		try {
			return JSON.parse(serialized);
		} catch {
			return serialized;
		}
	}

	private _assertEvaluationExpression(expression: string): void {
		if (typeof expression !== 'string' || !expression.trim() || expression.includes('\0')) {
			throw new Error('Desktop evaluation expression must be a non-empty string without NUL bytes.');
		}
		if (Buffer.byteLength(expression, 'utf8') > MAX_DESKTOP_EVALUATION_EXPRESSION_BYTES) {
			throw new Error(`Desktop evaluation expression exceeds the ${MAX_DESKTOP_EVALUATION_EXPRESSION_BYTES / 1024} KiB limit.`);
		}
	}

	private async _fetchJson<T>(url: string): Promise<T> {
		if (!this._isLocalhostUrl(url)) {
			throw new Error('CDP discovery is limited to localhost.');
		}
		const http = await import('http');
		return new Promise((resolve, reject) => {
			const req = http.get(url, res => {
				const chunks: Buffer[] = [];
				let bodyBytes = 0;
				if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
					res.resume();
					reject(new Error(`CDP target discovery failed with HTTP ${res.statusCode ?? 'unknown'}.`));
					return;
				}
				res.on('data', (c: Buffer) => {
					bodyBytes += c.byteLength;
					if (bodyBytes > MAX_CDP_DISCOVERY_BYTES) {
						req.destroy(new Error('CDP target discovery response exceeds the 1 MiB limit.'));
						return;
					}
					chunks.push(c);
				});
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
		return this._withCdpConnection(wsUrl, 'evaluate', 1 * 1024 * 1024, async connection => {
			await connection.request('Runtime.enable');
			const result = await connection.request<{ result?: { value?: unknown }; exceptionDetails?: { text?: string } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
			if (result.exceptionDetails) {
				throw new Error(result.exceptionDetails.text || 'CDP expression threw');
			}
			return result.result?.value;
		});
	}

	private async _cdpCaptureScreenshot(wsUrl: string): Promise<string> {
		return this._withCdpConnection(wsUrl, 'screenshot capture', MAX_EXTERNAL_SCREENSHOT_CDP_MESSAGE_BYTES, async connection => {
			const result = await connection.request<{ data?: unknown }>('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
			return validateCdpPngScreenshotData(result.data);
		});
	}

	private async _withCdpConnection<T>(wsUrl: string, operation: string, maxInboundMessageBytes: number, run: (connection: CdpConnection) => Promise<T>): Promise<T> {
		if (!this._isLocalCdpWebSocketUrl(wsUrl)) {
			throw new Error('CDP websocket must target localhost.');
		}
		const wsModule = await import('ws') as { default?: new (url: string) => MinimalWebSocket; WebSocket?: new (url: string) => MinimalWebSocket };
		const WebSocketCtor = wsModule.default ?? wsModule.WebSocket;
		if (!WebSocketCtor) {
			throw new Error('WebSocket implementation unavailable for CDP.');
		}
		return new Promise<T>((resolve, reject) => {
			const ws = new WebSocketCtor(wsUrl);
			const connection = new CdpConnection(ws, 8_000, undefined, maxInboundMessageBytes);
			let settled = false;
			const timer = setTimeout(() => {
				const error = new Error(`CDP ${operation} timed out`);
				connection.rejectAll(error);
				finish(error);
			}, 8000);
			const finish = (error?: Error, value?: T) => {
				if (settled) {
					return;
				}
				settled = true;
				if (timer) {
					clearTimeout(timer);
				}
				ws.close();
				if (error) {
					reject(error);
				} else {
					resolve(value as T);
				}
			};
			ws.on('open', () => {
				void (async () => {
					try {
						finish(undefined, await run(connection));
					} catch (error) {
						finish(error instanceof Error ? error : new Error(String(error)));
					}
				})();
			});
			ws.on('message', raw => connection.handleMessage(raw));
			ws.on('error', error => {
				connection.rejectAll(error);
				finish(error);
			});
			ws.on('close', () => {
				if (!settled) {
					const error = new Error('CDP connection closed before the evaluation completed.');
					connection.rejectAll(error);
					finish(error);
				}
			});
		});
	}

	private async _killProcessTree(pid: number): Promise<boolean> {
		const child = this._externalChildren.get(pid);
		if (!child || child.exitCode !== null || child.signalCode !== null) {
			return true;
		}
		if (process.platform !== 'win32') {
			return terminateOwnedProcess({
				isExited: () => child.exitCode !== null || child.signalCode !== null,
				sendSignal: signal => this._signalProcessTree(child, pid, signal),
				waitForExit: timeoutMs => this._waitForChildExit(child, timeoutMs),
			});
		}
		await new Promise<void>(resolve => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = () => {
				if (settled) {
					return;
				}
				settled = true;
				if (timer !== undefined) {
					clearTimeout(timer);
				}
				resolve();
			};
			const taskkill = execFile('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }, finish);
			timer = setTimeout(() => {
				try {
					taskkill.kill();
				} catch {
					// ignore
				}
				finish();
			}, WINDOWS_TASKKILL_EXEC_TIMEOUT_MS);
		});
		return this._waitForChildExit(child, WINDOWS_TASKKILL_EXIT_WAIT_MS);
	}

	private _signalProcessTree(child: ChildProcess, pid: number, signal: ProcessTerminationSignal): boolean {
		try {
			process.kill(-pid, signal);
			return true;
		} catch {
			try {
				return child.kill(signal);
			} catch {
				return false;
			}
		}
	}

	private _waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
		if (child.exitCode !== null || child.signalCode !== null) {
			return Promise.resolve(true);
		}
		return new Promise(resolve => {
			const timer = setTimeout(() => finish(false), timeoutMs);
			const onExit = () => finish(true);
			const finish = (exited: boolean) => {
				clearTimeout(timer);
				child.removeListener('exit', onExit);
				resolve(exited);
			};
			child.once('exit', onExit);
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

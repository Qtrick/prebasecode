/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './mochaNodeDom.js';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInNewContext } from 'vm';
import { newWriteableBufferStream } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import type { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import type { ICommandService } from '../../../../../platform/commands/common/commands.js';
import type { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import type { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import type { IFileService } from '../../../../../platform/files/common/files.js';
import type { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import type { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import type { IRequestService } from '../../../../../platform/request/common/request.js';
import type { IRequestContext } from '../../../../../base/parts/request/common/request.js';
import type { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import type { IEditorService } from '../../../../services/editor/common/editorService.js';
import type { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import type { IOutputChannel, IOutputService } from '../../../../services/output/common/output.js';
import type { ITerminalService } from '../../../terminal/browser/terminal.js';
import { PreBaseRuntimeService } from '../../browser/prebaseRuntimeService.js';
import { deriveRuntimePreviewUiStatus, handleRuntimePreviewStatusMessage, type RuntimePreviewStatusMessage } from '../../common/runtime/runtimeWebviewProtocol.js';

interface Deferred<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function previewHtml(channel: string): string {
	const source = readFileSync(resolve('src/vs/workbench/contrib/prebase/browser/runtimeEditor.ts'), 'utf8');
	assert.match(source, /handleRuntimePreviewStatusMessage\(msg,/);
	const template = source.match(/private _buildPreviewHtml\(controlChannel: string\): string \{[\s\S]*?return `([\s\S]*?)`;\n\t\}/)?.[1];
	assert.ok(template, 'runtime preview HTML template must be present');
	return template
		.replaceAll('${nonce}', 'runtime-test-nonce')
		.replaceAll('${controlChannel}', channel);
}

function applyPreviewHostMessage(service: PreBaseRuntimeService, message: RuntimePreviewStatusMessage | undefined): void {
	handleRuntimePreviewStatusMessage(message, (url, ok, detail, navigationId, kind) => service.markPreviewLoaded(url, ok, detail, navigationId, kind));
}

function createWebviewHarness(fetchImpl: (url: string, options: Record<string, unknown>) => Promise<unknown>) {
	const channel = 'runtime-control-channel';
	const html = previewHtml(channel);
	const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
	assert.ok(script, 'runtime preview script must be present');
	const posted: Array<Record<string, unknown>> = [];
	let messageListener: ((event: { origin: string; data: unknown }) => void) | undefined;
	const iframe: {
		src?: string;
		onload?: () => void;
		contentWindow?: { history: { back(): void; forward(): void }; location: { reload(): void } };
		removeAttribute(name: string): void;
	} = {
		contentWindow: { history: { back() { }, forward() { } }, location: { reload() { } } },
		removeAttribute(name) {
			if (name === 'src') {
				this.src = undefined;
			}
		},
	};
	const overlay = {
		textContent: '',
		classList: { add(_name: string) { }, remove(_name: string) { } },
	};
	const windowObject = {
		origin: 'vscode-webview://runtime-preview',
		addEventListener(type: string, listener: (event: { origin: string; data: unknown }) => void) {
			if (type === 'message') {
				messageListener = listener;
			}
		},
	};
	runInNewContext(script, {
		acquireVsCodeApi: () => ({ postMessage: (message: Record<string, unknown>) => posted.push(message) }),
		document: { getElementById: (id: string) => id === 'frame' ? iframe : overlay },
		fetch: fetchImpl,
		window: windowObject,
		URL,
	});
	assert.ok(messageListener, 'runtime preview must install its message listener');
	return {
		channel,
		html,
		iframe,
		posted,
		send(origin: string, data: unknown) {
			messageListener!({ origin, data });
		},
		origin: windowObject.origin,
	};
}

function requestContext(statusCode: number): IRequestContext {
	return { res: { headers: {}, statusCode }, stream: newWriteableBufferStream() };
}

function createRuntimeService(disposables: ReturnType<typeof ensureNoDisposablesAreLeakedInTestSuite>, request: IRequestService['request'], lifecycle: Pick<ILifecycleService, 'onWillShutdown'> = { onWillShutdown: Event.None }) {
	const logs: string[] = [];
	const service = disposables.add(new PreBaseRuntimeService(
		upcastPartial<IConfigurationService>({ getValue: () => undefined, onDidChangeConfiguration: Event.None }),
		upcastPartial<IDialogService>({ info: async () => undefined }),
		upcastPartial<IFileService>({}),
		upcastPartial<IWorkspaceContextService>({ getWorkspace: () => ({ id: 'runtime', folders: [] }) }),
		upcastPartial<ICommandService>({}),
		upcastPartial<ITerminalService>({ onDidDisposeInstance: Event.None }),
		upcastPartial<IOutputService>({
			getChannel: () => upcastPartial<IOutputChannel>({ append: (value: string) => { logs.push(value); } }),
		}),
		upcastPartial<IEditorService>({ openEditor: async () => undefined }),
		upcastPartial<IOpenerService>({}),
		upcastPartial<IClipboardService>({}),
		upcastPartial<IRequestService>({ request }),
		upcastPartial<IInstantiationService>({ invokeFunction: () => { throw new Error('desktop service unavailable'); } }),
		upcastPartial<ILifecycleService>(lifecycle),
	));
	service.openPreviewEditor = async () => undefined;
	return { service, logs };
}

suite('Runtime Preview reachability', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('derives Starting, Connected, Disconnected, Stopped, and Error from separate facts', () => {
		assert.strictEqual(deriveRuntimePreviewUiStatus({ running: false, serverRunning: false, httpReachable: false, frameLoaded: false }), 'stopped');
		assert.strictEqual(deriveRuntimePreviewUiStatus({ running: true, serverRunning: true, httpReachable: true, frameLoaded: false }), 'starting');
		assert.strictEqual(deriveRuntimePreviewUiStatus({ running: false, serverRunning: true, httpReachable: false, frameLoaded: false }), 'starting');
		assert.strictEqual(deriveRuntimePreviewUiStatus({ running: true, serverRunning: true, httpReachable: true, frameLoaded: true }), 'connected');
		assert.strictEqual(deriveRuntimePreviewUiStatus({ running: true, serverRunning: false, httpReachable: false, frameLoaded: true }), 'connected');
		assert.strictEqual(deriveRuntimePreviewUiStatus({ running: false, serverRunning: true, httpReachable: false, frameLoaded: true }), 'connected');
		assert.strictEqual(deriveRuntimePreviewUiStatus({ running: false, serverRunning: false, httpReachable: false, frameLoaded: true }), 'disconnected');
		assert.strictEqual(deriveRuntimePreviewUiStatus({ running: false, serverRunning: false, httpReachable: false, frameLoaded: false, error: true }), 'error');
		assert.strictEqual(deriveRuntimePreviewUiStatus({ running: true, serverRunning: true, httpReachable: true, frameLoaded: true, error: true }), 'error');
	});

	test('opaque no-cors response reports local reachability through the generated webview', async () => {
		const fetches: Array<{ url: string; options: Record<string, unknown> }> = [];
		const harness = createWebviewHarness(async (url, options) => {
			fetches.push({ url, options });
			return { type: 'opaque', status: 0 };
		});

		harness.send(harness.origin, { channel: harness.channel, type: 'setUrl', url: 'http://localhost:5173/' });
		await Promise.resolve();

		assert.match(harness.html, /connect-src http: https:/);
		assert.deepStrictEqual(JSON.parse(JSON.stringify(fetches)), [{
			url: 'http://localhost:5173/',
			options: { mode: 'no-cors', cache: 'no-store' },
		}]);
		const probe = harness.posted.find(message => message.type === 'probe');
		assert.deepStrictEqual(JSON.parse(JSON.stringify(probe)), {
			type: 'probe',
			url: 'http://localhost:5173/',
			ok: true,
		});

		const { service } = createRuntimeService(disposables, async () => { throw new Error('renderer CORS failure'); });
		await service.connectUrl('http://localhost:5173');
		assert.strictEqual(service.getSession().previewConnected, false);
		assert.strictEqual(service.getSession().previewStatus, 'starting');
		applyPreviewHostMessage(service, probe as RuntimePreviewStatusMessage);
		assert.strictEqual(service.getSession().previewHttpReachable, true);
		assert.strictEqual(service.getSession().previewConnected, false);
		applyPreviewHostMessage(service, { type: 'load', url: 'http://localhost:5173/' });
		assert.strictEqual(service.getSession().previewConnected, true);
		assert.strictEqual(service.getSession().previewStatus, 'connected');
	});

	test('iframe load connects after a failed workbench HTTP probe, and a later failed no-cors probe does not disconnect', async () => {
		const { service } = createRuntimeService(disposables, async () => { throw new Error('renderer CORS failure'); });
		await service.connectUrl('http://localhost:5173');
		assert.strictEqual(service.getSession().previewConnected, false);

		const harness = createWebviewHarness(async () => {
			throw new Error('Failed to fetch');
		});
		harness.send(harness.origin, { channel: harness.channel, type: 'setUrl', url: 'http://localhost:5173/' });
		await Promise.resolve();
		harness.iframe.onload?.();
		await Promise.resolve();

		const load = harness.posted.find(message => message.type === 'load') as RuntimePreviewStatusMessage | undefined;
		const probe = harness.posted.find(message => message.type === 'probe') as RuntimePreviewStatusMessage | undefined;
		assert.deepStrictEqual(JSON.parse(JSON.stringify(load)), { type: 'load', url: 'http://localhost:5173/' });
		assert.strictEqual(probe?.ok, false);

		// vscode-webview often fails the loopback fetch after the iframe has already rendered.
		applyPreviewHostMessage(service, JSON.parse(JSON.stringify(load)) as RuntimePreviewStatusMessage);
		assert.strictEqual(service.getSession().previewConnected, true);
		applyPreviewHostMessage(service, JSON.parse(JSON.stringify(probe)) as RuntimePreviewStatusMessage);
		assert.strictEqual(service.getSession().previewConnected, true);
	});

	test('iframe navigation errors disconnect a previously loaded preview', async () => {
		const { service, logs } = createRuntimeService(disposables, async () => requestContext(200));
		await service.connectUrl('http://localhost:5173');
		assert.strictEqual(service.getSession().previewConnected, false);
		assert.strictEqual(service.getSession().previewHttpReachable, true);
		applyPreviewHostMessage(service, { type: 'load', url: 'http://localhost:5173/' });
		assert.strictEqual(service.getSession().previewConnected, true);

		applyPreviewHostMessage(service, {
			type: 'error',
			url: 'http://localhost:5173/',
			detail: 'Failed to navigate to http://localhost:5173/',
		});

		assert.strictEqual(service.getSession().previewConnected, false);
		assert.strictEqual(service.getSession().previewStatus, 'starting');
		assert.ok(logs.some(entry => entry.includes('Preview failed') && entry.includes('Failed to navigate')));
	});

	test('stale same-URL probe, load, or error cannot overwrite a newer navigation generation', async () => {
		const { service } = createRuntimeService(disposables, async () => requestContext(200));
		await service.connectUrl('http://localhost:5173');
		const current = service.beginPreviewNavigation();
		applyPreviewHostMessage(service, { type: 'load', url: 'http://localhost:5173/', navigationId: current });
		assert.strictEqual(service.getSession().previewConnected, true);
		applyPreviewHostMessage(service, { type: 'error', url: 'http://localhost:5173/', detail: 'stale', navigationId: current - 1 });
		applyPreviewHostMessage(service, { type: 'probe', url: 'http://localhost:5173/', ok: false, navigationId: current - 1 });
		applyPreviewHostMessage(service, { type: 'load', url: 'http://localhost:5173/', navigationId: current - 1 });
		assert.strictEqual(service.getSession().previewConnected, true);

		const next = service.beginPreviewNavigation();
		assert.strictEqual(service.getSession().previewConnected, false);
		applyPreviewHostMessage(service, { type: 'load', url: 'http://localhost:5173/', navigationId: current });
		applyPreviewHostMessage(service, { type: 'probe', url: 'http://localhost:5173/', ok: true, navigationId: current });
		applyPreviewHostMessage(service, { type: 'error', url: 'http://localhost:5173/', detail: 'stale', navigationId: current });
		assert.strictEqual(service.getSession().previewConnected, false);
		assert.strictEqual(service.getSession().previewStatus, 'starting');
		applyPreviewHostMessage(service, { type: 'load', url: 'http://localhost:5173/', navigationId: next });
		assert.strictEqual(service.getSession().previewConnected, true);
	});

	test('a late same-URL probe from a replaced navigation cannot change the current preview', async () => {
		const first = deferred<unknown>();
		const second = deferred<unknown>();
		let fetches = 0;
		const harness = createWebviewHarness(() => {
			fetches++;
			return fetches === 1 ? first.promise : second.promise;
		});
		harness.send(harness.origin, { channel: harness.channel, type: 'setUrl', url: 'http://localhost:5173/', navigationId: 1 });
		harness.send(harness.origin, { channel: harness.channel, type: 'setUrl', url: 'http://localhost:5173/', navigationId: 2 });
		first.resolve({ type: 'opaque' });
		await Promise.resolve();
		await Promise.resolve();
		assert.deepStrictEqual(harness.posted.filter(message => message.type === 'probe'), []);

		second.resolve({ type: 'opaque' });
		await Promise.resolve();
		await Promise.resolve();
		assert.deepStrictEqual(JSON.parse(JSON.stringify(harness.posted.filter(message => message.type === 'probe'))), [{
			type: 'probe',
			url: 'http://localhost:5173/',
			ok: true,
			navigationId: 2,
		}]);

		const { service } = createRuntimeService(disposables, async () => requestContext(200));
		await service.connectUrl('http://localhost:5173');
		const current = service.beginPreviewNavigation();
		applyPreviewHostMessage(service, { type: 'load', url: 'http://localhost:5173/', navigationId: current });
		applyPreviewHostMessage(service, { type: 'error', url: 'http://localhost:5173/', detail: 'stale same-url', navigationId: current - 1 });
		applyPreviewHostMessage(service, { type: 'probe', url: 'http://localhost:5173/', ok: false, detail: 'stale probe', navigationId: current - 1 });
		assert.strictEqual(service.getSession().previewConnected, true);
		applyPreviewHostMessage(service, { type: 'error', url: 'http://localhost:5173/', detail: 'missing generation' });
		assert.strictEqual(service.getSession().previewConnected, true);
	});

	test('clearing the preview ignores a late iframe load from the previous navigation', async () => {
		const harness = createWebviewHarness(async () => ({ type: 'opaque' }));
		harness.send(harness.origin, { channel: harness.channel, type: 'setUrl', url: 'http://localhost:5173/', navigationId: 1 });
		const previousOnload = harness.iframe.onload;
		harness.send(harness.origin, { channel: harness.channel, type: 'clear', reason: 'Stopped' });
		previousOnload?.();
		await Promise.resolve();
		assert.ok(!harness.posted.some(message => message.type === 'load'));
		assert.strictEqual(harness.iframe.src, undefined);
	});

	test('failed no-cors probe still navigates the iframe and does not claim disconnect', async () => {
		const harness = createWebviewHarness(async () => {
			throw new Error('Failed to fetch');
		});

		harness.send(harness.origin, { channel: harness.channel, type: 'setUrl', url: 'http://localhost:5173/' });
		await Promise.resolve();
		harness.iframe.onload?.();
		await Promise.resolve();

		assert.strictEqual(harness.iframe.src, 'http://localhost:5173/');
		assert.deepStrictEqual(JSON.parse(JSON.stringify(harness.posted.filter(message => message.type !== 'ready'))), [
			{ type: 'probe', url: 'http://localhost:5173/', ok: false, detail: 'Error: Failed to fetch' },
			{ type: 'load', url: 'http://localhost:5173/' },
		]);
	});

	test('stale webview and service probe results cannot change the current URL state', async () => {
		const first = deferred<unknown>();
		const second = deferred<unknown>();
		const harness = createWebviewHarness(url => url.includes('5173') ? first.promise : second.promise);
		harness.send(harness.origin, { channel: harness.channel, type: 'setUrl', url: 'http://localhost:5173/' });
		harness.send(harness.origin, { channel: harness.channel, type: 'setUrl', url: 'http://localhost:4173/' });
		first.resolve({ type: 'opaque' });
		second.reject(new Error('connection refused'));
		await Promise.resolve();
		await Promise.resolve();
		const probes = harness.posted.filter(message => message.type === 'probe');
		assert.deepStrictEqual(JSON.parse(JSON.stringify(probes)), [{
			type: 'probe',
			url: 'http://localhost:4173/',
			ok: false,
			detail: 'Error: connection refused',
		}]);

		const { service } = createRuntimeService(disposables, async () => { throw new Error('renderer CORS failure'); });
		await service.connectUrl('http://localhost:5173');
		await service.connectUrl('http://localhost:4173');
		let changes = 0;
		const listener = disposables.add(service.onDidChangeSession(() => changes++));
		applyPreviewHostMessage(service, { type: 'load', url: 'http://localhost:5173/' });
		listener.dispose();
		assert.deepStrictEqual({
			url: service.getSession().url,
			connected: service.getSession().previewConnected,
			changes,
		}, {
			url: 'http://localhost:4173',
			connected: false,
			changes: 0,
		});
	});

	test('webview rejects commands from the preview origin or without the active channel', () => {
		let fetchCount = 0;
		const harness = createWebviewHarness(async () => {
			fetchCount++;
			return { type: 'opaque' };
		});
		const command = { channel: harness.channel, type: 'setUrl', url: 'http://localhost:5173/' };

		harness.send('http://localhost:5173', command);
		harness.send(harness.origin, { ...command, channel: 'retired-channel' });

		assert.strictEqual(fetchCount, 0);
		assert.strictEqual(harness.iframe.src, undefined);
		assert.deepStrictEqual(JSON.parse(JSON.stringify(harness.posted)), [{ type: 'ready' }]);
	});

	test('live acceptance fails closed when the preview never connects', () => {
		const evidence = {
			targetOpened: true,
			detectedScript: true,
			serverStarted: true,
			previewConnected: false,
			inspected: true,
			restarted: true,
			stopped: true,
			portAfterStop: [],
			startedBeforeQuit: true,
			quit: { remaining: 'gone' },
			portAfterQuit: [],
		};
		const result = spawnSync(process.execPath, [resolve('test/prebase/acceptance/runtime-preview-live.mjs'), '--evaluate'], {
			input: JSON.stringify(evidence),
			encoding: 'utf8',
		});
		assert.strictEqual(result.status, 1, result.stderr);
		assert.deepStrictEqual(JSON.parse(result.stdout), {
			ok: false,
			failures: ['Runtime Preview did not connect to the fixture'],
		});
	});

	test('quit joins a bounded preview stop so a hung terminal cannot block shutdown', () => {
		const source = readFileSync(resolve('src/vs/workbench/contrib/prebase/browser/prebaseRuntimeService.ts'), 'utf8');
		assert.match(source, /event\.join\(this\._stopOwnedPreviewForShutdown\(\)/);
		assert.match(source, /Promise\.race\(\[/);
		assert.match(source, /this\._stopTerminal\(true\)\.then\(\(\) => undefined, \(\) => undefined\)/);
		assert.match(source, /setTimeout\(resolve, 1_500\)/);
	});

	test('quit join is bounded to 1.5s and swallows a rejected owned-preview stop', async () => {
		const joins: Array<Promise<void>> = [];
		const shutdown = new Emitter<{ join(promise: Promise<void>): void }>();
		disposables.add(shutdown);
		const { service } = createRuntimeService(disposables, async () => requestContext(200), {
			onWillShutdown: shutdown.event as unknown as ILifecycleService['onWillShutdown'],
		});
		(service as unknown as { _stopTerminal: (immediate?: boolean) => Promise<void> })._stopTerminal = () => new Promise((_resolve, reject) => {
			setTimeout(() => reject(new Error('pty hung')), 10_000);
		});

		const started = Date.now();
		shutdown.fire({
			join(promise) {
				joins.push(promise);
			},
		});
		assert.strictEqual(joins.length, 1);
		await joins[0];
		const elapsed = Date.now() - started;
		assert.ok(elapsed >= 1_400 && elapsed < 3_500, `quit join elapsed ${elapsed}ms`);
	});
});

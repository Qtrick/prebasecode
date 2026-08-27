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
import { Event } from '../../../../../base/common/event.js';
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
import type { IOutputChannel, IOutputService } from '../../../../services/output/common/output.js';
import type { ITerminalService } from '../../../terminal/browser/terminal.js';
import { PreBaseRuntimeService } from '../../browser/prebaseRuntimeService.js';
import { handleRuntimePreviewStatusMessage, type RuntimePreviewStatusMessage } from '../../common/runtime/runtimeWebviewProtocol.js';

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
	handleRuntimePreviewStatusMessage(message, (url, ok, detail, navigationId) => service.markPreviewLoaded(url, ok, detail, navigationId));
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

function createRuntimeService(disposables: ReturnType<typeof ensureNoDisposablesAreLeakedInTestSuite>, request: IRequestService['request']) {
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
	));
	service.openPreviewEditor = async () => undefined;
	return { service, logs };
}

suite('Runtime Preview reachability', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

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
		applyPreviewHostMessage(service, probe as RuntimePreviewStatusMessage);
		assert.strictEqual(service.getSession().previewConnected, true);
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

	test('iframe navigation errors disconnect a previously reachable preview', async () => {
		const { service, logs } = createRuntimeService(disposables, async () => requestContext(200));
		await service.connectUrl('http://localhost:5173');
		assert.strictEqual(service.getSession().previewConnected, true);

		applyPreviewHostMessage(service, {
			type: 'error',
			url: 'http://localhost:5173/',
			detail: 'Failed to navigate to http://localhost:5173/',
		});

		assert.strictEqual(service.getSession().previewConnected, false);
		assert.ok(logs.some(entry => entry.includes('Preview failed') && entry.includes('Failed to navigate')));
	});

	test('stale same-URL error cannot disconnect a newer navigation generation', async () => {
		const { service } = createRuntimeService(disposables, async () => requestContext(200));
		await service.connectUrl('http://localhost:5173');
		const current = service.beginPreviewNavigation();
		applyPreviewHostMessage(service, { type: 'load', url: 'http://localhost:5173/', navigationId: current });
		assert.strictEqual(service.getSession().previewConnected, true);
		applyPreviewHostMessage(service, { type: 'error', url: 'http://localhost:5173/', detail: 'stale', navigationId: current - 1 });
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
});

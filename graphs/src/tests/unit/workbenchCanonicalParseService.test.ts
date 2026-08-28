/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Event } from '../../../../../../base/common/event.js';
import type { IChannel } from '../../../../../../base/parts/ipc/common/ipc.js';
import type { IUtilityProcessWorker, IUtilityProcessWorkerWorkbenchService } from '../../../../../../workbench/services/utilityProcess/electron-browser/utilityProcessWorkerWorkbenchService.js';
import type { CanonicalParseRequest } from '../../core/canonical/canonicalParseService.js';
import { WorkbenchCanonicalParseService } from '../../host/workbench/workbenchCanonicalParseService.js';

function parseRequest(): CanonicalParseRequest {
	return {
		file: {
			absolutePath: '/tmp/parser-quit.ts',
			relativePath: 'parser-quit.ts',
			extension: '.ts',
		},
		content: 'export const value = 1;',
	};
}

function hangingWorkers(state: { createCalls: number; workerDisposed: number; callStarted: boolean; resolveCall?: (value: readonly unknown[]) => void }): IUtilityProcessWorkerWorkbenchService {
	const channel: IChannel = {
		call: (_command, _arg, token: CancellationToken = CancellationToken.None) => new Promise((resolve, reject) => {
			state.callStarted = true;
			state.resolveCall = (value) => resolve(value as never);
			if (token.isCancellationRequested) {
				resolve([] as never);
				return;
			}
			token.onCancellationRequested(() => resolve([] as never));
		}),
		listen: () => Event.None,
	};
	const worker: IUtilityProcessWorker = {
		client: { getChannel: () => channel } as unknown as IUtilityProcessWorker['client'],
		onDidTerminate: new Promise(() => { }),
		dispose() {
			state.workerDisposed++;
		},
	};
	return {
		_serviceBrand: undefined,
		notifyRestored() { },
		async createWorker() {
			state.createCalls++;
			return worker;
		},
	};
}

suite('WorkbenchCanonicalParseService quit', () => {
	test('parse after dispose returns undefined without starting a worker', async () => {
		const state = { createCalls: 0, workerDisposed: 0, callStarted: false };
		const service = new WorkbenchCanonicalParseService(hangingWorkers(state));
		service.dispose();
		assert.strictEqual(await service.parse(parseRequest()), undefined);
		assert.strictEqual(state.createCalls, 0);
		assert.strictEqual(state.callStarted, false);
	});

	test('dispose resolves queued parses as undefined before a worker is created', async () => {
		const state = { createCalls: 0, workerDisposed: 0, callStarted: false };
		const service = new WorkbenchCanonicalParseService(hangingWorkers(state));
		const pending = service.parse(parseRequest());
		service.dispose();
		assert.strictEqual(await pending, undefined);
		assert.strictEqual(state.createCalls, 0);
	});

	test('getActiveRequestCount counts queued parses, not a CPU heuristic', async () => {
		const state = { createCalls: 0, workerDisposed: 0, callStarted: false };
		const service = new WorkbenchCanonicalParseService(hangingWorkers(state));
		assert.strictEqual(service.getActiveRequestCount(), 0);
		const first = service.parse(parseRequest());
		const second = service.parse(parseRequest());
		assert.strictEqual(service.getActiveRequestCount(), 2, 'parser-active Quit must use in-flight request count, not process CPU');
		service.dispose();
		assert.strictEqual(await first, undefined);
		assert.strictEqual(await second, undefined);
		assert.strictEqual(service.getActiveRequestCount(), 0);
	});

	test('getActiveRequestCount is positive while a batch is in flight', async () => {
		const state = { createCalls: 0, workerDisposed: 0, callStarted: false };
		const service = new WorkbenchCanonicalParseService(hangingWorkers(state));
		const pending = service.parse(parseRequest());
		for (let i = 0; i < 50 && !state.callStarted; i++) {
			await Promise.resolve();
		}
		assert.ok(service.getActiveRequestCount() > 0, 'parser-active Quit must see an authoritative in-flight count');
		service.dispose();
		assert.strictEqual(await pending, undefined);
		assert.strictEqual(service.getActiveRequestCount(), 0);
	});

	test('dispose cancels an in-flight parse batch without killing a fake OS process', async () => {
		const state = { createCalls: 0, workerDisposed: 0, callStarted: false };
		const service = new WorkbenchCanonicalParseService(hangingWorkers(state));
		const pending = service.parse(parseRequest());
		for (let i = 0; i < 50 && !state.callStarted; i++) {
			await Promise.resolve();
		}
		assert.strictEqual(state.callStarted, true);
		service.dispose();
		assert.strictEqual(await pending, undefined);
		assert.strictEqual(state.createCalls, 1);
	});

	test('dispose during worker startup disposes the just-created worker', async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>(resolve => { release = resolve; });
		let createStarted = false;
		let workerDisposed = 0;
		const workers: IUtilityProcessWorkerWorkbenchService = {
			_serviceBrand: undefined,
			notifyRestored() { },
			async createWorker() {
				createStarted = true;
				await gate;
				return {
					client: { getChannel: () => ({ call: async () => [], listen: () => Event.None }) } as unknown as IUtilityProcessWorker['client'],
					onDidTerminate: new Promise(() => { }),
					dispose() { workerDisposed++; },
				};
			},
		};
		const service = new WorkbenchCanonicalParseService(workers);
		const pending = service.parse(parseRequest());
		for (let i = 0; i < 50 && !createStarted; i++) {
			await Promise.resolve();
		}
		assert.strictEqual(createStarted, true);
		service.dispose();
		release?.();
		assert.strictEqual(await pending, undefined);
		assert.strictEqual(workerDisposed, 1);
	});
});

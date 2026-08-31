/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../../base/test/common/utils.js";
import assert from 'assert';
import { terminateOwnedProcess, POSIX_OWNED_PROCESS_TERMINATION_BUDGET_MS, sanitizeOwnedDesktopChildEnv, type IProcessTerminationTarget, type ProcessTerminationSignal } from '../../../../../platform/prebaseDesktop/common/processTermination.js';

class FakeTerminationTarget implements IProcessTerminationTarget {
	readonly signals: ProcessTerminationSignal[] = [];
	readonly waitTimeouts: number[] = [];

	constructor(
		private _exited: boolean,
		private readonly _signalsSucceed: Partial<Record<ProcessTerminationSignal, boolean>> = {},
		private readonly _waitResults: boolean[] = [],
	) { }

	isExited(): boolean {
		return this._exited;
	}

	sendSignal(signal: ProcessTerminationSignal): boolean {
		this.signals.push(signal);
		return this._signalsSucceed[signal] ?? true;
	}

	async waitForExit(timeoutMs: number): Promise<boolean> {
		this.waitTimeouts.push(timeoutMs);
		const exited = this._waitResults.shift() ?? false;
		this._exited ||= exited;
		return exited;
	}
}

suite('terminateOwnedProcess', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('does not signal or wait for an already-exited target', async () => {
		const target = new FakeTerminationTarget(true);

		assert.strictEqual(await terminateOwnedProcess(target, 17, 29), true);
		assert.deepStrictEqual(target.signals, []);
		assert.deepStrictEqual(target.waitTimeouts, []);
	});

	test('sends TERM and returns after a graceful exit without sending KILL', async () => {
		const target = new FakeTerminationTarget(false, {}, [true]);

		assert.strictEqual(await terminateOwnedProcess(target, 17, 29), true);
		assert.deepStrictEqual(target.signals, ['SIGTERM']);
		assert.deepStrictEqual(target.waitTimeouts, [17]);
	});

	test('escalates an ignored TERM to KILL and uses the exact graceful and force timeouts', async () => {
		const target = new FakeTerminationTarget(false, {}, [false, true]);

		assert.strictEqual(await terminateOwnedProcess(target, 17, 29), true);
		assert.deepStrictEqual(target.signals, ['SIGTERM', 'SIGKILL']);
		assert.deepStrictEqual(target.waitTimeouts, [17, 29]);
	});

	test('reports failure without waiting when a required signal cannot be delivered', async () => {
		const termFailure = new FakeTerminationTarget(false, { SIGTERM: false });
		assert.strictEqual(await terminateOwnedProcess(termFailure, 17, 29), false);
		assert.deepStrictEqual(termFailure.signals, ['SIGTERM']);
		assert.deepStrictEqual(termFailure.waitTimeouts, []);

		const killFailure = new FakeTerminationTarget(false, { SIGKILL: false }, [false]);
		assert.strictEqual(await terminateOwnedProcess(killFailure, 17, 29), false);
		assert.deepStrictEqual(killFailure.signals, ['SIGTERM', 'SIGKILL']);
		assert.deepStrictEqual(killFailure.waitTimeouts, [17]);
	});

	test('uses a 3s SIGTERM then 3s SIGKILL budget when callers omit timeouts', async () => {
		const target = new FakeTerminationTarget(false, {}, [false, false]);
		await terminateOwnedProcess(target);
		assert.deepStrictEqual(target.waitTimeouts, [3_000, 3_000]);
		assert.strictEqual(target.waitTimeouts[0] + target.waitTimeouts[1], POSIX_OWNED_PROCESS_TERMINATION_BUDGET_MS);
		assert.notStrictEqual(POSIX_OWNED_PROCESS_TERMINATION_BUDGET_MS, 4_000);
	});
});

suite('sanitizeOwnedDesktopChildEnv', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('strips CARGO_TARGET_DIR even when the caller overlay tries to re-inject it', () => {
		const childEnv = sanitizeOwnedDesktopChildEnv({
			PATH: '/usr/bin',
			CARGO_TARGET_DIR: '/from-process',
			CARGO_BUILD_TARGET_DIR: '/from-process-build',
			ELECTRON_RUN_AS_NODE: '1',
			TAURI_WEBDRIVER_PORT: '4444',
			KEEP: 'yes',
		}, {
			CARGO_TARGET_DIR: '/injected-by-caller',
			CARGO_BUILD_TARGET_DIR: '/injected-build',
			ELECTRON_RUN_AS_NODE: '1',
			TAURI_WEBDRIVER_PORT: '9999',
			KEEP: 'overlaid',
		});
		assert.strictEqual(childEnv.CARGO_TARGET_DIR, undefined);
		assert.strictEqual(childEnv.CARGO_BUILD_TARGET_DIR, undefined);
		assert.strictEqual(childEnv.ELECTRON_RUN_AS_NODE, undefined);
		assert.strictEqual(childEnv.TAURI_WEBDRIVER_PORT, undefined);
		assert.strictEqual(childEnv.KEEP, 'overlaid');
		assert.strictEqual(childEnv.PATH, '/usr/bin');
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { terminateOwnedProcess, type IProcessTerminationTarget, type ProcessTerminationSignal } from '../../../../../platform/prebaseDesktop/common/processTermination.js';

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
});

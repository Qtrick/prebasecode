/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { terminateOwnedProcess, type IProcessTerminationTarget, type ProcessTerminationSignal } from '../../../../../platform/prebaseDesktop/common/processTermination.js';

class MockChildProcessTarget implements IProcessTerminationTarget {
	readonly deliveredSignals: ProcessTerminationSignal[] = [];
	private _isDead = false;

	constructor(
		readonly pid: number,
		private readonly _gracefulExit: boolean = true,
	) {}

	isExited(): boolean {
		return this._isDead;
	}

	sendSignal(signal: ProcessTerminationSignal): boolean {
		this.deliveredSignals.push(signal);
		if (signal === 'SIGKILL' || (signal === 'SIGTERM' && this._gracefulExit)) {
			this._isDead = true;
			return true;
		}
		return true;
	}

	async waitForExit(timeoutMs: number): Promise<boolean> {
		if (this._isDead) {
			return true;
		}
		return false;
	}
}

suite('desktopShutdownLifecycle', () => {
	test('terminates owned process gracefully with SIGTERM without escalating to SIGKILL', async () => {
		const target = new MockChildProcessTarget(1234, true);
		const result = await terminateOwnedProcess(target, 50, 50);

		assert.strictEqual(result, true);
		assert.deepStrictEqual(target.deliveredSignals, ['SIGTERM']);
		assert.strictEqual(target.isExited(), true);
	});

	test('escalates to SIGKILL if SIGTERM is ignored', async () => {
		const target = new MockChildProcessTarget(5678, false);
		const result = await terminateOwnedProcess(target, 50, 50);

		assert.strictEqual(result, true);
		assert.deepStrictEqual(target.deliveredSignals, ['SIGTERM', 'SIGKILL']);
		assert.strictEqual(target.isExited(), true);
	});

	test('handles multiple owned processes concurrently during shutdown', async () => {
		const targets = [
			new MockChildProcessTarget(101, true),
			new MockChildProcessTarget(102, false),
			new MockChildProcessTarget(103, true),
		];

		const results = await Promise.all(targets.map(t => terminateOwnedProcess(t, 20, 20)));

		assert.deepStrictEqual(results, [true, true, true]);
		assert.deepStrictEqual(targets[0].deliveredSignals, ['SIGTERM']);
		assert.deepStrictEqual(targets[1].deliveredSignals, ['SIGTERM', 'SIGKILL']);
		assert.deepStrictEqual(targets[2].deliveredSignals, ['SIGTERM']);
		assert.ok(targets.every(t => t.isExited()));
	});
});

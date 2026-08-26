/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { terminateOwnedProcess, resolveDesktopShutdownPolicy, POSIX_OWNED_PROCESS_TERMINATION_BUDGET_MS, type IProcessTerminationTarget, type ProcessTerminationSignal } from '../../../../../platform/prebaseDesktop/common/processTermination.js';

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

	test('stopExternalAppsOnExit false does not terminate owned children', () => {
		assert.deepStrictEqual(resolveDesktopShutdownPolicy(true, false), {
			closeManagedWindows: true,
			terminateOwnedChildren: false,
		});
	});

	test('stopExternalAppsOnExit true terminates owned children', () => {
		assert.deepStrictEqual(resolveDesktopShutdownPolicy(true, true), {
			closeManagedWindows: true,
			terminateOwnedChildren: true,
		});
	});

	test('stopManagedAppsOnExit false preserves managed windows', () => {
		assert.deepStrictEqual(resolveDesktopShutdownPolicy(false, true), {
			closeManagedWindows: false,
			terminateOwnedChildren: true,
		});
	});

	test('stopManagedAppsOnExit true closes managed windows', () => {
		assert.deepStrictEqual(resolveDesktopShutdownPolicy(true, false), {
			closeManagedWindows: true,
			terminateOwnedChildren: false,
		});
	});

	test('omitted production config defaults to stopping managed windows and keeping detached external apps', () => {
		assert.deepStrictEqual(resolveDesktopShutdownPolicy(), {
			closeManagedWindows: true,
			terminateOwnedChildren: false,
		});
	});

	test('POSIX owned-process termination budget is 3s+3s not 4s', () => {
		assert.strictEqual(POSIX_OWNED_PROCESS_TERMINATION_BUDGET_MS, 6_000);
	});

	test('Windows taskkill helper is bounded without requiring win32', () => {
		let dir = path.dirname(fileURLToPath(import.meta.url));
		let source = '';
		for (let i = 0; i < 12; i++) {
			const candidate = path.join(dir, 'src/vs/platform/prebaseDesktop/electron-main/prebaseDesktopMainService.ts');
			if (fs.existsSync(candidate)) {
				source = fs.readFileSync(candidate, 'utf8');
				break;
			}
			dir = path.resolve(dir, '..');
		}
		assert.ok(source.length > 0, 'must locate prebaseDesktopMainService.ts');
		assert.match(source, /WINDOWS_TASKKILL_EXEC_TIMEOUT_MS = 4_000/);
		assert.match(source, /WINDOWS_TASKKILL_EXIT_WAIT_MS = 3_000/);
		assert.match(source, /OWNED_PROCESS_SHUTDOWN_CEILING_MS = Math\.max\(POSIX_OWNED_PROCESS_TERMINATION_BUDGET_MS, WINDOWS_TASKKILL_EXEC_TIMEOUT_MS \+ WINDOWS_TASKKILL_EXIT_WAIT_MS\) \+ 500/);
		assert.match(source, /execFile\('taskkill'/);
	});
});

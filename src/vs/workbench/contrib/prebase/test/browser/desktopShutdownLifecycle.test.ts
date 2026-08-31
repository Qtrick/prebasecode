/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../../base/test/common/utils.js";
import assert from 'assert';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
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

	ensureNoDisposablesAreLeakedInTestSuite();
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

	test('kills the process group and releases the port after a cargo-style wrapper pid has already exited', async function () {
		this.timeout(20_000);
		if (process.platform === 'win32') {
			this.skip();
		}
		const grandchildSource = `
			const net = require('net');
			const server = net.createServer();
			server.on('error', () => {
				process.stdout.write('ready ' + process.pid + ' 0\\n');
			});
			try {
				server.listen(0, '127.0.0.1', () => {
					const address = server.address();
					process.stdout.write('ready ' + process.pid + ' ' + (address ? address.port : 0) + '\\n');
				});
			} catch {
				process.stdout.write('ready ' + process.pid + ' 0\\n');
			}
			setInterval(() => {}, 1000);
		`;
		const wrapperSource = `
			const { spawn } = require('child_process');
			const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], {
				stdio: ['ignore', 'pipe', 'inherit'],
			});
			child.stdout.once('data', chunk => {
				process.stdout.write(chunk, () => {
					process.exit(0);
				});
			});
		`;
		const wrapper = spawn(process.execPath, ['-e', wrapperSource], {
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const wrapperPid = wrapper.pid;
		assert.ok(wrapperPid, 'wrapper must have a pid');

		const cleanup = () => {
			try { process.kill(-wrapperPid, 'SIGKILL'); } catch { /* already gone */ }
			try { process.kill(wrapperPid, 'SIGKILL'); } catch { /* already gone */ }
		};

		try {
			const ready = await new Promise<{ grandchildPid: number; port: number }>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('wrapper did not report a grandchild listener')), 8_000);
				let buffer = '';
				wrapper.stdout?.on('data', chunk => {
					buffer += String(chunk);
					const match = buffer.match(/ready (\d+) (\d+)/);
					if (match) {
						clearTimeout(timer);
						resolve({ grandchildPid: Number(match[1]), port: Number(match[2]) });
					}
				});
				wrapper.on('error', reject);
			});
			assert.notStrictEqual(ready.grandchildPid, wrapperPid);

			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('wrapper pid did not exit')), 8_000);
				wrapper.once('exit', () => {
					clearTimeout(timer);
					resolve();
				});
			});

			try {
				process.kill(wrapperPid, 0);
				assert.fail('wrapper pid must already have exited');
			} catch {
				// expected: the cargo/npm wrapper is gone
			}
			process.kill(-wrapperPid, 0);
			process.kill(ready.grandchildPid, 0);

			const processGroupAlive = (): boolean => {
				try {
					process.kill(-wrapperPid, 0);
					return true;
				} catch {
					try {
						process.kill(wrapperPid, 0);
						return true;
					} catch {
						return false;
					}
				}
			};
			const waitForGroupExit = (timeoutMs: number): Promise<boolean> => new Promise(resolve => {
				const started = Date.now();
				const tick = () => {
					if (!processGroupAlive()) {
						resolve(true);
						return;
					}
					if (Date.now() - started >= timeoutMs) {
						resolve(false);
						return;
					}
					setTimeout(tick, 20);
				};
				tick();
			});

			const stopped = await terminateOwnedProcess({
				isExited: () => !processGroupAlive(),
				sendSignal: signal => {
					try {
						process.kill(-wrapperPid, signal);
						return true;
					} catch {
						try {
							process.kill(wrapperPid, signal);
							return true;
						} catch {
							return false;
						}
					}
				},
				waitForExit: timeoutMs => waitForGroupExit(timeoutMs),
			}, 400, 400);
			assert.strictEqual(stopped, true);
			assert.strictEqual(processGroupAlive(), false);

			try {
				process.kill(ready.grandchildPid, 0);
				assert.fail('grandchild must be gone after process-group kill');
			} catch {
				// expected
			}

			if (ready.port > 0) {
				await new Promise<void>((resolve, reject) => {
					const server = net.createServer();
					server.once('error', reject);
					server.listen(ready.port, '127.0.0.1', () => {
						server.close(err => err ? reject(err) : resolve());
					});
				});
			}
		} catch (error) {
			cleanup();
			throw error;
		}
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

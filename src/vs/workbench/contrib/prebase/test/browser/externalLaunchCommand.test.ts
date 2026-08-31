/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../../base/test/common/utils.js";
import assert from 'assert';
import { resolveExternalLaunchCommand, withElectronCdpLaunchArgs } from '../../../../../platform/prebaseDesktop/common/externalLaunchResolver.js';
import { buildElectronExternalLaunchRequest, buildPackageScriptExternalLaunchRequest, buildTauriExternalLaunchRequest, tauriLaunchCwd } from '../../common/runtime/externalLaunchCommand.js';

suite('externalLaunchCommand', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('builds strict package-manager argv without introducing shell parsing', () => {
		assert.deepStrictEqual(
			(['npm', 'pnpm', 'yarn', 'bun'] as const).map(packageManager => buildPackageScriptExternalLaunchRequest(packageManager, 'electron:dev')),
			[
				{ command: 'npm', args: ['run', 'electron:dev', '--'] },
				{ command: 'pnpm', args: ['run', 'electron:dev', '--'] },
				{ command: 'yarn', args: ['run', 'electron:dev'] },
				{ command: 'bun', args: ['run', 'electron:dev', '--'] },
			],
		);
	});

	test('retains an untrusted script name as one argv value instead of shell syntax', () => {
		const scriptName = 'dev; touch should-not-run';
		const request = buildPackageScriptExternalLaunchRequest('npm', scriptName);

		assert.deepStrictEqual(request, {
			command: 'npm',
			args: ['run', scriptName, '--'],
		});
		assert.strictEqual(request.args.includes('touch'), false);
	});

	test('resolves every supported package manager to the platform executable', () => {
		for (const packageManager of ['npm', 'pnpm', 'yarn', 'bun'] as const) {
			const request = buildPackageScriptExternalLaunchRequest(packageManager, 'desktop');
			assert.strictEqual(resolveExternalLaunchCommand(request, '/workspace/app', 'darwin'), packageManager);
			assert.strictEqual(
				resolveExternalLaunchCommand(request, 'C:\\workspace\\app', 'win32'),
				packageManager === 'bun' ? 'bun.exe' : `${packageManager}.cmd`,
			);
		}
	});

	test('rejects package-manager argv that bypasses declared scripts or adds arbitrary flags', () => {
		for (const command of ['npm', 'pnpm', 'bun'] as const) {
			assert.throws(() => resolveExternalLaunchCommand({ command, args: ['exec', 'electron'] }, '/app', 'darwin'));
			assert.throws(() => resolveExternalLaunchCommand({ command, args: ['run', 'desktop'] }, '/app', 'darwin'));
			assert.throws(() => resolveExternalLaunchCommand({ command, args: ['run', 'desktop', '--', '--inspect'] }, '/app', 'darwin'));
		}
		assert.throws(() => resolveExternalLaunchCommand({ command: 'yarn', args: ['desktop'] }, '/app', 'darwin'));
		assert.throws(() => resolveExternalLaunchCommand({ command: 'yarn', args: ['run', 'desktop', '--inspect'] }, '/app', 'darwin'));
		assert.throws(() => resolveExternalLaunchCommand({ command: 'npm', args: ['run', '../desktop', '--'] }, '/app', 'darwin'));
		assert.throws(() => resolveExternalLaunchCommand({ command: 'pnpm', args: ['run', 'apps/desktop', '--'] }, '/app', 'darwin'));
		assert.throws(() => resolveExternalLaunchCommand({ command: 'bun', args: ['run', 'desktop', '--', '--features', 'other'] }, '/app', 'darwin'));
	});

	test('places Electron CDP switches after the application entry', () => {
		assert.deepStrictEqual(
			withElectronCdpLaunchArgs('electron', ['main.js'], 9222),
			['main.js', '--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1'],
		);
		assert.deepStrictEqual(
			withElectronCdpLaunchArgs('npm', ['run', 'electron', '--'], 9222),
			['run', 'electron', '--', '--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1'],
		);
	});

	test('uses the logical Electron binary for a scriptless project main entry', () => {
		assert.deepStrictEqual(buildElectronExternalLaunchRequest('dist/main.js'), {
			command: 'electron',
			args: ['dist/main.js'],
		});
	});

	test('resolves scriptless Electron to the workspace-local binary without PATH lookup', () => {
		const request = buildElectronExternalLaunchRequest('dist/main.js');
		assert.strictEqual(
			resolveExternalLaunchCommand(request, '/workspace/app', 'darwin'),
			'/workspace/app/node_modules/.bin/electron',
		);
		assert.strictEqual(
			resolveExternalLaunchCommand(request, 'C:\\workspace\\app', 'win32'),
			'C:\\workspace\\app\\node_modules\\.bin\\electron.cmd',
		);
	});

	test('walks up from a nested app root to the workspace Electron binary', () => {
		const request = buildElectronExternalLaunchRequest('main.js');
		const exists = (path: string) => path === '/repo/node_modules/.bin/electron';
		assert.strictEqual(
			resolveExternalLaunchCommand(request, '/repo/test/prebase/fixtures/desktop-electron', 'darwin', exists),
			'/repo/node_modules/.bin/electron',
		);
	});

	test('walks up a nested Windows fixture cwd to electron.cmd without PATH lookup', () => {
		const request = buildElectronExternalLaunchRequest('main.js');
		const exists = (path: string) => path === 'C:\\repo\\node_modules\\.bin\\electron.cmd';
		assert.strictEqual(
			resolveExternalLaunchCommand(request, 'C:\\repo\\test\\prebase\\fixtures\\desktop-electron', 'win32', exists),
			'C:\\repo\\node_modules\\.bin\\electron.cmd',
		);
	});

	test('launches Tauri through a declared npm script or cargo without a shell', () => {
		assert.deepStrictEqual(buildTauriExternalLaunchRequest('tauri:dev'), {
			command: 'npm',
			args: ['run', 'tauri:dev', '--'],
		});
		assert.deepStrictEqual(buildTauriExternalLaunchRequest(), {
			command: 'cargo',
			args: ['tauri', 'dev'],
		});
		assert.deepStrictEqual(buildTauriExternalLaunchRequest(undefined, true), {
			command: 'cargo',
			args: ['tauri', 'dev', '--features', 'prebase-testing'],
		});
		assert.deepStrictEqual(buildTauriExternalLaunchRequest('tauri:dev', true), {
			command: 'npm',
			args: ['run', 'tauri:dev', '--', '--features', 'prebase-testing'],
		});
		assert.deepStrictEqual(buildTauriExternalLaunchRequest('tauri:dev', true, 'yarn'), {
			command: 'yarn',
			args: ['run', 'tauri:dev', '--', '--features', 'prebase-testing'],
		});
		assert.deepStrictEqual(buildTauriExternalLaunchRequest('tauri:dev', true, 'pnpm'), {
			command: 'pnpm',
			args: ['run', 'tauri:dev', '--', '--features', 'prebase-testing'],
		});
		assert.deepStrictEqual(buildTauriExternalLaunchRequest('tauri', true), {
			command: 'npm',
			args: ['run', 'tauri', '--', 'dev', '--features', 'prebase-testing'],
		});
		assert.deepStrictEqual(buildTauriExternalLaunchRequest('tauri'), {
			command: 'npm',
			args: ['run', 'tauri', '--', 'dev'],
		});
		assert.doesNotThrow(() => resolveExternalLaunchCommand(buildTauriExternalLaunchRequest('tauri:dev', true), '/workspace/app', 'darwin'));
		assert.strictEqual(tauriLaunchCwd('/workspace/app', 'src-tauri/Cargo.toml'), '/workspace/app/src-tauri');
		assert.strictEqual(tauriLaunchCwd('/workspace/app', '/abs/src-tauri/Cargo.toml'), '/abs/src-tauri');
		assert.throws(() => resolveExternalLaunchCommand({ command: 'cargo', args: ['tauri', 'dev', '--features', 'evil'] }, '/app', 'darwin'));
		assert.throws(() => resolveExternalLaunchCommand({ command: 'npm', args: ['run', 'tauri', '--', '--eval', '1'] }, '/app', 'darwin'));
		assert.doesNotThrow(() => resolveExternalLaunchCommand({ command: 'npm', args: ['run', 'tauri', '--', '--features', 'prebase-testing'] }, '/app', 'darwin'));
		assert.doesNotThrow(() => resolveExternalLaunchCommand({ command: 'npm', args: ['run', 'tauri', '--', 'dev', '--features', 'prebase-testing'] }, '/app', 'darwin'));
		assert.doesNotThrow(() => resolveExternalLaunchCommand({ command: 'yarn', args: ['run', 'tauri', '--', '--features', 'prebase-testing'] }, '/app', 'darwin'));
		assert.doesNotThrow(() => resolveExternalLaunchCommand({ command: 'yarn', args: ['run', 'tauri', '--features', 'prebase-testing'] }, '/app', 'darwin'));
		assert.throws(() => resolveExternalLaunchCommand({ command: 'electron', args: ['/tmp/evil.js'] }, '/app', 'darwin'));
		assert.throws(() => resolveExternalLaunchCommand({ command: 'cargo', args: ['tauri', 'dev', '--features', 'prebase-testing', '--release'] }, '/app', 'darwin'));
		assert.throws(() => resolveExternalLaunchCommand({ command: 'cargo', args: ['tauri', 'build'] }, '/app', 'darwin'));
		assert.throws(() => resolveExternalLaunchCommand({ command: 'cargo', args: ['tauri', 'dev', '--release'] }, '/app', 'darwin'));
		assert.strictEqual(
			resolveExternalLaunchCommand(buildTauriExternalLaunchRequest(), '/workspace/app', 'darwin'),
			'cargo',
		);
		assert.strictEqual(
			resolveExternalLaunchCommand(buildTauriExternalLaunchRequest(), 'C:\\workspace\\app', 'win32'),
			'cargo.exe',
		);
	});

	test('rejects arbitrary spawn commands and cargo verbs other than tauri dev', () => {
		assert.throws(() => resolveExternalLaunchCommand({ command: 'bash', args: ['-c', 'echo hi'] }, '/app', 'darwin'));
		assert.throws(() => resolveExternalLaunchCommand({ command: 'cargo', args: ['test'] }, '/app', 'darwin'));
		assert.throws(() => resolveExternalLaunchCommand({ command: 'electron', args: ['../evil.js'] }, '/app', 'darwin'));
	});
});

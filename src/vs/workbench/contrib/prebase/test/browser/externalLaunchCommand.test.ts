/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { resolveExternalLaunchCommand } from '../../../../../platform/prebaseDesktop/common/externalLaunchResolver.js';
import { buildElectronExternalLaunchRequest, buildNpmExternalLaunchRequest, buildTauriExternalLaunchRequest, tauriLaunchCwd } from '../../common/runtime/externalLaunchCommand.js';

suite('externalLaunchCommand', () => {
	test('builds an npm argv invocation that forwards Electron debugging arguments', () => {
		assert.deepStrictEqual(buildNpmExternalLaunchRequest('electron:dev'), {
			command: 'npm',
			args: ['run', 'electron:dev', '--'],
		});
	});

	test('retains an untrusted script name as one argv value instead of shell syntax', () => {
		const scriptName = 'dev; touch should-not-run';
		const request = buildNpmExternalLaunchRequest(scriptName);

		assert.deepStrictEqual(request, {
			command: 'npm',
			args: ['run', scriptName, '--'],
		});
		assert.strictEqual(request.args.includes('touch'), false);
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
		assert.doesNotThrow(() => resolveExternalLaunchCommand(buildTauriExternalLaunchRequest('tauri:dev', true), '/workspace/app', 'darwin'));
		assert.strictEqual(tauriLaunchCwd('/workspace/app', 'src-tauri/Cargo.toml'), '/workspace/app/src-tauri');
		assert.strictEqual(tauriLaunchCwd('/workspace/app', '/abs/src-tauri/Cargo.toml'), '/abs/src-tauri');
		assert.throws(() => resolveExternalLaunchCommand({ command: 'cargo', args: ['tauri', 'dev', '--features', 'evil'] }, '/app', 'darwin'));
		assert.throws(() => resolveExternalLaunchCommand({ command: 'npm', args: ['run', 'tauri', '--', '--eval', '1'] }, '/app', 'darwin'));
		assert.doesNotThrow(() => resolveExternalLaunchCommand({ command: 'npm', args: ['run', 'tauri', '--', '--features', 'prebase-testing'] }, '/app', 'darwin'));
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

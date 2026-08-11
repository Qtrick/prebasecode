/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { resolveExternalLaunchCommand } from '../../../../../platform/prebaseDesktop/common/externalLaunchResolver.js';
import { buildElectronExternalLaunchRequest, buildNpmExternalLaunchRequest } from '../../common/runtime/externalLaunchCommand.js';

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
});

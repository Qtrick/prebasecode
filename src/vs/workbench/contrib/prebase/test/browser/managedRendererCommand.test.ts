/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../../base/test/common/utils.js";
import assert from 'assert';
import { managedRendererDevCommand, scriptLaunchesElectronApp } from '../../common/runtime/managedRendererCommand.js';
import type { DetectedDevScript } from '../../common/runtime/types.js';

function script(partial: Partial<DetectedDevScript> & Pick<DetectedDevScript, 'scriptBody' | 'command'>): DetectedDevScript {
	return {
		label: 't',
		packageManager: 'npm',
		scriptName: 'dev',
		suggestedUrls: ['http://localhost:5173'],
		...partial,
	};
}

suite('managedRendererCommand', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('detects electron-vite as Electron launch', () => {
		assert.strictEqual(scriptLaunchesElectronApp('electron-vite dev'), true);
		assert.strictEqual(scriptLaunchesElectronApp('electron-vite --rendererOnly'), false);
		assert.strictEqual(scriptLaunchesElectronApp('vite'), false);
	});

	test('rewrites electron-vite to rendererOnly for managed mode', () => {
		const cmd = managedRendererDevCommand(script({
			command: 'npm run dev',
			scriptBody: 'electron-vite dev',
			packageManager: 'npm',
		}));
		assert.ok(cmd);
		assert.ok(cmd!.includes('--rendererOnly'));
		assert.ok(!scriptLaunchesElectronApp(cmd!));
	});

	test('leaves plain vite commands unchanged', () => {
		const cmd = managedRendererDevCommand(script({
			command: 'npm run dev',
			scriptBody: 'vite',
		}));
		assert.strictEqual(cmd, 'npm run dev');
	});
});

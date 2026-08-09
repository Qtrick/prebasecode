/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { classifyColorTheme } from '../prebaseThemeClassify.js';

suite('classifyColorTheme', () => {
	test('skips themes from test/colorize/fixture extensions (case-insensitive)', () => {
		assert.strictEqual(
			classifyColorTheme({ settingsId: 'Some Theme', extensionData: { extensionIsBuiltin: false, extensionName: 'vscode-theme-colorize-tests' } }),
			'skip'
		);
		assert.strictEqual(
			classifyColorTheme({ settingsId: 'X', extensionData: { extensionIsBuiltin: true, extensionName: 'MyFIXTURE Themes' } }),
			'skip'
		);
		assert.strictEqual(
			classifyColorTheme({ settingsId: 'Y', extensionData: { extensionIsBuiltin: false, extensionName: 'unit-Test-pack' } }),
			'skip'
		);
	});

	test('classifies PreBase Dark and Light as prebase even when marked builtin', () => {
		assert.strictEqual(
			classifyColorTheme({ settingsId: 'PreBase Dark', extensionData: { extensionIsBuiltin: true, extensionName: 'theme-defaults' } }),
			'prebase'
		);
		assert.strictEqual(
			classifyColorTheme({ settingsId: 'PreBase Light', extensionData: { extensionIsBuiltin: true, extensionName: 'theme-defaults' } }),
			'prebase'
		);
	});

	test('skip wins over PreBase settingsId when extension name matches fixture pattern', () => {
		assert.strictEqual(
			classifyColorTheme({ settingsId: 'PreBase Dark', extensionData: { extensionIsBuiltin: true, extensionName: 'fixture-themes' } }),
			'skip'
		);
	});

	test('classifies builtin extension themes as builtin', () => {
		assert.strictEqual(
			classifyColorTheme({ settingsId: 'Dark+', extensionData: { extensionIsBuiltin: true, extensionName: 'theme-defaults' } }),
			'builtin'
		);
	});

	test('classifies non-builtin and missing extensionData as extension', () => {
		assert.strictEqual(
			classifyColorTheme({ settingsId: 'Dracula', extensionData: { extensionIsBuiltin: false, extensionName: 'dracula-theme' } }),
			'extension'
		);
		assert.strictEqual(
			classifyColorTheme({ settingsId: 'Custom' }),
			'extension'
		);
	});

	test('empty extension name does not skip', () => {
		assert.strictEqual(
			classifyColorTheme({ settingsId: 'Dark+', extensionData: { extensionIsBuiltin: true, extensionName: '' } }),
			'builtin'
		);
	});
});

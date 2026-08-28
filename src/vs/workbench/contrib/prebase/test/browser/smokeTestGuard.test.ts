/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { requireSmokeTestDriver } from '../../common/smokeTestGuard.js';

suite('smokeTestGuard', () => {
	test('production execution cannot use smoke-only commands', () => {
		assert.throws(
			() => requireSmokeTestDriver(false, 'prebase.test.getDiagnostics'),
			/prebase.test.getDiagnostics requires --enable-smoke-test-driver/,
		);
		assert.throws(
			() => requireSmokeTestDriver(undefined, 'prebase.test.invokeLanguageModelTool'),
			/prebase.test.invokeLanguageModelTool requires --enable-smoke-test-driver/,
		);
	});

	test('smoke-test driver may invoke guarded commands', () => {
		assert.doesNotThrow(() => requireSmokeTestDriver(true, 'prebase.test.getDiagnostics'));
		assert.doesNotThrow(() => requireSmokeTestDriver(true, 'prebase.test.installMagnusSmokeTransport'));
	});

	test('installMagnusSmokeTransport is blocked without the smoke-test driver', () => {
		assert.throws(
			() => requireSmokeTestDriver(false, 'prebase.test.installMagnusSmokeTransport'),
			/prebase.test.installMagnusSmokeTransport requires --enable-smoke-test-driver/,
		);
	});

	test('getDiagnostics is production-gated and reads parser/temporal counters from live services', () => {
		const source = readFileSync(resolve('src/vs/workbench/contrib/prebase/browser/prebase.contribution.ts'), 'utf8');
		const start = source.indexOf("id: 'prebase.test.getDiagnostics'");
		const end = source.indexOf("id: 'prebase.test.installMagnusSmokeTransport'");
		const diagnostics = source.slice(start, end);
		assert.match(diagnostics, /f1: false/);
		assert.match(diagnostics, /requireSmokeTestDriver\([^,]+, 'prebase.test.getDiagnostics'\)/);
		assert.ok(
			diagnostics.indexOf("requireSmokeTestDriver") < diagnostics.indexOf('getActiveRequestCount()'),
			'parserActiveRequests must not be readable without the smoke-test driver',
		);
		assert.ok(
			diagnostics.indexOf("requireSmokeTestDriver") < diagnostics.indexOf('getActiveWriteCount()'),
			'temporalActiveWrites must not be readable without the smoke-test driver',
		);
		assert.match(diagnostics, /getActiveRequestCount\(\)/);
		assert.match(diagnostics, /getActiveWriteCount\(\)/);
		assert.match(diagnostics, /if \(applyId \|\| typeof zoom === 'number'\) \{\s*return result;/);
		assert.match(diagnostics, /colorTheme: theme\.settingsId/);
		assert.match(diagnostics, /colorThemeType: theme\.type/);
		assert.match(diagnostics, /zoomLevel: getZoomLevel\(mainWindow\)/);
		assert.match(diagnostics, /new Set\(\['PreBase Dark', 'PreBase Light', 'Default High Contrast', 'Default High Contrast Light', 'Dark Modern', 'Light Modern'\]\)/);
		assert.match(diagnostics, /const themeService = accessor\.get\(IWorkbenchThemeService\)/);
		assert.match(diagnostics, /await themeService\.setColorTheme\(match\.id, 'auto'\)/);
		assert.ok(diagnostics.indexOf('const themeService = accessor.get') < diagnostics.indexOf('await themeService.getColorThemes'), 'Action2 accessor must be captured before await');
		assert.match(diagnostics, /setZoomLevel\(zoom, mainWindow\)/);
		assert.match(diagnostics, /getColorThemes\(\)/);
		assert.doesNotMatch(diagnostics, /await accessor\.get\(/);
		assert.doesNotMatch(diagnostics, /await accessor\.get\(IConfigurationService\)\.updateValue\('workbench\.colorTheme'/);
		assert.equal((diagnostics.match(/allowedThemes\.has\(applyId\)/g) || []).length, 1, 'unknown theme ids must not reach colorTheme writes');
		assert.doesNotMatch(diagnostics, /vs-dark|hc-black|hc-light/);
		assert.doesNotMatch(diagnostics, /Monokai|Solarized|Tomorrow Night/);

		const smokeDriver = source.slice(source.indexOf("id: 'prebase.test.isSmokeDriver'"), start);
		assert.match(smokeDriver, /f1: false/);

		const install = source.slice(source.indexOf("id: 'prebase.test.installMagnusSmokeTransport'"));
		assert.match(install, /f1: false/);
		assert.match(install, /requireSmokeTestDriver\([^,]+, 'prebase.test.installMagnusSmokeTransport'\)/);
		assert.match(install, /executeCommand\('prebase\.magnus\.installSmokeTransport'\)/);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../../base/test/common/utils.js";
import assert from 'assert';
import { detectElectronProject } from '../../common/runtime/electronDetector.js';
import type { PackageJsonShape, ProjectProbe } from '../../common/runtime/types.js';

function probe(overrides: {
	exists?: (path: string) => boolean;
	packageJson?: PackageJsonShape;
	rootLabel?: string;
} = {}): ProjectProbe {
	const files = new Set<string>();
	return {
		exists: (path: string) => overrides.exists?.(path) ?? files.has(path),
		packageJson: overrides.packageJson,
		rootLabel: overrides.rootLabel ?? 'app',
	};
}

suite('electronDetector', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('detects direct electron dependency with main entry', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { electron: '^30.0.0' },
				main: 'electron/main.js',
				scripts: { dev: 'electron-vite dev' },
			},
			exists: path => path === 'electron/main.js',
		}));
		assert.strictEqual(profile.framework, 'electron');
		assert.strictEqual(profile.confidence, 'high');
		assert.ok(profile.capabilities.supportsManagedLaunch);
	});

	test('owns the package manager detected at the Electron app root', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { electron: '^30.0.0' },
				main: 'main.js',
				scripts: { desktop: 'electron .' },
			},
			exists: path => path === 'main.js' || path === 'pnpm-lock.yaml',
		}));

		assert.deepStrictEqual({
			confidence: profile.confidence,
			script: profile.electronScriptName,
			packageManager: profile.packageManager,
		}, {
			confidence: 'high',
			script: 'desktop',
			packageManager: 'pnpm',
		});
	});

	test('rejects web-only vite react without direct electron dependency', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { vite: '^5.0.0', react: '^18.0.0' },
				scripts: { dev: 'vite' },
			},
			exists: path => path === 'vite.config.ts',
		}));
		assert.strictEqual(profile.framework, 'electron');
		assert.strictEqual(profile.confidence, 'none');
	});

	test('rejects script-only electron mention without direct dependency', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				scripts: { dev: 'concurrently "vite" "electron ."' },
			},
		}));
		assert.strictEqual(profile.framework, 'electron');
		assert.strictEqual(profile.confidence, 'low');
	});

	test('detects electron-builder config with direct dependency', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { electron: '^29.0.0' },
				scripts: { start: 'electron .' },
			},
			exists: path => path === 'electron-builder.yml',
		}));
		assert.strictEqual(profile.framework, 'electron');
		assert.ok(profile.capabilities.supportsExternalLaunch);
	});

	test('does not treat transitive tooling as electron without direct dep', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { '@storybook/react': '^8.0.0' },
				scripts: { storybook: 'storybook dev -p 6006' },
			},
		}));
		assert.strictEqual(profile.confidence, 'none');
	});

	test('managed launch advertises main/preload limitations', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { electron: '^30.0.0', vite: '^5.0.0' },
				scripts: { dev: 'electron-vite dev' },
			},
			exists: path => path === 'electron/preload.ts' || path === 'vite.config.ts',
		}));
		assert.strictEqual(profile.capabilities.supportsManagedLaunch, true);
		assert.ok(profile.capabilities.limitations.some(l => l.includes('main-process code and preload are not executed')));
		assert.strictEqual(profile.capabilities.requiresPreload, true);
	});

	test('blocks managed launch for a static renderer while retaining an honest external launch', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { electron: '^30.0.0' },
				main: 'electron/main.js',
				scripts: { start: 'electron .' },
			},
			exists: path => path === 'electron/main.js' || path === 'index.html',
		}));

		assert.deepStrictEqual({
			framework: profile.framework,
			confidence: profile.confidence,
			renderer: profile.paths.renderer,
			managed: profile.capabilities.supportsManagedLaunch,
			external: profile.capabilities.supportsExternalLaunch,
			mainProcess: profile.capabilities.requiresMainProcess,
			screenshots: profile.capabilities.supportsScreenshots,
			blockers: profile.capabilities.managedLaunchBlockers,
		}, {
			framework: 'electron',
			confidence: 'high',
			renderer: 'index.html',
			managed: false,
			external: true,
			mainProcess: true,
			screenshots: true,
			blockers: ['No renderer dev server was detected for managed launch.'],
		});
	});

	test('infers Vite renderer and desktop inspection capabilities without claiming managed main-process execution', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { electron: '^30.0.0', vite: '^5.0.0' },
				main: 'main.js',
				scripts: { start: 'electron .' },
			},
			exists: path => path === 'main.js' || path === 'vite.config.ts',
		}));

		assert.deepStrictEqual({
			rendererUrlHint: profile.rendererUrlHint,
			likelyDevPort: profile.likelyDevPort,
			managed: profile.capabilities.supportsManagedLaunch,
			external: profile.capabilities.supportsExternalLaunch,
			cdp: profile.capabilities.supportsCdpAttach,
			inspection: profile.capabilities.supportsDOMInspection,
			console: profile.capabilities.supportsConsoleCapture,
			network: profile.capabilities.supportsNetworkCapture,
			screenshots: profile.capabilities.supportsScreenshots,
			input: profile.capabilities.supportsInputAutomation,
			semantic: profile.capabilities.supportsSemanticLocators,
			nativeDialogs: profile.capabilities.supportsNativeDialogAutomation,
			mainProcessAccess: profile.capabilities.supportsMainProcessAccess,
			backendApi: profile.capabilities.supportsBackendApiAccess,
		}, {
			rendererUrlHint: 'http://localhost:5173',
			likelyDevPort: 5173,
			managed: true,
			external: true,
			cdp: true,
			inspection: true,
			console: true,
			network: false,
			screenshots: true,
			input: true,
			semantic: true,
			nativeDialogs: false,
			mainProcessAccess: false,
			backendApi: false,
		});
		assert.ok(profile.capabilities.limitations.some(l => l.includes('main-process code and preload are not executed')));
		assert.ok(profile.capabilities.limitations.some(l => l.includes('project main process are not controllable')));
	});

	test('does not advertise input automation when the project is not launchable', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { electron: '^30.0.0' },
			},
		}));
		assert.strictEqual(profile.confidence, 'medium');
		assert.strictEqual(profile.capabilities.supportsManagedLaunch, false);
		assert.strictEqual(profile.capabilities.supportsExternalLaunch, false);
		assert.strictEqual(profile.capabilities.supportsInputAutomation, false);
		assert.strictEqual(profile.capabilities.supportsSemanticLocators, false);
		assert.strictEqual(profile.capabilities.supportsNativeDialogAutomation, false);
		assert.strictEqual(profile.capabilities.fullNativeSetupRequired, false);
	});

	test('keeps native dialogs false even when full-app launch is available', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { electron: '^30.0.0' },
				main: 'main.js',
				scripts: { start: 'electron .' },
			},
			exists: path => path === 'main.js',
		}));
		assert.strictEqual(profile.capabilities.supportsExternalLaunch, true);
		assert.strictEqual(profile.capabilities.supportsInputAutomation, true);
		assert.strictEqual(profile.capabilities.supportsNativeDialogAutomation, false);
		assert.strictEqual(profile.capabilities.supportsMainProcessAccess, false);
		assert.strictEqual(profile.capabilities.fullNativeSetupRequired, false);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { detectTauriProject, TAURI_PROBE_PATHS, TAURI_TESTING_PROBE_PATHS } from '../../common/runtime/tauriDetector.js';
import { detectDesktopProjects, selectDesktopProfile } from '../../common/runtime/desktopDetector.js';
import { detectElectronProject } from '../../common/runtime/electronDetector.js';
import { desktopLaunchFromUiMode, desktopUiModeFromLaunch, isElectronProfile, isRecognizedDesktopApp, isTauriProfile } from '../../common/runtime/desktopTypes.js';
import { detectDevScripts } from '../../common/runtime/scriptDetector.js';
import type { PackageJsonShape, ProjectProbe } from '../../common/runtime/types.js';

function probe(overrides: {
	exists?: (path: string) => boolean;
	files?: Record<string, string>;
	packageJson?: PackageJsonShape;
	rootLabel?: string;
	rootPath?: string;
} = {}): ProjectProbe {
	const files = { ...(overrides.files ?? {}) };
	return {
		exists: path => overrides.exists?.(path) ?? (Object.prototype.hasOwnProperty.call(files, path) || path in files),
		readText: path => files[path],
		packageJson: overrides.packageJson,
		rootLabel: overrides.rootLabel ?? 'app',
		rootPath: overrides.rootPath,
	};
}

suite('tauriDetector', () => {
	test('high confidence requires Tauri config and Cargo tauri crate', () => {
		const profile = detectTauriProject(probe({
			files: {
				'src-tauri/tauri.conf.json': '{"productName":"Demo","build":{"devUrl":"http://localhost:1420"},"identifier":"com.demo.app"}',
				'src-tauri/Cargo.toml': '[package]\nname="demo"\n[dependencies]\ntauri = "2"\n',
			},
			packageJson: {
				devDependencies: { '@tauri-apps/cli': '^2.0.0' },
				scripts: { tauri: 'tauri' },
			},
		}));
		assert.strictEqual(profile.framework, 'tauri');
		assert.strictEqual(profile.confidence, 'high');
		assert.strictEqual(profile.capabilities.supportsRendererAutomation, true);
		assert.strictEqual(profile.capabilities.supportsFullNativeAutomation, false);
		assert.strictEqual(profile.capabilities.fullNativeSetupRequired, true);
		assert.ok(profile.capabilities.fullNativeSetupReason?.includes('WebDriver'));
	});

	test('full-native automation stays setup-required until Cargo, feature, Rust registration, and ACL are all present', () => {
		const profile = detectTauriProject(probe({
			files: {
				'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:5173"}}',
				'src-tauri/Cargo.toml': '[package]\nname="demo"\n[dependencies]\ntauri="2"\ntauri-plugin-wdio-webdriver="1"\n',
			},
		}));
		assert.deepStrictEqual({
			confidence: profile.confidence,
			webDriverPlugin: profile.hasWdioWebdriverPlugin,
			renderer: profile.capabilities.supportsRendererAutomation,
			fullNativeUi: profile.capabilities.supportsFullNativeAutomation,
			backendApi: profile.capabilities.supportsBackendApiAccess,
			setupRequired: profile.capabilities.fullNativeSetupRequired,
			ready: profile.testingSetup.ready,
		}, {
			confidence: 'high',
			webDriverPlugin: true,
			renderer: true,
			fullNativeUi: false,
			backendApi: false,
			setupRequired: true,
			ready: false,
		});
	});

	test('a prebase-testing feature that omits the WebDriver crate is not full-native ready', () => {
		const profile = detectTauriProject(probe({
			files: {
				'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:5173"}}',
				'src-tauri/Cargo.toml': '[package]\nname="demo"\n[features]\nprebase-testing=[]\n[dependencies]\ntauri="2"\ntauri-plugin-wdio-webdriver={version="1",optional=true}\n',
				'src-tauri/src/lib.rs': 'builder.plugin(tauri_plugin_wdio_webdriver::init());\n',
				'src-tauri/capabilities/default.json': '{"permissions":["wdio-webdriver:default"]}',
			},
		}));
		assert.deepStrictEqual({
			dependencyPresent: profile.testingSetup.dependencyPresent,
			featurePresent: profile.testingSetup.featurePresent,
			featureIncludesDriver: profile.testingSetup.featureIncludesDriver,
			pluginRegistered: profile.testingSetup.pluginRegistered,
			pluginGuarded: profile.testingSetup.pluginGuarded,
			permissionPresent: profile.testingSetup.permissionPresent,
			ready: profile.testingSetup.ready,
			fullNative: profile.capabilities.supportsFullNativeAutomation,
			setupRequired: profile.capabilities.fullNativeSetupRequired,
		}, {
			dependencyPresent: true,
			featurePresent: true,
			featureIncludesDriver: false,
			pluginRegistered: true,
			pluginGuarded: false,
			permissionPresent: true,
			ready: false,
			fullNative: false,
			setupRequired: true,
		});
	});

	test('full-native automation is ready only for a complete debug WebDriver setup', () => {
		const profile = detectTauriProject(probe({
			files: {
				'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:5173"}}',
				'src-tauri/Cargo.toml': '[package]\nname="demo"\n[features]\nprebase-testing=["dep:tauri-plugin-wdio-webdriver"]\n[dependencies]\ntauri="2"\ntauri-plugin-wdio-webdriver={version="1",optional=true}\n',
				'src-tauri/src/lib.rs': 'let mut builder = tauri::Builder::default();\n#[cfg(all(debug_assertions, feature = "prebase-testing"))]\n{\nbuilder = builder.plugin(tauri_plugin_wdio_webdriver::init());\n}\n',
				'src-tauri/capabilities/default.json': '{"permissions":["wdio-webdriver:default"]}',
			},
		}));
		assert.strictEqual(profile.testingSetup.ready, true);
		assert.strictEqual(profile.testingSetup.pluginGuarded, true);
		assert.strictEqual(profile.capabilities.supportsFullNativeAutomation, true);
		assert.strictEqual(profile.capabilities.fullNativeSetupRequired, false);
		assert.strictEqual(profile.capabilities.supportsBackendApiAccess, false);
		assert.strictEqual(profile.capabilities.supportsMainProcessAccess, false);
	});

	test('unguarded WebDriver registration is never full-native ready', () => {
		const profile = detectTauriProject(probe({
			files: {
				'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:5173"}}',
				'src-tauri/Cargo.toml': '[package]\nname="demo"\n[features]\nprebase-testing=["dep:tauri-plugin-wdio-webdriver"]\n[dependencies]\ntauri="2"\ntauri-plugin-wdio-webdriver={version="1",optional=true}\n',
				'src-tauri/src/lib.rs': 'let mut builder = tauri::Builder::default();\nbuilder.plugin(tauri_plugin_wdio_webdriver::init());\n',
				'src-tauri/capabilities/default.json': '{"permissions":["wdio-webdriver:default"]}',
			},
		}));
		assert.strictEqual(profile.testingSetup.pluginPresent, true);
		assert.strictEqual(profile.testingSetup.pluginGuarded, false);
		assert.strictEqual(profile.testingSetup.ready, false);
		assert.strictEqual(profile.capabilities.supportsFullNativeAutomation, false);
		assert.strictEqual(profile.capabilities.fullNativeSetupRequired, true);
	});

	test('rejects a random Cargo.toml without a tauri crate', () => {
		const profile = detectTauriProject(probe({
			files: {
				'Cargo.toml': '[package]\nname="cli"\n[dependencies]\nserde = "1"\n',
			},
		}));
		assert.strictEqual(profile.confidence, 'none');
		assert.strictEqual(profile.label, 'Not Tauri');
		assert.ok(profile.reasons.some(reason => reason.includes('without a tauri crate')));
	});

	test('api-only dependency is low confidence and not launchable', () => {
		const profile = detectTauriProject(probe({
			packageJson: { dependencies: { '@tauri-apps/api': '^2.0.0' } },
		}));
		assert.strictEqual(profile.confidence, 'low');
		assert.strictEqual(profile.capabilities.supportsExternalLaunch, false);
	});

	test('medium confidence from src-tauri plus CLI script', () => {
		const profile = detectTauriProject(probe({
			files: { 'src-tauri': '', 'src-tauri/tauri.conf.json5': '{ devUrl: "http://localhost:5173" }' },
			packageJson: {
				devDependencies: { '@tauri-apps/cli': '^2.0.0' },
				scripts: { 'tauri:dev': 'tauri dev' },
			},
		}));
		assert.strictEqual(profile.confidence, 'medium');
		assert.strictEqual(profile.tauriScriptName, 'tauri:dev');
	});

	test('owns the package manager detected at the Tauri app root', () => {
		const profile = detectTauriProject(probe({
			files: {
				'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:1420"}}',
				'src-tauri/Cargo.toml': '[package]\nname="demo"\n[dependencies]\ntauri="2"\n',
				'bun.lock': '',
			},
			packageJson: {
				devDependencies: { '@tauri-apps/cli': '^2.0.0' },
				scripts: { 'tauri:dev': 'tauri dev' },
			},
		}));

		assert.deepStrictEqual({
			confidence: profile.confidence,
			script: profile.tauriScriptName,
			packageManager: profile.packageManager,
		}, {
			confidence: 'high',
			script: 'tauri:dev',
			packageManager: 'bun',
		});
	});

	test('nested monorepo app owns its package, lockfile, and absolute app root', () => {
		const profile = detectTauriProject(probe({
			rootLabel: 'repo',
			rootPath: '/repo',
			files: {
				'yarn.lock': '',
				'apps/desktop/package.json': JSON.stringify({
					devDependencies: { '@tauri-apps/cli': '^2.0.0' },
					scripts: { 'tauri:dev': 'tauri dev' },
				}),
				'apps/desktop/pnpm-lock.yaml': '',
				'apps/desktop/src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:1420"}}',
				'apps/desktop/src-tauri/Cargo.toml': '[package]\nname="desktop"\n[dependencies]\ntauri="2"\n',
			},
			packageJson: {
				devDependencies: { '@tauri-apps/cli': '^2.0.0' },
				scripts: { tauri: 'tauri' },
			},
		}));

		assert.deepStrictEqual({
			confidence: profile.confidence,
			appRoot: profile.appRoot,
			packageManager: profile.packageManager,
			script: profile.tauriScriptName,
			configPath: profile.configPath,
			cargoPath: profile.cargoTomlPath,
		}, {
			confidence: 'high',
			appRoot: '/repo/apps/desktop',
			packageManager: 'pnpm',
			script: 'tauri:dev',
			configPath: 'src-tauri/tauri.conf.json',
			cargoPath: 'src-tauri/Cargo.toml',
		});
	});

	test('rust-only Tauri project without package.json still detects', () => {
		const profile = detectTauriProject(probe({
			files: {
				'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:1420"}}',
				'src-tauri/Cargo.toml': '[package]\nname="demo"\n[dependencies]\ntauri={version="2"}\n',
			},
		}));
		assert.strictEqual(profile.confidence, 'high');
		assert.strictEqual(profile.isRustOnly, true);
		assert.strictEqual(profile.capabilities.supportsRendererAutomation, true);
	});

	test('rust-only Tauri without a configured frontend does not invent renderer mode', () => {
		const profile = detectTauriProject(probe({
			files: {
				'src-tauri/tauri.conf.json': '{"build":{"frontendDist":"../dist"},"identifier":"com.demo.rust"}',
				'src-tauri/Cargo.toml': '[package]\nname="demo"\n[dependencies]\ntauri={version="2"}\n',
			},
		}));
		assert.strictEqual(profile.confidence, 'high');
		assert.strictEqual(profile.isRustOnly, true);
		assert.strictEqual(profile.rendererUrlHint, undefined);
		assert.strictEqual(profile.capabilities.supportsRendererAutomation, false);
		assert.strictEqual(profile.capabilities.supportsManagedLaunch, false);
		assert.strictEqual(profile.capabilities.supportsInputAutomation, false);
		assert.ok(profile.capabilities.managedLaunchBlockers.some(item => item.includes('frontend')));
	});

	test('ignores a Cargo.toml that only mentions tauri in comments or the package name', () => {
		const profile = detectTauriProject(probe({
			files: {
				'Cargo.toml': [
					'[package]',
					'name = "tauri"',
					'[dependencies]',
					'serde = "1"',
					'# tauri = "2"',
					'[[bin]]',
					'name = "tauri"',
				].join('\n'),
			},
		}));
		assert.strictEqual(profile.confidence, 'none');
		assert.strictEqual(profile.label, 'Not Tauri');
		assert.strictEqual(isRecognizedDesktopApp(profile), false);
		assert.ok(profile.reasons.some(reason => reason.includes('without a tauri crate')));
	});

	test('advertises the honest Tauri capability matrix when WebDriver setup is still required', () => {
		const profile = detectTauriProject(probe({
			files: {
				'src-tauri/tauri.conf.json': '{"productName":"Demo","build":{"devUrl":"http://localhost:1420"},"identifier":"com.demo.app"}',
				'src-tauri/Cargo.toml': '[package]\nname="demo"\n[dependencies]\ntauri = "2"\n',
			},
		}));
		assert.strictEqual(isTauriProfile(profile), true);
		assert.strictEqual(isElectronProfile(profile), false);
		assert.deepStrictEqual({
			framework: profile.framework,
			confidence: profile.confidence,
			cdp: profile.capabilities.supportsCdpAttach,
			network: profile.capabilities.supportsNetworkCapture,
			nativeDialogs: profile.capabilities.supportsNativeDialogAutomation,
			input: profile.capabilities.supportsInputAutomation,
			semantic: profile.capabilities.supportsSemanticLocators,
			renderer: profile.capabilities.supportsRendererAutomation,
			rendererConsole: profile.capabilities.supportsConsoleCapture,
			fullNative: profile.capabilities.supportsFullNativeAutomation,
			backendApi: profile.capabilities.supportsBackendApiAccess,
			setupRequired: profile.capabilities.fullNativeSetupRequired,
			mainProcess: profile.capabilities.requiresMainProcess,
			preload: profile.capabilities.requiresPreload,
		}, {
			framework: 'tauri',
			confidence: 'high',
			cdp: false,
			network: false,
			nativeDialogs: false,
			input: true,
			semantic: true,
			renderer: true,
			rendererConsole: true,
			fullNative: false,
			backendApi: false,
			setupRequired: true,
			mainProcess: true,
			preload: false,
		});
		assert.ok(profile.capabilities.fullNativeSetupReason?.includes('WebDriver'));
		assert.ok(profile.capabilities.limitations.some(item => item.includes('invoke()')));
	});

	test('does not treat tauri-plugin-shell or a comment-only crate as Tauri', () => {
		const pluginOnly = detectTauriProject(probe({
			files: {
				'Cargo.toml': '[package]\nname="cli"\n[dependencies]\ntauri-plugin-shell = "2"\n',
			},
		}));
		assert.strictEqual(pluginOnly.confidence, 'none');
		assert.strictEqual(isRecognizedDesktopApp(pluginOnly), false);

		const wdioWithoutWebdriver = detectTauriProject(probe({
			files: {
				'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:1420"}}',
				'src-tauri/Cargo.toml': '[package]\nname="demo"\n[dependencies]\ntauri="2"\ntauri-plugin-wdio="1"\n',
			},
		}));
		assert.strictEqual(wdioWithoutWebdriver.confidence, 'high');
		assert.strictEqual(wdioWithoutWebdriver.hasWdioPlugin, true);
		assert.strictEqual(wdioWithoutWebdriver.hasWdioWebdriverPlugin, false);
		assert.strictEqual(wdioWithoutWebdriver.capabilities.supportsFullNativeAutomation, false);
		assert.strictEqual(wdioWithoutWebdriver.capabilities.fullNativeSetupRequired, true);
	});

	test('accepts tauri-build as a Cargo tauri crate and surfaces tauri:dev scripts', () => {
		const profile = detectTauriProject(probe({
			files: {
				'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:1420"}}',
				'src-tauri/Cargo.toml': '[package]\nname="demo"\n[build-dependencies]\ntauri-build = "2"\n',
			},
		}));
		assert.strictEqual(profile.confidence, 'high');
		const scripts = detectDevScripts(probe({
			packageJson: { scripts: { 'tauri:dev': 'tauri dev', build: 'vite build' } },
		}));
		assert.ok(scripts.some(script => script.scriptName === 'tauri:dev'));
		assert.ok(!scripts.some(script => script.scriptName === 'build'));
	});
});

suite('desktopDetector', () => {
	test('keeps Electron detection unchanged for a typical electron-vite app', () => {
		const electron = detectElectronProject(probe({
			packageJson: {
				devDependencies: { electron: '^30.0.0', vite: '^5.0.0' },
				main: 'electron/main.js',
				scripts: { dev: 'electron-vite dev' },
			},
			files: { 'electron/main.js': '', 'vite.config.ts': '' },
		}));
		assert.strictEqual(electron.framework, 'electron');
		assert.strictEqual(electron.confidence, 'high');
		assert.strictEqual(electron.capabilities.supportsInputAutomation, true);
		assert.strictEqual(electron.capabilities.supportsNativeDialogAutomation, false);
		const projects = detectDesktopProjects(probe({
			packageJson: electron && {
				devDependencies: { electron: '^30.0.0', vite: '^5.0.0' },
				main: 'electron/main.js',
				scripts: { dev: 'electron-vite dev' },
			},
			files: { 'electron/main.js': '', 'vite.config.ts': '' },
		}));
		assert.deepStrictEqual(projects.map(item => item.framework), ['electron']);
	});

	test('reports both frameworks at the same app root instead of picking silently', () => {
		const projects = detectDesktopProjects(probe({
			packageJson: {
				devDependencies: { electron: '^30.0.0', '@tauri-apps/cli': '^2.0.0' },
				main: 'electron/main.js',
				scripts: { electron: 'electron .', tauri: 'tauri' },
			},
			files: {
				'electron/main.js': '',
				'src-tauri/tauri.conf.json': '{"build":{"devUrl":"http://localhost:1420"}}',
				'src-tauri/Cargo.toml': '[package]\nname="demo"\n[dependencies]\ntauri="2"\n',
			},
		}));
		assert.deepStrictEqual(projects.map(item => item.framework).sort(), ['electron', 'tauri']);
		assert.strictEqual(selectDesktopProfile(projects, 'tauri')?.framework, 'tauri');
		assert.strictEqual(selectDesktopProfile(projects, 'electron')?.framework, 'electron');
	});

	test('does not invent a third desktop framework', () => {
		const projects = detectDesktopProjects(probe({
			packageJson: { dependencies: { flutter: '1.0.0', qt: '1.0.0' } },
		}));
		assert.deepStrictEqual(projects, []);
	});

	test('falls back when the preferred framework is absent and prefers higher confidence', () => {
		const electron = detectElectronProject(probe({
			packageJson: {
				devDependencies: { electron: '^30.0.0' },
				main: 'electron/main.js',
			},
			files: { 'electron/main.js': '' },
		}));
		const tauri = detectTauriProject(probe({
			files: {
				'src-tauri': '',
				'src-tauri/tauri.conf.json5': '{ devUrl: "http://localhost:5173" }',
			},
			packageJson: {
				devDependencies: { '@tauri-apps/cli': '^2.0.0' },
				scripts: { 'tauri:dev': 'tauri dev' },
			},
		}));
		assert.strictEqual(electron.confidence, 'high');
		assert.strictEqual(tauri.confidence, 'medium');
		const projects = [electron, tauri];
		assert.strictEqual(selectDesktopProfile(projects)?.framework, 'electron');
		assert.strictEqual(selectDesktopProfile([electron], 'tauri')?.framework, 'electron');
		assert.strictEqual(selectDesktopProfile([], 'electron'), undefined);
		assert.strictEqual(desktopUiModeFromLaunch('external'), 'fullApp');
		assert.strictEqual(desktopLaunchFromUiMode('renderer'), 'managed');
	});
});

function findRepoRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 12; i++) {
		if (existsSync(join(dir, 'test/prebase/fixtures/desktop-tauri/package.json'))) {
			return dir;
		}
		dir = join(dir, '..');
	}
	throw new Error('Could not locate PreBase repository root from tauriDetector tests.');
}

function fsProbe(appRoot: string): ProjectProbe {
	return {
		exists: relativePath => existsSync(join(appRoot, relativePath)),
		readText: relativePath => {
			const fullPath = join(appRoot, relativePath);
			return existsSync(fullPath) && statSync(fullPath).isFile() ? readFileSync(fullPath, 'utf8') : undefined;
		},
		packageJson: existsSync(join(appRoot, 'package.json'))
			? JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as PackageJsonShape
			: undefined,
		rootLabel: appRoot,
	};
}

suite('desktopFixtures', () => {
	test('detects the committed Electron and Tauri fixtures with discriminated profiles', () => {
		const root = findRepoRoot();
		const electron = detectElectronProject(fsProbe(join(root, 'test/prebase/fixtures/desktop-electron')));
		const tauri = detectTauriProject(fsProbe(join(root, 'test/prebase/fixtures/desktop-tauri')));
		const tauriPlain = detectTauriProject(fsProbe(join(root, 'test/prebase/fixtures/desktop-tauri-plain')));
		const tauriRustOnly = detectTauriProject(fsProbe(join(root, 'test/prebase/fixtures/desktop-tauri-rust-only')));

		assert.strictEqual(isElectronProfile(electron), true);
		assert.strictEqual(isTauriProfile(electron), false);
		assert.strictEqual(electron.confidence, 'high');
		assert.strictEqual(electron.paths.main, 'main.js');
		assert.strictEqual(electron.capabilities.supportsInputAutomation, true);
		assert.strictEqual(electron.capabilities.supportsNativeDialogAutomation, false);
		assert.strictEqual(electron.capabilities.fullNativeSetupRequired, false);

		assert.strictEqual(isTauriProfile(tauri), true);
		assert.strictEqual(isElectronProfile(tauri), false);
		assert.strictEqual(tauri.confidence, 'high');
		assert.strictEqual(tauri.hasWdioWebdriverPlugin, true);
		assert.strictEqual(tauri.testingCargoFeature, true);
		assert.strictEqual(tauri.testingSetup.ready, true);
		assert.ok(TAURI_TESTING_PROBE_PATHS.includes('src-tauri/src/lib.rs'));
		assert.ok(TAURI_PROBE_PATHS.includes('src-tauri/src/lib.rs'));
		const workbenchStyleFiles = new Map<string, string>();
		for (const relative of ['package.json', ...TAURI_PROBE_PATHS]) {
			const fullPath = join(root, 'test/prebase/fixtures/desktop-tauri', relative);
			if (existsSync(fullPath) && statSync(fullPath).isFile()) {
				workbenchStyleFiles.set(relative, readFileSync(fullPath, 'utf8'));
			}
		}
		const workbenchStyle = detectTauriProject({
			exists: relative => workbenchStyleFiles.has(relative),
			readText: relative => workbenchStyleFiles.get(relative),
			packageJson: JSON.parse(workbenchStyleFiles.get('package.json') ?? '{}') as PackageJsonShape,
			rootLabel: 'desktop-tauri',
		});
		assert.strictEqual(workbenchStyle.testingSetup.ready, true, 'Workbench preload must read guarded lib.rs and the WebDriver capability');
		const jsonOnly = detectTauriProject({
			exists: relative => workbenchStyleFiles.has(relative) && !relative.endsWith('.rs'),
			readText: relative => relative.endsWith('.rs') ? undefined : workbenchStyleFiles.get(relative),
			packageJson: JSON.parse(workbenchStyleFiles.get('package.json') ?? '{}') as PackageJsonShape,
			rootLabel: 'desktop-tauri',
		});
		assert.strictEqual(jsonOnly.testingSetup.ready, false);
		assert.strictEqual(jsonOnly.testingSetup.pluginGuarded, false);
		assert.strictEqual(tauri.capabilities.fullNativeSetupRequired, false);
		assert.strictEqual(tauri.capabilities.supportsFullNativeAutomation, true);
		assert.strictEqual(tauri.capabilities.supportsBackendApiAccess, false);
		assert.strictEqual(tauri.capabilities.supportsConsoleCapture, true);
		assert.strictEqual(tauri.productName, 'PreBase Tauri Fixture');

		assert.strictEqual(tauriPlain.confidence, 'high');
		assert.strictEqual(tauriPlain.hasWdioWebdriverPlugin, false);
		assert.strictEqual(tauriPlain.capabilities.fullNativeSetupRequired, true);
		assert.strictEqual(tauriPlain.capabilities.supportsFullNativeAutomation, false);
		assert.strictEqual(tauriPlain.capabilities.supportsRendererAutomation, true);
		assert.strictEqual(tauriPlain.capabilities.supportsConsoleCapture, true);
		assert.strictEqual(isRecognizedDesktopApp(tauriPlain), true);

		assert.strictEqual(tauriRustOnly.confidence, 'high');
		assert.strictEqual(tauriRustOnly.isRustOnly, true);
		assert.strictEqual(tauriRustOnly.rendererUrlHint, undefined);
		assert.strictEqual(tauriRustOnly.capabilities.supportsRendererAutomation, false);
		assert.strictEqual(tauriRustOnly.capabilities.supportsManagedLaunch, false);
		assert.strictEqual(tauri.testingSetup.ready, true);
	});
});

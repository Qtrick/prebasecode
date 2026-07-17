/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

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
	test('detects direct electron dependency with main entry', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { electron: '^30.0.0' },
				main: 'electron/main.js',
				scripts: { dev: 'electron-vite dev' },
			},
			exists: path => path === 'electron/main.js',
		}));
		assert.strictEqual(profile.isElectron, true);
		assert.strictEqual(profile.confidence, 'high');
		assert.ok(profile.capabilities.supportsManagedLaunch);
	});

	test('rejects web-only vite react without direct electron dependency', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { vite: '^5.0.0', react: '^18.0.0' },
				scripts: { dev: 'vite' },
			},
			exists: path => path === 'vite.config.ts',
		}));
		assert.strictEqual(profile.isElectron, false);
		assert.strictEqual(profile.confidence, 'none');
	});

	test('rejects script-only electron mention without direct dependency', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				scripts: { dev: 'concurrently "vite" "electron ."' },
			},
		}));
		assert.strictEqual(profile.isElectron, false);
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
		assert.strictEqual(profile.isElectron, true);
		assert.ok(profile.capabilities.supportsExternalLaunch);
	});

	test('does not treat transitive tooling as electron without direct dep', () => {
		const profile = detectElectronProject(probe({
			packageJson: {
				devDependencies: { '@storybook/react': '^8.0.0' },
				scripts: { storybook: 'storybook dev -p 6006' },
			},
		}));
		assert.strictEqual(profile.isElectron, false);
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
});

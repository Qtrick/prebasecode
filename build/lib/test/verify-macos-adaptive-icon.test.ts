/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';
import { suite, test } from 'node:test';

const VERIFIER = path.resolve(import.meta.dirname, '../../../scripts/icons/verify-macos-adaptive-icon.mjs');
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures', 'darwin-adaptive-icon');
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

const {
	verifyAdaptiveSources,
	verifyAppBundleIcons,
	parseArgs,
} = await import(pathToFileURL(VERIFIER).href);

suite('verify-macos-adaptive-icon', () => {

	test('parseArgs accepts --repo-root and --app without shell joining', () => {
		const spaced = '/tmp/PreBase App.app';
		const opts = parseArgs(['--repo-root', FIXTURES, '--app', spaced]);
		assert.strictEqual(opts.repoRoot, path.resolve(FIXTURES));
		assert.strictEqual(opts.appBundlePath, path.resolve(spaced));
	});

	test('fails closed when adaptive source is missing under repo root', () => {
		const result = verifyAdaptiveSources(FIXTURES);
		assert.strictEqual(result.ok, false);
		assert.ok(result.errors.some((e) => e.includes('MISSING adaptive source')));
	});

	test('fixture adaptive + legacy paths validate when pointed at directly via custom layout', async () => {
		// Build a mini repo-root shaped tree under fixtures/repo-shaped
		const fs = await import('node:fs/promises');
		const root = path.join(FIXTURES, 'repo-shaped');
		await fs.mkdir(path.join(root, 'resources', 'darwin', 'adaptive', 'PreBase.icon'), { recursive: true });
		await fs.writeFile(path.join(root, 'resources', 'darwin', 'adaptive', 'PreBase.icon', '.keep'), 'x');
		await fs.mkdir(path.join(root, 'resources', 'darwin'), { recursive: true });
		await fs.copyFile(
			path.join(FIXTURES, 'legacy', 'code.icns'),
			path.join(root, 'resources', 'darwin', 'code.icns')
		);
		const result = verifyAdaptiveSources(root);
		assert.strictEqual(result.ok, true, result.errors.join('; '));
	});

	test('app verifier fails when Assets.car / CFBundleIconName absent', () => {
		const result = verifyAppBundleIcons(path.join(FIXTURES, 'correct', 'PreBase.app'));
		assert.strictEqual(result.ok, false);
		assert.ok(result.errors.some((e) => e.includes('CFBundleIconName') || e.includes('Assets.car')));
	});

	test('canonical repo adaptive + legacy sources validate', () => {
		const result = verifyAdaptiveSources(REPO_ROOT);
		assert.strictEqual(result.ok, true, result.errors.join('; '));
	});
});

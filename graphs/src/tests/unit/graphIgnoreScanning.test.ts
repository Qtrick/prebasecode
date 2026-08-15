/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert';
import { suite, test } from 'mocha';
import { DEFAULT_IGNORE_PATTERNS } from '../../core/scanning/ignorePatterns.js';

function simpleGlobMatch(pattern: string, path: string): boolean {
	const regexStr = '^' + pattern
		.replace(/\./g, '\\.')
		.replace(/\*\*\//g, '(?:.*/)?')
		.replace(/\/\*\*/g, '(?:/.*)?')
		.replace(/\*/g, '[^/]*')
		.replace(/\?/g, '[^/]') + '$';
	return new RegExp(regexStr, 'i').test(path);
}

function isIgnored(relativePath: string, isDirectory: boolean, patterns: string[]): boolean {
	const path = relativePath.replace(/^\/+/, '');
	const candidates = isDirectory ? [path, `${path}/`, `**/${path}/**`] : [path, `**/${path}`];
	for (const rawPattern of patterns) {
		const pattern = rawPattern.trim();
		if (!pattern || pattern.startsWith('#')) {
			continue;
		}
		for (const candidate of candidates) {
			if (
				simpleGlobMatch(pattern, candidate) ||
				simpleGlobMatch(pattern, `/${candidate}`) ||
				simpleGlobMatch(`**/${pattern}/**`, candidate) ||
				simpleGlobMatch(`**/${pattern}`, candidate)
			) {
				return true;
			}
		}
		const cleanPattern = pattern
			.replace(/^\*\*\//, '')
			.replace(/\/\*\*$/, '')
			.replace(/^\//, '')
			.replace(/\/$/, '')
			.replace(/\*\*/g, '');
		if (cleanPattern && (path === cleanPattern || path.startsWith(`${cleanPattern}/`) || path.includes(`/${cleanPattern}/`))) {
			return true;
		}
	}
	return false;
}

suite('Graph Ignore Scanning & .gitignore integration', () => {
	test('always ignores hard-coded performance exclusion directories by default', () => {
		const hardPatterns = DEFAULT_IGNORE_PATTERNS;

		assert.strictEqual(isIgnored('node_modules', true, hardPatterns), true);
		assert.strictEqual(isIgnored('node_modules/express/index.js', false, hardPatterns), true);
		assert.strictEqual(isIgnored('.git', true, hardPatterns), true);
		assert.strictEqual(isIgnored('dist', true, hardPatterns), true);
		assert.strictEqual(isIgnored('dist/bundle.js', false, hardPatterns), true);
		assert.strictEqual(isIgnored('build', true, hardPatterns), true);
		assert.strictEqual(isIgnored('.cache/vite', true, hardPatterns), true);
		assert.strictEqual(isIgnored('coverage/lcov.info', false, hardPatterns), true);
	});

	test('allows legitimate source files through default patterns', () => {
		const hardPatterns = DEFAULT_IGNORE_PATTERNS;

		assert.strictEqual(isIgnored('src/index.ts', false, hardPatterns), false);
		assert.strictEqual(isIgnored('components/Button.tsx', false, hardPatterns), false);
		assert.strictEqual(isIgnored('services/api.ts', false, hardPatterns), false);
	});

	test('respects workspace .gitignore patterns including .reference and custom directories', () => {
		const gitignoreRules = [
			'.reference/',
			'target/',
			'tmp/',
			'*.log',
			'.env*',
		];
		const allPatterns = [...DEFAULT_IGNORE_PATTERNS, ...gitignoreRules];

		// .reference folder (from Screenshot B where .reference was incorrectly graphed)
		assert.strictEqual(isIgnored('.reference', true, allPatterns), true);
		assert.strictEqual(isIgnored('.reference/coreside-rc3.10-archive/coreside-main/vite.config.ts', false, allPatterns), true);

		// Custom folders & files
		assert.strictEqual(isIgnored('target', true, allPatterns), true);
		assert.strictEqual(isIgnored('target/debug/app', false, allPatterns), true);
		assert.strictEqual(isIgnored('debug.log', false, allPatterns), true);
		assert.strictEqual(isIgnored('.env', false, allPatterns), true);
		assert.strictEqual(isIgnored('.env.local', false, allPatterns), true);

		// Normal files still allowed
		assert.strictEqual(isIgnored('src/main.ts', false, allPatterns), false);
	});
});

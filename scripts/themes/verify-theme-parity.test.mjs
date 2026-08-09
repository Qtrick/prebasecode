#!/usr/bin/env node
/**
 * Spawn-based tests for scripts/themes/verify-theme-parity.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(__dirname, 'verify-theme-parity.mjs');

function runParity(repoRoot, opts = {}) {
	return spawnSync(process.execPath, [SCRIPT, '--repo-root', repoRoot], {
		encoding: 'utf8',
		cwd: REPO_ROOT,
		...opts,
	});
}

function writeJson(filePath, data) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function seedThemeExt(root, dir, { themes = [], iconThemes = [], sources = [] } = {}) {
	const extRoot = path.join(root, 'extensions', dir);
	writeJson(path.join(extRoot, 'package.json'), {
		name: dir,
		contributes: {
			...(themes.length ? { themes } : {}),
			...(iconThemes.length ? { iconThemes } : {}),
		},
	});
	for (const rel of sources) {
		const abs = path.join(extRoot, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, '{}\n', 'utf8');
	}
}

describe('verify-theme-parity.mjs', () => {
	let tmp;

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-parity-'));
	});

	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it('passes on the real repository and reports Modern Icons present', () => {
		const result = runParity(REPO_ROOT);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /theme-parity: PASS/);
		assert.match(result.stdout, /"modernIcons": true/);
		assert.match(result.stdout, /"stockColorThemes": 19/);
		assert.match(result.stdout, /"stockFileIconThemes": 3/);
	});

	it('fails when the builtins manifest is missing', () => {
		fs.mkdirSync(path.join(tmp, 'extensions'), { recursive: true });
		const result = runParity(tmp);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /manifest missing/);
	});

	it('fails when a stock color theme id is absent from theme-* extensions', () => {
		writeJson(path.join(tmp, 'build/themes/vscode-builtins.json'), {
			colorThemes: [{ id: 'Missing Stock', path: './themes/x.json', extension: 'theme-defaults' }],
			fileIconThemes: [],
		});
		seedThemeExt(tmp, 'theme-defaults', {
			themes: [{ id: 'Other', path: './themes/other.json' }],
			sources: ['themes/other.json'],
		});
		const result = runParity(tmp);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /missing stock color themes: Missing Stock/);
	});

	it('fails when Modern Icons (stock file icon) is missing', () => {
		writeJson(path.join(tmp, 'build/themes/vscode-builtins.json'), {
			colorThemes: [],
			fileIconThemes: [
				{ id: 'vscode-modern-icons', path: './fileicons/vscode-modern-icons-icon-theme.json', extension: 'theme-modern-icons' },
				{ id: 'vs-seti', path: './icons/vs-seti-icon-theme.json', extension: 'theme-seti' },
			],
		});
		seedThemeExt(tmp, 'theme-seti', {
			iconThemes: [{ id: 'vs-seti', path: './icons/vs-seti-icon-theme.json' }],
			sources: ['icons/vs-seti-icon-theme.json'],
		});
		// deliberately omit theme-modern-icons
		const result = runParity(tmp);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /missing stock file icon themes: vscode-modern-icons/);
	});

	it('fails when a contributed theme source file is missing on disk', () => {
		writeJson(path.join(tmp, 'build/themes/vscode-builtins.json'), {
			colorThemes: [{ id: 'Abyss', path: './themes/abyss-color-theme.json', extension: 'theme-abyss' }],
			fileIconThemes: [],
		});
		seedThemeExt(tmp, 'theme-abyss', {
			themes: [{ id: 'Abyss', path: './themes/abyss-color-theme.json' }],
			sources: [], // package declares it; file absent
		});
		const result = runParity(tmp);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /missing theme source for Abyss/);
	});

	it('allows PreBase-extra color themes without failing', () => {
		writeJson(path.join(tmp, 'build/themes/vscode-builtins.json'), {
			colorThemes: [{ id: 'Abyss', path: './themes/abyss-color-theme.json', extension: 'theme-abyss' }],
			fileIconThemes: [],
		});
		seedThemeExt(tmp, 'theme-abyss', {
			themes: [{ id: 'Abyss', path: './themes/abyss-color-theme.json' }],
			sources: ['themes/abyss-color-theme.json'],
		});
		seedThemeExt(tmp, 'theme-defaults', {
			themes: [
				{ id: 'PreBase Dark', path: './themes/prebase_dark.json' },
				{ id: 'PreBase Light', path: './themes/prebase_light.json' },
			],
			sources: ['themes/prebase_dark.json', 'themes/prebase_light.json'],
		});
		const result = runParity(tmp);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /theme-parity: PASS/);
		assert.match(result.stdout, /PreBase Dark/);
		assert.match(result.stdout, /PreBase Light/);
	});

	it('ignores non-theme-* extension folders when scanning contributions', () => {
		writeJson(path.join(tmp, 'build/themes/vscode-builtins.json'), {
			colorThemes: [{ id: 'Abyss', path: './themes/abyss-color-theme.json', extension: 'theme-abyss' }],
			fileIconThemes: [],
		});
		seedThemeExt(tmp, 'theme-abyss', {
			themes: [{ id: 'Abyss', path: './themes/abyss-color-theme.json' }],
			sources: ['themes/abyss-color-theme.json'],
		});
		writeJson(path.join(tmp, 'extensions', 'not-a-theme', 'package.json'), {
			name: 'not-a-theme',
			contributes: { themes: [{ id: 'Should Not Matter', path: './x.json' }] },
		});
		const result = runParity(tmp);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /theme-parity: PASS/);
	});
});

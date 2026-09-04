/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test, beforeEach, afterEach } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	getControlFilePath,
	readControlFile,
	writeControlFile,
	type IControlFile,
} from '../builtInExtensions.ts';

suite('builtInExtensions Control File & Sandbox Resilience', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-builtin-test-'));
	});

	afterEach(() => {
		try {
			// Restore write permissions in case tests made folders read-only
			fs.chmodSync(tmpDir, 0o777);
		} catch {
			// ignore
		}
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	test('respects explicit VSCODE_EXTENSIONS_CONTROL_PATH environment variable', () => {
		const customPath = path.join(tmpDir, 'custom-control.json');
		const env = { VSCODE_EXTENSIONS_CONTROL_PATH: customPath };
		const resolved = getControlFilePath(env);
		assert.strictEqual(resolved, customPath);
	});

	test('falls back to user home directory when VSCODE_EXTENSIONS_CONTROL_PATH is unset', () => {
		const env = {};
		const resolved = getControlFilePath(env);
		const expected = path.join(os.homedir(), '.vscode-oss-dev', 'extensions', 'control.json');
		assert.strictEqual(resolved, expected);
	});

	test('reads valid control file accurately and parses JSON', () => {
		const filePath = path.join(tmpDir, 'control.json');
		const data: IControlFile = {
			'ms-vscode.js-debug': 'marketplace',
			'ms-vscode.typescript-language-features': 'disabled',
		};
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

		const read = readControlFile(filePath);
		assert.deepStrictEqual(read, data);
	});

	test('returns empty object fallback when control file does not exist', () => {
		const nonExistent = path.join(tmpDir, 'does-not-exist.json');
		const read = readControlFile(nonExistent);
		assert.deepStrictEqual(read, {});
	});

	test('returns empty object fallback when control file contains malformed JSON', () => {
		const malformed = path.join(tmpDir, 'malformed.json');
		fs.writeFileSync(malformed, '{not json syntax', 'utf8');
		const read = readControlFile(malformed);
		assert.deepStrictEqual(read, {});
	});

	test('writes control file creating intermediate parent directories', () => {
		const nestedPath = path.join(tmpDir, 'nested', 'sub', 'control.json');
		const data: IControlFile = {
			'test-extension': 'marketplace',
		};

		writeControlFile(data, nestedPath);
		assert.strictEqual(fs.existsSync(nestedPath), true);
		const content = JSON.parse(fs.readFileSync(nestedPath, 'utf8'));
		assert.deepStrictEqual(content, data);
	});

	test('handles read-only / unwritable directory without uncaught exception (sandboxed environment)', () => {
		const readOnlyDir = path.join(tmpDir, 'readonly');
		fs.mkdirSync(readOnlyDir, { recursive: true });
		fs.chmodSync(readOnlyDir, 0o444); // read-only directory

		const targetFile = path.join(readOnlyDir, 'sub', 'control.json');
		const data: IControlFile = {
			'test-extension': 'disabled',
		};

		// Must not throw an unhandled error
		assert.doesNotThrow(() => {
			writeControlFile(data, targetFile);
		});

		// And reading from an unwritten or blocked path falls back cleanly to {}
		const read = readControlFile(targetFile);
		assert.deepStrictEqual(read, {});
	});

	test('handles file write error / EPERM without throwing', () => {
		const filePath = path.join(tmpDir, 'locked.json');
		fs.writeFileSync(filePath, '{"original":"marketplace"}', 'utf8');
		fs.chmodSync(filePath, 0o444); // read-only file

		const data: IControlFile = {
			'updated-ext': 'disabled',
		};

		assert.doesNotThrow(() => {
			writeControlFile(data, filePath);
		});
	});
});

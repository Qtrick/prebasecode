#!/usr/bin/env node
/**
 * Graph unit tests without full IDE transpile.
 * Runs Mocha on graph-owned sources via Node strip-types + graphs-test-loader (.js → .ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const MOCHA = path.join(REPO_ROOT, 'node_modules/mocha/bin/mocha.js');
const REGISTER = path.join(__dirname, 'graphs-test-register.mjs');
const SETUP = path.join(__dirname, 'graphs-test-setup.mjs');
const UNIT_TESTS_DIR = path.join(REPO_ROOT, 'graphs/src/tests/unit');

function runMochaOnSource(testRelPath) {
	const testAbs = path.join(REPO_ROOT, testRelPath);
	const timeoutMs = testRelPath.includes('gitHistoryService.test.ts') ? '30000' : '10000';
	return spawnSync(
		process.execPath,
		['--experimental-strip-types', `--import=${SETUP}`, `--import=${REGISTER}`, MOCHA, testAbs, '--ui', 'tdd', '--timeout', timeoutMs],
		{ cwd: REPO_ROOT, stdio: 'inherit' }
	).status ?? 1;
}

// Automatically and deterministically discover all *.test.ts files in graphs/src/tests/unit/
const testFiles = fs.readdirSync(UNIT_TESTS_DIR)
	.filter(file => file.endsWith('.test.ts'))
	.sort()
	.map(file => path.join('graphs/src/tests/unit', file));

console.log(`[graphs:unit-tests] Discovered ${testFiles.length} test files in graphs/src/tests/unit/`);

let failureCount = 0;
for (const test of testFiles) {
	const code = runMochaOnSource(test);
	if (code !== 0) {
		console.error(`[graphs:unit-tests] FAILED: ${test} (exit code ${code})`);
		failureCount++;
		process.exit(code);
	}
}

console.log(`[graphs:unit-tests] All ${testFiles.length} test files passed successfully.`);
process.exit(0);


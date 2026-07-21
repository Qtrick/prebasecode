#!/usr/bin/env node
/**
 * Graph unit tests without full IDE transpile.
 * Runs Mocha on graph-owned sources via Node strip-types + graphs-test-loader (.js → .ts).
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const MOCHA = path.join(REPO_ROOT, 'node_modules/mocha/bin/mocha.js');
const REGISTER = path.join(__dirname, 'graphs-test-register.mjs');

function runMochaOnSource(testRelPath) {
	const testAbs = path.join(REPO_ROOT, testRelPath);
	return spawnSync(
		process.execPath,
		['--experimental-strip-types', `--import=${REGISTER}`, MOCHA, testAbs, '--ui', 'tdd', '--timeout', '5000'],
		{ cwd: REPO_ROOT, stdio: 'inherit' }
	).status ?? 1;
}

const tests = [
	'graphs/src/tests/unit/architecturePick.test.ts',
	'graphs/src/tests/unit/networkLayout.test.ts',
];

for (const test of tests) {
	const code = runMochaOnSource(test);
	if (code !== 0) {
		process.exit(code);
	}
}

process.exit(0);

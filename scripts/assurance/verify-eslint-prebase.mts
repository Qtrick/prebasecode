/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Release-grade lint ratchet for PreBase-owned paths only.
 *
 * This gate does not claim the full-repository ESLint run is clean. Use
 * verify:eslint-prebase-security for a zero-debt privileged-code check.
 */
import { ESLint } from 'eslint';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const BASELINE_PATH = path.join(REPO_ROOT, 'docs/lint/eslint-prebase-baseline.json');

const TARGETS = [
	'graphs/**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
	'src/vs/workbench/contrib/prebase/**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
	'scripts/privacy/**/*.{ts,js,mjs,cjs}',
	'scripts/startup/**/*.{ts,js,mjs,cjs}',
	'scripts/supabase/**/*.{ts,js,mjs,cjs}',
	'scripts/assurance/**/*.{ts,js,mjs,cjs}',
];

async function main(): Promise<void> {
	console.log('verify:eslint-prebase: PreBase-path ratchet only — NOT full-repo eslint');
	console.log(`  targets (${TARGETS.length}):`);
	for (const target of TARGETS) {
		console.log(`    - ${target}`);
	}

	const linter = new ESLint({
		cwd: REPO_ROOT,
		cache: true,
		cacheLocation: path.join(REPO_ROOT, '.eslintcache-prebase'),
		cacheStrategy: 'content',
		errorOnUnmatchedPattern: false,
	});
	const results = await linter.lintFiles(TARGETS);
	const errorCount = results.reduce((count, result) => count + result.errorCount, 0);
	const warningCount = results.reduce((count, result) => count + result.warningCount, 0);
	const summary = {
		generatedAt: new Date().toISOString(),
		note: 'PreBase-path ratchet only. Does not claim full-repo npm run eslint is clean.',
		targets: TARGETS,
		errorCount,
		warningCount,
		fileCount: results.length,
	};

	if (results.length === 0) {
		console.error('verify:eslint-prebase: FAIL linted 0 files — globs matched nothing (refusing silent pass)');
		process.exitCode = 1;
		return;
	}
	if (process.env.PREBASE_ESLINT_BASELINE === '1') {
		fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
		fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(summary, null, '\t')}\n`);
		console.log(`verify:eslint-prebase: wrote baseline ${path.relative(REPO_ROOT, BASELINE_PATH)}`);
		console.log(`  files=${summary.fileCount} errors=${errorCount} warnings=${warningCount}`);
		return;
	}
	if (!fs.existsSync(BASELINE_PATH)) {
		console.error('verify:eslint-prebase: FAIL missing baseline at docs/lint/eslint-prebase-baseline.json');
		console.error('  Create with: PREBASE_ESLINT_BASELINE=1 npm run verify:eslint-prebase');
		console.error(`  Current PreBase-path counts: files=${summary.fileCount} errors=${errorCount} warnings=${warningCount}`);
		process.exitCode = 1;
		return;
	}

	const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as { errorCount?: number; warningCount?: number; fileCount?: number };
	const baseErrors = baseline.errorCount ?? 0;
	const baseWarnings = baseline.warningCount ?? 0;
	const baseFiles = baseline.fileCount ?? 0;
	if (baseFiles === 0) {
		console.error('verify:eslint-prebase: FAIL baseline fileCount=0 is invalid (prior no-op baseline)');
		console.error('  Re-seed with: PREBASE_ESLINT_BASELINE=1 npm run verify:eslint-prebase');
		process.exitCode = 1;
		return;
	}

	let failed = false;
	if (errorCount > baseErrors) {
		console.error(`verify:eslint-prebase: FAIL errors increased ${baseErrors} → ${errorCount}`);
		failed = true;
	}
	if (warningCount > baseWarnings) {
		console.error(`verify:eslint-prebase: FAIL warnings increased ${baseWarnings} → ${warningCount} (ratchet)`);
		failed = true;
	}
	if (results.length < Math.floor(baseFiles * 0.5)) {
		console.error(`verify:eslint-prebase: FAIL fileCount collapsed ${baseFiles} → ${results.length} (suspicious under-lint)`);
		failed = true;
	}
	if (failed) {
		process.exitCode = 1;
		return;
	}

	console.log(`verify:eslint-prebase: PASS (files=${results.length} errors=${errorCount} warnings=${warningCount}; baseline errors=${baseErrors} warnings=${baseWarnings})`);
	console.log('  Reminder: this is not a claim that root npm run eslint is clean.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});

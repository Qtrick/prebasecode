#!/usr/bin/env node
/**
 * Release-grade lint gate for PreBase-owned paths only.
 *
 * Honesty contract:
 * - Does NOT run or claim full-repo `npm run eslint` (upstream ~80k warnings).
 * - Does NOT treat `assurance:full` as eslint-clean.
 * - Ratches error/warning counts for PreBase paths against docs/lint/eslint-prebase-baseline.json.
 *
 * Modes:
 * - Default: lint PreBase targets; fail if fileCount===0 or counts exceed baseline.
 * - PREBASE_ESLINT_BASELINE=1: write/update baseline counts (maintainers; allows existing debt).
 */
import { ESLint } from 'eslint';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const BASELINE_PATH = path.join(REPO_ROOT, 'docs/lint/eslint-prebase-baseline.json');

/** Glob targets — PreBase-owned surfaces only (not the whole monorepo). */
const TARGETS = [
	'graphs/**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
	'src/vs/workbench/contrib/prebase/**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
	'scripts/privacy/**/*.{ts,js,mjs,cjs}',
	'scripts/startup/**/*.{ts,js,mjs,cjs}',
	'scripts/supabase/**/*.{ts,js,mjs,cjs}',
	'scripts/assurance/**/*.{ts,js,mjs,cjs}',
];

async function main() {
	console.log('verify:eslint-prebase: PreBase-path ratchet only — NOT full-repo eslint');
	console.log(`  targets (${TARGETS.length}):`);
	for (const t of TARGETS) {
		console.log(`    - ${t}`);
	}

	const linter = new ESLint({
		cwd: REPO_ROOT,
		cache: true,
		cacheLocation: path.join(REPO_ROOT, '.eslintcache-prebase'),
		cacheStrategy: 'content',
		errorOnUnmatchedPattern: false,
	});

	let results;
	try {
		results = await linter.lintFiles(TARGETS);
	} catch (err) {
		console.error('verify:eslint-prebase: ESLint failed to run on PreBase paths');
		console.error(err instanceof Error ? err.stack || err.message : err);
		process.exit(1);
	}

	let errorCount = 0;
	let warningCount = 0;
	for (const file of results) {
		errorCount += file.errorCount || 0;
		warningCount += file.warningCount || 0;
	}

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
		process.exit(1);
	}

	if (process.env.PREBASE_ESLINT_BASELINE === '1') {
		fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
		fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(summary, null, '\t')}\n`);
		console.log(`verify:eslint-prebase: wrote baseline ${path.relative(REPO_ROOT, BASELINE_PATH)}`);
		console.log(`  files=${summary.fileCount} errors=${errorCount} warnings=${warningCount}`);
		console.log('  (baseline write allows existing debt; ratchet prevents increases)');
		process.exit(0);
	}

	if (!fs.existsSync(BASELINE_PATH)) {
		console.error('verify:eslint-prebase: FAIL missing baseline at docs/lint/eslint-prebase-baseline.json');
		console.error('  Create with: PREBASE_ESLINT_BASELINE=1 npm run verify:eslint-prebase');
		console.error(`  Current PreBase-path counts: files=${summary.fileCount} errors=${errorCount} warnings=${warningCount}`);
		process.exit(1);
	}

	const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
	const baseErrors = baseline.errorCount ?? 0;
	const baseWarnings = baseline.warningCount ?? 0;
	const baseFiles = baseline.fileCount ?? 0;

	if (baseFiles === 0) {
		console.error('verify:eslint-prebase: FAIL baseline fileCount=0 is invalid (prior no-op baseline)');
		console.error('  Re-seed with: PREBASE_ESLINT_BASELINE=1 npm run verify:eslint-prebase');
		process.exit(1);
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
		process.exit(1);
	}

	console.log(
		`verify:eslint-prebase: PASS (files=${summary.fileCount} errors=${errorCount} warnings=${warningCount}; baseline errors=${baseErrors} warnings=${baseWarnings})`,
	);
	console.log('  Reminder: this is not a claim that root npm run eslint is clean.');
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

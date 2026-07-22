#!/usr/bin/env node
/**
 * Lightweight gate: graphs symlink + canonical transpiled modules under out/.
 *
 * assurance:quick does NOT run transpile-client. Run `npm run transpile-client`
 * locally (or watch-client-transpile) before relying on out/ being current.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const GRAPHS_SYMLINK = path.join(
	REPO_ROOT,
	'src/vs/workbench/contrib/prebase/graphs',
);

/** @type {string[]} */
const REQUIRED_OUT_MODULES = [
	'out/vs/workbench/contrib/prebase/graphs/host/workbench/prebaseGraphService.js',
	'out/vs/workbench/contrib/prebase/graphs/host/workbench/graphContribution.js',
	'out/vs/workbench/contrib/prebase/graphs/core/analysis/entryDetector.js',
	'out/vs/workbench/contrib/prebase/graphs/core/generation/graphGenerator.js',
	'out/vs/workbench/contrib/prebase/graphs/core/scanning/ignorePatterns.js',
	'out/vs/workbench/contrib/prebase/graphs/core/parsing/importExtractors.js',
	'out/vs/workbench/contrib/prebase/graphs/layouts/architecture/layoutEngine.js',
	'out/vs/workbench/contrib/prebase/graphs/layouts/network/index.js',
	'out/vs/workbench/contrib/prebase/graphs/common/constants/fileTypeColors.js',
	'out/vs/workbench/contrib/prebase/graphs/layouts/shared/layoutDepthColors.js',
	'out/vs/workbench/contrib/prebase/graphs/layouts/architecture/hierarchy/hierarchyLayout.js',
	'out/vs/workbench/contrib/prebase/graphs/core/scanning/projectFiles.js',
	'out/vs/workbench/contrib/prebase/graphs/core/resolution/paths.js',
	'out/vs/workbench/contrib/prebase/graphs/core/analysis/architectureLayers.js',
	'out/vs/workbench/contrib/prebase/graphs/core/analysis/languageStats.js',
	'out/vs/workbench/contrib/prebase/graphs/core/analysis/fileDescription.js',
];

/** Stale flat core/ shims (post graphs/ migration) — must use analysis/, generation/, etc. */
const STALE_FLAT_CORE_IMPORT = /\.\.\/\.\.\/core\/(entryDetector|graphGenerator|ignorePatterns|importExtractors|architectureLayers|languageStats|fileDescription|projectFiles|paths)\.js/;

const PREBASE_GRAPH_SERVICE_OUT = path.join(
	REPO_ROOT,
	'out/vs/workbench/contrib/prebase/graphs/host/workbench/prebaseGraphService.js',
);

/**
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verifyGraphsOut() {
	/** @type {string[]} */
	const errors = [];

	if (!fs.existsSync(GRAPHS_SYMLINK)) {
		errors.push(`graphs symlink missing: ${path.relative(REPO_ROOT, GRAPHS_SYMLINK)}`);
	} else {
		let linkStat;
		try {
			linkStat = fs.lstatSync(GRAPHS_SYMLINK);
		} catch (e) {
			errors.push(`graphs symlink unreadable: ${e instanceof Error ? e.message : String(e)}`);
			linkStat = undefined;
		}
		if (linkStat && !linkStat.isSymbolicLink()) {
			errors.push(`graphs path is not a symlink: ${path.relative(REPO_ROOT, GRAPHS_SYMLINK)}`);
		} else if (linkStat?.isSymbolicLink()) {
			try {
				fs.realpathSync(GRAPHS_SYMLINK);
			} catch {
				errors.push(`graphs symlink is broken: ${path.relative(REPO_ROOT, GRAPHS_SYMLINK)}`);
			}
		}
	}

	for (const rel of REQUIRED_OUT_MODULES) {
		const abs = path.join(REPO_ROOT, rel);
		if (!fs.existsSync(abs)) {
			errors.push(`missing out module: ${rel}`);
		}
	}

	if (fs.existsSync(PREBASE_GRAPH_SERVICE_OUT)) {
		const source = fs.readFileSync(PREBASE_GRAPH_SERVICE_OUT, 'utf8');
		if (STALE_FLAT_CORE_IMPORT.test(source)) {
			errors.push(
				'stale shim imports in prebaseGraphService.js (flat ../../core/*.js); run npm run transpile-client',
			);
		}
	}

	return { ok: errors.length === 0, errors };
}

function main() {
	const { ok, errors } = verifyGraphsOut();
	if (ok) {
		console.log(`verify:graphs-out: PASS (${REQUIRED_OUT_MODULES.length} modules + symlink)`);
		process.exit(0);
	}
	console.error('verify:graphs-out: FAIL');
	for (const err of errors) {
		console.error(`  - ${err}`);
	}
	console.error('hint: npm run transpile-client');
	process.exit(1);
}

const isMain = path.resolve(process.argv[1] ?? '') === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
	main();
}

#!/usr/bin/env node
/**
 * Lightweight gate: graphs symlink + canonical transpiled modules under out/.
 *
 * assurance:quick does NOT run transpile-client. Run `npm run transpile-client`
 * locally (or watch-client-transpile) before relying on out/ being current.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
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
const GRAPHS_SOURCE_DIR = path.join(REPO_ROOT, 'graphs', 'src');
const GRAPHS_MANIFEST = path.join(REPO_ROOT, 'out/vs/workbench/contrib/prebase/graphs/.prebase-source-manifest.json');

function collectGraphSourceFiles(directory, relative = '') {
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const childRelative = path.posix.join(relative, entry.name);
		const child = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectGraphSourceFiles(child, childRelative));
		} else if (entry.isFile() && !entry.name.endsWith('.d.ts')) {
			files.push({
				path: childRelative,
				sha256: crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex'),
			});
		}
	}
	// Match the deterministic lexical ordering used by the transpile manifest.
	return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function verifyGraphsFreshness(errors) {
	if (!fs.existsSync(GRAPHS_MANIFEST)) {
		errors.push('graphs source manifest missing; run npm run transpile-client');
		return;
	}
	try {
		const manifest = JSON.parse(fs.readFileSync(GRAPHS_MANIFEST, 'utf8'));
		const actual = collectGraphSourceFiles(GRAPHS_SOURCE_DIR);
		if (manifest.version !== 1 || !Array.isArray(manifest.files)) {
			errors.push('graphs source manifest is malformed; run npm run transpile-client');
			return;
		}
		if (JSON.stringify(manifest.files) !== JSON.stringify(actual)) {
			errors.push('graphs out/ is stale relative to graphs/src (including deleted or renamed files); run npm run transpile-client');
		}
	} catch (error) {
		errors.push(`graphs source manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`);
	}
}

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

	verifyGraphsFreshness(errors);

	return { ok: errors.length === 0, errors };
}

function main() {
	const { ok, errors } = verifyGraphsOut();
	if (ok) {
		console.log(`verify:graphs-out: PASS (${REQUIRED_OUT_MODULES.length} modules + symlink + freshness manifest)`);
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

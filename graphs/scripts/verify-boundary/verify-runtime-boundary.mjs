#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const GRAPHS_SRC = path.join(REPO_ROOT, 'graphs/src');

const FORBIDDEN_MODULES = [
	'node:child_process',
	'child_process',
	'node:fs',
	'node:fs/promises',
	'fs',
	'fs/promises',
	'node:crypto',
	'crypto',
	'node:os',
	'os',
	'node:net',
	'net',
	'node:http',
	'http',
	'node:https',
	'https',
];

const SCAN_DIRS = [
	'common',
	'core',
	'history',
	'host',
	'layouts',
	'commands',
	'temporal/common',
	'temporal/core',
	'temporal/analysis',
	'temporal/ingestion',
	'temporal/host',
	'temporal/persistence/common',
];

async function collectTsFiles(dir) {
	const results = [];
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				results.push(...(await collectTsFiles(fullPath)));
			} else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
				results.push(fullPath);
			}
		}
	} catch {
		// Directory does not exist yet
	}
	return results;
}

function importedModules(content) {
	const modules = [];
	const pattern = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;
	let match;
	while ((match = pattern.exec(content)) !== null) {
		modules.push(match[1]);
	}
	return modules;
}

async function resolveRelativeImport(fromFile, moduleName) {
	if (!moduleName.startsWith('.')) {
		return undefined;
	}
	const base = path.resolve(path.dirname(fromFile), moduleName);
	const candidates = moduleName.endsWith('.js')
		? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]
		: [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
	for (const candidate of candidates) {
		try {
			if ((await fs.stat(candidate)).isFile()) {
				return candidate;
			}
		} catch {
			// Try the next TypeScript resolution candidate.
		}
	}
	return undefined;
}

async function verifyRuntimeBoundary() {
	const errors = [];
	let scannedCount = 0;
	const sandboxEntries = [];

	for (const subDir of SCAN_DIRS) {
		const targetDir = path.join(GRAPHS_SRC, subDir);
		const files = await collectTsFiles(targetDir);

		for (const file of files) {
			scannedCount++;
			sandboxEntries.push(file);
			const content = await fs.readFile(file, 'utf8');
			const lines = content.split('\n');

			for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
				const line = lines[lineIndex];
				// Match import statements: import ... from '...' or import('...')
				const importMatch = /from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
				if (importMatch) {
					const moduleName = importMatch[1] || importMatch[2];
					if (FORBIDDEN_MODULES.includes(moduleName)) {
						const rel = path.relative(REPO_ROOT, file);
						errors.push(`${rel}:${lineIndex + 1}: Forbidden runtime import "${moduleName}" in sandboxed graph code.`);
					}
				}
			}
		}
	}

	const contentCache = new Map();
	const readImports = async file => {
		if (!contentCache.has(file)) {
			contentCache.set(file, importedModules(await fs.readFile(file, 'utf8')));
		}
		return contentCache.get(file);
	};
	const visit = async (file, chain, visited, targetErrors = errors) => {
		if (visited.has(file)) {
			return;
		}
		visited.add(file);
		for (const moduleName of await readImports(file)) {
			if (FORBIDDEN_MODULES.includes(moduleName) || moduleName === '@vscode/sqlite3') {
				const rendered = [...chain, file].map(item => path.relative(REPO_ROOT, item)).join(' -> ');
				targetErrors.push(`${rendered} -> ${moduleName}: forbidden transitive runtime dependency.`);
				continue;
			}
			const target = await resolveRelativeImport(file, moduleName);
			if (target && target.startsWith(GRAPHS_SRC + path.sep)) {
				await visit(target, [...chain, file], new Set(visited), targetErrors);
			}
		}
	};
	for (const entry of sandboxEntries) {
		await visit(entry, [], new Set());
	}

	const invalidFixture = path.join(GRAPHS_SRC, 'tests/fixtures/runtime-boundary-invalid/entry.ts');
	const fixtureErrors = [];
	await visit(invalidFixture, [], new Set(), fixtureErrors);
	if (!fixtureErrors.some(error => error.includes('@vscode/sqlite3') && error.includes('intermediate.ts'))) {
		errors.push('Transitive runtime-boundary self-test failed to detect the invalid entry -> intermediate -> @vscode/sqlite3 fixture.');
	}

	if (errors.length > 0) {
		console.error('Graph runtime boundary check FAILED:');
		for (const error of errors) {
			console.error(`  - ${error}`);
		}
		process.exit(1);
	}

	console.log(`Graph runtime boundary check OK (scanned ${scannedCount} files)`);
	process.exit(0);
}

verifyRuntimeBoundary().catch((err) => {
	console.error('Error during runtime boundary verification:', err);
	process.exit(1);
});

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

async function verifyRuntimeBoundary() {
	const errors = [];
	let scannedCount = 0;

	for (const subDir of SCAN_DIRS) {
		const targetDir = path.join(GRAPHS_SRC, subDir);
		const files = await collectTsFiles(targetDir);

		for (const file of files) {
			scannedCount++;
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

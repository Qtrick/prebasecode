#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const MAGNUS_DIR = path.join(REPO_ROOT, 'extensions/prebase-magnus');
const MAGNUS_PACKAGE_JSON = path.join(MAGNUS_DIR, 'package.json');
const MAGNUS_TSCONFIG = path.join(MAGNUS_DIR, 'tsconfig.json');
const MAGNUS_SRC_DIR = path.join(MAGNUS_DIR, 'src');
const MAGNUS_OUT_DIR = path.join(MAGNUS_DIR, 'out');
const MAGNUS_EXTENSION_JS = path.join(MAGNUS_OUT_DIR, 'extension.js');

function getRuntimeSourceFiles(dir, base = '') {
	const results = [];
	if (!fs.existsSync(dir)) {
		return results;
	}
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		const rel = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			results.push(...getRuntimeSourceFiles(full, rel));
		} else if (
			entry.isFile() &&
			entry.name.endsWith('.ts') &&
			!entry.name.endsWith('.d.ts') &&
			!entry.name.endsWith('.test.ts')
		) {
			results.push(rel.replace(/\.ts$/, '.js'));
		}
	}
	return results;
}

function getLatestSourceMtime(dir) {
	let maxMtime = 0;
	if (!fs.existsSync(dir)) {
		return 0;
	}
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			const subMax = getLatestSourceMtime(fullPath);
			if (subMax > maxMtime) {
				maxMtime = subMax;
			}
		} else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.json'))) {
			if (!entry.name.endsWith('.d.ts')) {
				const stat = fs.statSync(fullPath);
				if (stat.mtimeMs > maxMtime) {
					maxMtime = stat.mtimeMs;
				}
			}
		}
	}
	return maxMtime;
}

export function verifyMagnusOut() {
	/** @type {string[]} */
	const errors = [];

	if (!fs.existsSync(MAGNUS_PACKAGE_JSON)) {
		errors.push(`missing manifest: ${path.relative(REPO_ROOT, MAGNUS_PACKAGE_JSON)}`);
		return { ok: false, errors };
	}

	if (!fs.existsSync(MAGNUS_EXTENSION_JS)) {
		errors.push(`missing compiled main: ${path.relative(REPO_ROOT, MAGNUS_EXTENSION_JS)}`);
		return { ok: false, errors };
	}

	const extStat = fs.statSync(MAGNUS_EXTENSION_JS);
	if (extStat.size === 0) {
		errors.push(`compiled main is empty: ${path.relative(REPO_ROOT, MAGNUS_EXTENSION_JS)}`);
	}

	const expectedOutputs = getRuntimeSourceFiles(MAGNUS_SRC_DIR);
	if (expectedOutputs.length === 0) {
		errors.push('no runtime source files detected under extensions/prebase-magnus/src');
	}

	for (const file of expectedOutputs) {
		const fullPath = path.join(MAGNUS_OUT_DIR, file);
		if (!fs.existsSync(fullPath)) {
			errors.push(`missing compiled module: extensions/prebase-magnus/out/${file}`);
		} else {
			const stat = fs.statSync(fullPath);
			if (stat.size === 0) {
				errors.push(`empty compiled module: extensions/prebase-magnus/out/${file}`);
			}
		}
	}

	// Freshness check: source mtime vs out/extension.js mtime
	let newestSourceMtime = getLatestSourceMtime(MAGNUS_SRC_DIR);
	if (fs.existsSync(MAGNUS_PACKAGE_JSON)) {
		newestSourceMtime = Math.max(newestSourceMtime, fs.statSync(MAGNUS_PACKAGE_JSON).mtimeMs);
	}
	if (fs.existsSync(MAGNUS_TSCONFIG)) {
		newestSourceMtime = Math.max(newestSourceMtime, fs.statSync(MAGNUS_TSCONFIG).mtimeMs);
	}

	if (newestSourceMtime > extStat.mtimeMs + 1000) {
		errors.push(`compiled Magnus output is older than sources (stale by ${Math.round((newestSourceMtime - extStat.mtimeMs) / 1000)}s)`);
	}

	return {
		ok: errors.length === 0,
		errors,
		derivedModulesCount: expectedOutputs.length,
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const res = verifyMagnusOut();
	if (res.ok) {
		console.log(`verify:magnus-out: PASS (${res.derivedModulesCount} derived runtime modules verified)`);
		process.exit(0);
	} else {
		console.error('verify:magnus-out: FAIL');
		for (const err of res.errors) {
			console.error(`  - ${err}`);
		}
		process.exit(1);
	}
}

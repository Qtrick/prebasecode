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

const SCAN_ROOTS = [
	path.join(REPO_ROOT, 'src'),
	path.join(REPO_ROOT, 'extensions/prebase-magnus'),
	path.join(REPO_ROOT, 'supabase/functions'),
	path.join(REPO_ROOT, 'supabase/migrations'),
];

const SKIP_DIR = new Set(['node_modules', 'out', '.git', 'dist']);

/** JWT with role service_role (Supabase service keys are JWTs). */
const SERVICE_ROLE_JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

const FORBIDDEN_LITERALS = [
	/SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+['"]/i,
	/sb_secret_[A-Za-z0-9_-]{8,}/,
	/service_role['"]?\s*:\s*['"][^'"]+['"]/i,
];

/** @type {string[]} */
const failures = [];

function decodeJwtPayload(segment) {
	try {
		const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
		const json = Buffer.from(padded, 'base64').toString('utf8');
		return JSON.parse(json);
	} catch {
		return undefined;
	}
}

function scanFile(absPath) {
	const rel = path.relative(REPO_ROOT, absPath);
	const text = fs.readFileSync(absPath, 'utf8');
	for (const re of FORBIDDEN_LITERALS) {
		if (re.test(text)) {
			failures.push(`${rel}: forbidden secret pattern (${re})`);
		}
	}
	for (const match of text.matchAll(SERVICE_ROLE_JWT_RE)) {
		const parts = match[0].split('.');
		if (parts.length < 2) {
			continue;
		}
		const payload = decodeJwtPayload(parts[1]);
		if (payload?.role === 'service_role') {
			failures.push(`${rel}: embedded service_role JWT`);
		}
	}
}

function walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIR.has(entry.name)) {
			continue;
		}
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(abs);
			continue;
		}
		if (!/\.(ts|tsx|js|mjs|cjs|json|md)$/i.test(entry.name)) {
			continue;
		}
		scanFile(abs);
	}
}

for (const root of SCAN_ROOTS) {
	if (fs.existsSync(root)) {
		walk(root);
	}
}

if (failures.length) {
	console.error('verify-no-secrets-in-source: FAIL');
	for (const f of failures) {
		console.error(`  - ${f}`);
	}
	process.exit(1);
}

console.log('verify-no-secrets-in-source: PASS');

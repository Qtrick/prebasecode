#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_FILE = path.join(
	REPO_ROOT,
	'src/vs/workbench/contrib/prebase/common/cloud/generated/database.types.ts',
);

const which = spawnSync('which', ['supabase'], { encoding: 'utf8' });
if (which.status !== 0 || !which.stdout.trim()) {
	console.log(
		'supabase:types: skipped — Supabase CLI not found. Install: https://supabase.com/docs/guides/cli/getting-started',
	);
	process.exit(0);
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

const local = spawnSync(
	'supabase',
	['gen', 'types', '--lang', 'typescript', '--local'],
	{ cwd: REPO_ROOT, encoding: 'utf8' },
);

if (local.status !== 0) {
	console.error('supabase:types: failed (is `supabase start` running for --local?)');
	console.error(local.stderr || local.stdout);
	process.exit(1);
}

const banner = `/* eslint-disable */
// GENERATED — do not edit by hand.
// Regenerate: npm run supabase:types
// Requires Supabase CLI + local stack (\`supabase start\`) or adjust to --linked.

`;

fs.writeFileSync(OUT_FILE, banner + local.stdout, 'utf8');
console.log(`supabase:types: wrote ${path.relative(REPO_ROOT, OUT_FILE)}`);

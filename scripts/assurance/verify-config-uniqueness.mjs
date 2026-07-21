#!/usr/bin/env node
/**
 * Ensure PreBase graph command IDs are unique and configuration enum keys do not collide.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const ENUM_VALUE_RE = /=\s*'(prebase\.[^']+)'/g;

function enumKeysFromFile(relPath) {
	const text = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
	return [...text.matchAll(ENUM_VALUE_RE)].map((m) => m[1]);
}

const COMMAND_IDS_FILE = 'graphs/src/commands/graphCommandIds.ts';
const idsText = fs.readFileSync(path.join(REPO_ROOT, COMMAND_IDS_FILE), 'utf8');
const declared = [...idsText.matchAll(/:\s*'(prebase\.[^']+)'/g)].map((m) => m[1]);

const seenCmd = new Map();
for (const id of declared) {
	seenCmd.set(id, (seenCmd.get(id) ?? 0) + 1);
}
const dupes = [...seenCmd.entries()].filter(([, n]) => n > 1);
if (dupes.length) {
	console.error('verify:config-uniqueness: duplicate declared command IDs:', dupes);
	process.exit(1);
}

const configKeys = [
	...enumKeysFromFile('graphs/src/common/configuration/graphConfigKeys.ts'),
	...enumKeysFromFile('src/vs/workbench/contrib/prebase/common/prebaseConfiguration.ts'),
];
const seenKeys = new Map();
for (const k of configKeys) {
	seenKeys.set(k, (seenKeys.get(k) ?? 0) + 1);
}
const keyDupes = [...seenKeys.entries()].filter(([, n]) => n > 1);
if (keyDupes.length) {
	console.error('verify:config-uniqueness: duplicate configuration keys:', keyDupes);
	process.exit(1);
}

console.log(`verify:config-uniqueness: ${declared.length} command IDs, ${configKeys.length} configuration keys — OK`);

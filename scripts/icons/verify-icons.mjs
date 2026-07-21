#!/usr/bin/env node
/**
 * Verify protected application icon bytes match the repository manifest.
 * Does not modify icon files — fails on missing paths or hash drift.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const MANIFEST = path.join(REPO_ROOT, 'build/icons/icon-integrity.sha256');

function parseManifest(text) {
	/** @type {{ hash: string, relPath: string }[]} */
	const entries = [];
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const match = trimmed.match(/^([a-f0-9]{64})\s{2}(.+)$/);
		if (!match) {
			throw new Error(`Invalid manifest line: ${trimmed}`);
		}
		entries.push({ hash: match[1], relPath: match[2] });
	}
	return entries;
}

function sha256File(absPath) {
	const data = fs.readFileSync(absPath);
	return crypto.createHash('sha256').update(data).digest('hex');
}

if (!fs.existsSync(MANIFEST)) {
	console.error(`verify:icons: manifest missing at ${path.relative(REPO_ROOT, MANIFEST)}`);
	process.exit(1);
}

const entries = parseManifest(fs.readFileSync(MANIFEST, 'utf8'));
let ok = 0;
let failed = 0;

for (const { hash, relPath } of entries) {
	const abs = path.join(REPO_ROOT, relPath);
	if (!fs.existsSync(abs)) {
		console.error(`MISSING  ${relPath}`);
		failed++;
		continue;
	}
	const actual = sha256File(abs);
	if (actual !== hash) {
		console.error(`CHANGED  ${relPath} (expected ${hash}, got ${actual})`);
		failed++;
		continue;
	}
	ok++;
}

console.log(`verify:icons: ${ok}/${entries.length} OK`);
if (failed > 0) {
	console.error(`verify:icons: ${failed} failure(s)`);
	process.exit(1);
}

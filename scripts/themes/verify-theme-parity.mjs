#!/usr/bin/env node
/**
 * Verify PreBase built-in color/file icon themes match the canonical VS Code builtins manifest.
 * Does not depend on external archives at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
	let repoRoot = path.resolve(__dirname, '../..');
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--repo-root' && argv[i + 1]) {
			repoRoot = path.resolve(argv[++i]);
		}
	}
	return { repoRoot };
}

const { repoRoot: REPO_ROOT } = parseArgs(process.argv.slice(2));
const MANIFEST = path.join(REPO_ROOT, 'build/themes/vscode-builtins.json');

function fail(msg) {
	console.error(`theme-parity: FAIL — ${msg}`);
	process.exit(1);
}

if (!fs.existsSync(MANIFEST)) {
	fail(`manifest missing: ${path.relative(REPO_ROOT, MANIFEST)}`);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const expectedColor = new Set((manifest.colorThemes || []).map((t) => t.id).filter(Boolean));
const expectedIcons = new Set((manifest.fileIconThemes || []).map((t) => t.id).filter(Boolean));

/** @type {Map<string, string>} */
const foundColor = new Map();
/** @type {Map<string, string>} */
const foundIcons = new Map();

for (const dir of fs.readdirSync(path.join(REPO_ROOT, 'extensions'))) {
	if (!dir.startsWith('theme-')) {
		continue;
	}
	const pkgPath = path.join(REPO_ROOT, 'extensions', dir, 'package.json');
	if (!fs.existsSync(pkgPath)) {
		continue;
	}
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
	for (const t of pkg.contributes?.themes || []) {
		if (t.id) {
			foundColor.set(t.id, dir);
		}
	}
	for (const t of pkg.contributes?.iconThemes || []) {
		if (t.id) {
			foundIcons.set(t.id, dir);
		}
	}
}

const missingColor = [...expectedColor].filter((id) => !foundColor.has(id));
const missingIcons = [...expectedIcons].filter((id) => !foundIcons.has(id));
const extraPrebase = [...foundColor.keys()].filter((id) => !expectedColor.has(id));

if (missingColor.length) {
	fail(`missing stock color themes: ${missingColor.join(', ')}`);
}
if (missingIcons.length) {
	fail(`missing stock file icon themes: ${missingIcons.join(', ')}`);
}

// Ensure theme source files exist for stock themes
for (const t of manifest.colorThemes || []) {
	const ext = t.extension;
	const rel = t.path?.replace(/^\.\//, '');
	if (!ext || !rel) {
		continue;
	}
	const abs = path.join(REPO_ROOT, 'extensions', ext, rel);
	if (!fs.existsSync(abs)) {
		fail(`missing theme source for ${t.id}: extensions/${ext}/${rel}`);
	}
}
for (const t of manifest.fileIconThemes || []) {
	const ext = t.extension;
	const rel = t.path?.replace(/^\.\//, '');
	if (!ext || !rel) {
		continue;
	}
	const abs = path.join(REPO_ROOT, 'extensions', ext, rel);
	if (!fs.existsSync(abs)) {
		fail(`missing icon theme source for ${t.id}: extensions/${ext}/${rel}`);
	}
}

console.log('theme-parity: PASS');
console.log(JSON.stringify({
	stockColorThemes: expectedColor.size,
	stockFileIconThemes: expectedIcons.size,
	prebaseExtraColorThemes: extraPrebase,
	modernIcons: foundIcons.has('vscode-modern-icons'),
}, null, 2));

#!/usr/bin/env node
/**
 * Print PreBase TypeScript compiler lanes (primary TS7 vs compat TS6 API).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const require = createRequire(path.join(REPO_ROOT, 'package.json'));

function safeRequireVersion(pkg) {
	try {
		return require(path.join(REPO_ROOT, 'node_modules', pkg, 'package.json'));
	} catch {
		return undefined;
	}
}

function binVersion(bin) {
	const r = spawnSync(path.join(REPO_ROOT, 'node_modules', '.bin', bin), ['--version'], { encoding: 'utf8' });
	return (r.stdout || r.stderr || '').trim() || `(${bin} missing, code ${r.status})`;
}

const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const dd = pkg.devDependencies || {};

const nativeMeta = safeRequireVersion('@typescript/native');
const tsMeta = safeRequireVersion('typescript');

let apiVersion = '(unavailable)';
try {
	apiVersion = require(path.join(REPO_ROOT, 'node_modules/typescript')).version;
} catch {
	/* ignore */
}

console.log('TypeScript compiler lanes\n');
console.log('[primary CLI]');
console.log(`  package.json: ${dd['@typescript/native'] ?? '(missing @typescript/native)'}`);
console.log(`  installed:    ${nativeMeta ? `${nativeMeta.name}@${nativeMeta.version}` : '(missing)'}`);
console.log(`  executable:   ${binVersion('tsc')}`);
console.log('  used by:      typecheck-client, typecheck:ts7, build/lib/tsgo.ts → tsc, monaco/valid-layers checks');
console.log('');
console.log('[compat API / tsc6]');
console.log(`  package.json: ${dd.typescript ?? '(missing typescript)'}`);
console.log(`  installed:    ${tsMeta ? `${tsMeta.name}@${tsMeta.version}` : '(missing)'}`);
console.log(`  import API:   ${apiVersion}`);
console.log(`  executable:   ${binVersion('tsc6')}`);
console.log('  used by:      build/lib/* `import from \"typescript\"`, typescript-eslint, html language features');
console.log('');
console.log('[editor language service]');
console.log('  Prefer TypeScript 7 LSP / native preview extension where available;');
console.log('  built-in typescript-language-features may still use bundled/workspace TS6 until configured.');
console.log('');
console.log('Reference: docs/TYPESCRIPT_7_MIGRATION.md');

const ok = Boolean(nativeMeta) && Boolean(tsMeta) && binVersion('tsc').includes('7.');
process.exit(ok ? 0 : 1);

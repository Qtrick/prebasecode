#!/usr/bin/env node
/**
 * Lightweight packaging smoke: verify gulp exposes expected tasks for this host.
 * Does not compile or produce installable artifacts.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function archToGulp(arch) {
	if (arch === 'x64') {
		return 'x64';
	}
	if (arch === 'arm64') {
		return 'arm64';
	}
	if (arch === 'ia32') {
		return 'ia32';
	}
	return arch;
}

const platform = os.platform();
const arch = archToGulp(os.arch());

const r = spawnSync(
	process.execPath,
	['--experimental-strip-types', path.join(REPO_ROOT, 'node_modules/gulp/bin/gulp.js'), '--tasks-simple'],
	{ cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
);

if (r.status !== 0) {
	console.error('package-smoke: failed to list gulp tasks');
	if (r.stderr) {
		console.error(r.stderr.trim());
	}
	process.exit(1);
}

const tasks = new Set(r.stdout.split('\n').map((l) => l.trim()).filter(Boolean));

const required = ['bundle-vscode', 'minify-vscode', 'compile-build-with-mangling'];
if (platform === 'darwin') {
	required.push(`vscode-darwin-${arch}-ci`, `vscode-darwin-${arch}-min-ci`, 'vscode', 'vscode-min');
} else if (platform === 'win32') {
	required.push(`vscode-win32-${arch}-ci`, `vscode-win32-${arch}-min-ci`);
} else if (platform === 'linux') {
	required.push(`vscode-linux-${arch}-ci`, `vscode-linux-${arch}-min-ci`);
}

const missing = required.filter((t) => !tasks.has(t));
if (missing.length > 0) {
	console.error(`package-smoke: missing gulp tasks: ${missing.join(', ')}`);
	process.exit(1);
}

console.log(`package-smoke: gulp task discovery OK (${platform}/${arch})`);
console.log('package-smoke: full unsigned desktop package — Needs Verification (not run in Phase J; see docs/PACKAGING.md)');
console.log('package-smoke: optional hygiene task check-package-json may fail without extensions/copilot checkout');

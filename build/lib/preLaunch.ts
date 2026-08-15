/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rootDir = path.resolve(import.meta.dirname, '..', '..');

function runProcess(command: string, args: ReadonlyArray<string> = []) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd: rootDir, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
		child.on('exit', err => !err ? resolve() : process.exit(err ?? 1));
		child.on('error', reject);
	});
}

async function exists(subdir: string) {
	try {
		await fs.stat(path.join(rootDir, subdir));
		return true;
	} catch {
		return false;
	}
}

async function ensureNodeModules() {
	if (!(await exists('node_modules'))) {
		await runProcess(npm, ['ci']);
	}
}

async function syncDarwinAppIcon() {
	if (process.platform !== 'darwin') {
		return;
	}
	const { DarwinIconError, syncDevelopmentAdaptiveIcon } = await import('./prebaseDarwinIcon.ts');
	try {
		const result = await syncDevelopmentAdaptiveIcon(rootDir);
		if (!result) {
			// Electron not installed yet — distinct from adaptive failure.
			return;
		}
		console.log(`[preLaunch] adaptive icon synced → ${result.appPath}`);
	} catch (err) {
		if (err instanceof DarwinIconError) {
			console.error(`[preLaunch] adaptive icon sync failed (${err.code}):`, err.message);
			throw err;
		}
		throw err;
	}
}

async function getElectron() {
	// `npm run electron` deletes and re-downloads `.build/electron` on every
	// invocation. When preLaunch runs repeatedly (e.g. once per integration test
	// section) this is both wasteful and a source of flaky failures on Windows,
	// where the just-exited Electron process can still hold file locks while the
	// directory is being removed and re-extracted. Skip the refresh when the
	// already-present Electron matches the expected version; any detection
	// failure falls back to a (re)download to preserve the previous behavior.
	if (!(await isExpectedElectronInstalled())) {
		await runProcess(npm, ['run', 'electron']);
	}
	// `npm run electron` skips when versions match, so logo updates in
	// resources/darwin/code.icns would never reach the running .app otherwise.
	await syncDarwinAppIcon();
}

async function isExpectedElectronInstalled(): Promise<boolean> {
	try {
		const { getElectronVersion } = await import('./util.ts');
		const { electronVersion } = getElectronVersion();
		const installedVersion = (await fs.readFile(path.join(rootDir, '.build', 'electron', 'version'), 'utf8')).trim().replace(/^v/, '');
		return installedVersion === electronVersion;
	} catch {
		return false;
	}
}

async function ensureCompiled() {
	if (!(await exists('out'))) {
		await runProcess(npm, ['run', 'compile']);
		return;
	}
	// Blank-workbench guard (BETA-032): `out/` can exist while the graphs
	// package (src/.../prebase/graphs → graphs/src symlink) was never emitted
	// or was wiped. Missing graphContribution.js aborts workbench restore.
	const graphsContribution = 'out/vs/workbench/contrib/prebase/graphs/host/workbench/graphContribution.js';
	const { verifyGraphsOut } = await import('../../scripts/startup/verify-graphs-out.mjs');
	const graphOutput = verifyGraphsOut();
	if (!(await exists(graphsContribution)) || !graphOutput.ok) {
		console.log(`[preLaunch] graphs out/ is missing or stale (${graphOutput.errors.join('; ') || 'missing graph contribution'}) — running transpile-client`);
		await runProcess(npm, ['run', 'transpile-client']);
	}

	// Magnus extension readiness guard: `out/` can exist while extensions/prebase-magnus/out/
	// was never compiled or has fallen stale relative to its sources.
	const { verifyMagnusOut } = await import('../../scripts/startup/verify-magnus-out.mjs');
	const magnusOutput = verifyMagnusOut();
	if (!magnusOutput.ok) {
		console.log(`[preLaunch] Magnus extension out/ is missing or stale (${magnusOutput.errors.join('; ')}) — running compile-magnus`);
		await runProcess(npm, ['run', 'compile-magnus']);
	}
}

async function main() {
	await ensureNodeModules();
	await getElectron();
	await ensureCompiled();

	// Can't require this until after dependencies are installed
	const { getBuiltInExtensions } = await import('./builtInExtensions.ts');
	await getBuiltInExtensions();
}

if (import.meta.main) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * macOS adaptive icon packaging helpers (Assets.car via actool + Info.plist merge).
 * Fail-closed. All external tools are invoked via argv-safe spawn (never shell interpolation).
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export const PREBASE_BUNDLE_ID = 'com.prebase.ide';
export const PREBASE_EXECUTABLE = 'PreBase';
/** Aligns with gulp-electron CFBundleIconName (= productName) and actool --app-icon. */
export const PREBASE_APP_ICON_NAME = 'PreBase';
export const LEGACY_ICNS_NAME = 'PreBase.icns';
export const ADAPTIVE_ICON_RELATIVE = path.join('resources', 'darwin', 'adaptive', 'PreBase.icon');
export const LEGACY_ICNS_RELATIVE = path.join('resources', 'darwin', 'code.icns');

export const DarwinIconErrorCode = {
	NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
	NO_APP_BUNDLE: 'NO_APP_BUNDLE',
	AMBIGUOUS_APP_BUNDLE: 'AMBIGUOUS_APP_BUNDLE',
	WRONG_BUNDLE_ID: 'WRONG_BUNDLE_ID',
	MISSING_EXECUTABLE: 'MISSING_EXECUTABLE',
	MALFORMED_INFO_PLIST: 'MALFORMED_INFO_PLIST',
	ACTOOL_UNAVAILABLE: 'ACTOOL_UNAVAILABLE',
	ACTOOL_FAILED: 'ACTOOL_FAILED',
	MISSING_ASSETS_CAR: 'MISSING_ASSETS_CAR',
	EMPTY_ASSETS_CAR: 'EMPTY_ASSETS_CAR',
	MISSING_PARTIAL_PLIST: 'MISSING_PARTIAL_PLIST',
	MALFORMED_PARTIAL_PLIST: 'MALFORMED_PARTIAL_PLIST',
	UNEXPECTED_APP_ICON_NAME: 'UNEXPECTED_APP_ICON_NAME',
	MISSING_ADAPTIVE_SOURCE: 'MISSING_ADAPTIVE_SOURCE',
	MISSING_LEGACY_FALLBACK: 'MISSING_LEGACY_FALLBACK',
	REJECTED_SOURCE: 'REJECTED_SOURCE',
	PATH_TRAVERSAL: 'PATH_TRAVERSAL',
	PLUTIL_FAILED: 'PLUTIL_FAILED',
	SHELL_FORBIDDEN: 'SHELL_FORBIDDEN',
} as const;

export type DarwinIconErrorCodeName = typeof DarwinIconErrorCode[keyof typeof DarwinIconErrorCode];

export class DarwinIconError extends Error {
	readonly code: DarwinIconErrorCodeName;

	constructor(code: DarwinIconErrorCodeName, message: string) {
		super(message);
		this.name = 'DarwinIconError';
		this.code = code;
	}
}

export type ProcessRunner = (
	command: string,
	args: readonly string[],
	options?: { cwd?: string; env?: NodeJS.ProcessEnv }
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export interface DiscoverOptions {
	bundleId?: string;
	executableName?: string;
	/** Injectable plist reader (tests / non-macOS). */
	readPlist?: (plistPath: string) => Promise<Record<string, unknown>>;
	runner?: ProcessRunner;
}

export interface CompileAdaptiveIconOptions {
	iconSource: string;
	outputDir: string;
	appIconName?: string;
	runner?: ProcessRunner;
	/** Override xcrun binary path (default `xcrun`). */
	xcrun?: string;
}

export interface CompileAdaptiveIconResult {
	assetsCarPath: string;
	partialPlistPath: string;
	appIconName: string;
}

export interface MergeAdaptiveIconOptions {
	appBundlePath: string;
	assetsCarPath: string;
	appIconName?: string;
	legacyIcnsSource?: string;
	runner?: ProcessRunner;
	readPlist?: (plistPath: string) => Promise<Record<string, unknown>>;
	writePlist?: (plistPath: string, data: Record<string, unknown>) => Promise<void>;
}

export interface ValidateSourcesOptions {
	repoRoot: string;
	adaptiveIconPath?: string;
	legacyIcnsPath?: string;
}

export interface ApplyDarwinAdaptiveIconOptions {
	electronDir: string;
	repoRoot: string;
	adaptiveIconPath?: string;
	legacyIcnsPath?: string;
	runner?: ProcessRunner;
	compile?: (options: CompileAdaptiveIconOptions) => Promise<CompileAdaptiveIconResult>;
}

/**
 * Argv-safe process runner. Never sets shell:true. Paths are discrete argv elements.
 */
export function createArgvRunner(spawnImpl: typeof spawn = spawn): ProcessRunner {
	return (command, args, options = {}) => new Promise((resolve, reject) => {
		const child = spawnImpl(command, Array.from(args), {
			cwd: options.cwd,
			env: options.env ?? process.env,
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk: Buffer | string) => { stdout += String(chunk); });
		child.stderr?.on('data', (chunk: Buffer | string) => { stderr += String(chunk); });
		child.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'ENOENT') {
				resolve({ code: null, stdout, stderr: stderr || err.message });
				return;
			}
			reject(err);
		});
		child.on('close', (code) => resolve({ code, stdout, stderr }));
	});
}

export const defaultRunner: ProcessRunner = createArgvRunner();

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Reject absolute paths, traversal, and nested segments in bundle-relative names. */
function assertSafeBundleLeafName(name: string, label: string): void {
	if (
		!name ||
		name.includes('\0') ||
		name.includes('/') ||
		name.includes('\\') ||
		name === '.' ||
		name === '..' ||
		path.isAbsolute(name) ||
		path.basename(name) !== name
	) {
		throw new DarwinIconError(
			DarwinIconErrorCode.PATH_TRAVERSAL,
			`Unsafe ${label}: ${name}`
		);
	}
}

export async function readInfoPlist(
	plistPath: string,
	runner: ProcessRunner = defaultRunner
): Promise<Record<string, unknown>> {
	let raw: string;
	try {
		raw = await fs.readFile(plistPath, 'utf8');
	} catch {
		throw new DarwinIconError(DarwinIconErrorCode.MALFORMED_INFO_PLIST, `Info.plist unreadable: ${plistPath}`);
	}
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new DarwinIconError(DarwinIconErrorCode.MALFORMED_INFO_PLIST, `Info.plist empty: ${plistPath}`);
	}
	if (trimmed.startsWith('{')) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (!isPlainObject(parsed)) {
				throw new Error('not an object');
			}
			return parsed;
		} catch {
			throw new DarwinIconError(DarwinIconErrorCode.MALFORMED_INFO_PLIST, `Info.plist JSON malformed: ${plistPath}`);
		}
	}
	const result = await runner('plutil', ['-convert', 'json', '-o', '-', '--', plistPath]);
	if (result.code !== 0) {
		throw new DarwinIconError(DarwinIconErrorCode.MALFORMED_INFO_PLIST, `plutil failed for ${plistPath}: ${result.stderr || result.stdout}`);
	}
	try {
		const parsed = JSON.parse(result.stdout) as unknown;
		if (!isPlainObject(parsed)) {
			throw new Error('not an object');
		}
		return parsed;
	} catch {
		throw new DarwinIconError(DarwinIconErrorCode.MALFORMED_INFO_PLIST, `plutil JSON malformed for ${plistPath}`);
	}
}

async function writeInfoPlistJson(plistPath: string, data: Record<string, unknown>): Promise<void> {
	await fs.writeFile(plistPath, `${JSON.stringify(data, null, '\t')}\n`, 'utf8');
}

/**
 * Merge CFBundleIconName via plutil -replace (or injectable writer for JSON fixtures).
 * Preserves legacy CFBundleIconFile / other keys; never changes CFBundleIdentifier.
 */
export async function mergeCFBundleIconName(
	plistPath: string,
	iconName: string,
	options: {
		runner?: ProcessRunner;
		readPlist?: (plistPath: string) => Promise<Record<string, unknown>>;
		writePlist?: (plistPath: string, data: Record<string, unknown>) => Promise<void>;
	} = {}
): Promise<void> {
	const runner = options.runner ?? defaultRunner;
	const readPlist = options.readPlist ?? ((p) => readInfoPlist(p, runner));
	const before = await readPlist(plistPath);
	const bundleIdBefore = before.CFBundleIdentifier;

	if (options.writePlist) {
		const next = { ...before, CFBundleIconName: iconName };
		await options.writePlist(plistPath, next);
	} else {
		const raw = (await fs.readFile(plistPath, 'utf8')).trim();
		if (raw.startsWith('{')) {
			await writeInfoPlistJson(plistPath, { ...before, CFBundleIconName: iconName });
		} else {
			// -replace overwrites; -insert is required when the key is absent (older plutil).
			const verb = Object.prototype.hasOwnProperty.call(before, 'CFBundleIconName')
				? '-replace'
				: '-insert';
			const result = await runner('plutil', [
				verb, 'CFBundleIconName', '-string', iconName, '--', plistPath,
			]);
			if (result.code !== 0) {
				throw new DarwinIconError(
					DarwinIconErrorCode.PLUTIL_FAILED,
					`plutil ${verb} CFBundleIconName failed: ${result.stderr || result.stdout}`
				);
			}
		}
	}

	const after = await readPlist(plistPath);
	if (after.CFBundleIdentifier !== bundleIdBefore) {
		throw new DarwinIconError(
			DarwinIconErrorCode.PLUTIL_FAILED,
			'CFBundleIdentifier changed during icon merge — aborting'
		);
	}
	if (after.CFBundleIconName !== iconName) {
		throw new DarwinIconError(
			DarwinIconErrorCode.PLUTIL_FAILED,
			`CFBundleIconName not set to ${iconName}`
		);
	}
}

async function resolveInsideBase(baseDir: string, candidateRelative: string): Promise<string> {
	const resolvedBase = await fs.realpath(baseDir);
	const joined = path.join(resolvedBase, candidateRelative);
	const parent = path.dirname(joined);
	let realParent: string;
	try {
		realParent = await fs.realpath(parent);
	} catch {
		throw new DarwinIconError(
			DarwinIconErrorCode.PATH_TRAVERSAL,
			`Destination parent missing or unresolvable: ${parent}`
		);
	}
	const resolvedCandidate = path.join(realParent, path.basename(joined));
	const rel = path.relative(resolvedBase, resolvedCandidate);
	if (rel.startsWith('..') || path.isAbsolute(rel)) {
		throw new DarwinIconError(
			DarwinIconErrorCode.PATH_TRAVERSAL,
			`Refusing path outside bundle: ${candidateRelative}`
		);
	}
	return resolvedCandidate;
}

/**
 * Discover the PreBase .app under an electron download directory.
 * Rejects zero / ambiguous / wrong-ID / missing-executable / malformed-plist bundles.
 */
export async function discoverPreBaseAppBundle(
	electronDir: string,
	options: DiscoverOptions = {}
): Promise<string> {
	const bundleId = options.bundleId ?? PREBASE_BUNDLE_ID;
	const executableName = options.executableName ?? PREBASE_EXECUTABLE;
	const runner = options.runner ?? defaultRunner;
	const readPlist = options.readPlist ?? ((p: string) => readInfoPlist(p, runner));

	let entries: string[];
	try {
		entries = await fs.readdir(electronDir);
	} catch {
		throw new DarwinIconError(DarwinIconErrorCode.NO_APP_BUNDLE, `Electron dir missing: ${electronDir}`);
	}

	const appNames = entries.filter((e) => e.endsWith('.app'));
	if (appNames.length === 0) {
		throw new DarwinIconError(DarwinIconErrorCode.NO_APP_BUNDLE, `No .app bundles in ${electronDir}`);
	}

	const matches: string[] = [];
	const wrongId: string[] = [];

	for (const appName of appNames) {
		const appPath = path.join(electronDir, appName);
		const plistPath = path.join(appPath, 'Contents', 'Info.plist');
		let plist: Record<string, unknown>;
		try {
			plist = await readPlist(plistPath);
		} catch (err) {
			if (err instanceof DarwinIconError) {
				throw err;
			}
			throw new DarwinIconError(DarwinIconErrorCode.MALFORMED_INFO_PLIST, `Cannot read ${plistPath}`);
		}

		const id = plist.CFBundleIdentifier;
		if (typeof id !== 'string' || !id) {
			throw new DarwinIconError(DarwinIconErrorCode.MALFORMED_INFO_PLIST, `Missing CFBundleIdentifier in ${plistPath}`);
		}
		if (id !== bundleId) {
			wrongId.push(appPath);
			continue;
		}

		const execFromPlist = typeof plist.CFBundleExecutable === 'string' ? plist.CFBundleExecutable : executableName;
		assertSafeBundleLeafName(execFromPlist, 'CFBundleExecutable');
		const execPath = path.join(appPath, 'Contents', 'MacOS', execFromPlist);
		const macosDir = path.join(appPath, 'Contents', 'MacOS');
		let realMacos: string;
		let realExec: string;
		try {
			realMacos = await fs.realpath(macosDir);
			realExec = await fs.realpath(execPath);
		} catch {
			throw new DarwinIconError(
				DarwinIconErrorCode.MISSING_EXECUTABLE,
				`Missing executable ${execPath}`
			);
		}
		const execRel = path.relative(realMacos, realExec);
		if (execRel.startsWith('..') || path.isAbsolute(execRel)) {
			throw new DarwinIconError(
				DarwinIconErrorCode.PATH_TRAVERSAL,
				`Executable resolves outside MacOS/: ${execPath}`
			);
		}

		matches.push(appPath);
	}

	if (matches.length === 1) {
		return matches[0];
	}
	if (matches.length > 1) {
		throw new DarwinIconError(
			DarwinIconErrorCode.AMBIGUOUS_APP_BUNDLE,
			`Multiple PreBase app bundles: ${matches.join(', ')}`
		);
	}
	if (wrongId.length > 0) {
		throw new DarwinIconError(
			DarwinIconErrorCode.WRONG_BUNDLE_ID,
			`Found .app but CFBundleIdentifier is not ${bundleId}`
		);
	}
	throw new DarwinIconError(DarwinIconErrorCode.NO_APP_BUNDLE, `No matching PreBase .app in ${electronDir}`);
}

/**
 * Compile a .icon bundle to Assets.car via `xcrun actool` (argv-safe).
 * Validates outputs and expected --app-icon catalog name.
 */
export async function compileAdaptiveIcon(
	options: CompileAdaptiveIconOptions
): Promise<CompileAdaptiveIconResult> {
	const appIconName = options.appIconName ?? PREBASE_APP_ICON_NAME;
	const runner = options.runner ?? defaultRunner;
	const xcrun = options.xcrun ?? 'xcrun';
	const iconSource = path.resolve(options.iconSource);
	const outputDir = path.resolve(options.outputDir);

	let sourceStat;
	try {
		sourceStat = await fs.stat(iconSource);
	} catch {
		throw new DarwinIconError(DarwinIconErrorCode.MISSING_ADAPTIVE_SOURCE, `Adaptive icon missing: ${iconSource}`);
	}
	if (!sourceStat.isDirectory() || !iconSource.endsWith('.icon')) {
		throw new DarwinIconError(DarwinIconErrorCode.REJECTED_SOURCE, `Adaptive source must be a .icon directory: ${iconSource}`);
	}

	await fs.mkdir(outputDir, { recursive: true });

	const args = [
		'actool',
		iconSource,
		'--compile', outputDir,
		'--output-format', 'human-readable-text',
		'--notices',
		'--warnings',
		'--errors',
		'--output-partial-info-plist', path.join(outputDir, 'partial.plist'),
		'--app-icon', appIconName,
		'--include-all-app-icons',
		'--enable-on-demand-resources', 'NO',
		'--development-region', 'en',
		'--target-device', 'mac',
		'--minimum-deployment-target', '26.0',
		'--platform', 'macosx',
	];

	const result = await runner(xcrun, args);
	if (result.code === null) {
		throw new DarwinIconError(DarwinIconErrorCode.ACTOOL_UNAVAILABLE, `xcrun/actool unavailable: ${result.stderr}`);
	}
	const actoolCombined = `${result.stdout}\n${result.stderr}`;
	// actool may print /* com.apple.actool.errors */ and still exit 0 in some environments.
	if (result.code !== 0 || /com\.apple\.actool\.errors/.test(actoolCombined)) {
		throw new DarwinIconError(
			DarwinIconErrorCode.ACTOOL_FAILED,
			`actool exited ${result.code}: ${result.stderr || result.stdout}`
		);
	}

	const assetsCarPath = path.join(outputDir, 'Assets.car');
	const partialPlistPath = path.join(outputDir, 'partial.plist');

	let assetsStat;
	try {
		assetsStat = await fs.stat(assetsCarPath);
	} catch {
		throw new DarwinIconError(DarwinIconErrorCode.MISSING_ASSETS_CAR, `Assets.car missing after actool: ${assetsCarPath}`);
	}
	if (assetsStat.size <= 0) {
		throw new DarwinIconError(DarwinIconErrorCode.EMPTY_ASSETS_CAR, `Assets.car empty: ${assetsCarPath}`);
	}

	let partialRaw: string;
	try {
		partialRaw = await fs.readFile(partialPlistPath, 'utf8');
	} catch {
		throw new DarwinIconError(DarwinIconErrorCode.MISSING_PARTIAL_PLIST, `partial.plist missing: ${partialPlistPath}`);
	}
	let partial: Record<string, unknown>;
	try {
		const trimmed = partialRaw.trim();
		if (trimmed.startsWith('{')) {
			partial = JSON.parse(trimmed) as Record<string, unknown>;
		} else {
			const converted = await runner('plutil', ['-convert', 'json', '-o', '-', '--', partialPlistPath]);
			if (converted.code !== 0) {
				throw new Error(converted.stderr);
			}
			partial = JSON.parse(converted.stdout) as Record<string, unknown>;
		}
	} catch {
		throw new DarwinIconError(DarwinIconErrorCode.MALFORMED_PARTIAL_PLIST, `partial.plist malformed: ${partialPlistPath}`);
	}

	// --app-icon must declare CFBundleIconName in the partial plist; do not fall back to CFBundleIconFile.
	const catalogName = partial.CFBundleIconName;
	if (catalogName !== appIconName) {
		throw new DarwinIconError(
			DarwinIconErrorCode.UNEXPECTED_APP_ICON_NAME,
			`Expected CFBundleIconName ${appIconName}, got ${String(catalogName)}`
		);
	}

	return { assetsCarPath, partialPlistPath, appIconName };
}

export async function validateAdaptiveSources(options: ValidateSourcesOptions): Promise<void> {
	const adaptive = options.adaptiveIconPath ?? path.join(options.repoRoot, ADAPTIVE_ICON_RELATIVE);
	const legacy = options.legacyIcnsPath ?? path.join(options.repoRoot, LEGACY_ICNS_RELATIVE);

	let adaptiveStat;
	try {
		adaptiveStat = await fs.stat(adaptive);
	} catch {
		throw new DarwinIconError(DarwinIconErrorCode.MISSING_ADAPTIVE_SOURCE, `Missing adaptive icon: ${adaptive}`);
	}
	if (!adaptiveStat.isDirectory() || path.basename(adaptive) !== 'PreBase.icon') {
		throw new DarwinIconError(DarwinIconErrorCode.REJECTED_SOURCE, `Rejected adaptive source: ${adaptive}`);
	}

	try {
		const legacyStat = await fs.stat(legacy);
		if (!legacyStat.isFile() || legacyStat.size <= 0) {
			throw new DarwinIconError(DarwinIconErrorCode.MISSING_LEGACY_FALLBACK, `Legacy icns empty: ${legacy}`);
		}
	} catch (err) {
		if (err instanceof DarwinIconError) {
			throw err;
		}
		throw new DarwinIconError(DarwinIconErrorCode.MISSING_LEGACY_FALLBACK, `Missing legacy icns: ${legacy}`);
	}
}

/**
 * Install Assets.car + CFBundleIconName into a discovered .app; preserve legacy PreBase.icns.
 */
export async function mergeAdaptiveIconIntoApp(options: MergeAdaptiveIconOptions): Promise<void> {
	const appIconName = options.appIconName ?? PREBASE_APP_ICON_NAME;
	const appBundlePath = path.resolve(options.appBundlePath);
	const resourcesDir = path.join(appBundlePath, 'Contents', 'Resources');
	const plistPath = path.join(appBundlePath, 'Contents', 'Info.plist');

	await fs.mkdir(resourcesDir, { recursive: true });
	const destCar = await resolveInsideBase(appBundlePath, path.join('Contents', 'Resources', 'Assets.car'));
	await fs.copyFile(options.assetsCarPath, destCar);

	if (options.legacyIcnsSource) {
		const destIcns = await resolveInsideBase(appBundlePath, path.join('Contents', 'Resources', LEGACY_ICNS_NAME));
		await fs.copyFile(options.legacyIcnsSource, destIcns);
	}

	const runner = options.runner ?? defaultRunner;
	const readPlist = options.readPlist ?? ((p: string) => readInfoPlist(p, runner));
	const before = await readPlist(plistPath);
	const legacyIconFile = before.CFBundleIconFile;

	await mergeCFBundleIconName(plistPath, appIconName, {
		runner,
		readPlist,
		writePlist: options.writePlist,
	});

	const after = await readPlist(plistPath);
	if (legacyIconFile !== undefined && after.CFBundleIconFile !== legacyIconFile) {
		throw new DarwinIconError(
			DarwinIconErrorCode.PLUTIL_FAILED,
			'Legacy CFBundleIconFile was altered during merge'
		);
	}
	if (after.CFBundleIdentifier !== before.CFBundleIdentifier) {
		throw new DarwinIconError(
			DarwinIconErrorCode.PLUTIL_FAILED,
			'CFBundleIdentifier was altered during merge'
		);
	}
}

/**
 * Full packaging step: discover → compile → merge. Cleans temp compile dir.
 */
export async function applyDarwinAdaptiveIcon(options: ApplyDarwinAdaptiveIconOptions): Promise<string> {
	const appPath = await discoverPreBaseAppBundle(options.electronDir, { runner: options.runner });
	const adaptiveSource = options.adaptiveIconPath ?? path.join(options.repoRoot, ADAPTIVE_ICON_RELATIVE);
	const legacyIcns = options.legacyIcnsPath ?? path.join(options.repoRoot, LEGACY_ICNS_RELATIVE);
	await validateAdaptiveSources({
		repoRoot: options.repoRoot,
		adaptiveIconPath: adaptiveSource,
		legacyIcnsPath: legacyIcns,
	});

	const compile = options.compile ?? compileAdaptiveIcon;

	const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prebase-darwin-icon-'));
	try {
		const compiled = await compile({
			iconSource: adaptiveSource,
			outputDir: tmp,
			appIconName: PREBASE_APP_ICON_NAME,
			runner: options.runner,
		});
		await mergeAdaptiveIconIntoApp({
			appBundlePath: appPath,
			assetsCarPath: compiled.assetsCarPath,
			appIconName: compiled.appIconName,
			legacyIcnsSource: legacyIcns,
			runner: options.runner,
		});
		const now = new Date();
		await fs.utimes(appPath, now, now);
		return appPath;
	} finally {
		await fs.rm(tmp, { recursive: true, force: true });
	}
}

/** Stable output path for gulp-electron `darwinAssetsCar`. */
export function compiledAssetsCarPath(repoRoot: string): string {
	return path.join(repoRoot, '.build', 'darwin', 'adaptive', 'Assets.car');
}

/**
 * Compile adaptive icon into `.build/darwin/adaptive/Assets.car` for packaging.
 */
export async function ensureCompiledAssetsCarForPackaging(
	repoRoot: string,
	runner: ProcessRunner = defaultRunner
): Promise<string> {
	if (process.platform !== 'darwin') {
		throw new DarwinIconError(DarwinIconErrorCode.ACTOOL_UNAVAILABLE, 'Assets.car compile requires darwin');
	}
	await validateAdaptiveSources({ repoRoot });
	const outputDir = path.join(repoRoot, '.build', 'darwin', 'adaptive');
	const result = await compileAdaptiveIcon({
		iconSource: path.join(repoRoot, ADAPTIVE_ICON_RELATIVE),
		outputDir,
		appIconName: PREBASE_APP_ICON_NAME,
		runner,
	});
	return result.assetsCarPath;
}

/**
 * Dev Electron sync. Returns null when Electron is not installed yet.
 * Fail-closed when a .app exists but identity/adaptive apply fails.
 */
export async function syncDevelopmentAdaptiveIcon(
	repoRoot: string,
	runner: ProcessRunner = defaultRunner
): Promise<{ appPath: string; assetsCarPath: string } | null> {
	if (process.platform !== 'darwin') {
		return null;
	}
	const electronDir = path.join(repoRoot, '.build', 'electron');
	let entries: string[];
	try {
		entries = await fs.readdir(electronDir);
	} catch {
		return null;
	}
	if (!entries.some((e) => e.endsWith('.app'))) {
		return null;
	}
	const appPath = await applyDarwinAdaptiveIcon({
		electronDir,
		repoRoot,
		runner,
	});
	const assetsCarPath = path.join(appPath, 'Contents', 'Resources', 'Assets.car');
	let carStat;
	try {
		carStat = await fs.stat(assetsCarPath);
	} catch {
		throw new DarwinIconError(
			DarwinIconErrorCode.MISSING_ASSETS_CAR,
			`Assets.car missing after adaptive sync: ${assetsCarPath}`
		);
	}
	if (carStat.size <= 0) {
		throw new DarwinIconError(
			DarwinIconErrorCode.EMPTY_ASSETS_CAR,
			`Assets.car empty after adaptive sync: ${assetsCarPath}`
		);
	}
	return { appPath, assetsCarPath };
}

async function cliMain(argv: string[]): Promise<void> {
	const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
	const cmd = argv[0] ?? 'compile';
	if (cmd === 'compile') {
		const car = await ensureCompiledAssetsCarForPackaging(repoRoot);
		console.log(JSON.stringify({ ok: true, assetsCarPath: car }, null, 2));
		return;
	}
	if (cmd === 'sync-dev') {
		const result = await syncDevelopmentAdaptiveIcon(repoRoot);
		console.log(JSON.stringify({ ok: true, ...(result ?? { skipped: 'electron-not-installed' }) }, null, 2));
		return;
	}
	throw new Error(`usage: prebaseDarwinIcon.ts [compile|sync-dev]`);
}

if (import.meta.main) {
	cliMain(process.argv.slice(2)).catch((err) => {
		console.error(err instanceof DarwinIconError ? `${err.code}: ${err.message}` : err);
		process.exit(1);
	});
}

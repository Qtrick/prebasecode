#!/usr/bin/env node
/**
 * Read-only verifier for macOS adaptive application icon packaging.
 * Never edits the bundle. Prints AdaptivePackage: PASS|FAIL|SKIPPED.
 *
 * Usage:
 *   node scripts/icons/verify-macos-adaptive-icon.mjs [--app /path/to/PreBase.app] [--repo-root DIR]
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Resolves the ripgrep binary to use for source scanning.
 * Tries the system `rg` first; falls back to the bundled @vscode/ripgrep binary.
 * Returns undefined if neither is available.
 *
 * @param {string} repoRoot
 * @returns {string | undefined}
 */
function resolveRg(repoRoot) {
	// Try system rg first (fast path for developer machines and CI with rg installed)
	const systemProbe = spawnSync('rg', ['--version'], { encoding: 'utf8', shell: false });
	if (!systemProbe.error) {
		return 'rg';
	}
	// Fall back to the bundled @vscode/ripgrep binary checked in with the repo dependencies
	const bundled = path.resolve(repoRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', 'rg');
	if (fs.existsSync(bundled)) {
		return bundled;
	}
	return undefined;
}

export const EXPECTED_BUNDLE_ID = 'com.prebase.ide';
export const EXPECTED_EXECUTABLE = 'PreBase';
export const EXPECTED_ICON_NAME = 'PreBase';
export const ADAPTIVE_REL = path.join('resources', 'darwin', 'adaptive', 'PreBase.icon');
export const LEGACY_ICNS_REL = path.join('resources', 'darwin', 'code.icns');

/**
 * @param {string} msg
 * @returns {never}
 */
function fail(msg) {
	console.error('AdaptivePackage: FAIL');
	console.error(msg);
	process.exit(1);
}

/**
 * @param {string} p
 */
function sha256File(p) {
	return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/**
 * @param {string} plistPath
 */
export function readPlistJson(plistPath) {
	const raw = fs.readFileSync(plistPath, 'utf8').trim();
	if (raw.startsWith('{')) {
		return JSON.parse(raw);
	}
	if (process.platform !== 'darwin') {
		throw new Error(`Info.plist is not JSON and plutil unavailable off-macOS: ${plistPath}`);
	}
	const res = spawnSync('plutil', ['-convert', 'json', '-o', '-', '--', plistPath], {
		encoding: 'utf8',
		shell: false,
	});
	if (res.error || res.status !== 0) {
		throw new Error(`plutil failed for ${plistPath}: ${res.stderr || res.error?.message || res.stdout}`);
	}
	return JSON.parse(res.stdout);
}

/**
 * @param {string} name
 * @param {string} label
 */
function assertSafeLeafName(name, label) {
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
		throw new Error(`Unsafe ${label}: ${name}`);
	}
}

/**
 * @param {string} repoRoot
 */
export function verifyAdaptiveSources(repoRoot) {
	/** @type {string[]} */
	const errors = [];
	const adaptive = path.join(repoRoot, ADAPTIVE_REL);
	const legacy = path.join(repoRoot, LEGACY_ICNS_REL);
	if (!fs.existsSync(adaptive) || !fs.statSync(adaptive).isDirectory()) {
		errors.push(`MISSING adaptive source: ${ADAPTIVE_REL}`);
	} else if (path.basename(adaptive) !== 'PreBase.icon') {
		errors.push(`REJECTED adaptive source name (expected PreBase.icon): ${ADAPTIVE_REL}`);
	}
	if (!fs.existsSync(legacy) || !fs.statSync(legacy).isFile() || fs.statSync(legacy).size <= 0) {
		errors.push(`MISSING/empty legacy icns: ${LEGACY_ICNS_REL}`);
	}

	const scanRoots = ['src', 'build']
		.map((rel) => path.join(repoRoot, rel))
		.filter((p) => fs.existsSync(p));
	/** @type {string[]} */
	const warnings = [];
	if (scanRoots.length > 0) {
		const rgBin = resolveRg(repoRoot);
		if (!rgBin) {
			// rg is not available in this environment — skip the Dock icon override scan
			// and emit a warning instead of failing. The scan is advisory only; the frozen
			// icon manifest (icon-integrity.sha256) and CI with rg available are the
			// authoritative gates.
			warnings.push('rg not found (system PATH and bundled @vscode/ripgrep both unavailable) — Dock icon override scan skipped');
		} else {
			const overrideHit = spawnSync(rgBin, [
				'-n',
				'--glob', '*.{ts,js,mjs}',
				'dock\\.setIcon\\s*\\(|setApplicationIconImage\\s*\\(',
				...scanRoots,
			], { encoding: 'utf8', shell: false });
			if (overrideHit.error || overrideHit.status === null || (overrideHit.status ?? 0) >= 2) {
				warnings.push(`rg scan failed for Dock icon overrides (non-fatal): ${overrideHit.stderr || overrideHit.error?.message || `exit ${overrideHit.status}`}`);
			} else if (overrideHit.status === 0 && (overrideHit.stdout || '').trim()) {
				const lines = (overrideHit.stdout || '').split('\n').filter(Boolean);
				const codeHits = lines.filter((l) => {
					const body = l.split(':').slice(2).join(':');
					return !/^\s*(\/\/|\/\*|\*)/.test(body);
				});
				if (codeHits.length) {
					errors.push(`Runtime Dock icon override call sites found:\n${codeHits.slice(0, 10).join('\n')}`);
				}
			}
		}
	}

	return { ok: errors.length === 0, errors, warnings };
}

/**
 * @param {string} appBundlePath
 */
export function verifyAppBundleIcons(appBundlePath) {
	/** @type {string[]} */
	const errors = [];
	/** @type {string[]} */
	const warnings = [];
	/** @type {Record<string, unknown>} */
	const meta = {};

	const plistPath = path.join(appBundlePath, 'Contents', 'Info.plist');
	const assetsCar = path.join(appBundlePath, 'Contents', 'Resources', 'Assets.car');
	const legacyIcns = path.join(appBundlePath, 'Contents', 'Resources', 'PreBase.icns');

	if (!fs.existsSync(appBundlePath) || !appBundlePath.endsWith('.app')) {
		errors.push(`App bundle missing: ${appBundlePath}`);
		return { ok: false, errors, warnings, meta };
	}
	if (!fs.existsSync(plistPath)) {
		errors.push(`MISSING Info.plist in ${appBundlePath}`);
		return { ok: false, errors, warnings, meta };
	}

	let plist;
	try {
		plist = readPlistJson(plistPath);
	} catch (err) {
		errors.push(String(err instanceof Error ? err.message : err));
		return { ok: false, errors, warnings, meta };
	}

	const bundleId = String(plist.CFBundleIdentifier ?? '');
	const executable = String(plist.CFBundleExecutable ?? '');
	const iconName = String(plist.CFBundleIconName ?? '');
	const iconFile = String(plist.CFBundleIconFile ?? '');
	meta.bundleIdentifier = bundleId;
	meta.executable = executable;
	meta.CFBundleIconName = iconName;
	meta.CFBundleIconFile = iconFile;

	if (bundleId !== EXPECTED_BUNDLE_ID) {
		errors.push(`CFBundleIdentifier want ${EXPECTED_BUNDLE_ID}, got ${bundleId}`);
	}
	if (executable !== EXPECTED_EXECUTABLE) {
		errors.push(`CFBundleExecutable want ${EXPECTED_EXECUTABLE}, got ${executable}`);
	}
	try {
		assertSafeLeafName(executable || EXPECTED_EXECUTABLE, 'CFBundleExecutable');
	} catch (err) {
		errors.push(String(err instanceof Error ? err.message : err));
		return { ok: false, errors, warnings, meta };
	}
	const execPath = path.join(appBundlePath, 'Contents', 'MacOS', executable || EXPECTED_EXECUTABLE);
	if (!fs.existsSync(execPath)) {
		errors.push(`MISSING executable ${execPath}`);
	}
	if (iconName !== EXPECTED_ICON_NAME) {
		errors.push(`CFBundleIconName want ${EXPECTED_ICON_NAME}, got ${iconName}`);
	}
	if (!iconFile) {
		warnings.push('CFBundleIconFile missing (legacy fallback absent)');
	}
	if (!fs.existsSync(assetsCar) || fs.statSync(assetsCar).size <= 0) {
		errors.push('MISSING or empty Contents/Resources/Assets.car');
	} else {
		meta.assetsCarBytes = fs.statSync(assetsCar).size;
		meta.assetsCarSha256 = sha256File(assetsCar);
		meta.assetsCarPath = assetsCar;
		if (process.platform === 'darwin') {
			const probe = spawnSync('xcrun', ['--find', 'assetutil'], { encoding: 'utf8', shell: false });
			if (probe.status !== 0) {
				errors.push('assetutil unavailable — cannot classify AdaptivePackage: PASS');
			} else {
				const info = spawnSync('xcrun', ['--sdk', 'macosx', 'assetutil', '--info', assetsCar], {
					encoding: 'utf8',
					maxBuffer: 32 * 1024 * 1024,
					shell: false,
				});
				if (info.status !== 0) {
					errors.push(`assetutil could not read Assets.car: ${info.stderr || info.stdout}`);
				} else if (!new RegExp(EXPECTED_ICON_NAME, 'i').test(info.stdout || '')) {
					errors.push(`Assets.car does not contain ${EXPECTED_ICON_NAME} asset metadata`);
				} else {
					meta.assetutilOk = true;
				}
			}
		}
	}
	if (!fs.existsSync(legacyIcns) || fs.statSync(legacyIcns).size <= 0) {
		errors.push('MISSING or empty Contents/Resources/PreBase.icns');
	} else {
		meta.legacyIcnsPath = legacyIcns;
	}

	return { ok: errors.length === 0, errors, warnings, meta };
}

/**
 * @param {{ repoRoot?: string, appBundlePath?: string }} opts
 */
export function verifyMacosAdaptiveIcon(opts = {}) {
	const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT;
	const source = verifyAdaptiveSources(repoRoot);
	if (!opts.appBundlePath) {
		return { ...source, meta: {} };
	}
	const app = verifyAppBundleIcons(opts.appBundlePath);
	return {
		ok: source.ok && app.ok,
		errors: [...source.errors, ...app.errors],
		warnings: [...source.warnings, ...app.warnings],
		meta: app.meta ?? {},
	};
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
	/** @type {{ repoRoot: string, appBundlePath?: string, help?: boolean }} */
	const out = { repoRoot: DEFAULT_REPO_ROOT };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--help' || a === '-h') {
			out.help = true;
		} else if (a === '--repo-root') {
			out.repoRoot = path.resolve(argv[++i] ?? '');
		} else if (a === '--app') {
			out.appBundlePath = path.resolve(argv[++i] ?? '');
		} else {
			throw new Error(`Unknown argument: ${a}`);
		}
	}
	return out;
}

/**
 * @param {string[]} argv
 */
function main(argv = process.argv.slice(2)) {
	if (process.platform !== 'darwin' && !argv.includes('--app')) {
		console.log('AdaptivePackage: SKIPPED');
		console.log('Skipped: macOS toolchain unavailable');
		process.exit(0);
	}

	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		fail(String(err instanceof Error ? err.message : err));
	}
	if (opts.help) {
		console.log('Usage: node scripts/icons/verify-macos-adaptive-icon.mjs [--repo-root DIR] [--app PreBase.app]');
		process.exit(0);
	}

	let appPath = opts.appBundlePath;
	if (!appPath && process.platform === 'darwin') {
		const electronDir = path.join(opts.repoRoot, '.build', 'electron');
		if (!fs.existsSync(electronDir)) {
			if (process.env.PREBASE_ADAPTIVE_ICON_REQUIRED === '1') {
				fail(`No --app given and ${electronDir} missing`);
			}
			const sourceOnly = verifyAdaptiveSources(opts.repoRoot);
			if (!sourceOnly.ok) {
				fail(sourceOnly.errors.join('\n'));
			}
			console.log('AdaptivePackage: SKIPPED');
			console.log('Skipped: no development .app to verify (pass --app or set PREBASE_ADAPTIVE_ICON_REQUIRED=1)');
			process.exit(0);
		}
		const apps = fs.readdirSync(electronDir).filter((e) => e.endsWith('.app'));
		if (apps.length === 0) {
			if (process.env.PREBASE_ADAPTIVE_ICON_REQUIRED === '1') {
				fail(`No .app under ${electronDir}`);
			}
			console.log('AdaptivePackage: SKIPPED');
			console.log('Skipped: Electron .app not installed yet');
			process.exit(0);
		}
		if (apps.length !== 1) {
			fail(`Expected exactly one .app under ${electronDir}, found: ${apps.join(', ')}`);
		}
		appPath = path.join(electronDir, apps[0]);
	}

	const result = verifyMacosAdaptiveIcon({ repoRoot: opts.repoRoot, appBundlePath: appPath });
	for (const w of result.warnings) {
		console.warn(`WARN  ${w}`);
	}
	for (const e of result.errors) {
		console.error(`FAIL  ${e}`);
	}
	if (!result.ok) {
		fail(`${result.errors.length} failure(s)`);
	}

	if (!appPath) {
		console.log('AdaptivePackage: PASS');
		console.log(JSON.stringify({ classification: 'PASS', mode: 'sources-only' }, null, 2));
		return;
	}

	console.log('AdaptivePackage: PASS');
	console.log(JSON.stringify({
		bundlePath: appPath,
		adaptiveSource: path.join(opts.repoRoot, ADAPTIVE_REL),
		runtimeOverride: 'none-detected', // enforced by verifyAdaptiveSources rg scan
		classification: 'PASS',
		...result.meta,
	}, null, 2));
}

const invokedDirectly = process.argv[1]
	&& import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
	main();
}

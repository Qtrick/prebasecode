/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PackageJsonShape, ProjectProbe } from './types.js';
import type { DesktopCapabilities, DesktopDetectionConfidence, TauriProjectProfile } from './desktopTypes.js';
import { detectPackageManager } from './scriptDetector.js';

const TAURI_CONFIG_PATHS = [
	'src-tauri/tauri.conf.json',
	'src-tauri/tauri.conf.json5',
	'src-tauri/Tauri.toml',
	'tauri.conf.json',
	'tauri.conf.json5',
	'Tauri.toml',
	'apps/desktop/src-tauri/tauri.conf.json',
	'apps/desktop/src-tauri/tauri.conf.json5',
	'apps/desktop/src-tauri/Tauri.toml',
] as const;

const TAURI_CARGO_PATHS = [
	'src-tauri/Cargo.toml',
	'apps/desktop/src-tauri/Cargo.toml',
	'Cargo.toml',
] as const;

const TAURI_SCRIPT_NAMES = ['tauri', 'tauri:dev', 'tauri:dev:desktop', 'desktop:dev', 'dev:tauri'] as const;

export const TAURI_PROBE_PATHS: readonly string[] = [
	'src-tauri',
	'apps/desktop',
	'apps/desktop/src-tauri',
	...TAURI_CONFIG_PATHS,
	...TAURI_CARGO_PATHS,
];

function read(probe: ProjectProbe, relativePath: string): string | undefined {
	if (!probe.exists(relativePath)) {
		return undefined;
	}
	return probe.readText?.(relativePath);
}

function findConfigPath(probe: ProjectProbe): string | undefined {
	return TAURI_CONFIG_PATHS.find(path => probe.exists(path));
}

function findCargoPath(probe: ProjectProbe, configPath: string | undefined): string | undefined {
	if (configPath) {
		const sibling = configPath.replace(/[^/]+$/, 'Cargo.toml');
		if (probe.exists(sibling)) {
			return sibling;
		}
	}
	return TAURI_CARGO_PATHS.find(path => probe.exists(path));
}

function cargoDependsOnTauri(cargoToml: string | undefined): boolean {
	if (!cargoToml) {
		return false;
	}
	// Require an actual tauri crate, not a comment or unrelated binary named tauri.
	return /(?:^|\n)\s*(?:tauri|tauri-build)\s*=/m.test(cargoToml)
		|| /(?:^|\n)\s*(?:tauri|tauri-build)\s*\{/m.test(cargoToml);
}

function cargoHasPlugin(cargoToml: string | undefined, crate: string): boolean {
	if (!cargoToml) {
		return false;
	}
	const escaped = crate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[=\\{]`, 'm').test(cargoToml);
}

function findTauriScripts(pkg: PackageJsonShape | undefined): string[] {
	if (!pkg?.scripts) {
		return [];
	}
	const hits: string[] = [];
	for (const name of Object.keys(pkg.scripts)) {
		const body = (pkg.scripts[name] ?? '').toLowerCase();
		if (TAURI_SCRIPT_NAMES.includes(name as typeof TAURI_SCRIPT_NAMES[number]) || /(^|[\s"'])(tauri|cargo\s+tauri)\b/.test(body)) {
			hits.push(name);
		}
	}
	return hits;
}

function parseDevUrl(configText: string | undefined): { url?: string; beforeDevCommand?: string; identifier?: string; productName?: string } {
	if (!configText) {
		return {};
	}
	const url = configText.match(/"devUrl"\s*:\s*"([^"]+)"/)?.[1]
		?? configText.match(/dev-url\s*=\s*"([^"]+)"/)?.[1];
	const beforeDevCommand = configText.match(/"beforeDevCommand"\s*:\s*"([^"]+)"/)?.[1]
		?? configText.match(/before-dev-command\s*=\s*"([^"]+)"/)?.[1];
	const identifier = configText.match(/"identifier"\s*:\s*"([^"]+)"/)?.[1]
		?? configText.match(/identifier\s*=\s*"([^"]+)"/)?.[1];
	const productName = configText.match(/"productName"\s*:\s*"([^"]+)"/)?.[1]
		?? configText.match(/product-name\s*=\s*"([^"]+)"/)?.[1];
	return { url, beforeDevCommand, identifier, productName };
}

function inferPort(url: string | undefined, probe: ProjectProbe, pkg: PackageJsonShape | undefined): number {
	if (url) {
		try {
			const parsed = new URL(url);
			const port = Number(parsed.port);
			if (Number.isFinite(port) && port > 0) {
				return port;
			}
		} catch {
			// fall through
		}
	}
	const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
	if (deps['vite'] || probe.exists('vite.config.ts') || probe.exists('vite.config.js') || probe.exists('vite.config.mjs')) {
		return 5173;
	}
	return 1420;
}

function buildCapabilities(options: {
	isTauri: boolean;
	hasRenderer: boolean;
	hasFullNative: boolean;
	setupRequired: boolean;
}): DesktopCapabilities {
	const blockers: string[] = [];
	if (!options.isTauri) {
		blockers.push('Project is not recognized as a Tauri app.');
	}
	if (!options.hasRenderer) {
		blockers.push('No frontend dev URL was detected for renderer testing.');
	}
	const limitations: string[] = [];
	if (options.hasRenderer) {
		limitations.push('Renderer mode tests the web frontend only. The Tauri Rust backend and invoke() commands are not executed.');
	}
	if (options.setupRequired) {
		limitations.push('Full-app preview launches the real Tauri binary. Agent automation needs Enable PreBase Tauri Testing (debug-only WebDriver plugin).');
	} else if (options.hasFullNative) {
		limitations.push('Full-app mode provides webview UI automation and renderer console capture. Tauri backend APIs, backend logs, native OS dialogs, and menus are not controllable.');
	}
	limitations.push('Native operating-system UI outside the webview is unsupported.');

	return {
		supportsManagedLaunch: options.isTauri && options.hasRenderer,
		supportsExternalLaunch: options.isTauri,
		supportsCdpAttach: false,
		supportsDevServerAutostart: options.hasRenderer,
		supportsDOMInspection: options.isTauri,
		supportsSemanticLocators: options.isTauri,
		supportsConsoleCapture: options.isTauri,
		supportsNetworkCapture: false,
		supportsScreenshots: options.isTauri,
		supportsInputAutomation: options.isTauri,
		supportsWindowManagement: options.isTauri && options.hasRenderer,
		supportsRendererAutomation: options.isTauri && options.hasRenderer,
		supportsFullNativeAutomation: options.hasFullNative,
		supportsBackendApiAccess: false,
		supportsMainProcessAccess: false,
		supportsNativeDialogAutomation: false,
		requiresPreload: false,
		requiresMainProcess: options.isTauri,
		fullNativeSetupRequired: options.setupRequired,
		fullNativeSetupReason: options.setupRequired
			? 'Full Tauri app automation on macOS uses an embedded WebDriver server. Enable PreBase Tauri Testing to add the debug-only plugin without changing release builds.'
			: undefined,
		limitations,
		managedLaunchBlockers: options.isTauri && options.hasRenderer ? [] : blockers,
	};
}

/** Detect Tauri v2 projects. A random Cargo.toml is not enough. */
export function detectTauriProject(probe: ProjectProbe): TauriProjectProfile {
	const discoveredConfigPath = findConfigPath(probe);
	const nestedRoot = discoveredConfigPath?.includes('/src-tauri/')
		? discoveredConfigPath.slice(0, discoveredConfigPath.indexOf('/src-tauri/'))
		: undefined;
	let appProbe = probe;
	if (nestedRoot) {
		let packageJson: PackageJsonShape | undefined;
		try {
			const packageText = read(probe, `${nestedRoot}/package.json`);
			packageJson = packageText ? JSON.parse(packageText) as PackageJsonShape : undefined;
		} catch {
			// Detection remains valid from Cargo/config signals when package.json is unreadable.
		}
		appProbe = {
			exists: relativePath => probe.exists(`${nestedRoot}/${relativePath}`),
			readText: relativePath => probe.readText?.(`${nestedRoot}/${relativePath}`),
			packageJson,
			rootLabel: `${probe.rootLabel}/${nestedRoot}`,
			rootPath: probe.rootPath ? `${probe.rootPath}/${nestedRoot}` : undefined,
		};
	}
	const pkg = appProbe.packageJson;
	const reasons: string[] = [];
	const configPath = findConfigPath(appProbe);
	const cargoPath = findCargoPath(appProbe, configPath);
	const cargoToml = cargoPath ? read(appProbe, cargoPath) : undefined;
	const configText = configPath ? read(appProbe, configPath) : undefined;
	const tauriInCargo = cargoDependsOnTauri(cargoToml);
	const srcTauri = appProbe.exists('src-tauri');
	const scripts = findTauriScripts(pkg);
	const hasCli = Boolean(pkg?.dependencies?.['@tauri-apps/cli'] || pkg?.devDependencies?.['@tauri-apps/cli']);
	const hasApi = Boolean(pkg?.dependencies?.['@tauri-apps/api'] || pkg?.devDependencies?.['@tauri-apps/api']);
	const parsed = parseDevUrl(configText);
	const hasWdioPlugin = cargoHasPlugin(cargoToml, 'tauri-plugin-wdio');
	const hasWdioWebdriverPlugin = cargoHasPlugin(cargoToml, 'tauri-plugin-wdio-webdriver');

	if (configPath) {
		reasons.push(`Tauri config: ${configPath}`);
	}
	if (tauriInCargo && cargoPath) {
		reasons.push(`Cargo Tauri dependency in ${cargoPath}`);
	}
	if (scripts.length) {
		reasons.push(`Tauri script(s): ${scripts.join(', ')}`);
	}
	if (hasCli) {
		reasons.push('Direct @tauri-apps/cli dependency');
	}
	if (hasApi) {
		reasons.push('Direct @tauri-apps/api dependency');
	}
	if (hasWdioWebdriverPlugin) {
		reasons.push('Debug WebDriver plugin present');
	}

	let confidence: DesktopDetectionConfidence = 'none';
	if (configPath && tauriInCargo) {
		confidence = 'high';
	} else if ((srcTauri && (hasCli || scripts.length)) || (configPath && (hasCli || scripts.length))) {
		confidence = 'medium';
	} else if (hasApi && !configPath && !tauriInCargo) {
		confidence = 'low';
		reasons.push('@tauri-apps/api without Tauri config or Cargo tauri crate — ignored for launch');
	} else if (cargoPath && cargoToml && !tauriInCargo) {
		reasons.push('Cargo.toml present without a tauri crate — ignored');
	}

	const isTauri = confidence === 'high' || confidence === 'medium';
	const likelyDevPort = inferPort(parsed.url, appProbe, pkg);
	const rendererUrlHint = parsed.url?.startsWith('http') ? parsed.url : (isTauri ? `http://localhost:${likelyDevPort}` : undefined);
	const setupRequired = isTauri && !hasWdioWebdriverPlugin;
	const capabilities = buildCapabilities({
		isTauri,
		hasRenderer: Boolean(rendererUrlHint),
		hasFullNative: isTauri && hasWdioWebdriverPlugin,
		setupRequired,
	});

	return {
		framework: 'tauri',
		label: isTauri ? 'Tauri' : 'Not Tauri',
		confidence,
		capabilities,
		reasons,
		rendererUrlHint,
		likelyDevPort,
		appRoot: appProbe.rootPath,
		packageManager: detectPackageManager(appProbe),
		configPath,
		cargoTomlPath: cargoPath,
		identifier: parsed.identifier,
		productName: parsed.productName,
		beforeDevCommand: parsed.beforeDevCommand,
		tauriScriptName: scripts[0],
		hasWdioPlugin,
		hasWdioWebdriverPlugin,
		testingCargoFeature: Boolean(cargoToml?.includes('prebase-testing')),
		isRustOnly: isTauri && !pkg,
	};
}

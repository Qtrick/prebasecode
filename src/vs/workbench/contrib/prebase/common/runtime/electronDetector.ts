/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PackageJsonShape, ProjectProbe } from './types.js';
import type { DesktopCapabilities, ElectronDetectionConfidence, ElectronProjectPaths, ElectronProjectProfile } from './desktopTypes.js';

const ELECTRON_SCRIPT_NAMES = ['electron', 'electron:dev', 'electron:start', 'electron:serve', 'start:electron', 'dev:electron'] as const;

const ELECTRON_CONFIG_PATHS = [
	'electron-builder.yml',
	'electron-builder.yaml',
	'electron-builder.json',
	'forge.config.js',
	'forge.config.ts',
	'electron.vite.config.ts',
	'electron.vite.config.js',
	'electron.vite.config.mjs',
] as const;

const MAIN_CANDIDATES = [
	'electron/main.ts',
	'electron/main.js',
	'electron/main.mjs',
	'src/main/main.ts',
	'src/main/main.js',
	'src/main/index.ts',
	'src/main/index.js',
	'main.ts',
	'main.js',
	'main/index.ts',
	'main/index.js',
] as const;

const PRELOAD_CANDIDATES = [
	'electron/preload.ts',
	'electron/preload.js',
	'src/preload.ts',
	'src/preload.js',
	'preload.ts',
	'preload.js',
] as const;

function hasDirectElectronDependency(pkg: PackageJsonShape | undefined): boolean {
	if (!pkg) {
		return false;
	}
	return Boolean(pkg.dependencies?.electron || pkg.devDependencies?.electron);
}

function scriptMentionsElectron(scriptBody: string): boolean {
	const body = scriptBody.toLowerCase();
	return body.includes('electron') || body.includes('electron-vite') || body.includes('electron-forge');
}

function findElectronScripts(pkg: PackageJsonShape | undefined): string[] {
	if (!pkg?.scripts) {
		return [];
	}
	const hits: string[] = [];
	for (const name of Object.keys(pkg.scripts)) {
		const body = pkg.scripts[name] ?? '';
		if (ELECTRON_SCRIPT_NAMES.includes(name as typeof ELECTRON_SCRIPT_NAMES[number]) || scriptMentionsElectron(body)) {
			hits.push(name);
		}
	}
	return hits;
}

function resolvePackageMain(pkg: PackageJsonShape | undefined, probe: ProjectProbe): string | undefined {
	const main = pkg?.main?.trim();
	if (main) {
		return main;
	}
	for (const candidate of MAIN_CANDIDATES) {
		if (probe.exists(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function resolvePreload(probe: ProjectProbe): string | undefined {
	for (const candidate of PRELOAD_CANDIDATES) {
		if (probe.exists(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function hasElectronConfig(probe: ProjectProbe): boolean {
	return ELECTRON_CONFIG_PATHS.some(path => probe.exists(path));
}

function inferLikelyDevPort(probe: ProjectProbe, pkg: PackageJsonShape | undefined): number {
	const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
	if (deps['vite'] || probe.exists('vite.config.ts') || probe.exists('vite.config.js') || probe.exists('vite.config.mjs') || probe.exists('electron.vite.config.ts')) {
		return 5173;
	}
	return 3000;
}

function buildCapabilities(
	isElectron: boolean,
	paths: ElectronProjectPaths,
	scripts: string[],
	hasRendererDevServer: boolean,
): DesktopCapabilities {
	const blockers: string[] = [];
	if (!isElectron) {
		blockers.push('Project is not recognized as an Electron app.');
	}
	if (!hasRendererDevServer) {
		blockers.push('No renderer dev server was detected for managed launch.');
	}

	const supportsManagedLaunch = isElectron && hasRendererDevServer;
	const supportsExternalLaunch = isElectron && Boolean(scripts.length || paths.main);
	const supportsDevServerAutostart = hasRendererDevServer;
	const limitations: string[] = [];
	if (supportsManagedLaunch) {
		limitations.push('Managed mode hosts the renderer URL in a PreBase-owned native window with a top management strip. Project Electron main-process code and preload are not executed in managed mode.');
		if (paths.preload) {
			limitations.push('Project preload was detected; use Open externally for full preload/IPC behavior.');
		}
	}
	if (supportsExternalLaunch) {
		limitations.push('External mode launches the project Electron process. Renderer automation uses a localhost CDP endpoint; native OS dialogs and menus are not controllable.');
	}

	return {
		supportsManagedLaunch,
		supportsExternalLaunch,
		supportsCdpAttach: supportsExternalLaunch || supportsManagedLaunch,
		supportsDevServerAutostart,
		supportsDOMInspection: supportsExternalLaunch || supportsManagedLaunch,
		supportsConsoleCapture: false,
		supportsNetworkCapture: false,
		supportsScreenshots: supportsExternalLaunch || supportsManagedLaunch,
		supportsInputAutomation: false,
		supportsWindowManagement: supportsManagedLaunch,
		requiresPreload: Boolean(paths.preload),
		requiresMainProcess: Boolean(paths.main),
		limitations,
		managedLaunchBlockers: supportsManagedLaunch ? [] : blockers,
	};
}

/** Detect Electron projects with confidence; reject web-only transitive dependency signals. */
export function detectElectronProject(probe: ProjectProbe): ElectronProjectProfile {
	const pkg = probe.packageJson;
	const reasons: string[] = [];
	const directElectron = hasDirectElectronDependency(pkg);
	const electronScripts = findElectronScripts(pkg);
	const electronConfig = hasElectronConfig(probe);
	const main = resolvePackageMain(pkg, probe);
	const preload = resolvePreload(probe);
	const scriptBodies = Object.values(pkg?.scripts ?? {}).join('\n').toLowerCase();
	const hasVite = Boolean(
		pkg?.dependencies?.vite ||
		pkg?.devDependencies?.vite ||
		pkg?.devDependencies?.['electron-vite'] ||
		pkg?.dependencies?.['electron-vite'] ||
		probe.exists('vite.config.ts') ||
		probe.exists('vite.config.js') ||
		probe.exists('vite.config.mjs') ||
		probe.exists('electron.vite.config.ts') ||
		probe.exists('electron.vite.config.js') ||
		probe.exists('electron.vite.config.mjs') ||
		scriptBodies.includes('electron-vite') ||
		/(^|[\s"'])vite(\s|$)/.test(scriptBodies)
	);
	const renderer = hasVite ? `http://localhost:${inferLikelyDevPort(probe, pkg)}` : (probe.exists('index.html') ? 'index.html' : undefined);

	if (directElectron) {
		reasons.push('Direct electron dependency in package.json');
	}
	if (electronScripts.length) {
		reasons.push(`Electron script(s): ${electronScripts.join(', ')}`);
	}
	if (electronConfig) {
		reasons.push('Electron tooling config present');
	}
	if (main) {
		reasons.push(`Main entry: ${main}`);
	}
	if (preload) {
		reasons.push(`Preload entry: ${preload}`);
	}

	let confidence: ElectronDetectionConfidence = 'none';
	if (directElectron && (main || electronScripts.length)) {
		confidence = 'high';
	} else if (directElectron || (electronConfig && electronScripts.length)) {
		confidence = 'medium';
	} else if (electronScripts.length && scriptMentionsElectron(pkg?.scripts?.[electronScripts[0]!] ?? '')) {
		// Script-only signal without direct dependency — do not treat as Electron.
		confidence = 'low';
		reasons.push('Script mentions Electron but no direct electron dependency — ignored');
	}

	const isElectron = confidence === 'high' || confidence === 'medium';
	const paths: ElectronProjectPaths = {
		main,
		preload,
		renderer,
	};
	const capabilities = buildCapabilities(isElectron, paths, electronScripts, hasVite);
	const likelyDevPort = inferLikelyDevPort(probe, pkg);

	return {
		isElectron,
		confidence,
		label: isElectron ? 'Electron' : 'Not Electron',
		paths,
		capabilities,
		electronScriptName: electronScripts[0],
		rendererUrlHint: renderer?.startsWith('http') ? renderer : (hasVite ? `http://localhost:${likelyDevPort}` : undefined),
		likelyDevPort,
		reasons,
	};
}

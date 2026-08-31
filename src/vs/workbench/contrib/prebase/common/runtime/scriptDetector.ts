/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DetectedDevScript, PackageManager, ProjectProbe } from './types.js';

const DEV_SCRIPT_NAMES = ['dev', 'start', 'serve', 'electron:dev', 'tauri', 'tauri:dev', 'preview', 'develop'] as const;

const FRAMEWORK_DEFAULT_PORTS: Record<string, number[]> = {
	vite: [5173, 4173],
	next: [3000],
	'react-scripts': [3000],
	nuxt: [3000],
	astro: [4321],
	default: [3000, 5173, 8080, 4173]
};

export function detectPackageManager(probe: ProjectProbe): PackageManager {
	if (probe.exists('pnpm-lock.yaml')) {
		return 'pnpm';
	}
	if (probe.exists('yarn.lock')) {
		return 'yarn';
	}
	if (probe.exists('bun.lockb') || probe.exists('bun.lock')) {
		return 'bun';
	}
	return 'npm';
}

function runPrefix(pm: PackageManager): string {
	switch (pm) {
		case 'pnpm':
			return 'pnpm';
		case 'yarn':
			return 'yarn';
		case 'bun':
			return 'bun run';
		default:
			return 'npm run';
	}
}

function addPorts(target: number[], list: number[]): void {
	for (const port of list) {
		if (!target.includes(port)) {
			target.push(port);
		}
	}
}

function inferSuggestedPorts(probe: ProjectProbe, scriptName: string): number[] {
	const ports: number[] = [];
	const deps = {
		...(probe.packageJson?.dependencies ?? {}),
		...(probe.packageJson?.devDependencies ?? {})
	};

	const hasVite = Boolean(
		deps['vite'] ||
		probe.exists('vite.config.ts') ||
		probe.exists('vite.config.js') ||
		probe.exists('vite.config.mjs')
	);
	const hasNext = Boolean(
		deps['next'] ||
		probe.exists('next.config.js') ||
		probe.exists('next.config.mjs') ||
		probe.exists('next.config.ts')
	);
	const hasReactScripts = Boolean(deps['react-scripts']);
	const hasNuxt = Boolean(deps['nuxt']);
	const hasAstro = Boolean(deps['astro']);

	// Framework-specific ports first so Vite does not default to Next/CRA's 3000.
	if (hasVite) {
		addPorts(ports, FRAMEWORK_DEFAULT_PORTS.vite);
	}
	if (hasNext) {
		addPorts(ports, FRAMEWORK_DEFAULT_PORTS.next);
	}
	if (hasReactScripts) {
		addPorts(ports, FRAMEWORK_DEFAULT_PORTS['react-scripts']);
	}
	if (hasNuxt) {
		addPorts(ports, FRAMEWORK_DEFAULT_PORTS.nuxt);
	}
	if (hasAstro) {
		addPorts(ports, FRAMEWORK_DEFAULT_PORTS.astro);
	}
	if (scriptName === 'preview') {
		addPorts(ports, [4173]);
	}
	addPorts(ports, FRAMEWORK_DEFAULT_PORTS.default);
	return ports;
}

export function buildRunCommand(pm: PackageManager, scriptName: string): string {
	return `${runPrefix(pm)} ${scriptName}`;
}

/** Prefer `dev`, then `start`, then first remaining detected script. */
export function selectDefaultScript(scripts: DetectedDevScript[]): DetectedDevScript | undefined {
	return scripts.find(s => s.scriptName === 'dev')
		?? scripts.find(s => s.scriptName === 'start')
		?? scripts[0];
}

/** Detect likely dev-server scripts from package.json via a sync project probe. */
export function detectDevScripts(probe: ProjectProbe): DetectedDevScript[] {
	const scripts = probe.packageJson?.scripts ?? {};
	if (!Object.keys(scripts).length) {
		return [];
	}

	const pm = detectPackageManager(probe);
	const results: DetectedDevScript[] = [];

	for (const name of DEV_SCRIPT_NAMES) {
		const body = scripts[name];
		if (!body) {
			continue;
		}
		const ports = inferSuggestedPorts(probe, name);
		results.push({
			command: buildRunCommand(pm, name),
			label: `${name} (${body.slice(0, 60)})`,
			packageManager: pm,
			scriptName: name,
			scriptBody: body,
			suggestedUrls: ports.map(p => `http://localhost:${p}`)
		});
	}

	return results;
}

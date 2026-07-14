/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DetectedFramework, FrameworkProfile, ProjectProbe } from './types.js';

function defaultProfile(framework: DetectedFramework, rootLabel: string): FrameworkProfile {
	return {
		framework,
		label: framework === 'unknown' ? 'Unknown' : 'Plain HTML/JS',
		routeDirs: ['src', 'public'],
		likelyDevPort: 8080,
		stackPathPrefixes: ['src/'],
		routeFilePatterns: ['index.html'],
		isMonorepo: false,
		appRoots: framework === 'unknown' ? [] : [rootLabel]
	};
}

/** Detect project framework from package.json and directory structure. */
export function detectFramework(probe: ProjectProbe): FrameworkProfile {
	const pkg = probe.packageJson;
	if (!pkg) {
		return defaultProfile('unknown', probe.rootLabel);
	}

	const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
	const scripts = pkg.scripts ?? {};

	const isMonorepo =
		probe.exists('packages') ||
		probe.exists('apps') ||
		probe.exists('pnpm-workspace.yaml');

	const appRoots: string[] = [probe.rootLabel];
	if (isMonorepo) {
		for (const sub of ['apps/web', 'apps/frontend', 'apps/client', 'packages/web']) {
			if (probe.exists(sub)) {
				appRoots.push(`${probe.rootLabel}/${sub}`);
			}
		}
	}

	if (deps['next']) {
		return {
			framework: 'nextjs',
			label: 'Next.js',
			routeDirs: ['app', 'pages', 'src/app', 'src/pages'],
			likelyDevPort: 3000,
			stackPathPrefixes: ['app/', 'pages/', 'src/'],
			routeFilePatterns: ['page.tsx', 'page.jsx', 'index.tsx'],
			isMonorepo,
			appRoots
		};
	}

	if (deps['vite'] || probe.exists('vite.config.ts') || probe.exists('vite.config.js') || probe.exists('vite.config.mjs')) {
		const isVue = Boolean(deps['vue']);
		const isSvelte = Boolean(deps['svelte'] || deps['@sveltejs/kit']);
		if (isSvelte) {
			return {
				framework: 'svelte-kit',
				label: 'SvelteKit',
				routeDirs: ['src/routes', 'routes'],
				likelyDevPort: 5173,
				stackPathPrefixes: ['src/routes/', 'src/lib/'],
				routeFilePatterns: ['+page.svelte'],
				isMonorepo,
				appRoots
			};
		}
		if (isVue) {
			return {
				framework: 'vue-vite',
				label: 'Vue + Vite',
				routeDirs: ['src/views', 'src/pages', 'src/components'],
				likelyDevPort: 5173,
				stackPathPrefixes: ['src/'],
				routeFilePatterns: ['.vue'],
				isMonorepo,
				appRoots
			};
		}
		return {
			framework: 'vite-react',
			label: 'Vite + React',
			routeDirs: ['src/pages', 'src/routes', 'src/views', 'src'],
			likelyDevPort: 5173,
			stackPathPrefixes: ['src/'],
			routeFilePatterns: ['App.tsx', 'router.tsx', 'routes.tsx'],
			isMonorepo,
			appRoots
		};
	}

	if (deps['react-router'] || deps['react-router-dom'] || deps['react-scripts']) {
		return {
			framework: 'react-router',
			label: deps['react-scripts'] ? 'Create React App' : 'React Router SPA',
			routeDirs: ['src/pages', 'src/routes', 'src/views'],
			likelyDevPort: 3000,
			stackPathPrefixes: ['src/'],
			routeFilePatterns: ['routes.tsx', 'router.tsx'],
			isMonorepo,
			appRoots
		};
	}

	if (deps['electron'] || scripts['electron:dev']) {
		return {
			framework: 'electron',
			label: 'Electron',
			routeDirs: ['src', 'src/renderer'],
			likelyDevPort: 5173,
			stackPathPrefixes: ['src/'],
			routeFilePatterns: [],
			isMonorepo,
			appRoots
		};
	}

	if (isMonorepo) {
		return {
			framework: 'monorepo',
			label: 'Monorepo (multiple apps)',
			routeDirs: ['apps', 'packages'],
			likelyDevPort: 5173,
			stackPathPrefixes: ['src/', 'apps/'],
			routeFilePatterns: [],
			isMonorepo: true,
			appRoots
		};
	}

	return defaultProfile('plain-html', probe.rootLabel);
}

/** Map route path to likely file paths for a framework. */
export function routeToCandidatePaths(route: string, profile: FrameworkProfile): string[] {
	const parts = route.split('/').filter(Boolean);
	const candidates: string[] = [];
	const last = parts[parts.length - 1] ?? 'index';

	if (profile.framework === 'nextjs') {
		candidates.push(`app/${parts.join('/')}/page.tsx`);
		candidates.push(`app/${parts.join('/')}/page.jsx`);
		candidates.push(`pages/${parts.join('/')}.tsx`);
		candidates.push(`pages/${last}.tsx`);
	} else {
		for (const dir of profile.routeDirs) {
			candidates.push(`${dir}/${parts.join('/')}.tsx`);
			candidates.push(`${dir}/${last}.tsx`);
			candidates.push(`${dir}/${last}/index.tsx`);
		}
	}
	return candidates;
}

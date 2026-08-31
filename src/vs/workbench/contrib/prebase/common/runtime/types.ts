/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface DetectedDevScript {
	command: string;
	label: string;
	packageManager: PackageManager;
	scriptName: string;
	scriptBody: string;
	suggestedUrls: string[];
}

export type DetectedFramework =
	| 'vite-react'
	| 'nextjs'
	| 'react-router'
	| 'vue-vite'
	| 'svelte-kit'
	| 'electron'
	| 'tauri'
	| 'plain-html'
	| 'monorepo'
	| 'unknown';

export interface FrameworkProfile {
	framework: DetectedFramework;
	label: string;
	routeDirs: string[];
	likelyDevPort: number;
	stackPathPrefixes: string[];
	routeFilePatterns: string[];
	isMonorepo: boolean;
	appRoots: string[];
}

export interface PackageJsonShape {
	name?: string;
	main?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
}

/** Sync probe used by detectors after the browser layer has resolved file existence. */
export interface ProjectProbe {
	exists(relativePath: string): boolean;
	/** Optional text reader used for Cargo.toml / Tauri config inspection. */
	readText?(relativePath: string): string | undefined;
	packageJson: PackageJsonShape | undefined;
	rootLabel: string;
	/** Absolute app root when filesystem launch ownership is required. */
	rootPath?: string;
}

export type RuntimeActionRisk = 'low' | 'medium' | 'high' | 'blocked';

export interface PermissionCheckResult {
	allowed: boolean;
	risk: RuntimeActionRisk;
	requiresApproval: boolean;
	blocked: boolean;
	reason: string;
	actionLabel: string;
}

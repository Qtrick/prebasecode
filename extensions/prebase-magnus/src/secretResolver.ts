/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ALLOWLISTED_LOCAL_ENV_VARIABLES } from './secretCatalog';

const MAX_ENV_FILE_BYTES = 64 * 1024; // 64 KiB safety bound

export type SecretSourceType = 'local-env' | 'secret-storage' | 'process-env';

export interface ResolvedSecret {
	readonly key: string;
	readonly source: SecretSourceType;
	readonly varName: string;
}

export interface SecretDiagnosticStatus {
	readonly id: string;
	readonly localEnv: 'present' | 'absent';
	readonly secretStorage: 'present' | 'absent';
	readonly processEnv: 'present' | 'absent';
	readonly activeSource?: SecretSourceType;
}

/**
 * Validates whether a candidate directory is the authentic PreBase application/source root.
 * Strictly prevents arbitrary user workspaces from being identified as PreBase root.
 */
export function isPreBaseSourceRoot(dirPath: string): boolean {
	try {
		if (!fs.existsSync(dirPath)) {
			return false;
		}
		const productJsonPath = path.join(dirPath, 'product.json');
		const packageJsonPath = path.join(dirPath, 'package.json');
		const agentsMdPath = path.join(dirPath, 'AGENTS.md');

		if (!fs.existsSync(productJsonPath) || !fs.existsSync(packageJsonPath) || !fs.existsSync(agentsMdPath)) {
			return false;
		}

		const productRaw = fs.readFileSync(productJsonPath, 'utf8');
		const product = JSON.parse(productRaw) as { nameShort?: string; applicationName?: string; nameLong?: string };
		const isPreBaseProduct =
			product.nameShort === 'PreBase' ||
			product.applicationName === 'prebase' ||
			product.nameLong === 'PreBase';

		const pkgRaw = fs.readFileSync(packageJsonPath, 'utf8');
		const pkg = JSON.parse(pkgRaw) as { name?: string };
		const isPreBasePackage = pkg.name === 'code-oss-dev';

		return !!(isPreBaseProduct && isPreBasePackage);
	} catch {
		return false;
	}
}

/**
 * Finds the authentic PreBase source root starting from a starting directory.
 * Traverses upwards boundedly.
 */
export function findPreBaseSourceRoot(startDir: string = process.cwd()): string | undefined {
	let current = path.resolve(startDir);
	for (let i = 0; i < 6; i++) {
		if (isPreBaseSourceRoot(current)) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}
	return undefined;
}

/**
 * Safely parses a .env file as data with strict bounds, character encoding,
 * comment handling, quote stripping, and allowlist variable extraction.
 * Never executes shell commands, never performs variable interpolation.
 */
export function parseAllowlistedEnv(content: string, allowlist: ReadonlySet<string> = ALLOWLISTED_LOCAL_ENV_VARIABLES): Map<string, string> {
	const result = new Map<string, string>();
	const lines = content.split(/\r?\n/);

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
			continue;
		}

		const eqIndex = trimmed.indexOf('=');
		const varName = trimmed.slice(0, eqIndex).trim();
		if (!allowlist.has(varName)) {
			continue;
		}

		let val = trimmed.slice(eqIndex + 1).trim();
		if (val.length >= 2) {
			const first = val[0];
			const last = val[val.length - 1];
			if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
				val = val.slice(1, -1);
			}
		}

		if (val.trim()) {
			result.set(varName, val.trim());
		}
	}

	return result;
}

/**
 * Reads and parses the PreBase root .env if and only if it exists at the authentic PreBase root.
 * Returns only allowlisted variables. Never throws, never logs secret values.
 */
export function loadPreBaseRootEnv(explicitRoot?: string): Map<string, string> {
	const root = explicitRoot ?? findPreBaseSourceRoot();
	if (!root || !isPreBaseSourceRoot(root)) {
		return new Map();
	}

	const envPath = path.join(root, '.env');
	try {
		if (!fs.existsSync(envPath)) {
			return new Map();
		}

		const stat = fs.statSync(envPath);
		if (stat.size > MAX_ENV_FILE_BYTES) {
			console.warn('[PreBase SecretResolver] PreBase root .env exceeded size limit, ignoring.');
			return new Map();
		}

		// On POSIX, check permissions and warn if group/world readable
		if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
			// Permission warning without printing contents
			console.warn('[PreBase SecretResolver] Notice: PreBase root .env has group/world readable permissions.');
		}

		const content = fs.readFileSync(envPath, 'utf8');
		return parseAllowlistedEnv(content);
	} catch (err) {
		console.warn('[PreBase SecretResolver] Failed to safely read PreBase root .env:', err instanceof Error ? err.message : String(err));
		return new Map();
	}
}

/**
 * Extension-side secret resolver with strict deterministic precedence:
 * In Source-Development:
 * 1. Root .env allowlisted variable
 * 2. SecretStorage BYO credential
 * 3. Process environment allowlisted variable
 * In Packaged PreBase:
 * 1. SecretStorage BYO credential
 */
export class PreBaseSecretResolver {
	private _rootEnvCache: Map<string, string> | undefined;
	private _isSourceDev: boolean;
	private _prebaseRoot: string | undefined;

	constructor(options?: { explicitRoot?: string; forcePackaged?: boolean }) {
		if (options?.forcePackaged) {
			this._isSourceDev = false;
			this._prebaseRoot = undefined;
		} else {
			this._prebaseRoot = options?.explicitRoot ?? findPreBaseSourceRoot();
			this._isSourceDev = !!(this._prebaseRoot && isPreBaseSourceRoot(this._prebaseRoot));
		}
	}

	isSourceDevelopment(): boolean {
		return this._isSourceDev;
	}

	getPreBaseRoot(): string | undefined {
		return this._prebaseRoot;
	}

	refreshRootEnv(): void {
		this._rootEnvCache = undefined;
	}

	private getRootEnv(): Map<string, string> {
		if (!this._rootEnvCache) {
			this._rootEnvCache = this._isSourceDev ? loadPreBaseRootEnv(this._prebaseRoot) : new Map();
		}
		return this._rootEnvCache;
	}

	/**
	 * Resolves Gemini API key with deterministic precedence.
	 */
	resolveGeminiKey(secretStorageKey?: string): ResolvedSecret | undefined {
		// 1. Source-development root .env
		if (this._isSourceDev) {
			const env = this.getRootEnv();
			const rootGemini = env.get('GEMINI_API_KEY') || env.get('GOOGLE_API_KEY');
			if (rootGemini) {
				return {
					key: rootGemini,
					source: 'local-env',
					varName: env.has('GEMINI_API_KEY') ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY',
				};
			}
		}

		// 2. SecretStorage BYO key
		if (secretStorageKey && secretStorageKey.trim()) {
			return {
				key: secretStorageKey.trim(),
				source: 'secret-storage',
				varName: 'stored',
			};
		}

		// 3. Process environment (development fallback)
		if (this._isSourceDev) {
			const procKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
			if (procKey) {
				return {
					key: procKey,
					source: 'process-env',
					varName: process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY',
				};
			}
		}

		return undefined;
	}

	/**
	 * Resolves LinkUp API key with deterministic precedence.
	 */
	resolveLinkupKey(secretStorageKey?: string): ResolvedSecret | undefined {
		// 1. Source-development root .env
		if (this._isSourceDev) {
			const env = this.getRootEnv();
			const rootLinkup = env.get('LINKUP_API_KEY');
			if (rootLinkup) {
				return {
					key: rootLinkup,
					source: 'local-env',
					varName: 'LINKUP_API_KEY',
				};
			}
		}

		// 2. SecretStorage BYO key
		if (secretStorageKey && secretStorageKey.trim()) {
			return {
				key: secretStorageKey.trim(),
				source: 'secret-storage',
				varName: 'stored',
			};
		}

		// 3. Process environment (development fallback)
		if (this._isSourceDev) {
			const procKey = process.env.LINKUP_API_KEY?.trim();
			if (procKey) {
				return {
					key: procKey,
					source: 'process-env',
					varName: 'LINKUP_API_KEY',
				};
			}
		}

		return undefined;
	}

	/**
	 * Returns non-secret diagnostic status for providers.
	 */
	getDiagnostics(secretStorageGemini?: string, secretStorageLinkup?: string): {
		isSourceDev: boolean;
		gemini: SecretDiagnosticStatus;
		linkup: SecretDiagnosticStatus;
	} {
		const env = this.getRootEnv();
		const resolvedGemini = this.resolveGeminiKey(secretStorageGemini);
		const resolvedLinkup = this.resolveLinkupKey(secretStorageLinkup);

		return {
			isSourceDev: this._isSourceDev,
			gemini: {
				id: 'gemini-api',
				localEnv: env.has('GEMINI_API_KEY') || env.has('GOOGLE_API_KEY') ? 'present' : 'absent',
				secretStorage: secretStorageGemini && secretStorageGemini.trim() ? 'present' : 'absent',
				processEnv: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? 'present' : 'absent',
				activeSource: resolvedGemini?.source,
			},
			linkup: {
				id: 'linkup-api',
				localEnv: env.has('LINKUP_API_KEY') ? 'present' : 'absent',
				secretStorage: secretStorageLinkup && secretStorageLinkup.trim() ? 'present' : 'absent',
				processEnv: process.env.LINKUP_API_KEY ? 'present' : 'absent',
				activeSource: resolvedLinkup?.source,
			},
		};
	}
}

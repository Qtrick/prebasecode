/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ALLOWLISTED_LOCAL_ENV_VARIABLES, getSecretDescriptor, type PreBaseAIExecutionMode } from './secretCatalog';

const MAX_ENV_FILE_BYTES = 64 * 1024; // 64 KiB safety bound

function toolProviderEnvName(providerId: string): string | undefined {
	const desc = getSecretDescriptor(providerId);
	return desc?.kind === 'tool-provider' ? desc.localEnvNames[0] : undefined;
}

export type SecretSourceType = 'local-env' | 'secret-storage' | 'process-env' | 'hosted';

export function isHostedMagnusFeatureEnabled(): boolean {
	return process.env.PREBASE_HOSTED_MAGNUS_ENABLED === 'true';
}

export interface ResolvedSecret {
	readonly key: string;
	readonly source: SecretSourceType;
	readonly varName: string;
}

export interface ResolvedProviderExecution {
	readonly providerId: string;
	readonly executionMode: PreBaseAIExecutionMode;
	readonly key?: string;
	readonly source: SecretSourceType;
	readonly varName?: string;
	readonly configured: boolean;
	readonly isHosted: boolean;
}

export interface SecretDiagnosticStatus {
	readonly id: string;
	readonly localEnv: 'present' | 'absent';
	readonly secretStorage: 'present' | 'absent';
	readonly processEnv: 'present' | 'absent';
	readonly hosted: 'available' | 'unavailable';
	readonly activeSource?: SecretSourceType;
	readonly activeExecutionMode: PreBaseAIExecutionMode;
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
		const varName = trimmed.slice(0, eqIndex).trim().replace(/^export\s+/, '');
		if (!allowlist.has(varName)) {
			continue;
		}

		let val = trimmed.slice(eqIndex + 1).trim();
		if (val.length >= 2) {
			const first = val.charCodeAt(0);
			const last = val.charCodeAt(val.length - 1);
			if ((first === 34 && last === 34) || (first === 39 && last === 39)) {
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
			console.warn('[PreBase SecretResolver] Notice: PreBase root .env has group/world readable permissions.');
		}

		const content = fs.readFileSync(envPath, 'utf8');
		return parseAllowlistedEnv(content);
	} catch (err) {
		console.warn('[PreBase SecretResolver] Failed to safely read PreBase root .env:', err instanceof Error ? err.message : String(err));
		return new Map();
	}
}
export interface RootEnvCacheState {
	readonly mtime: number;
	readonly size: number;
	readonly contentHash: string;
	readonly values: Map<string, string>;
}

export interface PreBaseSecretResolverOptions {
	explicitRoot?: string;
	forcePackaged?: boolean;
	allowAmbientRootDiscovery?: boolean;
}

/**
 * Extension-side secret and execution mode resolver with deterministic precedence:
 *
 * In Source-Development:
 * - 'auto' mode:
 *   1. Root .env allowlisted variable (direct 'development-env')
 *   2. SecretStorage BYOK credential (direct 'byok')
 *   3. PreBase Hosted gateway if user is signed in ('hosted')
 *   4. Process environment allowlisted variable fallback ('development-env')
 *
 * In Packaged PreBase:
 * - 'auto' mode:
 *   1. SecretStorage BYOK credential ('byok')
 *   2. PreBase Hosted gateway if user is signed in ('hosted')
 *
 * In Explicit Modes ('development-env' | 'byok' | 'hosted'):
 * - Respects the explicit choice strictly.
 */
export class PreBaseSecretResolver {
	private _rootEnvCache: RootEnvCacheState | null | undefined;
	private _isSourceDev: boolean;
	private _prebaseRoot: string | undefined;

	constructor(options?: PreBaseSecretResolverOptions) {
		if (options?.forcePackaged) {
			this._isSourceDev = false;
			this._prebaseRoot = undefined;
		} else {
			if (options?.explicitRoot) {
				this._prebaseRoot = isPreBaseSourceRoot(options.explicitRoot) ? options.explicitRoot : findPreBaseSourceRoot(options.explicitRoot);
			} else if (options?.allowAmbientRootDiscovery !== false) {
				this._prebaseRoot = findPreBaseSourceRoot();
			} else {
				this._prebaseRoot = undefined;
			}
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
		if (!this._isSourceDev || !this._prebaseRoot) {
			return new Map();
		}

		const envPath = path.join(this._prebaseRoot, '.env');
		try {
			if (!fs.existsSync(envPath)) {
				this._rootEnvCache = null;
				return new Map();
			}

			const stat = fs.statSync(envPath);
			if (stat.size > MAX_ENV_FILE_BYTES) {
				console.warn('[PreBase SecretResolver] PreBase root .env exceeded size limit, ignoring.');
				this._rootEnvCache = null;
				return new Map();
			}

			const content = fs.readFileSync(envPath, 'utf8');
			const contentHash = crypto.createHash('sha256').update(content).digest('hex');

			if (this._rootEnvCache && this._rootEnvCache.contentHash === contentHash && this._rootEnvCache.size === stat.size) {
				return this._rootEnvCache.values;
			}

			// On POSIX, check permissions and warn if group/world readable
			if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
				console.warn('[PreBase SecretResolver] Notice: PreBase root .env has group/world readable permissions.');
			}

			const values = parseAllowlistedEnv(content);
			this._rootEnvCache = {
				mtime: stat.mtimeMs,
				size: stat.size,
				contentHash,
				values,
			};
			return values;
		} catch (err) {
			console.warn('[PreBase SecretResolver] Failed to safely read PreBase root .env:', err instanceof Error ? err.message : String(err));
			this._rootEnvCache = null;
			return new Map();
		}
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
	 * Resolves a catalog tool-provider key (LinkUp, Firecrawl) with deterministic precedence.
	 */
	resolveToolProviderKey(providerId: string, secretStorageKey?: string): ResolvedSecret | undefined {
		const varName = toolProviderEnvName(providerId);
		if (!varName) {
			return undefined;
		}
		if (this._isSourceDev) {
			const rootKey = this.getRootEnv().get(varName);
			if (rootKey) {
				return { key: rootKey, source: 'local-env', varName };
			}
		}
		if (secretStorageKey && secretStorageKey.trim()) {
			return { key: secretStorageKey.trim(), source: 'secret-storage', varName: 'stored' };
		}
		if (this._isSourceDev) {
			const procKey = process.env[varName]?.trim();
			if (procKey) {
				return { key: procKey, source: 'process-env', varName };
			}
		}
		return undefined;
	}

	/**
	 * Resolves LinkUp API key with deterministic precedence.
	 */
	resolveLinkupKey(secretStorageKey?: string): ResolvedSecret | undefined {
		return this.resolveToolProviderKey('linkup', secretStorageKey);
	}

	/**
	 * Resolves the effective execution mode and credential for a provider.
	 */
	resolveProviderExecution(options: {
		providerId: string;
		requestedMode: PreBaseAIExecutionMode;
		secretStorageKey?: string;
		hostedAvailable?: boolean;
	}): ResolvedProviderExecution {
		const { providerId, requestedMode, secretStorageKey } = options;
		const hostedAvailable = options.hostedAvailable ?? isHostedMagnusFeatureEnabled();
		const normProvider = providerId.toLowerCase().replace(/-api$/, '');

		// Explicit mode: development-env
		if (requestedMode === 'development-env') {
			if (this._isSourceDev) {
				const env = this.getRootEnv();
				if (normProvider === 'gemini') {
					const rootKey = env.get('GEMINI_API_KEY') || env.get('GOOGLE_API_KEY');
					if (rootKey) {
						return {
							providerId: 'gemini',
							executionMode: 'development-env',
							key: rootKey,
							source: 'local-env',
							varName: env.has('GEMINI_API_KEY') ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY',
							configured: true,
							isHosted: false,
						};
					}
					const procKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
					if (procKey) {
						return {
							providerId: 'gemini',
							executionMode: 'development-env',
							key: procKey,
							source: 'process-env',
							varName: process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY',
							configured: true,
							isHosted: false,
						};
					}
				} else {
					const envName = toolProviderEnvName(normProvider);
					const rootKey = envName ? env.get(envName) : undefined;
					if (rootKey && envName) {
						return {
							providerId: normProvider,
							executionMode: 'development-env',
							key: rootKey,
							source: 'local-env',
							varName: envName,
							configured: true,
							isHosted: false,
						};
					}
				}
			}
			return {
				providerId: normProvider,
				executionMode: 'development-env',
				source: 'local-env',
				configured: false,
				isHosted: false,
			};
		}

		// Explicit mode: byok
		if (requestedMode === 'byok') {
			const hasKey = !!(secretStorageKey && secretStorageKey.trim());
			return {
				providerId: normProvider,
				executionMode: 'byok',
				key: hasKey ? secretStorageKey!.trim() : undefined,
				source: 'secret-storage',
				varName: 'stored',
				configured: hasKey,
				isHosted: false,
			};
		}

		// Explicit mode: hosted
		if (requestedMode === 'hosted') {
			return {
				providerId: normProvider,
				executionMode: 'hosted',
				source: 'hosted',
				configured: !!hostedAvailable,
				isHosted: true,
			};
		}

		// Auto mode resolution:
		// 1. If in source development, prefer development root .env if key is present
		if (this._isSourceDev) {
			const env = this.getRootEnv();
			if (normProvider === 'gemini') {
				const rootKey = env.get('GEMINI_API_KEY') || env.get('GOOGLE_API_KEY');
				if (rootKey) {
					return {
						providerId: 'gemini',
						executionMode: 'development-env',
						key: rootKey,
						source: 'local-env',
						varName: env.has('GEMINI_API_KEY') ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY',
						configured: true,
						isHosted: false,
					};
				}
			} else {
				const envName = toolProviderEnvName(normProvider);
				const rootKey = envName ? env.get(envName) : undefined;
				if (rootKey && envName) {
					return {
						providerId: normProvider,
						executionMode: 'development-env',
						key: rootKey,
						source: 'local-env',
						varName: envName,
						configured: true,
						isHosted: false,
					};
				}
			}
		}

		// 2. SecretStorage BYOK key
		if (secretStorageKey && secretStorageKey.trim()) {
			return {
				providerId: normProvider,
				executionMode: 'byok',
				key: secretStorageKey.trim(),
				source: 'secret-storage',
				varName: 'stored',
				configured: true,
				isHosted: false,
			};
		}

		// 3. Hosted if available
		if (hostedAvailable) {
			return {
				providerId: normProvider,
				executionMode: 'hosted',
				source: 'hosted',
				configured: true,
				isHosted: true,
			};
		}

		// 4. Source dev process environment fallback
		if (this._isSourceDev) {
			if (normProvider === 'gemini') {
				const procKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
				if (procKey) {
					return {
						providerId: 'gemini',
						executionMode: 'development-env',
						key: procKey,
						source: 'process-env',
						varName: process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY',
						configured: true,
						isHosted: false,
					};
				}
			} else {
				const envName = toolProviderEnvName(normProvider);
				const procKey = envName ? process.env[envName]?.trim() : undefined;
				if (procKey && envName) {
					return {
						providerId: normProvider,
						executionMode: 'development-env',
						key: procKey,
						source: 'process-env',
						varName: envName,
						configured: true,
						isHosted: false,
					};
				}
			}
		}

		// Unconfigured
		return {
			providerId: normProvider,
			executionMode: 'auto',
			source: 'secret-storage',
			configured: false,
			isHosted: false,
		};
	}

	/**
	 * Returns non-secret diagnostic status for providers.
	 */
	getDiagnostics(
		secretStorageGemini?: string,
		secretStorageLinkup?: string,
		cloudHostedAvailable?: boolean,
		requestedMode: PreBaseAIExecutionMode = 'auto',
		secretStorageFirecrawl?: string,
	): {
		isSourceDev: boolean;
		resolvedRootPresent: boolean;
		resolvedRootPath?: string;
		rootEnvPresent: boolean;
		gemini: SecretDiagnosticStatus;
		linkup: SecretDiagnosticStatus;
		firecrawl: SecretDiagnosticStatus;
	} {
		const effectiveHosted = cloudHostedAvailable ?? isHostedMagnusFeatureEnabled();
		const env = this.getRootEnv();
		const resolvedGemini = this.resolveProviderExecution({
			providerId: 'gemini',
			requestedMode,
			secretStorageKey: secretStorageGemini,
			hostedAvailable: effectiveHosted,
		});
		const resolvedLinkup = this.resolveProviderExecution({
			providerId: 'linkup',
			requestedMode,
			secretStorageKey: secretStorageLinkup,
			hostedAvailable: effectiveHosted,
		});
		const resolvedFirecrawl = this.resolveProviderExecution({
			providerId: 'firecrawl',
			requestedMode,
			secretStorageKey: secretStorageFirecrawl,
			hostedAvailable: effectiveHosted,
		});

		const hasEnvFile = this._isSourceDev && !!this._prebaseRoot && fs.existsSync(path.join(this._prebaseRoot, '.env'));
		return {
			isSourceDev: this._isSourceDev,
			resolvedRootPresent: !!this._prebaseRoot,
			resolvedRootPath: this._prebaseRoot,
			rootEnvPresent: hasEnvFile,
			gemini: {
				id: 'gemini',
				localEnv: env.has('GEMINI_API_KEY') || env.has('GOOGLE_API_KEY') ? 'present' : 'absent',
				secretStorage: secretStorageGemini && secretStorageGemini.trim() ? 'present' : 'absent',
				processEnv: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? 'present' : 'absent',
				hosted: effectiveHosted ? 'available' : 'unavailable',
				activeSource: resolvedGemini.source,
				activeExecutionMode: resolvedGemini.executionMode,
			},
			linkup: {
				id: 'linkup',
				localEnv: env.has('LINKUP_API_KEY') ? 'present' : 'absent',
				secretStorage: secretStorageLinkup && secretStorageLinkup.trim() ? 'present' : 'absent',
				processEnv: process.env.LINKUP_API_KEY ? 'present' : 'absent',
				hosted: effectiveHosted ? 'available' : 'unavailable',
				activeSource: resolvedLinkup.source,
				activeExecutionMode: resolvedLinkup.executionMode,
			},
			firecrawl: {
				id: 'firecrawl',
				localEnv: env.has('FIRECRAWL_API_KEY') ? 'present' : 'absent',
				secretStorage: secretStorageFirecrawl && secretStorageFirecrawl.trim() ? 'present' : 'absent',
				processEnv: process.env.FIRECRAWL_API_KEY ? 'present' : 'absent',
				hosted: effectiveHosted ? 'available' : 'unavailable',
				activeSource: resolvedFirecrawl.source,
				activeExecutionMode: resolvedFirecrawl.executionMode,
			},
		};
	}
}

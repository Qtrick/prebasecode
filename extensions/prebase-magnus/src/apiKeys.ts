/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** Canonical + alias env var names for provider API keys. */
export const MAGNUS_API_KEY_VARS = [
	'GEMINI_API_KEY',
	'GOOGLE_API_KEY',
	'OPENAI_API_KEY',
	'ANTHROPIC_API_KEY',
	'CLAUDE_API_KEY',
	'AZURE_OPENAI_API_KEY',
	'MISTRAL_API_KEY',
	'GROQ_API_KEY',
	'COHERE_API_KEY',
	'XAI_API_KEY',
	'DEEPSEEK_API_KEY',
	'TOGETHER_API_KEY',
	'FIREWORKS_API_KEY',
	'PERPLEXITY_API_KEY',
	'OPENROUTER_API_KEY',
] as const;

export type MagnusApiKeyVar = (typeof MAGNUS_API_KEY_VARS)[number];

export type MagnusProviderId = 'gemini' | 'openai' | 'anthropic' | 'azure' | 'mistral' | 'groq' | 'cohere' | 'xai' | 'deepseek' | 'together' | 'fireworks' | 'perplexity' | 'openrouter' | 'unknown';

const PROVIDER_BY_VAR: Record<string, MagnusProviderId> = {
	GEMINI_API_KEY: 'gemini',
	GOOGLE_API_KEY: 'gemini',
	OPENAI_API_KEY: 'openai',
	ANTHROPIC_API_KEY: 'anthropic',
	CLAUDE_API_KEY: 'anthropic',
	AZURE_OPENAI_API_KEY: 'azure',
	MISTRAL_API_KEY: 'mistral',
	GROQ_API_KEY: 'groq',
	COHERE_API_KEY: 'cohere',
	XAI_API_KEY: 'xai',
	DEEPSEEK_API_KEY: 'deepseek',
	TOGETHER_API_KEY: 'together',
	FIREWORKS_API_KEY: 'fireworks',
	PERPLEXITY_API_KEY: 'perplexity',
	OPENROUTER_API_KEY: 'openrouter',
};

export interface MagnusResolvedApiKey {
	readonly provider: MagnusProviderId;
	readonly varName: string;
	readonly apiKey: string;
	readonly source: 'env-file' | 'process-env';
	readonly filePath?: string;
}

function stripQuotes(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/** Minimal .env parser (KEY=VALUE). Supports optional `export `. Ignores comments and blank lines. */
export function parseEnvFileContents(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	const text = raw.replace(/^\uFEFF/, '');
	for (const line of text.split(/\r?\n/)) {
		let trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		if (trimmed.startsWith('export ')) {
			trimmed = trimmed.slice('export '.length).trim();
		}
		const eq = trimmed.indexOf('=');
		if (eq <= 0) {
			continue;
		}
		const key = trimmed.slice(0, eq).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
			continue;
		}
		out[key] = stripQuotes(trimmed.slice(eq + 1));
	}
	return out;
}

/** True when a known key name exists in `.env` but every candidate value is empty. */
export function hasEmptyApiKeyPlaceholders(extensionUri: vscode.Uri): boolean {
	for (const filePath of candidateEnvPaths(extensionUri)) {
		const parsed = readEnvFile(filePath);
		if (!parsed) {
			continue;
		}
		let sawName = false;
		for (const varName of MAGNUS_API_KEY_VARS) {
			if (Object.prototype.hasOwnProperty.call(parsed, varName)) {
				sawName = true;
				if (parsed[varName]?.trim()) {
					return false;
				}
			}
		}
		if (sawName) {
			return true;
		}
	}
	return false;
}

function readEnvFile(filePath: string): Record<string, string> | undefined {
	try {
		if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
			return undefined;
		}
		return parseEnvFileContents(fs.readFileSync(filePath, 'utf8'));
	} catch {
		return undefined;
	}
}

function candidateEnvPaths(extensionUri: vscode.Uri): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();
	const push = (p: string | undefined) => {
		if (!p) {
			return;
		}
		const resolved = path.resolve(p);
		if (seen.has(resolved)) {
			return;
		}
		seen.add(resolved);
		paths.push(resolved);
	};

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		if (folder.uri.scheme === 'file') {
			push(path.join(folder.uri.fsPath, '.env'));
			push(path.join(folder.uri.fsPath, '.env.local'));
		}
	}

	// Product / repo root: extensions/prebase-magnus → ../..
	const extFs = extensionUri.scheme === 'file' ? extensionUri.fsPath : undefined;
	if (extFs) {
		const productRoot = path.resolve(extFs, '..', '..');
		push(path.join(productRoot, '.env'));
		push(path.join(productRoot, '.env.local'));
	}

	// Launch cwd / VSCODE_CWD (scripts/code.sh sets cwd to product root).
	const cwdRoot = process.env.VSCODE_CWD || process.cwd();
	if (cwdRoot) {
		push(path.join(cwdRoot, '.env'));
		push(path.join(cwdRoot, '.env.local'));
	}

	return paths;
}

function pickFromMap(map: Record<string, string>, source: MagnusResolvedApiKey['source'], filePath?: string): MagnusResolvedApiKey | undefined {
	for (const varName of MAGNUS_API_KEY_VARS) {
		const value = map[varName]?.trim();
		if (value) {
			return {
				provider: PROVIDER_BY_VAR[varName] ?? 'unknown',
				varName,
				apiKey: value,
				source,
				filePath,
			};
		}
	}
	return undefined;
}

/**
 * Resolve any configured provider API key. Prefers workspace/product `.env`,
 * then process environment. Returns undefined when none are set.
 */
export function resolveAnyApiKey(extensionUri: vscode.Uri): MagnusResolvedApiKey | undefined {
	for (const filePath of candidateEnvPaths(extensionUri)) {
		const parsed = readEnvFile(filePath);
		if (!parsed) {
			continue;
		}
		const hit = pickFromMap(parsed, 'env-file', filePath);
		if (hit) {
			return hit;
		}
	}

	const fromProcess: Record<string, string> = {};
	for (const varName of MAGNUS_API_KEY_VARS) {
		const value = process.env[varName];
		if (value?.trim()) {
			fromProcess[varName] = value.trim();
		}
	}
	return pickFromMap(fromProcess, 'process-env');
}

/** Prefer Gemini/Google keys for the current Gemini-backed chat path. */
export function resolveGeminiApiKey(extensionUri: vscode.Uri): MagnusResolvedApiKey | undefined {
	const maps: Array<{ map: Record<string, string>; source: MagnusResolvedApiKey['source']; filePath?: string }> = [];
	for (const filePath of candidateEnvPaths(extensionUri)) {
		const parsed = readEnvFile(filePath);
		if (parsed) {
			maps.push({ map: parsed, source: 'env-file', filePath });
		}
	}
	const fromProcess: Record<string, string> = {};
	for (const varName of MAGNUS_API_KEY_VARS) {
		const value = process.env[varName];
		if (value?.trim()) {
			fromProcess[varName] = value.trim();
		}
	}
	maps.push({ map: fromProcess, source: 'process-env' });

	for (const { map, source, filePath } of maps) {
		for (const varName of ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] as const) {
			const value = map[varName]?.trim();
			if (value) {
				return { provider: 'gemini', varName, apiKey: value, source, filePath };
			}
		}
	}
	return undefined;
}

export function hasAnyApiKey(extensionUri: vscode.Uri): boolean {
	return !!resolveAnyApiKey(extensionUri);
}

/** Prefer product-root `.env`, else first workspace folder `.env`. */
export function resolvePreferredEnvFilePath(extensionUri: vscode.Uri): string {
	const candidates = candidateEnvPaths(extensionUri);
	for (const p of candidates) {
		if (fs.existsSync(p)) {
			return p;
		}
	}
	const extFs = extensionUri.scheme === 'file' ? extensionUri.fsPath : undefined;
	if (extFs) {
		return path.join(path.resolve(extFs, '..', '..'), '.env');
	}
	const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (folder?.scheme === 'file') {
		return path.join(folder.fsPath, '.env');
	}
	return path.join(process.cwd(), '.env');
}

export const ENV_KEY_HELP =
	'Add at least one API key to the project `.env` file (GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, …).';

export const ENV_KEY_EMPTY_HELP =
	'`GEMINI_API_KEY` (or another provider key) is listed in `.env` but its value is empty. Paste the key after `=`, save the file, then run Magnus: Check Configuration.';

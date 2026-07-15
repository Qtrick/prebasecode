/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	ENV_KEY_EMPTY_HELP,
	ENV_KEY_HELP,
	hasAnyApiKey,
	hasEmptyApiKeyPlaceholders,
	resolveAnyApiKey,
	resolveGeminiApiKey,
	resolvePreferredEnvFilePath,
	type MagnusResolvedApiKey,
} from './apiKeys';

/**
 * API key resolution for Magnus.
 * Primary source: gitignored `.env` (workspace or product root).
 * Optional fallback: SecretStorage (legacy), so older installs keep working.
 */
export class MagnusSecretStorage {
	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly extensionUri: vscode.Uri,
	) { }

	async getAnyKey(): Promise<MagnusResolvedApiKey | undefined> {
		const fromEnv = resolveAnyApiKey(this.extensionUri);
		if (fromEnv) {
			return fromEnv;
		}
		const legacy = await this.secrets.get('prebase.magnus.geminiApiKey');
		const trimmed = legacy?.trim();
		if (trimmed) {
			return {
				provider: 'gemini',
				varName: 'GEMINI_API_KEY',
				apiKey: trimmed,
				source: 'env-file',
				filePath: undefined,
			};
		}
		return undefined;
	}

	/** Key for the current Gemini-backed model path. */
	async getApiKey(): Promise<string | undefined> {
		const gemini = resolveGeminiApiKey(this.extensionUri);
		if (gemini) {
			return gemini.apiKey;
		}
		const any = await this.getAnyKey();
		// Only return non-Gemini keys when nothing Gemini-specific exists —
		// callers that need Gemini should check provider separately.
		if (any?.provider === 'gemini') {
			return any.apiKey;
		}
		const legacy = await this.secrets.get('prebase.magnus.geminiApiKey');
		return legacy?.trim() || undefined;
	}

	async getGeminiKeyOrMessage(): Promise<{ key?: string; message?: string }> {
		const gemini = resolveGeminiApiKey(this.extensionUri);
		if (gemini) {
			return { key: gemini.apiKey };
		}
		const legacy = await this.secrets.get('prebase.magnus.geminiApiKey');
		if (legacy?.trim()) {
			return { key: legacy.trim() };
		}
		const any = resolveAnyApiKey(this.extensionUri);
		if (any) {
			return {
				message: `Found ${any.varName}, but Gemini models need \`GEMINI_API_KEY\` (or \`GOOGLE_API_KEY\`) in \`.env\`. ${ENV_KEY_HELP}`,
			};
		}
		if (hasEmptyApiKeyPlaceholders(this.extensionUri)) {
			return { message: ENV_KEY_EMPTY_HELP };
		}
		return { message: ENV_KEY_HELP };
	}

	async hasApiKey(): Promise<boolean> {
		if (hasAnyApiKey(this.extensionUri)) {
			return true;
		}
		return !!(await this.secrets.get('prebase.magnus.geminiApiKey'))?.trim();
	}

	getEnvFilePath(): string {
		return resolvePreferredEnvFilePath(this.extensionUri);
	}

	async openEnvFile(): Promise<void> {
		const filePath = this.getEnvFilePath();
		const uri = vscode.Uri.file(filePath);
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			const template = [
				'# PreBase / Magnus API keys — paste at least ONE key',
				'GEMINI_API_KEY=',
				'OPENAI_API_KEY=',
				'ANTHROPIC_API_KEY=',
				'',
			].join('\n');
			await vscode.workspace.fs.writeFile(uri, Buffer.from(template, 'utf8'));
		}
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc, { preview: false });
	}

	/** @deprecated Prefer editing `.env`. Kept for command compatibility. */
	async setApiKey(apiKey: string): Promise<void> {
		await this.secrets.store('prebase.magnus.geminiApiKey', apiKey.trim());
	}

	async clearApiKey(): Promise<void> {
		await this.secrets.delete('prebase.magnus.geminiApiKey');
	}
}

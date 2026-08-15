/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { registerMagnusChatParticipants, type MagnusChatState } from './chatParticipant';
import { generateContent } from './geminiClient';
import { MagnusLanguageModelProvider } from './languageModelProvider';
import { MAGNUS_MODELS, resolveApiModel } from './models';
import { DEFAULT_MAGNUS_AGENT_MODE, MAGNUS_AGENT_MODES, isMagnusAgentMode } from './modes';
import { registerMagnusDesktopTools } from './desktopTools';
import { registerMagnusLanguageModelTools } from './nativeTools';
import { MagnusSecretStorage } from './secretStorage';

const CHAT_MARK_SETUP_COMPLETED = 'workbench.action.chat.markSetupCompleted';

async function markChatSetupCompleted(): Promise<void> {
	try {
		await vscode.commands.executeCommand(CHAT_MARK_SETUP_COMPLETED);
	} catch {
		// Workbench command may be unavailable in some hosts; ignore.
	}
}

async function tryGetCommandResult<T>(command: string): Promise<T | undefined> {
	try {
		return await vscode.commands.executeCommand<T>(command);
	} catch {
		return undefined;
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const secrets = new MagnusSecretStorage(context.secrets);
	const config = vscode.workspace.getConfiguration('prebase.magnus');

	const state: MagnusChatState = {
		mode: isMagnusAgentMode(config.get('defaultMode', DEFAULT_MAGNUS_AGENT_MODE) ?? DEFAULT_MAGNUS_AGENT_MODE)
			? (config.get('defaultMode') as typeof DEFAULT_MAGNUS_AGENT_MODE)
			: DEFAULT_MAGNUS_AGENT_MODE,
		modelId: config.get('defaultModel', 'auto') ?? 'auto',
		attachedFiles: [],
	};

	// Register chat participants first so Ask/Edit/Agent appear even if the LM
	// provider proposal is unavailable or no API key is configured yet.
	registerMagnusChatParticipants(context, secrets, state);
	registerMagnusLanguageModelTools(context);
	registerMagnusDesktopTools(context);

	const lmProvider = new MagnusLanguageModelProvider(secrets);
	try {
		context.subscriptions.push(
			vscode.lm.registerLanguageModelChatProvider('magnus', lmProvider),
		);
		// Kick an immediate model refresh so the workbench picker can list Magnus models.
		lmProvider.notifyChanged();
	} catch (err) {
		console.error('[Agents] language model provider registration failed:', err);
	}

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('prebase.magnus.defaultModel')) {
				state.modelId = vscode.workspace.getConfiguration('prebase.magnus').get('defaultModel', 'auto') ?? 'auto';
				lmProvider.notifyChanged();
			}
			if (e.affectsConfiguration('prebase.magnus.defaultMode')) {
				const nextMode = vscode.workspace.getConfiguration('prebase.magnus').get('defaultMode', DEFAULT_MAGNUS_AGENT_MODE);
				if (isMagnusAgentMode(nextMode)) {
					state.mode = nextMode;
				}
			}
		}),

		vscode.commands.registerCommand('prebase.magnus.open', async () => {
			try {
				await vscode.commands.executeCommand('workbench.panel.chat');
			} catch {
				// ignore if view command missing
			}
			await vscode.commands.executeCommand('workbench.action.chat.open', {
				query: '',
				isPartialQuery: false,
			});
		}),

		vscode.commands.registerCommand('prebase.magnus.setApiKey', async () => {
			const value = await vscode.window.showInputBox({
				title: 'Configure Agents Model Provider',
				prompt: 'Enter the Gemini API key to store securely on this device.',
				password: true,
				ignoreFocusOut: true,
			});
			if (!value) {
				return;
			}
			await secrets.setProviderApiKey('gemini', value);
			lmProvider.notifyChanged();
			void vscode.window.showInformationMessage('Agents model provider (Gemini) configured in secure storage.');
		}),

		vscode.commands.registerCommand('prebase.magnus.clearApiKey', async () => {
			await secrets.clearProviderApiKey('gemini');
			void vscode.window.showInformationMessage('Cleared the configured Agents Gemini credential.');
			lmProvider.notifyChanged();
		}),

		vscode.commands.registerCommand('prebase.magnus.importApiKeyFromEnv', async () => {
			if (!vscode.workspace.isTrusted) {
				void vscode.window.showWarningMessage('Importing environment credentials requires a trusted workspace.');
				return;
			}
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				void vscode.window.showWarningMessage('No open workspace folder to import from.');
				return;
			}

			let envContent: string | undefined;
			let foundEnvName = '.env';
			for (const folder of workspaceFolders) {
				try {
					const envUri = vscode.Uri.joinPath(folder.uri, '.env');
					const bytes = await vscode.workspace.fs.readFile(envUri);
					envContent = new TextDecoder().decode(bytes);
					foundEnvName = `.env in ${folder.name}`;
					break;
				} catch {
					// Try next folder
				}
			}

			if (!envContent) {
				void vscode.window.showInformationMessage('No .env file found in workspace root.');
				return;
			}

			// Parse specifically for GEMINI_API_KEY without exposing or logging value
			let candidateKey: string | undefined;
			for (const line of envContent.split('\n')) {
				const trimmed = line.trim();
				if (trimmed.startsWith('#') || !trimmed.includes('=')) {
					continue;
				}
				const [varName, ...rest] = trimmed.split('=');
				const name = varName.trim();
				if (name === 'GEMINI_API_KEY' || name === 'GOOGLE_API_KEY') {
					let val = rest.join('=').trim();
					const firstChar = val.charCodeAt(0);
					const lastChar = val.charCodeAt(val.length - 1);
					if ((firstChar === 34 && lastChar === 34) || (firstChar === 39 && lastChar === 39)) {
						val = val.slice(1, -1);
					}
					if (val.trim()) {
						candidateKey = val.trim();
						break;
					}
				}
			}

			if (!candidateKey) {
				void vscode.window.showInformationMessage(`No GEMINI_API_KEY found in ${foundEnvName}.`);
				return;
			}

			const answer = await vscode.window.showInformationMessage(
				`Found GEMINI_API_KEY in ${foundEnvName}. Import into PreBase secure OS storage?`,
				{ modal: true },
				'Import to Secure Storage',
			);

			if (answer === 'Import to Secure Storage') {
				await secrets.setProviderApiKey('gemini', candidateKey);
				lmProvider.notifyChanged();
				void vscode.window.showInformationMessage('Gemini API key successfully imported into PreBase secure storage.');
			}
		}),

		vscode.commands.registerCommand('prebase.magnus.importApiKeyFromProcessEnv', async () => {
			const envKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
			if (!envKey) {
				void vscode.window.showInformationMessage('No GEMINI_API_KEY found in the IDE runtime environment.');
				return;
			}

			const answer = await vscode.window.showInformationMessage(
				'Found GEMINI_API_KEY in environment variables. Import into PreBase secure OS storage?',
				{ modal: true },
				'Import to Secure Storage',
			);

			if (answer === 'Import to Secure Storage') {
				await secrets.setProviderApiKey('gemini', envKey);
				lmProvider.notifyChanged();
				void vscode.window.showInformationMessage('Gemini API key successfully imported from environment into PreBase secure storage.');
			}
		}),

		vscode.commands.registerCommand('prebase.magnus.testModelProvider', async () => {
			const gemini = await secrets.getGeminiKeyOrMessage();
			if (!gemini.key) {
				void vscode.window.showErrorMessage('Agents has no configured Gemini credential. Use “Agents: Configure Model Provider” or “Agents: Import Provider Key from .env…”.');
				return { ok: false, error: 'notConfigured' };
			}
			const modelInfo = resolveModelInfo(state.modelId);
			try {
				const reply = await generateContent(gemini.key, modelInfo.apiModel, {
					contents: [{ role: 'user', parts: [{ text: 'Respond with exactly "PONG" in one word.' }] }],
					generationConfig: { maxOutputTokens: 16, temperature: 0.0 },
				});
				void vscode.window.showInformationMessage(`Agents connection test succeeded (${modelInfo.apiModel}): ${reply.slice(0, 30)}`);
				return { ok: true, model: modelInfo.apiModel, reply };
			} catch (err) {
				const classification = classifyGeminiError(err);
				void vscode.window.showErrorMessage(`Agents connection test failed: ${classification.safeMessage}`);
				return { ok: false, error: classification.status, message: classification.safeMessage };
			}
		}),

		vscode.commands.registerCommand('prebase.magnus.checkConfiguration', async () => {
			const any = await secrets.getAnyKey();
			const gemini = await secrets.getGeminiKeyOrMessage();
			const enabled = vscode.workspace.getConfiguration('prebase.magnus').get('enabled', true);
			let keyStatus: string;
			if (any) {
				keyStatus = 'Model provider: Gemini configured in secure storage';
			} else if (gemini.message) {
				keyStatus = `Model provider: ${gemini.message}`;
			} else {
				keyStatus = 'Model provider: not configured';
			}
			const lines = [
				`Enabled: ${enabled}`,
				keyStatus,
				`Default model: ${state.modelId}`,
				`Default mode: ${state.mode}`,
				'Model credentials are never read from workspace files.',
			];
			void vscode.window.showInformationMessage(lines.join(' · '));
		}),

		vscode.commands.registerCommand('prebase.magnus.hasApiKey', async () => {
			return secrets.hasApiKey();
		}),

		vscode.commands.registerCommand('prebase.magnus.describeFile', async (payload?: { prompt?: string; path?: string }): Promise<import('./models').MagnusDescriptionResult> => {
			const enabled = vscode.workspace.getConfiguration('prebase.magnus').get('enabled', true);
			if (!enabled) {
				return {
					status: 'disabled',
					providerId: 'gemini',
					safeMessage: 'Agents is disabled in settings.',
					retryable: false,
				};
			}

			const gemini = await secrets.getGeminiKeyOrMessage();
			if (!gemini.key) {
				return {
					status: 'notConfigured',
					providerId: 'gemini',
					safeMessage: 'AI description unavailable — no Gemini credential is configured.',
					retryable: false,
				};
			}
			const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
			if (!prompt) {
				return {
					status: 'skipped',
					providerId: 'gemini',
					safeMessage: 'No content available for description.',
					retryable: false,
				};
			}
			const modelInfo = resolveModelInfo(state.modelId);
			try {
				const text = await generateContent(gemini.key, modelInfo.apiModel, {
					contents: [{ role: 'user', parts: [{ text: prompt }] }],
					generationConfig: {
						maxOutputTokens: 256,
						temperature: 0.2,
					},
				});
				const trimmed = text.trim();
				if (!trimmed) {
					return {
						status: 'error',
						providerId: 'gemini',
						modelId: modelInfo.resolvedModelId,
						safeMessage: 'AI model returned an empty description.',
						retryable: true,
					};
				}
				return {
					status: 'ready',
					text: trimmed,
					providerId: 'gemini',
					modelId: modelInfo.resolvedModelId,
					cacheIdentity: `gemini:${modelInfo.resolvedModelId}`,
					retryable: false,
				};
			} catch (err) {
				const classification = classifyGeminiError(err);
				return {
					status: classification.status,
					providerId: 'gemini',
					modelId: modelInfo.resolvedModelId,
					safeMessage: classification.safeMessage,
					retryable: classification.retryable,
				};
			}
		}),

		vscode.commands.registerCommand('prebase.magnus.newSession', async () => {
			state.attachedFiles = [];
			state.graphSelection = undefined;
			state.runtimeContext = undefined;
			state.cancellation?.cancel();
			state.cancellation?.dispose();
			state.cancellation = undefined;
			await vscode.commands.executeCommand('workbench.action.chat.newChat');
			void vscode.window.showInformationMessage('Agents session cleared.');
		}),

		vscode.commands.registerCommand('prebase.magnus.selectModel', async () => {
			const picked = await vscode.window.showQuickPick(
				MAGNUS_MODELS.map(m => ({ label: m.name, id: m.id })),
				{ title: 'Select Agents Model' },
			);
			if (picked) {
				state.modelId = picked.id;
				await vscode.workspace.getConfiguration('prebase.magnus').update('defaultModel', picked.id, vscode.ConfigurationTarget.Global);
				void vscode.window.showInformationMessage(`Agents model: ${picked.label}`);
			}
		}),

		vscode.commands.registerCommand('prebase.magnus.selectMode', async () => {
			const picked = await vscode.window.showQuickPick(
				MAGNUS_AGENT_MODES.map(m => ({
					label: m.label,
					id: m.id,
				})),
				{ title: 'Select Agents Mode' },
			);
			if (picked) {
				state.mode = picked.id;
				await vscode.workspace.getConfiguration('prebase.magnus').update('defaultMode', picked.id, vscode.ConfigurationTarget.Global);
				void vscode.window.showInformationMessage(`Agents mode: ${picked.label}`);
			}
		}),

		vscode.commands.registerCommand('prebase.magnus.cancel', () => {
			state.cancellation?.cancel();
			void vscode.window.showInformationMessage('Agents cancellation requested.');
		}),

		vscode.commands.registerCommand('prebase.magnus.attachCurrentFile', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				void vscode.window.showWarningMessage('No active editor.');
				return;
			}
			const rel = vscode.workspace.asRelativePath(editor.document.uri);
			if (!state.attachedFiles.includes(rel)) {
				state.attachedFiles.push(rel);
			}
			void vscode.window.showInformationMessage(`Attached ${rel}`);
		}),

		vscode.commands.registerCommand('prebase.magnus.attachGraphSelection', async (payload?: string) => {
			let summary = typeof payload === 'string' ? payload.trim() : '';
			if (!summary) {
				summary = (await tryGetCommandResult<string>('prebase.graph.getSelectionForMagnus'))?.trim() ?? '';
			}
			if (!summary) {
				const text = await vscode.window.showInputBox({
					title: 'Attach Graph Selection',
					prompt: 'No graph selection found. Paste a node summary, or select a node in PreBase Maps first.',
				});
				summary = text?.trim() ?? '';
			}
			state.graphSelection = summary || undefined;
			void vscode.window.showInformationMessage(state.graphSelection ? 'Graph selection attached.' : 'Graph selection cleared.');
		}),

		vscode.commands.registerCommand('prebase.magnus.attachRuntimeContext', async (payload?: string) => {
			let summary = typeof payload === 'string' ? payload.trim() : '';
			if (!summary) {
				summary = (await tryGetCommandResult<string>('prebase.runtime.getContextForMagnus'))?.trim() ?? '';
			}
			if (!summary) {
				const text = await vscode.window.showInputBox({
					title: 'Attach Runtime Context',
					prompt: 'No runtime session found. Paste console / network evidence, or open Runtime Preview first.',
				});
				summary = text?.trim() ?? '';
			}
			state.runtimeContext = summary || undefined;
			void vscode.window.showInformationMessage(state.runtimeContext ? 'Runtime context attached.' : 'Runtime context cleared.');
		}),

		vscode.commands.registerCommand('prebase.magnus.open.walkthrough', async () => {
			await vscode.commands.executeCommand('workbench.action.openWalkthrough', 'Setup', true);
		}),
		vscode.commands.registerCommand('prebase.magnus.refreshToken', async () => {
			lmProvider.notifyChanged();
			const hasKey = await secrets.hasApiKey();
			void vscode.window.showInformationMessage(hasKey ? 'Agents model provider configured.' : 'Agents model provider is not configured.');
		}),
		vscode.commands.registerCommand('prebase.magnus.toggleStatusMenu', async () => {
			await vscode.commands.executeCommand('prebase.magnus.checkConfiguration');
		}),
		vscode.commands.registerCommand('prebase.magnus.git.generateCommitMessage', async () => {
			void vscode.window.showInformationMessage('Agents commit-message generation is not enabled yet.');
		}),
		vscode.commands.registerCommand('prebase.magnus.git.resolveMergeConflicts', async () => {
			void vscode.window.showInformationMessage('Agents merge-conflict resolution is not enabled yet.');
		}),
		vscode.commands.registerCommand('prebase.magnus.debug.extensionState', async () => {
			const any = await secrets.getAnyKey();
			void vscode.window.showInformationMessage(
				`Agents: active · key=${any ? `${any.varName}/${any.provider}` : 'no'} · model=${state.modelId} · mode=${state.mode}`,
			);
		}),
	);

	// Auto-complete chat setup when at least one provider key is present — no UI prompt.
	void secrets.hasApiKey().then(async hasKey => {
		lmProvider.notifyChanged();
		if (hasKey) {
			await markChatSetupCompleted();
		}
	});
}

export function deactivate(): void {
	// no-op
}

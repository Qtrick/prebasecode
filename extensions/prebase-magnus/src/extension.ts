/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ENV_KEY_HELP } from './apiKeys';
import { registerMagnusChatParticipants, type MagnusChatState } from './chatParticipant';
import { generateContent } from './geminiClient';
import { MagnusLanguageModelProvider } from './languageModelProvider';
import { MAGNUS_MODELS, resolveApiModel } from './models';
import { DEFAULT_MAGNUS_AGENT_MODE, MAGNUS_AGENT_MODES, isMagnusAgentMode } from './modes';
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
	const secrets = new MagnusSecretStorage(context.secrets, context.extensionUri);
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

	const lmProvider = new MagnusLanguageModelProvider(secrets);
	try {
		context.subscriptions.push(
			vscode.lm.registerLanguageModelChatProvider('magnus', lmProvider),
		);
	} catch {
		// Proposed chatProvider API may be missing in some hosts; participants still work.
	}

	const refreshKeys = () => {
		lmProvider.notifyChanged();
		void secrets.hasApiKey().then(hasKey => {
			if (hasKey) {
				void markChatSetupCompleted();
			}
		});
	};

	// Hot-reload when the user edits `.env` in the workspace or product root.
	const envWatcher = vscode.workspace.createFileSystemWatcher('**/.env');
	const productRoot = vscode.Uri.joinPath(context.extensionUri, '..', '..');
	const productEnvWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(productRoot, '.env'),
	);
	context.subscriptions.push(
		envWatcher,
		envWatcher.onDidChange(refreshKeys),
		envWatcher.onDidCreate(refreshKeys),
		envWatcher.onDidDelete(refreshKeys),
		productEnvWatcher,
		productEnvWatcher.onDidChange(refreshKeys),
		productEnvWatcher.onDidCreate(refreshKeys),
		productEnvWatcher.onDidDelete(refreshKeys),
	);

	context.subscriptions.push(
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
			await secrets.openEnvFile();
			void vscode.window.showInformationMessage(
				'Paste any provider API key into `.env` (at least one required). Save the file to apply.',
			);
		}),

		vscode.commands.registerCommand('prebase.magnus.clearApiKey', async () => {
			await secrets.clearApiKey();
			await secrets.openEnvFile();
			void vscode.window.showInformationMessage('Cleared legacy secret storage. Remove keys from `.env` if needed.');
			lmProvider.notifyChanged();
		}),

		vscode.commands.registerCommand('prebase.magnus.checkConfiguration', async () => {
			const any = await secrets.getAnyKey();
			const enabled = vscode.workspace.getConfiguration('prebase.magnus').get('enabled', true);
			const lines = [
				`Enabled: ${enabled}`,
				any
					? `API key: ${any.varName} (${any.provider}) via ${any.source}`
					: `API key: missing — ${ENV_KEY_HELP}`,
				`Default model: ${state.modelId}`,
				`Default mode: ${state.mode}`,
				`Env file: ${secrets.getEnvFilePath()}`,
			];
			void vscode.window.showInformationMessage(lines.join(' · '));
		}),

		vscode.commands.registerCommand('prebase.magnus.hasApiKey', async () => {
			return secrets.hasApiKey();
		}),

		vscode.commands.registerCommand('prebase.magnus.describeFile', async (payload?: { prompt?: string; path?: string }) => {
			const gemini = await secrets.getGeminiKeyOrMessage();
			if (!gemini.key) {
				return undefined;
			}
			const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
			if (!prompt) {
				return undefined;
			}
			const apiModel = resolveApiModel(state.modelId);
			try {
				const text = await generateContent(gemini.key, apiModel, {
					contents: [{ role: 'user', parts: [{ text: prompt }] }],
					generationConfig: {
						maxOutputTokens: 256,
						temperature: 0.2,
					},
				});
				const trimmed = text.trim();
				return trimmed ? { text: trimmed } : undefined;
			} catch {
				return undefined;
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
			void vscode.window.showInformationMessage('Magnus session cleared.');
		}),

		vscode.commands.registerCommand('prebase.magnus.selectModel', async () => {
			const picked = await vscode.window.showQuickPick(
				MAGNUS_MODELS.map(m => ({ label: m.name, id: m.id })),
				{ title: 'Select Magnus Model' },
			);
			if (picked) {
				state.modelId = picked.id;
				await vscode.workspace.getConfiguration('prebase.magnus').update('defaultModel', picked.id, vscode.ConfigurationTarget.Global);
				void vscode.window.showInformationMessage(`Magnus model: ${picked.label}`);
			}
		}),

		vscode.commands.registerCommand('prebase.magnus.selectMode', async () => {
			const picked = await vscode.window.showQuickPick(
				MAGNUS_AGENT_MODES.map(m => ({
					label: m.label,
					id: m.id,
				})),
				{ title: 'Select Magnus Mode' },
			);
			if (picked) {
				state.mode = picked.id;
				await vscode.workspace.getConfiguration('prebase.magnus').update('defaultMode', picked.id, vscode.ConfigurationTarget.Global);
				void vscode.window.showInformationMessage(`Magnus mode: ${picked.label}`);
			}
		}),

		vscode.commands.registerCommand('prebase.magnus.cancel', () => {
			state.cancellation?.cancel();
			void vscode.window.showInformationMessage('Magnus cancellation requested.');
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
			void vscode.window.showInformationMessage(hasKey ? 'Magnus API key(s) detected.' : ENV_KEY_HELP);
		}),
		vscode.commands.registerCommand('prebase.magnus.toggleStatusMenu', async () => {
			await vscode.commands.executeCommand('prebase.magnus.checkConfiguration');
		}),
		vscode.commands.registerCommand('prebase.magnus.git.generateCommitMessage', async () => {
			void vscode.window.showInformationMessage('Magnus commit-message generation is not enabled yet.');
		}),
		vscode.commands.registerCommand('prebase.magnus.git.resolveMergeConflicts', async () => {
			void vscode.window.showInformationMessage('Magnus merge-conflict resolution is not enabled yet.');
		}),
		vscode.commands.registerCommand('prebase.magnus.debug.extensionState', async () => {
			const any = await secrets.getAnyKey();
			void vscode.window.showInformationMessage(
				`Magnus: active · key=${any ? `${any.varName}/${any.provider}` : 'no'} · model=${state.modelId} · mode=${state.mode}`,
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

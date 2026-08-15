/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { registerMagnusChatParticipants, type MagnusChatState } from './chatParticipant';
import { MagnusLanguageModelProvider } from './languageModelProvider';
import { buildModelOptions } from './models';
import { DEFAULT_MAGNUS_AGENT_MODE, MAGNUS_AGENT_MODES, isMagnusAgentMode } from './modes';
import { registerMagnusDesktopTools } from './desktopTools';
import { registerMagnusLanguageModelTools } from './nativeTools';
import { MagnusSecretStorage } from './secretStorage';
import { PreBaseAIService, VsCodeWorkspaceConfigProvider } from './aiService';
import { globalAIProviderRegistry } from './aiProviderRegistry';
import { findPreBaseSourceRoot, PreBaseSecretResolver } from './secretResolver';
import type { PreBaseAIExecutionMode } from './secretCatalog';

export interface SafeMagnusError {
	readonly phase: string;
	readonly message: string;
}

export interface MagnusRuntimeState {
	activationStarted: boolean;
	activationCompleted: boolean;
	aiServiceInitialized: boolean;
	coreCommandsRegistered: boolean;
	describeFileRegistered: boolean;
	languageModelProviderRegistered: boolean;
	chatParticipantsRegistered: boolean;
	nativeToolsRegistered: boolean;
	desktopToolsRegistered: boolean;
	activationError?: SafeMagnusError;
	optionalSubsystemErrors: SafeMagnusError[];
}

export const runtimeState: MagnusRuntimeState = {
	activationStarted: false,
	activationCompleted: false,
	aiServiceInitialized: false,
	coreCommandsRegistered: false,
	describeFileRegistered: false,
	languageModelProviderRegistered: false,
	chatParticipantsRegistered: false,
	nativeToolsRegistered: false,
	desktopToolsRegistered: false,
	optionalSubsystemErrors: [],
};

export function activate(context: vscode.ExtensionContext): void {
	runtimeState.activationStarted = true;
	runtimeState.activationError = undefined;
	runtimeState.optionalSubsystemErrors = [];
	console.log('[Magnus] activation started');

	try {
		// 1. Initialize secret resolver with deterministic root from extension path
		const explicitRoot = findPreBaseSourceRoot(context.extensionPath);
		const resolver = new PreBaseSecretResolver({ explicitRoot });
		const secrets = new MagnusSecretStorage(context.secrets, resolver);
		console.log('[Magnus] secret resolver initialized');

		// 2. Initialize AI service
		const configProvider = new VsCodeWorkspaceConfigProvider(() => vscode.workspace.getConfiguration('prebase.magnus'));
		const aiService = new PreBaseAIService(secrets, globalAIProviderRegistry, configProvider);
		runtimeState.aiServiceInitialized = true;
		console.log('[Magnus] AI service initialized');

		const config = vscode.workspace.getConfiguration('prebase.magnus');
		const state: MagnusChatState = {
			mode: isMagnusAgentMode(config.get('defaultMode', DEFAULT_MAGNUS_AGENT_MODE) ?? DEFAULT_MAGNUS_AGENT_MODE)
				? (config.get('defaultMode') as typeof DEFAULT_MAGNUS_AGENT_MODE)
				: DEFAULT_MAGNUS_AGENT_MODE,
			modelId: config.get('defaultModel', 'auto') ?? 'auto',
			attachedFiles: [],
		};

		// 3. Register describeFile early so Code Graph can describe files even before other tools
		context.subscriptions.push(
			vscode.commands.registerCommand('prebase.magnus.describeFile', async (payload?: { prompt?: string; path?: string }): Promise<import('./models').MagnusDescriptionResult> => {
				const prompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
				const filePath = typeof payload?.path === 'string' ? payload.path : undefined;
				return await aiService.describeFile(prompt, filePath);
			}),
		);
		runtimeState.describeFileRegistered = true;
		console.log('[Magnus] describeFile registered');

		// 4. Register language model provider
		const lmProvider = new MagnusLanguageModelProvider(aiService);
		try {
			context.subscriptions.push(
				vscode.lm.registerLanguageModelChatProvider('magnus', lmProvider),
			);
			runtimeState.languageModelProviderRegistered = true;
			console.log('[Magnus] language model provider registered');
			lmProvider.notifyChanged();
		} catch (err) {
			const safeErr: SafeMagnusError = {
				phase: 'languageModelProvider',
				message: err instanceof Error ? err.message : String(err),
			};
			runtimeState.optionalSubsystemErrors.push(safeErr);
			console.error('[Magnus] language model provider registration failed:', safeErr.message);
		}

		// 5. Register chat participants
		try {
			registerMagnusChatParticipants(context, aiService, state);
			runtimeState.chatParticipantsRegistered = true;
			console.log('[Magnus] chat participants registered');
		} catch (err) {
			const safeErr: SafeMagnusError = {
				phase: 'chatParticipants',
				message: err instanceof Error ? err.message : String(err),
			};
			runtimeState.optionalSubsystemErrors.push(safeErr);
			console.error('[Magnus] chat participants registration failed:', safeErr.message);
		}

		// 6. Register core native language-model tools
		try {
			registerMagnusLanguageModelTools(context, secrets);
			runtimeState.nativeToolsRegistered = true;
			console.log('[Magnus] native tools registered');
		} catch (err) {
			const safeErr: SafeMagnusError = {
				phase: 'nativeTools',
				message: err instanceof Error ? err.message : String(err),
			};
			runtimeState.optionalSubsystemErrors.push(safeErr);
			console.error('[Magnus] native tools registration failed:', safeErr.message);
		}

		// 7. Register optional desktop language-model tools (isolated failure boundary)
		try {
			registerMagnusDesktopTools(context);
			runtimeState.desktopToolsRegistered = true;
			console.log('[Magnus] desktop tools registered');
		} catch (err) {
			const safeErr: SafeMagnusError = {
				phase: 'desktopTools',
				message: err instanceof Error ? err.message : String(err),
			};
			runtimeState.optionalSubsystemErrors.push(safeErr);
			console.error('[Magnus] desktop tools registration failed:', safeErr.message);
		}

		// 8. Configuration listener & core commands
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
				if (e.affectsConfiguration('prebase.magnus.executionMode') || e.affectsConfiguration('prebase.magnus.provider')) {
					secrets.refreshRootEnv();
					aiService.invalidateModelCache();
					lmProvider.notifyChanged();
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

			vscode.commands.registerCommand('prebase.magnus.open.walkthrough', async () => {
				try {
					await vscode.commands.executeCommand('workbench.action.openWalkthrough', 'prebase.magnus#magnusWalkthrough', false);
				} catch {
					await vscode.commands.executeCommand('prebase.magnus.open');
				}
			}),

			vscode.commands.registerCommand('prebase.magnus.toggleStatusMenu', async () => {
				await vscode.commands.executeCommand('prebase.magnus.checkConfiguration');
			}),

			vscode.commands.registerCommand('prebase.magnus.refreshToken', async () => {
				secrets.refreshRootEnv();
				aiService.invalidateModelCache();
				lmProvider.notifyChanged();
				await lmProvider.refreshDiscoveredModels();
				const status = await aiService.getProviderStatus();
				return {
					ok: true,
					configured: status.configured,
					executionMode: status.executionMode,
					effectiveSource: status.effectiveSource,
				};
			}),

			vscode.commands.registerCommand('prebase.magnus.debug.extensionState', async () => {
				const status = await aiService.getProviderStatus();
				const diag = await secrets.getDiagnostics();
				const models = await aiService.listModels(undefined, false);
				return {
					extensionId: 'prebase.magnus',
					extensionVersion: context.extension?.packageJSON?.version ?? '0.1.0',
					activated: runtimeState.activationCompleted,
					activationStarted: runtimeState.activationStarted,
					activationCompleted: runtimeState.activationCompleted,
					aiServiceInitialized: runtimeState.aiServiceInitialized,
					coreCommandsRegistered: runtimeState.coreCommandsRegistered,
					describeFileRegistered: runtimeState.describeFileRegistered,
					languageModelProviderRegistered: runtimeState.languageModelProviderRegistered,
					chatParticipantsRegistered: runtimeState.chatParticipantsRegistered,
					nativeToolsRegistered: runtimeState.nativeToolsRegistered,
					desktopToolsRegistered: runtimeState.desktopToolsRegistered,
					activationError: runtimeState.activationError,
					optionalSubsystemErrors: runtimeState.optionalSubsystemErrors,
					providerId: status.providerId,
					executionMode: status.executionMode,
					effectiveSource: status.effectiveSource,
					configured: status.configured,
					modelCount: models.length,
					selectedModel: state.modelId,
					sourceDevelopmentDetected: diag.isSourceDev,
					resolvedPreBaseRoot: diag.resolvedRootPresent ? diag.resolvedRootPath : undefined,
					rootEnvFilePresent: diag.rootEnvPresent,
					hostedAvailable: aiService.isCloudHostedAvailable(),
					lastProviderErrorCategory: undefined,
				};
			}),

			vscode.commands.registerCommand('prebase.magnus.git.generateCommitMessage', async () => {
				const status = await aiService.getProviderStatus();
				if (!status.configured) {
					void vscode.window.showWarningMessage('Configure an AI model provider in Agents Settings to generate commit messages.');
					return undefined;
				}
				try {
					const result = await aiService.generateText(
						'Generate a concise git commit message (under 72 chars, conventional commit format) for the current changes.',
						{ modelId: state.modelId },
					);
					return result.trim();
				} catch (err) {
					void vscode.window.showErrorMessage(`Failed to generate commit message: ${err instanceof Error ? err.message : String(err)}`);
					return undefined;
				}
			}),

			vscode.commands.registerCommand('prebase.magnus.git.resolveMergeConflicts', async () => {
				void vscode.window.showInformationMessage('Open the Agents chat panel and ask to resolve git merge conflicts.');
				await vscode.commands.executeCommand('prebase.magnus.open');
			}),

			vscode.commands.registerCommand('prebase.magnus.setApiKey', async () => {
				const value = await vscode.window.showInputBox({
					title: 'Configure Agents Model Provider',
					prompt: 'Enter the Gemini API key to store securely in OS SecretStorage.',
					password: true,
					ignoreFocusOut: true,
				});
				if (!value) {
					return;
				}
				await secrets.setProviderApiKey('gemini', value);
				secrets.refreshRootEnv();
				aiService.invalidateModelCache('gemini');
				lmProvider.notifyChanged();
				void vscode.window.showInformationMessage('Agents model provider (Gemini) configured in secure storage.');
			}),

			vscode.commands.registerCommand('prebase.magnus.clearApiKey', async () => {
				await secrets.clearProviderApiKey('gemini');
				secrets.refreshRootEnv();
				aiService.invalidateModelCache('gemini');
				void vscode.window.showInformationMessage('Cleared the configured Agents Gemini credential from secure storage.');
				lmProvider.notifyChanged();
			}),

			vscode.commands.registerCommand('prebase.magnus.importApiKeyFromEnv', async () => {
				if (!vscode.workspace.isTrusted) {
					void vscode.window.showWarningMessage('Importing environment credentials requires a trusted workspace.');
					return;
				}

				// Check if already configured via PreBase root .env
				const resolved = await secrets.getResolvedProviderApiKey('gemini');
				if (resolved?.source === 'local-env') {
					const answer = await vscode.window.showInformationMessage(
						'PreBase is already using GEMINI_API_KEY from the PreBase repository root .env. Would you like to copy it into OS SecretStorage?',
						'Copy to Secure Storage',
						'Cancel',
					);
					if (answer === 'Copy to Secure Storage') {
						await secrets.setProviderApiKey('gemini', resolved.key);
						aiService.invalidateModelCache('gemini');
						lmProvider.notifyChanged();
						void vscode.window.showInformationMessage('Gemini key copied into PreBase OS SecretStorage.');
					}
					return;
				}

				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders || workspaceFolders.length === 0) {
					void vscode.window.showWarningMessage('No open workspace folder to inspect.');
					return;
				}

				let envContent: string | undefined;
				let foundFolder: string | undefined;
				for (const folder of workspaceFolders) {
					try {
						const envUri = vscode.Uri.joinPath(folder.uri, '.env');
						const bytes = await vscode.workspace.fs.readFile(envUri);
						envContent = new TextDecoder().decode(bytes);
						foundFolder = folder.name;
						break;
					} catch {
						// Try next folder
					}
				}

				if (!envContent || !foundFolder) {
					void vscode.window.showInformationMessage('No .env file found in workspace root.');
					return;
				}

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
						if (val.length >= 2) {
							const first = val[0];
							const last = val[val.length - 1];
							if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
								val = val.slice(1, -1);
							}
						}
						if (val.trim()) {
							candidateKey = val.trim();
							break;
						}
					}
				}

				if (!candidateKey) {
					void vscode.window.showInformationMessage(`No GEMINI_API_KEY found in ${foundFolder}/.env.`);
					return;
				}

				const answer = await vscode.window.showWarningMessage(
					`Import GEMINI_API_KEY from project "${foundFolder}" into PreBase secure OS storage?`,
					{ modal: true },
					'Import to Secure Storage',
				);

				if (answer === 'Import to Secure Storage') {
					await secrets.setProviderApiKey('gemini', candidateKey);
					aiService.invalidateModelCache('gemini');
					lmProvider.notifyChanged();
					void vscode.window.showInformationMessage('Gemini API key successfully imported into PreBase secure storage.');
				}
			}),

			vscode.commands.registerCommand('prebase.magnus.importApiKeyFromProcessEnv', async () => {
				const procKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
				if (!procKey) {
					void vscode.window.showInformationMessage('No GEMINI_API_KEY or GOOGLE_API_KEY found in process environment.');
					return { ok: false, message: 'no_env_key' };
				}

				const answer = await vscode.window.showWarningMessage(
					'Import GEMINI_API_KEY from the process environment into PreBase secure OS SecretStorage?',
					{ modal: true },
					'Import to Secure Storage',
				);

				if (answer === 'Import to Secure Storage') {
					await secrets.setProviderApiKey('gemini', procKey);
					secrets.refreshRootEnv();
					aiService.invalidateModelCache('gemini');
					lmProvider.notifyChanged();
					void vscode.window.showInformationMessage('Gemini API key successfully imported from process environment into PreBase secure storage.');
					return { ok: true };
				}
				return { ok: false, message: 'cancelled' };
			}),

			vscode.commands.registerCommand('prebase.magnus.testModelProvider', async () => {
				const status = await aiService.getProviderStatus();
				if (!status.configured) {
					void vscode.window.showErrorMessage(status.safeStatusMessage || 'Agents has no configured model provider.');
					return { ok: false, error: 'notConfigured' };
				}

				try {
					const res = await aiService.testConnection();
					if (res.ok) {
						void vscode.window.showInformationMessage(`Agents connection test succeeded (${res.modelId}): ${res.reply?.slice(0, 30)}`);
						return { ok: true, model: res.modelId, reply: res.reply };
					} else {
						void vscode.window.showErrorMessage(`Agents connection test failed: ${res.error?.safeMessage}`);
						return { ok: false, error: res.error?.code, message: res.error?.safeMessage };
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					void vscode.window.showErrorMessage(`Agents connection test failed: ${msg}`);
					return { ok: false, error: 'error', message: msg };
				}
			}),

			vscode.commands.registerCommand('prebase.magnus.checkConfiguration', async () => {
				secrets.refreshRootEnv();
				const status = await aiService.getProviderStatus();
				const resolvedLinkup = await secrets.getResolvedProviderApiKey('linkup');
				const enabled = vscode.workspace.getConfiguration('prebase.magnus').get('enabled', true);

				const geminiStatus = `Gemini: ${status.safeStatusMessage}`;
				const linkupStatus = resolvedLinkup
					? `LinkUp: Connected (${resolvedLinkup.source === 'local-env' ? 'PreBase root .env' : 'Secure Storage'})`
					: 'LinkUp: Not configured (Local)';

				const lines = [
					`Enabled: ${enabled}`,
					`Execution Mode: ${status.executionMode}`,
					geminiStatus,
					linkupStatus,
					`Default model: ${state.modelId}`,
					`Default mode: ${state.mode}`,
				];
				void vscode.window.showInformationMessage(lines.join(' · '));
			}),

			vscode.commands.registerCommand('prebase.magnus.diagnoseProviders', async () => {
				secrets.refreshRootEnv();
				const diag = await secrets.getDiagnostics();
				const mode = aiService.getExecutionMode();
				const msg = [
					`PreBase Environment: ${diag.isSourceDev ? 'Source Development' : 'Packaged Application'}`,
					`Resolved Root: ${diag.resolvedRootPresent ? (diag.resolvedRootPath ?? 'present') : 'absent'}`,
					`Execution Mode: ${mode}`,
					`Gemini: Local .env=${diag.gemini.localEnv}, SecretStorage=${diag.gemini.secretStorage}, Hosted=${diag.gemini.hosted} (Active: ${diag.gemini.activeSource ?? 'none'})`,
					`LinkUp: Local .env=${diag.linkup.localEnv}, SecretStorage=${diag.linkup.secretStorage}, Hosted=${diag.linkup.hosted} (Active: ${diag.linkup.activeSource ?? 'none'})`,
				].join('\n');
				void vscode.window.showInformationMessage(msg, { modal: true });
				return diag;
			}),

			vscode.commands.registerCommand('prebase.magnus.hasApiKey', async () => {
				const status = await aiService.getProviderStatus();
				return status.configured;
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
				const models = await aiService.listModels(undefined, true);
				const modelOptions = buildModelOptions(models);

				const picked = await vscode.window.showQuickPick(
					modelOptions.map(m => ({
						label: m.name,
						description: m.id === state.modelId ? '(Current)' : undefined,
						detail: m.description,
						id: m.id,
					})),
					{ title: 'Select Agents Model' },
				);
				if (picked) {
					state.modelId = picked.id;
					await aiService.setActiveModelId(picked.id);
					lmProvider.notifyChanged();
					void vscode.window.showInformationMessage(`Agents model: ${picked.label}`);
				}
			}),

			vscode.commands.registerCommand('prebase.magnus.selectExecutionMode', async () => {
				const current = aiService.getExecutionMode();
				const modes: Array<{ label: string; id: PreBaseAIExecutionMode; detail: string }> = [
					{
						label: 'Automatic (Recommended)',
						id: 'auto',
						detail: 'Uses PreBase root .env in source development, BYOK if configured, or PreBase Hosted when signed in.',
					},
					{
						label: 'Development Environment (.env)',
						id: 'development-env',
						detail: 'Reads credentials directly from the authentic PreBase repository root .env.',
					},
					{
						label: 'Bring Your Own Key (BYOK)',
						id: 'byok',
						detail: 'Uses API key stored in secure OS SecretStorage.',
					},
					{
						label: 'PreBase Hosted',
						id: 'hosted',
						detail: 'Routes model requests through PreBase authenticated cloud gateway.',
					},
				];

				const picked = await vscode.window.showQuickPick(
					modes.map(m => ({
						label: m.label,
						description: m.id === current ? '(Current)' : undefined,
						detail: m.detail,
						id: m.id,
					})),
					{ title: 'Select PreBase AI Execution Source' },
				);

				if (picked) {
					await aiService.setExecutionMode(picked.id);
					lmProvider.notifyChanged();
					void vscode.window.showInformationMessage(`Execution mode set to: ${picked.label}`);
				}
			}),

			vscode.commands.registerCommand('prebase.magnus.refreshModels', async () => {
				secrets.refreshRootEnv();
				aiService.invalidateModelCache();
				lmProvider.notifyChanged();
				const models = await aiService.listModels(undefined, true);
				const count = models.filter(m => m.capabilities.agentCompatible).length;
				void vscode.window.showInformationMessage(`Refreshed models: ${count} compatible models available.`);
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
			}),

			vscode.commands.registerCommand('prebase.magnus.attachGraphSelection', async (selection?: unknown) => {
				let summary: string | undefined;
				if (typeof selection === 'string') {
					summary = selection.trim();
				} else if (selection && typeof selection === 'object') {
					try {
						summary = JSON.stringify(selection);
					} catch {
						summary = undefined;
					}
				}
				if (summary) {
					state.graphSelection = summary.slice(0, 10_000);
					void vscode.window.showInformationMessage('Graph selection attached to Agents context.');
				}
				return { ok: true, attached: !!summary };
			}),

			vscode.commands.registerCommand('prebase.magnus.attachRuntimeContext', async (runtimeContext?: unknown) => {
				let summary: string | undefined;
				if (typeof runtimeContext === 'string') {
					summary = runtimeContext.trim();
				} else if (runtimeContext && typeof runtimeContext === 'object') {
					try {
						summary = JSON.stringify(runtimeContext);
					} catch {
						summary = undefined;
					}
				}
				if (summary) {
					state.runtimeContext = summary.slice(0, 10_000);
					void vscode.window.showInformationMessage('Runtime context attached to Agents context.');
				}
				return { ok: true, attached: !!summary };
			}),
		);

		runtimeState.coreCommandsRegistered = true;
		console.log('[Magnus] core commands registered');

		runtimeState.activationCompleted = true;
		console.log('[Magnus] activation completed');
	} catch (err) {
		const safeErr: SafeMagnusError = {
			phase: 'activation',
			message: err instanceof Error ? err.message : String(err),
		};
		runtimeState.activationError = safeErr;
		console.error('[Magnus] activation failed:', safeErr.message);
		throw err;
	}
}

export function deactivate(): void {
	// Dispose any resources
}

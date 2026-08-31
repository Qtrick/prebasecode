/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { magnusRequestShutdown, registerMagnusChatParticipants, type MagnusChatDefaults } from './chatParticipant';
import { setProjectGuidanceService } from './projectGuidanceRegistry';
import { MagnusLanguageModelProvider } from './languageModelProvider';
import { buildModelOptions } from './models';
import { DEFAULT_MAGNUS_AGENT_MODE, MAGNUS_AGENT_MODES, isMagnusAgentMode } from './modes';
import { registerMagnusDesktopTools } from './desktopTools';
import { registerMagnusLanguageModelTools } from './nativeTools';
import { MagnusSecretStorage } from './secretStorage';
import { PreBaseAIService, VsCodeWorkspaceConfigProvider } from './aiService';
import { globalAIProviderRegistry } from './aiProviderRegistry';
import { MagnusSmokeTransportAdapter, magnusSmokeStreamDiagnostics } from './smokeTransport';
import { magnusLiveStreamDiagnostics } from './chatParticipant';
import { findPreBaseSourceRoot, PreBaseSecretResolver } from './secretResolver';
import { ProjectGuidanceService, resolveGuidancePath, resolveWorkspaceRootForPath, GUIDANCE_WATCH_PATTERNS, type GuidanceFileReader } from './projectGuidanceService';
import { createProjectGuidanceSession, runWithProjectGuidanceSession } from './projectGuidanceSession';
import { computeGuidanceDelta, formatGuidanceDeltaForPrompt, seedSessionFromSnapshot } from './projectGuidanceDelta';
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
	/** True when ALL core subsystems completed registration with no activation error. */
	get coreReady(): boolean;
	/** True when optional subsystems degraded (desktop tools failed or optional errors present). */
	get degraded(): boolean;
}

class MagnusRuntimeStateImpl implements MagnusRuntimeState {
	activationStarted = false;
	activationCompleted = false;
	aiServiceInitialized = false;
	coreCommandsRegistered = false;
	describeFileRegistered = false;
	languageModelProviderRegistered = false;
	chatParticipantsRegistered = false;
	nativeToolsRegistered = false;
	desktopToolsRegistered = false;
	activationError?: SafeMagnusError;
	optionalSubsystemErrors: SafeMagnusError[] = [];

	get coreReady(): boolean {
		return (
			this.activationCompleted &&
			this.aiServiceInitialized &&
			this.describeFileRegistered &&
			this.coreCommandsRegistered &&
			this.languageModelProviderRegistered &&
			this.chatParticipantsRegistered &&
			this.nativeToolsRegistered &&
			!this.activationError
		);
	}

	get degraded(): boolean {
		return !this.desktopToolsRegistered || this.optionalSubsystemErrors.length > 0;
	}
}

export const runtimeState: MagnusRuntimeState = new MagnusRuntimeStateImpl();

export function activate(context: vscode.ExtensionContext): void {
	runtimeState.activationStarted = true;
	runtimeState.activationError = undefined;
	runtimeState.optionalSubsystemErrors = [];
	console.log('[Magnus] activation started');

	try {
		// 1. Initialize secret resolver with deterministic root from extension path
		const explicitRoot = findPreBaseSourceRoot(context.extensionPath);
		const resolver = new PreBaseSecretResolver({ explicitRoot, allowAmbientRootDiscovery: false });
		const secrets = new MagnusSecretStorage(context.secrets, resolver);
		console.log('[Magnus] secret resolver initialized');

		const guidanceReader: GuidanceFileReader = {
			exists: async (path) => {
				try {
					await vscode.workspace.fs.stat(vscode.Uri.file(path));
					return true;
				} catch {
					return false;
				}
			},
			readFile: async (path) => Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(path))).toString('utf8'),
			readDirectory: async (path) => (await vscode.workspace.fs.readDirectory(vscode.Uri.file(path))).map(([name]) => name),
			isTrusted: () => vscode.workspace.isTrusted,
		};
		const projectGuidance = new ProjectGuidanceService(guidanceReader);
		setProjectGuidanceService(projectGuidance);
		const invalidateGuidance = (uri?: vscode.Uri) => {
			if (uri) {
				const root = resolveWorkspaceRootForPath(uri.fsPath, vscode.workspace.workspaceFolders);
				if (root) {
					projectGuidance.invalidate(root);
					return;
				}
			}
			projectGuidance.invalidate();
		};
		for (const pattern of GUIDANCE_WATCH_PATTERNS) {
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			context.subscriptions.push(
				watcher,
				watcher.onDidChange(uri => invalidateGuidance(uri)),
				watcher.onDidCreate(uri => invalidateGuidance(uri)),
				watcher.onDidDelete(uri => invalidateGuidance(uri)),
			);
		}
		context.subscriptions.push(
			vscode.commands.registerCommand('prebase.magnus.viewProjectGuidance', async () => {
				const folders = vscode.workspace.workspaceFolders ?? [];
				if (!folders.length) {
					void vscode.window.showInformationMessage('Open a workspace to inspect project guidance.');
					return;
				}
				if (!vscode.workspace.isTrusted) {
					void vscode.window.showWarningMessage('Project guidance is disabled until this workspace is trusted.');
					return;
				}
				const activeEditor = vscode.window.activeTextEditor;
				let workspaceRoot = activeEditor
					? resolveWorkspaceRootForPath(activeEditor.document.uri.fsPath, folders)
					: undefined;
				if (!workspaceRoot && folders.length > 1) {
					const picked = await vscode.window.showQuickPick(
						folders.map(folder => ({
							label: folder.name,
							description: folder.uri.fsPath,
							root: folder.uri.fsPath,
						})),
						{ title: 'Project Guidance', placeHolder: 'Choose a workspace folder' },
					);
					workspaceRoot = picked?.root;
				}
				workspaceRoot ??= folders[0].uri.fsPath;
				const activePath = activeEditor && resolveWorkspaceRootForPath(activeEditor.document.uri.fsPath, folders) === workspaceRoot
					? vscode.workspace.asRelativePath(activeEditor.document.uri, false)
					: undefined;
				const guidanceEnabled = vscode.workspace.getConfiguration('prebase.magnus').get<boolean>('projectGuidance.enabled', true);
				if (!guidanceEnabled) {
					void vscode.window.showInformationMessage('Project guidance is disabled in Settings (prebase.magnus.projectGuidance.enabled).');
					return;
				}
				const snapshot = await projectGuidance.getSnapshot(workspaceRoot, activePath ? [activePath] : []);
				const manuals = snapshot.onDemandRules.filter(item => item.source.activationMode === 'manual').length;
				const summaryLabel = `Applied: ${snapshot.alwaysApplicable.length} instructions, ${snapshot.pathApplicable.length} path rules · Available: ${snapshot.skillCatalog.length} skills, ${manuals + (snapshot.playbookCatalog?.length ?? 0)} manuals/playbooks · Diagnostics: ${snapshot.diagnostics.length}`;
				type GuidancePick = { label: string; description?: string; detail?: string; relPath: string; kind?: vscode.QuickPickItemKind; openable?: boolean };
				const provenance = (ecosystem: string, note: string) => `${ecosystem} · ${note}`;
				const items: GuidancePick[] = [
					{ label: summaryLabel, description: 'Summary', relPath: '', openable: false },
				];
				const pushSection = (label: string, entries: GuidancePick[]) => {
					if (!entries.length) {
						return;
					}
					items.push({ label, kind: vscode.QuickPickItemKind.Separator, relPath: '' }, ...entries);
				};
				pushSection('Currently Applied', snapshot.alwaysApplicable.map(item => ({
					label: item.source.path,
					description: provenance(item.source.ecosystem, 'Always'),
					detail: item.source.description,
					relPath: item.source.path,
					openable: true,
				})));
				pushSection('Path-Specific', snapshot.pathApplicable.map(item => ({
					label: item.source.path,
					description: provenance(item.source.ecosystem, `Matches glob ${item.source.globs.join(', ') || item.source.scope}`),
					relPath: item.source.path,
					openable: true,
				})));
				pushSection('On Demand', snapshot.onDemandRules.map(item => ({
					label: item.source.path,
					description: provenance(
						item.source.ecosystem,
						item.source.activationMode === 'intelligent' ? 'Intelligent available' : 'Manual (activate_rule)',
					),
					detail: item.description,
					relPath: item.source.path,
					openable: true,
				})));
				pushSection('Skills', snapshot.skillCatalog.map(item => ({
					label: item.name,
					description: provenance(
						item.ecosystem,
						item.modelInvocable === false
							? 'Manual (hidden from model auto catalog)'
							: 'Activate via prebase_project_guidance',
					),
					detail: item.description,
					relPath: item.path,
					openable: true,
				})));
				pushSection('Playbooks', (snapshot.playbookCatalog ?? []).map(item => ({
					label: item.name,
					description: provenance(item.ecosystem, 'On demand (activate_playbook)'),
					detail: item.description,
					relPath: item.path,
					openable: true,
				})));
				pushSection('Agent Profiles', (snapshot.agentProfileCatalog ?? []).map(item => ({
					label: item.name,
					description: provenance(item.ecosystem, item.modelInvocable === false ? 'Catalog only (manual profile)' : 'Catalog only (activate_agent_profile)'),
					detail: item.description,
					relPath: item.path,
					openable: true,
				})));
				pushSection('Detected Executable Hooks', (snapshot.detectedHooks ?? []).map(hookPath => ({
					label: hookPath,
					description: 'Detected project hook (not auto-executed)',
					detail: 'PreBase security boundary: foreign executable automation is discovered but not automatically executed.',
					relPath: hookPath.replace(/ \(hooks declaration\)$/, ''),
					openable: true,
				})));
				pushSection('Diagnostics', snapshot.diagnostics.slice(0, 8).map(message => ({
					label: message,
					description: 'Diagnostic',
					relPath: '',
					openable: false,
				})));
				const pick = await vscode.window.showQuickPick(items.filter(item => item.label), {
					title: 'Project Guidance',
					placeHolder: summaryLabel,
					matchOnDescription: true,
					matchOnDetail: true,
				});
				if (pick?.relPath && pick.openable !== false) {
					const fullPath = resolveGuidancePath(workspaceRoot, pick.relPath);
					if (!fullPath) {
						void vscode.window.showErrorMessage('That guidance path is not allowed.');
						return;
					}
					const doc = await vscode.workspace.openTextDocument(fullPath);
					await vscode.window.showTextDocument(doc, { preview: true });
				}
			}),
			vscode.commands.registerCommand('prebase.magnus.getGuidanceSnapshotForSmoke', async (request?: { targetPaths?: string[] }) => {
				const allowed = await vscode.commands.executeCommand('prebase.test.isSmokeDriver');
				if (!allowed) {
					throw new Error('prebase.magnus.getGuidanceSnapshotForSmoke requires --enable-smoke-test-driver');
				}
				const folders = vscode.workspace.workspaceFolders ?? [];
				const workspaceRoot = folders[0]?.uri.fsPath;
				if (!workspaceRoot) {
					return { ok: false, reason: 'no workspace' };
				}
				const targetPaths = request?.targetPaths ?? [];
				const snapshot = await projectGuidance.getSnapshot(workspaceRoot, targetPaths);
				return {
					ok: true,
					enabled: snapshot.enabled,
					workspaceRoot,
					always: snapshot.alwaysApplicable.map(item => ({ path: item.source.path, ecosystem: item.source.ecosystem, body: item.text.slice(0, 400) })),
					pathScoped: snapshot.pathApplicable.map(item => ({ path: item.source.path, ecosystem: item.source.ecosystem, body: item.text.slice(0, 400) })),
					onDemand: snapshot.onDemandRules.map(item => ({ path: item.source.path, mode: item.source.activationMode })),
					skills: snapshot.skillCatalog.map(item => ({ id: item.id, name: item.name, path: item.path, ecosystem: item.ecosystem, modelInvocable: item.modelInvocable !== false })),
					playbooks: (snapshot.playbookCatalog ?? []).map(item => ({ name: item.name, path: item.path, ecosystem: item.ecosystem })),
					agentProfiles: (snapshot.agentProfileCatalog ?? []).map(item => ({ name: item.name, path: item.path, ecosystem: item.ecosystem })),
					diagnostics: snapshot.diagnostics.slice(0, 24),
				};
			}),
			vscode.commands.registerCommand('prebase.magnus.runGuidanceJitSmoke', async () => {
				const allowed = await vscode.commands.executeCommand('prebase.test.isSmokeDriver');
				if (!allowed) {
					throw new Error('prebase.magnus.runGuidanceJitSmoke requires --enable-smoke-test-driver');
				}
				const folders = vscode.workspace.workspaceFolders ?? [];
				const root = folders[0]?.uri.fsPath;
				if (!root) {
					return { ok: false, reason: 'no workspace' };
				}
				const session = createProjectGuidanceSession([{ workspaceRoot: root, relativePath: 'src/main.ts' }]);
				return runWithProjectGuidanceSession(session, async () => {
					const initial = await projectGuidance.getSnapshot(
						root,
						session.getTargetPathsForRoot(root),
						session.getActivatedSkillIds(),
						true,
						session.getActivatedRulePaths(),
					);
					seedSessionFromSnapshot(initial, session);
					session.addTarget(root, 'graphs/src/foo.ts');
					const after = await projectGuidance.getCombinedSnapshot(
						session.getTargets(),
						session.getActivatedSkillIds(),
						true,
						session.getActivatedRulePaths(),
					);
					const delta = computeGuidanceDelta(initial, after, session);
					const deltaBlock = formatGuidanceDeltaForPrompt(delta);
					return {
						ok: true,
						initialPathScoped: initial.pathApplicable.length,
						afterPathScoped: after.pathApplicable.length,
						deltaApplied: delta.newlyApplied.length,
						deltaChars: deltaBlock.length,
						deltaHasGraphRule: /Graph path rule/.test(deltaBlock),
						packageRuleAbsent: !/packages\/AGENTS\.override/.test(deltaBlock),
					};
				});
			}),
		);

		// 2. Initialize AI service
		const configProvider = new VsCodeWorkspaceConfigProvider(() => vscode.workspace.getConfiguration('prebase.magnus'));
		const aiService = new PreBaseAIService(secrets, globalAIProviderRegistry, configProvider);
		runtimeState.aiServiceInitialized = true;
		console.log('[Magnus] AI service initialized');

		const config = vscode.workspace.getConfiguration('prebase.magnus');
		const state: MagnusChatDefaults = {
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
		context.subscriptions.push(
			vscode.commands.registerCommand('prebase.magnus.getDescriptionContext', async (filePath?: string): Promise<import('./aiTypes').MagnusDescriptionContext> => {
				return await aiService.getDescriptionContext(filePath);
			}),
		);
		runtimeState.describeFileRegistered = true;
		console.log('[Magnus] describeFile registered');

		context.subscriptions.push(
			vscode.commands.registerCommand('prebase.magnus.installSmokeTransport', async () => {
				const allowed = await vscode.commands.executeCommand('prebase.test.isSmokeDriver');
				if (!allowed) {
					throw new Error('prebase.magnus.installSmokeTransport requires --enable-smoke-test-driver');
				}
				aiService.installSmokeTransport(new MagnusSmokeTransportAdapter());
				return { ok: true };
			}),
			vscode.commands.registerCommand('prebase.magnus.getStreamDiagnostics', async () => {
				const allowed = await vscode.commands.executeCommand('prebase.test.isSmokeDriver');
				if (!allowed) {
					throw new Error('prebase.magnus.getStreamDiagnostics requires --enable-smoke-test-driver');
				}
				return {
					streamActive: magnusLiveStreamDiagnostics.streamActive,
					pacingActive: magnusLiveStreamDiagnostics.pacingActive,
					sourceChunks: magnusSmokeStreamDiagnostics.sourceChunks,
					sourceCancelled: magnusSmokeStreamDiagnostics.cancelled,
					smokeEnabled: aiService.isSmokeTransportEnabled(),
				};
			}),
		);

		// 4. Register language model provider (core subsystem)
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
			runtimeState.activationError = safeErr;
			console.error('[Magnus] core language model provider registration failed:', safeErr.message);
			throw err;
		}

		// 5. Register chat participants (core subsystem)
		try {
			registerMagnusChatParticipants(context, aiService);
			runtimeState.chatParticipantsRegistered = true;
			console.log('[Magnus] chat participants registered');
		} catch (err) {
			const safeErr: SafeMagnusError = {
				phase: 'chatParticipants',
				message: err instanceof Error ? err.message : String(err),
			};
			runtimeState.activationError = safeErr;
			console.error('[Magnus] core chat participants registration failed:', safeErr.message);
			throw err;
		}

		// 6. Register core native language-model tools (core subsystem)
		try {
			registerMagnusLanguageModelTools(context, secrets);
			runtimeState.nativeToolsRegistered = true;
			console.log('[Magnus] native tools registered');
		} catch (err) {
			const safeErr: SafeMagnusError = {
				phase: 'nativeTools',
				message: err instanceof Error ? err.message : String(err),
			};
			runtimeState.activationError = safeErr;
			console.error('[Magnus] core native tools registration failed:', safeErr.message);
			throw err;
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
					/** All core subsystems ready with no activation error. */
					coreReady: runtimeState.coreReady,
					/** Optional subsystems degraded (desktop tools or optional errors). */
					degraded: runtimeState.degraded,
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
				const resolvedDiscovery = await secrets.getResolvedProviderApiKey('linkup');
				const resolvedPageFetch = await secrets.getResolvedProviderApiKey('firecrawl');
				const enabled = vscode.workspace.getConfiguration('prebase.magnus').get('enabled', true);

				const geminiStatus = `Gemini: ${status.safeStatusMessage}`;
				const discoveryStatus = resolvedDiscovery
					? `Discovery: Connected (${resolvedDiscovery.source === 'local-env' ? 'PreBase root .env' : 'Secure Storage'})`
					: 'Discovery: Not configured (Local)';
				const pageFetchStatus = resolvedPageFetch
					? `Page fetch: Connected (${resolvedPageFetch.source === 'local-env' ? 'PreBase root .env' : 'Secure Storage'})`
					: 'Page fetch: Not configured (Local)';

				const lines = [
					`Enabled: ${enabled}`,
					`Execution Mode: ${status.executionMode}`,
					geminiStatus,
					discoveryStatus,
					pageFetchStatus,
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
					`Discovery: Local .env=${diag.linkup.localEnv}, SecretStorage=${diag.linkup.secretStorage}, Hosted=${diag.linkup.hosted} (Active: ${diag.linkup.activeSource ?? 'none'})`,
					`Page fetch: Local .env=${diag.firecrawl.localEnv}, SecretStorage=${diag.firecrawl.secretStorage}, Hosted=${diag.firecrawl.hosted} (Active: ${diag.firecrawl.activeSource ?? 'none'})`,
				].join('\n');
				void vscode.window.showInformationMessage(msg, { modal: true });
				return diag;
			}),

			vscode.commands.registerCommand('prebase.magnus.diagnoseModelCatalog', async () => {
				const diag = await aiService.diagnoseModelCatalog();
				const text = JSON.stringify(diag, null, 2);
				const doc = await vscode.workspace.openTextDocument({
					content: text,
					language: 'json',
				});
				await vscode.window.showTextDocument(doc, { preview: true });
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

			vscode.commands.registerCommand('prebase.magnus.listModels', async () => {
				// Returns the current model list for Settings UI or diagnostics — no secrets.
				const models = await aiService.listModels(undefined, false);
				const options = buildModelOptions(models);
				return options.map(m => ({ id: m.id, name: m.name, description: m.description, isAuto: !!m.isAuto }));
			}),

			vscode.commands.registerCommand('prebase.magnus.setLinkupKey', async () => {
				const value = await vscode.window.showInputBox({
					title: 'Configure local web discovery key',
					prompt: 'Enter the discovery API key to store in OS SecretStorage. Local hybrid search also requires a page-fetch key.',
					password: true,
					ignoreFocusOut: true,
				});
				if (!value) {
					return;
				}
				await secrets.setProviderApiKey('linkup', value);
				secrets.refreshRootEnv();
				void vscode.window.showInformationMessage('Local web discovery key stored securely.');
			}),

			vscode.commands.registerCommand('prebase.magnus.clearLinkupKey', async () => {
				await secrets.clearProviderApiKey('linkup');
				secrets.refreshRootEnv();
				void vscode.window.showInformationMessage('Cleared the local web discovery key from secure storage.');
			}),

			vscode.commands.registerCommand('prebase.magnus.testLinkupConnection', async () => {
				const resolved = await secrets.getResolvedProviderApiKey('linkup');
				if (!resolved?.key) {
					void vscode.window.showWarningMessage('No local discovery key is configured. Signed-in users can use the hosted gateway instead.');
					return { ok: false, error: 'notConfigured' };
				}
				try {
					const res = await fetch('https://api.linkup.so/v1/search', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resolved.key}` },
						body: JSON.stringify({ q: 'ping', depth: 'fast', outputType: 'searchResults' }),
						signal: AbortSignal.timeout(10_000),
					});
					if (res.ok || res.status === 422) {
						void vscode.window.showInformationMessage(`Discovery connection test succeeded (HTTP ${res.status}).`);
						return { ok: true, status: res.status };
					}
					const msg = `Discovery connection test failed (HTTP ${res.status}).`;
					void vscode.window.showErrorMessage(msg);
					return { ok: false, error: String(res.status), message: msg };
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					void vscode.window.showErrorMessage(`Discovery connection test failed: ${msg}`);
					return { ok: false, error: 'network', message: msg };
				}
			}),

			vscode.commands.registerCommand('prebase.magnus.setFirecrawlKey', async () => {
				const value = await vscode.window.showInputBox({
					title: 'Configure local page-fetch key',
					prompt: 'Enter the page-fetch API key to store in OS SecretStorage. Local hybrid search also requires a discovery key.',
					password: true,
					ignoreFocusOut: true,
				});
				if (!value) {
					return;
				}
				await secrets.setProviderApiKey('firecrawl', value);
				secrets.refreshRootEnv();
				void vscode.window.showInformationMessage('Local page-fetch key stored securely.');
			}),

			vscode.commands.registerCommand('prebase.magnus.clearFirecrawlKey', async () => {
				await secrets.clearProviderApiKey('firecrawl');
				secrets.refreshRootEnv();
				void vscode.window.showInformationMessage('Cleared the local page-fetch key from secure storage.');
			}),

			vscode.commands.registerCommand('prebase.magnus.testFirecrawlConnection', async () => {
				const resolved = await secrets.getResolvedProviderApiKey('firecrawl');
				if (!resolved?.key) {
					void vscode.window.showWarningMessage('No local page-fetch key is configured. Signed-in users can use the hosted gateway instead.');
					return { ok: false, error: 'notConfigured' };
				}
				try {
					const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resolved.key}`, 'Cache-Control': 'no-cache' },
						cache: 'no-store',
						body: JSON.stringify({
							url: 'https://example.com',
							formats: ['markdown'],
							onlyMainContent: true,
							maxAge: 172_800_000,
						}),
						signal: AbortSignal.timeout(12_000),
					});
					if (res.ok || res.status === 402 || res.status === 429) {
						void vscode.window.showInformationMessage(`Page-fetch connection test succeeded (HTTP ${res.status}).`);
						return { ok: true, status: res.status };
					}
					const msg = `Page-fetch connection test failed (HTTP ${res.status}).`;
					void vscode.window.showErrorMessage(msg);
					return { ok: false, error: String(res.status), message: msg };
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					void vscode.window.showErrorMessage(`Page-fetch connection test failed: ${msg}`);
					return { ok: false, error: 'network', message: msg };
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

			vscode.commands.registerCommand('prebase.magnus.cancel', async () => {
				try {
					await vscode.commands.executeCommand('workbench.action.chat.cancel');
				} catch {
					// safe fallback
				}
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

export async function deactivate(): Promise<void> {
	setProjectGuidanceService(undefined);
	magnusRequestShutdown.cancel();
}

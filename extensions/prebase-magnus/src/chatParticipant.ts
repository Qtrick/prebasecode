/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { generateContent, type GeminiContent } from './geminiClient';
import { resolveApiModel } from './models';
import {
	allowsEdits,
	getAgentModePromptBlock,
	isMagnusAgentMode,
	modeFromChatParticipantId,
	type MagnusAgentMode,
} from './modes';
import type { MagnusSecretStorage } from './secretStorage';
import { MagnusWorkspaceTools } from './tools';

export interface MagnusChatState {
	mode: MagnusAgentMode;
	modelId: string;
	attachedFiles: string[];
	graphSelection?: string;
	runtimeContext?: string;
	cancellation?: vscode.CancellationTokenSource;
}

function buildSystemPrompt(mode: MagnusAgentMode, extras: string[]): string {
	const parts = [
		'You are Magnus, the PreBase AI coding assistant inside VS Code.',
		getAgentModePromptBlock(mode),
		'When you need workspace data, emit fenced tool blocks:',
		'```tool read relative/path.ts',
		'```',
		'```tool search some query',
		'```',
		'```tool edit relative/path.ts',
		'// full new file contents',
		'```',
		'Do not invent tool results. Wait for tool output in the next turn.',
	];
	if (!allowsEdits(mode)) {
		parts.push('Edits are forbidden in this mode. Do not emit tool edit blocks.');
	}
	if (extras.length) {
		parts.push('Attached context:', ...extras);
	}
	return parts.join('\n');
}

export function registerMagnusChatParticipants(
	context: vscode.ExtensionContext,
	secrets: MagnusSecretStorage,
	state: MagnusChatState,
): void {
	const ids = [
		'prebase.magnus.ask',
		'prebase.magnus.edit',
		'prebase.magnus.agent',
	];

	for (const id of ids) {
		const participant = vscode.chat.createChatParticipant(id, async (request, _ctx, response, token) => {
			return handleChatRequest(id, request, response, token, secrets, state);
		});
		participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'magnus.svg');
		context.subscriptions.push(participant);
	}
}

async function handleChatRequest(
	participantId: string,
	request: vscode.ChatRequest,
	response: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	secrets: MagnusSecretStorage,
	state: MagnusChatState,
): Promise<vscode.ChatResult | void> {
	const enabled = vscode.workspace.getConfiguration('prebase.magnus').get<boolean>('enabled', true);
	if (!enabled) {
		response.markdown('Magnus is disabled. Enable `prebase.magnus.enabled` in Settings.');
		return {};
	}

	const gemini = await secrets.getGeminiKeyOrMessage();
	if (!gemini.key) {
		response.markdown(gemini.message || 'No API key configured.');
		return {};
	}
	const apiKey = gemini.key;

	let mode = modeFromChatParticipantId(participantId);
	const configured = vscode.workspace.getConfiguration('prebase.magnus').get<string>('defaultMode', state.mode);
	if (participantId.endsWith('.ask') && isMagnusAgentMode(configured) && (configured === 'plan' || configured === 'runtime')) {
		// Plan/Test map via configuration when using the ask participant.
		mode = configured;
	} else if (isMagnusAgentMode(state.mode) && participantId.endsWith('.ask')) {
		mode = state.mode === 'patch' || state.mode === 'agent' ? mode : state.mode;
	}

	const modelId = state.modelId
		|| vscode.workspace.getConfiguration('prebase.magnus').get<string>('defaultModel', 'auto')
		|| 'auto';
	const apiModel = resolveApiModel(modelId);

	const maxIterations = vscode.workspace.getConfiguration('prebase.magnus').get<number>('maxToolIterations', 12) ?? 12;
	const requireEditApproval = vscode.workspace.getConfiguration('prebase.magnus').get<boolean>('requireEditApproval', true) ?? true;
	const tools = new MagnusWorkspaceTools(maxIterations, requireEditApproval);

	const extras: string[] = [];
	for (const file of state.attachedFiles) {
		extras.push(`Attached file: ${file}`);
	}
	if (state.graphSelection && vscode.workspace.getConfiguration('prebase.magnus').get('includeGraphContext', true)) {
		extras.push(`Graph selection:\n${state.graphSelection}`);
	}
	if (state.runtimeContext && vscode.workspace.getConfiguration('prebase.magnus').get('includeRuntimeContext', true)) {
		extras.push(`Runtime context:\n${state.runtimeContext}`);
	}

	const contents: GeminiContent[] = [
		{ role: 'user', parts: [{ text: request.prompt }] },
	];

	// Link cancel command + chat UI cancellation to this request.
	state.cancellation?.dispose();
	state.cancellation = new vscode.CancellationTokenSource();
	const requestCts = state.cancellation;
	const cancelSub = token.onCancellationRequested(() => requestCts.cancel());
	const effectiveToken = requestCts.token;

	try {
		let iterations = 0;
		while (iterations < tools.maxToolIterations) {
			if (effectiveToken.isCancellationRequested) {
				response.markdown('\n\n_Cancelled._');
				return {};
			}
			iterations++;

			response.progress(iterations === 1 ? 'Thinking…' : `Tool loop ${iterations}…`);

			let text: string;
			try {
				text = await generateContent(apiKey, apiModel, {
					contents,
					systemInstruction: { parts: [{ text: buildSystemPrompt(mode, extras) }] },
				}, effectiveToken);
			} catch (err) {
				if (effectiveToken.isCancellationRequested) {
					response.markdown('\n\n_Cancelled._');
					return {};
				}
				response.markdown(`Magnus request failed: ${err instanceof Error ? err.message : String(err)}`);
				return {};
			}

			let calls = tools.parseToolCalls(text);
			if (!allowsEdits(mode)) {
				const refused = calls.filter(c => c.kind === 'edit');
				if (refused.length) {
					response.markdown(`\n\n_Refused ${refused.length} edit(s) — ${mode} mode is read-only._`);
				}
				calls = calls.filter(c => c.kind !== 'edit');
			}
			const visible = text.replace(/```tool[\s\S]*?```/gi, '').trim();
			if (visible) {
				response.markdown(visible);
			}

			if (calls.length === 0) {
				return {};
			}

			const toolOutputs: string[] = [];
			for (const call of calls) {
				if (effectiveToken.isCancellationRequested) {
					break;
				}
				response.progress(`Running ${call.kind}…`);
				let result;
				if (call.kind === 'read') {
					result = await tools.readFile(call.arg, effectiveToken);
				} else if (call.kind === 'search') {
					result = await tools.searchWorkspace(call.arg, effectiveToken);
				} else {
					result = await tools.applyEdit(call.arg, call.body ?? '', effectiveToken);
				}
				toolOutputs.push(`[${call.kind} ${call.arg}]\nok=${result.ok}\n${result.output}`);
			}

			if (effectiveToken.isCancellationRequested) {
				response.markdown('\n\n_Cancelled._');
				return {};
			}

			contents.push({ role: 'model', parts: [{ text }] });
			contents.push({
				role: 'user',
				parts: [{ text: `Tool results:\n${toolOutputs.join('\n\n')}\n\nContinue. If done, answer without more tool blocks.` }],
			});
		}

		response.markdown('\n\n_Stopped: max tool iterations reached._');
		return {};
	} finally {
		cancelSub.dispose();
		if (state.cancellation === requestCts) {
			state.cancellation.dispose();
			state.cancellation = undefined;
		} else {
			requestCts.dispose();
		}
	}
}

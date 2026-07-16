/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { streamGenerateContent, type GeminiContent } from './geminiClient';
import { getModelOption, resolveApiModel } from './models';
import {
	allowsEdits,
	getAgentModePromptBlock,
	isMagnusAgentMode,
	modeFromChatParticipantId,
	type MagnusAgentMode,
} from './modes';
import type { MagnusSecretStorage } from './secretStorage';
import { paceTextStream } from './streamPace';

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
		'You are Agents, the PreBase AI coding assistant inside VS Code.',
		getAgentModePromptBlock(mode),
		'Use only the structured VS Code tools that are explicitly available in this chat. Never encode tool calls in Markdown or code fences, and never invent tool results.',
	];
	if (!allowsEdits(mode)) {
		parts.push('Edits are forbidden in this mode.');
	}
	if (extras.length) {
		parts.push('Attached context:', ...extras);
	}
	return parts.join('\n');
}

/** The model may return normal Markdown, including code fences, unchanged. */
export function visibleAssistantText(raw: string): string {
	return raw;
}

function emitThought(response: vscode.ChatResponseStream, text: string, id = 'magnus-thought'): void {
	try {
		response.thinkingProgress({ id, text });
	} catch {
		response.progress(text);
	}
}

function finishThought(response: vscode.ChatResponseStream, id = 'magnus-thought'): void {
	try {
		response.thinkingProgress({
			id,
			text: '',
			metadata: { vscodeReasoningDone: true, stopReason: 'text' },
		});
	} catch {
		// Older hosts without thinkingProgress — ignore.
	}
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
		participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'magnus.png');
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
		response.markdown('Agents is disabled. Enable `prebase.magnus.enabled` in Settings.');
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
		mode = configured;
	} else if (isMagnusAgentMode(state.mode) && participantId.endsWith('.ask')) {
		mode = state.mode === 'patch' || state.mode === 'agent' ? mode : state.mode;
	}

	const modelId = state.modelId
		|| vscode.workspace.getConfiguration('prebase.magnus').get<string>('defaultModel', 'auto')
		|| 'auto';
	const apiModel = resolveApiModel(modelId);
	const modelLabel = getModelOption(modelId).name;

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

	state.cancellation?.dispose();
	state.cancellation = new vscode.CancellationTokenSource();
	const requestCts = state.cancellation;
	const cancelSub = token.onCancellationRequested(() => requestCts.cancel());
	const effectiveToken = requestCts.token;

	try {
		emitThought(response, `Planning with ${modelLabel}…`);
		let rawText = '';
		let visibleEmitted = 0;
		try {
			const paced = paceTextStream(
				streamGenerateContent(apiKey, apiModel, { contents, systemInstruction: { parts: [{ text: buildSystemPrompt(mode, extras) }] } }, effectiveToken),
				{ charsPerTick: 3, intervalMs: 22, token: effectiveToken },
			);
			for await (const chunk of paced) {
				if (effectiveToken.isCancellationRequested) {
					response.markdown('\n\n_Cancelled._');
					return {};
				}
				if (!chunk) {
					continue;
				}
				rawText += chunk;
				const visible = visibleAssistantText(rawText);
				if (visible.length > visibleEmitted) {
					if (visibleEmitted === 0) {
						finishThought(response);
					}
					response.markdown(visible.slice(visibleEmitted));
					visibleEmitted = visible.length;
				}
			}
		} catch (err) {
			if (effectiveToken.isCancellationRequested) {
				response.markdown('\n\n_Cancelled._');
				return {};
			}
			finishThought(response);
			response.markdown(`Agents request failed: ${err instanceof Error ? err.message : String(err)}`);
			return {};
		}

		finishThought(response);
		const finalVisible = visibleAssistantText(rawText);
		if (finalVisible.length > visibleEmitted) {
			response.markdown(finalVisible.slice(visibleEmitted));
		}
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

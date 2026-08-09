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
import { runHeaderLabel, type MagnusTaskRun } from './taskRunModel';

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
		'Structure your final answer for a task-run UI: lead with the direct result, then optional Changed / Verified / Remaining subsections when you edited or tested code. Do not narrate hidden chain-of-thought.',
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
		// No avatar image — workbench shows the "Agent" text label without an icon.
		participant.iconPath = undefined;
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

	const run: MagnusTaskRun = {
		runId: `run-${Date.now()}`,
		userTask: request.prompt,
		status: 'planning',
		submittedAt: Date.now(),
		workGroups: [],
	};

	try {
		emitThought(response, `Planning with ${modelLabel}…`, 'magnus-planning');
		let rawText = '';
		let visibleEmitted = 0;
		let enteredRunning = false;
		try {
			const paced = paceTextStream(
				streamGenerateContent(apiKey, apiModel, { contents, systemInstruction: { parts: [{ text: buildSystemPrompt(mode, extras) }] } }, effectiveToken),
				{ charsPerTick: 3, intervalMs: 22, token: effectiveToken },
			);
			for await (const chunk of paced) {
				if (effectiveToken.isCancellationRequested) {
					run.status = 'cancelled';
					run.completedAt = Date.now();
					finishThought(response, 'magnus-planning');
					emitThought(response, runHeaderLabel(run), 'magnus-run-header');
					finishThought(response, 'magnus-run-header');
					response.markdown(`\n\n_${runHeaderLabel(run)}._`);
					return {};
				}
				if (!chunk) {
					continue;
				}
				rawText += chunk;
				const visible = visibleAssistantText(rawText);
				if (visible.length > visibleEmitted) {
					if (!enteredRunning) {
						enteredRunning = true;
						run.status = 'running';
						run.startedAt = Date.now();
						finishThought(response, 'magnus-planning');
						emitThought(response, runHeaderLabel(run), 'magnus-run-header');
						// Final response starts after the work header — mark identity without a logo image.
						response.markdown('### Result\n\n');
					}
					response.markdown(visible.slice(visibleEmitted));
					visibleEmitted = visible.length;
				}
			}
		} catch (err) {
			if (effectiveToken.isCancellationRequested) {
				run.status = 'cancelled';
				run.completedAt = Date.now();
				finishThought(response, 'magnus-planning');
				emitThought(response, runHeaderLabel(run), 'magnus-run-header');
				finishThought(response, 'magnus-run-header');
				response.markdown(`\n\n_${runHeaderLabel(run)}._`);
				return {};
			}
			run.status = 'failed';
			run.completedAt = Date.now();
			run.error = err instanceof Error ? err.message : String(err);
			finishThought(response, 'magnus-planning');
			emitThought(response, runHeaderLabel(run), 'magnus-run-header');
			finishThought(response, 'magnus-run-header');
			response.markdown(`Agents request failed: ${run.error}`);
			return {};
		}

		run.status = 'completed';
		run.completedAt = Date.now();
		run.finalResponse = visibleAssistantText(rawText);
		finishThought(response, 'magnus-planning');
		emitThought(response, runHeaderLabel(run), 'magnus-run-header');
		finishThought(response, 'magnus-run-header');
		const finalVisible = run.finalResponse;
		if (finalVisible.length > visibleEmitted) {
			if (!enteredRunning) {
				response.markdown('### Result\n\n');
			}
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { streamGenerateContent, GeminiRequestError, type GeminiContent } from './geminiClient';
import { isSecretPath, isUnderWorkspace, resolveWorkspaceUri } from './tools';
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
	/**
	 * Every in-flight request. A single shared token source let a new request
	 * dispose the previous one, which detached its cancellation listeners and
	 * left the older request running with no way to stop it.
	 */
	activeRequests: Set<vscode.CancellationTokenSource>;
}

/** Cancels every in-flight Agents request. Used by Cancel and New Session. */
export function cancelActiveMagnusRequests(state: MagnusChatState): void {
	for (const cts of [...state.activeRequests]) {
		cts.cancel();
	}
}

/** Keeps a single attachment from consuming the whole prompt budget. */
const ATTACHED_FILE_CHARACTER_LIMIT = 40_000;

/**
 * Resolves an attached path to its contents. Attaching a file previously only
 * sent the path, so the model never saw the code it was asked about.
 */
async function readAttachedFile(file: string, token: vscode.CancellationToken): Promise<string> {
	const uri = resolveWorkspaceUri(file);
	if (!uri || !isUnderWorkspace(uri)) {
		return `Attached file (unavailable, outside the workspace): ${file}`;
	}
	if (isSecretPath(uri)) {
		return `Attached file (withheld, may contain secrets): ${file}`;
	}
	try {
		const document = await vscode.workspace.openTextDocument(uri);
		if (token.isCancellationRequested) {
			return `Attached file: ${file}`;
		}
		const text = document.getText();
		const truncated = text.length > ATTACHED_FILE_CHARACTER_LIMIT;
		return [
			`Attached file: ${file}${truncated ? ' (truncated)' : ''}`,
			'```',
			text.slice(0, ATTACHED_FILE_CHARACTER_LIMIT),
			'```',
		].join('\n');
	} catch {
		return `Attached file (could not be read): ${file}`;
	}
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
		// ThemeIcon — never a PNG <img> (avoids broken-image placeholder in Agents header).
		participant.iconPath = new vscode.ThemeIcon('sparkle');
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
		extras.push(await readAttachedFile(file, token));
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

	const requestCts = new vscode.CancellationTokenSource();
	state.activeRequests.add(requestCts);
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
			// Show the actionable message; keep the raw API payload out of chat
			// because it can quote request content and internal status strings.
			run.error = err instanceof GeminiRequestError
				? err.message
				: err instanceof Error ? err.message : String(err);
			if (err instanceof GeminiRequestError) {
				console.error(`[Agents] Gemini request failed (HTTP ${err.status}): ${err.detail}`);
			}
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
		state.activeRequests.delete(requestCts);
		requestCts.dispose();
	}
}

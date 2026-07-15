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
		'You are Agents, the PreBase AI coding assistant inside VS Code.',
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

/** Strip completed/incomplete ```tool fences so streaming UX never flashes them. */
export function visibleAssistantText(raw: string): string {
	let out = raw.replace(/```tool[\s\S]*?```/gi, '');
	const incompleteTool = out.search(/```tool\b/i);
	if (incompleteTool >= 0) {
		out = out.slice(0, incompleteTool);
	}
	const lastFence = out.lastIndexOf('```');
	if (lastFence >= 0) {
		const after = out.slice(lastFence + 3);
		if (!after.includes('```')) {
			const head = after.trimStart().slice(0, 4).toLowerCase();
			if (head === '' || head.startsWith('tool')) {
				out = out.slice(0, lastFence);
			}
		}
	}
	return out;
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

function toolStepLabel(kind: 'read' | 'search' | 'edit', arg: string): string {
	switch (kind) {
		case 'read':
			return `Reading \`${arg}\``;
		case 'search':
			return `Grepping \`${arg}\``;
		case 'edit':
			return `Editing \`${arg}\``;
	}
}

function toolDoneLabel(kind: 'read' | 'search' | 'edit', arg: string, ok: boolean): string {
	if (!ok) {
		return `Failed: ${toolStepLabel(kind, arg)}`;
	}
	switch (kind) {
		case 'read':
			return `Read \`${arg}\``;
		case 'search':
			return `Grepped \`${arg}\``;
		case 'edit':
			return `Edited \`${arg}\``;
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

	state.cancellation?.dispose();
	state.cancellation = new vscode.CancellationTokenSource();
	const requestCts = state.cancellation;
	const cancelSub = token.onCancellationRequested(() => requestCts.cancel());
	const effectiveToken = requestCts.token;

	try {
		emitThought(response, `Planning with ${modelLabel}…`);

		let iterations = 0;
		while (iterations < tools.maxToolIterations) {
			if (effectiveToken.isCancellationRequested) {
				response.markdown('\n\n_Cancelled._');
				return {};
			}
			iterations++;

			if (iterations > 1) {
				emitThought(response, `Continuing (step ${iterations})…`);
			}

			let rawText = '';
			let visibleEmitted = 0;
			try {
				// Pace display independently of SSE burst rate (V1.1 / Copilot UX).
				const paced = paceTextStream(
					streamGenerateContent(
						apiKey,
						apiModel,
						{
							contents,
							systemInstruction: { parts: [{ text: buildSystemPrompt(mode, extras) }] },
						},
						effectiveToken,
					),
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
						// First visible token ends the "thinking" shimmer (Copilot-style).
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

			let calls = tools.parseToolCalls(rawText);
			if (!allowsEdits(mode)) {
				const refused = calls.filter(c => c.kind === 'edit');
				if (refused.length) {
					response.markdown(`\n\n_Refused ${refused.length} edit(s) — ${mode} mode is read-only._`);
				}
				calls = calls.filter(c => c.kind !== 'edit');
			}

			// Flush any remaining visible text (usually empty after streaming).
			const finalVisible = visibleAssistantText(rawText);
			if (finalVisible.length > visibleEmitted) {
				response.markdown(finalVisible.slice(visibleEmitted));
			}

			if (calls.length === 0) {
				return {};
			}

			const toolOutputs: string[] = [];
			for (const call of calls) {
				if (effectiveToken.isCancellationRequested) {
					break;
				}
				const label = toolStepLabel(call.kind, call.arg);
				let result = { ok: false, output: 'Cancelled' };
				await new Promise<void>((resolve) => {
					response.progress(label, async () => {
						try {
							if (call.kind === 'read') {
								result = await tools.readFile(call.arg, effectiveToken);
							} else if (call.kind === 'search') {
								result = await tools.searchWorkspace(call.arg, effectiveToken);
							} else {
								result = await tools.applyEdit(call.arg, call.body ?? '', effectiveToken);
							}
							if (!result.ok) {
								return toolDoneLabel(call.kind, call.arg, false);
							}
							return toolDoneLabel(call.kind, call.arg, true);
						} finally {
							resolve();
						}
					});
				});
				toolOutputs.push(`[${call.kind} ${call.arg}]\nok=${result.ok}\n${result.output}`);
			}

			if (effectiveToken.isCancellationRequested) {
				response.markdown('\n\n_Cancelled._');
				return {};
			}

			contents.push({ role: 'model', parts: [{ text: rawText }] });
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

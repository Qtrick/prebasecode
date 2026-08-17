/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { PreBaseAIService } from './aiService';
import type { AIContentMessage, AIContentPart } from './aiTypes';
import {
	isMagnusAgentMode,
	modeFromChatParticipantId,
	type MagnusAgentMode,
} from './modes';
import { runHeaderLabel, type MagnusTaskRun } from './taskRunModel';
import {
	assembleChatRequest,
	resolveNativeReferences,
	type AssembledChatRequest,
} from './requestAssembler';
import {
	executeToolCallBatch,
	type ToolCallItem,
	type ToolExecutionTracker,
} from './toolExecutor';

export interface MagnusChatDefaults {
	mode: MagnusAgentMode;
	modelId: string;
	attachedFiles: string[];
	graphSelection?: string;
	runtimeContext?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function functionCalls(parts: AIContentPart[]): ToolCallItem[] {
	let index = 0;
	return parts.flatMap(part => {
		const name = part.functionCall?.name?.trim();
		const id = part.functionCall?.id;
		if (name) {
			const item: ToolCallItem = {
				id,
				name,
				args: isRecord(part.functionCall?.args) ? part.functionCall.args : {},
				index: index++,
			};
			return [item];
		}
		return [];
	});
}

/** The model may return normal Markdown, including code fences, unchanged. */
export function visibleAssistantText(raw: string): string {
	return raw;
}

export function registerMagnusChatParticipants(
	context: vscode.ExtensionContext,
	aiService: PreBaseAIService,
	_state?: unknown,
): void {
	const ids = [
		'prebase.magnus.ask',
		'prebase.magnus.edit',
		'prebase.magnus.agent',
	];

	for (const id of ids) {
		const participant = vscode.chat.createChatParticipant(id, async (request, chatContext, response, token) => {
			return handleChatRequest(id, request, chatContext, response, token, aiService);
		});
		participant.iconPath = undefined;
		context.subscriptions.push(participant);
	}
}

async function handleChatRequest(
	participantId: string,
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext | undefined,
	response: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	aiService: PreBaseAIService,
): Promise<vscode.ChatResult | void> {
	const enabled = vscode.workspace.getConfiguration('prebase.magnus').get<boolean>('enabled', true);
	if (!enabled) {
		response.markdown('Agents is disabled. Enable `prebase.magnus.enabled` in Settings.');
		return {};
	}

	const status = await aiService.getProviderStatus();
	if (!status.configured) {
		response.markdown(status.safeStatusMessage || 'No AI provider is configured. Configure a key in Agents Settings or provide GEMINI_API_KEY in PreBase root .env.');
		return {};
	}

	// 1. Resolve Mode
	let mode = modeFromChatParticipantId(participantId);
	const configuredMode = vscode.workspace.getConfiguration('prebase.magnus').get<string>('defaultMode', 'ask');
	if (participantId.endsWith('.ask') && isMagnusAgentMode(configuredMode) && (configuredMode === 'plan' || configuredMode === 'runtime')) {
		mode = configuredMode;
	}

	// 2. Resolve Native References & Context
	const resolvedAttachments = await resolveNativeReferences(request.references);

	// 3. Assemble Request and Context Budget
	const assembled: AssembledChatRequest = assembleChatRequest(
		mode,
		request,
		chatContext,
		resolvedAttachments,
	);

	const requestCts = new vscode.CancellationTokenSource();
	const cancelSub = token.onCancellationRequested(() => requestCts.cancel());
	const effectiveToken = requestCts.token;

	const run: MagnusTaskRun = {
		runId: `run-${Date.now()}`,
		userTask: request.prompt,
		status: 'planning',
		submittedAt: Date.now(),
		workGroups: [],
	};

	const tracker: ToolExecutionTracker = {
		totalToolCalls: 0,
		webSearches: 0,
		deepWebSearches: 0,
		cumulativeResultChars: 0,
	};

	const messages: AIContentMessage[] = [...assembled.initialMessages];

	try {
		let rawText = '';
		let enteredRunning = false;

		try {
			for (let iteration = 0; iteration < assembled.budget.maxProviderRounds; iteration++) {
				if (effectiveToken.isCancellationRequested) {
					run.status = 'cancelled';
					run.completedAt = Date.now();
					response.markdown(`\n\n_${runHeaderLabel(run)}._`);
					return {};
				}

				const result = await aiService.generateCandidate({
					messages,
					systemInstruction: assembled.systemInstruction,
					tools: assembled.tools.length ? assembled.tools : undefined,
					modelId: assembled.modelId,
					reasoningEffort: assembled.reasoningEffort,
				}, effectiveToken);

				const parts = result.candidate?.content?.parts ?? (result.text ? [{ text: result.text }] : []);
				const calls = functionCalls(parts);

				if (!calls.length) {
					rawText = result.text || parts.map(part => part.text ?? '').join('');
					break;
				}

				enteredRunning = true;
				run.status = 'running';
				run.startedAt ??= Date.now();
				messages.push({ role: 'model', parts });

				const responseParts = await executeToolCallBatch(
					calls,
					assembled.tools,
					request.toolInvocationToken,
					effectiveToken,
					assembled.budget,
					tracker,
					true,
				);

				messages.push({ role: 'user', parts: responseParts });
			}
		} catch (err) {
			if (effectiveToken.isCancellationRequested) {
				run.status = 'cancelled';
				run.completedAt = Date.now();
				response.markdown(`\n\n_${runHeaderLabel(run)}._`);
				return {};
			}
			run.status = 'failed';
			run.completedAt = Date.now();
			run.error = err instanceof Error ? err.message : String(err);
			response.markdown(`Agents request failed: ${run.error}`);
			return {};
		}

		run.status = 'completed';
		run.completedAt = Date.now();
		run.finalResponse = visibleAssistantText(rawText);
		const finalVisible = run.finalResponse;
		response.markdown(finalVisible || (enteredRunning ? 'The tool loop reached its limit before the model returned a final response.' : 'The model returned no text.'));
		return {};
	} finally {
		cancelSub.dispose();
		requestCts.dispose();
	}
}

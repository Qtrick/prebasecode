/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { PreBaseAIService } from './aiService';
import type { AIContentMessage, AIContentPart, AIGenerateResult, AIGenerateResponseCandidate } from './aiTypes';
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
import { paceTextStream, createLivePacedSink, type LivePacedSink } from './streamPace';

export const magnusRequestShutdown = new vscode.CancellationTokenSource();

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

export const magnusLiveStreamDiagnostics = {
	streamActive: 0,
	pacingActive: 0,
};

async function streamPacedCandidate(
	aiService: PreBaseAIService,
	request: Parameters<PreBaseAIService['streamCandidate']>[0],
	token: vscode.CancellationToken,
	onPiece: (piece: string) => void,
	inspectChunk?: (chunk: { text?: string; candidate?: AIGenerateResponseCandidate }, sink: LivePacedSink) => boolean,
): Promise<AIGenerateResult> {
	magnusLiveStreamDiagnostics.streamActive++;
	magnusLiveStreamDiagnostics.pacingActive++;
	const sink = createLivePacedSink(onPiece, { token });
	try {
		return await aiService.streamCandidate(request, chunk => {
			if (inspectChunk?.(chunk, sink)) {
				return;
			}
			if (chunk.text) {
				sink.push(chunk.text);
			}
		}, token);
	} finally {
		await sink.close();
		magnusLiveStreamDiagnostics.streamActive = Math.max(0, magnusLiveStreamDiagnostics.streamActive - 1);
		magnusLiveStreamDiagnostics.pacingActive = Math.max(0, magnusLiveStreamDiagnostics.pacingActive - 1);
	}
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
	const shutdownSub = magnusRequestShutdown.token.onCancellationRequested(() => requestCts.cancel());
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
		webFetches: 0,
		cumulativeResultChars: 0,
	};

	const messages: AIContentMessage[] = [...assembled.initialMessages];
	const startTime = Date.now();
	let recoveredStarvation = false;
	let recoveredEmptyStop = false;

	try {
		let rawText = '';
		let enteredRunning = false;
		let streamedVisible = false;

		try {
			for (let iteration = 0; iteration < assembled.budget.maxProviderRounds; iteration++) {
				if (effectiveToken.isCancellationRequested) {
					run.status = 'cancelled';
					run.completedAt = Date.now();
					response.markdown(`\n\n_${runHeaderLabel(run)}._`);
					return {};
				}

				if (Date.now() - startTime > assembled.budget.maxWallClockMs) {
					rawText = 'The task reached its maximum execution time limit before completing. Please review collected findings or retry.';
					break;
				}

				let turnStreamed = false;
				let toolTurn = false;
				const result = await streamPacedCandidate(
					aiService,
					{
						messages,
						systemInstruction: assembled.systemInstruction,
						tools: assembled.tools.length ? assembled.tools : undefined,
						modelId: assembled.modelId,
						reasoningEffort: assembled.reasoningEffort,
					},
					effectiveToken,
					piece => {
						turnStreamed = true;
						streamedVisible = true;
						response.markdown(piece);
					},
					(chunk, sink) => {
						const chunkParts = chunk.candidate?.content?.parts;
						if (chunkParts && functionCalls(chunkParts).length > 0) {
							toolTurn = true;
							sink.discard();
							return true;
						}
						return toolTurn;
					},
				);

				const parts = result.candidate?.content?.parts ?? (result.text ? [{ text: result.text }] : []);
				const calls = functionCalls(parts);

				if (calls.length > 0 || toolTurn) {
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
					continue;
				}

				// No tool calls returned: inspect disposition and text content
				const textParts = parts.filter(p => !p.thought).map(p => p.text ?? '').filter(Boolean).join('');
				const candidateText = (result.text || textParts).trim();

				if (candidateText.length > 0) {
					if (!turnStreamed) {
						rawText = candidateText;
					}
					break;
				}

				if (result.disposition === 'promptBlocked') {
					const blockReason = result.promptFeedback?.blockReason ? ` (${result.promptFeedback.blockReason})` : '';
					rawText = `The request was blocked by the AI provider's safety policy${blockReason}. Please adjust your prompt.`;
					break;
				}

				if (result.disposition === 'candidateBlocked') {
					rawText = 'The model response was blocked by safety policy. Please rephrase or narrow the request.';
					break;
				}

				if ((result.disposition === 'thoughtOnly' || result.disposition === 'maxTokens') && !recoveredStarvation) {
					recoveredStarvation = true;
					try {
						const recovery = await streamPacedCandidate(
							aiService,
							{
								messages,
								systemInstruction: `${assembled.systemInstruction}\nSynthesize and provide your final user-facing response now. Do not call additional tools.`,
								modelId: assembled.modelId,
								reasoningEffort: 'low',
							},
							effectiveToken,
							piece => {
								streamedVisible = true;
								response.markdown(piece);
							},
						);

						const recoveryText = (recovery.text || recovery.candidate?.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('') || '').trim();
						if (recoveryText.length > 0) {
							if (!streamedVisible) {
								rawText = recoveryText;
							}
							break;
						}
					} catch {
						// Fall through to actionable failure message
					}

					rawText = 'The model exhausted its output budget during reasoning. Please retry with a lower reasoning level or choose another model.';
					break;
				}

				if (result.disposition === 'emptyStop' && !recoveredEmptyStop) {
					recoveredEmptyStop = true;
					if (enteredRunning) {
						try {
							const recovery = await streamPacedCandidate(
								aiService,
								{
									messages,
									systemInstruction: `${assembled.systemInstruction}\nProvide your final summary to the user based on the tool results collected above.`,
									modelId: assembled.modelId,
									reasoningEffort: 'low',
								},
								effectiveToken,
								piece => {
									streamedVisible = true;
									response.markdown(piece);
								},
							);

							const recoveryText = (recovery.text || recovery.candidate?.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('') || '').trim();
							if (recoveryText.length > 0) {
								if (!streamedVisible) {
									rawText = recoveryText;
								}
								break;
							}
						} catch {
							// Fall through
						}

						rawText = 'The model completed execution without returning visible text. Please retry or choose another model.';
						break;
					} else {
						try {
							const retryResult = await streamPacedCandidate(
								aiService,
								{
									messages,
									systemInstruction: assembled.systemInstruction,
									modelId: assembled.modelId,
									reasoningEffort: assembled.reasoningEffort,
								},
								effectiveToken,
								piece => {
									streamedVisible = true;
									response.markdown(piece);
								},
							);
							const retryText = (retryResult.text || retryResult.candidate?.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('') || '').trim();
							if (retryText.length > 0) {
								if (!streamedVisible) {
									rawText = retryText;
								}
								break;
							}
						} catch {
							// Fall through
						}

						rawText = 'The model returned an empty response. Please retry or choose another model.';
						break;
					}
				}

				if (result.disposition === 'malformed') {
					rawText = 'The model returned an unparseable or empty response. Please check your provider configuration or choose another model.';
					break;
				}

				rawText = 'The model completed without returning visible text. Please retry or choose another model.';
				break;
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
		if (!streamedVisible) {
			const finalVisible = run.finalResponse || (enteredRunning ? 'The tool loop reached its limit before the model returned a final response.' : 'The model returned an empty response. Please retry or choose another model.');
			async function* textStream(): AsyncGenerator<string, void, unknown> {
				yield finalVisible;
			}
			for await (const piece of paceTextStream(textStream(), { token: effectiveToken })) {
				if (effectiveToken.isCancellationRequested) {
					break;
				}
				response.markdown(piece);
			}
		}
		return {};
	} finally {
		cancelSub.dispose();
		shutdownSub.dispose();
		requestCts.dispose();
	}
}

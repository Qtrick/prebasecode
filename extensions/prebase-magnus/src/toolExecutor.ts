/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { AIContentPart, AIToolDeclaration } from './aiTypes';
import { processToolResultData, type ContextBudgetConfig } from './requestAssembler';

export interface ToolCallItem {
	readonly id?: string;
	readonly name: string;
	readonly args: Record<string, unknown>;
	readonly index: number;
}

const READ_ONLY_TOOLS = new Set<string>([
	'prebase_workspace_read_file',
	'prebase_workspace_read_file_range',
	'prebase_workspace_search_text',
	'prebase_workspace_search_text_rich',
	'prebase_workspace_list_files',
	'prebase_workspace_search_symbols',
	'prebase_workspace_get_definition',
	'prebase_workspace_get_references',
	'prebase_workspace_get_diagnostics',
	'prebase_graph_search_nodes',
	'prebase_graph_get_node',
	'prebase_graph_get_dependencies',
	'prebase_graph_get_overview',
	'prebase_web_search',
	'prebase_runtime_get_state',
	'prebase_runtime_inspect_page',
	'prebase_runtime_get_evidence',
	'prebase_desktop_list_sessions',
	'prebase_desktop_get_session',
	'prebase_desktop_inspect_window',
	'prebase_desktop_get_process_output',
	'prebase_desktop_capture_screenshot',
	'prebase_terminal_get_project_environment',
]);

export function isToolReadOnly(toolName: string): boolean {
	return READ_ONLY_TOOLS.has(toolName);
}

export interface ToolExecutionTracker {
	totalToolCalls: number;
	webSearches: number;
	deepWebSearches: number;
	cumulativeResultChars: number;
}

export async function executeToolCallBatch(
	calls: ToolCallItem[],
	availableTools: AIToolDeclaration[],
	toolInvocationToken: vscode.ChatParticipantToolToken | undefined,
	token: vscode.CancellationToken,
	budget: ContextBudgetConfig,
	tracker: ToolExecutionTracker,
	supportsMultimodal: boolean = true,
): Promise<AIContentPart[]> {
	if (calls.length === 0) {
		return [];
	}

	const responseParts: AIContentPart[] = new Array(calls.length);

	// Group contiguous read-only calls for bounded parallel execution
	let i = 0;
	while (i < calls.length) {
		if (token.isCancellationRequested) {
			break;
		}

		const current = calls[i];
		const isReadOnly = isToolReadOnly(current.name);

		if (isReadOnly) {
			// Gather a slice of read-only calls up to maxParallelReadTools
			const readBatch: ToolCallItem[] = [];
			while (i < calls.length && isToolReadOnly(calls[i].name) && readBatch.length < budget.maxParallelReadTools) {
				readBatch.push(calls[i]);
				i++;
			}

			// Execute readBatch in parallel
			const results = await Promise.all(readBatch.map(call =>
				executeSingleTool(call, availableTools, toolInvocationToken, token, budget, tracker, supportsMultimodal)
			));

			for (let b = 0; b < readBatch.length; b++) {
				responseParts[readBatch[b].index] = results[b];
			}
		} else {
			// Mutating or side-effecting tool: execute sequentially
			const result = await executeSingleTool(current, availableTools, toolInvocationToken, token, budget, tracker, supportsMultimodal);
			responseParts[current.index] = result;
			i++;
		}
	}

	return responseParts.filter(Boolean);
}

async function executeSingleTool(
	call: ToolCallItem,
	availableTools: AIToolDeclaration[],
	toolInvocationToken: vscode.ChatParticipantToolToken | undefined,
	token: vscode.CancellationToken,
	budget: ContextBudgetConfig,
	tracker: ToolExecutionTracker,
	supportsMultimodal: boolean,
): Promise<AIContentPart> {
	if (token.isCancellationRequested) {
		return {
			functionResponse: {
				id: call.id,
				name: call.name,
				response: { error: 'Request was cancelled before tool execution completed.' },
			},
		};
	}

	// 1. Budget checks
	if (tracker.totalToolCalls >= budget.maxTotalToolCalls) {
		return {
			functionResponse: {
				id: call.id,
				name: call.name,
				response: { error: 'Tool execution budget exhausted for this request. Please synthesize a final answer from existing findings.' },
			},
		};
	}

	if (tracker.cumulativeResultChars >= budget.maxCumulativeToolResultChars) {
		return {
			functionResponse: {
				id: call.id,
				name: call.name,
				response: { error: 'Cumulative tool result budget reached. Please synthesize your final response from collected evidence.' },
			},
		};
	}

	if (!availableTools.some(t => t.name === call.name)) {
		return {
			functionResponse: {
				id: call.id,
				name: call.name,
				response: { error: `Tool "${call.name}" is not permitted or available in the current agent mode.` },
			},
		};
	}

	if (call.name === 'prebase_web_search') {
		const isDeep = call.args.depth === 'deep';
		if (tracker.webSearches >= budget.maxWebSearches || (isDeep && tracker.deepWebSearches >= budget.maxDeepWebSearches)) {
			return {
				functionResponse: {
					id: call.id,
					name: call.name,
					response: { error: 'Web search budget reached for this task run. Please synthesize from collected sources.' },
				},
			};
		}
		tracker.webSearches++;
		if (isDeep) {
			tracker.deepWebSearches++;
		}
	}

	tracker.totalToolCalls++;

	try {
		const toolResult = await vscode.lm.invokeTool(
			call.name,
			{
				toolInvocationToken,
				input: call.args,
			},
			token,
		);

		const { text, inlineImages } = processToolResultData(toolResult, budget.maxSingleToolResultChars);
		tracker.cumulativeResultChars += text.length;

		const responseObj: Record<string, unknown> = {
			result: text,
		};

		if (inlineImages.length > 0) {
			if (supportsMultimodal) {
				// Forward primary inline image if present
				responseObj.image = {
					mimeType: inlineImages[0].mimeType,
					data: inlineImages[0].data,
				};
			} else {
				responseObj.imageNote = 'Image was captured but the selected model does not support image input.';
			}
		}

		return {
			functionResponse: {
				id: call.id,
				name: call.name,
				response: responseObj,
			},
		};
	} catch (err) {
		const raw = err instanceof Error ? err.message : String(err || 'Tool execution failed');
		let safeMsg = raw
			.replace(/(?:AIza|sk-|ghp_|gho_|xox[baprs]-)[A-Za-z0-9_-]{10,}/g, '***REDACTED***')
			.replace(/(?:key|token|secret|password|bearer)[=:\s]+[A-Za-z0-9_\-.]{8,}/gi, '***REDACTED***');
		const home = process.env.HOME || process.env.USERPROFILE;
		if (home && safeMsg.includes(home)) {
			safeMsg = safeMsg.split(home).join('~');
		}
		return {
			functionResponse: {
				id: call.id,
				name: call.name,
				response: { error: safeMsg.slice(0, 500) },
			},
		};
	}
}

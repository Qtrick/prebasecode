/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { PreBaseAIService } from './aiService';
import type { AIContentMessage, AIContentPart, NormalizedAIModel } from './aiTypes';
import { buildMagnusLanguageModelInformation } from './modelInformation';
import { globalGeminiModelCache } from './models';

function hasStringValue(value: object): value is { value: string } {
	return Object.hasOwn(value, 'value') && typeof (value as { value?: unknown }).value === 'string';
}

function extractText(message: vscode.LanguageModelChatRequestMessage): string {
	const parts: string[] = [];
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			parts.push(part.value);
		} else if (typeof part === 'object' && part && hasStringValue(part)) {
			parts.push(part.value);
		}
	}
	return parts.join('');
}

function asRecord(value: object): Record<string, unknown> {
	return value as Record<string, unknown>;
}

export class MagnusLanguageModelProvider implements vscode.LanguageModelChatProvider {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;
	private _isDiscovering = false;

	constructor(private readonly aiService: PreBaseAIService) { }

	notifyChanged(): void {
		this._onDidChange.fire();
	}

	async refreshDiscoveredModels(token?: vscode.CancellationToken): Promise<NormalizedAIModel[]> {
		try {
			const models = await this.aiService.listModels(undefined, true, token);
			if (models && models.length > 0) {
				this._onDidChange.fire();
				return models;
			}
		} catch (err) {
			console.warn('[Magnus] Model discovery warning:', err instanceof Error ? err.message : String(err));
		}
		return globalGeminiModelCache.get() ?? [];
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		const status = await this.aiService.getProviderStatus();
		const hasConfig = status.configured;

		// Fetch models through AI service
		let discovered: NormalizedAIModel[] = [];
		try {
			discovered = await this.aiService.listModels(undefined, false, token);
		} catch {
			// fallback
		}

		if (hasConfig && discovered.length === 0 && !this._isDiscovering && !token.isCancellationRequested) {
			this._isDiscovering = true;
			this.refreshDiscoveredModels(token).finally(() => {
				this._isDiscovering = false;
			});
		}

		return buildMagnusLanguageModelInformation(hasConfig, discovered);
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const contents: AIContentMessage[] = [];
		const callNames = new Map<string, string>();
		let systemText = '';

		for (const message of messages) {
			const text = extractText(message);
			const parts: AIContentPart[] = [];
			for (const part of message.content) {
				if (part instanceof vscode.LanguageModelToolCallPart) {
					callNames.set(part.callId, part.name);
					parts.push({ functionCall: { name: part.name, args: asRecord(part.input) } });
				} else if (part instanceof vscode.LanguageModelToolResultPart) {
					const result = part.content.map(item => item instanceof vscode.LanguageModelTextPart ? item.value : '').filter(Boolean).join('\n').slice(0, 80_000);
					parts.push({ functionResponse: { name: callNames.get(part.callId) ?? 'unknown_tool', response: { result } } });
				}
			}
			if (!text && !parts.length) {
				continue;
			}
			if (message.role === vscode.LanguageModelChatMessageRole.System) {
				systemText += (systemText ? '\n' : '') + text;
				continue;
			}
			const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'model' : 'user';
			if (text) {
				parts.unshift({ text });
			}
			contents.push({ role, parts });
		}

		if (contents.length === 0) {
			contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
		}

		const tools = options.tools?.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema }));

		if (tools?.length) {
			const result = await this.aiService.generateCandidate({
				messages: contents,
				systemInstruction: systemText || undefined,
				tools,
				modelId: model.id,
			}, token);

			for (const part of result.candidate?.content.parts ?? []) {
				if (part.text) {
					progress.report(new vscode.LanguageModelTextPart(part.text));
				} else if (part.functionCall) {
					progress.report(new vscode.LanguageModelToolCallPart(crypto.randomUUID(), part.functionCall.name, part.functionCall.args ?? {}));
				}
			}
			return;
		}

		if (this.aiService.streamCandidate) {
			await this.aiService.streamCandidate(
				{
					messages: contents,
					systemInstruction: systemText || undefined,
					modelId: model.id,
				},
				chunk => {
					if (token.isCancellationRequested) {
						return;
					}
					if (chunk.text) {
						progress.report(new vscode.LanguageModelTextPart(chunk.text));
					}
				},
				token,
			);
		} else {
			const text = await this.aiService.generateText(
				contents.map(c => c.parts.map(p => p.text ?? '').join('')).join('\n'),
				{ modelId: model.id },
				token,
			);
			if (!token.isCancellationRequested) {
				progress.report(new vscode.LanguageModelTextPart(text));
			}
		}
	}

	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		const value = typeof text === 'string' ? text : extractText(text);
		return Math.max(1, Math.ceil(value.length / 4));
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { generateContentCandidate, streamGenerateContent, type GeminiContent, type GeminiPart } from './geminiClient';
import { getModelOption, resolveApiModel } from './models';
import { buildMagnusLanguageModelInformation } from './modelInformation';
import type { MagnusSecretStorage } from './secretStorage';

function extractText(message: vscode.LanguageModelChatRequestMessage): string {
	const parts: string[] = [];
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			parts.push(part.value);
		} else if (typeof part === 'object' && part && 'value' in part && typeof (part as { value: unknown }).value === 'string') {
			parts.push((part as { value: string }).value);
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

	constructor(private readonly secrets: MagnusSecretStorage) { }

	notifyChanged(): void {
		this._onDidChange.fire();
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		const hasKey = await this.secrets.hasApiKey();
		return buildMagnusLanguageModelInformation(hasKey);
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const gemini = await this.secrets.getGeminiKeyOrMessage();
		if (!gemini.key) {
			throw new Error(gemini.message || 'Agents: no model provider configured.');
		}
		const apiKey = gemini.key;

		const option = getModelOption(model.id);
		const apiModel = resolveApiModel(option.id);

		const contents: GeminiContent[] = [];
		const callNames = new Map<string, string>();
		let systemText = '';
		for (const message of messages) {
			const text = extractText(message);
			const parts: GeminiPart[] = [];
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
			const role: GeminiContent['role'] =
				message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'model' : 'user';
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
			const candidate = await generateContentCandidate(apiKey, apiModel, {
				contents,
				systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
				tools: [{ functionDeclarations: tools }],
			}, token);
			for (const part of candidate?.content.parts ?? []) {
				if (part.text) {
					progress.report(new vscode.LanguageModelTextPart(part.text));
				} else if (part.functionCall) {
					progress.report(new vscode.LanguageModelToolCallPart(crypto.randomUUID(), part.functionCall.name, part.functionCall.args ?? {}));
				}
			}
			return;
		}
		for await (const chunk of streamGenerateContent(apiKey, apiModel, { contents, systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined }, token)) {
			if (token.isCancellationRequested) { return; }
			progress.report(new vscode.LanguageModelTextPart(chunk));
		}
	}

	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		const value = typeof text === 'string' ? text : extractText(text);
		// Rough estimate: ~4 chars per token.
		return Math.max(1, Math.ceil(value.length / 4));
	}
}

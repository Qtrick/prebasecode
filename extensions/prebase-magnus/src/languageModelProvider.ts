/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { streamGenerateContent, type GeminiContent } from './geminiClient';
import { getModelOption, MAGNUS_MODELS, formatContextWindowLabel, resolveApiModel } from './models';
import type { MagnusSecretStorage } from './secretStorage';

function extractText(message: vscode.LanguageModelChatRequestMessage): string {
	const parts: string[] = [];
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			parts.push(part.value);
		} else if (part && typeof part === 'object') {
			// Older hosts hand back plain `{ value }` objects rather than a
			// LanguageModelTextPart instance, so the declared type is exactly
			// what cannot be trusted here.
			const value = (part as { value?: unknown }).value;
			if (typeof value === 'string') {
				parts.push(value);
			}
		}
	}
	return parts.join('');
}

export class MagnusLanguageModelProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	constructor(private readonly secrets: MagnusSecretStorage) { }

	dispose(): void {
		this._onDidChange.dispose();
	}

	notifyChanged(): void {
		this._onDidChange.fire();
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		const hasKey = await this.secrets.hasApiKey();
		return MAGNUS_MODELS.map((m, index) => ({
			id: m.id,
			name: m.name,
			family: 'gemini',
			version: '1.0.0',
			maxInputTokens: m.maxInputTokens,
			maxOutputTokens: m.maxOutputTokens,
			// Shown inline in the model list (secondary text).
			detail: formatContextWindowLabel(m.maxInputTokens),
			// Shown in the Cursor-style hover tooltip.
			tooltip: hasKey
				? m.description
				: `${m.description}\n\nConfigure a model provider in secure storage before using Agents.`,
			capabilities: {
				// Magnus Agent mode uses its own workspace tool loop. The workbench
				// model picker filters Agent sessions to models with toolCalling —
				// without this, Agent mode only shows synthetic "Auto".
				toolCalling: true,
				imageInput: false,
			},
			isDefault: index === 0,
			isUserSelectable: true,
			isBYOK: true,
		}));
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		_options: vscode.ProvideLanguageModelChatResponseOptions,
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
		let systemText = '';
		for (const message of messages) {
			const text = extractText(message);
			if (!text) {
				continue;
			}
			if (message.role === vscode.LanguageModelChatMessageRole.System) {
				systemText += (systemText ? '\n' : '') + text;
				continue;
			}
			const role: GeminiContent['role'] =
				message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'model' : 'user';
			contents.push({ role, parts: [{ text }] });
		}

		if (contents.length === 0) {
			contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
		}

		for await (const chunk of streamGenerateContent(
			apiKey,
			apiModel,
			{
				contents,
				systemInstruction: systemText
					? { parts: [{ text: systemText }] }
					: undefined,
			},
			token,
		)) {
			if (token.isCancellationRequested) {
				return;
			}
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

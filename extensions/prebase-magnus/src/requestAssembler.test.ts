/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { suite, test } from 'node:test';
import {
	buildSystemPrompt,
	extractConversationHistory,
	isSensitiveFile,
	processToolResultData,
	filterToolDeclarations,
	assembleChatRequest,
	DEFAULT_CONTEXT_BUDGET,
} from './requestAssembler';

suite('Magnus Request Assembler & Context Budget', () => {
	test('isSensitiveFile identifies private keys, tokens, and env files', () => {
		assert.strictEqual(isSensitiveFile('.env'), true);
		assert.strictEqual(isSensitiveFile('.env.local'), true);
		assert.strictEqual(isSensitiveFile('.env.production'), true);
		assert.strictEqual(isSensitiveFile('secrets/id_rsa'), true);
		assert.strictEqual(isSensitiveFile('certs/server.key'), true);
		assert.strictEqual(isSensitiveFile('certs/cert.pem'), true);
		assert.strictEqual(isSensitiveFile('credentials.json'), true);
		assert.strictEqual(isSensitiveFile('token.json'), true);
		assert.strictEqual(isSensitiveFile('src/app.ts'), false);
		assert.strictEqual(isSensitiveFile('package.json'), false);
	});

	test('buildSystemPrompt includes mode instructions and attached context', () => {
		const prompt = buildSystemPrompt('ask', ['Reference 1', 'Reference 2']);
		assert.ok(prompt.includes('Agents, the PreBase AI coding assistant'));
		assert.ok(prompt.includes('Edits are forbidden in this mode.'));
		assert.ok(prompt.includes('Attached context:'));
		assert.ok(prompt.includes('Reference 1'));
		assert.ok(prompt.includes('Reference 2'));
	});

	test('extractConversationHistory converts request and response turns into AIContentMessage[]', () => {
		const mockHistory = [
			{ prompt: 'What is Orbital 47?' },
			{
				response: [
					{ value: { value: 'Orbital 47 is a navigation module.' } },
				],
			},
			{ prompt: 'Where is it located?' },
		] as unknown as Parameters<typeof extractConversationHistory>[0];

		const messages = extractConversationHistory(mockHistory, 10, 10_000);
		assert.strictEqual(messages.length, 3);
		assert.strictEqual(messages[0].role, 'user');
		assert.strictEqual(messages[0].parts[0].text, 'What is Orbital 47?');
		assert.strictEqual(messages[1].role, 'model');
		assert.strictEqual(messages[1].parts[0].text, 'Orbital 47 is a navigation module.');
		assert.strictEqual(messages[2].role, 'user');
		assert.strictEqual(messages[2].parts[0].text, 'Where is it located?');
	});

	test('extractConversationHistory respects maxTurns and maxChars limits', () => {
		const turns: Array<unknown> = [];
		for (let i = 0; i < 20; i++) {
			turns.push({ prompt: `User query turn ${i}` });
			turns.push({
				response: [
					{ value: { value: `Assistant answer turn ${i}` } },
				],
			});
		}

		const messages = extractConversationHistory(turns as Parameters<typeof extractConversationHistory>[0], 4, 10_000);
		assert.strictEqual(messages.length, 4);
		assert.strictEqual(messages[messages.length - 1].parts[0].text, 'Assistant answer turn 19');
	});

	test('processToolResultData handles text and extracts multimodal image data', () => {
		const mockImageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes
		const mockToolResult = {
			content: [
				{ value: 'Captured window state successfully.' },
				{
					mimeType: 'image/png',
					data: mockImageBytes,
				},
			],
		} as unknown as Parameters<typeof processToolResultData>[0];

		const result = processToolResultData(mockToolResult, 10_000);
		assert.strictEqual(result.text, 'Captured window state successfully.');
		assert.strictEqual(result.inlineImages.length, 1);
		assert.strictEqual(result.inlineImages[0].mimeType, 'image/png');
		assert.strictEqual(result.inlineImages[0].data, Buffer.from(mockImageBytes).toString('base64'));
	});

	test('processToolResultData applies head/tail compaction when exceeding maxChars', () => {
		const longString = 'HEAD_' + 'A'.repeat(5000) + '_TAIL';
		const mockToolResult = {
			content: [{ value: longString }],
		} as unknown as Parameters<typeof processToolResultData>[0];

		const result = processToolResultData(mockToolResult, 100);
		assert.ok(result.text.length <= 150);
		assert.ok(result.text.startsWith('HEAD_'));
		assert.ok(result.text.includes('[Truncated'));
		assert.ok(result.text.endsWith('_TAIL'));
	});

	test('filterToolDeclarations prioritizes referenced tools', () => {
		const tools = [
			{ name: 'prebase_workspace_read_file', description: 'Read file' },
			{ name: 'prebase_web_search', description: 'Web search' },
			{ name: 'prebase_graph_get_overview', description: 'Graph overview' },
		] as Parameters<typeof filterToolDeclarations>[2];

		const toolReferences = [{ name: 'prebase_web_search' }] as Parameters<typeof filterToolDeclarations>[1];
		const filtered = filterToolDeclarations('ask', toolReferences, tools);

		assert.strictEqual(filtered.length, 3);
		// prebase_web_search prioritized to first position
		assert.strictEqual(filtered[0].name, 'prebase_web_search');
	});

	test('assembleChatRequest constructs full request tuple with bounded defaults', () => {
		const req = {
			prompt: 'Explain the project architecture',
		} as unknown as Parameters<typeof assembleChatRequest>[1];

		const assembled = assembleChatRequest('ask', req, undefined, ['Context 1'], DEFAULT_CONTEXT_BUDGET, 'gemini-2.5-flash');
		assert.strictEqual(assembled.mode, 'ask');
		assert.strictEqual(assembled.modelId, 'gemini-2.5-flash');
		assert.strictEqual(assembled.initialMessages.length, 1);
		assert.strictEqual(assembled.initialMessages[0].parts[0].text, 'Explain the project architecture');
		assert.ok(assembled.systemInstruction.includes('Context 1'));
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { MagnusSmokeTransportAdapter, MAGNUS_SMOKE_CHUNKS, magnusSmokeStreamDiagnostics } from './smokeTransport';
import type { ResolvedProviderExecution } from './secretResolver';
import type { NormalizedAIModel } from './aiTypes';

const credential: ResolvedProviderExecution = {
	providerId: 'smoke',
	executionMode: 'development-env',
	configured: true,
	isHosted: false,
	source: 'process-env',
};

function smokeModel(): NormalizedAIModel {
	return new MagnusSmokeTransportAdapter().staticFallbackModels[0];
}

describe('Magnus smoke transport', { concurrency: false }, () => {
test('smoke model uses NormalizedAIModel fields, is hidden, and is not product-selectable', async () => {
	const adapter = new MagnusSmokeTransportAdapter();
	const discovered = await adapter.discoverModels();
	assert.equal(discovered.length, 1);
	assert.equal(adapter.staticFallbackModels.length, 1);
	for (const model of [smokeModel(), discovered[0]]) {
		assert.equal(model.id, 'smoke-local');
		assert.equal(model.name, 'smoke-local');
		assert.equal(model.displayName, 'Smoke Local');
		assert.equal(model.providerId, 'smoke');
		assert.equal(model.visibility, 'hidden');
		assert.equal(model.consumerSelectable, false);
		assert.equal(model.hiddenReason, 'smoke-test-driver');
		assert.equal(model.capabilities.textGeneration, true);
		assert.equal(model.capabilities.streaming, true);
		assert.equal(model.capabilities.functionCalling, false);
		assert.equal(model.capabilities.agentCompatible, false);
		assert.equal((model as { label?: unknown }).label, undefined, 'NormalizedAIModel must not use a legacy label field');
	}
	assert.deepEqual(adapter.curateConsumerCatalog(), [], 'smoke models must not appear in the product picker catalog');
});

test('installSmokeTransport and stream diagnostics stay behind the smoke-test driver', () => {
	const extension = readFileSync(new URL('./extension.ts', import.meta.url), 'utf8');
	assert.match(extension, /registerCommand\('prebase\.magnus\.installSmokeTransport'/);
	assert.match(extension, /registerCommand\('prebase\.magnus\.getStreamDiagnostics'/);
	assert.match(extension, /executeCommand\('prebase\.test\.isSmokeDriver'\)/);
	assert.match(extension, /installSmokeTransport requires --enable-smoke-test-driver/);
	assert.match(extension, /getStreamDiagnostics requires --enable-smoke-test-driver/);
	assert.match(extension, /aiService\.installSmokeTransport\(new MagnusSmokeTransportAdapter\(\)\)/);
	const pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
	assert.doesNotMatch(pkg, /installSmokeTransport|getStreamDiagnostics/, 'smoke commands must not be Command Palette contributions');
	const chat = readFileSync(new URL('./chatParticipant.ts', import.meta.url), 'utf8');
	assert.match(chat, /const sink = createLivePacedSink\(onPiece, \{ token \}\)/);
	assert.match(chat, /return await aiService\.streamCandidate\(/);
	assert.doesNotMatch(chat, /adapter\.streamGenerate/);
});

test('smoke transport streams progressive chunks then completes', async () => {
	const adapter = new MagnusSmokeTransportAdapter();
	const pieces: string[] = [];
	const result = await adapter.streamGenerate(
		{ modelId: 'smoke-local', contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
		credential,
		chunk => {
			if (chunk.text) {
				pieces.push(chunk.text);
			}
		},
	);
	assert.deepEqual(pieces, [...MAGNUS_SMOKE_CHUNKS]);
	assert.equal(result.text, MAGNUS_SMOKE_CHUNKS.join(''));
	assert.equal(result.disposition, 'text');
	assert.equal(magnusSmokeStreamDiagnostics.streamActive, 0);
	assert.equal(magnusSmokeStreamDiagnostics.cancelled, false);
});

test('smoke transport reports streamActive while chunks are in flight', async () => {
	const adapter = new MagnusSmokeTransportAdapter();
	let observedActive = 0;
	await adapter.streamGenerate(
		{ modelId: 'smoke-local', contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
		credential,
		() => {
			observedActive = magnusSmokeStreamDiagnostics.streamActive;
		},
	);
	assert.equal(observedActive, 1);
	assert.equal(magnusSmokeStreamDiagnostics.streamActive, 0);
});

test('smoke transport cancel before the first chunk emits nothing', async () => {
	const adapter = new MagnusSmokeTransportAdapter();
	const token = {
		isCancellationRequested: true,
		onCancellationRequested() {
			return { dispose() { } };
		},
	};
	const pieces: string[] = [];
	const result = await adapter.streamGenerate(
		{ modelId: 'smoke-local', contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
		credential,
		chunk => {
			if (chunk.text) {
				pieces.push(chunk.text);
			}
		},
		token,
	);
	assert.deepEqual(pieces, []);
	assert.equal(result.disposition, 'cancelled');
	assert.equal(result.text, '');
	assert.equal(magnusSmokeStreamDiagnostics.cancelled, true);
	assert.equal(magnusSmokeStreamDiagnostics.streamActive, 0);
});

test('smoke transport cancellation stops further source chunks', async () => {
	const adapter = new MagnusSmokeTransportAdapter();
	const listeners: Array<() => void> = [];
	const token = {
		isCancellationRequested: false,
		onCancellationRequested(listener: () => void) {
			listeners.push(listener);
			return { dispose() { } };
		},
	};
	const pieces: string[] = [];
	const result = await adapter.streamGenerate(
		{ modelId: 'smoke-local', contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
		credential,
		chunk => {
			if (chunk.text) {
				pieces.push(chunk.text);
			}
			if (pieces.length === 1) {
				token.isCancellationRequested = true;
				for (const listener of listeners) {
					listener();
				}
			}
		},
		token,
	);
	assert.equal(pieces.length, 1);
	assert.equal(result.disposition, 'cancelled');
	assert.equal(magnusSmokeStreamDiagnostics.cancelled, true);
	assert.equal(magnusSmokeStreamDiagnostics.streamActive, 0);
});
});

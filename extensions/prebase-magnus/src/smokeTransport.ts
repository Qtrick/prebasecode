/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	AICancellationToken,
	AIGenerateRequest,
	AIGenerateResult,
	AIProviderErrorClassification,
	IPreBaseAIProviderAdapter,
	NormalizedAIModel,
} from './aiTypes';
import type { PreBaseAIExecutionMode } from './secretCatalog';
import type { ResolvedProviderExecution } from './secretResolver';

export const MAGNUS_SMOKE_CHUNKS = [
	'Smoke stream chunk one. ',
	'Smoke stream chunk two. ',
	'Smoke stream chunk three. ',
	'Smoke stream complete.',
] as const;

const SMOKE_MODEL: NormalizedAIModel = {
	id: 'smoke-local',
	name: 'smoke-local',
	displayName: 'Smoke Local',
	description: 'Deterministic local smoke transport. Not a product provider.',
	inputTokenLimit: 8_192,
	outputTokenLimit: 2_048,
	capabilities: {
		textGeneration: true,
		streaming: true,
		functionCalling: false,
		multimodalInput: false,
		structuredOutput: false,
		thinkingProtocol: false,
		agentCompatible: false,
		descriptionCompatible: false,
	},
	providerId: 'smoke',
	visibility: 'hidden',
	consumerSelectable: false,
	autoEligible: true,
	hiddenReason: 'smoke-test-driver',
};

export type MagnusSmokeStreamDiagnostics = {
	streamActive: number;
	sourceChunks: number;
	cancelled: boolean;
};

export const magnusSmokeStreamDiagnostics: MagnusSmokeStreamDiagnostics = {
	streamActive: 0,
	sourceChunks: 0,
	cancelled: false,
};

function sleep(ms: number, token?: AICancellationToken): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			fn();
		};
		const handle: { timer?: ReturnType<typeof setTimeout>; sub?: { dispose(): void } } = {};
		handle.sub = token?.onCancellationRequested?.(() => {
			if (handle.timer !== undefined) {
				clearTimeout(handle.timer);
			}
			handle.sub?.dispose();
			finish(() => reject(Object.assign(new Error('Cancelled'), { name: 'CancellationError' })));
		});
		handle.timer = setTimeout(() => {
			handle.sub?.dispose();
			finish(resolve);
		}, ms);
		if (token?.isCancellationRequested) {
			if (handle.timer !== undefined) {
				clearTimeout(handle.timer);
			}
			handle.sub?.dispose();
			finish(() => reject(Object.assign(new Error('Cancelled'), { name: 'CancellationError' })));
		}
	});
}

function result(text: string, cancelled: boolean): AIGenerateResult {
	return {
		text,
		disposition: cancelled ? 'cancelled' : 'text',
		modelId: 'smoke-local',
		providerId: 'smoke',
		executionMode: 'development-env',
		candidate: {
			content: { role: 'model', parts: [{ text }] },
			finishReason: 'STOP',
		},
	};
}

export class MagnusSmokeTransportAdapter implements IPreBaseAIProviderAdapter {
	readonly id = 'smoke';
	readonly displayName = 'Smoke Transport';
	readonly supportedExecutionModes: readonly PreBaseAIExecutionMode[] = ['development-env', 'byok', 'hosted', 'auto'];
	readonly defaultModel = 'smoke-local';
	readonly staticFallbackModels: readonly NormalizedAIModel[] = [SMOKE_MODEL];

	resolveAutoModel(): string {
		return this.defaultModel;
	}

	async discoverModels(): Promise<NormalizedAIModel[]> {
		return [SMOKE_MODEL];
	}

	curateConsumerCatalog(): NormalizedAIModel[] {
		return [];
	}

	async generate(request: AIGenerateRequest, _credential: ResolvedProviderExecution, token?: AICancellationToken): Promise<AIGenerateResult> {
		const streamed = await this.streamGenerate(request, _credential, () => undefined, token);
		return streamed;
	}

	async streamGenerate(
		_request: AIGenerateRequest,
		_credential: ResolvedProviderExecution,
		onChunk: (chunk: { text?: string }) => void,
		token?: AICancellationToken,
	): Promise<AIGenerateResult> {
		magnusSmokeStreamDiagnostics.streamActive++;
		magnusSmokeStreamDiagnostics.cancelled = false;
		magnusSmokeStreamDiagnostics.sourceChunks = 0;
		let text = '';
		try {
			for (const chunk of MAGNUS_SMOKE_CHUNKS) {
				if (token?.isCancellationRequested) {
					magnusSmokeStreamDiagnostics.cancelled = true;
					return result(text, true);
				}
				await sleep(220, token);
				if (token?.isCancellationRequested) {
					magnusSmokeStreamDiagnostics.cancelled = true;
					return result(text, true);
				}
				text += chunk;
				magnusSmokeStreamDiagnostics.sourceChunks++;
				onChunk({ text: chunk });
			}
			return result(text, false);
		} catch (error) {
			if (token?.isCancellationRequested || (error instanceof Error && error.name === 'CancellationError')) {
				magnusSmokeStreamDiagnostics.cancelled = true;
				return result(text, true);
			}
			throw error;
		} finally {
			magnusSmokeStreamDiagnostics.streamActive = Math.max(0, magnusSmokeStreamDiagnostics.streamActive - 1);
		}
	}

	async testConnection(): Promise<{ ok: boolean; modelId: string; reply?: string }> {
		return { ok: true, modelId: this.defaultModel, reply: MAGNUS_SMOKE_CHUNKS.join('') };
	}

	normalizeError(error: unknown): AIProviderErrorClassification {
		const message = error instanceof Error ? error.message : String(error);
		return { code: message.includes('Cancel') ? 'cancelled' : 'unknown', safeMessage: message, retryable: false };
	}
}

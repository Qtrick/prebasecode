/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { normalizeCompactDescription, PreBaseGraphDescriptionService } from '../../host/workbench/prebaseGraphDescriptionService.js';
import type { GraphNode } from '../../common/types/graphTypes.js';

suite('PreBaseGraphDescriptionService (Unit)', () => {
	const workspaceFolder = {
		uri: { toString: () => 'file:///mock/workspace' },
		name: 'mock-workspace',
		index: 0,
		toResource: (rel: string) => ({ toString: () => `file:///mock/workspace/${rel}` }),
	};

	const mockWorkspaceContextService = {
		getWorkspace: () => ({
			folders: [workspaceFolder],
		}),
	} as any;

	const mockFileService = {
		readFile: async () => {
			return {
				value: Buffer.from('export class PreBaseEditor { constructor() {} run() {} }'),
				etag: 'etag-123',
			};
		},
	} as any;

	test('normalizes descriptions to concise 1-sentence forms and trims filler prefixes', () => {
		const verbose = 'This file provides the primary editor container. It manages document models and coordinates workbench layout. In addition, it registers keybindings and handles viewport resizing.';
		const normalized = normalizeCompactDescription(verbose);
		assert.ok(normalized.startsWith('Provides the primary editor container.'));
		assert.ok(!normalized.includes('coordinates workbench layout.'));
		assert.ok(!normalized.includes('viewport resizing.'));

		const markdownSample = '**PreBaseEditor** manages the `monaco` editor instance and coordinates syntax decorations.';
		const cleaned = normalizeCompactDescription(markdownSample);
		assert.equal(cleaned, 'PreBaseEditor manages the monaco editor instance and coordinates syntax decorations.');
	});

	test('skips sensitive or credential files safely', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		const mockCommandService = {
			executeCommand: async () => assert.fail('Should not execute command for sensitive file'),
		} as any;

		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			mockFileService,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = {
			id: 'n1',
			label: '.env',
			path: '.env',
			kind: 'file',
		};

		const result = await service.describeNode(node);
		assert.equal(result.aiStatus, 'skipped');
		assert.equal(result.cacheHit, false);
		assert.ok(result.aiMessage?.includes('skipped'));
	});

	test('generates ultra-concise description with v8 prompt and returns AI provenance', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		let capturedCommands: string[] = [];
		let capturedArgs: any = undefined;

		const mockCommandService = {
			executeCommand: async (cmd: string, args: any) => {
				capturedCommands.push(cmd);
				if (cmd === 'prebase.magnus.getDescriptionContext') {
					return {
						providerId: 'gemini',
						modelId: 'gemini-3.7-flash',
						executionMode: 'byok',
						reasoningEffort: 'low',
						policyVersion: 'v8',
						cacheIdentity: 'gemini:gemini-3.7-flash:description-policy-v8',
					};
				}
				capturedArgs = args;
				return {
					text: 'Manages the primary editor surface and coordinates rendering across active panes.',
					status: 'ready',
					providerId: 'gemini',
					modelId: 'gemini-3.7-flash',
					cacheIdentity: 'gemini:gemini-3.7-flash:description-policy-v8',
				};
			},
		} as any;

		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			mockFileService,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = {
			id: 'editor-node',
			label: 'src/editor.ts',
			path: 'src/editor.ts',
			kind: 'file',
			meta: {
				architectureLayer: 'workbench',
				imports: ['vs/base/common/lifecycle', 'vs/editor/common/editorCommon'],
			},
		};

		const result1 = await service.describeNode(node);

		// Assert command and prompt details
		assert.ok(capturedCommands.includes('prebase.magnus.getDescriptionContext'));
		assert.ok(capturedCommands.includes('prebase.magnus.describeFile'));
		assert.ok(capturedArgs.prompt.includes('1-sentence description'));
		assert.ok(capturedArgs.prompt.includes('Path: src/editor.ts'));
		assert.ok(capturedArgs.prompt.includes('Layer: workbench'));

		// Assert result & provenance
		assert.equal(result1.aiStatus, 'ready');
		assert.equal(result1.cacheHit, false);
		assert.equal(result1.aiProviderId, 'gemini');
		assert.equal(result1.aiModelId, 'gemini-3.7-flash');
		assert.ok(result1.aiDescription?.includes('Manages the primary editor surface'));

		// Assert cache key consistency: second call hits cache with same provenance
		let describeFileExecutedAgain = false;
		mockCommandService.executeCommand = async (cmd: string) => {
			if (cmd === 'prebase.magnus.getDescriptionContext') {
				return {
					providerId: 'gemini',
					modelId: 'gemini-3.7-flash',
					cacheIdentity: 'gemini:gemini-3.7-flash:description-policy-v8',
				};
			}
			if (cmd === 'prebase.magnus.describeFile') {
				describeFileExecutedAgain = true;
				return { text: 'test', status: 'ready' };
			}
			return undefined;
		};

		const result2 = await service.describeNode(node);
		assert.equal(describeFileExecutedAgain, false, 'Should have hit cache instead of invoking describeFile');
		assert.equal(result2.aiStatus, 'ready');
		assert.equal(result2.cacheHit, true);
		assert.equal(result2.aiProviderId, 'gemini');
		assert.equal(result2.aiModelId, 'gemini-3.7-flash');
		assert.equal(result2.aiDescription, result1.aiDescription);
	});

	test('invalidates cache when model or policy cacheIdentity changes', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		let currentIdentity = 'gemini:gemini-2.5-flash:description-policy-v8';
		let describeFileCount = 0;

		const mockCommandService = {
			executeCommand: async (cmd: string) => {
				if (cmd === 'prebase.magnus.getDescriptionContext') {
					return {
						providerId: 'gemini',
						modelId: currentIdentity.includes('3.7') ? 'gemini-3.7-flash' : 'gemini-2.5-flash',
						cacheIdentity: currentIdentity,
					};
				}
				if (cmd === 'prebase.magnus.describeFile') {
					describeFileCount++;
					return {
						text: `Description under identity ${currentIdentity}`,
						status: 'ready',
						providerId: 'gemini',
						modelId: currentIdentity.includes('3.7') ? 'gemini-3.7-flash' : 'gemini-2.5-flash',
						cacheIdentity: currentIdentity,
					};
				}
				return undefined;
			},
		} as any;

		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			mockFileService,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = {
			id: 'n1',
			label: 'src/config.ts',
			path: 'src/config.ts',
			kind: 'file',
		};

		// First run: calls describeFile
		await service.describeNode(node);
		assert.equal(describeFileCount, 1);

		// Second run with same identity: cache hit
		await service.describeNode(node);
		assert.equal(describeFileCount, 1);

		// Third run after user switches to Gemini 3.7: identity changes -> cache miss
		currentIdentity = 'gemini:gemini-3.7-flash:description-policy-v8';
		const res3 = await service.describeNode(node);
		assert.equal(describeFileCount, 2, 'Should have regenerated description for new model identity');
		assert.ok(res3.aiDescription?.includes('gemini-3.7-flash'));
	});

	test('computes deterministic content hash when file etag is absent', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		const noEtagFileService = {
			readFile: async () => ({
				value: Buffer.from('fn main() { println!("tauri config"); }'),
			}),
		} as any;

		const mockCommandService = {
			executeCommand: async (cmd: string) => {
				if (cmd === 'prebase.magnus.getDescriptionContext') {
					return { cacheIdentity: 'gemini:gemini-2.5-flash:description-policy-v8' };
				}
				return {
					text: 'Configuration entrypoint for Tauri host.',
					status: 'ready',
					providerId: 'gemini',
					modelId: 'gemini-2.5-flash',
					cacheIdentity: 'gemini:gemini-2.5-flash:description-policy-v8',
				};
			},
		} as any;

		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			noEtagFileService,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = {
			id: 'tauri-mod',
			label: 'src-tauri/src/config/mod.rs',
			path: 'src-tauri/src/config/mod.rs',
			kind: 'file',
		};

		const result = await service.describeNode(node);
		assert.equal(result.aiStatus, 'ready');
		assert.equal(result.aiDescription, 'Configuration entrypoint for Tauri host.');

		// Cache entry stored in v8 key
		const storedRaw = storageMap.get('prebase.graph.descriptionCache.v8');
		assert.ok(storedRaw, 'Should store in v8 cache key');
		assert.ok(storedRaw.includes('Configuration entrypoint'));
	});

	test('fast cache hit returns immediately without invoking getDescriptionContext IPC', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		const commandsExecuted: string[] = [];
		const mockCommandService = {
			executeCommand: async (cmd: string) => {
				commandsExecuted.push(cmd);
				if (cmd === 'prebase.magnus.getDescriptionContext') {
					return {
						providerId: 'gemini',
						modelId: 'gemini-3.7-flash',
						cacheIdentity: 'gemini:gemini-3.7-flash:description-policy-v8',
					};
				}
				return {
					text: 'Initial generated description.',
					status: 'ready',
					providerId: 'gemini',
					modelId: 'gemini-3.7-flash',
					cacheIdentity: 'gemini:gemini-3.7-flash:description-policy-v8',
				};
			},
		} as any;

		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			mockFileService,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = {
			id: 'fast-node',
			label: 'src/fast.ts',
			path: 'src/fast.ts',
			kind: 'file',
		};

		// 1. Initial populate: calls commandService
		const res1 = await service.describeNode(node);
		assert.equal(res1.cacheHit, false);
		const initialCount = commandsExecuted.length;
		assert.equal(initialCount, 2);

		// 2. Second call: cache hit! describeFile is not invoked again
		let describeFileCalled = false;
		mockCommandService.executeCommand = async (cmd: string) => {
			if (cmd === 'prebase.magnus.getDescriptionContext') {
				return {
					providerId: 'gemini',
					modelId: 'gemini-3.7-flash',
					cacheIdentity: 'gemini:gemini-3.7-flash:description-policy-v8',
				};
			}
			if (cmd === 'prebase.magnus.describeFile') {
				describeFileCalled = true;
				return { text: 'regenerated', status: 'ready' };
			}
			return undefined;
		};

		const res2 = await service.describeNode(node);
		assert.equal(res2.cacheHit, true);
		assert.equal(describeFileCalled, false, 'describeFile should not be invoked on cache hit');
		assert.equal(res2.aiDescription, res1.aiDescription);
	});

	test('recovering from cancelled in-flight request creates fresh promise on re-selection (A -> B -> A race fix)', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		let generationCalls = 0;
		const mockCommandService = {
			executeCommand: async (cmd: string) => {
				if (cmd === 'prebase.magnus.describeFile') {
					generationCalls++;
					return {
						text: `Description generation pass ${generationCalls}`,
						status: 'ready',
						providerId: 'gemini',
						modelId: 'gemini-3.7-flash',
					};
				}
				return undefined;
			},
		} as any;

		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			mockFileService,
			mockStorage,
			mockCommandService,
		);

		const nodeA: GraphNode = { id: 'nodeA', label: 'src/a.ts', path: 'src/a.ts', kind: 'file' };
		const nodeB: GraphNode = { id: 'nodeB', label: 'src/b.ts', path: 'src/b.ts', kind: 'file' };

		// 1. Start requesting Node A
		const pA1 = service.describeNode(nodeA);

		// 2. User quickly switches to Node B (cancels in-flight A) and waits for B
		const resB = await service.describeNode(nodeB);
		assert.equal(resB.aiStatus, 'ready');

		const resA1 = await pA1;
		assert.equal(resA1.aiStatus, 'unavailable');
		assert.ok(resA1.aiMessage?.includes('cancelled'));

		// 3. User switches back to Node A: must create a fresh in-flight request and succeed (not return cancelled A1)
		const resA2 = await service.describeNode(nodeA);
		assert.equal(resA2.aiStatus, 'ready');
		assert.ok(resA2.aiDescription?.includes('Description generation pass'));
	});

	test('handles empty responses and error states gracefully', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		const mockCommandService = {
			executeCommand: async () => ({
				status: 'error',
				safeMessage: 'AI description generation exhausted its response budget.',
			}),
		} as any;

		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			mockFileService,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = {
			id: 'n-err',
			label: 'src/heavy.ts',
			path: 'src/heavy.ts',
			kind: 'file',
		};

		const result = await service.describeNode(node);
		assert.equal(result.aiStatus, 'error');
		assert.equal(result.cacheHit, false);
		assert.ok(result.aiMessage?.includes('budget'));
	});
});

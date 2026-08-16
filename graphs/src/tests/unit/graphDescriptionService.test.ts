/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { PreBaseGraphDescriptionService } from '../../host/workbench/prebaseGraphDescriptionService.js';
import type { GraphNode } from '../../common/types/graphTypes.js';

suite('PreBaseGraphDescriptionService (Unit)', () => {
	const workspaceFolder = {
		uri: { toString: () => 'file:///mock/workspace', fsPath: '/mock/workspace' } as any,
		name: 'mock-workspace',
		index: 0,
		toResource: (rel: string) => ({
			toString: () => `file:///mock/workspace/${rel}`,
			fsPath: `/mock/workspace/${rel}`,
			path: `/mock/workspace/${rel}`,
		}) as any,
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

	test('generates description with v4 prompt and returns AI provenance', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		let capturedCommand = '';
		let capturedArgs: any = undefined;

		const mockCommandService = {
			executeCommand: async (cmd: string, args: any) => {
				capturedCommand = cmd;
				capturedArgs = args;
				return {
					text: 'PreBaseEditor is responsible for managing the primary editor surface. It coordinates rendering and user actions.',
					status: 'ready',
					providerId: 'gemini',
					modelId: 'gemini-2.5-flash',
					cacheIdentity: 'gemini:gemini-2.5-flash:v4',
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
		assert.equal(capturedCommand, 'prebase.magnus.describeFile');
		assert.ok(capturedArgs.prompt.includes('3–5 sentence description'));
		assert.ok(capturedArgs.prompt.includes('Path: src/editor.ts'));
		assert.ok(capturedArgs.prompt.includes('Layer: workbench'));

		// Assert result & provenance
		assert.equal(result1.aiStatus, 'ready');
		assert.equal(result1.cacheHit, false);
		assert.equal(result1.aiProviderId, 'gemini');
		assert.equal(result1.aiModelId, 'gemini-2.5-flash');
		assert.ok(result1.aiDescription?.includes('PreBaseEditor is responsible'));

		// Assert cache key consistency: second call hits cache with same provenance
		let commandExecutedAgain = false;
		mockCommandService.executeCommand = async () => {
			commandExecutedAgain = true;
		};

		const result2 = await service.describeNode(node);
		assert.equal(commandExecutedAgain, false, 'Should have hit cache instead of invoking command');
		assert.equal(result2.aiStatus, 'ready');
		assert.equal(result2.cacheHit, true);
		assert.equal(result2.aiProviderId, 'gemini');
		assert.equal(result2.aiModelId, 'gemini-2.5-flash');
		assert.equal(result2.aiDescription, result1.aiDescription);
	});
});

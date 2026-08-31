/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { URI } from '../../../../../../base/common/uri.js';
import { normalizeCompactDescription, PreBaseGraphDescriptionService } from '../../host/workbench/prebaseGraphDescriptionService.js';
import type { GraphNode } from '../../common/types/graphTypes.js';

suite('PreBaseGraphDescriptionService (Unit - v9 File-Aware Cache)', () => {
	const workspaceFolderUri = URI.parse('file:///mock/workspace');
	const workspaceFolder = {
		uri: workspaceFolderUri,
		name: 'mock-workspace',
		index: 0,
		toResource: (rel: string) => URI.joinPath(workspaceFolderUri, rel),
	};

	const mockWorkspaceContextService = {
		getWorkspace: () => ({
			folders: [workspaceFolder],
		}),
		getWorkspaceFolder: (uri: URI) => {
			if (uri.toString().startsWith(workspaceFolderUri.toString())) {
				return workspaceFolder;
			}
			return undefined;
		},
	} as any;

	function createMockFileService(files: Record<string, string> = {}) {
		let changeListener: ((e: any) => void) | undefined;
		let operationListener: ((e: any) => void) | undefined;
		let readCount = 0;

		return {
			get readCount() { return readCount; },
			readFile: async (resource: any) => {
				readCount++;
				const uriStr = resource.toString();
				const content = files[uriStr] ?? 'export const mock = true;';
				return {
					value: Buffer.from(content),
					etag: 'etag-1',
				};
			},
			onDidFilesChange: (listener: (e: any) => void) => {
				changeListener = listener;
				return { dispose: () => { changeListener = undefined; } };
			},
			onDidRunOperation: (listener: (e: any) => void) => {
				operationListener = listener;
				return { dispose: () => { operationListener = undefined; } };
			},
			emitChange: (resource: any, isDelete: boolean = false) => {
				changeListener?.({
					rawAdded: [],
					rawUpdated: isDelete ? [] : [resource],
					rawDeleted: isDelete ? [resource] : [],
				});
			},
			emitOperation: (resource: any, operation: number = 0, target?: any) => {
				operationListener?.({ resource, operation, target });
			},
		};
	}

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

		const fileService = createMockFileService();
		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService as any,
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

		const peek = service.peekCachedDescription(node);
		assert.equal(peek.cached, false);
	});

	test('1. Same file viewed 10 times -> exactly 1 AI call; clean cache hit returns without disk read or AI call', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		let aiCallCount = 0;
		const mockCommandService = {
			executeCommand: async (cmd: string) => {
				if (cmd === 'prebase.magnus.getDescriptionContext') {
					return { providerId: 'gemini', modelId: 'gemini-3.7-flash' };
				}
				if (cmd === 'prebase.magnus.describeFile') {
					aiCallCount++;
					return {
						text: 'Coordinates primary graph layout and visual node hierarchies.',
						status: 'ready',
						providerId: 'gemini',
						modelId: 'gemini-3.7-flash',
					};
				}
				return undefined;
			},
		} as any;

		const fileService = createMockFileService();
		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService as any,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = {
			id: 'n-editor',
			label: 'src/editor.ts',
			path: 'src/editor.ts',
			kind: 'file',
		};

		// 1st open: reads file and calls AI
		const res1 = await service.describeNode(node);
		assert.equal(aiCallCount, 1);
		assert.equal(res1.cacheHit, false);
		assert.equal(res1.aiStatus, 'ready');
		assert.ok(res1.aiDescription?.includes('Coordinates primary graph layout'));
		const initialReads = fileService.readCount;

		// 2nd through 10th open: clean verified fast path (zero AI calls, zero disk reads)
		for (let i = 2; i <= 10; i++) {
			const res = await service.describeNode(node);
			assert.equal(aiCallCount, 1, `Expected 1 AI call on pass ${i}`);
			assert.equal(res.cacheHit, true, `Expected cache hit on pass ${i}`);
			assert.equal(res.aiDescription, res1.aiDescription);
			assert.equal(fileService.readCount, initialReads, `Pass ${i} must not read disk`);
		}

		// Peek is immediately ready
		const peek = service.peekCachedDescription(node);
		assert.equal(peek.cached, true);
		assert.equal(peek.description, res1.aiDescription);
	});

	test('2. Model switch -> 0 extra AI calls (model changes do not invalidate cache for unchanged files)', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		let currentModel = 'gemini-2.5-flash';
		let aiCallCount = 0;

		const mockCommandService = {
			executeCommand: async (cmd: string) => {
				if (cmd === 'prebase.magnus.getDescriptionContext') {
					return { providerId: 'gemini', modelId: currentModel };
				}
				if (cmd === 'prebase.magnus.describeFile') {
					aiCallCount++;
					return {
						text: `Description generated by ${currentModel}`,
						status: 'ready',
						providerId: 'gemini',
						modelId: currentModel,
					};
				}
				return undefined;
			},
		} as any;

		const fileService = createMockFileService();
		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService as any,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = {
			id: 'n-models',
			label: 'src/models.ts',
			path: 'src/models.ts',
			kind: 'file',
		};

		// 1. Initial generation with Gemini 2.5 Flash
		const res1 = await service.describeNode(node);
		assert.equal(aiCallCount, 1);
		assert.equal(res1.cacheHit, false);

		// 2. User switches model to Gemini 3.7 Flash
		currentModel = 'gemini-3.7-flash';

		// 3. Opening node again: file has not changed, so cached description is preserved (0 extra AI calls)
		const res2 = await service.describeNode(node);
		assert.equal(aiCallCount, 1, 'Model switch should not trigger regeneration for unchanged files');
		assert.equal(res2.cacheHit, true);
		assert.equal(res2.aiDescription, res1.aiDescription);
	});

	test('3. File edit -> 0 AI calls on save, exactly 1 lazy AI call on next view', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		const routerUri = URI.joinPath(workspaceFolderUri, 'src/router.ts');
		const files: Record<string, string> = {
			[routerUri.toString()]: 'export const router = { version: 1 };',
		};

		let aiCallCount = 0;
		const mockCommandService = {
			executeCommand: async (cmd: string) => {
				if (cmd === 'prebase.magnus.describeFile') {
					aiCallCount++;
					return {
						text: `Router description v${aiCallCount}`,
						status: 'ready',
					};
				}
				return undefined;
			},
		} as any;

		const fileService = createMockFileService(files);
		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService as any,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = {
			id: 'n-router',
			label: 'src/router.ts',
			path: 'src/router.ts',
			kind: 'file',
		};

		// 1. First view: 1 AI call
		const res1 = await service.describeNode(node);
		assert.equal(aiCallCount, 1);
		assert.equal(res1.cacheHit, false);

		// 2. User edits file on disk and saves (IFileService emits change event)
		files[routerUri.toString()] = 'export const router = { version: 2, routes: [] };';
		fileService.emitChange(routerUri);

		// PRIVACY INVARIANT: Zero AI calls on save!
		assert.equal(aiCallCount, 1, 'Zero AI calls must be made on file save event');

		// Peek is marked dirty/not ready
		const peekDirty = service.peekCachedDescription(node);
		assert.equal(peekDirty.cached, false);

		// 3. User views node: 1 lazy AI call occurs
		const res2 = await service.describeNode(node);
		assert.equal(aiCallCount, 2, 'Lazy AI call should occur when node is viewed after edit');
		assert.equal(res2.cacheHit, false);
		assert.ok(res2.aiDescription?.includes('v2'));

		// 4. Subsequent view without edits: cache hit again
		const res3 = await service.describeNode(node);
		assert.equal(aiCallCount, 2);
		assert.equal(res3.cacheHit, true);
	});

	test('4. Unrelated file edit -> 0 extra AI calls for other nodes', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		let aiCallCount = 0;
		const mockCommandService = {
			executeCommand: async (cmd: string) => {
				if (cmd === 'prebase.magnus.describeFile') {
					aiCallCount++;
					return { text: 'Description', status: 'ready' };
				}
				return undefined;
			},
		} as any;

		const fileService = createMockFileService();
		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService as any,
			mockStorage,
			mockCommandService,
		);

		const nodeA: GraphNode = { id: 'nA', label: 'src/a.ts', path: 'src/a.ts', kind: 'file' };
		const nodeB: GraphNode = { id: 'nB', label: 'src/b.ts', path: 'src/b.ts', kind: 'file' };

		await service.describeNode(nodeA);
		await service.describeNode(nodeB);
		assert.equal(aiCallCount, 2);

		// Emit edit event ONLY for B
		fileService.emitChange(URI.joinPath(workspaceFolderUri, 'src/b.ts'));

		// Node A remains clean verified and hits cache without disk read or AI call
		const readCountBefore = fileService.readCount;
		const resA = await service.describeNode(nodeA);
		assert.equal(aiCallCount, 2, 'Node A must not trigger AI call');
		assert.equal(resA.cacheHit, true);
		assert.equal(fileService.readCount, readCountBefore, 'Node A must not read disk');
	});

	test('5. Stale in-flight race protection: discards result if file changed during in-flight generation', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		let aiCalled = false;
		let finishAiCall: ((val: any) => void) | undefined;
		const mockCommandService = {
			executeCommand: async (cmd: string) => {
				if (cmd === 'prebase.magnus.describeFile') {
					aiCalled = true;
					return new Promise(resolve => {
						finishAiCall = resolve;
					});
				}
				return undefined;
			},
		} as any;

		const fileService = createMockFileService();
		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService as any,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = { id: 'n-race', label: 'src/race.ts', path: 'src/race.ts', kind: 'file' };

		// 1. Start describeNode (in flight)
		const promise = service.describeNode(node);

		// 2. Wait until executeCommand has been invoked
		while (!aiCalled) {
			await new Promise(r => setTimeout(r, 10));
		}

		// 3. While AI is in flight, user edits file again
		fileService.emitChange(URI.joinPath(workspaceFolderUri, 'src/race.ts'));

		// 4. AI finishes with old description
		finishAiCall?.({ text: 'Stale description', status: 'ready' });
		await promise;

		// 5. Cache must NOT store the stale description as clean
		const cache = JSON.parse(storageMap.get('prebase.graph.descriptionCache.v9') || '{}');
		assert.equal(Object.keys(cache).length, 0, 'Stale description must not be saved to cache');
		assert.equal(service.peekCachedDescription(node).cached, false);
	});

	test('6. Persistence across restart and 500-node scale capacity', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		const mockCommandService = {
			executeCommand: async (cmd: string, args: any) => {
				if (cmd === 'prebase.magnus.describeFile') {
					return { text: `Description for ${args.path}`, status: 'ready' };
				}
				return undefined;
			},
		} as any;

		const fileService = createMockFileService();
		const service1 = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService as any,
			mockStorage,
			mockCommandService,
		);

		// Populate 500 nodes
		for (let i = 0; i < 500; i++) {
			const node: GraphNode = { id: `node-${i}`, label: `src/file_${i}.ts`, path: `src/file_${i}.ts`, kind: 'file' };
			await service1.describeNode(node);
		}

		// Verify 500 entries stored in v9 storage key
		const storedRaw = storageMap.get('prebase.graph.descriptionCache.v9');
		assert.ok(storedRaw, 'Storage must contain v9 cache');
		const parsed = JSON.parse(storedRaw);
		assert.equal(Object.keys(parsed).length, 500, 'Cache should hold 500 nodes without eviction');

		// Restart service with fresh in-memory instance
		const service2 = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService as any,
			mockStorage,
			mockCommandService,
		);

		// Verified clean file matches cached fingerprint without re-calling AI
		const node0: GraphNode = { id: 'node-0', label: 'src/file_0.ts', path: 'src/file_0.ts', kind: 'file' };
		const res = await service2.describeNode(node0);
		assert.equal(res.cacheHit, true);
		assert.ok(res.aiDescription?.includes('src/file_0.ts'));

		// clearCache removes all entries
		service2.clearCache();
		assert.equal(storageMap.has('prebase.graph.descriptionCache.v9'), false);
		assert.equal(service2.peekCachedDescription(node0).cached, false);
	});

	test('7. Restart freshness: external edit while closed prevents stale peek and updates on view', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		let aiCallCount = 0;
		const mockCommandService = {
			executeCommand: async (cmd: string, args: any) => {
				if (cmd === 'prebase.magnus.describeFile') {
					aiCallCount++;
					return { text: `Description v${aiCallCount} for ${args.path}`, status: 'ready' };
				}
				return undefined;
			},
		} as any;

		const fileUri = URI.joinPath(workspaceFolderUri, 'src/service.ts');
		const files: Record<string, string> = {
			[fileUri.toString()]: 'export class Service { version = 1; }',
		};
		const fileService1 = createMockFileService(files);
		const service1 = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService1 as any,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = { id: 'n-svc', label: 'src/service.ts', path: 'src/service.ts', kind: 'file' };
		await service1.describeNode(node);
		assert.equal(aiCallCount, 1);

		// Simulate app close & external file modification
		files[fileUri.toString()] = 'export class Service { version = 2; newMethod() {} }';

		// Restart app / new service instance
		const fileService2 = createMockFileService(files);
		const service2 = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService2 as any,
			mockStorage,
			mockCommandService,
		);

		// Synchronous peek on unverified node must NOT return stale cached description
		const peekResult = service2.peekCachedDescription(node);
		assert.equal(peekResult.cached, false, 'Unverified node after restart must return cached: false');

		// View node: detects changed content hash / fingerprint and triggers fresh AI description
		const describeResult = await service2.describeNode(node);
		assert.equal(aiCallCount, 2, 'External change must trigger fresh AI generation');
		assert.equal(describeResult.cacheHit, false);
		assert.ok(describeResult.aiDescription?.includes('v2'));
	});

	test('8. Prompt semantic fingerprint: layer or imports change invalidates cache', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		let aiCallCount = 0;
		const mockCommandService = {
			executeCommand: async (cmd: string, args: any) => {
				if (cmd === 'prebase.magnus.describeFile') {
					aiCallCount++;
					return { text: `Layered desc ${aiCallCount}`, status: 'ready' };
				}
				return undefined;
			},
		} as any;

		const fileService = createMockFileService();
		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService as any,
			mockStorage,
			mockCommandService,
		);

		const nodeV1: GraphNode = {
			id: 'n-arch',
			label: 'src/arch.ts',
			path: 'src/arch.ts',
			kind: 'file',
			meta: { architectureLayer: 'presentation', imports: ['react', 'monaco'] },
		};

		await service.describeNode(nodeV1);
		assert.equal(aiCallCount, 1);

		// Same content, but architecture layer changed to 'data-access' and imports changed
		const nodeV2: GraphNode = {
			id: 'n-arch',
			label: 'src/arch.ts',
			path: 'src/arch.ts',
			kind: 'file',
			meta: { architectureLayer: 'data-access', imports: ['sqlite3', 'knex'] },
		};

		// Invalidate memory verified state by marking dirty or simulating semantic node change
		const res2 = await service.describeNode(nodeV2, undefined, { force: false });
		assert.equal(aiCallCount, 2, 'Changed architecture layer / imports must produce fresh description');
		assert.equal(res2.cacheHit, false);
	});

	test('9. Multi-root workspace: events in Folder B do not invalidate Folder A', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		const folderA_Uri = URI.parse('file:///workspace/rootA');
		const folderB_Uri = URI.parse('file:///workspace/rootB');

		const folderA = { uri: folderA_Uri, name: 'rootA', index: 0, toResource: (rel: string) => URI.joinPath(folderA_Uri, rel) };
		const folderB = { uri: folderB_Uri, name: 'rootB', index: 1, toResource: (rel: string) => URI.joinPath(folderB_Uri, rel) };

		const multiRootContext = {
			getWorkspace: () => ({ folders: [folderA, folderB] }),
			getWorkspaceFolder: (uri: URI) => {
				const s = uri.toString();
				if (s.startsWith(folderA_Uri.toString())) {return folderA;}
				if (s.startsWith(folderB_Uri.toString())) {return folderB;}
				return undefined;
			},
		} as any;

		let aiCallCount = 0;
		const mockCommandService = {
			executeCommand: async (cmd: string) => {
				if (cmd === 'prebase.magnus.describeFile') {
					aiCallCount++;
					return { text: `Desc ${aiCallCount}`, status: 'ready' };
				}
				return undefined;
			},
		} as any;

		const fileService = createMockFileService();
		const service = new PreBaseGraphDescriptionService(
			multiRootContext,
			fileService as any,
			mockStorage,
			mockCommandService,
		);

		const nodeA: GraphNode = { id: 'nA', label: 'src/index.ts', path: 'src/index.ts', kind: 'file' };
		await service.describeNode(nodeA);
		assert.equal(aiCallCount, 1);

		// Emit change in folder B
		const bFileUri = URI.joinPath(folderB_Uri, 'src/index.ts');
		fileService.emitChange(bFileUri);

		// Node in folder A remains clean verified
		const resA = await service.describeNode(nodeA);
		assert.equal(aiCallCount, 1, 'Folder A node must remain cached when folder B file changes');
		assert.equal(resA.cacheHit, true);
	});

	test('10. File MOVE / COPY operations update cache accordingly', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		let aiCallCount = 0;
		const mockCommandService = {
			executeCommand: async (cmd: string, args: any) => {
				if (cmd === 'prebase.magnus.describeFile') {
					aiCallCount++;
					return { text: `Desc for ${args.path}`, status: 'ready' };
				}
				return undefined;
			},
		} as any;

		const fileService = createMockFileService();
		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService as any,
			mockStorage,
			mockCommandService,
		);

		const oldNode: GraphNode = { id: 'n-old', label: 'src/old.ts', path: 'src/old.ts', kind: 'file' };
		await service.describeNode(oldNode);
		assert.equal(aiCallCount, 1);

		// Emit MOVE operation: src/old.ts -> src/new.ts
		const srcUri = URI.joinPath(workspaceFolderUri, 'src/old.ts');
		const dstUri = URI.joinPath(workspaceFolderUri, 'src/new.ts');
		(fileService as any).emitOperation(srcUri, 2 /* FileOperation.MOVE */, { resource: dstUri });

		// Old node cache is deleted
		assert.equal(service.peekCachedDescription(oldNode).cached, false);

		// New node at new path triggers fresh description
		const newNode: GraphNode = { id: 'n-new', label: 'src/new.ts', path: 'src/new.ts', kind: 'file' };
		const resNew = await service.describeNode(newNode);
		assert.equal(aiCallCount, 2);
		assert.equal(resNew.cacheHit, false);
	});

	test('11. contentIdentity cache match returns cached description without file read or AI invocation', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		let aiCallCount = 0;
		const mockCommandService = {
			executeCommand: async (cmd: string, args: any) => {
				if (cmd === 'prebase.magnus.describeFile') {
					aiCallCount++;
					return { text: `Described ${args.path}`, status: 'ready' };
				}
				return undefined;
			},
		} as any;

		const fileService = createMockFileService({
			'file:///mock/workspace/src/sample.ts': 'export const x = 42;'
		});

		const service = new PreBaseGraphDescriptionService(
			mockWorkspaceContextService,
			fileService as any,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = { id: 'n1', label: 'src/sample.ts', path: 'src/sample.ts', kind: 'file' };
		const firstDesc = await service.describeNode(node);
		assert.equal(aiCallCount, 1);
		assert.ok(firstDesc.aiDescription);

		// Now query peekCachedDescription and describeNode with matching contentIdentity
		const peek = service.peekCachedDescription(node, { projectRoot: '/mock/workspace' });
		assert.equal(peek.cached, true);
		assert.equal(peek.description, firstDesc.aiDescription);

		const secondDesc = await service.describeNode(node, undefined, { projectRoot: '/mock/workspace' });
		assert.equal(aiCallCount, 1, 'AI must not be called on cache hit');
		assert.equal(secondDesc.cacheHit, true);
	});

	test('12. Explicit projectRoot isolates identical relative paths across workspace folders', async () => {
		const storageMap = new Map<string, string>();
		const mockStorage = {
			get: (key: string, _scope: any, def: string) => storageMap.get(key) ?? def,
			store: (key: string, val: string) => storageMap.set(key, val),
			remove: (key: string) => storageMap.delete(key),
		} as any;

		const folderA_Uri = URI.parse('file:///workspace/rootA');
		const folderB_Uri = URI.parse('file:///workspace/rootB');

		const folderA = { uri: folderA_Uri, name: 'rootA', index: 0, toResource: (rel: string) => URI.joinPath(folderA_Uri, rel) };
		const folderB = { uri: folderB_Uri, name: 'rootB', index: 1, toResource: (rel: string) => URI.joinPath(folderB_Uri, rel) };

		const multiRootContext = {
			getWorkspace: () => ({ folders: [folderA, folderB] }),
			getWorkspaceFolder: (uri: URI) => {
				const s = uri.toString();
				if (s.startsWith(folderA_Uri.toString())) {return folderA;}
				if (s.startsWith(folderB_Uri.toString())) {return folderB;}
				return undefined;
			},
		} as any;

		let aiCallCount = 0;
		const mockCommandService = {
			executeCommand: async (cmd: string, args: any) => {
				if (cmd === 'prebase.magnus.describeFile') {
					aiCallCount++;
					return { text: `Desc for ${args.path}`, status: 'ready' };
				}
				return undefined;
			},
		} as any;

		const fileService = createMockFileService();
		const service = new PreBaseGraphDescriptionService(
			multiRootContext,
			fileService as any,
			mockStorage,
			mockCommandService,
		);

		const node: GraphNode = { id: 'common', label: 'src/main.ts', path: 'src/main.ts', kind: 'file' };

		// Describe for Root A
		await service.describeNode(node, undefined, { projectRoot: '/workspace/rootA' });
		assert.equal(aiCallCount, 1);

		// Describe for Root B with same relative path -> must not reuse Root A's cache blindly without checking Root B
		await service.describeNode(node, undefined, { projectRoot: '/workspace/rootB' });
		assert.equal(aiCallCount, 2);
	});
});


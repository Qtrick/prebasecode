/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { _util } from '../../../../../../platform/instantiation/common/instantiation.js';
import { InstantiationService } from '../../../../../../platform/instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../../../../../platform/instantiation/common/serviceCollection.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IStorageService, InMemoryStorageService } from '../../../../../../platform/storage/common/storage.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IOutputService } from '../../../../../../workbench/services/output/common/output.js';
import { IGitService } from '../../../../../../workbench/contrib/git/common/gitService.js';
import { IUriIdentityService } from '../../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IEnvironmentService } from '../../../../../../platform/environment/common/environment.js';
import { IMainProcessService } from '../../../../../../platform/ipc/common/mainProcessService.js';
import { IEditorService } from '../../../../../../workbench/services/editor/common/editorService.js';
import { ILifecycleService } from '../../../../../../workbench/services/lifecycle/common/lifecycle.js';
import { IUtilityProcessWorkerWorkbenchService } from '../../../../../../workbench/services/utilityProcess/electron-browser/utilityProcessWorkerWorkbenchService.js';

import { PreBaseGraphDescriptionService } from '../../host/workbench/prebaseGraphDescriptionService.js';
import { WorkbenchGitHistoryService, IWorkbenchGitHistoryService } from '../../host/workbench/workbenchGitHistoryService.js';
import { PreBaseGraphService } from '../../host/workbench/prebaseGraphService.js';
import { WorkbenchTemporalGraphService, IPreBaseTemporalGraphService } from '../../host/workbench/workbenchTemporalGraphService.js';
import { WorkbenchTemporalViewService } from '../../host/workbench/temporal/workbenchTemporalViewService.js';
import { WorkbenchCanonicalParseService, IPreBaseCanonicalParseService } from '../../host/workbench/workbenchCanonicalParseService.js';
import { URI } from '../../../../../../base/common/uri.js';

function getDepsMap(target: any): Map<number, string> {
	const deps = _util.getServiceDependencies(target);
	const map = new Map<number, string>();
	for (const dep of deps) {
		map.set(dep.index, dep.id.toString());
	}
	return map;
}

suite('Production Dependency Injection & Decorator Metadata Truth (P0 DI Gate)', () => {

	test('1. PreBaseGraphDescriptionService has all 4 parameter decorators and DI metadata', () => {
		const deps = _util.getServiceDependencies(PreBaseGraphDescriptionService as any);
		assert.strictEqual(deps.length, 4, 'PreBaseGraphDescriptionService must have exactly 4 injected dependencies');

		const depsMap = getDepsMap(PreBaseGraphDescriptionService);
		assert.strictEqual(depsMap.get(0), IWorkspaceContextService.toString(), 'Param 0 must be IWorkspaceContextService');
		assert.strictEqual(depsMap.get(1), IFileService.toString(), 'Param 1 must be IFileService');
		assert.strictEqual(depsMap.get(2), IStorageService.toString(), 'Param 2 must be IStorageService');
		assert.strictEqual(depsMap.get(3), ICommandService.toString(), 'Param 3 must be ICommandService');
	});

	test('2. InstantiationService creates PreBaseGraphDescriptionService with resolved dependencies', () => {
		const mockWorkspace: any = {
			getWorkspace: () => ({ folders: [{ uri: URI.parse('file:///workspace'), name: 'ws', index: 0, toResource: (r: string) => URI.parse(`file:///workspace/${r}`) }] }),
			getWorkspaceFolder: () => ({ uri: URI.parse('file:///workspace'), name: 'ws', index: 0 }),
			onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
		};
		const mockFiles: any = {
			onDidFilesChange: () => ({ dispose() {} }),
			onDidRunOperation: () => ({ dispose() {} }),
			readFile: async () => ({ value: Buffer.from('export const a = 1;'), etag: '1' }),
		};
		const mockStorage = new InMemoryStorageService();
		const mockCommands: any = {
			executeCommand: async () => undefined,
			onWillExecuteCommand: () => ({ dispose() {} }),
			onDidExecuteCommand: () => ({ dispose() {} }),
		};

		const services = new ServiceCollection();
		services.set(IWorkspaceContextService, mockWorkspace);
		services.set(IFileService, mockFiles);
		services.set(IStorageService, mockStorage);
		services.set(ICommandService, mockCommands);

		const instaService = new InstantiationService(services);
		const instance = instaService.createInstance(PreBaseGraphDescriptionService);

		assert.ok(instance instanceof PreBaseGraphDescriptionService, 'Instance must be created by InstantiationService');
		assert.strictEqual(typeof instance.peekCachedDescription, 'function', 'peekCachedDescription must be accessible');
		assert.strictEqual(typeof instance.describeNode, 'function', 'describeNode must be accessible');
		instance.dispose();
	});

	test('3. WorkbenchGitHistoryService has @IGitService and @IUriIdentityService decorator metadata', () => {
		const deps = _util.getServiceDependencies(WorkbenchGitHistoryService as any);
		assert.strictEqual(deps.length, 2, 'WorkbenchGitHistoryService must have 2 injected dependencies');
		const depsMap = getDepsMap(WorkbenchGitHistoryService);
		assert.strictEqual(depsMap.get(0), IGitService.toString(), 'Param 0 must be IGitService');
		assert.strictEqual(depsMap.get(1), IUriIdentityService.toString(), 'Param 1 must be IUriIdentityService');
	});

	test('4. PreBaseGraphService has all 7 parameter decorators and DI metadata', () => {
		const deps = _util.getServiceDependencies(PreBaseGraphService as any);
		assert.strictEqual(deps.length, 7, 'PreBaseGraphService must have 7 injected dependencies');
		const depsMap = getDepsMap(PreBaseGraphService);
		assert.strictEqual(depsMap.get(0), IFileService.toString(), 'Param 0 must be IFileService');
		assert.strictEqual(depsMap.get(1), IWorkspaceContextService.toString(), 'Param 1 must be IWorkspaceContextService');
		assert.strictEqual(depsMap.get(2), IConfigurationService.toString(), 'Param 2 must be IConfigurationService');
		assert.strictEqual(depsMap.get(3), IOutputService.toString(), 'Param 3 must be IOutputService');
		assert.strictEqual(depsMap.get(4), IGitService.toString(), 'Param 4 must be IGitService');
		assert.strictEqual(depsMap.get(5), IWorkbenchGitHistoryService.toString(), 'Param 5 must be IWorkbenchGitHistoryService');
		assert.strictEqual(depsMap.get(6), IPreBaseCanonicalParseService.toString(), 'Param 6 must be IPreBaseCanonicalParseService');
	});

	test('5. WorkbenchTemporalGraphService has all 7 parameter decorators and DI metadata', () => {
		const deps = _util.getServiceDependencies(WorkbenchTemporalGraphService as any);
		assert.strictEqual(deps.length, 7, 'WorkbenchTemporalGraphService must have 7 injected dependencies');
		const depsMap = getDepsMap(WorkbenchTemporalGraphService);
		assert.strictEqual(depsMap.get(0), IWorkspaceContextService.toString(), 'Param 0 must be IWorkspaceContextService');
		assert.strictEqual(depsMap.get(1), IEnvironmentService.toString(), 'Param 1 must be IEnvironmentService');
		assert.strictEqual(depsMap.get(2), IWorkbenchGitHistoryService.toString(), 'Param 2 must be IWorkbenchGitHistoryService');
		assert.strictEqual(depsMap.get(3), IMainProcessService.toString(), 'Param 3 must be IMainProcessService');
		assert.strictEqual(depsMap.get(4), ILogService.toString(), 'Param 4 must be ILogService');
		assert.strictEqual(depsMap.get(5), IPreBaseCanonicalParseService.toString(), 'Param 5 must be IPreBaseCanonicalParseService');
		assert.strictEqual(depsMap.get(6), ILifecycleService.toString(), 'Param 6 must be ILifecycleService');
	});

	test('6. WorkbenchTemporalViewService has all 7 parameter decorators and DI metadata', () => {
		const deps = _util.getServiceDependencies(WorkbenchTemporalViewService as any);
		assert.strictEqual(deps.length, 7, 'WorkbenchTemporalViewService must have 7 injected dependencies');
		const depsMap = getDepsMap(WorkbenchTemporalViewService);
		assert.strictEqual(depsMap.get(0), IWorkspaceContextService.toString(), 'Param 0 must be IWorkspaceContextService');
		assert.strictEqual(depsMap.get(1), IWorkbenchGitHistoryService.toString(), 'Param 1 must be IWorkbenchGitHistoryService');
		assert.strictEqual(depsMap.get(2), IPreBaseTemporalGraphService.toString(), 'Param 2 must be IPreBaseTemporalGraphService');
		assert.strictEqual(depsMap.get(3), ICommandService.toString(), 'Param 3 must be ICommandService');
		assert.strictEqual(depsMap.get(4), IEditorService.toString(), 'Param 4 must be IEditorService');
		assert.strictEqual(depsMap.get(5), ILogService.toString(), 'Param 5 must be ILogService');
		assert.strictEqual(depsMap.get(6), IStorageService.toString(), 'Param 6 must be IStorageService');
	});

	test('7. WorkbenchCanonicalParseService has @IUtilityProcessWorkerWorkbenchService decorator metadata', () => {
		const deps = _util.getServiceDependencies(WorkbenchCanonicalParseService as any);
		assert.strictEqual(deps.length, 1, 'WorkbenchCanonicalParseService must have 1 injected dependency');
		const depsMap = getDepsMap(WorkbenchCanonicalParseService);
		assert.strictEqual(depsMap.get(0), IUtilityProcessWorkerWorkbenchService.toString(), 'Param 0 must be IUtilityProcessWorkerWorkbenchService');
	});
});

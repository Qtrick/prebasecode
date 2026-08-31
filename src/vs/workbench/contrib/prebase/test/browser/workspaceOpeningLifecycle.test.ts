/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Schemas } from '../../../../../base/common/network.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import {
	PREBASE_PENDING_WORKSPACE_KEY,
	PreBasePendingWorkspaceOpen,
	clearPendingWorkspaceOpen,
	readPendingWorkspaceOpen,
	storePendingWorkspaceOpen,
	workspaceOpeningStageLabel,
} from '../../browser/prebaseWorkspaceOpening.js';
import { StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';

suite('PreBase Workspace Opening Lifecycle & Dialog Routing', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	suite('Pending Workspace Open Lifecycle', () => {
		test('stores and reads valid pending workspace payload', () => {
			const storage = disposables.add(new TestStorageService());
			const now = Date.now();

			storePendingWorkspaceOpen(storage, {
				label: 'my-project',
				uri: 'file:///Users/developer/my-project',
				action: 'openFolder',
				requestedAt: now,
			});

			const retrieved = readPendingWorkspaceOpen(storage);
			assert.ok(retrieved);
			assert.strictEqual(retrieved.label, 'my-project');
			assert.strictEqual(retrieved.uri, 'file:///Users/developer/my-project');
			assert.strictEqual(retrieved.action, 'openFolder');
			assert.strictEqual(retrieved.requestedAt, now);
		});

		test('clears pending workspace marker explicitly on cancellation or cleanup', () => {
			const storage = disposables.add(new TestStorageService());

			storePendingWorkspaceOpen(storage, {
				label: 'cancelled-project',
				action: 'openFolder',
			});
			assert.ok(readPendingWorkspaceOpen(storage));

			clearPendingWorkspaceOpen(storage);
			assert.strictEqual(readPendingWorkspaceOpen(storage), undefined);
			assert.strictEqual(storage.get(PREBASE_PENDING_WORKSPACE_KEY, StorageScope.APPLICATION), undefined);
		});

		test('automatically evicts stale pending marker older than 2 minutes', () => {
			const storage = disposables.add(new TestStorageService());
			const twoMinutesOneSecondAgo = Date.now() - (2 * 60 * 1000 + 1000);

			storage.store(
				PREBASE_PENDING_WORKSPACE_KEY,
				JSON.stringify({
					label: 'stale-project',
					action: 'openFolder',
					requestedAt: twoMinutesOneSecondAgo,
				} satisfies PreBasePendingWorkspaceOpen),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE,
			);

			const retrieved = readPendingWorkspaceOpen(storage);
			assert.strictEqual(retrieved, undefined);
			// Should also clean storage on stale read
			assert.strictEqual(storage.get(PREBASE_PENDING_WORKSPACE_KEY, StorageScope.APPLICATION), undefined);
		});

		test('safely discards malformed or corrupted JSON without throwing', () => {
			const storage = disposables.add(new TestStorageService());

			storage.store(
				PREBASE_PENDING_WORKSPACE_KEY,
				'{ malformed json !!!',
				StorageScope.APPLICATION,
				StorageTarget.MACHINE,
			);

			const retrieved = readPendingWorkspaceOpen(storage);
			assert.strictEqual(retrieved, undefined);
			assert.strictEqual(storage.get(PREBASE_PENDING_WORKSPACE_KEY, StorageScope.APPLICATION), undefined);
		});

		test('safely discards payloads missing mandatory fields', () => {
			const storage = disposables.add(new TestStorageService());

			storage.store(
				PREBASE_PENDING_WORKSPACE_KEY,
				JSON.stringify({ uri: 'file:///test' }),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE,
			);

			assert.strictEqual(readPendingWorkspaceOpen(storage), undefined);
		});
	});

	suite('Stage Labels', () => {
		test('formats human-readable stages for workspace opening phases', () => {
			assert.strictEqual(workspaceOpeningStageLabel('requestingWorkspace'), 'Opening workspace');
			assert.strictEqual(workspaceOpeningStageLabel('openingWindow'), 'Opening window');
			assert.strictEqual(workspaceOpeningStageLabel('restoringWorkbench'), 'Restoring files');
			assert.strictEqual(workspaceOpeningStageLabel('workspaceReady'), 'Workspace ready');
			assert.strictEqual(workspaceOpeningStageLabel('activatingPreBase'), 'Preparing PreBase');
			assert.strictEqual(workspaceOpeningStageLabel('ready'), 'Ready');
			assert.strictEqual(workspaceOpeningStageLabel('error'), 'Opening failed');
		});
	});

	suite('Dialog Routing Decision Matrix', () => {
		function evaluateShouldUseSimplified(
			schema: string,
			simpleDialogSetting: boolean,
			enableSmokeTestDriver: boolean,
		): boolean {
			const isRealFile = schema === Schemas.file || schema === Schemas.vscodeUserData;
			return !isRealFile || simpleDialogSetting || enableSmokeTestDriver;
		}

		test('local desktop with default settings routes to OS native dialog', () => {
			const useSimplified = evaluateShouldUseSimplified(
				Schemas.file,
				false, // files.simpleDialog.enable = false (default)
				false, // enableSmokeTestDriver = false
			);
			assert.strictEqual(useSimplified, false, 'Local desktop default must use native OS dialog');
		});

		test('local desktop with explicit user setting routes to simplified dialog', () => {
			const useSimplified = evaluateShouldUseSimplified(
				Schemas.file,
				true, // files.simpleDialog.enable = true (user opted in)
				false,
			);
			assert.strictEqual(useSimplified, true, 'User opt-in must respect simple dialog setting');
		});

		test('smoke test driver / automation harness routes to simplified dialog', () => {
			const useSimplified = evaluateShouldUseSimplified(
				Schemas.file,
				false,
				true, // enableSmokeTestDriver = true
			);
			assert.strictEqual(useSimplified, true, 'Automation driver must use simple dialog for CDP');
		});

		test('remote filesystems route to simplified/remote picker', () => {
			const useSimplified = evaluateShouldUseSimplified(
				Schemas.vscodeRemote,
				false,
				false,
			);
			assert.strictEqual(useSimplified, true, 'Remote filesystem cannot open local native Finder');
		});

		test('virtual filesystems route to simplified picker', () => {
			const useSimplified = evaluateShouldUseSimplified(
				'vscode-vfs',
				false,
				false,
			);
			assert.strictEqual(useSimplified, true, 'Virtual filesystem must use simplified picker');
		});
	});
});

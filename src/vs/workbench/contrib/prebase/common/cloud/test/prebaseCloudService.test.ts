/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../../../base/test/common/utils.js";
import assert from 'assert';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Event } from '../../../../../../base/common/event.js';
import type { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import type { ILogService } from '../../../../../../platform/log/common/log.js';
import type { IProductService } from '../../../../../../platform/product/common/productService.js';
import type { IRequestService } from '../../../../../../platform/request/common/request.js';
import type { ISecretStorageService } from '../../../../../../platform/secrets/common/secrets.js';
import { PreBaseCloudService } from '../../../browser/cloud/prebaseCloudService.js';
import type { PreBaseSupabaseAuthClient } from '../../../browser/cloud/prebaseSupabaseAuthClient.js';

suite('PreBaseCloudService session concurrency', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	test('a failed stale refresh cannot clear a replacement sign-in session', async () => {
		const secrets = new Map<string, string>();
		const secretStorage = Object.assign(Object.create(null), {
			get: async (key: string) => secrets.get(key),
			set: async (key: string, value: string) => { secrets.set(key, value); },
			delete: async (key: string) => { secrets.delete(key); },
		}) as ISecretStorageService;
		const configuration = Object.assign(Object.create(null), {
			getValue: (key: string) => key === 'prebase.cloud.url' ? 'https://example.supabase.co' : 'sb_publishable_test',
			onDidChangeConfiguration: Event.None,
		}) as IConfigurationService;
		const logService = Object.assign(Object.create(null), { warn: () => {} }) as ILogService;
		const service = new PreBaseCloudService(
			configuration,
			Object.create(null) as IProductService,
			Object.create(null) as IRequestService,
			secretStorage,
			logService,
		);
		await service.getSessionAdapter().write({ accessToken: 'old-access', refreshToken: 'old-refresh' });

		let rejectRefresh: ((error: Error) => void) | undefined;
		let refreshStarted: (() => void) | undefined;
		const started = new Promise<void>(resolve => refreshStarted = resolve);
		const failedRefresh = new Promise<never>((_resolve, reject) => rejectRefresh = reject);
		const client = Object.assign(Object.create(null), {
			getUser: async () => undefined,
			refreshSession: async () => {
				refreshStarted?.();
				return failedRefresh;
			},
		}) as PreBaseSupabaseAuthClient;
		service.getAuthClient = () => client;

		const refreshing = service.refreshAccessTokenIfNeeded(CancellationToken.None);
		await started;
		await service.getSessionAdapter().write({ accessToken: 'new-access', refreshToken: 'new-refresh' });
		rejectRefresh?.(new Error('old refresh rejected'));
		assert.strictEqual(await refreshing, undefined);
		assert.deepStrictEqual(await service.getSessionAdapter().read(), {
			accessToken: 'new-access',
			refreshToken: 'new-refresh',
		});
		service.dispose();
	});
});

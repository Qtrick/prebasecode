/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { VSBuffer, newWriteableBufferStream } from '../../../../../base/common/buffer.js';
import type { IRequestContext, IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import type { IRequestService } from '../../../../../platform/request/common/request.js';
import type { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import type { IPreBaseCloudService } from '../../browser/cloud/prebaseCloudService.js';
import type { IPreBaseCloudAuthConfig } from '../../common/cloud/cloudTypes.js';
import { PreBaseAgentGatewayService } from '../../browser/prebaseAgentGatewayService.js';

function requestContextWithJson(statusCode: number, data: object): IRequestContext {
	const stream = newWriteableBufferStream();
	const bytes = new TextEncoder().encode(JSON.stringify(data));
	stream.end(VSBuffer.wrap(bytes));
	return {
		res: { headers: { 'content-type': 'application/json' }, statusCode },
		stream,
	};
}

suite('PreBaseAgentGatewayService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('sends authenticated generation request to agent-gateway', async () => {
		const requests: IRequestOptions[] = [];
		const requestService = upcastPartial<IRequestService>({
			request: async options => {
				requests.push(options);
				return requestContextWithJson(200, {
					model: 'gemini-2.5-flash',
					text: 'Generated reply text',
				});
			},
		});

		const configurationService = upcastPartial<IConfigurationService>({
			getValue: <T>(...args: unknown[]): T => {
				const key = typeof args[0] === 'string' ? args[0] : '';
				if (key === 'prebase.magnus.enabled') {
					return true as T;
				}
				return undefined as T;
			},
		});

		const cloudConfig: IPreBaseCloudAuthConfig = {
			mode: 'supabase',
			supabaseUrl: 'https://test-project.supabase.co',
			publishableKey: 'sb-pub-key-12345',
		};

		const cloudService = upcastPartial<IPreBaseCloudService>({
			getAuthConfig: () => cloudConfig,
			refreshAccessTokenIfNeeded: async () => 'test-user-jwt-token',
		});

		const service = new PreBaseAgentGatewayService(requestService, configurationService, cloudService);
		const result = await service.generate(
			{
				model: 'gemini-2.5-flash',
				contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
			},
			CancellationToken.None,
		);

		assert.strictEqual(result.text, 'Generated reply text');
		assert.strictEqual(requests.length, 1);
		assert.strictEqual(requests[0].url, 'https://test-project.supabase.co/functions/v1/agent-gateway');
		assert.strictEqual(requests[0].headers?.['Authorization'], 'Bearer test-user-jwt-token');
		assert.strictEqual(requests[0].headers?.['apikey'], 'sb-pub-key-12345');
	});

	test('discovers hosted models with normalized capabilities', async () => {
		const requests: IRequestOptions[] = [];
		const requestService = upcastPartial<IRequestService>({
			request: async options => {
				requests.push(options);
				return requestContextWithJson(200, {
					models: [
						{
							id: 'gemini-2.5-flash',
							displayName: 'Gemini 2.5 Flash',
							description: 'Fast model',
							inputTokenLimit: 1000000,
							outputTokenLimit: 65536,
							agentCompatible: true,
							descriptionCompatible: true,
						},
					],
				});
			},
		});

		const configurationService = upcastPartial<IConfigurationService>({
			getValue: <T>(): T => true as T,
		});

		const cloudService = upcastPartial<IPreBaseCloudService>({
			getAuthConfig: () => ({
				mode: 'supabase',
				supabaseUrl: 'https://test-project.supabase.co',
				publishableKey: 'sb-pub-key-12345',
			}),
			refreshAccessTokenIfNeeded: async () => 'test-jwt',
		});

		const service = new PreBaseAgentGatewayService(requestService, configurationService, cloudService);
		const models = await service.discoverModels(CancellationToken.None);

		assert.strictEqual(models.length, 1);
		assert.strictEqual(models[0].id, 'gemini-2.5-flash');
		assert.strictEqual(models[0].agentCompatible, true);
		assert.strictEqual(requests[0].url, 'https://test-project.supabase.co/functions/v1/agent-gateway/models');
	});

	test('fails closed when not signed in', async () => {
		const requestService = upcastPartial<IRequestService>({
			request: async () => requestContextWithJson(200, {}),
		});

		const configurationService = upcastPartial<IConfigurationService>({
			getValue: <T>(): T => true as T,
		});

		const cloudService = upcastPartial<IPreBaseCloudService>({
			getAuthConfig: () => ({
				mode: 'supabase',
				supabaseUrl: 'https://test-project.supabase.co',
				publishableKey: 'sb-pub-key',
			}),
			refreshAccessTokenIfNeeded: async () => undefined,
		});

		const service = new PreBaseAgentGatewayService(requestService, configurationService, cloudService);
		await assert.rejects(
			async () => await service.generate({ model: 'gemini-2.5-flash' }, CancellationToken.None),
			/Sign in to PreBase Cloud before using hosted AI/
		);
	});
});

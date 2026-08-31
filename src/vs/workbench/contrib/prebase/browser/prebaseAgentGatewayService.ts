/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { asText, IRequestService } from '../../../../platform/request/common/request.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IPreBaseCloudService } from './cloud/prebaseCloudService.js';

export const IPreBaseAgentGatewayService = createDecorator<IPreBaseAgentGatewayService>('prebaseAgentGatewayService');

export interface IPreBaseAgentGatewayService {
	readonly _serviceBrand: undefined;
	generate(payload: Record<string, unknown>, token: CancellationToken): Promise<Record<string, unknown>>;
	discoverModels(token: CancellationToken): Promise<Array<{ id: string; displayName: string; description: string; inputTokenLimit: number; outputTokenLimit: number; agentCompatible: boolean; descriptionCompatible: boolean }>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class PreBaseAgentGatewayService implements IPreBaseAgentGatewayService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IPreBaseCloudService private readonly cloudService: IPreBaseCloudService,
	) { }

	async generate(payload: Record<string, unknown>, token: CancellationToken): Promise<Record<string, unknown>> {
		if (this.configurationService.getValue<boolean>('prebase.magnus.enabled') === false) {
			throw new Error('Agents is disabled in settings.');
		}

		const config = this.cloudService.getAuthConfig();
		if (config.mode !== 'supabase' || !config.supabaseUrl || !config.publishableKey) {
			throw new Error('Sign in to configured PreBase Cloud before using hosted AI.');
		}

		const accessToken = await this.cloudService.refreshAccessTokenIfNeeded(token);
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		if (!accessToken) {
			throw new Error('Sign in to PreBase Cloud before using hosted AI.');
		}

		const context = await this.requestService.request({
			type: 'POST',
			url: `${config.supabaseUrl}/functions/v1/agent-gateway`,
			data: JSON.stringify(payload),
			headers: {
				Authorization: `Bearer ${accessToken}`,
				apikey: config.publishableKey,
				'Content-Type': 'application/json',
				'x-request-id': crypto.randomUUID(),
			},
			timeout: 45_000,
			callSite: 'PreBaseAgentGatewayService.generate',
		}, token);

		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}

		const status = context.res.statusCode ?? 0;
		const text = (await asText(context)) || '';
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			throw new Error('Hosted agent gateway returned an invalid response.');
		}

		if (status < 200 || status >= 300 || !isRecord(body)) {
			const code = isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${status}`;
			const message = isRecord(body) && typeof body.message === 'string' ? body.message : `Hosted generation failed (${code}).`;
			throw new Error(message);
		}

		return body;
	}

	async discoverModels(token: CancellationToken): Promise<Array<{ id: string; displayName: string; description: string; inputTokenLimit: number; outputTokenLimit: number; agentCompatible: boolean; descriptionCompatible: boolean }>> {
		const config = this.cloudService.getAuthConfig();
		if (config.mode !== 'supabase' || !config.supabaseUrl || !config.publishableKey) {
			throw new Error('Sign in to configured PreBase Cloud before discovering hosted models.');
		}

		const accessToken = await this.cloudService.refreshAccessTokenIfNeeded(token);
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		if (!accessToken) {
			throw new Error('Sign in to PreBase Cloud before discovering hosted models.');
		}

		const context = await this.requestService.request({
			type: 'GET',
			url: `${config.supabaseUrl}/functions/v1/agent-gateway/models`,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				apikey: config.publishableKey,
				'Content-Type': 'application/json',
				'x-request-id': crypto.randomUUID(),
			},
			timeout: 15_000,
			callSite: 'PreBaseAgentGatewayService.discoverModels',
		}, token);

		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}

		const status = context.res.statusCode ?? 0;
		const text = (await asText(context)) || '';
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			throw new Error('Hosted agent gateway returned invalid model list.');
		}

		if (status < 200 || status >= 300 || !isRecord(body)) {
			throw new Error(`Hosted model discovery failed (HTTP ${status}).`);
		}

		const rawModels = Array.isArray(body.models) ? body.models : [];
		return rawModels.flatMap(m => {
			if (!isRecord(m) || typeof m.id !== 'string') {
				return [];
			}
			return [{
				id: m.id,
				displayName: typeof m.displayName === 'string' ? m.displayName : m.id,
				description: typeof m.description === 'string' ? m.description : '',
				inputTokenLimit: typeof m.inputTokenLimit === 'number' ? m.inputTokenLimit : 1_000_000,
				outputTokenLimit: typeof m.outputTokenLimit === 'number' ? m.outputTokenLimit : 65_536,
				agentCompatible: m.agentCompatible === true,
				descriptionCompatible: m.descriptionCompatible === true,
			}];
		});
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { asText, IRequestService } from '../../../../../platform/request/common/request.js';
import type { Json } from '../../common/cloud/generated/database.types.js';
import { buildSupabaseRestUrl } from '../../common/cloud/supabaseAuthRest.js';

export class PreBasePreferencesRepository {
	constructor(
		private readonly supabaseUrl: string,
		private readonly publishableKey: string,
		private readonly requestService: IRequestService,
	) { }

	async fetchOwnPreferences(userId: string, accessToken: string, cancel: CancellationToken): Promise<Json | undefined> {
		const url = `${buildSupabaseRestUrl(this.supabaseUrl, 'user_preferences')}?user_id=eq.${encodeURIComponent(userId)}&select=preferences`;
		const context = await this.requestService.request({
			type: 'GET',
			url,
			headers: {
				apikey: this.publishableKey,
				Authorization: `Bearer ${accessToken}`,
			},
			timeout: 15000,
			callSite: 'PreBasePreferencesRepository.fetchOwnPreferences',
		}, cancel);
		if (cancel.isCancellationRequested) {
			return undefined;
		}
		const status = context.res.statusCode ?? 0;
		if (status < 200 || status >= 300) {
			return undefined;
		}
		const text = (await asText(context)) || '';
		try {
			const rows = JSON.parse(text) as { preferences?: Json }[];
			return rows[0]?.preferences;
		} catch {
			return undefined;
		}
	}

	async upsertOwnPreferences(
		userId: string,
		accessToken: string,
		preferences: Json,
		schemaVersion: number,
		cancel: CancellationToken,
	): Promise<void> {
		const body = JSON.stringify({
			user_id: userId,
			preferences,
			schema_version: schemaVersion,
		});
		const context = await this.requestService.request({
			type: 'POST',
			url: buildSupabaseRestUrl(this.supabaseUrl, 'user_preferences'),
			data: body,
			headers: {
				apikey: this.publishableKey,
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				Prefer: 'resolution=merge-duplicates',
			},
			timeout: 15000,
			callSite: 'PreBasePreferencesRepository.upsertOwnPreferences',
		}, cancel);
		if (cancel.isCancellationRequested) {
			return;
		}
		const status = context.res.statusCode ?? 0;
		if (status < 200 || status >= 300) {
			return;
		}
	}
}

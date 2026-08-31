/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { asText, IRequestService } from '../../../../../platform/request/common/request.js';
import { buildSupabaseRestUrl } from '../../common/cloud/supabaseAuthRest.js';

export interface IPreBaseProfileRow {
	id: string;
	display_name: string | null;
	avatar_url: string | null;
}

export class PreBaseProfileRepository {
	constructor(
		private readonly supabaseUrl: string,
		private readonly publishableKey: string,
		private readonly requestService: IRequestService,
	) { }

	async fetchProfile(userId: string, accessToken: string, cancel: CancellationToken): Promise<IPreBaseProfileRow | undefined> {
		const url = `${buildSupabaseRestUrl(this.supabaseUrl, 'profiles')}?id=eq.${encodeURIComponent(userId)}&select=id,display_name,avatar_url`;
		const context = await this.requestService.request({
			type: 'GET',
			url,
			headers: {
				apikey: this.publishableKey,
				Authorization: `Bearer ${accessToken}`,
			},
			timeout: 15000,
			callSite: 'PreBaseProfileRepository.fetchProfile',
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
			const rows = JSON.parse(text) as IPreBaseProfileRow[];
			return rows[0];
		} catch {
			return undefined;
		}
	}

	async upsertProfile(
		userId: string,
		accessToken: string,
		fields: { displayName?: string; avatarUrl?: string },
		cancel: CancellationToken,
	): Promise<void> {
		const body = JSON.stringify({
			id: userId,
			display_name: fields.displayName ?? null,
			avatar_url: fields.avatarUrl ?? null,
		});
		const context = await this.requestService.request({
			type: 'POST',
			url: buildSupabaseRestUrl(this.supabaseUrl, 'profiles'),
			data: body,
			headers: {
				apikey: this.publishableKey,
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				Prefer: 'resolution=merge-duplicates',
			},
			timeout: 15000,
			callSite: 'PreBaseProfileRepository.upsertProfile',
		}, cancel);
		if (cancel.isCancellationRequested) {
			return;
		}
		const status = context.res.statusCode ?? 0;
		if (status < 200 || status >= 300) {
			// Non-fatal for sign-in; RLS or network may fail without blocking local session.
			return;
		}
	}
}

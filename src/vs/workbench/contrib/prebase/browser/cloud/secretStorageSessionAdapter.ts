/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Single source of truth for account/cloud session secrets (ISecretStorageService only). */
export const PREBASE_ACCOUNT_SECRET_ACCESS = 'prebase.account.accessToken';
export const PREBASE_ACCOUNT_SECRET_REFRESH = 'prebase.account.refreshToken';

export interface IPreBaseCloudSessionSecrets {
	accessToken: string;
	refreshToken?: string;
}

export class PreBaseCloudSessionAdapter {
	constructor(private readonly secretStorageService: { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void> }) { }

	async read(): Promise<IPreBaseCloudSessionSecrets | undefined> {
		const accessToken = await this.secretStorageService.get(PREBASE_ACCOUNT_SECRET_ACCESS);
		if (!accessToken) {
			return undefined;
		}
		const refreshToken = await this.secretStorageService.get(PREBASE_ACCOUNT_SECRET_REFRESH);
		return { accessToken, refreshToken };
	}

	async write(session: IPreBaseCloudSessionSecrets): Promise<void> {
		await this.secretStorageService.set(PREBASE_ACCOUNT_SECRET_ACCESS, session.accessToken);
		if (session.refreshToken) {
			await this.secretStorageService.set(PREBASE_ACCOUNT_SECRET_REFRESH, session.refreshToken);
		} else {
			await this.secretStorageService.delete(PREBASE_ACCOUNT_SECRET_REFRESH);
		}
	}

	async clear(): Promise<void> {
		await this.secretStorageService.delete(PREBASE_ACCOUNT_SECRET_ACCESS);
		await this.secretStorageService.delete(PREBASE_ACCOUNT_SECRET_REFRESH);
	}
}

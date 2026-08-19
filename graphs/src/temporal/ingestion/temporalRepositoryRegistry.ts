/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ITemporalStore } from '../persistence/common/temporalStore.js';
import { TemporalError } from '../common/temporalErrors.js';

export type TemporalStoreFactory = (repositoryId: string, rootPath: string) => Promise<ITemporalStore>;

export class TemporalRepositoryRegistry {
	private readonly _stores = new Map<string, ITemporalStore>();
	private readonly _storeFactory: TemporalStoreFactory;

	constructor(storeFactory: TemporalStoreFactory) {
		this._storeFactory = storeFactory;
	}

	async getStore(repositoryId: string, rootPath: string): Promise<ITemporalStore> {
		const existing = this._stores.get(repositoryId);
		if (existing) {
			if (!existing.isOpen()) {
				await existing.open();
			}
			return existing;
		}

		try {
			const store = await this._storeFactory(repositoryId, rootPath);
			if (!store.isOpen()) {
				await store.open();
			}
			this._stores.set(repositoryId, store);
			return store;
		} catch (err) {
			throw new TemporalError(
				'RepositoryNotFound',
				`Failed to initialize temporal store for repository '${repositoryId}' at '${rootPath}'`,
				err
			);
		}
	}

	hasStore(repositoryId: string): boolean {
		return this._stores.has(repositoryId);
	}

	async closeStore(repositoryId: string): Promise<void> {
		const store = this._stores.get(repositoryId);
		if (store) {
			await store.close();
			this._stores.delete(repositoryId);
		}
	}

	async closeAll(): Promise<void> {
		for (const store of this._stores.values()) {
			await store.close();
		}
		this._stores.clear();
	}
}

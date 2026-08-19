/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ITemporalStore } from '../persistence/common/temporalStore.js';
import type { IGitHistoryService } from '../../history/git/gitHistoryService.js';
import { TemporalRepositoryRuntime } from './temporalRepositoryRuntime.js';
import { TemporalError } from '../common/temporalErrors.js';

export type TemporalStoreFactory = (repositoryId: string, rootPath: string) => Promise<ITemporalStore>;

export class TemporalRepositoryRegistry {
	private readonly _stores = new Map<string, ITemporalStore>();
	private readonly _runtimes = new Map<string, TemporalRepositoryRuntime>();
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

	async getRuntime(repositoryId: string, rootPath: string, gitService: IGitHistoryService): Promise<TemporalRepositoryRuntime> {
		const existing = this._runtimes.get(repositoryId);
		if (existing) {
			return existing;
		}

		const store = await this.getStore(repositoryId, rootPath);
		const runtime = new TemporalRepositoryRuntime(repositoryId, rootPath, store, gitService);
		this._runtimes.set(repositoryId, runtime);
		return runtime;
	}

	hasStore(repositoryId: string): boolean {
		return this._stores.has(repositoryId);
	}

	hasRuntime(repositoryId: string): boolean {
		return this._runtimes.has(repositoryId);
	}

	async closeStore(repositoryId: string): Promise<void> {
		const runtime = this._runtimes.get(repositoryId);
		if (runtime) {
			await runtime.dispose();
			this._runtimes.delete(repositoryId);
		}
		const store = this._stores.get(repositoryId);
		if (store) {
			await store.close();
			this._stores.delete(repositoryId);
		}
	}

	async closeAll(): Promise<void> {
		for (const runtime of this._runtimes.values()) {
			await runtime.dispose();
		}
		this._runtimes.clear();

		for (const store of this._stores.values()) {
			await store.close();
		}
		this._stores.clear();
	}

	async dispose(): Promise<void> {
		await this.closeAll();
	}
}

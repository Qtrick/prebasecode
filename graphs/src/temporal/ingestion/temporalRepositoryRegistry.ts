/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ITemporalStore } from '../persistence/common/temporalStore.js';
import type { IGitHistoryService } from '../../history/git/gitHistoryService.js';
import { TemporalRepositoryRuntime } from './temporalRepositoryRuntime.js';
import { TemporalError } from '../common/temporalErrors.js';
import type { ICanonicalParseService } from '../../core/canonical/canonicalParseService.js';

export type TemporalStoreFactory = (repositoryId: string, rootPath: string) => Promise<ITemporalStore>;

export class TemporalRepositoryRegistry {
	private readonly _stores = new Map<string, ITemporalStore>();
	private readonly _runtimes = new Map<string, TemporalRepositoryRuntime>();
	private readonly _storeCreations = new Map<string, Promise<ITemporalStore>>();
	private readonly _runtimeCreations = new Map<string, Promise<TemporalRepositoryRuntime>>();
	private readonly _storeFactory: TemporalStoreFactory;
	private readonly _parseService?: ICanonicalParseService;
	private _closing = false;

	constructor(storeFactory: TemporalStoreFactory, parseService?: ICanonicalParseService) {
		this._storeFactory = storeFactory;
		this._parseService = parseService;
	}

	async getStore(repositoryId: string, rootPath: string): Promise<ITemporalStore> {
		if (this._closing) {
			throw new TemporalError('Cancelled', `Temporal registry is shutting down`);
		}
		const existing = this._stores.get(repositoryId);
		if (existing) {
			if (!existing.isOpen()) {
				await existing.open();
			}
			return existing;
		}
		const pending = this._storeCreations.get(repositoryId);
		if (pending) {
			return pending;
		}

		const creation = this._createStore(repositoryId, rootPath);
		this._storeCreations.set(repositoryId, creation);
		try {
			return await creation;
		} finally {
			if (this._storeCreations.get(repositoryId) === creation) {
				this._storeCreations.delete(repositoryId);
			}
		}
	}

	async getRuntime(repositoryId: string, rootPath: string, gitService: IGitHistoryService): Promise<TemporalRepositoryRuntime> {
		if (this._closing) {
			throw new TemporalError('Cancelled', `Temporal registry is shutting down`);
		}
		const existing = this._runtimes.get(repositoryId);
		if (existing) {
			return existing;
		}
		const pending = this._runtimeCreations.get(repositoryId);
		if (pending) {
			return pending;
		}

		const creation = this._createRuntime(repositoryId, rootPath, gitService);
		this._runtimeCreations.set(repositoryId, creation);
		try {
			return await creation;
		} finally {
			if (this._runtimeCreations.get(repositoryId) === creation) {
				this._runtimeCreations.delete(repositoryId);
			}
		}
	}

	private async _createStore(repositoryId: string, rootPath: string): Promise<ITemporalStore> {
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

	private async _createRuntime(repositoryId: string, rootPath: string, gitService: IGitHistoryService): Promise<TemporalRepositoryRuntime> {
		const store = await this.getStore(repositoryId, rootPath);
		const runtime = new TemporalRepositoryRuntime(repositoryId, rootPath, store, gitService, this._parseService);
		if (this._closing) {
			await runtime.dispose();
			throw new TemporalError('Cancelled', `Temporal registry is shutting down`);
		}
		this._runtimes.set(repositoryId, runtime);
		return runtime;
	}

	hasStore(repositoryId: string): boolean {
		return this._stores.has(repositoryId);
	}

	hasRuntime(repositoryId: string): boolean {
		return this._runtimes.has(repositoryId);
	}

	getExistingRuntime(repositoryId: string): TemporalRepositoryRuntime | undefined {
		return this._runtimes.get(repositoryId);
	}

	async closeStore(repositoryId: string): Promise<void> {
		const runtime = this._runtimes.get(repositoryId);
		if (runtime) {
			await runtime.dispose();
			this._runtimes.delete(repositoryId);
		}
		const store = this._stores.get(repositoryId);
		if (store) {
			// Runtime disposal owns its store close. Closing it again can race native
			// SQLite teardown and violates the store lifecycle contract.
			if (!runtime || runtime.store !== store) {
				await store.close();
			}
			this._stores.delete(repositoryId);
		}
	}

	/**
	 * Closes the runtime and store associated with a repository root. Workbench
	 * close events identify repositories by root URI while this registry owns
	 * entries by stable Git repository ID, so callers must not use a URI string
	 * as a repository ID.
	 */
	async closeStoreByRootPath(rootPath: string): Promise<void> {
		for (const [repositoryId, runtime] of this._runtimes) {
			if (runtime.rootPath === rootPath) {
				await this.closeStore(repositoryId);
				return;
			}
		}
	}

	async closeAll(): Promise<void> {
		this._closing = true;
		const inflight = [...this._storeCreations.values(), ...this._runtimeCreations.values()];
		await Promise.allSettled(inflight);

		const runtimes = [...this._runtimes.values()];
		this._runtimes.clear();
		const closedByRuntime = new Set<ITemporalStore>();
		// Independent per-repository stores; dispose concurrently so N roots do not
		// stack per-runtime timeouts into a multi-minute workbench shutdown.
		await Promise.all(runtimes.map(async runtime => {
			await runtime.dispose();
			closedByRuntime.add(runtime.store);
		}));

		await Promise.all([...this._stores.values()].map(async store => {
			if (!closedByRuntime.has(store)) {
				await store.close();
			}
		}));
		this._stores.clear();
	}

	async dispose(): Promise<void> {
		await this.closeAll();
	}
}

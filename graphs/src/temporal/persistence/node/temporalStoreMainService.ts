/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ITemporalStore } from '../common/temporalStore.js';
import { deserializeTemporalStoreValue, serializeTemporalStoreValue, type ITemporalStoreMainService } from '../common/temporalStoreChannel.js';
import { SqliteTemporalStore } from './sqliteTemporalStore.js';

type StoreArguments = readonly unknown[];

function isSymbolicLink(candidate: string): boolean {
	try {
		return fs.lstatSync(candidate).isSymbolicLink();
	} catch {
		return false;
	}
}

export class TemporalStoreMainService extends Disposable implements ITemporalStoreMainService {
	private readonly _stores = new Map<string, SqliteTemporalStore>();
	private readonly _storageRoot: string;

	constructor(storageRoot: string) {
		super();
		fs.mkdirSync(storageRoot, { recursive: true });
		this._storageRoot = fs.realpathSync(storageRoot);
	}

	private _validateDbPath(dbPath: string): string {
		const storageRoot = path.resolve(this._storageRoot);
		const resolvedPath = path.resolve(dbPath);
		let resolvedParent: string;
		try {
			resolvedParent = fs.realpathSync(path.dirname(resolvedPath));
		} catch {
			throw new Error('Temporal store path is outside the authorized cache directory');
		}
		const canonicalPath = path.join(resolvedParent, path.basename(resolvedPath));
		if (resolvedParent !== storageRoot || path.extname(canonicalPath) !== '.db' || isSymbolicLink(resolvedPath)) {
			throw new Error('Temporal store path is outside the authorized cache directory');
		}
		return canonicalPath;
	}

	async open(dbPath: string): Promise<void> {
		dbPath = this._validateDbPath(dbPath);
		let store = this._stores.get(dbPath);
		if (!store) {
			store = new SqliteTemporalStore({ dbPath });
			this._stores.set(dbPath, store);
		}
		if (!store.isOpen()) {
			try {
				await store.open();
			} catch (error) {
				this._stores.delete(dbPath);
				throw error;
			}
		}
	}

	async close(dbPath: string): Promise<void> {
		dbPath = this._validateDbPath(dbPath);
		const store = this._stores.get(dbPath);
		if (!store) {
			return;
		}
		this._stores.delete(dbPath);
		await store.close();
	}

	async invoke(dbPath: string, method: string, argumentsJson: string): Promise<string> {
		dbPath = this._validateDbPath(dbPath);
		const store = this._stores.get(dbPath);
		if (!store?.isOpen()) {
			throw new Error('Temporal store is not open');
		}
		const args = deserializeTemporalStoreValue<StoreArguments>(argumentsJson);
		const result = await this._invokeStore(store, method as keyof ITemporalStore, args);
		return serializeTemporalStoreValue(result);
	}

	private async _invokeStore(store: SqliteTemporalStore, method: keyof ITemporalStore, args: StoreArguments): Promise<unknown> {
		switch (method) {
			case 'setRepositoryIdentity': return store.setRepositoryIdentity(args[0] as Parameters<ITemporalStore['setRepositoryIdentity']>[0]);
			case 'getRepositoryIdentity': return store.getRepositoryIdentity();
			case 'saveCommitIngestion': return store.saveCommitIngestion(
				args[0] as Parameters<ITemporalStore['saveCommitIngestion']>[0],
				args[1] as Parameters<ITemporalStore['saveCommitIngestion']>[1],
				args[2] as Parameters<ITemporalStore['saveCommitIngestion']>[2],
				args[3] as Parameters<ITemporalStore['saveCommitIngestion']>[3],
			);
			case 'getCommit': return store.getCommit(args[0] as string);
			case 'getAllCommits': return store.getAllCommits();
			case 'getLatestCommit': return store.getLatestCommit();
			case 'getCommitParents': return store.getCommitParents(args[0] as string);
			case 'getCommitChildren': return store.getCommitChildren(args[0] as string);
			case 'getCheckpointSnapshot': return store.getCheckpointSnapshot(args[0] as string);
			case 'getStructuralDelta': return store.getStructuralDelta(args[0] as string);
			case 'getGraphStateByDigest': return store.getGraphStateByDigest(args[0] as string);
			case 'getEntity': return store.getEntity(args[0] as string);
			case 'getEntityHistory': return store.getEntityHistory(args[0] as string);
			case 'getEntityLineageEvents': return store.getEntityLineageEvents(args[0] as string);
			case 'getActiveEntitiesAtCommit': return store.getActiveEntitiesAtCommit(args[0] as string);
			case 'getDeletedPathsInHistory': return store.getDeletedPathsInHistory(args[0] as string);
			case 'getEdge': return store.getEdge(args[0] as string);
			case 'getEdgeHistory': return store.getEdgeHistory(args[0] as string);
			case 'saveRef': return store.saveRef(args[0] as Parameters<ITemporalStore['saveRef']>[0]);
			case 'replaceRefs': return store.replaceRefs(args[0] as Parameters<ITemporalStore['replaceRefs']>[0]);
			case 'getRef': return store.getRef(args[0] as string);
			case 'getAllRefs': return store.getAllRefs();
			case 'getBlobAnalysis': return store.getBlobAnalysis(args[0] as string, args[1] as number, args[2] as number, args[3] as string);
			case 'saveBlobAnalysis': return store.saveBlobAnalysis(args[0] as Parameters<ITemporalStore['saveBlobAnalysis']>[0]);
			case 'vacuum': return store.vacuum();
			case 'clear': return store.clear();
			default: throw new Error(`Unsupported Temporal store method '${String(method)}'`);
		}
	}

	override dispose(): void {
		for (const store of this._stores.values()) {
			void store.close();
		}
		this._stores.clear();
		super.dispose();
	}
}

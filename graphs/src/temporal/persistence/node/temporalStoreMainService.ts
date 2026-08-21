/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ITemporalStore } from '../common/temporalStore.js';
import { deserializeTemporalStoreValue, serializeTemporalStoreValue, type ITemporalStoreMainService, type TemporalStoreIpcResponse } from '../common/temporalStoreChannel.js';
import { SqliteTemporalStore } from './sqliteTemporalStore.js';
import { isTemporalError, TemporalError } from '../../common/temporalErrors.js';

type StoreArguments = readonly unknown[];

function isSymbolicLink(candidate: string): boolean {
	try {
		return fs.lstatSync(candidate).isSymbolicLink();
	} catch {
		return false;
	}
}

export class TemporalStoreMainService extends Disposable implements ITemporalStoreMainService {
	private static readonly MAX_QUARANTINE_GENERATIONS = 3;
	private readonly _stores = new Map<string, SqliteTemporalStore>();
	private readonly _recoveryAttempted = new Set<string>();
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

	async open(dbPath: string): Promise<string> {
		return this._toIpcResponse(() => this._open(dbPath));
	}

	private async _open(dbPath: string): Promise<void> {
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
				if (!this._isRecoverableCorruption(error) || this._recoveryAttempted.has(dbPath)) {
					throw error;
				}
				this._recoveryAttempted.add(dbPath);
				await store.close().catch(() => undefined);
				this._quarantineDatabase(dbPath);
				store = new SqliteTemporalStore({ dbPath });
				try {
					await store.open();
					this._stores.set(dbPath, store);
					this._recoveryAttempted.delete(dbPath);
				} catch (freshError) {
					this._stores.delete(dbPath);
					throw freshError;
				}
			}
		}
	}

	private _isRecoverableCorruption(error: unknown): boolean {
		if (isTemporalError(error)) {
			return error.code === 'DatabaseCorrupted';
		}
		// sqlite3 callback failures can surface after a successful integrity check
		// without going through a JSON decoder that already wraps them. Treat only
		// SQLite's documented corruption/not-a-database codes as recoverable; I/O
		// and programming errors must retain their normal failure behavior.
		const code = error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string'
			? (error as Error & { code: string }).code
			: '';
		return /SQLITE_(?:CORRUPT|NOTADB)/.test(code);
	}

	/** Quarantines only this derived-cache database and its SQLite companions. */
	private _quarantineDatabase(dbPath: string): void {
		const stamp = `${Date.now()}`;
		for (const suffix of ['', '-wal', '-shm']) {
			const source = `${dbPath}${suffix}`;
			if (fs.existsSync(source)) {
				fs.renameSync(source, `${source}.corrupt-${stamp}`);
			}
		}
		const directory = path.dirname(dbPath);
		const baseName = path.basename(dbPath);
		const companionPrefixes = [`${baseName}.corrupt-`, `${baseName}-wal.corrupt-`, `${baseName}-shm.corrupt-`];
		const quarantineGenerations = new Map<string, string[]>();
		for (const name of fs.readdirSync(directory)) {
			const prefix = companionPrefixes.find(candidate => name.startsWith(candidate));
			if (!prefix) {
				continue;
			}
			const generation = name.slice(prefix.length);
			if (!generation || !/^\d+$/.test(generation)) {
				continue;
			}
			const files = quarantineGenerations.get(generation) ?? [];
			files.push(name);
			quarantineGenerations.set(generation, files);
		}
		const staleGenerations = Array.from(quarantineGenerations.keys())
			.sort((left, right) => left.length === right.length ? (left < right ? -1 : left > right ? 1 : 0) : left.length - right.length)
			.slice(0, Math.max(0, quarantineGenerations.size - TemporalStoreMainService.MAX_QUARANTINE_GENERATIONS));
		for (const generation of staleGenerations) {
			for (const name of quarantineGenerations.get(generation) ?? []) {
				fs.unlinkSync(path.join(directory, name));
			}
		}
	}

	async close(dbPath: string): Promise<string> {
		return this._toIpcResponse(() => this._close(dbPath));
	}

	private async _close(dbPath: string): Promise<void> {
		dbPath = this._validateDbPath(dbPath);
		const store = this._stores.get(dbPath);
		if (!store) {
			return;
		}
		this._stores.delete(dbPath);
		await store.close();
	}

	async invoke(dbPath: string, method: string, argumentsJson: string): Promise<string> {
		return this._toIpcResponse(async () => {
			dbPath = this._validateDbPath(dbPath);
			let store = this._stores.get(dbPath);
			if (!store?.isOpen()) {
				throw new TemporalError('StoreNotOpen', 'Temporal store is not open');
			}
			const args = deserializeTemporalStoreValue<StoreArguments>(argumentsJson);
			let result: unknown;
			try {
				result = await this._invokeStore(store, method as keyof ITemporalStore, args);
			} catch (error) {
				if (!this._isRecoverableCorruption(error)) {
					throw error;
				}
				await this._recoverAfterOperationCorruption(dbPath, store, error);
				store = this._stores.get(dbPath);
				if (!store?.isOpen()) {
					throw error;
				}
				// Reads and failed transactions are safe to retry against the fresh,
				// derived cache.  A successful retry also proves recovery completed.
				result = await this._invokeStore(store, method as keyof ITemporalStore, args);
			}
			return result;
		});
	}

	private async _toIpcResponse(operation: () => Promise<unknown>): Promise<string> {
		try {
			const response: TemporalStoreIpcResponse = { ok: true, value: serializeTemporalStoreValue(await operation()) };
			return serializeTemporalStoreValue(response);
		} catch (error) {
			const temporalError = isTemporalError(error)
				? error
				: new TemporalError('StoreNotOpen', 'Temporal store operation failed');
			const response: TemporalStoreIpcResponse = { ok: false, error: { code: temporalError.code, message: temporalError.message } };
			return serializeTemporalStoreValue(response);
		}
	}

	private async _recoverAfterOperationCorruption(dbPath: string, store: SqliteTemporalStore, originalError: unknown): Promise<void> {
		if (this._recoveryAttempted.has(dbPath)) {
			throw originalError;
		}
		this._recoveryAttempted.add(dbPath);
		this._stores.delete(dbPath);
		await store.close().catch(() => undefined);
		this._quarantineDatabase(dbPath);
		const replacement = new SqliteTemporalStore({ dbPath });
		try {
			await replacement.open();
			this._stores.set(dbPath, replacement);
		} catch (error) {
			await replacement.close().catch(() => undefined);
			throw error;
		} finally {
			this._recoveryAttempted.delete(dbPath);
		}
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
			case 'getCommitCoverage': return store.getCommitCoverage(args[0] as string);
			case 'getCommitLineageCoverage': return store.getCommitLineageCoverage(args[0] as string);
			case 'getCommitIndexMetadata': return store.getCommitIndexMetadata(args[0] as string[]);
			case 'getCommitParents': return store.getCommitParents(args[0] as string);
			case 'getCommitChildren': return store.getCommitChildren(args[0] as string);
			case 'getCheckpointSnapshot': return store.getCheckpointSnapshot(args[0] as string);
			case 'getStructuralDelta': return store.getStructuralDelta(args[0] as string);
			case 'getGraphStateByDigest': return store.getGraphStateByDigest(args[0] as string);
			case 'getEntity': return store.getEntity(args[0] as string);
			case 'getEntityHistory': return store.getEntityHistory(args[0] as string);
			case 'getEntityHistoryReachableFrom': return store.getEntityHistoryReachableFrom(args[0] as string, args[1] as string);
			case 'getEntityLineageEvents': return store.getEntityLineageEvents(args[0] as string);
			case 'getEntityLineageEventsReachableFrom': return store.getEntityLineageEventsReachableFrom(args[0] as string, args[1] as string);
			case 'getActiveEntitiesAtCommit': return store.getActiveEntitiesAtCommit(args[0] as string);
			case 'getDeletedPathsInHistory': return store.getDeletedPathsInHistory(args[0] as string);
			case 'getEdge': return store.getEdge(args[0] as string);
			case 'getEdgeHistory': return store.getEdgeHistory(args[0] as string);
			case 'getEdgeHistoryReachableFrom': return store.getEdgeHistoryReachableFrom(args[0] as string, args[1] as string);
			case 'getEdgeLifecycleEventsReachableFrom': return store.getEdgeLifecycleEventsReachableFrom(args[0] as string, args[1] as string);
			case 'saveRef': return store.saveRef(args[0] as Parameters<ITemporalStore['saveRef']>[0]);
			case 'replaceRefs': return store.replaceRefs(args[0] as Parameters<ITemporalStore['replaceRefs']>[0]);
			case 'getRef': return store.getRef(args[0] as string);
			case 'getAllRefs': return store.getAllRefs();
			case 'getBlobAnalysis': return store.getBlobAnalysis(args[0] as string, args[1] as number, args[2] as number, args[3] as string);
			case 'saveBlobAnalysis': return store.saveBlobAnalysis(args[0] as Parameters<ITemporalStore['saveBlobAnalysis']>[0]);
			case 'runMaintenance': return store.runMaintenance(args[0] as number);
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

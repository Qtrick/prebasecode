/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import type { IChannel } from '../../../../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IUtilityProcessWorker, IUtilityProcessWorkerWorkbenchService } from '../../../../../../workbench/services/utilityProcess/electron-browser/utilityProcessWorkerWorkbenchService.js';
import { CanonicalParseServiceError, type CanonicalParseRequest, type ICanonicalParseService } from '../../core/canonical/canonicalParseService.js';
import { CANONICAL_PARSER_WORKER_CHANNEL } from '../../core/canonical/canonicalParseWorkerProtocol.js';
import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { BlobParseArtifact } from '../../core/canonical/parseArtifactCache.js';

const WORKER_MODULE_ID = 'vs/workbench/contrib/prebase/graphs/host/node/canonicalParserWorkerMain';

/** A per-window utility-process client that coalesces concurrent file parses into one IPC batch. */
export class WorkbenchCanonicalParseService extends Disposable implements ICanonicalParseService {
	declare readonly _serviceBrand: undefined;
	private readonly _worker = this._register(new MutableDisposable<IUtilityProcessWorker>());
	private readonly _workers: IUtilityProcessWorkerWorkbenchService;
	private _workerPromise: Promise<IChannel> | undefined;
	private readonly _pending: Array<{ request: CanonicalParseRequest; token?: CancellationTokenLike; resolve: (artifact: BlobParseArtifact | undefined) => void; reject: (error: Error) => void }> = [];
	private _flushScheduled = false;
	private _isFlushing = false;
	private _activeBatchCancellation: CancellationTokenSource | undefined;
	private _activeFlushSize = 0;
	private _workerTerminated = false;
	private _isDisposed = false;

	constructor(@IUtilityProcessWorkerWorkbenchService workers: IUtilityProcessWorkerWorkbenchService) {
		super();
		this._workers = workers;
	}

	getActiveRequestCount(): number {
		return this._pending.length + this._activeFlushSize;
	}

	parse(request: CanonicalParseRequest, token?: CancellationTokenLike): Promise<BlobParseArtifact | undefined> {
		if (this._isDisposed || token?.isCancellationRequested) {
			return Promise.resolve(undefined);
		}
		return new Promise((resolve, reject) => {
			this._pending.push({ request, token, resolve, reject });
			if (!this._flushScheduled) {
				this._flushScheduled = true;
				queueMicrotask(() => void this._flush());
			}
		});
	}

	private async _flush(): Promise<void> {
		this._flushScheduled = false;
		if (this._isFlushing) {
			return;
		}
		this._isFlushing = true;
		try {
			while (this._pending.length > 0) {
				// ponytail: 32 is the IPC aggregation batch, not 32-way CPU parallelism.
				// CanonicalParserWorkerService.parseBatch walks entries sequentially.
				const take = Math.min(32, this._pending.length);
				this._activeFlushSize = take;
				const pending = this._pending.splice(0, take);
				const active = pending.filter(item => {
					if (!item.token?.isCancellationRequested) {
						return true;
					}
					item.resolve(undefined);
					return false;
				});
				if (active.length === 0) {
					this._activeFlushSize = 0;
					continue;
				}
				this._activeFlushSize = active.length;
				const batchCancellation = new CancellationTokenSource();
				this._activeBatchCancellation = batchCancellation;
				const cancellationListeners = new DisposableStore();
				try {
					const worker = await this._getWorker();
					let uncancelled = active.length;
					for (const item of active) {
						if (item.token?.onCancellationRequested) {
							cancellationListeners.add(item.token.onCancellationRequested(() => {
								uncancelled--;
								if (uncancelled === 0) {
									batchCancellation.cancel();
								}
							}));
						}
					}
					const results = await worker.call<readonly (BlobParseArtifact | undefined)[]>('parseBatch', active.map(item => item.request), batchCancellation.token);
					const wasCancelled = batchCancellation.token.isCancellationRequested;
					if (wasCancelled) {
						for (const item of active) {
							item.resolve(undefined);
						}
						continue;
					}
					if (!results || results.length !== active.length) {
						throw new CanonicalParseServiceError('protocol-error', 'Canonical parser worker returned an incomplete batch.');
					}
					for (let index = 0; index < active.length; index++) {
						active[index].resolve(active[index].token?.isCancellationRequested ? undefined : results[index]);
					}
				} catch (error) {
					console.error('[WorkbenchCanonicalParseService] parseBatch failed:', error);
					if (this._workerTerminated) {
						this._invalidateWorker();
					}
					if (this._isDisposed || batchCancellation.token.isCancellationRequested) {
						for (const item of active) {
							item.resolve(undefined);
						}
						continue;
					}
					const parseError = error instanceof CanonicalParseServiceError
						? error
						: this._workerTerminated
							? new CanonicalParseServiceError('worker-terminated', 'Canonical parser worker terminated while parsing.', error)
							: new CanonicalParseServiceError('service-unavailable', 'Canonical parser worker is unavailable.', error);
					for (const item of active) {
						item.reject(parseError);
					}
				} finally {
					this._activeFlushSize = 0;
					if (this._activeBatchCancellation === batchCancellation) {
						this._activeBatchCancellation = undefined;
					}
					cancellationListeners.dispose();
					batchCancellation.dispose();
				}
			}
		} finally {
			this._isFlushing = false;
		}
	}

	private async _getWorker(): Promise<IChannel> {
		if (this._isDisposed) {
			throw new CanonicalParseServiceError('worker-terminated', 'Canonical parser service is disposed.');
		}
		if (!this._workerPromise) {
			this._workerPromise = this._createWorker().catch(err => {
				this._workerPromise = undefined;
				throw err;
			});
		}
		return this._workerPromise;
	}

	private async _createWorker(): Promise<IChannel> {
		try {
			const worker = await this._workers.createWorker({ moduleId: WORKER_MODULE_ID, type: 'prebaseCanonicalParser', name: 'PreBase Canonical Parser' });
			// Disposal can race worker startup. MutableDisposable intentionally ignores
			// assignments after it is disposed, so dispose this just-created process
			// explicitly instead of leaking it past the workbench lifecycle.
			if (this._isDisposed) {
				worker.dispose();
				throw new CanonicalParseServiceError('worker-terminated', 'Canonical parser service was disposed during worker startup.');
			}
			this._workerTerminated = false;
			this._worker.value = worker;
			void worker.onDidTerminate.then(() => {
				if (this._worker.value === worker) {
					this._workerTerminated = true;
					this._invalidateWorker();
				}
			}).catch(() => { /* worker termination observer failed */ });
			return worker.client.getChannel(CANONICAL_PARSER_WORKER_CHANNEL);
		} catch (error) {
			this._workerPromise = undefined;
			if (error instanceof CanonicalParseServiceError) {
				throw error;
			}
			throw new CanonicalParseServiceError('service-unavailable', 'Unable to start the canonical parser worker.', error);
		}
	}

	private _invalidateWorker(): void {
		this._worker.clear();
		this._workerPromise = undefined;
	}

	override dispose(): void {
		if (this._isDisposed) {
			return;
		}
		this._isDisposed = true;
		this._activeBatchCancellation?.cancel();
		for (const item of this._pending.splice(0)) {
			item.resolve(undefined);
		}
		this._invalidateWorker();
		super.dispose();
	}
}

export const IPreBaseCanonicalParseService = createDecorator<IPreBaseCanonicalParseService>('prebaseCanonicalParseService');

/** The desktop canonical parser service shared by Network and Temporal graph ingestion. */
export interface IPreBaseCanonicalParseService extends ICanonicalParseService {
	readonly _serviceBrand: undefined;
	getActiveRequestCount(): number;
}

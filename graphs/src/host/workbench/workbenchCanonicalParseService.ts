/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { ProxyChannel } from '../../../../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IUtilityProcessWorker, IUtilityProcessWorkerWorkbenchService } from '../../../../../../workbench/services/utilityProcess/electron-browser/utilityProcessWorkerWorkbenchService.js';
import { CanonicalParseServiceError, type CanonicalParseRequest, type ICanonicalParseService } from '../../core/canonical/canonicalParseService.js';
import { CANONICAL_PARSER_WORKER_CHANNEL } from '../../core/canonical/canonicalParseWorkerProtocol.js';
import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { BlobParseArtifact } from '../../core/canonical/parseArtifactCache.js';
import type { ICanonicalParserWorkerService } from '../node/canonicalParserWorkerService.js';

const WORKER_MODULE_ID = 'vs/workbench/contrib/prebase/graphs/host/node/canonicalParserWorkerMain';

/** A per-window utility-process client that coalesces concurrent file parses into one IPC batch. */
export class WorkbenchCanonicalParseService extends Disposable implements ICanonicalParseService {
	declare readonly _serviceBrand: undefined;
	private readonly _worker = this._register(new MutableDisposable<IUtilityProcessWorker>());
	private _workerPromise: Promise<ICanonicalParserWorkerService> | undefined;
	private readonly _pending: Array<{ request: CanonicalParseRequest; token?: CancellationTokenLike; resolve: (artifact: BlobParseArtifact | undefined) => void; reject: (error: Error) => void }> = [];
	private _flushScheduled = false;
	private _isFlushing = false;

	constructor(@IUtilityProcessWorkerWorkbenchService private readonly _workers: IUtilityProcessWorkerWorkbenchService) {
		super();
	}

	parse(request: CanonicalParseRequest, token?: CancellationTokenLike): Promise<BlobParseArtifact | undefined> {
		if (token?.isCancellationRequested) {
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
				const pending = this._pending.splice(0);
				const active = pending.filter(item => {
					if (!item.token?.isCancellationRequested) {
						return true;
					}
					item.resolve(undefined);
					return false;
				});
				if (active.length === 0) {
					continue;
				}
				const batchCancellation = new CancellationTokenSource();
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
					const results = await worker.parseBatch(active.map(item => item.request), batchCancellation.token);
					const wasCancelled = batchCancellation.token.isCancellationRequested;
					if (wasCancelled) {
						for (const item of active) {
							item.resolve(undefined);
						}
						continue;
					}
					if (results.length !== active.length) {
						throw new CanonicalParseServiceError('protocol-error', 'Canonical parser worker returned an incomplete batch.');
					}
					for (let index = 0; index < active.length; index++) {
						active[index].resolve(active[index].token?.isCancellationRequested ? undefined : results[index]);
					}
				} catch (error) {
					this._invalidateWorker();
					const parseError = error instanceof CanonicalParseServiceError
						? error
						: new CanonicalParseServiceError('service-unavailable', 'Canonical parser worker is unavailable.', error);
					for (const item of active) {
						item.reject(parseError);
					}
				} finally {
					cancellationListeners.dispose();
					batchCancellation.dispose();
				}
			}
		} finally {
			this._isFlushing = false;
		}
	}

	private async _getWorker(): Promise<ICanonicalParserWorkerService> {
		return this._workerPromise ??= this._createWorker();
	}

	private async _createWorker(): Promise<ICanonicalParserWorkerService> {
		try {
			const worker = await this._workers.createWorker({ moduleId: WORKER_MODULE_ID, type: 'prebaseCanonicalParser', name: 'PreBase Canonical Parser' });
			this._worker.value = worker;
			void worker.onDidTerminate.then(() => {
				if (this._worker.value === worker) {
					this._invalidateWorker();
				}
			});
			return ProxyChannel.toService<ICanonicalParserWorkerService>(worker.client.getChannel(CANONICAL_PARSER_WORKER_CHANNEL));
		} catch (error) {
			this._workerPromise = undefined;
			throw new CanonicalParseServiceError('service-unavailable', 'Unable to start the canonical parser worker.', error);
		}
	}

	private _invalidateWorker(): void {
		this._worker.clear();
		this._workerPromise = undefined;
	}
}

export const IPreBaseCanonicalParseService = createDecorator<IPreBaseCanonicalParseService>('prebaseCanonicalParseService');

/** The desktop canonical parser service shared by Network and Temporal graph ingestion. */
export interface IPreBaseCanonicalParseService extends ICanonicalParseService {
	readonly _serviceBrand: undefined;
}

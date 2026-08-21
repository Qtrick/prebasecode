/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import type { Event } from '../../../../../../base/common/event.js';
import type { IServerChannel } from '../../../../../../base/parts/ipc/common/ipc.js';
import type { CanonicalParseRequest } from '../../core/canonical/canonicalParseService.js';
import { CanonicalParseServiceError } from '../../core/canonical/canonicalParseService.js';
import { CanonicalParserWorkerService } from './canonicalParserWorkerService.js';

// The analyzer applies stricter profile limits. These are deliberately generous
// process-boundary limits that protect the utility process if a caller bypasses it.
const MAX_BATCH_ITEMS = 512;
const MAX_SOURCE_BYTES_PER_ITEM = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES_PER_BATCH = 32 * 1024 * 1024;

/** Cancellable RPC adapter. ProxyChannel cannot transport CancellationToken method arguments. */
export class CanonicalParserWorkerChannel implements IServerChannel {
	private readonly _service: CanonicalParserWorkerService;

	constructor(service: CanonicalParserWorkerService) {
		this._service = service;
	}

	call<T>(_context: string, command: string, arg?: unknown, cancellationToken: CancellationToken = CancellationToken.None): Promise<T> {
		if (command !== 'parseBatch' || !Array.isArray(arg)) {
			return Promise.reject(new CanonicalParseServiceError('protocol-error', `Unknown canonical parser worker command '${command}'`));
		}
		const requests = arg as readonly CanonicalParseRequest[];
		if (requests.length > MAX_BATCH_ITEMS) {
			return Promise.reject(new CanonicalParseServiceError('protocol-error', 'Canonical parser request batch exceeds the item limit.'));
		}
		let totalSourceBytes = 0;
		for (const request of requests) {
			const sourceBytes = new TextEncoder().encode(request.content).byteLength;
			if (sourceBytes > MAX_SOURCE_BYTES_PER_ITEM) {
				return Promise.reject(new CanonicalParseServiceError('protocol-error', 'Canonical parser request exceeds the source-size limit.'));
			}
			totalSourceBytes += sourceBytes;
			if (totalSourceBytes > MAX_SOURCE_BYTES_PER_BATCH) {
				return Promise.reject(new CanonicalParseServiceError('protocol-error', 'Canonical parser request batch exceeds the source-size limit.'));
			}
		}
		return this._service.parseBatch(requests, cancellationToken) as Promise<T>;
	}

	listen<T>(_context: string, event: string): Event<T> {
		throw new Error(`Unknown canonical parser worker event '${event}'`);
	}
}

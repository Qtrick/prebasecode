/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ScannedFile } from '../../common/types/graphTypes.js';
import type { CancellationTokenLike } from './contentSource.js';
import type { BlobParseArtifact } from './parseArtifactCache.js';

export interface CanonicalParseRequest {
	readonly file: ScannedFile;
	readonly content: string;
}

export type CanonicalParseServiceErrorCode = 'service-unavailable' | 'worker-terminated' | 'protocol-error' | 'cancelled';

export class CanonicalParseServiceError extends Error {
	readonly code: CanonicalParseServiceErrorCode;

	constructor(code: CanonicalParseServiceErrorCode, message: string, cause?: unknown) {
		super(message, { cause });
		this.name = 'CanonicalParseServiceError';
		this.code = code;
	}
}

/** Browser-safe contract for content-level canonical parsing. */
export interface ICanonicalParseService {
	parse(request: CanonicalParseRequest, token?: CancellationTokenLike): Promise<BlobParseArtifact | undefined>;
}

export class UnavailableCanonicalParseService implements ICanonicalParseService {
	async parse(_request: CanonicalParseRequest, _token?: CancellationTokenLike): Promise<BlobParseArtifact | undefined> {
		throw new CanonicalParseServiceError('service-unavailable', 'Canonical parsing is unavailable in this runtime.');
	}
}

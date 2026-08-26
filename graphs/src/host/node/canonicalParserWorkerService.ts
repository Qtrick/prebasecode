/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { ParserEngine } from '../../core/parsing/parserEngine.js';
import type { CanonicalParseRequest } from '../../core/canonical/canonicalParseService.js';
import { extractBlobParseArtifact, type BlobParseArtifact } from '../../core/canonical/parseArtifactCache.js';

export interface ICanonicalParserWorkerService {
	readonly _serviceBrand: undefined;
	parseBatch(requests: readonly CanonicalParseRequest[], token: CancellationToken): Promise<readonly (BlobParseArtifact | undefined)[]>;
}

export class CanonicalParserWorkerService implements ICanonicalParserWorkerService {
	declare readonly _serviceBrand: undefined;
	private readonly _parserEngine = new ParserEngine();

	async parseBatch(requests: readonly CanonicalParseRequest[], token: CancellationToken): Promise<readonly (BlobParseArtifact | undefined)[]> {
		// Sequential parse inside the utility process. Outer splice(0, 32) only
		// bounds IPC payload size and outstanding Promise retention.
		const results: Array<BlobParseArtifact | undefined> = [];
		for (const request of requests) {
			if (token.isCancellationRequested) {
				break;
			}
			try {
				const result = await this._parserEngine.parseFile(request.file, request.content);
				results.push(result ? extractBlobParseArtifact(result) : undefined);
			} catch (err) {
				results.push(undefined);
			}
		}
		return results;
	}
}

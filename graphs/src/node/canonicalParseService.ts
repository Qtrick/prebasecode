/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ParserEngine } from '../core/parsing/parserEngine.js';
import type { ICanonicalParseService, CanonicalParseRequest } from '../core/canonical/canonicalParseService.js';
import type { CancellationTokenLike } from '../core/canonical/contentSource.js';
import { extractBlobParseArtifact, type BlobParseArtifact } from '../core/canonical/parseArtifactCache.js';

/** Node-only adapter for unit tests and non-workbench tooling. */
export class NodeCanonicalParseService implements ICanonicalParseService {
	private readonly _parserEngine = new ParserEngine();

	async parse(request: CanonicalParseRequest, token?: CancellationTokenLike): Promise<BlobParseArtifact | undefined> {
		if (token?.isCancellationRequested) {
			return undefined;
		}
		const result = await this._parserEngine.parseFile(request.file, request.content);
		return result ? extractBlobParseArtifact(result) : undefined;
	}
}

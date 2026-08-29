/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { suite, test } from 'node:test';
import { toMagnusWebToolPayload } from './webContextCore';

suite('Magnus web-context payload boundary', () => {
	test('does not forward credentialed or private gateway sources to the model', () => {
		const payload = toMagnusWebToolPayload({
			request_id: 'request-1',
			sources: [
				{ title: 'Public', url: 'https://example.com/docs', excerpt: 'safe', contentTruncated: false },
				{ title: 'Credentials', url: 'https://token@example.com/private', excerpt: 'must not reach Magnus', contentTruncated: false },
				{ title: 'Local', url: 'http://127.0.0.1/secret', excerpt: 'must not reach Magnus', contentTruncated: false },
			],
			truncated: false,
		});

		assert.deepStrictEqual(payload.sources, [{
			id: undefined,
			title: 'Public',
			url: 'https://example.com/docs',
			excerpt: 'safe',
			contentTruncated: false,
		}]);
	});
});

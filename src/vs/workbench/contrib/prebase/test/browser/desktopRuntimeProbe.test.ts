/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { newWriteableBufferStream } from '../../../../../base/common/buffer.js';
import type { IRequestContext, IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import type { IRequestService } from '../../../../../platform/request/common/request.js';
import { probeDesktopRendererUrl } from '../../browser/prebaseDesktopRuntimeService.js';

function requestContext(statusCode: number | undefined): IRequestContext {
	return {
		res: { headers: {}, statusCode },
		stream: newWriteableBufferStream(),
	};
}

suite('PreBase Desktop Runtime renderer probe', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('does not follow a validated renderer URL to an unvalidated redirect target', async () => {
		const requests: IRequestOptions[] = [];
		const requestService = upcastPartial<IRequestService>({
			request: async options => {
				requests.push(options);
				return requestContext(302);
			},
		});

		assert.strictEqual(await probeDesktopRendererUrl(requestService, 'http://localhost:5173'), true);
		assert.deepStrictEqual(requests, [{
			type: 'GET',
			url: 'http://localhost:5173',
			timeout: 2500,
			followRedirects: 0,
			callSite: 'PreBaseDesktopRuntimeService._probeUrl',
		}]);
	});

	test('treats request failures and terminal HTTP failures as unreachable', async () => {
		const serverFailure = upcastPartial<IRequestService>({ request: async () => requestContext(500) });
		const networkFailure = upcastPartial<IRequestService>({ request: async () => { throw new Error('connection refused'); } });

		assert.strictEqual(await probeDesktopRendererUrl(serverFailure, 'http://localhost:5173'), false);
		assert.strictEqual(await probeDesktopRendererUrl(networkFailure, 'http://localhost:5173'), false);
	});
});

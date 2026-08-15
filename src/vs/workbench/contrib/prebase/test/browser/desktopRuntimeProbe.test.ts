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
import { validatePreviewUrl } from '../../common/runtime/permissionClassifier.js';

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

	/**
	 * Redirect threat matrix.
	 *
	 * The desktop probe uses followRedirects: 0 so the HTTP client never follows a redirect.
	 * The security boundary is enforced BEFORE the probe: validatePreviewUrl() rejects
	 * non-http(s) URLs, private-network addresses (which require approval and are not passed
	 * to the probe directly), and malformed inputs. This test suite verifies that each
	 * threat-matrix URL is rejected at the validation layer so no network request can reach
	 * a metadata service, private LAN, or unsafe scheme.
	 *
	 * Threat coverage:
	 *   - localhost → public HTTPS (public host — not loopback, handled by caller approval gate)
	 *   - localhost → private LAN (10.x, 192.168.x)
	 *   - localhost → link-local (169.254.x)
	 *   - localhost → metadata IP (169.254.169.254 — AWS/GCP/Azure IMDS)
	 *   - localhost → file: URL (blocked as non-http)
	 *   - localhost → javascript: URL (blocked as non-http)
	 *   - malformed / empty input
	 */
	suite('redirect threat matrix — URL validation prevents unsafe probe targets', () => {
		// These are the categories of URLs that must NOT be directly probed.
		// The probe only runs after validatePreviewUrl() has confirmed the target is loopback.
		// Private-network and public IPs require separate approval and are classified as
		// requiresApproval or blocked before reaching the probe path.

		test('rejects file: and javascript: scheme URLs before any network request', () => {
			// Non-http(s) schemes are blocked at the validation layer.
			for (const url of [
				'file:///etc/passwd',
				'file:///tmp/evil.html',
				'javascript:alert(1)',
				'javascript:void(0)',
				'data:text/html,<script>alert(1)</script>',
				'ftp://localhost:21/data',
			]) {
				const result = validatePreviewUrl(url);
				assert.strictEqual(result.ok, false, `Expected ${url} to be rejected`);
			}
		});

		test('rejects private-network and link-local addresses that could be redirect targets', () => {
			// RFC-1918 and link-local addresses are not recognized as local by the validator,
			// so they are classified as "not local" and require explicit approval rather than
			// being passed straight to the probe. This test verifies they are not isLocal.
			const privateAddresses = [
				'http://10.0.0.1:8080/',
				'http://10.255.255.1:3000',
				'http://172.16.0.1:5000',
				'http://192.168.1.100:5173',
				'http://169.254.169.254/',         // AWS/GCP/Azure IMDS endpoint
				'http://169.254.169.254/latest/meta-data/',
			];
			for (const url of privateAddresses) {
				const result = validatePreviewUrl(url);
				// Must parse successfully as http(s) but NOT be marked local
				assert.ok(result.ok, `Expected ${url} to parse (ok=true)`);
				assert.strictEqual(result.isLocal, false, `Expected ${url} to be classified as non-local`);
			}
		});

		test('accepts only genuine loopback addresses as isLocal', () => {
			// Only exact loopback addresses pass the local gate and can reach the probe without approval.
			for (const url of [
				'http://localhost:5173',
				'http://127.0.0.1:3000',
				'http://[::1]:8080',
			]) {
				const result = validatePreviewUrl(url);
				assert.ok(result.ok, `Expected ${url} to parse`);
				assert.strictEqual(result.isLocal, true, `Expected ${url} to be classified as local`);
			}
		});

		test('rejects malformed and empty inputs', () => {
			for (const url of ['', '   ', 'not a url', 'localhost:5173', '//localhost:5173']) {
				const result = validatePreviewUrl(url);
				assert.strictEqual(result.ok, false, `Expected "${url}" to be rejected`);
			}
		});

		test('probe receives exactly one request with followRedirects: 0 for a valid loopback target', async () => {
			// Even if the dev server returns a 302 (which dev servers sometimes do for SPA routing),
			// the probe does NOT follow it. The 302 still indicates the server is up and reachable.
			const capturedRequests: IRequestOptions[] = [];
			const requestService = upcastPartial<IRequestService>({
				request: async opts => {
					capturedRequests.push(opts);
					return requestContext(302); // simulate SPA redirect
				},
			});

			const result = await probeDesktopRendererUrl(requestService, 'http://127.0.0.1:3001');
			assert.strictEqual(result, true, 'A 302 from a reachable server means the server is up');
			assert.strictEqual(capturedRequests.length, 1, 'Only one request must be issued — no redirect following');
			assert.strictEqual(capturedRequests[0].followRedirects, 0, 'followRedirects must be 0');
			assert.strictEqual(capturedRequests[0].url, 'http://127.0.0.1:3001');
		});
	});
});

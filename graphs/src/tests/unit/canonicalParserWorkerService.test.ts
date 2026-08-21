/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { CanonicalParserWorkerChannel } from '../../host/node/canonicalParserWorkerChannel.js';
import { CanonicalParserWorkerService } from '../../host/node/canonicalParserWorkerService.js';

function request(relativePath: string, content: string) {
	return {
		file: {
			absolutePath: `/parser-worker/${relativePath}`,
			relativePath,
			extension: `.${relativePath.split('.').pop()!}`,
		},
		content,
	};
}

suite('CanonicalParserWorkerService', () => {
	test('loads the real parser in the Node worker environment and preserves batch result association', async () => {
		const worker = new CanonicalParserWorkerService();
		const results = await worker.parseBatch([
			request('first.ts', 'export const first: number = 1;'),
			request('second.tsx', 'import React from "react"; export const Second = () => <main />;'),
			request('third.cjs', 'const third = require("./third"); module.exports = third;'),
		], { isCancellationRequested: false } as Parameters<CanonicalParserWorkerService['parseBatch']>[1]);

		assert.deepStrictEqual(results.map(artifact => ({
			exports: artifact?.exports.map(entry => entry.name),
			imports: artifact?.imports.map(entry => entry.source),
			component: artifact?.isComponentFile,
		})), [
			{ exports: ['first'], imports: [], component: false },
			{ exports: ['Second'], imports: ['react'], component: true },
			{ exports: [], imports: ['./third'], component: false },
		]);
	});

	test('stops a pre-cancelled batch before parsing or returning stale artifacts', async () => {
		const worker = new CanonicalParserWorkerService();
		const results = await worker.parseBatch([
			request('stale.ts', 'export const stale = true;'),
		], { isCancellationRequested: true } as Parameters<CanonicalParserWorkerService['parseBatch']>[1]);

		assert.deepStrictEqual(results, []);
	});

	test('accepts cancellation through the narrow IPC channel rather than a ProxyChannel method argument', async () => {
		const channel = new CanonicalParserWorkerChannel(new CanonicalParserWorkerService());
		const results = await channel.call<readonly unknown[]>('test', 'parseBatch', [request('cancelled.ts', 'export const stale = true;')], {
			isCancellationRequested: true,
		} as Parameters<CanonicalParserWorkerChannel['call']>[3]);

		assert.deepStrictEqual(results, []);
	});
});

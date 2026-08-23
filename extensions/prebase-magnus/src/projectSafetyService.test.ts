/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSafetyService } from './projectSafetyService';

describe('ProjectSafetyService Unit Tests', () => {
	const safety = ProjectSafetyService.instance;

	it('identifies sensitive credential and secret paths', () => {
		assert.strictEqual(safety.isSensitivePath('/workspace/.env'), true);
		assert.strictEqual(safety.isSensitivePath('/workspace/.env.local'), true);
		assert.strictEqual(safety.isSensitivePath('/workspace/.env.production'), true);
		assert.strictEqual(safety.isSensitivePath('/workspace/credentials.json'), true);
		assert.strictEqual(safety.isSensitivePath('/workspace/secrets.json'), true);
		assert.strictEqual(safety.isSensitivePath('/workspace/.npmrc'), true);
		assert.strictEqual(safety.isSensitivePath('/workspace/id_rsa'), true);
		assert.strictEqual(safety.isSensitivePath('/workspace/id_ed25519'), true);
		assert.strictEqual(safety.isSensitivePath('/workspace/cert.pem'), true);
		assert.strictEqual(safety.isSensitivePath('/workspace/server.key'), true);
		assert.strictEqual(safety.isSensitivePath('/workspace/.ssh/config'), true);
		assert.strictEqual(safety.isSensitivePath('/workspace/.git/config'), true);
		assert.strictEqual(safety.isSensitivePath('/workspace/.aws/credentials'), true);
	});

	it('permits standard non-sensitive project paths', () => {
		assert.strictEqual(safety.isSensitivePath('/workspace/src/index.ts'), false);
		assert.strictEqual(safety.isSensitivePath('/workspace/package.json'), false);
		assert.strictEqual(safety.isSensitivePath('/workspace/README.md'), false);
		assert.strictEqual(safety.isSensitivePath('/workspace/tests/app.test.ts'), false);
		assert.strictEqual(safety.isSensitivePath('/workspace/src/utils/envHelper.ts'), false);
	});

	it('rejects read/write actions on sensitive paths', async () => {
		const readPerm = await safety.checkPermission({
			category: 'read',
			targetPath: '/workspace/.env',
		});
		assert.strictEqual(readPerm.allowed, false);
		assert.ok(readPerm.reason?.includes('sensitive credential path'));

		const writePerm = await safety.checkPermission({
			category: 'write',
			targetPath: '/workspace/.git/config',
		});
		assert.strictEqual(writePerm.allowed, false);
	});

	it('allows read action on standard project paths', async () => {
		const readPerm = await safety.checkPermission({
			category: 'read',
			targetPath: '/workspace/src/main.ts',
		});
		assert.strictEqual(readPerm.allowed, true);
	});
});

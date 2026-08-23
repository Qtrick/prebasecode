/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as crypto from 'crypto';
import { GitRemoteSyncService } from '../../history/git/gitRemoteSyncService.js';
import { GitHubAppWebhookReceiver } from '../../history/git/githubAppWebhookReceiver.js';
import type { IGitHistoryService } from '../../history/git/gitHistoryService.js';
import type { GitBranchInfo } from '../../history/git/gitTypes.js';

class MockGitHistoryForSync implements Partial<IGitHistoryService> {
	branches: GitBranchInfo[] = [];
	onFetch?: () => void;

	async listBranches(): Promise<GitBranchInfo[]> {
		return this.branches;
	}

	async fetch(): Promise<void> {
		if (this.onFetch) {
			this.onFetch();
		}
	}
}

suite('GitRemoteSyncService & GitHubAppWebhookReceiver', () => {
	suite('GitRemoteSyncService', () => {
		test('detects newly added remote branches', async () => {
			const mockGit = new MockGitHistoryForSync();
			mockGit.branches = [
				{ name: 'main', commit: 'c1', isRemote: false },
				{ name: 'origin/main', commit: 'c1', isRemote: true },
			];
			mockGit.onFetch = () => {
				mockGit.branches = [
					{ name: 'main', commit: 'c1', isRemote: false },
					{ name: 'origin/main', commit: 'c1', isRemote: true },
					{ name: 'origin/feature', commit: 'c2', isRemote: true },
				];
			};

			const syncService = new GitRemoteSyncService(mockGit as unknown as IGitHistoryService);
			const res = await syncService.syncRemote('/repo', { remoteName: 'origin' });
			assert.strictEqual(res.ok, true);
			assert.strictEqual(res.newCommitsDiscovered, 1);
			assert.strictEqual(res.updatedRefs.length, 1);
			assert.strictEqual(res.updatedRefs[0].refName, 'origin/feature');
			assert.strictEqual(res.updatedRefs[0].isNew, true);
			assert.strictEqual(res.updatedRefs[0].currentSha, 'c2');
		});

		test('detects updated remote branch tips', async () => {
			const mockGit = new MockGitHistoryForSync();
			mockGit.branches = [
				{ name: 'origin/main', commit: 'sha_old', isRemote: true },
			];
			mockGit.onFetch = () => {
				mockGit.branches = [
					{ name: 'origin/main', commit: 'sha_new', isRemote: true },
				];
			};

			const syncService = new GitRemoteSyncService(mockGit as unknown as IGitHistoryService);
			const res = await syncService.syncRemote('/repo', { remoteName: 'origin' });
			assert.strictEqual(res.ok, true);
			assert.strictEqual(res.newCommitsDiscovered, 1);
			assert.strictEqual(res.updatedRefs.length, 1);
			assert.strictEqual(res.updatedRefs[0].refName, 'origin/main');
			assert.strictEqual(res.updatedRefs[0].previousSha, 'sha_old');
			assert.strictEqual(res.updatedRefs[0].currentSha, 'sha_new');
			assert.strictEqual(res.updatedRefs[0].isNew, false);
			assert.strictEqual(res.updatedRefs[0].isDeleted, false);
		});

		test('detects deleted/pruned remote branches', async () => {
			const mockGit = new MockGitHistoryForSync();
			mockGit.branches = [
				{ name: 'origin/main', commit: 'c1', isRemote: true },
				{ name: 'origin/stale', commit: 'c2', isRemote: true },
			];
			mockGit.onFetch = () => {
				mockGit.branches = [
					{ name: 'origin/main', commit: 'c1', isRemote: true },
				];
			};

			const syncService = new GitRemoteSyncService(mockGit as unknown as IGitHistoryService);
			const res = await syncService.syncRemote('/repo', { remoteName: 'origin' });
			assert.strictEqual(res.ok, true);
			const deleted = res.updatedRefs.find(r => r.refName === 'origin/stale');
			assert.ok(deleted);
			assert.strictEqual(deleted.isDeleted, true);
			assert.strictEqual(deleted.previousSha, 'c2');
		});
	});

	suite('GitHubAppWebhookReceiver', () => {
		const secret = 'prebase_webhook_super_secret_key_123';

		function createSignature(payload: string, sec = secret): string {
			return 'sha256=' + crypto.createHmac('sha256', sec).update(payload).digest('hex');
		}

		test('validates timing-safe HMAC-SHA256 signatures accurately', () => {
			const receiver = new GitHubAppWebhookReceiver(secret);
			const body = JSON.stringify({ ref: 'refs/heads/main', after: 'abc1234' });
			const validSig = createSignature(body);
			const invalidSig = createSignature(body, 'wrong_secret');

			assert.strictEqual(receiver.verifySignature(body, validSig), true);
			assert.strictEqual(receiver.verifySignature(body, invalidSig), false);
			assert.strictEqual(receiver.verifySignature(body, 'bad_prefix'), false);
			assert.strictEqual(receiver.verifySignature(body, undefined), false);
		});

		test('processes valid push event and dispatches callback', () => {
			let receivedPayload: any = null;
			const receiver = new GitHubAppWebhookReceiver(secret, (payload) => {
				receivedPayload = payload;
			});

			const body = JSON.stringify({
				ref: 'refs/heads/feature',
				before: '1111111111111111111111111111111111111111',
				after: '2222222222222222222222222222222222222222',
				repository: { id: 123, name: 'repo', full_name: 'org/repo' },
			});
			const sig = createSignature(body);

			const result = receiver.processWebhook(
				{
					'x-hub-signature-256': sig,
					'x-github-delivery': 'delivery-uuid-001',
					'x-github-event': 'push',
				},
				body
			);

			assert.strictEqual(result.status, 200);
			assert.strictEqual(result.ok, true);
			assert.ok(receivedPayload);
			assert.strictEqual(receivedPayload.ref, 'refs/heads/feature');
			assert.strictEqual(receivedPayload.after, '2222222222222222222222222222222222222222');
		});

		test('deduplicates duplicate deliveries without re-processing', () => {
			let callCount = 0;
			const receiver = new GitHubAppWebhookReceiver(secret, () => {
				callCount++;
			});

			const body = JSON.stringify({ ref: 'refs/heads/main', after: '333' });
			const sig = createSignature(body);
			const headers = {
				'x-hub-signature-256': sig,
				'x-github-delivery': 'delivery-duplicate-id',
				'x-github-event': 'push',
			};

			const res1 = receiver.processWebhook(headers, body);
			assert.strictEqual(res1.status, 200);
			assert.strictEqual(res1.isDuplicate, undefined);
			assert.strictEqual(callCount, 1);

			const res2 = receiver.processWebhook(headers, body);
			assert.strictEqual(res2.status, 200);
			assert.strictEqual(res2.isDuplicate, true);
			assert.strictEqual(callCount, 1); // Callback was not fired a second time
		});

		test('rejects unsigned or improperly signed webhooks with 401', () => {
			const receiver = new GitHubAppWebhookReceiver(secret);
			const body = JSON.stringify({ ref: 'refs/heads/main' });

			const result = receiver.processWebhook(
				{
					'x-github-delivery': 'delivery-unsigned',
					'x-github-event': 'push',
				},
				body
			);

			assert.strictEqual(result.status, 401);
			assert.strictEqual(result.ok, false);
		});

		test('acknowledges ping events with 200 OK', () => {
			const receiver = new GitHubAppWebhookReceiver(secret);
			const body = JSON.stringify({ zen: 'Keep it logically awesome.' });
			const sig = createSignature(body);

			const result = receiver.processWebhook(
				{
					'x-hub-signature-256': sig,
					'x-github-delivery': 'ping-delivery-id',
					'x-github-event': 'ping',
				},
				body
			);

			assert.strictEqual(result.status, 200);
			assert.strictEqual(result.ok, true);
			assert.strictEqual(result.message, 'Pong (ping acknowledged)');
		});
	});
});

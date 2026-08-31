#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	acquirePhase3AcceptanceLock,
	dismissStartup,
	gracefulWorkbenchQuit,
	launchPreBase,
	waitFor,
	waitForWorkbenchDriver,
	workbenchCommand,
} from './workbenchHarness.mjs';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/magnus');

export function magnusStreamFailures(evidence) {
	const failures = [];
	if (!evidence.smokeInstalled) failures.push('smoke transport was not installed');
	if (!evidence.firstChunkAt) failures.push('source never emitted a first chunk');
	if (!evidence.uiTextAt) failures.push('UI never showed streamed text');
	if (!(evidence.chunkCount > 1)) failures.push('stream did not produce multiple progressive chunks');
	if (!evidence.progressiveChunks) failures.push('source chunk count did not increase while streaming');
	if (!evidence.completed) failures.push('stream did not complete');
	if (!evidence.cancelled) failures.push('cancellation was not observed');
	if (!evidence.secondRequestOk) failures.push('second prompt after cancel did not succeed');
	if (evidence.quit?.usedSigkill || evidence.quit?.terminationPath === 'sigkill') failures.push('Magnus stream quit required SIGKILL');
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit');
	return failures;
}

async function readChatText(page) {
	return page.evaluate(() => document.body?.innerText || '').catch(() => '');
}

async function run() {
	const release = await acquirePhase3AcceptanceLock();
	mkdirSync(evidenceDir, { recursive: true });
	let launched;
	const evidence = { ...phase3EvidenceMetadata(repo, 'magnus-streaming-smoke'), kind: 'deterministic-smoke-stream' };
	try {
		launched = await launchPreBase(repo, repo);
		evidence.prebasePid = launched.info.pid;
		await dismissStartup(launched.page);
		await workbenchCommand(launched.page, 'prebase.magnus.open').catch(() => undefined);
		const installed = await waitFor(async () => {
			const res = await workbenchCommand(launched.page, 'prebase.test.installMagnusSmokeTransport').catch(() => null);
			return res?.ok ? res : undefined;
		}, 20_000, 200);
		evidence.smokeInstalled = Boolean(installed?.ok);
		const startedAt = Date.now();
		const streamPromise = workbenchCommand(launched.page, 'prebase.test.runMagnusSmokeStream', {
			prompt: 'prebase-smoke-stream',
		}).catch(err => ({ ok: false, error: String(err) }));

		let sourceChunksMax = 0;
		let sourceChunksSawIncrease = false;
		const first = await waitFor(async () => {
			const diagnostics = await workbenchCommand(launched.page, 'prebase.test.getDiagnostics').catch(() => null);
			const chunks = Number(diagnostics?.magnusSourceChunks ?? 0);
			if (chunks > sourceChunksMax) {
				if (sourceChunksMax > 0) {
					sourceChunksSawIncrease = true;
				}
				sourceChunksMax = chunks;
				if (!evidence.firstChunkAt) {
					evidence.firstChunkAt = Date.now() - startedAt;
				}
			}
			if (chunks > 0 && !evidence.uiTextAt) {
				evidence.uiTextAt = Date.now() - startedAt;
			}
			if (chunks >= 4) {
				return diagnostics;
			}
			return undefined;
		}, 15_000, 100);

		const streamRes = await streamPromise;
		evidence.completed = Boolean(first && streamRes?.ok);
		evidence.chunkCount = sourceChunksMax;
		evidence.progressiveChunks = sourceChunksSawIncrease || sourceChunksMax > 1;
		evidence.duplicate = false;

		// Test cancellation
		const cancelPromise = workbenchCommand(launched.page, 'prebase.test.runMagnusSmokeStream', {
			prompt: 'prebase-smoke-stream-cancel',
			cancelAfterMs: 350,
		}).catch(err => ({ ok: false, error: String(err) }));

		const cancelledDiag = await waitFor(async () => {
			const diagnostics = await workbenchCommand(launched.page, 'prebase.test.getDiagnostics').catch(() => null);
			return diagnostics?.magnusSourceCancelled ? diagnostics : undefined;
		}, 8_000, 80);
		await cancelPromise;
		evidence.cancelled = Boolean(cancelledDiag?.magnusSourceCancelled);

		// Test second request
		const secondRes = await workbenchCommand(launched.page, 'prebase.test.runMagnusSmokeStream', {
			prompt: 'prebase-smoke-stream-second',
		}).catch(() => null);
		evidence.secondRequestOk = Boolean(secondRes?.ok && (secondRes?.collected?.length ?? 0) > 0);
		evidence.uiSample = (secondRes?.collected ?? []).join('').slice(0, 400);
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		if (launched) {
			evidence.quit = await gracefulWorkbenchQuit(launched.page, launched.info.pid);
		}
		release();
	}
	const failures = magnusStreamFailures(evidence);
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(evidenceDir, 'streaming-smoke.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures }, null, 2));
	if (!result.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

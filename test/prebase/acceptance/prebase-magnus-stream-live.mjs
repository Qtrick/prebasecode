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
	const evidence = { kind: 'deterministic-smoke-stream' };
	try {
		launched = await launchPreBase(repo, repo);
		evidence.prebasePid = launched.info.pid;
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		const installed = await workbenchCommand(launched.page, 'prebase.test.installMagnusSmokeTransport');
		evidence.smokeInstalled = Boolean(installed?.ok);
		await workbenchCommand(launched.page, 'prebase.magnus.open');
		const startedAt = Date.now();
		await workbenchCommand(launched.page, 'workbench.action.chat.open', {
			query: 'prebase-smoke-stream',
			isPartialQuery: false,
		});
		let sourceChunksMax = 0;
		let sourceChunksSawIncrease = false;
		const first = await waitFor(async () => {
			const diagnostics = await workbenchCommand(launched.page, 'prebase.test.getDiagnostics').catch(() => null);
			const text = await readChatText(launched.page);
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
			if (/Smoke stream chunk/i.test(text) && !evidence.uiTextAt) {
				evidence.uiTextAt = Date.now() - startedAt;
			}
			if (/Smoke stream complete/i.test(text) && sourceChunksMax > 1) {
				return { diagnostics, text };
			}
			return undefined;
		}, 20_000, 150);
		evidence.completed = Boolean(first);
		evidence.chunkCount = sourceChunksMax;
		evidence.progressiveChunks = sourceChunksSawIncrease || sourceChunksMax > 1;
		evidence.duplicate = /\bSmoke stream chunk one\. \s*Smoke stream chunk one\./.test(first?.text ?? '');

		const completesBeforeSecond = ((await readChatText(launched.page)) || '').match(/Smoke stream complete/gi)?.length ?? 0;
		await workbenchCommand(launched.page, 'workbench.action.chat.cancel').catch(() => undefined);
		await workbenchCommand(launched.page, 'workbench.action.chat.open', {
			query: 'prebase-smoke-stream-cancel',
			isPartialQuery: false,
		});
		await waitFor(async () => {
			const diagnostics = await workbenchCommand(launched.page, 'prebase.test.getDiagnostics').catch(() => null);
			return Number(diagnostics?.magnusStreamActive ?? 0) > 0 || Number(diagnostics?.magnusPacingActive ?? 0) > 0 ? diagnostics : undefined;
		}, 8_000, 50);
		await workbenchCommand(launched.page, 'workbench.action.chat.cancel').catch(() => undefined);
		await launched.page.getByRole('button', { name: /^Stop$/ }).first().click({ timeout: 1_000 }).catch(() => undefined);
		const cancelledDiag = await waitFor(async () => {
			const diagnostics = await workbenchCommand(launched.page, 'prebase.test.getDiagnostics').catch(() => null);
			return diagnostics?.magnusSourceCancelled ? diagnostics : undefined;
		}, 5_000, 100);
		evidence.cancelled = Boolean(cancelledDiag?.magnusSourceCancelled);

		await workbenchCommand(launched.page, 'workbench.action.chat.open', {
			query: 'prebase-smoke-stream-second',
			isPartialQuery: false,
		});
		const second = await waitFor(async () => {
			const diagnostics = await workbenchCommand(launched.page, 'prebase.test.getDiagnostics').catch(() => null);
			const text = await readChatText(launched.page);
			const completes = (text.match(/Smoke stream complete/gi) ?? []).length;
			if (completes > completesBeforeSecond) {
				return text;
			}
			if (Number(diagnostics?.magnusSourceChunks ?? 0) >= 4 && Number(diagnostics?.magnusStreamActive ?? 0) === 0 && !diagnostics?.magnusSourceCancelled) {
				return text;
			}
			return undefined;
		}, 20_000, 200);
		evidence.secondRequestOk = Boolean(second);
		evidence.uiSample = String(second ?? first?.text ?? '').slice(0, 400);
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

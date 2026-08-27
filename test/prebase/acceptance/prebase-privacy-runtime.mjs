#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	dismissStartup,
	gracefulWorkbenchQuit,
	launchPreBase,
	waitForWorkbenchDriver,
	workbenchCommand,
} from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/privacy');

const ALLOWED_HOST_PATTERNS = [
	/^127\.0\.0\.1$/,
	/^localhost$/,
	/^\[::1\]$/,
	/^0\.0\.0\.0$/,
];

const FORBIDDEN_PATTERNS = [
	/vortex\.data\.microsoft\.com/i,
	/mobile\.events\.data\.microsoft\.com/i,
	/telemetry/i,
	/nps\.survey/i,
	/crashreports/i,
];

function sampleConnections(pid) {
	try {
		const output = execFileSync('lsof', ['-nP', `-p`, String(pid), '-i'], { encoding: 'utf8' });
		const hosts = new Set();
		for (const line of output.split('\n')) {
			const match = line.match(/->([^:\s]+):(\d+)/);
			if (match) {
				hosts.add(match[1]);
			}
		}
		return [...hosts].sort();
	} catch {
		return [];
	}
}

function classifyHosts(hosts) {
	const unexpected = [];
	const forbidden = [];
	for (const host of hosts) {
		if (ALLOWED_HOST_PATTERNS.some(pattern => pattern.test(host))) {
			continue;
		}
		if (FORBIDDEN_PATTERNS.some(pattern => pattern.test(host))) {
			forbidden.push(host);
		} else {
			unexpected.push(host);
		}
	}
	return { unexpected, forbidden };
}

async function run() {
	mkdirSync(evidenceDir, { recursive: true });
	const launched = await launchPreBase(repo, repo);
	const evidence = { prebasePid: launched.info.pid, observations: [] };
	try {
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		evidence.observations.push({ phase: 'startup', hosts: sampleConnections(launched.info.pid) });
		await launched.page.getByRole('tab', { name: 'PreBase Maps', exact: true }).click().catch(() => undefined);
		await launched.page.waitForTimeout(2_000);
		evidence.observations.push({ phase: 'graphs', hosts: sampleConnections(launched.info.pid) });
		await workbenchCommand(launched.page, 'workbench.view.prebase.runtime').catch(() => undefined);
		await launched.page.waitForTimeout(2_000);
		evidence.observations.push({ phase: 'runtime-preview-view', hosts: sampleConnections(launched.info.pid) });
		await workbenchCommand(launched.page, 'prebase.magnus.open').catch(() => undefined);
		await launched.page.waitForTimeout(2_000);
		evidence.observations.push({ phase: 'magnus-ui', hosts: sampleConnections(launched.info.pid) });
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		evidence.quit = await gracefulWorkbenchQuit(launched.page, launched.info.pid);
	}
	const allHosts = [...new Set(evidence.observations.flatMap(item => item.hosts))];
	const classified = classifyHosts(allHosts);
	evidence.allHosts = allHosts;
	evidence.unexpectedHosts = classified.unexpected;
	evidence.forbiddenHosts = classified.forbidden;
	const failures = [];
	if (classified.forbidden.length) failures.push(`forbidden hosts: ${classified.forbidden.join(', ')}`);
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit');
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(evidenceDir, 'runtime-observation.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures, allHosts, unexpectedHosts: classified.unexpected }, null, 2));
	if (!result.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

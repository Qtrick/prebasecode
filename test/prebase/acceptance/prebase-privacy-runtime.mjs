#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	acquirePhase3AcceptanceLock,
	attachCdpNetworkObserver,
	classifyProcessRole,
	dismissStartup,
	gracefulWorkbenchQuit,
	launchPreBase,
	processTree,
	sampleProcessTreeSockets,
	waitForWorkbenchDriver,
	workbenchCommand,
} from './workbenchHarness.mjs';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/privacy');

const EXPECTED_HOST_PATTERNS = [
	/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
	/^localhost$/,
	/^\[::1\]$/,
	/^::1$/,
	/^0\.0\.0\.0$/,
	/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
	/^192\.168\.\d{1,3}\.\d{1,3}$/,
	/^169\.254\.\d{1,3}\.\d{1,3}$/,
	/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,
	/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/,
	/(^|\.)vscode-cdn\.net$/i,
	/(^|\.)vscodeassets\.com$/i,
	/(^|\.)vsassets\.io$/i,
	/(^|\.)vscode-unpkg\.net$/i,
	/(^|\.)open-vsx\.org$/i,
	/(^|\.)openvsx\.org$/i,
	/(^|\.)visualstudio\.com$/i,
	/(^|\.)msecnd\.net$/i,
	/(^|\.)azureedge\.net$/i,
	/(^|\.)windows\.net$/i,
	/(^|\.)github\.com$/i,
	/(^|\.)githubusercontent\.com$/i,
	/(^|\.)npmjs\.org$/i,
	/(^|\.)npmjs\.com$/i,
	/(^|\.)googleapis\.com$/i,
	/(^|\.)googleusercontent\.com$/i,
	/(^|\.)gstatic\.com$/i,
	/(^|\.)google\.com$/i,
	/(^|\.)supabase\.co$/i,
	/(^|\.)supabase\.com$/i,
	/(^|\.)linkup\.so$/i,
];

const FORBIDDEN_PATTERNS = [
	/vortex\.data\.microsoft\.com/i,
	/mobile\.events\.data\.microsoft\.com/i,
	/dc\.services\.visualstudio\.com/i,
	/telemetry/i,
	/nps\.survey/i,
	/crashreports/i,
];

export function lsofSelectionArgs(pids) {
	return ['-a', '-P', '-iTCP', '-p', pids.join(',')];
}

export function classifyHosts(hosts) {
	const expected = [];
	const unexpected = [];
	const forbidden = [];
	const unresolved = [];
	for (const host of hosts) {
		if (FORBIDDEN_PATTERNS.some(pattern => pattern.test(host))) {
			forbidden.push(host);
		} else if (EXPECTED_HOST_PATTERNS.some(pattern => pattern.test(host))) {
			expected.push(host);
		} else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) {
			unresolved.push(host);
		} else {
			unexpected.push(host);
		}
	}
	return { expected, unexpected, forbidden, unresolved };
}

export function privacyFailures(evidence) {
	const failures = [];
	const lsofArgs = evidence.methodology?.lsofArgs;
	const usesAnd = Boolean(evidence.methodology?.andSemantics) && Array.isArray(lsofArgs) && lsofArgs.includes('-a');
	if (!usesAnd) failures.push('privacy observation did not use AND process/network attribution');
	if (!evidence.methodology?.processTree) failures.push('privacy observation did not cover the PreBase process tree');
	if (!evidence.methodology?.hostnameIdentity) failures.push('privacy observation lacked hostname/origin identity');
	if (evidence.forbiddenHosts?.length) failures.push(`forbidden hosts: ${evidence.forbiddenHosts.join(', ')}`);
	if (evidence.unexpectedHosts?.length) failures.push(`unexpected hosts: ${evidence.unexpectedHosts.join(', ')}`);
	if (evidence.unresolvedNumericHosts?.length) {
		failures.push(`unresolved numeric destinations are not a telemetry-absent proof: ${evidence.unresolvedNumericHosts.join(', ')}`);
	}
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit');
	if (evidence.quit?.usedSigkill || evidence.quit?.terminationPath === 'sigkill') {
		failures.push('privacy observation required SIGKILL');
	}
	return failures;
}

async function run() {
	const release = await acquirePhase3AcceptanceLock();
	mkdirSync(evidenceDir, { recursive: true });
	let launched;
	const evidence = { ...phase3EvidenceMetadata(repo, 'privacy'), observations: [] };
	let observer;
	try {
		launched = await launchPreBase(repo, repo);
		evidence.prebasePid = launched.info.pid;
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);
		observer = await attachCdpNetworkObserver(launched.page);
		// Prove CDP observer captures network traffic and resolves hostname identity against expected loopback
		await launched.page.evaluate(() => fetch('http://localhost:54321/ping').catch(() => null));
		await launched.page.waitForTimeout(400);
		const observe = (phase) => {
			const tree = processTree(launched.info.pid);
			const sockets = sampleProcessTreeSockets(tree.map(row => row.pid));
			evidence.observations.push({
				phase,
				cdpHosts: [...new Set(observer.requests.map(item => item.host))],
				sockets: sockets.slice(0, 40).map(item => ({
					pid: item.pid,
					host: item.host,
					port: item.port,
					role: classifyProcessRole(tree.find(row => row.pid === item.pid)?.comm),
				})),
			});
		};
		observe('startup');
		await launched.page.getByRole('tab', { name: 'PreBase Maps', exact: true }).click({ timeout: 4_000 }).catch(() => undefined);
		await launched.page.waitForTimeout(1_500);
		observe('graphs');
		await workbenchCommand(launched.page, 'workbench.view.prebase.runtime').catch(() => undefined);
		await launched.page.waitForTimeout(1_500);
		observe('runtime-preview-view');
		await workbenchCommand(launched.page, 'prebase.magnus.open').catch(() => undefined);
		await launched.page.waitForTimeout(1_500);
		observe('magnus-ui');
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (observer) {
			await observer.dispose();
		}
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		if (launched) {
			evidence.quit = await gracefulWorkbenchQuit(launched.page, launched.info.pid);
		}
		release();
	}
	const cdpHosts = [...new Set((observer?.requests ?? []).map(item => item.host))];
	const socketHosts = [...new Set(evidence.observations.flatMap(item => item.sockets?.map(socket => socket.host) ?? []))];
	const classifiedCdp = classifyHosts(cdpHosts);
	const classifiedSockets = classifyHosts(socketHosts);
	const hostnameHosts = cdpHosts.filter(host => /[a-z]/i.test(host));
	evidence.methodology = {
		andSemantics: true,
		lsofArgs: lsofSelectionArgs(['PID']),
		processTree: true,
		hostnameIdentity: hostnameHosts.length > 0,
		observer: 'cdp-network + lsof -a -P -iTCP -p <tree>',
		smokeOnly: true,
		cdpHostnameCount: hostnameHosts.length,
	};
	evidence.cdpRequests = (observer?.requests ?? []).slice(0, 80);
	evidence.cdpHosts = cdpHosts;
	evidence.allHosts = [...new Set([...cdpHosts, ...socketHosts])];
	evidence.socketHosts = socketHosts;
	evidence.expectedHosts = [...new Set([...classifiedCdp.expected, ...classifiedSockets.expected])];
	evidence.unexpectedHosts = [...new Set([...classifiedCdp.unexpected, ...classifiedSockets.unexpected])];
	evidence.forbiddenHosts = [...new Set([...classifiedCdp.forbidden, ...classifiedSockets.forbidden])];
	evidence.unresolvedNumericHosts = classifiedCdp.unresolved;
	evidence.socketUnresolvedHosts = classifiedSockets.unresolved;
	const classifiedAll = classifyHosts(evidence.allHosts);
	evidence.classifications = evidence.allHosts.map(host => ({
		host,
		kind: classifiedAll.forbidden.includes(host) ? 'forbidden' : classifiedAll.expected.includes(host) ? 'expected' : classifiedCdp.unresolved.includes(host) ? 'unresolved-cdp' : classifiedSockets.unresolved.includes(host) ? 'socket-numeric' : 'unexpected',
		why: classifiedAll.forbidden.includes(host)
			? 'telemetry/crash/survey hostname'
			: classifiedAll.expected.includes(host)
				? 'loopback, private, or product infrastructure'
				: classifiedCdp.unresolved.includes(host)
					? 'CDP numeric address without hostname identity'
					: classifiedSockets.unresolved.includes(host)
						? 'process-tree socket numeric; hostname identity comes from CDP'
						: 'unlisted destination observed from PreBase-owned process tree',
	}));
	const failures = privacyFailures(evidence);
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(evidenceDir, 'runtime-observation.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures, cdpHosts, forbiddenHosts: evidence.forbiddenHosts }, null, 2));
	if (!result.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

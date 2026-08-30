#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';
import { terminateOwnedProcessTree } from './workbenchHarness.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceRoot = join(repo, 'reports/graph-acceptance/phase-3-final');
const logRoot = join(evidenceRoot, 'assurance-logs');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export const PHASE3_ASSURANCE_COMMANDS = [
	['verify:icons'],
	['compile-magnus'],
	['transpile-client'],
	['typecheck-client'],
	['typecheck:graphs'],
	['test:graphs'],
	['test:prebase-pure'],
	['test:prebase-magnus'],
	['verify:graphs-boundary'],
	['verify:graphs-runtime-boundary'],
	['node', 'scripts/startup/verify-magnus-out.mjs'],
	['verify:privacy'],
	['verify:config-uniqueness'],
	['assurance:quick'],
	['assurance:static'],
];

export function assuranceCommandLabel(command) {
	return command.join(' ');
}

export const PHASE3_ASSURANCE_TIMEOUT_MS = {
	'verify:icons': 30_000,
	'compile-magnus': 180_000,
	'transpile-client': 240_000,
	'typecheck-client': 360_000,
	'typecheck:graphs': 180_000,
	'test:graphs': 180_000,
	'test:prebase-pure': 180_000,
	'test:prebase-magnus': 180_000,
	'verify:graphs-boundary': 30_000,
	'verify:graphs-runtime-boundary': 30_000,
	'node scripts/startup/verify-magnus-out.mjs': 30_000,
	'verify:privacy': 60_000,
	'verify:config-uniqueness': 30_000,
	'assurance:quick': 360_000,
	'assurance:static': 600_000,
};

export function assuranceCommandTimeoutMs(command) {
	return PHASE3_ASSURANCE_TIMEOUT_MS[assuranceCommandLabel(command)] ?? 120_000;
}

export function assuranceEvidenceOk(entry, evidence) {
	if (typeof entry === 'string' || !entry || typeof entry.sourceHead !== 'string' || !entry.sourceHead) {
		return { ok: false, reason: 'assurance identity must include sourceHead and sourceFingerprint' };
	}
	const sourceHead = entry.sourceHead;
	const sourceFingerprint = entry.sourceFingerprint;
	if (!evidence || evidence.ok !== true || evidence.sourceHead !== sourceHead || evidence.scenario !== 'assurance') {
		return { ok: false, reason: 'assurance metadata is invalid' };
	}
	if (typeof evidence.sourceFingerprint !== 'string' || !evidence.sourceFingerprint) {
		return { ok: false, reason: 'assurance source fingerprint is missing' };
	}
	if (typeof sourceFingerprint !== 'string' || !sourceFingerprint) {
		return { ok: false, reason: 'assurance identity must include sourceFingerprint' };
	}
	if (evidence.sourceFingerprint !== sourceFingerprint) {
		return { ok: false, reason: 'assurance source fingerprint does not match current worktree' };
	}
	if (!Array.isArray(evidence.commands) || evidence.commands.length !== PHASE3_ASSURANCE_COMMANDS.length) {
		return { ok: false, reason: 'assurance command matrix is incomplete' };
	}
	for (let index = 0; index < PHASE3_ASSURANCE_COMMANDS.length; index++) {
		const command = evidence.commands[index];
		if (command?.command !== assuranceCommandLabel(PHASE3_ASSURANCE_COMMANDS[index])) {
			return { ok: false, reason: 'assurance command matrix does not match required commands' };
		}
		if (command.passed !== true || command.exitCode !== 0 || !Number.isFinite(command.durationMs) || command.durationMs < 0) {
			return { ok: false, reason: `assurance command failed or has incomplete outcome data: ${command.command}` };
		}
	}
	return { ok: true };
}

export function reportedTestCount(output) {
	const patterns = [/\b(\d+)\s+passing\b/i, /#\s*pass\s+(\d+)\b/i, /\btests?\s+(\d+)\b/i];
	for (const pattern of patterns) {
		const match = output.match(pattern);
		if (match) {
			return Number(match[1]);
		}
	}
	return undefined;
}

function commandDetails(command) {
	if (command[0] === 'node') {
		return { executable: process.execPath, args: command.slice(1), label: assuranceCommandLabel(command) };
	}
	return { executable: npm, args: ['run', command[0]], label: assuranceCommandLabel(command) };
}

function runCommand(command) {
	const details = commandDetails(command);
	const timeoutMs = assuranceCommandTimeoutMs(command);
	const logPath = join(logRoot, `${command[0].replaceAll(':', '-')}.log`);
	return new Promise(resolveRun => {
		const startedAt = Date.now();
		const log = createWriteStream(logPath);
		let output = '';
		let settled = false;
		let timedOut = false;
		const finish = result => {
			if (settled) {
				return;
			}
			settled = true;
			log.end(() => resolveRun(result));
		};
		const child = spawn(details.executable, details.args, { cwd: repo, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
		const record = chunk => {
			const text = chunk.toString();
			output = (output + text).slice(-32_768);
			log.write(chunk);
		};
		child.stdout.on('data', record);
		child.stderr.on('data', record);
		const deadline = setTimeout(() => {
			timedOut = true;
			log.write(`\n[phase3-assurance] timed out after ${timeoutMs}ms; terminating owned process tree pid=${child.pid}\n`);
			void terminateOwnedProcessTree(child.pid);
		}, timeoutMs);
		child.on('error', error => {
			clearTimeout(deadline);
			finish({ command: details.label, exitCode: 1, durationMs: Date.now() - startedAt, passed: false, timedOut, timeoutMs, error: error.message, log: logPath });
		});
		child.on('close', exitCode => {
			clearTimeout(deadline);
			finish({
				command: details.label,
				exitCode: timedOut ? 124 : (exitCode ?? 1),
				durationMs: Date.now() - startedAt,
				passed: !timedOut && exitCode === 0,
				timedOut,
				timeoutMs,
				testCount: reportedTestCount(output),
				log: logPath,
			});
		});
	});
}

async function run() {
	mkdirSync(logRoot, { recursive: true });
	const metadata = phase3EvidenceMetadata(repo, 'assurance');
	const commands = [];
	for (const command of PHASE3_ASSURANCE_COMMANDS) {
		console.log(`[phase3-assurance] ${command.join(' ')}`);
		commands.push(await runCommand(command));
	}
	const result = { ...metadata, ok: commands.every(command => command.passed), commands };
	writeFileSync(join(evidenceRoot, 'assurance.json'), `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify({ ok: result.ok, sourceHead: result.sourceHead, failed: commands.filter(command => !command.passed).map(command => command.command) }, null, 2));
	if (!result.ok) {
		process.exitCode = 1;
	}
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}

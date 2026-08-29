#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

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

export function assuranceEvidenceOk(sourceHead, evidence) {
	if (!evidence || evidence.ok !== true || evidence.sourceHead !== sourceHead || evidence.scenario !== 'assurance') {
		return { ok: false, reason: 'assurance metadata is invalid' };
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
	const logPath = join(logRoot, `${command[0].replaceAll(':', '-')}.log`);
	return new Promise(resolveRun => {
		const startedAt = Date.now();
		const log = createWriteStream(logPath);
		let output = '';
		let settled = false;
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
		child.on('error', error => {
			finish({ command: details.label, exitCode: 1, durationMs: Date.now() - startedAt, passed: false, error: error.message, log: logPath });
		});
		child.on('close', exitCode => {
			finish({ command: details.label, exitCode: exitCode ?? 1, durationMs: Date.now() - startedAt, passed: exitCode === 0, testCount: reportedTestCount(output), log: logPath });
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

#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyGraphsOut } from './verify-graphs-out.mjs';
import { verifyMagnusOut } from './verify-magnus-out.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const WORKBENCH_DESKTOP_MAIN = path.join(
	REPO_ROOT,
	'out/vs/workbench/workbench.desktop.main.js',
);
const ELECTRON_WORKBENCH_ENTRY = path.join(
	REPO_ROOT,
	'out/vs/code/electron-browser/workbench/workbench.js',
);

const LAUNCH_TIMEOUT_MS = 60_000;
const SUCCESS_MARKER = 'Started local extension host';
/** Emitted by PreBaseWorkbenchReadyContribution after workbench AfterRestored. */
const WORKBENCH_RESTORED_MARKER = '[PreBase] workbench restored';
const MAGNUS_ACTIVATED_MARKER = '[Magnus] activation completed';
const EXT_HOST_ACTIVATE_MARKER = 'ExtensionService#_doActivateExtension prebase.magnus';

const FAIL_PATTERNS = [
	/ERR_FILE_NOT_FOUND.*\/graphs\//i,
	/ERR_FILE_NOT_FOUND.*(entryDetector|graphGenerator|ignorePatterns|importExtractors|layoutEngine|fileTypeColors|architectureLayers|layoutDepthColors|projectFiles|languageStats|hierarchyLayout|fileDescription)\.js/i,
	/Failed to fetch dynamically imported module/i,
	/\[Magnus\] activation failed/i,
	/Tool ".*" was not contributed/i,
];

/**
 * @param {string} dir
 * @returns {string}
 */
function readAllLogs(dir) {
	let text = '';
	if (!fs.existsSync(dir)) {
		return text;
	}
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			text += '\n' + readAllLogs(full);
		} else if (entry.isFile() && (entry.name.endsWith('.log') || entry.name.endsWith('.txt'))) {
			try {
				text += '\n' + fs.readFileSync(full, 'utf8');
			} catch {
				// ignore read errors
			}
		}
	}
	return text;
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} userDataDir
 * @param {() => string} getCapturedOutput
 * @returns {Promise<'ok' | 'fail' | 'timeout'>}
 */
function waitForStartupSignals(child, userDataDir, getCapturedOutput) {
	const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
	let sawExtensionHost = false;
	let sawWorkbenchRestored = false;
	let sawMagnusActivated = false;

	return new Promise((resolve) => {
		const tick = () => {
			if (child.exitCode !== null) {
				resolve('fail');
				return;
			}
			const logsRoot = path.join(userDataDir, 'logs');
			const logText = fs.existsSync(logsRoot) ? readAllLogs(logsRoot) : '';
			const combined = getCapturedOutput() + '\n' + logText;

			if (combined.includes(SUCCESS_MARKER)) {
				sawExtensionHost = true;
			}
			if (combined.includes(WORKBENCH_RESTORED_MARKER)) {
				sawWorkbenchRestored = true;
			}
			if (combined.includes(MAGNUS_ACTIVATED_MARKER) || (combined.includes(EXT_HOST_ACTIVATE_MARKER) && combined.includes('magnus/auto'))) {
				sawMagnusActivated = true;
			}
			if (sawExtensionHost && sawWorkbenchRestored && sawMagnusActivated) {
				resolve('ok');
				return;
			}
			for (const pattern of FAIL_PATTERNS) {
				if (pattern.test(combined)) {
					console.error(`verify:startup: launch failure matched ${pattern}`);
					resolve('fail');
					return;
				}
			}
			if (Date.now() >= deadline) {
				if (!sawExtensionHost) {
					console.error(`verify:startup: missing marker "${SUCCESS_MARKER}"`);
				}
				if (!sawWorkbenchRestored) {
					console.error(`verify:startup: missing marker "${WORKBENCH_RESTORED_MARKER}" (workbench AfterRestored)`);
				}
				if (!sawMagnusActivated) {
					console.error(`verify:startup: missing marker "${MAGNUS_ACTIVATED_MARKER}"`);
				}
				resolve('timeout');
				return;
			}
			setTimeout(tick, 500);
		};
		tick();
	});
}

/**
 * @returns {Promise<boolean>}
 */
async function optionalLaunchCheck() {
	const stamp = Date.now();
	const userDataDir = path.join(REPO_ROOT, `.tmp/startup-verify-userdata-${stamp}`);
	const extensionsDir = path.join(REPO_ROOT, `.tmp/startup-verify-extensions-${stamp}`);
	fs.mkdirSync(userDataDir, { recursive: true });
	fs.mkdirSync(extensionsDir, { recursive: true });

	let capturedOutput = '';
	const codeSh = path.join(REPO_ROOT, 'scripts/code.sh');
	const child = spawn(
		codeSh,
		[
			'--user-data-dir',
			userDataDir,
			'--extensions-dir',
			extensionsDir,
			'--extensionDevelopmentPath=' + path.join(REPO_ROOT, 'extensions/prebase-magnus'),
			'--enable-proposed-api=prebase.magnus',
			'--disable-workspace-trust',
			'.',
		],
		{
			cwd: REPO_ROOT,
			env: {
				...process.env,
				VSCODE_SKIP_PRELAUNCH: '1',
				PREBASE_MAGNUS_EXT_DEV: '1',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);

	child.stdout?.on('data', (c) => { capturedOutput += c.toString(); });
	child.stderr?.on('data', (c) => { capturedOutput += c.toString(); });

	let result;
	try {
		result = await waitForStartupSignals(child, userDataDir, () => capturedOutput);
	} finally {
		if (child.exitCode === null && child.pid) {
			try {
				process.kill(child.pid, 'SIGTERM');
			} catch {
				// process may already be gone
			}
		}
	}

	const keep = process.env.PREBASE_STARTUP_KEEP === '1' || result !== 'ok';
	if (!keep) {
		for (const dir of [userDataDir, extensionsDir]) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
		}
	}

	if (result === 'ok') {
		console.log('verify:startup: launch check PASS (extension host + workbench restored + Magnus activated)');
		return true;
	}
	if (result === 'timeout') {
		console.error(`verify:startup: launch timed out after ${LAUNCH_TIMEOUT_MS}ms (need "${SUCCESS_MARKER}", "${WORKBENCH_RESTORED_MARKER}", and "${MAGNUS_ACTIVATED_MARKER}")`);
		console.error(`verify:startup: preserved profile for inspection: ${userDataDir}`);
		return false;
	}
	console.error('verify:startup: launch check FAIL');
	console.error(`verify:startup: preserved profile for inspection: ${userDataDir}`);
	return false;
}

async function main() {
	/** @type {string[]} */
	const errors = [];

	const graphs = verifyGraphsOut();
	if (!graphs.ok) {
		errors.push(...graphs.errors.map((e) => `graphs-out: ${e}`));
	}

	const magnus = verifyMagnusOut();
	if (!magnus.ok) {
		errors.push(...magnus.errors.map((e) => `magnus-out: ${e}`));
	}

	for (const [label, abs] of [
		['workbench.desktop.main.js', WORKBENCH_DESKTOP_MAIN],
		['electron workbench entry', ELECTRON_WORKBENCH_ENTRY],
	]) {
		if (!fs.existsSync(abs)) {
			errors.push(`missing ${label}: ${path.relative(REPO_ROOT, abs)}`);
		}
	}

	if (errors.length > 0) {
		console.error('verify:startup: FAIL (static)');
		for (const err of errors) {
			console.error(`  - ${err}`);
		}
		process.exit(1);
	}

	console.log('verify:startup: static checks PASS');

	if (process.env.PREBASE_STARTUP_LAUNCH === '1') {
		const launchOk = await optionalLaunchCheck();
		if (!launchOk) {
			process.exit(1);
		}
	} else {
		console.log('verify:startup: launch skipped (set PREBASE_STARTUP_LAUNCH=1 to enable)');
	}

	process.exit(0);
}

main().catch((err) => {
	console.error('verify:startup: unexpected error', err);
	process.exit(1);
});

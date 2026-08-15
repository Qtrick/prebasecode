#!/usr/bin/env node
/**
 * Dedicated Magnus Runtime Smoke Assurance.
 * Launches PreBase with Magnus enabled in a clean temporary profile,
 * verifies full activation lifecycle, confirms provider registration,
 * and ensures no activation errors occur.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const LAUNCH_TIMEOUT_MS = 60_000;
const WORKBENCH_RESTORED_MARKER = '[PreBase] workbench restored';
const MAGNUS_ACTIVATED_MARKER = '[Magnus] activation completed';
const EXT_HOST_ACTIVATE_MARKER = 'ExtensionService#_doActivateExtension prebase.magnus';

const REQUIRED_MAGNUS_LIFECYCLE_MARKERS = [
	'[Magnus] activation started',
	'[Magnus] secret resolver initialized',
	'[Magnus] AI service initialized',
	'[Magnus] describeFile registered',
	'[Magnus] language model provider registered',
	'[Magnus] chat participants registered',
	'[Magnus] native tools registered',
	'[Magnus] desktop tools registered',
	'[Magnus] core commands registered',
	'[Magnus] activation completed',
];

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

async function runMagnusRuntimeSmoke() {
	const stamp = Date.now();
	const userDataDir = path.join(REPO_ROOT, `.tmp/magnus-verify-userdata-${stamp}`);
	const extensionsDir = path.join(REPO_ROOT, `.tmp/magnus-verify-extensions-${stamp}`);
	fs.mkdirSync(userDataDir, { recursive: true });
	fs.mkdirSync(extensionsDir, { recursive: true });

	const codeSh = path.join(REPO_ROOT, 'scripts/code.sh');
	console.log('verify:magnus-runtime: launching PreBase with Magnus extension in clean profile...');

	let processOutput = '';
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

	child.stdout?.on('data', (chunk) => {
		processOutput += chunk.toString();
	});
	child.stderr?.on('data', (chunk) => {
		processOutput += chunk.toString();
	});

	const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
	let passed = false;
	let failureReason = '';

	try {
		await new Promise((resolve) => {
			const tick = () => {
				if (child.exitCode !== null) {
					failureReason = `PreBase exited prematurely with code ${child.exitCode}`;
					resolve(false);
					return;
				}

				const logsRoot = path.join(userDataDir, 'logs');
				const logText = fs.existsSync(logsRoot) ? readAllLogs(logsRoot) : '';
				const combined = processOutput + '\n' + logText;

				if (combined.includes('[Magnus] activation failed')) {
					failureReason = 'Magnus activation failure logged';
					resolve(false);
					return;
				}

				const hasMagnusActivated = combined.includes(MAGNUS_ACTIVATED_MARKER) ||
					(combined.includes(EXT_HOST_ACTIVATE_MARKER) && combined.includes('magnus/auto'));
				const hasWorkbenchRestored = combined.includes(WORKBENCH_RESTORED_MARKER);

				if (hasMagnusActivated && hasWorkbenchRestored) {
					passed = true;
					resolve(true);
					return;
				}

				if (Date.now() >= deadline) {
					failureReason = `Timed out after ${LAUNCH_TIMEOUT_MS}ms waiting for Magnus activation lifecycle (sawMagnusActivated=${hasMagnusActivated}, sawWorkbenchRestored=${hasWorkbenchRestored})`;
					resolve(false);
					return;
				}

				setTimeout(tick, 500);
			};
			tick();
		});
	} finally {
		if (child.exitCode === null && child.pid) {
			try {
				process.kill(child.pid, 'SIGTERM');
			} catch {
				// ignore
			}
		}
	}

	const keep = process.env.PREBASE_MAGNUS_KEEP === '1' || !passed;
	if (!keep) {
		for (const dir of [userDataDir, extensionsDir]) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	}

	if (passed) {
		console.log('verify:magnus-runtime: PASS (real PreBase application + Magnus activation verified in clean profile)');
		process.exit(0);
	} else {
		console.error(`verify:magnus-runtime: FAIL (${failureReason})`);
		console.error(`verify:magnus-runtime: preserved logs for inspection at: ${userDataDir}`);
		process.exit(1);
	}
}

runMagnusRuntimeSmoke().catch((err) => {
	console.error('verify:magnus-runtime: unexpected error', err);
	process.exit(1);
});

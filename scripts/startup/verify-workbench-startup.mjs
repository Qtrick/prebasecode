#!/usr/bin/env node
/**
 * Static workbench startup gates (+ optional launch when PREBASE_STARTUP_LAUNCH=1).
 * Includes verify:graphs-out checks.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyGraphsOut } from './verify-graphs-out.mjs';

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

const LAUNCH_TIMEOUT_MS = 45_000;
const SUCCESS_MARKER = 'Started local extension host';
const FAIL_PATTERNS = [
	/ERR_FILE_NOT_FOUND.*\/graphs\//i,
	/ERR_FILE_NOT_FOUND.*(entryDetector|graphGenerator|ignorePatterns|importExtractors|layoutEngine|fileTypeColors|architectureLayers|layoutDepthColors|projectFiles|languageStats|hierarchyLayout|fileDescription)\.js/i,
	/Failed to fetch dynamically imported module/i,
];

/**
 * @param {string} userDataDir
 * @returns {string | undefined}
 */
function findLatestRendererLog(userDataDir) {
	const logsRoot = path.join(userDataDir, 'logs');
	if (!fs.existsSync(logsRoot)) {
		return undefined;
	}
	const sessions = fs
		.readdirSync(logsRoot)
		.map((name) => {
			const full = path.join(logsRoot, name);
			return { full, mtime: fs.statSync(full).mtimeMs };
		})
		.sort((a, b) => b.mtime - a.mtime);
	for (const { full } of sessions) {
		const rendererLog = path.join(full, 'window1', 'renderer.log');
		if (fs.existsSync(rendererLog)) {
			return rendererLog;
		}
	}
	return undefined;
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} userDataDir
 * @returns {Promise<'ok' | 'fail' | 'timeout'>}
 */
function waitForStartupSignals(child, userDataDir) {
	const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
	let lastSize = 0;
	let accumulated = '';

	return new Promise((resolve) => {
		const tick = () => {
			if (child.exitCode !== null) {
				resolve('fail');
				return;
			}
			const logPath = findLatestRendererLog(userDataDir);
			if (logPath) {
				const stat = fs.statSync(logPath);
				if (stat.size > lastSize) {
					const chunk = fs.readFileSync(logPath, 'utf8').slice(lastSize);
					lastSize = stat.size;
					accumulated += chunk;
					if (accumulated.includes(SUCCESS_MARKER)) {
						resolve('ok');
						return;
					}
					for (const pattern of FAIL_PATTERNS) {
						if (pattern.test(accumulated)) {
							console.error(`verify:startup: launch failure matched ${pattern}`);
							resolve('fail');
							return;
						}
					}
				}
			}
			if (Date.now() >= deadline) {
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

	const codeSh = path.join(REPO_ROOT, 'scripts/code.sh');
	const child = spawn(
		codeSh,
		[
			'--user-data-dir',
			userDataDir,
			'--extensions-dir',
			extensionsDir,
			'--disable-extensions',
			'--disable-workspace-trust',
			'.',
		],
		{
			cwd: REPO_ROOT,
			env: {
				...process.env,
				VSCODE_SKIP_PRELAUNCH: '1',
			},
			stdio: 'ignore',
		},
	);

	let result;
	try {
		result = await waitForStartupSignals(child, userDataDir);
	} finally {
		if (child.exitCode === null && child.pid) {
			try {
				process.kill(child.pid, 'SIGTERM');
			} catch {
				// process may already be gone
			}
		}
		for (const dir of [userDataDir, extensionsDir]) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
		}
	}

	if (result === 'ok') {
		console.log('verify:startup: launch check PASS (extension host started, no graph import errors)');
		return true;
	}
	if (result === 'timeout') {
		console.error(`verify:startup: launch timed out after ${LAUNCH_TIMEOUT_MS}ms (no "${SUCCESS_MARKER}")`);
	} else {
		console.error('verify:startup: launch check FAIL');
	}
	return false;
}

async function main() {
	/** @type {string[]} */
	const errors = [];

	const graphs = verifyGraphsOut();
	if (!graphs.ok) {
		errors.push(...graphs.errors.map((e) => `graphs-out: ${e}`));
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

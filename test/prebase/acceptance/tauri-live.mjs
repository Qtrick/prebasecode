#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * BACKEND/FIXTURE ACCEPTANCE.
 * Talks to the Tauri fixture WebDriver directly. This does not prove
 * PreBaseDesktopRuntimeService allocating the driver, waiting for `ready`,
 * or driving locators through interactDesktop.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = join(repo, 'test/prebase/fixtures/desktop-tauri');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/tauri');
const screenshotDir = join(repo, 'reports/graph-acceptance/phase-3-final/screenshots');
const targetDir = join(repo, '.build/tauri-fixture-target');
mkdirSync(evidenceDir, { recursive: true });
mkdirSync(screenshotDir, { recursive: true });

function allocatePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			server.close(error => error || !port ? reject(error ?? new Error('No port allocated')) : resolvePort(port));
		});
		server.once('error', reject);
	});
}

async function request(url, init = {}) {
	const response = await fetch(url, {
		...init,
		headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
	});
	const text = await response.text();
	let body;
	try { body = text ? JSON.parse(text) : undefined; } catch { body = { raw: text.slice(0, 500) }; }
	return { status: response.status, body };
}

async function execute(baseUrl, sessionId, script) {
	const response = await request(`${baseUrl}/session/${sessionId}/execute/sync`, {
		method: 'POST',
		body: JSON.stringify({ script, args: [] }),
	});
	if (response.status >= 400) throw new Error(`WebDriver execute failed: HTTP ${response.status}`);
	return response.body?.value;
}

async function waitForDriver(baseUrl, child, getLog) {
	const deadline = Date.now() + 180_000;
	let last = '';
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`Tauri CLI exited ${child.exitCode}: ${getLog().slice(-2_000)}`);
		try {
			const status = await request(`${baseUrl}/status`);
			const body = status.body && typeof status.body === 'object' ? status.body : {};
			const ready = body.value?.ready === true || body.ready === true;
			if (status.status >= 200 && status.status < 300 && ready) {
				return status;
			}
			last = `HTTP ${status.status} ready=${String(body.value?.ready ?? body.ready)}`;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		await new Promise(resolveWait => setTimeout(resolveWait, 250));
	}
	throw new Error(`Embedded WebDriver did not become ready (${last}): ${getLog().slice(-2_000)}`);
}

function terminateGroup(child, signal) {
	if (!child.pid) return;
	try { process.kill(-child.pid, signal); } catch {
		try { child.kill(signal); } catch { /* already gone */ }
	}
}

async function waitForExit(child, timeoutMs) {
	if (child.exitCode !== null) return true;
	return new Promise(resolveExit => {
		const timer = setTimeout(() => resolveExit(false), timeoutMs);
		child.once('exit', () => {
			clearTimeout(timer);
			resolveExit(true);
		});
	});
}

function isPortOpen(port) {
	return new Promise(resolveOpen => {
		const socket = createConnection({ host: '127.0.0.1', port });
		const finish = value => {
			socket.destroy();
			resolveOpen(value);
		};
		socket.setTimeout(500, () => finish(false));
		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
	});
}

const port = await allocatePort();
const baseUrl = `http://127.0.0.1:${port}`;
const startedAt = Date.now();
const child = spawn('npm', ['run', 'tauri', '--', 'dev', '--features', 'prebase-testing', '--no-watch'], {
	cwd: fixture,
	detached: true,
	env: {
		...process.env,
		CARGO_TARGET_DIR: targetDir,
		CARGO_PROFILE_DEV_DEBUG: '0',
		TAURI_WEBDRIVER_PORT: String(port),
	},
	stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
for (const stream of [child.stdout, child.stderr]) {
	stream.on('data', chunk => {
		log = `${log}${chunk.toString()}`.slice(-40_000);
	});
}

let sessionId;
let result;
try {
	const statusPayload = await waitForDriver(baseUrl, child, () => log);
	const session = await request(`${baseUrl}/session`, {
		method: 'POST',
		body: JSON.stringify({ capabilities: { alwaysMatch: {} } }),
	});
	sessionId = session.body?.value?.sessionId ?? session.body?.sessionId;
	if (!sessionId) throw new Error(`WebDriver did not return a session: ${JSON.stringify(session).slice(0, 500)}`);

	const semanticSnapshot = await execute(baseUrl, sessionId, `
		return {
			title: document.title,
			interactive: Array.from(document.querySelectorAll('input, button, [role]')).map(function (element) {
				return {
					role: element.getAttribute('role') || (element.tagName === 'BUTTON' ? 'button' : element.tagName === 'INPUT' ? 'textbox' : undefined),
					name: element.getAttribute('aria-label') || element.textContent.trim(),
					value: element.value,
				};
			})
		};
	`);
	const nameTarget = semanticSnapshot?.interactive?.find(item => item.role === 'textbox' && item.name === 'Name');
	const greetTarget = semanticSnapshot?.interactive?.find(item => item.role === 'button' && item.name === 'Greet');
	if (!nameTarget || !greetTarget) throw new Error(`Semantic targets missing: ${JSON.stringify(semanticSnapshot)}`);

	await execute(baseUrl, sessionId, `
		const input = document.querySelector('#name');
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
		setter.call(input, 'Ada');
		input.dispatchEvent(new Event('input', { bubbles: true }));
		document.querySelector('#greet').click();
		return true;
	`);

	let backendProof;
	const assertionDeadline = Date.now() + 10_000;
	while (Date.now() < assertionDeadline) {
		backendProof = await execute(baseUrl, sessionId, `
			const status = document.querySelector('#status');
			return { text: status && status.textContent, backendInvoke: status && status.dataset.backendInvoke };
		`);
		if (backendProof?.text === 'Hello, Ada' && backendProof?.backendInvoke === 'true') break;
		await new Promise(resolveWait => setTimeout(resolveWait, 100));
	}
	if (backendProof?.text !== 'Hello, Ada' || backendProof?.backendInvoke !== 'true') {
		throw new Error(`Rust invoke proof failed: ${JSON.stringify(backendProof)}`);
	}

	const screenshot = await request(`${baseUrl}/session/${sessionId}/screenshot`);
	const png = screenshot.body?.value;
	if (typeof png !== 'string' || png.length < 32) throw new Error('WebDriver screenshot was missing');
	const screenshotPath = join(screenshotDir, 'tauri-full-app-rust-invoke.png');
	writeFileSync(screenshotPath, Buffer.from(png, 'base64'));

	result = {
		ok: true,
		framework: 'tauri',
		mode: 'fullApp',
		backend: 'embedded-w3c',
		cli: '@tauri-apps/cli',
		cliVersion: execFileSync(join(fixture, 'node_modules/.bin/tauri'), ['--version'], { encoding: 'utf8' }).trim(),
		appPid: child.pid,
		webDriverPort: port,
		sessionCreated: true,
		semanticSnapshot,
		actions: ['fill Name with Ada', 'click Greet'],
		assertions: ['status == Hello, Ada', 'data-backend-invoke == true'],
		backendProof,
		webDriverStatus: statusPayload,
		screenshotPath: 'reports/graph-acceptance/phase-3-final/screenshots/tauri-full-app-rust-invoke.png',
		startDurationMs: Date.now() - startedAt,
	};
} catch (error) {
	result = { ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) };
} finally {
	if (sessionId) {
		await request(`${baseUrl}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined);
	}
	const quitStartedAt = Date.now();
	terminateGroup(child, 'SIGTERM');
	let exited = await waitForExit(child, 10_000);
	if (!exited) {
		terminateGroup(child, 'SIGKILL');
		exited = await waitForExit(child, 3_000);
	}
	await new Promise(resolveWait => setTimeout(resolveWait, 250));
	const portReleased = !(await isPortOpen(port));
	result = {
		...result,
		durationMs: Date.now() - startedAt,
		quit: {
			latencyMs: Date.now() - quitStartedAt,
			exited,
			portReleased,
			remainingOwnedProcesses: exited ? [] : [child.pid],
		},
	};
	result.ok = Boolean(result.ok && exited && portReleased);
	writeFileSync(join(evidenceDir, 'live.json'), JSON.stringify(result, null, 2));
	writeFileSync(join(evidenceDir, 'tauri-dev.log'), log);
}

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

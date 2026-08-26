#!/usr/bin/env node
/**
 * Live Tauri full-app fixture on macOS via embedded WebDriver (no WDIO package).
 * Compiles with --features prebase-testing. Does not auto-install crates from the network
 * during a PreBase test-session start; this harness is an explicit operator run.
 */
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const cwd = join(repo, 'test/prebase/fixtures/desktop-tauri/src-tauri');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3.17/tauri');
mkdirSync(evidenceDir, { recursive: true });

function allocatePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			server.close(err => err || !port ? reject(err ?? new Error('no port')) : resolve(port));
		});
		server.once('error', reject);
	});
}

async function wd(url, init) {
	const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
	const text = await res.text();
	let body;
	try { body = text ? JSON.parse(text) : undefined; } catch { body = { raw: text.slice(0, 400) }; }
	return { status: res.status, body };
}

function killTree(child) {
	if (!child.pid) {
		return;
	}
	try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* ignore */ } }
}

const port = await allocatePort();
const started = Date.now();
const child = spawn('cargo', ['run', '--features', 'prebase-testing'], {
	cwd,
	env: { ...process.env, TAURI_WEBDRIVER_PORT: String(port) },
	stdio: ['ignore', 'pipe', 'pipe'],
	detached: true,
});
let log = '';
child.stdout.on('data', chunk => { log += chunk.toString(); });
child.stderr.on('data', chunk => { log += chunk.toString(); });

try {
	let last = '';
	for (let i = 0; i < 240; i++) {
		if (child.exitCode !== null) {
			throw new Error(`cargo run exited ${child.exitCode}: ${log.slice(-1500)}`);
		}
		try {
			const status = await wd(`http://127.0.0.1:${port}/status`);
			if (status.status > 0 && status.status < 500) {
				last = `ready ${status.status}`;
				break;
			}
			last = `HTTP ${status.status}`;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		if (i === 239) {
			throw new Error(`WebDriver never became ready (${last}): ${log.slice(-1500)}`);
		}
		await new Promise(r => setTimeout(r, 1000));
	}

	const sessionRes = await wd(`http://127.0.0.1:${port}/session`, {
		method: 'POST',
		body: JSON.stringify({ capabilities: { alwaysMatch: {} } }),
	});
	const sessionId = sessionRes.body?.value?.sessionId ?? sessionRes.body?.sessionId;
	if (!sessionId) {
		throw new Error(`no session: ${JSON.stringify(sessionRes).slice(0, 500)}`);
	}

	await wd(`http://127.0.0.1:${port}/session/${sessionId}/execute/sync`, {
		method: 'POST',
		body: JSON.stringify({
			script: `const name = document.querySelector('#name'); name.value = 'Ada'; name.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#greet').click(); return true;`,
			args: [],
		}),
	});

	let statusText = '';
	for (let i = 0; i < 20; i++) {
		const result = await wd(`http://127.0.0.1:${port}/session/${sessionId}/execute/sync`, {
			method: 'POST',
			body: JSON.stringify({ script: 'return document.querySelector("#status")?.textContent || ""', args: [] }),
		});
		statusText = typeof result.body?.value === 'string' ? result.body.value : String(result.body?.value ?? '');
		if (statusText.includes('Hello, Ada')) {
			break;
		}
		await new Promise(r => setTimeout(r, 250));
	}
	if (!statusText.includes('Hello, Ada')) {
		throw new Error(`greet did not update UI: ${statusText}`);
	}

	const shot = await wd(`http://127.0.0.1:${port}/session/${sessionId}/screenshot`);
	const png = shot.body?.value;
	if (typeof png === 'string' && png.length > 32) {
		writeFileSync(join(evidenceDir, 'full-app-greet.png'), Buffer.from(png, 'base64'));
	}
	await wd(`http://127.0.0.1:${port}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined);

	const evidence = {
		framework: 'tauri',
		mode: 'fullApp',
		backend: 'webdriver-embedded',
		appRootFixture: 'test/prebase/fixtures/desktop-tauri',
		sessionStatus: 'passed',
		actionCount: 2,
		assertionCount: 1,
		durationMs: Date.now() - started,
		webDriverPort: port,
		statusText,
		macosPath: 'tauri-plugin-wdio-webdriver embedded server',
		processCleanup: 'pending',
	};
	writeFileSync(join(evidenceDir, 'live.json'), JSON.stringify(evidence, null, 2));
	killTree(child);
	const exited = await new Promise(resolve => {
		const timer = setTimeout(() => resolve(false), 8000);
		child.once('exit', () => { clearTimeout(timer); resolve(true); });
	});
	if (!exited) {
		try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ignore */ }
	}
	evidence.processCleanup = exited ? 'clean' : 'killed';
	writeFileSync(join(evidenceDir, 'live.json'), JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify({ ok: true, ...evidence }));
} catch (error) {
	killTree(child);
	try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ignore */ }
	writeFileSync(join(evidenceDir, 'live-error.log'), `${String(error)}\n\n${log.slice(-4000)}`);
	console.error(error);
	process.exit(1);
}

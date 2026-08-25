/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'node:child_process';

const cdpPort = process.argv[2] || '57124';
const command = process.argv[3] || 'status';

async function main() {
	const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
	const targets = await res.json();
	const pageTarget = targets.find(t => t.type === 'page');
	if (!pageTarget) {
		console.error('No page target found');
		process.exit(1);
	}

	const ws = new globalThis.WebSocket(pageTarget.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.onopen = () => resolve();
		ws.onerror = (e) => reject(e);
	});

	let id = 1;
	const pending = new Map();
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			if (msg.error) reject(new Error(JSON.stringify(msg.error)));
			else resolve(msg.result);
		}
	};

	function evalPage(expr) {
		const reqId = id++;
		return new Promise((resolve, reject) => {
			pending.set(reqId, { resolve, reject });
			ws.send(JSON.stringify({
				id: reqId,
				method: 'Runtime.evaluate',
				params: { expression: expr, awaitPromise: true, returnByValue: true },
			}));
		});
	}

	console.log(`Executing ${command}...`);

	if (command === 'eval') {
		const expr = process.argv.slice(4).join(' ');
		const result = await evalPage(expr);
		console.log('Result:', JSON.stringify(result.result?.value, null, 2));
	} else if (command === 'screenshot') {
		const outPath = process.argv[4] || 'screenshot.png';
		execSync(`screencapture -x "${outPath}"`);
		console.log(`Captured screenshot to ${outPath}`);
	}

	ws.close();
}

main().catch(err => {
	console.error('Action failed:', err);
	process.exit(1);
});

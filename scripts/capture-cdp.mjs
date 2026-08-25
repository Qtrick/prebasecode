/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { writeFileSync } from 'node:fs';

const cdpPort = process.argv[2] || '57124';
const outputPath = process.argv[3] || 'screenshot.png';

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

	function send(method, params = {}) {
		const reqId = id++;
		return new Promise((resolve, reject) => {
			pending.set(reqId, { resolve, reject });
			ws.send(JSON.stringify({ id: reqId, method, params }));
		});
	}

	console.log('Sending Page.captureScreenshot...');
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(outputPath, Buffer.from(data, 'base64'));
	console.log(`Successfully saved screenshot to ${outputPath}`);
	ws.close();
	process.exit(0);
}

main().catch(err => {
	console.error('Capture failed:', err);
	process.exit(1);
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const cdpPort = process.argv[2] || '57124';
const outputPath = process.argv[3] || 'reports/graph-acceptance/phase-3.12/screenshots/phase3_12_temporal_full_map_dark.png';

async function main() {
	const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
	const targets = await res.json();
	const pageTarget = targets.find(t => t.type === 'page');
	if (!pageTarget) {
		console.error('No page target found');
		process.exit(1);
	}

	const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.on('open', resolve);
		ws.on('error', reject);
	});

	let id = 1;
	const pending = new Map();
	ws.on('message', data => {
		const msg = JSON.parse(data.toString());
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			if (msg.error) reject(msg.error);
			else resolve(msg.result);
		}
	});

	function send(method, params = {}) {
		const reqId = id++;
		return new Promise((resolve, reject) => {
			pending.set(reqId, { resolve, reject });
			ws.send(JSON.stringify({ id: reqId, method, params }));
		});
	}

	console.log('Enabling Page & Emulation...');
	await send('Page.enable');
	await send('Page.bringToFront');
	const { data } = await send('Page.captureScreenshot', {
		format: 'png',
		captureBeyondViewport: false,
		fromSurface: true
	});
	writeFileSync(outputPath, Buffer.from(data, 'base64'));
	console.log(`Saved screenshot to ${outputPath}`);
	ws.close();
}

main().catch(err => {
	console.error('Capture failed:', err);
	process.exit(1);
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_EDITOR = path.resolve(__dirname, '../../host/workbench/graphEditor.ts');

function webviewHtml(): string {
	const src = fs.readFileSync(GRAPH_EDITOR, 'utf8');
	const start = src.indexOf('return `<!DOCTYPE html>');
	const end = src.indexOf('`;', start);
	assert.ok(start >= 0 && end > start, '_buildHtml template not found');
	return Function('nonce', 'return ' + src.slice(start + 'return '.length, end + 1))('test-nonce');
}

function webviewScript(): string {
	const match = webviewHtml().match(/<script[^>]*>([\s\S]*)<\/script>/i);
	assert.ok(match, 'webview <script> block missing');
	return match[1];
}

suite('Code Graph webview HTML', () => {
	test('embedded webview script parses (template-literal escapes must survive)', () => {
		const html = webviewHtml();
		const match = html.match(/<script[^>]*>([\s\S]*)<\/script>/i);
		assert.ok(match, 'webview <script> block missing');
		assert.doesNotThrow(() => {
			 
			new Function(match[1]);
		}, 'webview script must be valid JS after template evaluation');
		assert.ok(html.includes(`style-src 'unsafe-inline'`), 'style-src must allow element.style / attributes');
		assert.ok(html.includes('#toolbar label#idleToggleWrap'), 'Idle must be CSS-hidden before script runs');
	});

	test('render loop parks when the scene is static', () => {
		const script = webviewScript();
		assert.ok(/if \(animating \|\| dirty\) wakeRaf\(\);/.test(script), 'rafLoop must only reschedule while animating or dirty');
		assert.ok(!/^\s*requestAnimationFrame\(rafLoop\);\s*$/m.test(script), 'rafLoop must not be rescheduled unconditionally');
		assert.ok(/function markDirty\(\)/.test(script), 'invalidation must funnel through markDirty so the parked loop restarts');
	});

	test('host requests always settle', () => {
		const script = webviewScript();
		assert.ok(/REQUEST_TIMEOUT_MS/.test(script), 'request() must time out rather than hang the caller forever');
	});
});

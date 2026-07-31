/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_EDITOR = path.resolve(__dirname, '../../host/workbench/graphEditor.ts');

suite('Code Graph webview HTML', () => {
	test('embedded webview script parses (template-literal escapes must survive)', () => {
		const src = fs.readFileSync(GRAPH_EDITOR, 'utf8');
		const start = src.indexOf('return `<!DOCTYPE html>');
		const end = src.indexOf('`;', start);
		assert.ok(start >= 0 && end > start, '_buildHtml template not found');
		const html = Function('nonce', 'return ' + src.slice(start + 'return '.length, end + 1))('test-nonce');
		const match = html.match(/<script[^>]*>([\s\S]*)<\/script>/i);
		assert.ok(match, 'webview <script> block missing');
		assert.doesNotThrow(() => {
			 
			new Function(match[1]);
		}, 'webview script must be valid JS after template evaluation');
		assert.ok(html.includes("style-src 'unsafe-inline'"), 'style-src must allow element.style / attributes');
		assert.ok(html.includes('#toolbar label#idleToggleWrap'), 'Idle must be CSS-hidden before script runs');
	});
});

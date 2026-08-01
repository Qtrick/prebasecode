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

/**
 * Execute the webview's own `rafLoop` body once against a stub scene and report
 * how many frames it drew and whether it rescheduled itself.
 */
function runRafLoop(script: string, scene: { dirty: boolean; snapshot: unknown; autoRotate: boolean; idlePaused: boolean }): { draws: number; wakes: number } {
	const body = script.match(/function rafLoop\(ts\) \{[\s\S]*?\n\}/);
	assert.ok(body, 'rafLoop not found in the webview script');

	const harness = new Function('scene', `
		const IDLE_YAW = 0.1;
		const document = { hidden: false };
		const settings = { networkIdleAutoRotate: scene.autoRotate, reduceMotion: false };
		const rotation = { yaw: 0, pitch: 0 };
		let snapshot = scene.snapshot;
		let idlePaused = scene.idlePaused;
		let dragging = false;
		let dirty = scene.dirty;
		let lastRafTs = 0;
		let rafHandle = 1;
		let draws = 0;
		let wakes = 0;
		function drawNetworkFrame() { draws++; dirty = false; }
		function wakeRaf() { if (rafHandle) { return; } rafHandle = 1; wakes++; }
		${body[0]}
		rafLoop(16);
		return { draws, wakes };
	`) as (scene: unknown) => { draws: number; wakes: number };
	return harness(scene);
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
		assert.ok(!/^\s*requestAnimationFrame\(rafLoop\);\s*$/m.test(script), 'rafLoop must not be rescheduled unconditionally');
		assert.ok(/function markDirty\(\)/.test(script), 'invalidation must funnel through markDirty so the parked loop restarts');

		// Run the real rafLoop body against a stub scene so this asserts
		// behaviour rather than the shape of one source line.
		const frame = (scene: { dirty: boolean; snapshot: unknown; autoRotate: boolean; idlePaused: boolean }) => runRafLoop(script, scene);

		const idle = frame({ dirty: false, snapshot: {}, autoRotate: false, idlePaused: true });
		assert.deepStrictEqual(idle, { draws: 0, wakes: 0 }, 'a static scene must neither draw nor reschedule');

		const invalidated = frame({ dirty: true, snapshot: {}, autoRotate: false, idlePaused: true });
		assert.deepStrictEqual(invalidated, { draws: 1, wakes: 0 }, 'a dirty scene draws once and then parks');

		const rotating = frame({ dirty: false, snapshot: {}, autoRotate: true, idlePaused: false });
		assert.deepStrictEqual(rotating, { draws: 1, wakes: 1 }, 'auto-rotate keeps the loop alive');

		const noSnapshot = frame({ dirty: true, snapshot: null, autoRotate: false, idlePaused: true });
		assert.deepStrictEqual(noSnapshot, { draws: 0, wakes: 0 }, 'a dirty flag with nothing to draw must not spin the loop');
	});

	test('host requests always settle', () => {
		const script = webviewScript();
		assert.ok(/REQUEST_TIMEOUT_MS/.test(script), 'request() must time out rather than hang the caller forever');
	});
});

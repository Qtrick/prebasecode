/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { interpolateWebviewScript } from '../../host/workbench/temporalRuntimeContracts.js';

type Listener = (event: Record<string, unknown>) => void;

class FakeElement {
	readonly style: Record<string, string> = { display: 'block', cursor: 'default' };
	readonly classList = {
		values: new Set<string>(),
		add(...names: string[]) { for (const n of names) { this.values.add(n); } },
		remove(...names: string[]) { for (const n of names) { this.values.delete(n); } },
		contains(name: string) { return this.values.has(name); },
	};
	readonly listeners = new Map<string, Listener[]>();
	readonly clientWidth = 800;
	readonly clientHeight = 600;
	id = '';
	private capturedPointer: number | undefined;

	addEventListener(type: string, listener: Listener): void {
		const list = this.listeners.get(type) ?? [];
		list.push(listener);
		this.listeners.set(type, list);
	}

	dispatch(type: string, event: Record<string, unknown>): void {
		const resolved = {
			isPrimary: true,
			button: 0,
			pointerId: 1,
			pointerType: 'mouse',
			clientX: 0,
			clientY: 0,
			shiftKey: false,
			preventDefault() { },
			...event,
		};
		for (const listener of this.listeners.get(type) ?? []) {
			listener(resolved);
		}
	}

	setPointerCapture(pointerId: number): void {
		this.capturedPointer = pointerId;
	}

	hasPointerCapture(pointerId: number): boolean {
		return this.capturedPointer === pointerId;
	}

	releasePointerCapture(pointerId: number): void {
		if (this.capturedPointer === pointerId) {
			this.capturedPointer = undefined;
		}
	}

	getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
		return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
	}

	setAttribute(): void { }
	appendChild(): void { }
	getContext(): Record<string, unknown> {
		const noop = () => undefined;
		return {
			resetTransform: noop,
			setTransform: noop,
			save: noop,
			restore: noop,
			clearRect: noop,
			fillRect: noop,
			strokeRect: noop,
			roundRect: noop,
			beginPath: noop,
			moveTo: noop,
			lineTo: noop,
			quadraticCurveTo: noop,
			stroke: noop,
			fill: noop,
			arc: noop,
			fillText: noop,
			measureText: () => ({ width: 10 }),
			scale: noop,
			translate: noop,
			setLineDash: noop,
		};
	}
}

function createMetricsHarness(): { canvas: FakeElement; context: vm.Context; flushMetrics(): Record<string, unknown> | null } {
	const editorSource = readFileSync(new URL('../../host/workbench/graphEditor.ts', import.meta.url), 'utf8');
	const html = editorSource.slice(editorSource.indexOf('<script nonce="${nonce}">'));
	let script = html.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/)?.[1];
	assert.ok(script, 'webview script must be present');
	script = interpolateWebviewScript(script, '7', 'network');

	const elements = new Map<string, FakeElement>();
	for (const id of [
		'archSvg', 'netCanvas', 'status', 'legend', 'empty', 'idleToggle', 'idleToggleWrap',
		'toolbar', 'temporalToolbar', 'temporalBreadcrumbTarget', 'temporalBreadcrumbBase', 'temporalRepoWrap', 'temporalRepoSelect', 'temporalScrubberBar', 'temporalRefSelect', 'temporalCompareSelect',
		'temporalFollowHead', 'temporalFilterInput', 'temporalScrubber', 'temporalPrevBtn', 'temporalNextBtn',
		'temporalPlayBtn', 'temporalCommitSha', 'temporalCommitMessage', 'temporalCommitAuthor', 'temporalCommitStatus',
		'temporalPartialWarning', 'badgeAdded', 'badgeRemoved', 'badgeModified', 'badgeRenamed',
		'temporalModeChangesBtn', 'temporalModeStateBtn', 'temporalContextModeWrap', 'temporalContextFocusedBtn', 'temporalContextFullBtn', 'temporalToggleDetailsBtn', 'temporalTimelineStrip', 'temporalLoadMoreBtn',
		'temporalFitBtn', 'temporalCenterLockBtn', 'temporalZoomInBtn', 'temporalZoomOutBtn', 'temporalResetBtn', 'temporalHelpBtn', 'temporalRetryBtn',
		'temporalDetailsPanel', 'temporalDetailsClose', 'temporalDetailsList', 'temporalDetailsSha', 'temporalDetailsAuthor', 'temporalDetailsParents', 'temporalDetailsSummary',
		'popup', 'popupTitle', 'popupMeta', 'popupLayerBadge', 'popupChangeBadge', 'popupDetailsList', 'popupAiWrap', 'popupAi', 'popupAiProvenance',
		'popupClose', 'popupOpen', 'popupHistoricalView', 'popupSourceDiff', 'popupSetBase', 'popupReveal', 'popupMagnus', 'noChangesCard', 'noChangesViewSource',
		'graphLiveRegion', 'graphKbdHelp', 'graphHelpBtn', 'zoomIn', 'zoomOut', 'fit', 'centerLock', 'reset', 'temporalLegendBtn',
	]) {
		const el = new FakeElement();
		el.id = id;
		elements.set(id, el);
	}

	const context = vm.createContext({
		acquireVsCodeApi: () => ({ postMessage() { } }),
		document: {
			body: new FakeElement(),
			documentElement: new FakeElement(),
			getElementById(id: string): FakeElement {
				const el = elements.get(id);
				assert.ok(el, `missing element ${id}`);
				return el;
			},
			createElement: () => new FakeElement(),
			addEventListener: () => undefined,
			get hidden() { return false; },
		},
		window: {
			devicePixelRatio: 1,
			innerWidth: 800,
			innerHeight: 600,
			addEventListener: () => undefined,
			matchMedia: () => ({ matches: false }),
			__prebaseRecordRenderMetrics: true,
			__prebaseGraphRenderMetrics: { sequenceId: 0 },
		},
		getComputedStyle: () => ({ getPropertyValue: () => '' }),
		performance: { now: () => 1000 },
		Map, Set, Math, Number, Object, Array, String, Promise,
		setTimeout: () => 1,
		clearTimeout: () => undefined,
		requestAnimationFrame: (cb: () => void) => { cb(); return 1; },
	});

	vm.runInContext(script, context);
	const canvas = elements.get('netCanvas')!;
	canvas.id = 'netCanvas';

	vm.runInContext(`
		snapshot = {
			nodes: [
				{ id: 'a', x: 0, y: 0, z: 0 },
				{ id: 'b', x: 120, y: 40, z: -20 }
			],
			edges: []
		};
		rebuildBase3d(snapshot);
		projectAll();
		transform = { x: 400, y: 300, k: 1 };
		settings.keepGraphCentered = false;
		settings.networkIdleAutoRotate = false;
	`, context);

	return {
		canvas,
		context,
		flushMetrics(): Record<string, unknown> | null {
			vm.runInContext('drawNetworkFrame();', context);
			return vm.runInContext('window.__prebaseGraphRenderMetrics ?? null', context) as Record<string, unknown> | null;
		},
	};
}

suite('PreBase graph editor network render metrics (Campaign XII)', () => {
	test('nodeHits expose worldX/worldY/worldZ aligned with base3d, not screen coords alone', () => {
		const harness = createMetricsHarness();
		const metrics = harness.flushMetrics();
		assert.ok(metrics, 'metrics must be recorded when __prebaseRecordRenderMetrics is enabled');
		const hits = metrics?.nodeHits as Array<Record<string, unknown>> | undefined;
		assert.ok(Array.isArray(hits) && hits.length > 0, 'nodeHits must be populated');

		const hitA = hits!.find(h => h.id === 'a');
		assert.ok(hitA, 'node a must appear in nodeHits');
		for (const key of ['worldX', 'worldY', 'worldZ'] as const) {
			assert.ok(Number.isFinite(hitA![key]), `nodeHits must include finite ${key}`);
		}

		const baseA = vm.runInContext('base3d.a', harness.context) as { x: number; y: number; z: number };
		assert.strictEqual(hitA!.worldX, baseA.x);
		assert.strictEqual(hitA!.worldY, baseA.y);
		assert.strictEqual(hitA!.worldZ, baseA.z);

		// Screen coords must differ from world when transform is applied.
		assert.notStrictEqual(hitA!.x, hitA!.worldX, 'screen x must not be mistaken for worldX');
	});

	test('metrics expose live interactionState during node drag', () => {
		const harness = createMetricsHarness();
		vm.runInContext(`
			selectedNodeId = 'a';
			projectAll();
		`, harness.context);

		const screen = vm.runInContext('({ x: projected.a.x * transform.k + transform.x, y: projected.a.y * transform.k + transform.y })', harness.context) as { x: number; y: number };
		harness.canvas.dispatch('pointerdown', { clientX: screen.x, clientY: screen.y });
		harness.canvas.dispatch('pointermove', { clientX: screen.x + 45, clientY: screen.y + 30 });
		const during = harness.flushMetrics();

		assert.strictEqual(during?.interactionState, 'draggingNode', 'metrics must expose interactionState during selected-node drag');
		assert.strictEqual(vm.runInContext('interactionState', harness.context), 'draggingNode');

		harness.canvas.dispatch('pointerup', { clientX: screen.x + 45, clientY: screen.y + 30 });
		const idle = harness.flushMetrics();
		assert.strictEqual(idle?.interactionState, 'idle', 'metrics must reset interactionState after pointerup');
	});

	test('world coords in nodeHits stay invariant when camera rotates but nodes do not', () => {
		const harness = createMetricsHarness();
		const before = harness.flushMetrics();
		const hitBefore = (before?.nodeHits as Array<Record<string, unknown>>)?.find(h => h.id === 'b');
		assert.ok(hitBefore && Number.isFinite(hitBefore.worldX), 'baseline world coords required');

		harness.canvas.dispatch('pointerdown', { clientX: 500, clientY: 200 });
		harness.canvas.dispatch('pointermove', { clientX: 560, clientY: 260 });
		harness.canvas.dispatch('pointerup', { clientX: 560, clientY: 260 });

		const after = harness.flushMetrics();
		const hitAfter = (after?.nodeHits as Array<Record<string, unknown>>)?.find(h => h.id === 'b');
		assert.ok(hitAfter, 'node b must remain in hits after rotation');
		assert.strictEqual(hitAfter!.worldX, hitBefore!.worldX);
		assert.strictEqual(hitAfter!.worldY, hitBefore!.worldY);
		assert.strictEqual(hitAfter!.worldZ, hitBefore!.worldZ);
	});
});

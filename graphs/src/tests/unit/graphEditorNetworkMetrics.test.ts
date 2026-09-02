/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { interpolateWebviewScript } from '../../host/workbench/temporalRuntimeContracts.js';
import { pointerCaptureLifecycleProven } from '../../view/network/networkAcceptanceMath.js';

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
	captureBehavior: 'normal' | 'reject-set' | 'silent-fail' = 'normal';

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
		if (this.captureBehavior === 'reject-set') {
			throw new Error('setPointerCapture rejected');
		}
		if (this.captureBehavior !== 'silent-fail') {
			this.capturedPointer = pointerId;
		}
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

function createMetricsHarness(): {
	canvas: FakeElement;
	context: vm.Context;
	windowListeners: Map<string, Listener[]>;
	flushMetrics(): Record<string, unknown> | null;
	evaluateCaptureLifecycle(): Record<string, unknown>;
} {
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

	const windowListeners = new Map<string, Listener[]>();

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
			addEventListener(type: string, listener: Listener) {
				const list = windowListeners.get(type) ?? [];
				list.push(listener);
				windowListeners.set(type, list);
			},
			removeEventListener: () => undefined,
			dispatchWindowEvent(type: string, event: Record<string, unknown> = {}) {
				for (const listener of windowListeners.get(type) ?? []) {
					listener(event);
				}
			},
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
		windowListeners,
		flushMetrics(): Record<string, unknown> | null {
			vm.runInContext('drawNetworkFrame();', context);
			return vm.runInContext('window.__prebaseGraphRenderMetrics ?? null', context) as Record<string, unknown> | null;
		},
		evaluateCaptureLifecycle(): Record<string, unknown> {
			return vm.runInContext(`
				(() => {
					const metrics = window.__prebaseGraphRenderMetrics || {};
					const canvas = document.getElementById('netCanvas');
					const lastPointerId = metrics.lastPointerCaptureId;
					let canvasStillHoldsCapture = false;
					if (canvas && typeof canvas.hasPointerCapture === 'function' && Number.isFinite(lastPointerId)) {
						canvasStillHoldsCapture = canvas.hasPointerCapture(lastPointerId);
					}
					let bodyHoldsCapture = false;
					const body = document.body;
					if (body && typeof body.hasPointerCapture === 'function' && Number.isFinite(lastPointerId)) {
						bodyHoldsCapture = body.hasPointerCapture(lastPointerId);
					}
					return {
						captureAcquired: metrics.lastGestureCaptureAcquired === true || metrics.pointerCaptureAcquired === true,
						captureReleased: metrics.lastGestureCaptureReleased === true || metrics.pointerCaptureReleased === true,
						pointerCaptureReleased: metrics.lastGestureCaptureReleased === true || metrics.pointerCaptureReleased === true,
						hasPointerCaptureAfterRelease: metrics.pointerCaptureHeld === true || metrics.pointerCaptureActive === true || canvasStillHoldsCapture,
						hasPointerCaptureOnBody: bodyHoldsCapture,
					};
				})()
			`, context) as Record<string, unknown>;
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

suite('PreBase graph editor pointer capture lifecycle metrics (Campaign XVI)', () => {
	function captureProofInput(harness: ReturnType<typeof createMetricsHarness>): Record<string, unknown> {
		return harness.evaluateCaptureLifecycle();
	}

	test('pointerup preserves lastPointerCaptureId while clearing activePointerId and active capture flags', () => {
		const harness = createMetricsHarness();
		harness.canvas.dispatch('pointerdown', { button: 1, pointerId: 1, clientX: 200, clientY: 200 });
		const during = harness.flushMetrics();
		assert.strictEqual(during?.activePointerId, 1);
		assert.strictEqual(during?.lastPointerCaptureId, 1);
		assert.strictEqual(during?.pointerCaptureActive, true);
		assert.strictEqual(during?.lastGestureCaptureAcquired, true);
		assert.strictEqual(during?.pointerCaptureAcquired, true);
		assert.strictEqual(during?.pointerCaptureReleased, false);
		assert.strictEqual(during?.pointerCaptureHeld, true);

		harness.canvas.dispatch('pointerup', { pointerId: 1, clientX: 200, clientY: 200 });
		const after = harness.flushMetrics();
		assert.strictEqual(after?.activePointerId, null, 'active pointer must clear after release');
		assert.strictEqual(after?.lastPointerCaptureId, 1, 'last gesture pointer id must persist for diagnostics');
		assert.strictEqual(after?.lastGestureTerminationReason, 'pointerup');
		assert.strictEqual(after?.pointerCaptureActive, false, 'active capture flag must clear after gesture');
		assert.strictEqual(after?.lastGestureCaptureAcquired, true, 'last-gesture acquisition must persist for proofs');
		assert.strictEqual(after?.pointerCaptureAcquired, true, 'legacy alias must mirror last-gesture acquisition');
		assert.strictEqual(after?.lastGestureCaptureReleased, true, 'last-gesture release must latch after clean pointerup');
		assert.strictEqual(after?.pointerCaptureReleased, true, 'legacy alias must mirror last-gesture release');
		assert.strictEqual(after?.pointerCaptureHeld, false);
		assert.strictEqual(pointerCaptureLifecycleProven(captureProofInput(harness) as any), true);
	});

	test('pointercancel releases capture without recording lostPointerCaptureObserved', () => {
		const harness = createMetricsHarness();
		harness.canvas.dispatch('pointerdown', { button: 1, pointerId: 2, clientX: 220, clientY: 220 });
		harness.canvas.dispatch('pointercancel', { pointerId: 2, clientX: 260, clientY: 260 });
		const metrics = harness.flushMetrics();
		assert.strictEqual(metrics?.lostPointerCaptureObserved, false);
		assert.strictEqual(metrics?.lastGestureTerminationReason, 'pointercancel');
		assert.strictEqual(metrics?.interactionState, 'idle');
		assert.strictEqual(metrics?.lastGestureCaptureReleased, true);
		assert.strictEqual(metrics?.pointerCaptureActive, false);
		assert.strictEqual(harness.canvas.hasPointerCapture(2), false);
		assert.strictEqual(pointerCaptureLifecycleProven(captureProofInput(harness) as any), true);
	});

	test('lostpointercapture records lostPointerCaptureObserved and returns idle interactionState', () => {
		const harness = createMetricsHarness();
		harness.canvas.dispatch('pointerdown', { button: 1, pointerId: 3, clientX: 180, clientY: 180 });
		harness.canvas.dispatch('lostpointercapture', { pointerId: 3, clientX: 180, clientY: 180 });
		const metrics = harness.flushMetrics();
		assert.strictEqual(metrics?.lostPointerCaptureObserved, true);
		assert.strictEqual(metrics?.lastGestureTerminationReason, 'lostpointercapture');
		assert.strictEqual(metrics?.interactionState, 'idle');
		assert.strictEqual(pointerCaptureLifecycleProven(captureProofInput(harness) as any), true);
	});

	test('window blur mid-drag force-releases capture and records blur termination', () => {
		const harness = createMetricsHarness();
		harness.canvas.dispatch('pointerdown', { button: 1, pointerId: 4, clientX: 240, clientY: 240 });
		assert.strictEqual(harness.canvas.hasPointerCapture(4), true);
		(harness.context.window as { dispatchWindowEvent(type: string): void }).dispatchWindowEvent('blur');
		const metrics = harness.flushMetrics();
		assert.strictEqual(metrics?.activePointerId, null);
		assert.strictEqual(metrics?.lastGestureTerminationReason, 'blur');
		assert.strictEqual(metrics?.lostPointerCaptureObserved, false);
		assert.strictEqual(metrics?.lastGestureCaptureReleased, true);
		assert.strictEqual(metrics?.pointerCaptureActive, false);
		assert.strictEqual(metrics?.pointerCaptureHeld, false);
		assert.strictEqual(pointerCaptureLifecycleProven(captureProofInput(harness) as any), true);
	});

	test('normal pointerdown acquires capture and pointerup releases with lifecycle proof', () => {
		const harness = createMetricsHarness();
		harness.canvas.dispatch('pointerdown', { button: 1, pointerId: 8, clientX: 160, clientY: 160 });
		assert.strictEqual(harness.canvas.hasPointerCapture(8), true);
		const during = harness.flushMetrics();
		assert.strictEqual(during?.lastGestureCaptureAcquired, true);
		assert.strictEqual(during?.pointerCaptureActive, true);
		assert.strictEqual(during?.lostPointerCaptureObserved, false);

		harness.canvas.dispatch('pointerup', { pointerId: 8, clientX: 160, clientY: 160 });
		const after = harness.flushMetrics();
		assert.strictEqual(harness.canvas.hasPointerCapture(8), false);
		assert.strictEqual(after?.lastGestureTerminationReason, 'pointerup');
		assert.strictEqual(after?.lostPointerCaptureObserved, false);
		assert.strictEqual(after?.interactionState, 'idle');
		assert.strictEqual(pointerCaptureLifecycleProven(captureProofInput(harness) as any), true);
	});

	test('adversarial: setPointerCapture throw leaves acquisition unproven', () => {
		const harness = createMetricsHarness();
		harness.canvas.captureBehavior = 'reject-set';
		harness.canvas.dispatch('pointerdown', { button: 1, pointerId: 6, clientX: 100, clientY: 100 });
		const during = harness.flushMetrics();
		assert.strictEqual(during?.pointerCaptureActive, false);
		assert.strictEqual(during?.lastGestureCaptureAcquired, false);
		assert.strictEqual(during?.pointerCaptureHeld, false);
		harness.canvas.dispatch('pointerup', { pointerId: 6, clientX: 100, clientY: 100 });
		assert.strictEqual(pointerCaptureLifecycleProven(captureProofInput(harness) as any), false);
	});

	test('adversarial: silent setPointerCapture failure leaves acquisition unproven', () => {
		const harness = createMetricsHarness();
		harness.canvas.captureBehavior = 'silent-fail';
		harness.canvas.dispatch('pointerdown', { button: 1, pointerId: 7, clientX: 120, clientY: 120 });
		const during = harness.flushMetrics();
		assert.strictEqual(during?.pointerCaptureActive, false);
		assert.strictEqual(during?.lastGestureCaptureAcquired, false);
		assert.strictEqual(harness.canvas.hasPointerCapture(7), false);
		harness.canvas.dispatch('pointerup', { pointerId: 7, clientX: 120, clientY: 120 });
		assert.strictEqual(pointerCaptureLifecycleProven(captureProofInput(harness) as any), false);
	});

	test('diagnostic break: missing last-gesture acquisition fails closed', () => {
		assert.strictEqual(pointerCaptureLifecycleProven({
			captureAcquired: false,
			captureReleased: true,
			pointerCaptureReleased: true,
			hasPointerCaptureAfterRelease: false,
			hasPointerCaptureOnBody: false,
		} as any), false);
	});

	test('diagnostic break: wrong pointer id hides stuck capture and fails closed when release proof is absent', () => {
		const harness = createMetricsHarness();
		harness.canvas.dispatch('pointerdown', { button: 1, pointerId: 5, clientX: 300, clientY: 300 });
		const midGesture = {
			captureAcquired: true,
			captureReleased: false,
			pointerCaptureReleased: false,
			hasPointerCaptureAfterRelease: harness.canvas.hasPointerCapture(99),
			hasPointerCaptureOnBody: false,
		};
		assert.strictEqual(pointerCaptureLifecycleProven(midGesture as any), false);
	});
});

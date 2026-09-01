/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { interpolateWebviewScript } from '../../host/workbench/temporalRuntimeContracts.js';

type Listener = (event: PointerEventLike) => void;

interface PointerEventLike {
	isPrimary: boolean;
	button: number;
	pointerId: number;
	pointerType: string;
	clientX: number;
	clientY: number;
	shiftKey: boolean;
	preventDefault(): void;
}

class FakeClassList {
	private readonly values = new Set<string>();

	add(...names: string[]): void {
		for (const name of names) {
			this.values.add(name);
		}
	}

	remove(...names: string[]): void {
		for (const name of names) {
			this.values.delete(name);
		}
	}

	contains(name: string): boolean {
		return this.values.has(name);
	}
}

class FakeElement {
	readonly style: Record<string, string> = { display: 'none' };
	readonly classList = new FakeClassList();
	readonly listeners = new Map<string, Listener[]>();
	readonly clientWidth = 800;
	readonly clientHeight = 600;
	checked = false;
	onclick: (() => void) | null = null;
	innerHTML = '';
	textContent = '';
	value = '';
	max = '0';
	disabled = false;
	title = '';
	private capturedPointer: number | undefined;

	addEventListener(type: string, listener: Listener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatch(type: string, event: Partial<PointerEventLike>): void {
		const resolved: PointerEventLike = {
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

	setAttribute(_name: string, _value: string): void { }

	appendChild(_child: any): void { }

	getContext(): any {
		return {
			resetTransform() { },
			setTransform() { },
			save() { },
			restore() { },
			clearRect() { },
			fillRect() { },
			strokeRect() { },
			roundRect() { },
			beginPath() { },
			moveTo() { },
			lineTo() { },
			quadraticCurveTo() { },
			stroke() { },
			fill() { },
			arc() { },
			fillText() { },
			measureText() { return { width: 10 }; },
			scale() { },
			translate() { },
			setLineDash() { },
		};
	}
}

function createWebviewHarness(): { canvas: FakeElement; context: vm.Context; runTimers(): void; pendingTimerCount(): number } {
	// The webview's interaction code is embedded in graphEditor.ts, so execute the
	// production script in a DOM-shaped harness instead of maintaining a copy.
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
		'graphLiveRegion', 'graphKbdHelp', 'graphHelpBtn', 'zoomIn', 'zoomOut', 'fit', 'centerLock', 'reset', 'temporalLegendBtn'
	]) {
		elements.set(id, new FakeElement());
	}
	const documentListeners = new Map<string, Listener[]>();
	const document = {
		body: new FakeElement(),
		documentElement: new FakeElement(),
		getElementById(id: string): FakeElement {
			const element = elements.get(id);
			assert.ok(element, `missing fake element: ${id}`);
			return element;
		},
		createElement(_tag: string): FakeElement {
			return new FakeElement();
		},
		addEventListener(type: string, listener: Listener): void {
			documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]);
		},
		get hidden(): boolean { return false; },
	};
	const windowListeners = new Map<string, Listener[]>();
	let nextTimerId = 1;
	const timers = new Map<number, () => void>();
	const context = vm.createContext({
		acquireVsCodeApi: () => ({ postMessage() { } }),
		document,
		window: {
			devicePixelRatio: 1,
			innerWidth: 800,
			innerHeight: 600,
			addEventListener(type: string, listener: Listener): void {
				windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]);
			},
			matchMedia: () => ({ matches: false }),
		},
		getComputedStyle: () => ({
			getPropertyValue: () => '',
		}),
		performance: { now: () => 1000 },
		Map,
		Set,
		Math,
		Number,
		Object,
		Array,
		String,
		Promise,
		setTimeout(callback: () => void) {
			const id = nextTimerId++;
			timers.set(id, callback);
			return id;
		},
		clearTimeout(id: number) { timers.delete(id); },
		requestAnimationFrame() { return 1; },
	});
	vm.runInContext(script, context, { timeout: 1000 });
	return {
		canvas: elements.get('netCanvas')!,
		context,
		runTimers: () => {
			const scheduled = [...timers.values()];
			timers.clear();
			for (const callback of scheduled) {
				callback();
			}
		},
		pendingTimerCount: () => timers.size,
	};
}

suite('PreBase graph editor 3D interaction', () => {
	test('starts the browser graph surface in Network mode before any restored snapshot arrives', () => {
		const harness = createWebviewHarness();
		const graphType = vm.runInContext('graphType', harness.context);
		assert.strictEqual(graphType, 'network');
	});

	test('projects around the graph center with finite depth scaling as yaw changes', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [
					{ id: 'a', x: -100, y: 0, z: 0 },
					{ id: 'b', x: 100, y: 0, z: 0 }
				],
				edges: []
			};
			rebuildBase3d(snapshot);
			projectAll();
		`, harness.context);

		const projectedBefore = vm.runInContext('({ ...projected })', harness.context);
		assert.ok(projectedBefore.a.depthScale > 0 && Number.isFinite(projectedBefore.a.depthScale));
		assert.ok(projectedBefore.b.depthScale > 0 && Number.isFinite(projectedBefore.b.depthScale));

		vm.runInContext(`
			rotation.yaw += Math.PI / 2;
			projectAll();
		`, harness.context);

		const projectedAfter = vm.runInContext('({ ...projected })', harness.context);
		assert.notStrictEqual(projectedAfter.a.x, projectedBefore.a.x);
		assert.ok(projectedAfter.a.depthScale > 0 && Number.isFinite(projectedAfter.a.depthScale));
	});

	test('rebuilds canonical network positions when a relayout advances without a rescan', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 10, y: 20, z: 30 }],
				edges: []
			};
			rebuildBase3d(snapshot);
		`, harness.context);

		let baseNode = vm.runInContext('base3d.a', harness.context);
		assert.deepStrictEqual({ ...baseNode }, { x: 10, y: 20, z: 30 });

		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 40, y: 50, z: 60 }],
				edges: []
			};
			rebuildBase3d(snapshot);
		`, harness.context);

		baseNode = vm.runInContext('base3d.a', harness.context);
		assert.deepStrictEqual({ ...baseNode }, { x: 40, y: 50, z: 60 });
	});

	test('rotates only after the pointer crosses its drag threshold, then cleans up on release', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 0, y: 0, z: 0 }],
				edges: []
			};
			rebuildBase3d(snapshot);
			projectAll();
			transform = { x: 0, y: 0, k: 1 };
			settings.networkIdleAutoRotate = true;
			settings.reduceMotion = false;
		`, harness.context);

		const initial = vm.runInContext('({ yaw: rotation.yaw, x: base3d.a.x, y: base3d.a.y, z: base3d.a.z })', harness.context);
		harness.canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
		harness.canvas.dispatch('pointermove', { clientX: 102, clientY: 100 });
		assert.strictEqual(vm.runInContext('rotation.yaw', harness.context), initial.yaw);

		harness.canvas.dispatch('pointermove', { clientX: 120, clientY: 100 });
		const during = vm.runInContext('({ yaw: rotation.yaw, rotating, draggingNode, x: base3d.a.x, y: base3d.a.y, z: base3d.a.z })', harness.context);
		assert.notStrictEqual(during.yaw, initial.yaw);
		assert.strictEqual(during.rotating, true);
		assert.strictEqual(during.draggingNode, false, 'empty-canvas rotate must not enter node-drag');
		assert.deepStrictEqual({ x: during.x, y: during.y, z: during.z }, { x: initial.x, y: initial.y, z: initial.z });

		harness.canvas.dispatch('pointerup', { clientX: 120, clientY: 100 });
		assert.strictEqual(vm.runInContext('rotating', harness.context), false);
		assert.strictEqual(vm.runInContext('dragging', harness.context), false);
		assert.strictEqual(vm.runInContext('activePointerId', harness.context), null);
	});

	test('honors natural and inverted drag direction without exposing unbounded camera angles', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 0, y: 0, z: 0 }],
				edges: []
			};
			rebuildBase3d(snapshot);
			projectAll();
			transform = { x: 0, y: 0, k: 1 };
			settings.networkDragDirection = 'natural';
		`, harness.context);

		harness.canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
		harness.canvas.dispatch('pointermove', { clientX: 130, clientY: 100 });
		const naturalYaw = vm.runInContext('rotation.yaw', harness.context);
		harness.canvas.dispatch('pointerup', { clientX: 130, clientY: 100 });

		vm.runInContext(`
			rotation.yaw = 0.55;
			settings.networkDragDirection = 'inverted';
		`, harness.context);

		harness.canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
		harness.canvas.dispatch('pointermove', { clientX: 130, clientY: 100 });
		const invertedYaw = vm.runInContext('rotation.yaw', harness.context);
		harness.canvas.dispatch('pointerup', { clientX: 130, clientY: 100 });

		assert.ok(naturalYaw < 0.55, 'natural drag to the right should rotate yaw negatively');
		assert.ok(invertedYaw > 0.55, 'inverted drag to the right should rotate yaw positively');
	});

	test('unselected node + drag rotates the camera, does not move the node, and does not select on release', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 0, y: 0, z: 0 }],
				edges: []
			};
			rebuildBase3d(snapshot);
			projectAll();
			transform = { x: 0, y: 0, k: 1 };
			selectedNodeId = null;
		`, harness.context);

		const before = vm.runInContext('({ ...base3d.a, yaw: rotation.yaw })', harness.context);
		harness.canvas.dispatch('pointerdown', { clientX: 0, clientY: 0 });
		harness.canvas.dispatch('pointermove', { clientX: 40, clientY: 10 });
		const during = vm.runInContext('({ ...base3d.a, yaw: rotation.yaw, draggingNode, rotating })', harness.context);
		assert.strictEqual(during.draggingNode, false, 'unselected node drag must not enter draggingNode');
		assert.strictEqual(during.rotating, true, 'unselected node drag must rotate the camera');
		assert.deepStrictEqual({ x: during.x, y: during.y, z: during.z }, { x: before.x, y: before.y, z: before.z }, 'unselected node position must be unchanged');
		assert.notStrictEqual(during.yaw, before.yaw, 'camera yaw must change during rotation');

		harness.canvas.dispatch('pointerup', { clientX: 40, clientY: 10 });
		assert.strictEqual(vm.runInContext('rotating', harness.context), false);
		assert.strictEqual(vm.runInContext('selectedNodeId', harness.context), null, 'unselected node drag must not select node on release');
	});

	test('unselected node + single click selects the node', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 0, y: 0, z: 0 }],
				edges: []
			};
			rebuildBase3d(snapshot);
			projectAll();
			transform = { x: 0, y: 0, k: 1 };
			selectedNodeId = null;
		`, harness.context);

		harness.canvas.dispatch('pointerdown', { clientX: 0, clientY: 0 });
		harness.canvas.dispatch('pointerup', { clientX: 1, clientY: 1 });
		assert.strictEqual(vm.runInContext('selectedNodeId', harness.context), 'a', 'single click selects the unselected node');
	});

	test('already-selected node + second click-hold-drag updates its world position without rotating camera', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 0, y: 0, z: 0 }],
				edges: []
			};
			rebuildBase3d(snapshot);
			projectAll();
			transform = { x: 0, y: 0, k: 1 };
			selectedNodeId = 'a';
		`, harness.context);

		const before = vm.runInContext('({ ...base3d.a, yaw: rotation.yaw })', harness.context);
		harness.canvas.dispatch('pointerdown', { clientX: 0, clientY: 0 });
		harness.canvas.dispatch('pointermove', { clientX: 40, clientY: 10 });
		const during = vm.runInContext('({ ...base3d.a, yaw: rotation.yaw, draggingNode, rotating })', harness.context);
		assert.strictEqual(during.draggingNode, true, 'selected node drag must enter draggingNode');
		assert.strictEqual(during.rotating, false, 'selected node drag must not rotate camera');
		assert.ok(Math.hypot(during.x - before.x, during.y - before.y, during.z - before.z) > 1, 'selected node must move in world space');
		assert.strictEqual(during.yaw, before.yaw, 'camera yaw must remain unchanged');

		harness.canvas.dispatch('pointerup', { clientX: 40, clientY: 10 });
		assert.strictEqual(vm.runInContext('draggingNode', harness.context), false);
		assert.strictEqual(vm.runInContext('selectedNodeId', harness.context), 'a', 'node remains selected after drag release');
	});

	test('selected node A + subsequent drag on unselected node B rotates graph without dragging B', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [
					{ id: 'a', x: 0, y: 0, z: 0 },
					{ id: 'b', x: 100, y: 0, z: 0 }
				],
				edges: []
			};
			rebuildBase3d(snapshot);
			projectAll();
			transform = { x: 0, y: 0, k: 1 };
			selectedNodeId = 'a';
		`, harness.context);

		const beforeB = vm.runInContext('({ ...base3d.b, yaw: rotation.yaw })', harness.context);
		const bScreen = vm.runInContext('({ x: projected.b.x, y: projected.b.y })', harness.context);

		harness.canvas.dispatch('pointerdown', { clientX: bScreen.x, clientY: bScreen.y });
		harness.canvas.dispatch('pointermove', { clientX: bScreen.x + 30, clientY: bScreen.y + 10 });
		const during = vm.runInContext('({ ...base3d.b, yaw: rotation.yaw, draggingNode, rotating })', harness.context);
		assert.strictEqual(during.draggingNode, false, 'dragging unselected node B must not enter draggingNode');
		assert.strictEqual(during.rotating, true, 'dragging unselected node B must rotate camera');
		assert.deepStrictEqual({ x: during.x, y: during.y, z: during.z }, { x: beforeB.x, y: beforeB.y, z: beforeB.z });

		harness.canvas.dispatch('pointerup', { clientX: bScreen.x + 30, clientY: bScreen.y + 10 });
		assert.strictEqual(vm.runInContext('rotating', harness.context), false);
	});

	test('pointer starting on empty canvas rotates the camera without dragging a node', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 0, y: 0, z: 0 }],
				edges: []
			};
			rebuildBase3d(snapshot);
			projectAll();
			transform = { x: 0, y: 0, k: 1 };
		`, harness.context);

		assert.ok(vm.runInContext('pickNetworkNode(0, 0)', harness.context), 'origin must be a real node hit so empty-canvas is a distinct branch');
		assert.strictEqual(vm.runInContext('pickNetworkNode(100, 100)', harness.context), null);

		const before = vm.runInContext('({ ...base3d.a, yaw: rotation.yaw })', harness.context);
		harness.canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
		harness.canvas.dispatch('pointermove', { clientX: 140, clientY: 110 });
		const during = vm.runInContext('({ ...base3d.a, yaw: rotation.yaw, draggingNode, rotating })', harness.context);

		assert.strictEqual(during.draggingNode, false);
		assert.strictEqual(during.rotating, true);
		assert.deepStrictEqual({ x: during.x, y: during.y, z: during.z }, { x: before.x, y: before.y, z: before.z });
		assert.notStrictEqual(during.yaw, before.yaw);

		harness.canvas.dispatch('pointerup', { clientX: 140, clientY: 110 });
		assert.strictEqual(vm.runInContext('rotating', harness.context), false);
		assert.strictEqual(vm.runInContext('draggingNode', harness.context), false);
	});

	test('selection locks idle camera rotation even when a previously scheduled resume races selection', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 0, y: 0, z: 0 }],
				edges: []
			};
			settings.networkIdleAutoRotate = true;
			settings.reduceMotion = false;
			selectedNodeId = 'a';
			scheduleIdleResume();
		`, harness.context);

		harness.runTimers();
		const canRotate = vm.runInContext('canIdleRotate()', harness.context);
		assert.strictEqual(canRotate, false);
	});

	test('closing a popup retains selection lock, while deselection resumes only after its idle delay', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 0, y: 0, z: 0 }],
				edges: []
			};
			settings.networkIdleAutoRotate = true;
			settings.reduceMotion = false;
			selectedNodeId = 'a';
			closePopup();
		`, harness.context);

		assert.strictEqual(vm.runInContext('canIdleRotate()', harness.context), false);

		vm.runInContext(`
			selectedNodeId = null;
			scheduleIdleResume();
		`, harness.context);

		assert.strictEqual(vm.runInContext('canIdleRotate() && !idlePaused', harness.context), false);
		harness.runTimers();
		assert.strictEqual(vm.runInContext('canIdleRotate() && !idlePaused', harness.context), true);
	});

	test('selected node + small movement below threshold does not accidentally move node', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 0, y: 0, z: 0 }],
				edges: []
			};
			rebuildBase3d(snapshot);
			projectAll();
			transform = { x: 0, y: 0, k: 1 };
			selectedNodeId = 'a';
		`, harness.context);

		const before = vm.runInContext('({ ...base3d.a })', harness.context);
		harness.canvas.dispatch('pointerdown', { clientX: 0, clientY: 0 });
		// Movement of 2px is below dragThreshold (4px)
		harness.canvas.dispatch('pointermove', { clientX: 2, clientY: 1 });
		const during = vm.runInContext('({ ...base3d.a, draggingNode, rotating })', harness.context);
		assert.strictEqual(during.draggingNode, false);
		assert.strictEqual(during.rotating, false);
		assert.deepStrictEqual({ x: during.x, y: during.y, z: during.z }, { x: before.x, y: before.y, z: before.z });

		harness.canvas.dispatch('pointerup', { clientX: 2, clientY: 1 });
		assert.strictEqual(vm.runInContext('selectedNodeId', harness.context), 'a');
	});

	test('Shift-key or middle-button pan overrides selected-node drag into viewport panning', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 0, y: 0, z: 0 }],
				edges: []
			};
			rebuildBase3d(snapshot);
			projectAll();
			transform = { x: 0, y: 0, k: 1 };
			selectedNodeId = 'a';
		`, harness.context);

		const beforeNode = vm.runInContext('({ ...base3d.a })', harness.context);
		const beforeTransform = vm.runInContext('({ ...transform })', harness.context);

		harness.canvas.dispatch('pointerdown', { clientX: 0, clientY: 0, shiftKey: true });
		harness.canvas.dispatch('pointermove', { clientX: 30, clientY: 20, shiftKey: true });
		const during = vm.runInContext('({ ...base3d.a, draggingNode, rotating, panning, transform: { ...transform } })', harness.context);

		assert.strictEqual(during.draggingNode, false, 'shift-pan must not enter draggingNode');
		assert.strictEqual(during.panning, true, 'shift-pan must enter panning');
		assert.deepStrictEqual({ x: during.x, y: during.y, z: during.z }, { x: beforeNode.x, y: beforeNode.y, z: beforeNode.z }, 'node must not move during pan');
		assert.notStrictEqual(during.transform.x, beforeTransform.x);

		harness.canvas.dispatch('pointerup', { clientX: 30, clientY: 20, shiftKey: true });
	});

	test('reduced-motion setting preserves two-stage interaction semantics identically', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			snapshot = {
				nodes: [{ id: 'a', x: 0, y: 0, z: 0 }],
				edges: []
			};
			rebuildBase3d(snapshot);
			projectAll();
			transform = { x: 0, y: 0, k: 1 };
			settings.reduceMotion = true;
			selectedNodeId = null;
		`, harness.context);

		// First drag on unselected node rotates
		harness.canvas.dispatch('pointerdown', { clientX: 0, clientY: 0 });
		harness.canvas.dispatch('pointermove', { clientX: 30, clientY: 10 });
		assert.strictEqual(vm.runInContext('rotating', harness.context), true);
		assert.strictEqual(vm.runInContext('draggingNode', harness.context), false);
		harness.canvas.dispatch('pointerup', { clientX: 30, clientY: 10 });

		// Click selects
		harness.canvas.dispatch('pointerdown', { clientX: 0, clientY: 0 });
		harness.canvas.dispatch('pointerup', { clientX: 0, clientY: 0 });
		assert.strictEqual(vm.runInContext('selectedNodeId', harness.context), 'a');

		// Second drag moves node
		const before = vm.runInContext('({ ...base3d.a })', harness.context);
		harness.canvas.dispatch('pointerdown', { clientX: 0, clientY: 0 });
		harness.canvas.dispatch('pointermove', { clientX: 40, clientY: 15 });
		assert.strictEqual(vm.runInContext('draggingNode', harness.context), true);
		assert.strictEqual(vm.runInContext('rotating', harness.context), false);
		const after = vm.runInContext('({ ...base3d.a })', harness.context);
		assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 1);
		harness.canvas.dispatch('pointerup', { clientX: 40, clientY: 15 });
	});
});

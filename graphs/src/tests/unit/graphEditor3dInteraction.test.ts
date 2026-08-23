/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
			beginPath() { },
			moveTo() { },
			lineTo() { },
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
	const script = html.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/)?.[1];
	assert.ok(script, 'webview script must be present');

	const elements = new Map<string, FakeElement>();
	for (const id of [
		'archSvg', 'netCanvas', 'status', 'legend', 'empty', 'idleToggle', 'idleToggleWrap',
		'toolbar', 'temporalToolbar', 'temporalRepoWrap', 'temporalRepoSelect', 'temporalScrubberBar', 'temporalRefSelect', 'temporalCompareSelect',
		'temporalFollowHead', 'temporalFilterInput', 'temporalScrubber', 'temporalPrevBtn', 'temporalNextBtn',
		'temporalPlayBtn', 'temporalCommitSha', 'temporalCommitMessage', 'temporalCommitAuthor', 'temporalCommitStatus',
		'temporalPartialWarning', 'badgeAdded', 'badgeRemoved', 'badgeModified', 'badgeRenamed',
		'temporalModeChangesBtn', 'temporalModeStateBtn', 'temporalContextModeWrap', 'temporalContextFocusedBtn', 'temporalContextFullBtn', 'temporalToggleDetailsBtn', 'temporalTimelineStrip', 'temporalLoadMoreBtn',
		'temporalDetailsPanel', 'temporalDetailsClose', 'temporalDetailsList', 'temporalDetailsSha', 'temporalDetailsAuthor', 'temporalDetailsParents', 'temporalDetailsSummary',
		'popup', 'popupTitle', 'popupMeta', 'popupLayerBadge', 'popupChangeBadge', 'popupDetailsList', 'popupAiWrap', 'popupAi', 'popupAiProvenance',
		'popupClose', 'popupOpen', 'popupHistoricalView', 'popupSourceDiff', 'popupSetBase', 'popupReveal', 'popupMagnus', 'noChangesCard', 'noChangesViewSource', 'zoomIn', 'zoomOut', 'fit', 'reset'
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
			settings.networkIdleAutoRotate = true;
			settings.reduceMotion = false;
		`, harness.context);

		const initialYaw = vm.runInContext('rotation.yaw', harness.context);
		harness.canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
		harness.canvas.dispatch('pointermove', { clientX: 102, clientY: 100 });
		assert.strictEqual(vm.runInContext('rotation.yaw', harness.context), initialYaw);

		harness.canvas.dispatch('pointermove', { clientX: 120, clientY: 100 });
		assert.notStrictEqual(vm.runInContext('rotation.yaw', harness.context), initialYaw);
		assert.strictEqual(vm.runInContext('rotating', harness.context), true);

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

	test('responsive stage resize shifts camera center by half delta while preserving zoom, pan, and rotation', () => {
		const harness = createWebviewHarness();
		vm.runInContext(`
			transform = { x: 10, y: 20, k: 1.5 };
			rotation = { yaw: 0.8, pitch: -0.2 };
			lastViewportW = 800;
			lastViewportH = 600;
			onStageResize(900, 700);
		`, harness.context);

		const updatedTransform = vm.runInContext('({ ...transform })', harness.context);
		const updatedRotation = vm.runInContext('({ ...rotation })', harness.context);

		assert.strictEqual(updatedTransform.k, 1.5);
		assert.strictEqual(updatedTransform.x, 60);
		assert.strictEqual(updatedTransform.y, 70);
		assert.deepStrictEqual({ ...updatedRotation }, { yaw: 0.8, pitch: -0.2 });
	});
});

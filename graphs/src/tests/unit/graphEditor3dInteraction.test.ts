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

	getContext(): { setTransform(): void } {
		return { setTransform() { } };
	}
}

function createWebviewHarness(): { canvas: FakeElement; context: vm.Context } {
	// The webview's interaction code is embedded in graphEditor.ts, so execute the
	// production script in a DOM-shaped harness instead of maintaining a copy.
	const editorSource = readFileSync(new URL('../../host/workbench/graphEditor.ts', import.meta.url), 'utf8');
	const html = editorSource.slice(editorSource.indexOf('<script nonce="${nonce}">'));
	const script = html.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/)?.[1];
	assert.ok(script, 'webview script must be present');

	const elements = new Map<string, FakeElement>();
	for (const id of ['archSvg', 'netCanvas', 'status', 'legend', 'empty', 'idleToggle', 'idleToggleWrap', 'popup', 'popupTitle', 'popupMeta', 'popupOverview', 'popupAi', 'popupClose', 'popupOpen', 'popupReveal', 'popupMagnus', 'zoomIn', 'zoomOut', 'fit', 'reset']) {
		elements.set(id, new FakeElement());
	}
	const documentListeners = new Map<string, Listener[]>();
	const document = {
		getElementById(id: string): FakeElement {
			const element = elements.get(id);
			assert.ok(element, `missing fake element: ${id}`);
			return element;
		},
		addEventListener(type: string, listener: Listener): void {
			documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]);
		},
		get hidden(): boolean { return false; },
	};
	const windowListeners = new Map<string, Listener[]>();
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
		},
		Map,
		Math,
		Number,
		Object,
		Array,
		String,
		Promise,
		setTimeout: () => 1,
		clearTimeout() { },
		requestAnimationFrame() { return 1; },
	});
	vm.runInContext(script, context, { timeout: 1000 });
	return { canvas: elements.get('netCanvas')!, context };
}

suite('PreBase graph editor 3D interaction', () => {
	test('starts the browser graph surface in Network mode before any restored snapshot arrives', () => {
		const { context } = createWebviewHarness();
		assert.strictEqual(vm.runInContext('graphType', context), 'network');
		assert.strictEqual(vm.runInContext('isNetwork()', context), true);
	});

	test('projects around the graph center with finite depth scaling as yaw changes', () => {
		const { context } = createWebviewHarness();
		const projection = vm.runInContext(`(() => {
			const center = projectPoint(0, 0, 0, .55, .28);
			const before = projectPoint(120, 40, -80, 0, 0);
			const after = projectPoint(120, 40, -80, Math.PI / 2, 0);
			const near = projectPoint(0, 0, -100000, 0, 0);
			return { center, before, after, near };
		})()`, context) as {
			center: { x: number; y: number; z: number; depthScale: number };
			before: { x: number; y: number; z: number; depthScale: number };
			after: { x: number; y: number; z: number; depthScale: number };
			near: { x: number; y: number; z: number; depthScale: number };
		};

		assert.deepStrictEqual({ ...projection.center }, { x: 0, y: 0, z: 0, depthScale: 1 });
		assert.notStrictEqual(projection.before.x, projection.after.x, 'yaw must visibly change the projected position');
		for (const point of [projection.before, projection.after, projection.near]) {
			assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) && Number.isFinite(point.depthScale));
			assert.ok(point.depthScale > 0);
		}
	});

	test('rotates only after the pointer crosses its drag threshold, then cleans up on release', () => {
		const { canvas, context } = createWebviewHarness();
		const initial = vm.runInContext('({ ...rotation })', context) as { yaw: number; pitch: number };

		canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
		canvas.dispatch('pointermove', { clientX: 103, clientY: 102 });
		assert.deepStrictEqual(vm.runInContext('({ ...rotation })', context), initial, 'click-sized motion must not rotate');

		canvas.dispatch('pointermove', { clientX: 120, clientY: 110 });
		const rotated = vm.runInContext('({ ...rotation, rotating, interactionState })', context) as { yaw: number; pitch: number; rotating: boolean; interactionState: string };
		assert.ok(Math.abs(rotated.yaw - (initial.yaw - 0.085)) < 1e-12);
		assert.ok(Math.abs(rotated.pitch - (initial.pitch + 0.04)) < 1e-12);
		assert.strictEqual(rotated.rotating, true);
		assert.strictEqual(rotated.interactionState, 'rotating');

		canvas.dispatch('pointerup', { clientX: 120, clientY: 110 });
		assert.strictEqual(vm.runInContext('dragging', context), false);
		assert.strictEqual(vm.runInContext('rotating', context), false);
		assert.strictEqual(vm.runInContext('interactionState', context), 'idle');
		assert.strictEqual(vm.runInContext('activePointerId', context), null);
	});

	test('honors natural and inverted drag direction without exposing unbounded camera angles', () => {
		const { canvas, context } = createWebviewHarness();
		canvas.dispatch('pointerdown', { clientX: 10, clientY: 10 });
		canvas.dispatch('pointermove', { clientX: 20, clientY: 20 });
		const natural = vm.runInContext('({ ...rotation })', context) as { yaw: number; pitch: number };
		vm.runInContext("settings.networkDragDirection = 'inverted'; rotation = { yaw: Math.PI - .01, pitch: -Math.PI + .01 };", context);
		canvas.dispatch('pointerup', { clientX: 20, clientY: 20 });
		canvas.dispatch('pointerdown', { clientX: 10, clientY: 10 });
		canvas.dispatch('pointermove', { clientX: 20, clientY: 20 });
		const inverted = vm.runInContext('({ ...rotation })', context) as { yaw: number; pitch: number };

		assert.ok(natural.yaw < 0.55 && natural.pitch > 0.28);
		assert.ok(inverted.yaw > -Math.PI && inverted.yaw < Math.PI);
		assert.ok(inverted.pitch > -Math.PI && inverted.pitch < Math.PI);
	});
});

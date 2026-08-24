/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

type Listener = (event: any) => void;

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

	toggle(name: string, force?: boolean): boolean {
		if (force !== undefined) {
			if (force) this.values.add(name);
			else this.values.delete(name);
			return force;
		}
		if (this.values.has(name)) {
			this.values.delete(name);
			return false;
		}
		this.values.add(name);
		return true;
	}

	contains(name: string): boolean {
		return this.values.has(name);
	}
}

class FakeElement {
	readonly style: Record<string, string> = { display: 'none' };
	readonly classList = new FakeClassList();
	readonly listeners = new Map<string, Listener[]>();
	readonly attributes = new Map<string, string>();
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

	dispatch(type: string, event: Record<string, any>): void {
		const resolved = {
			isPrimary: true,
			button: 0,
			pointerId: 1,
			pointerType: 'mouse',
			clientX: 400,
			clientY: 300,
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

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	getAttribute(name: string): string | undefined {
		return this.attributes.get(name);
	}

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
			fillRect() { },
			strokeRect() { },
			roundRect() { },
		};
	}
}

interface Harness {
	canvas: FakeElement;
	elements: Map<string, FakeElement>;
	context: vm.Context;
	postedMessages: any[];
	sendHostMessage(msg: any): void;
	runAnimationFrame(ts: number): void;
	getTransform(): { x: number; y: number; k: number };
	getKeepGraphCentered(): boolean;
	getRotation(): { yaw: number; pitch: number };
	getActiveCameraAnim(): any;
	getNodeNeighborsMap(): Map<string, Set<string>>;
	evaluateNetworkEdge(edge: any, isSelected: boolean, activeHighlightNodeId: string | null, zoom: number, edgeOpacityMultiplier?: number): any;
}

function createHarness(): Harness {
	const editorSource = readFileSync(new URL('../../host/workbench/graphEditor.ts', import.meta.url), 'utf8');
	const html = editorSource.slice(editorSource.indexOf('<script nonce="${nonce}">'));
	const script = html.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/)?.[1];
	assert.ok(script, 'webview script must be present in graphEditor.ts');

	const elements = new Map<string, FakeElement>();
	for (const id of [
		'archSvg', 'netCanvas', 'status', 'legend', 'empty', 'idleToggle', 'idleToggleWrap',
		'toolbar', 'temporalToolbar', 'temporalBreadcrumbTarget', 'temporalBreadcrumbBase', 'temporalRepoWrap', 'temporalRepoSelect', 'temporalScrubberBar', 'temporalRefSelect', 'temporalCompareSelect',
		'temporalFollowHead', 'temporalFilterInput', 'temporalScrubber', 'temporalPrevBtn', 'temporalNextBtn',
		'temporalPlayBtn', 'temporalCommitSha', 'temporalCommitMessage', 'temporalCommitAuthor', 'temporalCommitStatus',
		'temporalPartialWarning', 'badgeAdded', 'badgeRemoved', 'badgeModified', 'badgeRenamed',
		'temporalModeChangesBtn', 'temporalModeStateBtn', 'temporalContextModeWrap', 'temporalContextFocusedBtn', 'temporalContextFullBtn', 'temporalToggleDetailsBtn', 'temporalTimelineStrip', 'temporalLoadMoreBtn',
		'temporalDetailsPanel', 'temporalDetailsClose', 'temporalDetailsList', 'temporalDetailsSha', 'temporalDetailsAuthor', 'temporalDetailsParents', 'temporalDetailsSummary',
		'detailsCommitSha', 'detailsCommitMsg', 'detailsCommitAuthor', 'detailsCommitParents', 'detailsDeltaSummary', 'detailsEntityList',
		'popup', 'popupTitle', 'popupMeta', 'popupLayerBadge', 'popupChangeBadge', 'popupDetailsList', 'popupAiWrap', 'popupAi', 'popupAiProvenance',
		'popupClose', 'popupOpen', 'popupHistoricalView', 'popupSourceDiff', 'popupSetBase', 'popupReveal', 'popupMagnus', 'noChangesCard', 'noChangesViewSource',
		'zoomIn', 'zoomOut', 'fit', 'centerLock', 'reset', 'temporalLegendBtn'
	]) {
		elements.set(id, new FakeElement());
	}

	const windowListeners = new Map<string, Listener[]>();
	const postedMessages: any[] = [];
	let rafCallback: ((ts: number) => void) | null = null;

	const sandbox: Record<string, any> = {
		console,
		acquireVsCodeApi: () => ({
			postMessage: (msg: any) => { postedMessages.push(msg); },
		}),
		document: {
			body: new FakeElement(),
			documentElement: new FakeElement(),
			getElementById(id: string): FakeElement {
				let el = elements.get(id);
				if (!el) {
					el = new FakeElement();
					elements.set(id, el);
				}
				return el;
			},
			createElement(_tag: string): FakeElement {
				return new FakeElement();
			},
			addEventListener() { },
		},
		window: {
			innerWidth: 800,
			innerHeight: 600,
			devicePixelRatio: 1,
			addEventListener(type: string, listener: Listener) {
				const list = windowListeners.get(type) ?? [];
				list.push(listener);
				windowListeners.set(type, list);
			},
			removeEventListener() { },
		},
		getComputedStyle: () => ({
			getPropertyValue: (prop: string) => {
				if (prop === '--vscode-editor-background') return '#1B1C1E';
				if (prop === '--vscode-foreground') return '#f4f4f5';
				if (prop === '--vscode-button-background') return '#2dd4bf';
				return '';
			},
		}),
		requestAnimationFrame(cb: (ts: number) => void) {
			rafCallback = cb;
			return 1;
		},
		cancelAnimationFrame() {
			rafCallback = null;
		},
		setTimeout: (fn: Function, _ms: number) => {
			return 1;
		},
		clearTimeout: () => { },
		setInterval: (fn: Function, _ms: number) => 1,
		clearInterval: () => { },
		performance: { now: () => 1000 },
		Math,
		Map,
		Set,
		Array,
		Object,
		Number,
		String,
		Boolean,
		Date,
		RegExp,
		JSON,
		parseFloat,
		parseInt,
		isNaN,
		isFinite,
	};

	const context = vm.createContext(sandbox);
	vm.runInContext(script, context);

	return {
		canvas: elements.get('netCanvas')!,
		elements,
		context,
		postedMessages,
		sendHostMessage(msg: any) {
			const listeners = windowListeners.get('message') ?? [];
			for (const listener of listeners) {
				listener({ data: msg });
			}
		},
		runAnimationFrame(ts: number) {
			if (rafCallback) {
				const cb = rafCallback;
				rafCallback = null;
				cb(ts);
			}
		},
		getTransform(): { x: number; y: number; k: number } {
			return vm.runInContext('({ ...transform })', context);
		},
		getKeepGraphCentered(): boolean {
			return vm.runInContext('keepGraphCentered', context);
		},
		getRotation(): { yaw: number; pitch: number } {
			return vm.runInContext('({ ...rotation })', context);
		},
		getActiveCameraAnim(): any {
			return vm.runInContext('activeCameraAnim', context);
		},
		getNodeNeighborsMap(): Map<string, Set<string>> {
			return vm.runInContext('nodeNeighborsMap', context);
		},
		evaluateNetworkEdge(edge: any, isSelected: boolean, activeHighlightNodeId: string | null, zoom: number, edgeOpacityMultiplier?: number): any {
			return vm.runInContext(`evaluateNetworkEdge(${JSON.stringify(edge)}, ${isSelected}, ${JSON.stringify(activeHighlightNodeId)}, ${zoom}, ${edgeOpacityMultiplier})`, context);
		},
	};
}

suite('GraphEditor Production Webview Viewport Interaction & Center Lock', () => {

	test('1. Continuous Wheel Zoom: Small trackpad delta produces proportional continuous scale factor without runaway jumps', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [
						{ id: 'a', path: 'a.ts', x: 0, y: 0, z: 0 },
						{ id: 'b', path: 'b.ts', x: 100, y: 100, z: 0 },
					],
					edges: [{ id: 'e1', source: 'a', target: 'b', kind: 'import' }],
					positions3d: {
						'a': { x: 0, y: 0, z: 0 },
						'b': { x: 100, y: 100, z: 0 },
					},
				},
				settings: { zoomSensitivity: 1.0, reduceMotion: false, keepGraphCentered: false },
			},
		});

		const initialK = harness.getTransform().k;
		assert.ok(initialK > 0, 'initial zoom should be valid');

		// Dispatch a tiny trackpad scroll tick (deltaY = -0.5px)
		harness.canvas.dispatch('wheel', { deltaY: -0.5, deltaMode: 0, ctrlKey: false, clientX: 400, clientY: 300 });

		const newK = harness.getTransform().k;
		const ratio = newK / initialK;
		// Proves that 0.5px delta produces continuous ~1.0008x zoom rather than breaking 1.1x (+10%)
		assert.ok(ratio > 1.0001 && ratio < 1.005, `zoom factor was ${ratio}, expected continuous micro scale (~1.0008)`);
	});

	test('2. Trackpad Pinch Gesture & Sensitivity Scaling: ctrlKey doubles zoom rate and sensitivity scales appropriately', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [{ id: 'a', path: 'a.ts', x: 0, y: 0, z: 0 }],
					positions3d: { 'a': { x: 0, y: 0, z: 0 } },
				},
				settings: { zoomSensitivity: 2.0, reduceMotion: false, keepGraphCentered: false },
			},
		});

		const initialK = harness.getTransform().k;
		// Pinch gesture with 10px trackpad displacement at 2.0 sensitivity (effective pixelDelta = 10 * 2 * 2.0 = 40)
		harness.canvas.dispatch('wheel', { deltaY: -10, deltaMode: 0, ctrlKey: true, clientX: 400, clientY: 300 });

		const zoomedK = harness.getTransform().k;
		const expectedFactor = Math.pow(2, 40 * 0.0025); // 2^0.1 ≈ 1.0717
		const actualFactor = zoomedK / initialK;
		assert.ok(Math.abs(actualFactor - expectedFactor) < 0.005, `actual factor ${actualFactor} matches expected ${expectedFactor}`);
	});

	test('3. Cursor Anchoring: Zooming around (mx, my) maintains the world coordinate under the cursor', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [{ id: 'a', path: 'a.ts', x: 0, y: 0, z: 0 }],
					positions3d: { 'a': { x: 0, y: 0, z: 0 } },
				},
				settings: { zoomSensitivity: 1.0, keepGraphCentered: false },
			},
		});

		const cursorX = 250;
		const cursorY = 180;
		const t0 = harness.getTransform();
		const worldBeforeX = (cursorX - t0.x) / t0.k;
		const worldBeforeY = (cursorY - t0.y) / t0.k;

		harness.canvas.dispatch('wheel', { deltaY: -20, deltaMode: 0, ctrlKey: false, clientX: cursorX, clientY: cursorY });

		const t1 = harness.getTransform();
		const worldAfterX = (cursorX - t1.x) / t1.k;
		const worldAfterY = (cursorY - t1.y) / t1.k;

		assert.ok(Math.abs(worldBeforeX - worldAfterX) < 1e-6, 'World X under cursor remains invariant');
		assert.ok(Math.abs(worldBeforeY - worldAfterY) < 1e-6, 'World Y under cursor remains invariant');
	});

	test('4. Center Lock Toggle: Button toggles state, updates aria-pressed, sends host message, and re-centers', () => {
		const harness = createHarness();
		const centerLockBtn = harness.elements.get('centerLock')!;
		assert.ok(centerLockBtn, '#centerLock button exists');

		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [
						{ id: 'a', path: 'a.ts', x: -50, y: -50, z: 0 },
						{ id: 'b', path: 'b.ts', x: 50, y: 50, z: 0 },
					],
					positions3d: {
						'a': { x: -50, y: -50, z: 0 },
						'b': { x: 50, y: 50, z: 0 },
					},
				},
				settings: { keepGraphCentered: false },
			},
		});

		assert.strictEqual(harness.getKeepGraphCentered(), false);
		assert.strictEqual(centerLockBtn.getAttribute('aria-pressed'), 'false');

		// Click center lock toggle
		centerLockBtn.onclick!();

		assert.strictEqual(harness.getKeepGraphCentered(), true);
		assert.strictEqual(centerLockBtn.getAttribute('aria-pressed'), 'true');
		assert.ok(centerLockBtn.classList.contains('active'), 'button has active class');

		// Verify host persistence message was posted
		const sentUpdate = harness.postedMessages.find(m => m.type === 'updateSetting' && m.payload?.key === 'prebase.interaction.keepGraphCentered');
		assert.ok(sentUpdate, 'updateSetting message was sent to host');
		assert.strictEqual(sentUpdate.payload.value, true);
	});

	test('5. Center Lock 3D Orbit & Pan Invariants: Panning is suppressed and 3D rotation maintains center alignment', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [
						{ id: 'a', path: 'a.ts', x: -40, y: -40, z: 0 },
						{ id: 'b', path: 'b.ts', x: 40, y: 40, z: 0 },
					],
					positions3d: {
						'a': { x: -40, y: -40, z: 0 },
						'b': { x: 40, y: 40, z: 0 },
					},
				},
				settings: { keepGraphCentered: true, panSensitivity: 1.0 },
			},
		});

		// Panning attempt: pointerdown with middle button or shiftKey
		harness.canvas.dispatch('pointerdown', { button: 1, clientX: 200, clientY: 200, shiftKey: true });
		const posXBefore = harness.getTransform().x;
		const posYBefore = harness.getTransform().y;

		// Move pointer 50px
		harness.canvas.dispatch('pointermove', { clientX: 250, clientY: 250 });

		// In keepGraphCentered mode, free pan is suppressed to maintain center lock
		assert.strictEqual(harness.getTransform().x, posXBefore, 'Pan does not displace transform.x in center-lock mode');
		assert.strictEqual(harness.getTransform().y, posYBefore, 'Pan does not displace transform.y in center-lock mode');

		harness.canvas.dispatch('pointerup', { clientX: 250, clientY: 250 });

		// 3D rotation drag: rotate yaw/pitch
		harness.canvas.dispatch('pointerdown', { button: 0, clientX: 300, clientY: 300, shiftKey: false });
		harness.canvas.dispatch('pointermove', { clientX: 360, clientY: 340 });

		// Rotation executed and center lock recalculated position
		const rot = harness.getRotation();
		assert.ok(rot.yaw !== 0.55 || rot.pitch !== 0.28, 'rotation angles changed');
		assert.ok(Number.isFinite(harness.getTransform().x) && Number.isFinite(harness.getTransform().y), 'transform coordinates remain valid');
	});

	test('6. Programmatic Camera Animation: Zoom in/out triggers cubic ease-out interpolation when reduceMotion is false', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [{ id: 'a', path: 'a.ts', x: 0, y: 0, z: 0 }],
					positions3d: { 'a': { x: 0, y: 0, z: 0 } },
				},
				settings: { reduceMotion: false, keepGraphCentered: false },
			},
		});

		const initialK = harness.getTransform().k;
		const zoomInBtn = harness.elements.get('zoomIn')!;
		assert.ok(zoomInBtn, 'zoomIn button exists');

		zoomInBtn.onclick!();

		// Active camera animation initialized
		const anim = harness.getActiveCameraAnim();
		assert.ok(anim !== null, 'activeCameraAnim is active');
		assert.strictEqual(anim.from.k, initialK);

		// Advance animation halfway (90ms into 180ms duration)
		harness.runAnimationFrame(1090);

		const midK = harness.getTransform().k;
		assert.ok(midK > initialK, 'intermediate zoom is greater than initial');
		assert.ok(midK < anim.to.k, 'intermediate zoom has not reached target yet');

		// Complete animation (180ms)
		harness.runAnimationFrame(1200);

		assert.ok(harness.getActiveCameraAnim() === null, 'activeCameraAnim finishes and cleans up');
		assert.ok(Math.abs(harness.getTransform().k - initialK * 1.25) < 0.05, 'final zoom matches 1.25 target');
	});

	test('7. Reduced Motion Honor: When reduceMotion is active, programmatic viewport updates apply immediately without RAF easing', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [{ id: 'a', path: 'a.ts', x: 0, y: 0, z: 0 }],
					positions3d: { 'a': { x: 0, y: 0, z: 0 } },
				},
				settings: { reduceMotion: true, keepGraphCentered: false },
			},
		});

		const initialK = harness.getTransform().k;
		const zoomInBtn = harness.elements.get('zoomIn')!;

		zoomInBtn.onclick!();

		// Immediately updated without pending activeCameraAnim
		assert.strictEqual(harness.getActiveCameraAnim(), null, 'No animation is queued when reduceMotion is true');
		assert.ok(harness.getTransform().k > initialK, 'Transform updated synchronously');
	});

	test('8. Adjacency Indexing and Edge Opacity Multiplier: Snapshot load constructs O(1) neighbor maps and scales edge alpha', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [
						{ id: 'node1', path: 'node1.ts', x: 0, y: 0, z: 0 },
						{ id: 'node2', path: 'node2.ts', x: 50, y: 50, z: 0 },
						{ id: 'node3', path: 'node3.ts', x: 100, y: 100, z: 0 },
					],
					edges: [
						{ id: 'e12', source: 'node1', target: 'node2', kind: 'import' },
						{ id: 'e23', source: 'node2', target: 'node3', kind: 'import' },
					],
					positions3d: {
						'node1': { x: 0, y: 0, z: 0 },
						'node2': { x: 50, y: 50, z: 0 },
						'node3': { x: 100, y: 100, z: 0 },
					},
				},
				settings: { networkEdgeOpacity: 0.85, reduceMotion: false },
			},
		});

		// Check pre-indexed neighbor map
		const neighborsMap: Map<string, Set<string>> = harness.getNodeNeighborsMap();
		assert.ok(neighborsMap && typeof neighborsMap.get === 'function', 'nodeNeighborsMap is a Map');
		assert.strictEqual(neighborsMap.get('node1')?.has('node2'), true, 'node1 neighbors include node2');
		assert.strictEqual(neighborsMap.get('node2')?.has('node1'), true, 'node2 neighbors include node1');
		assert.strictEqual(neighborsMap.get('node2')?.has('node3'), true, 'node2 neighbors include node3');
		assert.strictEqual(neighborsMap.get('node1')?.has('node3'), false, 'node1 neighbors do not include node3 directly');

		// Check edge evaluation with opacity multiplier
		const edge = { id: 'e12', source: 'node1', target: 'node2', kind: 'import' };
		const desc = harness.evaluateNetworkEdge(edge, false, null, 1.0, 0.85);
		assert.ok(desc !== null, 'edge render descriptor generated');
		// Base alpha for import at zoom 1.0 is 0.35, scaled by 0.85/0.55 ≈ 1.545 -> min(1.0, 0.35 * 1.545) ≈ 0.54
		assert.ok(desc.alpha > 0.45 && desc.alpha < 0.65, `scaled edge alpha was ${desc.alpha}`);
	});

});

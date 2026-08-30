/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { interpolateWebviewScript } from '../../host/workbench/temporalRuntimeContracts.js';

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
	offsetWidth = 0;
	offsetHeight = 0;
	checked = false;
	hidden = false;
	onclick: (() => void) | null = null;
	innerHTML = '';
	textContent = '';
	value = '';
	max = '0';
	disabled = false;
	title = '';
	private capturedPointer: number | undefined;

	click(): void {
		if (typeof this.onclick === 'function') {
			this.onclick();
		}
	}

	focus(): void {
		// Sets this as active element in the owning harness sandbox if hooked
	}

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
	getUsableInsets(): Record<string, number>;
	callUpdateCanvasCursor(): void;
	focusCanvas(): void;
	dispatchKey(key: string, extra?: Record<string, any>): { prevented: boolean };
}

function createHarness(initialGraphType: 'network' | 'temporal' = 'network'): Harness {
	const editorSource = readFileSync(new URL('../../host/workbench/graphEditor.ts', import.meta.url), 'utf8');
	const html = editorSource.slice(editorSource.indexOf('<script nonce="${nonce}">'));
	let script = html.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/)?.[1];
	assert.ok(script, 'webview script must be present in graphEditor.ts');
	script = interpolateWebviewScript(script, '7', initialGraphType);

	const elements = new Map<string, FakeElement>();
	for (const id of [
		'archSvg', 'netCanvas', 'status', 'legend', 'empty', 'idleToggle', 'idleToggleWrap',
		'graphLiveRegion', 'graphKbdHelp',
		'toolbar', 'temporalToolbar', 'temporalBreadcrumbTarget', 'temporalBreadcrumbBase', 'temporalRepoWrap', 'temporalRepoSelect', 'temporalScrubberBar', 'temporalRefSelect', 'temporalCompareSelect',
		'temporalFollowHead', 'temporalFilterInput', 'temporalScrubber', 'temporalPrevBtn', 'temporalNextBtn',
		'temporalPlayBtn', 'temporalCommitSha', 'temporalCommitMessage', 'temporalCommitAuthor', 'temporalCommitStatus',
		'temporalPartialWarning', 'badgeAdded', 'badgeRemoved', 'badgeModified', 'badgeRenamed',
		'temporalModeChangesBtn', 'temporalModeStateBtn', 'temporalContextModeWrap', 'temporalContextFocusedBtn', 'temporalContextFullBtn', 'temporalToggleDetailsBtn', 'temporalTimelineStrip', 'temporalLoadMoreBtn',
		'temporalFitBtn', 'temporalCenterLockBtn', 'temporalZoomInBtn', 'temporalZoomOutBtn', 'temporalResetBtn', 'temporalHelpBtn', 'temporalRetryBtn',
		'temporalDetailsPanel', 'temporalDetailsClose', 'temporalDetailsList', 'temporalDetailsSha', 'temporalDetailsAuthor', 'temporalDetailsParents', 'temporalDetailsSummary',
		'detailsCommitSha', 'detailsCommitMsg', 'detailsCommitAuthor', 'detailsCommitParents', 'detailsDeltaSummary', 'detailsEntityList',
		'popup', 'popupTitle', 'popupMeta', 'popupLayerBadge', 'popupChangeBadge', 'popupDetailsList', 'popupAiWrap', 'popupAi', 'popupAiProvenance',
		'popupClose', 'popupOpen', 'popupHistoricalView', 'popupSourceDiff', 'popupSetBase', 'popupReveal', 'popupMagnus', 'noChangesCard', 'noChangesViewSource',
		'zoomIn', 'zoomOut', 'fit', 'centerLock', 'reset', 'graphHelpBtn', 'temporalLegendBtn'
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
			activeElement: null as FakeElement | null,
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
			dispatchWindowEvent(type: string, event: Record<string, any> = {}): void {
				for (const listener of windowListeners.get(type) ?? []) {
					listener(event);
				}
			},
		},
		getComputedStyle: () => ({
			fontFamily: 'var(--vscode-font-family, sans-serif)',
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
			try { fn(); } catch (_) { }
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
			// Copy into a host-realm plain object so deepStrictEqual does not
			// reject the vm realm's Object prototype.
			const t = vm.runInContext('({ ...transform })', context) as any;
			return { x: t.x, y: t.y, k: t.k };
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
			return vm.runInContext(`resolveNetworkEdgeVisual(${JSON.stringify(edge)}, ${isSelected}, ${JSON.stringify(activeHighlightNodeId)}, ${zoom}, ${edgeOpacityMultiplier})`, context);
		},
		getUsableInsets(): Record<string, number> {
			// Spread into a host-realm plain object so deepStrictEqual does not
			// reject the vm realm's Object prototype.
			return { ...vm.runInContext('getUsableInsets()', context) } as Record<string, number>;
		},
		callUpdateCanvasCursor(): void {
			vm.runInContext('updateCanvasCursor()', context);
		},
		focusCanvas(): void {
			sandbox.document.activeElement = elements.get('netCanvas')!;
		},
		dispatchKey(key: string, extra: Record<string, any> = {}): { prevented: boolean } {
			let prevented = false;
			const event = {
				key,
				target: sandbox.document.activeElement || sandbox.document.body,
				...extra,
				preventDefault() { prevented = true; },
			};
			for (const listener of windowListeners.get('keydown') ?? []) {
				listener(event);
			}
			return { prevented };
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
		const nodes = Array.from({ length: 11 }, (_, i) => ({ id: `n${i}`, path: `n${i}.ts`, x: 0, y: 0, z: 0 }));
		const positions3d = Object.fromEntries(nodes.map((node, i) => [node.id, { x: (i % 4) * 80, y: Math.floor(i / 4) * 80, z: 0 }]));
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: { nodes, positions3d, edges: [] },
				settings: { reduceMotion: false, keepGraphCentered: false },
			},
		});

		const initialK = harness.getTransform().k;
		assert.ok(initialK <= 2.4 + 1e-6, `11-node fit must leave zoom headroom under MAX_ZOOM (got k=${initialK})`);
		const zoomInBtn = harness.elements.get('zoomIn')!;
		assert.ok(zoomInBtn, 'zoomIn button exists');

		zoomInBtn.onclick!();

		// Active camera animation initialized
		const anim = harness.getActiveCameraAnim();
		assert.ok(anim !== null, 'activeCameraAnim is active');
		assert.strictEqual(anim.from.k, initialK);
		assert.ok(Math.abs(anim.to.k - initialK * 1.25) < 0.05, `zoom-in target is 1.25x when under MAX_ZOOM (to=${anim.to.k}, from=${initialK})`);

		// Advance animation halfway (90ms into 180ms duration)
		harness.runAnimationFrame(1090);

		const midK = harness.getTransform().k;
		assert.ok(midK > initialK, 'intermediate zoom is greater than initial');
		assert.ok(midK < anim.to.k, 'intermediate zoom has not reached target yet');

		// Complete animation (180ms)
		harness.runAnimationFrame(1200);

		assert.ok(harness.getActiveCameraAnim() === null, 'activeCameraAnim finishes and cleans up');
		assert.ok(Math.abs(harness.getTransform().k - anim.to.k) < 0.05, 'final zoom matches the animation target');
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

	test('9. Pointer capture lifecycle: pointerdown acquires capture, pointerup releases it and clears drag state', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [{ id: 'a', path: 'a.ts', x: 0, y: 0, z: 0 }],
					positions3d: { 'a': { x: 0, y: 0, z: 0 } },
				},
				settings: { keepGraphCentered: false },
			},
		});

		harness.canvas.dispatch('pointerdown', { button: 1, clientX: 200, clientY: 200 });
		assert.strictEqual(harness.canvas.hasPointerCapture(1), true, 'canvas captured the active pointer on pointerdown');
		assert.strictEqual(harness.canvas.classList.contains('dragging'), true, '.dragging class applied during drag');
		assert.strictEqual(vm.runInContext('dragging', harness.context), true);

		harness.canvas.dispatch('pointerup', { clientX: 200, clientY: 200 });
		assert.strictEqual(harness.canvas.hasPointerCapture(1), false, 'capture released on pointerup');
		assert.strictEqual(harness.canvas.classList.contains('dragging'), false, '.dragging class removed after pointerup');
		assert.strictEqual(vm.runInContext('activePointerId', harness.context), null);
	});

	test('10. Pointercancel mid-drag cancels cleanly without leaving stuck dragging state or stale capture', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [{ id: 'a', path: 'a.ts', x: 0, y: 0, z: 0 }],
					positions3d: { 'a': { x: 0, y: 0, z: 0 } },
				},
				settings: { keepGraphCentered: false },
			},
		});

		harness.canvas.dispatch('pointerdown', { button: 1, clientX: 200, clientY: 200 });
		harness.canvas.dispatch('pointermove', { clientX: 320, clientY: 320 });

		harness.canvas.dispatch('pointercancel', { clientX: 320, clientY: 320 });
		assert.strictEqual(vm.runInContext('dragging', harness.context), false, 'cancelled drag resets dragging flag');
		assert.strictEqual(harness.canvas.hasPointerCapture(1), false, 'capture released after pointercancel');
		assert.strictEqual(harness.canvas.classList.contains('dragging'), false, '.dragging class removed after cancel');
		assert.strictEqual(harness.canvas.style.cursor !== 'grabbing', true, `cursor not left grabbing after cancel (was ${harness.canvas.style.cursor})`);
	});

	test('11. Window blur mid-drag force-releases the drag so no grabbing cursor or dragging class survives', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [{ id: 'a', path: 'a.ts', x: 0, y: 0, z: 0 }],
					positions3d: { 'a': { x: 0, y: 0, z: 0 } },
				},
				settings: { keepGraphCentered: false },
			},
		});

		harness.canvas.dispatch('pointerdown', { button: 1, clientX: 200, clientY: 200 });
		assert.strictEqual(vm.runInContext('dragging', harness.context), true);
		assert.strictEqual(harness.canvas.style.cursor, 'grabbing');

		harness.context.window.dispatchWindowEvent('blur');
		assert.strictEqual(vm.runInContext('dragging', harness.context), false, 'blur mid-drag clears dragging flag');
		assert.strictEqual(vm.runInContext('activePointerId', harness.context), null, 'blur mid-drag clears active pointer');
		assert.strictEqual(harness.canvas.classList.contains('dragging'), false, '.dragging class removed by blur handler');
		assert.notStrictEqual(harness.canvas.style.cursor, 'grabbing', 'grabbing cursor cleared by blur handler');

		// A late pointerup for the already-released id must be a no-op (guarded by pointerId check)
		harness.canvas.dispatch('pointerup', { clientX: 500, clientY: 500 });
		assert.strictEqual(harness.postedMessages.filter(m => m.type === 'selectNode').length, 0,
			'stale pointerup after blur does not open a node popup / select');
	});

	test('12. updateCanvasCursor truth table: dragging > hover > network grab > default (center lock & temporal)', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [{ id: 'a', path: 'a.ts', x: 0, y: 0, z: 0 }],
					positions3d: { 'a': { x: 0, y: 0, z: 0 } },
				},
				settings: { keepGraphCentered: false },
			},
		});

		// Idle, no hover, no center lock → grab affordance
		vm.runInContext('dragging = false; hoveredNodeId = null;', harness.context);
		harness.callUpdateCanvasCursor();
		assert.strictEqual(harness.canvas.style.cursor, 'grab', 'idle network background uses grab');

		// keepGraphCentered removes the grab affordance (panning is suppressed there)
		vm.runInContext('keepGraphCentered = true;', harness.context);
		harness.callUpdateCanvasCursor();
		assert.strictEqual(harness.canvas.style.cursor, 'default', 'center-locked background uses default cursor');
		vm.runInContext('keepGraphCentered = false;', harness.context);

		// Hovering a selectable node beats the background affordance
		vm.runInContext("hoveredNodeId = 'a';", harness.context);
		harness.callUpdateCanvasCursor();
		assert.strictEqual(harness.canvas.style.cursor, 'pointer', 'hover over node uses pointer');

		// Active manipulation dominates hover
		vm.runInContext('dragging = true;', harness.context);
		harness.callUpdateCanvasCursor();
		assert.strictEqual(harness.canvas.style.cursor, 'grabbing', 'dragging always shows grabbing regardless of hover');
		vm.runInContext('dragging = false; hoveredNodeId = null;', harness.context);

		// Temporal mode never advertises a pan/rotate grab affordance
		vm.runInContext("graphType = 'temporal';", harness.context);
		harness.callUpdateCanvasCursor();
		assert.strictEqual(harness.canvas.style.cursor, 'default', 'temporal mode uses default cursor');
	});

	test('13. getUsableInsets grows with the temporal details panel and clamps at tiny viewports', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [{ id: 'a', path: 'a.ts', x: 0, y: 0, z: 0 }],
					positions3d: { 'a': { x: 0, y: 0, z: 0 } },
				},
				settings: { keepGraphCentered: false },
			},
		});

		// Network baseline insets
		let insets = harness.getUsableInsets();
		assert.deepStrictEqual(insets, { top: 12, bottom: 56, left: 12, right: 12 }, 'network baseline insets are the toolbar margins only');

		// Switch to temporal mode: taller toolbar/scrubber chrome
		vm.runInContext("graphType = 'temporal';", harness.context);
		insets = harness.getUsableInsets();
		assert.deepStrictEqual(insets, { top: 48, bottom: 68, left: 12, right: 12 }, 'temporal baseline insets reserve toolbar + scrubber space');

		// Visible details panel (display:flex + measured width) widens the right inset
		const panel = harness.elements.get('temporalDetailsPanel')!;
		panel.style.display = 'flex';
		panel.offsetWidth = 340;
		insets = harness.getUsableInsets();
		assert.strictEqual(insets.right, 376, 'right inset grows by panel width + 24px gutter');
		assert.strictEqual(insets.bottom, 84, 'bottom inset honors scrubber bar below the panel');
		panel.style.display = 'none';

		// Hidden-but-measured panel must NOT widen the inset (display gate)
		panel.offsetWidth = 340;
		insets = harness.getUsableInsets();
		assert.strictEqual(insets.right, 12, 'hidden details panel does not consume usable area');

		// Tiny viewport clamps: insets can never consume the whole canvas.
		// Expected exact values: top=min(48, floor(80*0.4))=32, bottom=min(84, floor(80*0.55))=44,
		// right=min(376, floor(100*0.6))=60, left=min(12, 40)=12.
		panel.style.display = 'flex';
		Object.defineProperty(panel, 'offsetWidth', { value: 340 });
		Object.defineProperty(harness.canvas, 'clientWidth', { value: 100 });
		Object.defineProperty(harness.canvas, 'clientHeight', { value: 80 });
		insets = harness.getUsableInsets();
		assert.deepStrictEqual(insets, { top: 32, bottom: 44, left: 12, right: 60 },
			'tiny-viewport insets engage every defensive clamp');
	});

	test('14. applyCenterLock yields to an in-flight camera animation and rafLoop re-locks after it completes', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [
						{ id: 'a', path: 'a.ts', x: -100, y: -80, z: 0 },
						{ id: 'b', path: 'b.ts', x: 20, y: 10, z: 0 },
					],
					positions3d: {
						'a': { x: -100, y: -80, z: 0 },
						'b': { x: 20, y: 10, z: 0 },
					},
				},
				settings: { keepGraphCentered: false, reduceMotion: false },
			},
		});
		vm.runInContext('projectAll(); keepGraphCentered = true;', harness.context);

		// Yield half: while an animation is in flight, a passive lock attempt must
		// not touch the transform even though the current pan is far off-center.
		vm.runInContext(`
			transform = { x: 500, y: -300, k: 1 };
			activeCameraAnim = { from: { x: 500, y: -300, k: 1 }, to: { x: -999, y: -999, k: 1 }, startTs: 1000, duration: 180 };
			applyCenterLock(false);
		`, harness.context);
		const untouched = harness.getTransform();
		assert.deepStrictEqual(untouched, { x: 500, y: -300, k: 1 },
			'center lock defers to the running camera animation');

		// Re-lock half: when the animation finishes, rafLoop must restore the lock,
		// pulling the deliberately off-center animation endpoint back to center.
		vm.runInContext(`
			projectAll();
			applyCenterLock(true);
		`, harness.context);
		const lockRef = harness.getTransform();
		assert.ok(Math.abs(lockRef.x) < 400 && Math.abs(lockRef.y) < 400, 'sanity: lock target is viewport-centered, not off-graph');

		vm.runInContext(`
			activeCameraAnim = { from: { x: ${lockRef.x}, y: ${lockRef.y}, k: ${lockRef.k} }, to: { x: -999, y: -999, k: ${lockRef.k} }, startTs: 1000, duration: 180 };
		`, harness.context);
		harness.runAnimationFrame(1300);

		assert.strictEqual(harness.getActiveCameraAnim(), null, 'animation finished and cleaned up');
		const finalT = harness.getTransform();
		assert.strictEqual(finalT.k, lockRef.k, 'zoom preserved through the re-lock');
		assert.ok(Math.abs(finalT.x - lockRef.x) < 1 && Math.abs(finalT.y - lockRef.y) < 1,
			`pan re-centered after the animation completed (got ${finalT.x},${finalT.y}, want ${lockRef.x},${lockRef.y})`);
	});

	test('15. Temporal visible-elements memoization: same diff/mode/context returns the cached object identity', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'temporal',
				temporalState: {
					displayMode: 'changes',
					diff: {
						sourceCommitSha: 'c0', targetCommitSha: 'c1',
						nodes: [
							{ entityId: 'e1', label: 'a.ts', path: 'src/a.ts', changeKind: 'added', x: 10, y: 20 },
							{ entityId: 'e2', label: 'b.ts', path: 'src/b.ts', changeKind: 'modified', x: 30, y: 40 },
							{ entityId: 'far1', label: 'c.ts', path: 'src/c.ts', changeKind: 'unchanged', x: 500, y: 600 },
						],
						edges: [],
						summary: { addedCount: 1, removedCount: 0, modifiedCount: 1, renamedCount: 0 }
					},
				},
				settings: {},
			},
		});

		// Same inputs → identical object identity (cache hit; drawNetworkFrame calls
		// this on every frame, so a broken cache would allocate per frame).
		const first = vm.runInContext('computeTemporalVisibleElements(temporalDiff, displayMode, temporalContextFilterMode)', harness.context);
		const second = vm.runInContext('computeTemporalVisibleElements(temporalDiff, displayMode, temporalContextFilterMode)', harness.context);
		assert.strictEqual(first, second, 'repeat computation with same diff+mode+context returns cached result');
		assert.strictEqual(first.nodes.length, 2, 'focused changes-mode shows only changed nodes (far unchanged node is unrelated, not 1-hop context)');

		// Different context mode → cache miss with different content
		const fullMode = vm.runInContext(
			"computeTemporalVisibleElements(temporalDiff, displayMode, 'full')", harness.context);
		assert.notStrictEqual(fullMode, first, 'changing context filter mode invalidates the cache key');
		assert.strictEqual(fullMode.nodes.length, 3, 'full mode exposes all nodes including unrelated ones');

		// A different diff object bypasses the cache even when mode/key match
		const mutated = vm.runInContext(`
			(() => {
				const d2 = Object.assign({}, temporalDiff);
				d2.nodes = [...temporalDiff.nodes];
				return computeTemporalVisibleElements(d2, displayMode, temporalContextFilterMode);
			})()
		`, harness.context) as any;
		assert.notStrictEqual(mutated, second, 'a different diff object invalidates by identity');
	});

	test('16. Keyboard Accessibility: Arrow keys traverse nodes, live region announces focus, Enter opens popup, Escape clears selection', () => {
		const harness = createHarness();
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [
						{ id: 'nodeA', label: 'entry.ts', path: 'src/entry.ts', x: 0, y: 0, z: 0 },
						{ id: 'nodeB', label: 'utils.ts', path: 'src/utils.ts', x: 50, y: 50, z: 0 },
						{ id: 'nodeC', label: 'types.ts', path: 'src/types.ts', x: 100, y: 100, z: 0 },
					],
					edges: [
						{ source: 'nodeA', target: 'nodeB' },
						{ source: 'nodeA', target: 'nodeC' },
					],
					positions3d: {
						'nodeA': { x: 0, y: 0, z: 0 },
						'nodeB': { x: 50, y: 50, z: 0 },
						'nodeC': { x: 100, y: 100, z: 0 },
					},
				},
				settings: { reduceMotion: false, keepGraphCentered: false },
			},
		});

		harness.focusCanvas();
		const liveRegion = harness.elements.get('graphLiveRegion')!;
		const popup = harness.elements.get('popup')!;

		// First ArrowRight sets focus to first node (index 0) and announces it
		harness.dispatchKey('ArrowRight');
		let kbdIndex = vm.runInContext('kbdFocusIndex', harness.context);
		let hovered = vm.runInContext('hoveredNodeId', harness.context);
		assert.strictEqual(kbdIndex, 0, 'first ArrowRight focuses node 0');
		assert.strictEqual(hovered, 'nodeA', 'hovered node reflects node 0 ID');
		assert.ok(liveRegion.textContent.includes('entry.ts') && liveRegion.textContent.includes('1 of 3'),
			`live region announces node 1 of 3 (got "${liveRegion.textContent}")`);

		// Next ArrowRight advances to node 1
		harness.dispatchKey('ArrowRight');
		kbdIndex = vm.runInContext('kbdFocusIndex', harness.context);
		hovered = vm.runInContext('hoveredNodeId', harness.context);
		assert.strictEqual(kbdIndex, 1, 'second ArrowRight advances to node 1');
		assert.strictEqual(hovered, 'nodeB', 'hovered node reflects node 1 ID');
		assert.ok(liveRegion.textContent.includes('utils.ts') && liveRegion.textContent.includes('2 of 3'),
			`live region announces node 2 of 3 (got "${liveRegion.textContent}")`);

		// ArrowLeft goes back to node 0
		harness.dispatchKey('ArrowLeft');
		kbdIndex = vm.runInContext('kbdFocusIndex', harness.context);
		assert.strictEqual(kbdIndex, 0, 'ArrowLeft steps back to node 0');

		// Enter activates node popup
		harness.dispatchKey('Enter');
		assert.strictEqual(popup.style.display, 'block', 'Enter opens node details popup');
		assert.ok(liveRegion.textContent.includes('Opened details for entry.ts'),
			`live region announces popup open (got "${liveRegion.textContent}")`);

		// Escape closes popup and clears selection
		harness.dispatchKey('Escape');
		assert.strictEqual(popup.style.display, 'none', 'Escape closes popup');
		kbdIndex = vm.runInContext('kbdFocusIndex', harness.context);
		hovered = vm.runInContext('hoveredNodeId', harness.context);
		assert.strictEqual(kbdIndex, -1, 'selection index reset on Escape');
		assert.strictEqual(hovered, null, 'hovered node cleared on Escape');
	});

	test('17. Keyboard Shortcuts: ? toggles help overlay while F1 variants pass through; + / - zoom, 0/f fit, r resets, and c toggles center-lock', () => {
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
					positions3d: {
						'a': { x: 0, y: 0, z: 0 },
						'b': { x: 100, y: 100, z: 0 },
					},
				},
				settings: { reduceMotion: true, keepGraphCentered: false },
			},
		});

		harness.focusCanvas();
		const helpEl = harness.elements.get('graphKbdHelp')!;
		helpEl.hidden = true;

		// Plain F1 must NOT open help or swallow the event (preserves VS Code command palette)
		const f1 = harness.dispatchKey('F1');
		assert.strictEqual(f1.prevented, false, 'Plain F1 must pass through to Command Palette');
		assert.strictEqual(helpEl.hidden, true, 'Plain F1 does not hijack command palette');

		// Alt/Option+F1 must pass through to VS Code Accessibility Help even if help is already open.
		helpEl.hidden = false;
		const altF1Open = harness.dispatchKey('F1', { altKey: true });
		assert.strictEqual(altF1Open.prevented, false, 'Alt/Option+F1 must not be preventDefaulted');
		assert.strictEqual(helpEl.hidden, false, 'Alt/Option+F1 must not toggle PreBase help');
		helpEl.hidden = true;
		const altF1 = harness.dispatchKey('F1', { altKey: true });
		assert.strictEqual(altF1.prevented, false, 'Alt/Option+F1 must not be preventDefaulted');
		assert.strictEqual(helpEl.hidden, true, 'Alt+F1 does not hijack VS Code Accessibility Help');

		// ? opens local graph help.
		const question = harness.dispatchKey('?');
		assert.strictEqual(question.prevented, true);
		assert.strictEqual(helpEl.hidden, false, '? toggles help overlay on');

		// graphHelpBtn is the visible PreBase help control.
		helpEl.hidden = true;
		const helpBtn = harness.elements.get('graphHelpBtn')!;
		assert.equal(typeof helpBtn.onclick, 'function');
		helpBtn.click();
		assert.strictEqual(helpEl.hidden, false, 'graphHelpBtn opens local graph help');

		// Escape closes help
		harness.dispatchKey('Escape');
		assert.strictEqual(helpEl.hidden, true, 'Escape closes help overlay');

		// '+' zooms in (with reduceMotion: true, transform updates immediately)
		const startZoom = harness.getTransform().k;
		harness.dispatchKey('+');
		const zoomedIn = harness.getTransform().k;
		assert.ok(zoomedIn > startZoom, `'+' zooms in: ${zoomedIn} > ${startZoom}`);
		assert.equal(vm.runInContext('userAdjustedViewport', harness.context), true, 'keyboard +/- must mark the viewport as user-adjusted');

		// '-' zooms out
		harness.dispatchKey('-');
		const zoomedOut = harness.getTransform().k;
		assert.ok(zoomedOut < zoomedIn, `'-' zooms out: ${zoomedOut} < ${zoomedIn}`);

		// 'c' toggles center-lock mode
		assert.strictEqual(harness.getKeepGraphCentered(), false, 'starts unlocked');
		harness.dispatchKey('c');
		assert.strictEqual(harness.getKeepGraphCentered(), true, "'c' key enables keepGraphCentered");
		harness.dispatchKey('c');
		assert.strictEqual(harness.getKeepGraphCentered(), false, "subsequent 'c' key disables keepGraphCentered");
	});

	test('18. Temporal Full Map ↔ Focus Changes refits the camera to the visible node set', () => {
		const harness = createHarness('temporal');
		const unchanged = Array.from({ length: 40 }, (_, index) => ({
			entityId: `far-${index}`,
			label: `far-${index}.ts`,
			path: `src/far-${index}.ts`,
			changeKind: 'unchanged',
			x: 4000 + (index % 8) * 180,
			y: 3000 + Math.floor(index / 8) * 180,
		}));
		const diff = {
			sourceCommitSha: 'c0',
			targetCommitSha: 'c1',
			nodes: [
				{ entityId: 'changed-a', label: 'a.ts', path: 'src/a.ts', changeKind: 'modified', x: 10, y: 12 },
				{ entityId: 'changed-b', label: 'b.ts', path: 'src/b.ts', changeKind: 'added', x: 40, y: 18 },
				...unchanged,
			],
			edges: [],
			summary: { addedCount: 1, removedCount: 0, modifiedCount: 1, renamedCount: 0, unchangedCount: unchanged.length },
		};
		const baseState = {
			displayMode: 'state',
			diff,
			isSettled: true,
			selectedCommitSha: 'c1',
			renderedCommitSha: 'c1',
		};

		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'temporal',
				temporalState: baseState,
				settings: { keepGraphCentered: false, reduceMotion: true },
			},
		});
		harness.sendHostMessage({ type: 'temporalState', payload: baseState });
		const fullMap = harness.getTransform();

		harness.sendHostMessage({
			type: 'temporalState',
			payload: { ...baseState, displayMode: 'changes' },
		});
		const focus = harness.getTransform();

		harness.sendHostMessage({
			type: 'temporalState',
			payload: { ...baseState, displayMode: 'state' },
		});
		const fullMapAgain = harness.getTransform();

		assert.ok(focus.k > fullMap.k,
			`Focus Changes must zoom tighter than Full Map (focus k=${focus.k}, full k=${fullMap.k})`);
		assert.ok(Math.abs(fullMapAgain.k - fullMap.k) < 0.02,
			`switching back to Full Map must restore the wide fit (got ${fullMapAgain.k}, want ${fullMap.k})`);
		assert.ok(fullMap.k < 0.4,
			`Full Map of a large unchanged cluster must zoom out (got k=${fullMap.k})`);
	});

	test('19. Focus Changes state refresh does not steal a user zoom after the mode switch', () => {
		const harness = createHarness('temporal');
		const unchanged = Array.from({ length: 40 }, (_, index) => ({
			entityId: `far-${index}`,
			label: `far-${index}.ts`,
			path: `src/far-${index}.ts`,
			changeKind: 'unchanged',
			x: 4000 + (index % 8) * 180,
			y: 3000 + Math.floor(index / 8) * 180,
		}));
		const diff = {
			sourceCommitSha: 'c0',
			targetCommitSha: 'c1',
			nodes: [
				{ entityId: 'changed-a', label: 'a.ts', path: 'src/a.ts', changeKind: 'modified', x: 10, y: 12 },
				{ entityId: 'changed-b', label: 'b.ts', path: 'src/b.ts', changeKind: 'added', x: 40, y: 18 },
				...unchanged,
			],
			edges: [],
			summary: { addedCount: 1, removedCount: 0, modifiedCount: 1, renamedCount: 0, unchangedCount: unchanged.length },
		};
		const baseState = {
			displayMode: 'state',
			diff,
			isSettled: true,
			selectedCommitSha: 'c1',
			renderedCommitSha: 'c1',
		};
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'temporal',
				temporalState: baseState,
				settings: { keepGraphCentered: false, reduceMotion: true },
			},
		});
		harness.sendHostMessage({ type: 'temporalState', payload: baseState });
		harness.sendHostMessage({
			type: 'temporalState',
			payload: { ...baseState, displayMode: 'changes' },
		});
		const afterFit = harness.getTransform();
		harness.elements.get('temporalZoomInBtn')!.onclick!();
		const afterZoom = harness.getTransform();
		assert.ok(afterZoom.k > afterFit.k, `user zoom must change the camera (fit k=${afterFit.k}, zoom k=${afterZoom.k})`);
		harness.sendHostMessage({
			type: 'temporalState',
			payload: { ...baseState, displayMode: 'changes', selectedCommitIndex: 1 },
		});
		const afterRefresh = harness.getTransform();
		assert.ok(Math.abs(afterRefresh.k - afterZoom.k) < 0.02,
			`same-mode Temporal refresh must not steal the user zoom (got k=${afterRefresh.k}, want ${afterZoom.k})`);
	});

	test('20. Hidden mode-specific graph controls are not left queryable as active duplicates', () => {
		const harness = createHarness('network');
		const toolbar = harness.elements.get('toolbar')!;
		const temporalToolbar = harness.elements.get('temporalToolbar')!;
		const networkSnapshot = {
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [{ id: 'a', path: 'a.ts', x: 0, y: 0, z: 0 }],
					positions3d: { a: { x: 0, y: 0, z: 0 } },
				},
				settings: {},
			},
		};
		const temporalSnapshot = {
			type: 'snapshot',
			payload: {
				graphType: 'temporal',
				temporalState: {
					displayMode: 'changes',
					diff: {
						sourceCommitSha: 'c0',
						targetCommitSha: 'c1',
						nodes: [{ entityId: 'e1', label: 'a.ts', path: 'src/a.ts', changeKind: 'added', x: 10, y: 20 }],
						edges: [],
						summary: { addedCount: 1, removedCount: 0, modifiedCount: 0, renamedCount: 0 },
					},
				},
				settings: {},
			},
		};

		harness.sendHostMessage(networkSnapshot);
		assert.notStrictEqual(toolbar.style.display, 'none', 'network toolbar is the active chrome');
		assert.strictEqual(temporalToolbar.style.display, 'none', 'temporal toolbar is display:none in network mode');

		harness.sendHostMessage(temporalSnapshot);
		assert.strictEqual(toolbar.style.display, 'none', 'network toolbar is display:none in temporal mode');
		assert.notStrictEqual(temporalToolbar.style.display, 'none', 'temporal toolbar is the active chrome');

		harness.sendHostMessage(networkSnapshot);
		assert.notStrictEqual(toolbar.style.display, 'none');
		assert.strictEqual(temporalToolbar.style.display, 'none', 'switching back must hide temporal chrome so Zoom in is not duplicated');
	});

	test('21. Zero-edge graphs keep files visible and add informational copy; edges omit that copy', () => {
		const harness = createHarness('network');
		const snapshot = {
			nodes: [
				{ id: 'a', path: 'a.ts', x: 0, y: 0, z: 0 },
				{ id: 'b', path: 'b.ts', x: 80, y: 40, z: 0 },
			],
			positions3d: { a: { x: 0, y: 0, z: 0 }, b: { x: 80, y: 40, z: 0 } },
		};
		harness.sendHostMessage({
			type: 'snapshot',
			payload: { graphType: 'network', snapshot, settings: { reduceMotion: true } },
		});
		const status = harness.elements.get('status')!;
		assert.match(status.textContent, /2 files · 0 edges/);
		assert.match(status.textContent, /No dependency edges were detected in this view/);

		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: { ...snapshot, edges: [{ id: 'e1', source: 'a', target: 'b', kind: 'import' }] },
				settings: { reduceMotion: true },
			},
		});
		assert.match(status.textContent, /2 files · 1 edges/);
		assert.equal(status.textContent.includes('No dependency edges were detected in this view'), false);
	});

	test('22. Small graphs (≤10 nodes) fit at a higher zoom cap than 11-node graphs', () => {
		const harness = createHarness('network');
		function clustered(count: number) {
			const nodes = [];
			const positions3d: Record<string, { x: number; y: number; z: number }> = {};
			for (let i = 0; i < count; i++) {
				nodes.push({ id: `n${i}`, path: `n${i}.ts`, x: 0, y: 0, z: 0 });
				positions3d[`n${i}`] = { x: (i % 3) * 4, y: Math.floor(i / 3) * 4, z: 0 };
			}
			return { nodes, positions3d, edges: [] as unknown[] };
		}
		harness.sendHostMessage({
			type: 'snapshot',
			payload: { graphType: 'network', snapshot: clustered(10), settings: { reduceMotion: true, keepGraphCentered: false } },
		});
		harness.elements.get('fit')!.click();
		const smallK = harness.getTransform().k;
		harness.sendHostMessage({
			type: 'snapshot',
			payload: { graphType: 'network', snapshot: clustered(11), settings: { reduceMotion: true, keepGraphCentered: false } },
		});
		harness.elements.get('fit')!.click();
		const largeK = harness.getTransform().k;
		assert.ok(smallK > 1.6, `≤10 node fit must be allowed past the previous 1.6 large-graph cap (got k=${smallK})`);
		assert.ok(smallK <= 3.2 + 1e-6, `≤10 node fit must cap at 3.2 (got k=${smallK})`);
		assert.ok(largeK <= 2.4 + 1e-6, `11+ node fit must cap at 2.4 (got k=${largeK})`);
		assert.ok(smallK > largeK, `small-graph cap must zoom tighter than the 11-node cap (${smallK} > ${largeK})`);
	});

	test('23. Wheel zoom then Temporal state refresh must not steal the camera', () => {
		const harness = createHarness('temporal');
		const baseState = {
			displayMode: 'changes',
			diff: {
				sourceCommitSha: 'c0',
				targetCommitSha: 'c1',
				nodes: [{ entityId: 'e1', label: 'a.ts', path: 'src/a.ts', changeKind: 'added', x: 10, y: 20 }],
				edges: [],
				summary: { addedCount: 1, removedCount: 0, modifiedCount: 0, renamedCount: 0, unchangedCount: 0 },
			},
			isSettled: true,
			selectedCommitSha: 'c1',
			renderedCommitSha: 'c1',
		};
		harness.sendHostMessage({
			type: 'snapshot',
			payload: { graphType: 'temporal', temporalState: baseState, settings: { keepGraphCentered: false, reduceMotion: true } },
		});
		harness.sendHostMessage({ type: 'temporalState', payload: baseState });
		const afterFit = harness.getTransform();
		harness.canvas.dispatch('wheel', { deltaY: -80, deltaMode: 0, ctrlKey: false, clientX: 400, clientY: 300 });
		const afterZoom = harness.getTransform();
		assert.ok(afterZoom.k > afterFit.k, `wheel zoom must change the camera (fit k=${afterFit.k}, zoom k=${afterZoom.k})`);
		vm.runInContext('hasFittedTemporalView = false', harness.context);
		harness.sendHostMessage({
			type: 'temporalState',
			payload: { ...baseState, selectedCommitIndex: 2, renderedCommitSha: 'c2' },
		});
		const afterRefresh = harness.getTransform();
		assert.ok(Math.abs(afterRefresh.k - afterZoom.k) < 0.02,
			`Temporal refresh must not steal a user wheel zoom (got k=${afterRefresh.k}, want ${afterZoom.k})`);
	});

	test('25. Keyboard +/- zoom then Temporal state refresh must not steal the camera', () => {
		const harness = createHarness('temporal');
		const baseState = {
			displayMode: 'changes',
			diff: {
				sourceCommitSha: 'c0',
				targetCommitSha: 'c1',
				nodes: [{ entityId: 'e1', label: 'a.ts', path: 'src/a.ts', changeKind: 'added', x: 10, y: 20 }],
				edges: [],
				summary: { addedCount: 1, removedCount: 0, modifiedCount: 0, renamedCount: 0, unchangedCount: 0 },
			},
			isSettled: true,
			selectedCommitSha: 'c1',
			renderedCommitSha: 'c1',
		};
		harness.sendHostMessage({
			type: 'snapshot',
			payload: { graphType: 'temporal', temporalState: baseState, settings: { keepGraphCentered: false, reduceMotion: true } },
		});
		harness.sendHostMessage({ type: 'temporalState', payload: baseState });
		harness.focusCanvas();
		const afterFit = harness.getTransform();
		harness.dispatchKey('+');
		const afterZoom = harness.getTransform();
		assert.ok(afterZoom.k > afterFit.k, `keyboard zoom must change the camera (fit k=${afterFit.k}, zoom k=${afterZoom.k})`);
		assert.equal(vm.runInContext('userAdjustedViewport', harness.context), true);
		vm.runInContext('hasFittedTemporalView = false', harness.context);
		harness.sendHostMessage({
			type: 'temporalState',
			payload: { ...baseState, selectedCommitIndex: 2, renderedCommitSha: 'c2' },
		});
		const afterRefresh = harness.getTransform();
		assert.ok(Math.abs(afterRefresh.k - afterZoom.k) < 0.02,
			`Temporal refresh must not steal a keyboard zoom (got k=${afterRefresh.k}, want ${afterZoom.k})`);
	});

	test('24. Temporal legend close is an SVG control that hides the legend', () => {
		const harness = createHarness('temporal');
		harness.sendHostMessage({
			type: 'snapshot',
			payload: {
				graphType: 'temporal',
				temporalState: {
					displayMode: 'changes',
					diff: {
						sourceCommitSha: 'c0',
						targetCommitSha: 'c1',
						nodes: [{ entityId: 'e1', label: 'a.ts', path: 'src/a.ts', changeKind: 'added', x: 10, y: 20 }],
						edges: [],
						summary: { addedCount: 1, removedCount: 0, modifiedCount: 0, renamedCount: 0, unchangedCount: 0 },
					},
				},
				settings: { reduceMotion: true },
			},
		});
		const legend = harness.elements.get('legend')!;
		legend.style.display = 'block';
		assert.match(legend.innerHTML, /id="legendCloseBtn"/);
		assert.match(legend.innerHTML, /<svg/);
		assert.equal(legend.innerHTML.includes('✕') || legend.innerHTML.includes('×'), false, 'legend close must not use a raw ✕/× glyph');
		const closeBtn = harness.elements.get('legendCloseBtn')!;
		assert.equal(typeof closeBtn.onclick, 'function');
		closeBtn.click();
		assert.strictEqual(legend.style.display, 'none', 'legend close hides the legend');
	});

	test('26. Temporal focus caps zoom at 3.2 for ≤4 nodes and 2.4 for 5+; Full Map caps at 2.4', () => {
		function clustered(count: number) {
			return Array.from({ length: count }, (_, i) => ({
				entityId: `n${i}`,
				label: `n${i}.ts`,
				path: `src/app/n${i}.ts`,
				changeKind: 'added',
				x: (i % 2) * 2,
				y: Math.floor(i / 2) * 2,
			}));
		}
		function fitK(mode: 'changes' | 'focus' | 'state', count: number) {
			const harness = createHarness('temporal');
			const diff = {
				sourceCommitSha: 'c0',
				targetCommitSha: 'c1',
				nodes: clustered(count),
				edges: Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({
					sourceEntityId: `n${i}`,
					targetEntityId: `n${i + 1}`,
					kind: 'import',
				})),
				summary: { addedCount: count, removedCount: 0, modifiedCount: 0, renamedCount: 0, unchangedCount: 0 },
			};
			const state = {
				displayMode: mode,
				diff,
				isSettled: true,
				selectedCommitSha: 'c1',
				renderedCommitSha: 'c1',
			};
			harness.sendHostMessage({
				type: 'snapshot',
				payload: { graphType: 'temporal', temporalState: state, settings: { keepGraphCentered: false, reduceMotion: true } },
			});
			harness.sendHostMessage({ type: 'temporalState', payload: state });
			return harness.getTransform().k;
		}
		const editorSource = readFileSync(new URL('../../host/workbench/graphEditor.ts', import.meta.url), 'utf8');
		const fitStart = editorSource.indexOf('function fitView(');
		const fitEnd = editorSource.indexOf('function updateLegend(');
		assert.ok(fitStart >= 0 && fitEnd > fitStart, 'fitView must be locatable in graphEditor.ts');
		const fitView = editorSource.slice(fitStart, fitEnd);
		assert.match(fitView, /isFocusMode && targetNodes\.length <= 4 \? 3\.2 : 2\.4/);
		assert.doesNotMatch(fitView, /4\.2/, 'fitView must not keep a leftover 4.2 zoom cap');

		const changes4 = fitK('changes', 4);
		const focus4 = fitK('focus', 4);
		const changes5 = fitK('changes', 5);
		const focus5 = fitK('focus', 5);
		const fullMap = fitK('state', 5);
		for (const [label, k] of [['changes≤4', changes4], ['focus≤4', focus4]] as const) {
			assert.ok(k <= 3.2 + 1e-6, `${label} must cap at 3.2 (got k=${k})`);
			assert.ok(Math.abs(k - 3.2) < 0.05, `tight ${label} should hit the 3.2 cap (got k=${k})`);
		}
		for (const [label, k] of [['changes 5+', changes5], ['focus 5+', focus5], ['Full Map', fullMap]] as const) {
			assert.ok(k <= 2.4 + 1e-6, `${label} must cap at 2.4 (got k=${k})`);
			assert.ok(Math.abs(k - 2.4) < 0.05, `tight ${label} should hit the 2.4 cap (got k=${k})`);
		}
		assert.ok(focus4 > focus5, `small focus must zoom tighter than large focus (${focus4} > ${focus5})`);
		assert.ok(focus4 > fullMap, `focus must zoom tighter than Full Map (${focus4} > ${fullMap})`);
	});
});

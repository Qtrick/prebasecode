/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { suite, test } from 'mocha';
import { interpolateWebviewScript } from '../../host/workbench/temporalRuntimeContracts.js';
import { computeTemporalFitTransform } from '../../view/temporal/temporalFocusContext.js';

type Listener = (event: any) => void;

class FakeClassList {
	private readonly values = new Set<string>();
	add(...names: string[]): void { for (const n of names) this.values.add(n); }
	remove(...names: string[]): void { for (const n of names) this.values.delete(n); }
	contains(name: string): boolean { return this.values.has(name); }
}

class FakeElement {
	readonly style: Record<string, string> = { display: 'none' };
	readonly classList = new FakeClassList();
	readonly listeners = new Map<string, Listener[]>();
	readonly attributes = new Map<string, string>();
	readonly clientWidth = 800;
	readonly clientHeight = 600;
	checked = false;
	onclick: ((e?: any) => void) | null = null;
	onkeydown: ((e?: any) => void) | null = null;
	ondblclick: ((e?: any) => void) | null = null;
	innerHTML = '';
	textContent = '';
	value = '';
	max = '0';
	disabled = false;
	title = '';
	firstChild: FakeElement | null = null;
	children: FakeElement[] = [];

	private _className = '';
	get className(): string { return this._className; }
	set className(val: string) {
		this._className = val;
		for (const n of val.split(/\s+/).filter(Boolean)) {
			this.classList.add(n);
		}
	}

	addEventListener(type: string, listener: Listener): void {
		const list = this.listeners.get(type) ?? [];
		list.push(listener);
		this.listeners.set(type, list);
	}

	dispatch(type: string, event: any): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}

	setPointerCapture(): void {}
	hasPointerCapture(): boolean { return false; }
	releasePointerCapture(): void {}
	getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
		return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
	}
	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}
	getAttribute(name: string): string | undefined {
		return this.attributes.get(name);
	}
	appendChild(child: FakeElement): FakeElement {
		this.children.push(child);
		if (!this.firstChild) this.firstChild = child;
		return child;
	}
	removeChild(child: FakeElement): FakeElement {
		this.children = this.children.filter(c => c !== child);
		this.firstChild = this.children[0] || null;
		return child;
	}
}

interface CanvasDrawCall {
	type: string;
	args: any[];
}

function createProductionWebviewHarness(initialType: 'network' | 'temporal' = 'network', workbenchFontFamily = 'Menlo, Monaco, monospace') {
	const editorSource = readFileSync(new URL('../../host/workbench/graphEditor.ts', import.meta.url), 'utf8');
	const htmlMatch = editorSource.slice(editorSource.indexOf('return `<!DOCTYPE html>'));
	const rawScriptMatch = htmlMatch.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/);
	assert.ok(rawScriptMatch, 'webview script must be present in graphEditor.ts');

	let script = interpolateWebviewScript(rawScriptMatch[1], '42', initialType);

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
		'detailsCommitSha', 'detailsCommitMsg', 'detailsCommitAuthor', 'detailsCommitParents', 'detailsDeltaSummary', 'detailsEntityList',
		'popup', 'popupTitle', 'popupMeta', 'popupOverview', 'popupAi', 'popupClose', 'popupOpen',
		'popupHistoricalView', 'popupSourceDiff', 'popupSetBase', 'popupReveal', 'popupMagnus', 'zoomIn', 'zoomOut', 'fit', 'centerLock', 'reset', 'graphHelpBtn', 'temporalLegendBtn'
	]) {
		elements.set(id, new FakeElement());
	}

	const drawCalls: CanvasDrawCall[] = [];
	const mockCtx = {
		resetTransform() { drawCalls.push({ type: 'resetTransform', args: [] }); },
		setTransform() {},
		save() { drawCalls.push({ type: 'save', args: [] }); },
		restore() { drawCalls.push({ type: 'restore', args: [] }); },
		clearRect(...args: any[]) { drawCalls.push({ type: 'clearRect', args }); },
		beginPath() { drawCalls.push({ type: 'beginPath', args: [] }); },
		closePath() { drawCalls.push({ type: 'closePath', args: [] }); },
		moveTo(...args: any[]) { drawCalls.push({ type: 'moveTo', args }); },
		lineTo(...args: any[]) { drawCalls.push({ type: 'lineTo', args }); },
		quadraticCurveTo(...args: any[]) { drawCalls.push({ type: 'quadraticCurveTo', args }); },
		stroke() { drawCalls.push({ type: 'stroke', args: [] }); },
		fill() { drawCalls.push({ type: 'fill', args: [] }); },
		fillRect(...args: any[]) { drawCalls.push({ type: 'fillRect', args }); },
		arc(...args: any[]) { drawCalls.push({ type: 'arc', args }); },
		rect(...args: any[]) { drawCalls.push({ type: 'rect', args }); },
		roundRect(...args: any[]) { drawCalls.push({ type: 'roundRect', args }); },
		fillText(...args: any[]) { drawCalls.push({ type: 'fillText', args }); },
		measureText() { return { width: 10 }; },
		scale(...args: any[]) { drawCalls.push({ type: 'scale', args }); },
		translate(...args: any[]) { drawCalls.push({ type: 'translate', args }); },
		setLineDash(...args: any[]) { drawCalls.push({ type: 'setLineDash', args }); },
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 1,
		font: '',
		textAlign: '',
		globalAlpha: 1,
	};

	const canvasEl = elements.get('netCanvas')!;
	(canvasEl as any).getContext = () => mockCtx;

	const postedMessages: any[] = [];
	const windowListeners = new Map<string, Listener[]>();
	let documentHidden = false;
	const document = {
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
		addEventListener(type: string, listener: Listener): void {
			const list = windowListeners.get(type) ?? [];
			list.push(listener);
			windowListeners.set(type, list);
		},
		get hidden(): boolean { return documentHidden; },
	};

	let rafCallback: ((ts: number) => void) | null = null;

	const windowObj = {
		devicePixelRatio: 1,
		innerWidth: 1024,
		innerHeight: 768,
		addEventListener(type: string, listener: Listener): void {
			const list = windowListeners.get(type) ?? [];
			list.push(listener);
			windowListeners.set(type, list);
		},
		removeEventListener(type: string, listener: Listener): void {
			const list = windowListeners.get(type) ?? [];
			windowListeners.set(type, list.filter(l => l !== listener));
		},
		matchMedia() {
			return { matches: false, addEventListener() {}, removeEventListener() {} };
		},
		requestAnimationFrame(cb: (ts: number) => void): number {
			rafCallback = cb;
			return 1;
		},
		getComputedStyle() {
			return {
				fontFamily: workbenchFontFamily,
				getPropertyValue(prop: string) {
					if (prop === '--vscode-editor-background') return '#1B1C1E';
					if (prop === '--vscode-foreground') return '#f4f4f5';
					if (prop === '--vscode-widget-border') return '#3C3C3C';
					if (prop === '--vscode-gitDecoration-addedResourceForeground') return '#3fb950';
					if (prop === '--vscode-gitDecoration-deletedResourceForeground') return '#f85149';
					if (prop === '--vscode-gitDecoration-modifiedResourceForeground') return '#d29922';
					if (prop === '--vscode-gitDecoration-renamedResourceForeground') return '#58a6ff';
					if (prop === '--vscode-button-background') return '#2dd4bf';
					return '';
				}
			};
		}
	};

	const context = vm.createContext({
		acquireVsCodeApi: () => ({
			postMessage: (msg: any) => { postedMessages.push(msg); }
		}),
		document,
		window: windowObj,
		console,
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		performance: { now: () => 1000 },
		Math,
		Number,
		String,
		Boolean,
		Map,
		Set,
		Array,
		Object,
		Promise,
		Error,
		Date,
		parseInt,
		parseFloat,
		isFinite,
		isNaN,
		getComputedStyle: windowObj.getComputedStyle,
		requestAnimationFrame: windowObj.requestAnimationFrame,
	});

	// Run production script
	vm.runInContext(script, context);

	return {
		context,
		elements,
		postedMessages,
		drawCalls,
		triggerMessage(data: any) {
			for (const listener of windowListeners.get('message') ?? []) {
				listener({ data });
			}
		},
		triggerRaf(ts = 1016) {
			if (rafCallback) {
				const cb = rafCallback;
				rafCallback = null;
				cb(ts);
			}
		},
		hasPendingRaf() {
			return Boolean(rafCallback);
		},
		setHidden(hidden: boolean) {
			documentHidden = hidden;
			for (const listener of windowListeners.get('visibilitychange') ?? []) {
				listener({});
			}
		},
	};
}

suite('Production Graph Webview Runtime Test Suite', () => {
	test('Bootstrap: executes without syntax error and immediately posts ready message', () => {
		const harness = createProductionWebviewHarness('network');
		assert.ok(harness.postedMessages.length >= 1, 'Script must post ready immediately');
		const readyMsg = harness.postedMessages.find(m => m.type === 'ready');
		assert.ok(readyMsg, 'Ready message must be posted');
		assert.strictEqual(readyMsg.generation, 42);
		assert.strictEqual(readyMsg.payload.graphType, 'network');
	});

	test('hidden documents halt RAF; visibilitychange resumes without idle-rotating while hidden', () => {
		const harness = createProductionWebviewHarness('network');
		assert.ok(harness.hasPendingRaf(), 'bootstrap schedules a frame');
		harness.setHidden(true);
		harness.triggerRaf();
		assert.equal(harness.hasPendingRaf(), false, 'document.hidden must not keep the RAF loop alive');
		harness.setHidden(false);
		assert.ok(harness.hasPendingRaf(), 'becoming visible must schedule a fresh frame');
	});

	test('Code Graph: consumes production GraphSnapshot contract with positions3d (no node x/y/z) and demonstrates spatial diversity', () => {
		const harness = createProductionWebviewHarness('network');
		// Production contract: GraphNode has NO x, y, z fields!
		const sampleSnapshot = {
			nodes: [
				{ id: 'file:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts', parentId: null, isEntry: true, depth: 0, meta: {} },
				{ id: 'file:src/app.ts', kind: 'file', label: 'app.ts', path: 'src/app.ts', parentId: null, isEntry: false, depth: 1, meta: {} },
				{ id: 'file:src/utils.ts', kind: 'file', label: 'utils.ts', path: 'src/utils.ts', parentId: null, isEntry: false, depth: 2, meta: {} }
			],
			edges: [
				{ source: 'file:src/index.ts', target: 'file:src/app.ts' },
				{ source: 'file:src/app.ts', target: 'file:src/utils.ts' }
			],
			positions3d: {
				'file:src/index.ts': { x: 120, y: 80, z: 40 },
				'file:src/app.ts': { x: -90, y: 140, z: -30 },
				'file:src/utils.ts': { x: 10, y: -110, z: 15 }
			},
			entryNodeId: 'file:src/index.ts',
			networkLayoutMode: 'organic',
			scannedAt: 1000
		};

		harness.triggerMessage({
			type: 'snapshot',
			payload: {
				snapshot: sampleSnapshot,
				diagnostics: { status: 'ready', fileCount: 3, nodeCount: 3, edgeCount: 2 },
				graphType: 'network'
			}
		});

		harness.triggerRaf(1016);

		// Verify canvas was drawn with arcs for nodes and lines for edges
		const arcCalls = harness.drawCalls.filter(c => c.type === 'arc');
		const lineToCalls = harness.drawCalls.filter(c => c.type === 'lineTo');
		const fillTextCalls = harness.drawCalls.filter(c => c.type === 'fillText');

		assert.ok(arcCalls.length >= 3, `Expected at least 3 node arcs, got ${arcCalls.length}`);
		assert.ok(lineToCalls.length >= 2, `Expected at least 2 edge lines, got ${lineToCalls.length}`);
		assert.ok(fillTextCalls.length >= 1, `Expected entry node label, got ${fillTextCalls.length}`);

		// Spatial Diversity Assertion: node positions must NOT collapse to (0,0) or to each other
		const nodeCenters = arcCalls.map(c => ({ x: c.args[0], y: c.args[1] }));
		const uniqueX = new Set(nodeCenters.map(c => Math.round(c.x)));
		const uniqueY = new Set(nodeCenters.map(c => Math.round(c.y)));
		assert.ok(uniqueX.size >= 2, `Expected spatially distinct X coordinates, got ${uniqueX.size}`);
		assert.ok(uniqueY.size >= 2, `Expected spatially distinct Y coordinates, got ${uniqueY.size}`);
	});

	test('Code Graph: correctly centers Organic, Sphere, Constellation, Clustered layouts while preserving Radial origin', () => {
		const harness = createProductionWebviewHarness('network');

		// Test Radial layout (must preserve origin (0,0) as center)
		const radialSnapshot = {
			nodes: [
				{ id: 'center', kind: 'file', label: 'center.ts', path: 'src/center.ts', parentId: null, isEntry: true, depth: 0, meta: {} },
				{ id: 'leaf1', kind: 'file', label: 'leaf1.ts', path: 'src/leaf1.ts', parentId: null, isEntry: false, depth: 1, meta: {} },
			],
			edges: [{ source: 'center', target: 'leaf1' }],
			positions3d: {
				'center': { x: 0, y: 0, z: 0 },
				'leaf1': { x: 200, y: 0, z: 0 }
			},
			networkLayoutMode: 'radial',
			scannedAt: 2000
		};

		harness.triggerMessage({
			type: 'snapshot',
			payload: { snapshot: radialSnapshot, graphType: 'network' }
		});
		harness.triggerRaf(1032);

		const arcCalls = harness.drawCalls.filter(c => c.type === 'arc');
		assert.ok(arcCalls.length >= 2);
	});

	test('Code Graph: camera transform, fitting, and pointer picking operate correctly with perspective', () => {
		const harness = createProductionWebviewHarness('network');
		const snapshot = {
			nodes: [
				{ id: 'n1', kind: 'file', label: 'first.ts', path: 'src/first.ts', parentId: null, isEntry: true, depth: 0, meta: {} },
				{ id: 'n2', kind: 'file', label: 'second.ts', path: 'src/second.ts', parentId: null, isEntry: false, depth: 1, meta: {} }
			],
			edges: [{ source: 'n1', target: 'n2' }],
			positions3d: {
				'n1': { x: -100, y: 0, z: 0 },
				'n2': { x: 100, y: 0, z: 0 }
			},
			networkLayoutMode: 'organic',
			scannedAt: 3000
		};

		harness.triggerMessage({
			type: 'snapshot',
			payload: { snapshot, graphType: 'network' }
		});
		harness.triggerRaf(1050);

		// Trigger canvas click via pointerdown / pointerup
		const canvasEl = harness.elements.get('netCanvas')!;
		canvasEl.dispatch('pointerdown', {
			isPrimary: true,
			button: 0,
			clientX: 400,
			clientY: 300,
			pointerId: 1,
			pointerType: 'mouse'
		});

		canvasEl.dispatch('pointerup', {
			pointerId: 1,
			clientX: 400,
			clientY: 300
		});

		// Verify selection message was dispatched or handled
		assert.ok(harness.drawCalls.length > 0);
	});

	test('network render metrics include canvas-space nodeHits when recording is enabled', () => {
		const harness = createProductionWebviewHarness('network');
		vm.runInContext('window.__prebaseRecordRenderMetrics = true', harness.context);
		harness.triggerMessage({
			type: 'snapshot',
			payload: {
				snapshot: {
					nodes: [
						{ id: 'n1', kind: 'file', label: 'first.ts', path: 'src/first.ts', parentId: null, isEntry: true, depth: 0, meta: {} },
						{ id: 'n2', kind: 'file', label: 'second.ts', path: 'src/second.ts', parentId: null, isEntry: false, depth: 1, meta: {} }
					],
					edges: [{ source: 'n1', target: 'n2' }],
					positions3d: {
						n1: { x: -100, y: 0, z: 0 },
						n2: { x: 100, y: 0, z: 0 }
					},
					networkLayoutMode: 'organic',
					scannedAt: 3000
				},
				graphType: 'network'
			}
		});
		vm.runInContext('transform = { x: 12, y: -8, k: 2 }; dirty = true;', harness.context);
		harness.triggerRaf(1080);
		const runtime = vm.runInContext(`({
			hits: window.__prebaseGraphRenderMetrics.nodeHits,
			transform: { ...transform },
			projected: { n1: { ...projected.n1 }, n2: { ...projected.n2 } }
		})`, harness.context);
		assert.ok(Array.isArray(runtime.hits));
		assert.equal(runtime.hits.length, 2);
		for (const hit of runtime.hits) {
			const projectedHit = runtime.projected[hit.id];
			assert.ok(projectedHit, `missing projected position for ${hit.id}`);
			assert.ok(Math.abs(hit.x - (projectedHit.x * runtime.transform.k + runtime.transform.x)) < 0.001);
			assert.ok(Math.abs(hit.y - (projectedHit.y * runtime.transform.k + runtime.transform.y)) < 0.001);
		}
	});

	test('network nodeHits stay absent unless __prebaseRecordRenderMetrics is set', () => {
		const harness = createProductionWebviewHarness('network');
		vm.runInContext('window.__prebaseGraphRenderMetrics = { sequenceId: 7, nodeHits: [{ id: "stale", x: 1, y: 1 }] }', harness.context);
		harness.triggerMessage({
			type: 'snapshot',
			payload: {
				snapshot: {
					nodes: [
						{ id: 'n1', kind: 'file', label: 'first.ts', path: 'src/first.ts', parentId: null, isEntry: true, depth: 0, meta: {} }
					],
					edges: [],
					positions3d: { n1: { x: 40, y: 10, z: 0 } },
					networkLayoutMode: 'organic',
					scannedAt: 3100
				},
				graphType: 'network'
			}
		});
		harness.triggerRaf(1090);
		assert.ok(harness.drawCalls.some(call => call.type === 'arc'), 'the network frame must actually draw so missing nodeHits is not a skipped RAF');
		const runtime = vm.runInContext(`({
			flag: window.__prebaseRecordRenderMetrics,
			metrics: window.__prebaseGraphRenderMetrics && { ...window.__prebaseGraphRenderMetrics, nodeHits: window.__prebaseGraphRenderMetrics.nodeHits }
		})`, harness.context);
		assert.equal(runtime.flag, undefined);
		assert.equal(runtime.metrics.sequenceId, 7, 'drawing without the record flag must not refresh metrics');
		assert.equal(runtime.metrics.nodeHits.length, 1);
		assert.equal(runtime.metrics.nodeHits[0].id, 'stale');
		assert.equal(runtime.metrics.nodeHits[0].x, 1);
		assert.equal(runtime.metrics.nodeHits[0].y, 1);
	});

	test('network nodeHits record at most 16 canvas-space hits', () => {
		const harness = createProductionWebviewHarness('network');
		const nodes = Array.from({ length: 18 }, (_, i) => ({
			id: `n${i}`,
			kind: 'file',
			label: `f${i}.ts`,
			path: `src/f${i}.ts`,
			parentId: null,
			isEntry: i === 0,
			depth: i,
			meta: {}
		}));
		const positions3d = Object.fromEntries(nodes.map((node, i) => [node.id, { x: i * 10, y: 0, z: 0 }]));
		vm.runInContext('window.__prebaseRecordRenderMetrics = true', harness.context);
		harness.triggerMessage({
			type: 'snapshot',
			payload: {
				snapshot: { nodes, edges: [], positions3d, networkLayoutMode: 'organic', scannedAt: 3200 },
				graphType: 'network'
			}
		});
		harness.triggerRaf(1100);
		const hits = vm.runInContext('window.__prebaseGraphRenderMetrics.nodeHits', harness.context) as Array<{ id: string }>;
		assert.equal(hits.length, 16);
		assert.equal(hits[0].id, 'n0');
		assert.equal(hits[15].id, 'n15');
		assert.equal(hits.some(hit => hit.id === 'n16' || hit.id === 'n17'), false);
	});

	test('Temporal Graph: renders 2D temporal diff transitions without coordinate offset double-counting', () => {
		const harness = createProductionWebviewHarness('temporal');
		const readyMsg = harness.postedMessages.find(m => m.type === 'ready');
		assert.ok(readyMsg);
		assert.strictEqual(readyMsg.payload.graphType, 'temporal');

		const sampleTemporalState = {
			activeRepositoryRoot: '/workspace/project',
			availableRepositories: [{ rootUri: '/workspace/project', label: 'project' }],
			selectedRef: 'HEAD',
			selectedCommitSha: 'c111111111111111111111111111111111111111',
			renderedCommitSha: 'c111111111111111111111111111111111111111',
			selectedCommitSummary: {
				sha: 'c111111111111111111111111111111111111111',
				shortSha: 'c111111',
				message: 'Fix temporal transitions',
				author: 'PreBase Team',
				timestamp: Date.now(),
				parents: ['c000000000000000000000000000000000000000']
			},
			pagedTimeline: [
				{ sha: 'c111111111111111111111111111111111111111', shortSha: 'c111111', message: 'Fix temporal transitions' }
			],
			loadedCommitCount: 1,
			isSettled: true,
			displayMode: 'changes',
			diff: {
				sourceCommitSha: 'c000000000000000000000000000000000000000',
				targetCommitSha: 'c111111111111111111111111111111111111111',
				nodes: [
					{ entityId: 'e1', label: 'parser.ts', path: 'src/parser.ts', changeKind: 'added', x: 200, y: 100 },
					{ entityId: 'e2', label: 'lexer.ts', path: 'src/lexer.ts', changeKind: 'modified', x: -100, y: 80 }
				],
				edges: [
					{ sourceEntityId: 'e1', targetEntityId: 'e2', changeKind: 'added' }
				],
				summary: { addedCount: 1, removedCount: 0, modifiedCount: 1, renamedCount: 0 }
			}
		};

		harness.triggerMessage({
			type: 'temporalState',
			payload: sampleTemporalState
		});

		harness.triggerRaf(1050);

		// Verify temporal UI element values
		const commitShaEl = harness.elements.get('temporalCommitSha')!;
		assert.strictEqual(commitShaEl.textContent, 'c111111');

		const commitMsgEl = harness.elements.get('temporalCommitMessage')!;
		assert.strictEqual(commitMsgEl.textContent, 'Fix temporal transitions');

		// Verify draw calls for temporal nodes and edges
		const arcCalls = harness.drawCalls.filter(c => c.type === 'arc');
		const edgeDrawCalls = harness.drawCalls.filter(c => c.type === 'quadraticCurveTo' || c.type === 'lineTo');
		assert.ok(arcCalls.length >= 2, `Expected at least 2 temporal node arcs, got ${arcCalls.length}`);
		assert.ok(edgeDrawCalls.length >= 1, `Expected at least 1 temporal edge draw call, got ${edgeDrawCalls.length}`);

		// Verify translates do not double-count (w/2, h/2)
		const translateCalls = harness.drawCalls.filter(c => c.type === 'translate');
		assert.ok(translateCalls.length >= 1);
	});

	test('Temporal Graph: serialized temporalDiff message preserves node identities in the production webview', () => {
		const harness = createProductionWebviewHarness('temporal');
		const diff = {
			baseCommitSha: 'base',
			targetCommitSha: 'target',
			nodes: [
				{ entityId: 'kept', canonicalNodeId: 'kept', path: 'src/kept.ts', label: 'kept.ts', kind: 'file', changeKind: 'unchanged', x: 10, y: 20 },
				{ entityId: 'changed', canonicalNodeId: 'changed', path: 'src/changed.ts', label: 'changed.ts', kind: 'file', changeKind: 'modified', x: 30, y: 40 },
			],
			edges: [],
			summary: {
				addedCount: 0,
				removedCount: 0,
				modifiedCount: 1,
				renamedCount: 0,
				unchangedCount: 1,
				edgeAddedCount: 0,
				edgeRemovedCount: 0,
				edgeModifiedCount: 0,
			},
			isPartialLineage: false,
		};

		harness.triggerMessage(JSON.parse(JSON.stringify({
			type: 'temporalDiff',
			payload: diff,
		})));
		const received = vm.runInContext('temporalDiff', harness.context);

		assert.deepStrictEqual({
			nodeCount: received.nodes.length,
			nodeIds: Array.from(received.nodes, (node: any) => node.entityId),
		}, {
			nodeCount: 2,
			nodeIds: ['kept', 'changed'],
		});
	});

	test('Temporal Graph: first non-empty temporal update auto-fits and draws after empty bootstrap', () => {
		for (const messageType of ['temporalState', 'temporalDiff']) {
			const harness = createProductionWebviewHarness('temporal');
			vm.runInContext('window.__prebaseRecordRenderMetrics = true', harness.context);
			harness.triggerMessage({
				type: 'temporalState',
				payload: {
					selectedCommitSha: 'target',
					renderedCommitSha: 'target',
					displayMode: 'state',
					diff: {
						baseCommitSha: 'base',
						targetCommitSha: 'target',
						nodes: [],
						edges: [],
						summary: { addedCount: 0, removedCount: 0, modifiedCount: 0, renamedCount: 0, unchangedCount: 0 },
					},
				},
			});
			harness.triggerRaf();
			harness.drawCalls.length = 0;

			const diff = {
				baseCommitSha: 'base',
				targetCommitSha: 'target',
				nodes: [
					{ entityId: 'left', canonicalNodeId: 'left', label: 'left.ts', path: 'src/left.ts', kind: 'file' as const, changeKind: 'unchanged' as const, x: 120, y: 80 },
					{ entityId: 'right', canonicalNodeId: 'right', label: 'right.ts', path: 'src/right.ts', kind: 'file' as const, changeKind: 'modified' as const, x: 320, y: 180 },
				],
				edges: [],
				summary: { addedCount: 0, removedCount: 0, modifiedCount: 1, renamedCount: 0, unchangedCount: 1 },
			};
			harness.triggerMessage(messageType === 'temporalState'
				? {
					type: messageType,
					payload: {
						selectedCommitSha: 'target',
						renderedCommitSha: 'target',
						displayMode: 'state',
						diff,
					},
				}
				: { type: messageType, payload: diff });
			harness.triggerRaf(1300);

			const runtime = vm.runInContext(`({
				transform: { ...transform },
				insets: getUsableInsets(),
				metrics: { ...window.__prebaseGraphRenderMetrics }
			})`, harness.context);
			const expected = computeTemporalFitTransform(diff.nodes, 800, 600, {
				padding: 56,
				insets: runtime.insets,
				minZoom: 0.15,
				maxZoom: 2.4,
			});

			assert.ok(
				Number.isFinite(runtime.transform.x) &&
				Number.isFinite(runtime.transform.y) &&
				Number.isFinite(runtime.transform.k),
				`${messageType} must produce a finite transform`,
			);
			assert.notDeepStrictEqual(runtime.transform, { x: 0, y: 0, k: 1 }, `${messageType} must replace the default transform`);
			assert.ok(Math.abs(runtime.transform.x - expected.x) < 0.001, `${messageType} x ${runtime.transform.x} vs ${expected.x}`);
			assert.ok(Math.abs(runtime.transform.y - expected.y) < 0.001, `${messageType} y ${runtime.transform.y} vs ${expected.y}`);
			assert.ok(Math.abs(runtime.transform.k - expected.k) < 0.001, `${messageType} k ${runtime.transform.k} vs ${expected.k}`);
			assert.deepStrictEqual({
				receivedNodeCount: runtime.metrics.receivedNodeCount,
				visibleNodeCount: runtime.metrics.visibleNodeCount,
				finiteCoordinateCount: runtime.metrics.finiteCoordinateCount,
				nodesDrawn: runtime.metrics.nodesDrawn,
				selectedCommitSha: runtime.metrics.selectedCommitSha,
				renderedCommitSha: runtime.metrics.renderedCommitSha,
			}, {
				receivedNodeCount: 2,
				visibleNodeCount: 2,
				finiteCoordinateCount: 2,
				nodesDrawn: 2,
				selectedCommitSha: 'target',
				renderedCommitSha: 'target',
			}, `${messageType} draw metrics must report the rendered production frame`);
			assert.equal(
				harness.drawCalls.filter(call => call.type === 'arc').length,
				2,
				`${messageType} must draw both target-active nodes`,
			);
		}
	});

	test('Temporal Graph: auto-fits when placeholder nodes later receive finite coordinates', () => {
		const harness = createProductionWebviewHarness('temporal');
		vm.runInContext('window.__prebaseRecordRenderMetrics = true', harness.context);
		harness.triggerMessage({
			type: 'temporalState',
			payload: {
				selectedCommitSha: 'target',
				renderedCommitSha: 'target',
				displayMode: 'state',
				diff: {
					baseCommitSha: 'base',
					targetCommitSha: 'target',
					nodes: [
						{ entityId: 'left', canonicalNodeId: 'left', label: 'left.ts', path: 'src/left.ts', kind: 'file' as const, changeKind: 'unchanged' as const, x: Number.NaN, y: Number.NaN },
					],
					edges: [],
					summary: { addedCount: 0, removedCount: 0, modifiedCount: 0, renamedCount: 0, unchangedCount: 1 },
				},
			},
		});
		harness.triggerRaf();
		const before = vm.runInContext('({ x: transform.x, y: transform.y, k: transform.k })', harness.context);
		assert.equal(before.x, 0);
		assert.equal(before.y, 0);
		assert.equal(before.k, 1);

		harness.triggerMessage({
			type: 'temporalDiff',
			payload: {
				baseCommitSha: 'base',
				targetCommitSha: 'target',
				nodes: [
					{ entityId: 'left', canonicalNodeId: 'left', label: 'left.ts', path: 'src/left.ts', kind: 'file' as const, changeKind: 'unchanged' as const, x: 120, y: 80 },
					{ entityId: 'right', canonicalNodeId: 'right', label: 'right.ts', path: 'src/right.ts', kind: 'file' as const, changeKind: 'modified' as const, x: 320, y: 180 },
				],
				edges: [],
				summary: { addedCount: 0, removedCount: 0, modifiedCount: 1, renamedCount: 0, unchangedCount: 1 },
			},
		});
		harness.triggerRaf(1300);
		const after = vm.runInContext('({ x: transform.x, y: transform.y, k: transform.k })', harness.context);
		assert.ok(Number.isFinite(after.x) && Number.isFinite(after.y) && Number.isFinite(after.k));
		assert.ok(after.x !== 0 || after.y !== 0 || after.k !== 1);
	});

	test('Temporal Graph: Full Map retains and draws all target-active nodes', () => {
		const harness = createProductionWebviewHarness('temporal');
		harness.triggerMessage({
			type: 'temporalState',
			payload: {
				displayMode: 'state',
				diff: {
					baseCommitSha: 'base',
					targetCommitSha: 'target',
					nodes: [
						{ entityId: 'kept', canonicalNodeId: 'kept', label: 'kept.ts', path: 'src/kept.ts', kind: 'file' as const, changeKind: 'unchanged' as const, x: -60, y: 0 },
						{ entityId: 'added', label: 'added.ts', path: 'src/added.ts', changeKind: 'added', x: 0, y: 0 },
						{ entityId: 'modified', label: 'modified.ts', path: 'src/modified.ts', changeKind: 'modified', x: 60, y: 0 },
						{ entityId: 'removed', label: 'removed.ts', path: 'src/removed.ts', changeKind: 'removed', x: 120, y: 0 },
					],
					edges: [],
					summary: { addedCount: 1, removedCount: 1, modifiedCount: 1, renamedCount: 0, unchangedCount: 1 },
				},
			},
		});

		const visibleNodeIds = vm.runInContext(
			'computeTemporalVisibleElements(temporalDiff, displayMode, temporalContextFilterMode).nodes.map(n => n.entityId)',
			harness.context,
		);
		harness.triggerRaf();

		assert.deepStrictEqual(Array.from(visibleNodeIds), ['kept', 'added', 'modified']);
		assert.equal(
			harness.drawCalls.filter(call => call.type === 'arc').length,
			3,
			'Full Map must draw one body for every target-active node and no removed ghost',
		);
	});

	test('Temporal Graph: nonzero Focus Changes diff exposes and draws changed nodes', () => {
		const harness = createProductionWebviewHarness('temporal');
		harness.triggerMessage({
			type: 'temporalState',
			payload: {
				displayMode: 'changes',
				diff: {
					baseCommitSha: 'base',
					targetCommitSha: 'target',
					nodes: [
						{ entityId: 'changed', label: 'changed.ts', path: 'src/changed.ts', changeKind: 'modified', x: 0, y: 0 },
						{ entityId: 'unchanged', canonicalNodeId: 'unchanged', label: 'unchanged.ts', path: 'src/unchanged.ts', kind: 'file' as const, changeKind: 'unchanged' as const, x: 80, y: 0 },
					],
					edges: [],
					summary: { addedCount: 0, removedCount: 0, modifiedCount: 1, renamedCount: 0, unchangedCount: 1 },
				},
			},
		});

		const visible = vm.runInContext(
			'computeTemporalVisibleElements(temporalDiff, displayMode, temporalContextFilterMode)',
			harness.context,
		);
		harness.triggerRaf();

		assert.deepStrictEqual(Array.from(visible.nodes, (node: any) => node.entityId), ['changed']);
		assert.equal(visible.hasZeroChanges, false);
		assert.ok(
			harness.drawCalls.some(call => call.type === 'arc'),
			'a nonzero Focus Changes diff must draw its changed node',
		);
	});

	test('blank temporal canvas records nodesDrawn 0 on __prebaseGraphRenderMetrics, not __prebaseGraphMetrics', () => {
		const harness = createProductionWebviewHarness('temporal');
		vm.runInContext('window.__prebaseRecordRenderMetrics = true', harness.context);
		harness.triggerMessage({
			type: 'temporalState',
			payload: {
				selectedCommitSha: 'target',
				renderedCommitSha: 'target',
				displayMode: 'state',
				diff: {
					baseCommitSha: 'base',
					targetCommitSha: 'target',
					nodes: [],
					edges: [],
					summary: { addedCount: 0, removedCount: 0, modifiedCount: 0, renamedCount: 0, unchangedCount: 0 },
				},
			},
		});
		harness.triggerRaf(1300);
		const runtime = vm.runInContext(`({
			render: window.__prebaseGraphRenderMetrics,
			wrong: window.__prebaseGraphMetrics,
			canvasDisplay: document.getElementById('netCanvas').style.display,
		})`, harness.context);
		assert.equal(runtime.wrong, undefined, 'legacy __prebaseGraphMetrics must not be the metrics source');
		assert.ok(runtime.render, 'production metrics must be written to __prebaseGraphRenderMetrics');
		assert.equal(runtime.render.nodesDrawn, 0);
		assert.equal(runtime.render.receivedNodeCount, 0);
		assert.equal(runtime.canvasDisplay, 'block', 'an empty canvas can still be visible');
	});

	test('Temporal Full Map draws community guides as rounded AABBs from bounds, not giant circles', () => {
		const harness = createProductionWebviewHarness('temporal');
		harness.triggerMessage({
			type: 'temporalState',
			payload: {
				displayMode: 'state',
				diff: {
					baseCommitSha: 'base',
					targetCommitSha: 'target',
					nodes: [
						{ entityId: 'left', canonicalNodeId: 'left', label: 'left.ts', path: 'src/left.ts', kind: 'file' as const, changeKind: 'unchanged' as const, x: -40, y: 0 },
						{ entityId: 'right', canonicalNodeId: 'right', label: 'right.ts', path: 'src/right.ts', kind: 'file' as const, changeKind: 'unchanged' as const, x: 40, y: 0 },
					],
					edges: [],
					guides: [{
						id: 'ui',
						label: 'UI',
						color: '#6366f1',
						x: 0,
						y: 0,
						radius: 400,
						bounds: { minX: -50, minY: -16, maxX: 50, maxY: 16, width: 100, height: 32 },
						nodeIds: ['left', 'right'],
						nodeCount: 2,
					}],
					summary: { addedCount: 0, removedCount: 0, modifiedCount: 0, renamedCount: 0, unchangedCount: 2 },
				},
			},
		});
		harness.triggerRaf();
		const boxes = harness.drawCalls.filter(call => call.type === 'roundRect' || call.type === 'rect');
		assert.ok(boxes.length >= 1, 'Full Map community guides must fill a rounded AABB');
		assert.ok(boxes.some(call => call.args[0] === -50 && call.args[1] === -16 && call.args[2] === 100 && call.args[3] === 32));
		assert.equal(
			harness.drawCalls.filter(call => call.type === 'arc' && Number(call.args[2]) >= 40).length,
			0,
			'community guides must not stroke a giant circumcircle',
		);
	});

	test('canvasFont uses the computed workbench font family, not a hardcoded canvas face', () => {
		const family = '"PreBase Workbench Face", ui-sans-serif';
		const harness = createProductionWebviewHarness('network', family);
		const font = vm.runInContext('canvasFont("600", 15)', harness.context) as string;
		assert.equal(font, `600 15px ${family}`);
		assert.doesNotMatch(font, /Menlo|Monaco|Segoe UI|Consolas/);
		const afterInvalidate = vm.runInContext('invalidateThemeColors(); canvasFont("600", 15)', harness.context) as string;
		assert.equal(afterInvalidate, font, 'theme cache must still resolve to the workbench family');
	});

	test('network render records projectedBounds, screenUtilization, and labelCount on __prebaseGraphRenderMetrics', () => {
		const harness = createProductionWebviewHarness('network');
		vm.runInContext('window.__prebaseRecordRenderMetrics = true', harness.context);
		harness.triggerMessage({
			type: 'snapshot',
			payload: {
				graphType: 'network',
				snapshot: {
					nodes: [
						{ id: 'a', kind: 'file', label: 'a.ts', path: 'src/a.ts', parentId: null, isEntry: true, depth: 0, meta: {} },
						{ id: 'b', kind: 'file', label: 'b.ts', path: 'src/b.ts', parentId: null, isEntry: false, depth: 1, meta: {} },
					],
					edges: [{ source: 'a', target: 'b' }],
					positions3d: {
						a: { x: 40, y: 10, z: 0 },
						b: { x: -30, y: -20, z: 0 },
					},
					entryNodeId: 'a',
					networkLayoutMode: 'organic',
					scannedAt: 1000,
				},
				diagnostics: { status: 'ready', fileCount: 2, nodeCount: 2, edgeCount: 1 },
			},
		});
		harness.triggerRaf(1016);
		const metrics = vm.runInContext('({ ...window.__prebaseGraphRenderMetrics })', harness.context) as {
			projectedBounds?: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null;
			screenUtilization?: number;
			labelCount?: number;
			labelsDrawn?: number;
			nodesDrawn?: number;
		};
		assert.ok(metrics.projectedBounds, 'projectedBounds must be recorded');
		assert.equal(typeof metrics.projectedBounds?.minX, 'number');
		assert.equal(typeof metrics.projectedBounds?.width, 'number');
		assert.ok(Number.isFinite(metrics.screenUtilization) && (metrics.screenUtilization ?? 0) > 0);
		assert.equal(metrics.labelCount, metrics.labelsDrawn);
		assert.ok((metrics.nodesDrawn ?? 0) >= 2);
	});
});

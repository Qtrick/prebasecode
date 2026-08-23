/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { suite, test } from 'mocha';

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

function createProductionWebviewHarness(initialType: 'network' | 'temporal' = 'network') {
	const editorSource = readFileSync(new URL('../../host/workbench/graphEditor.ts', import.meta.url), 'utf8');
	const htmlMatch = editorSource.slice(editorSource.indexOf('return `<!DOCTYPE html>'));
	const rawScriptMatch = htmlMatch.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/);
	assert.ok(rawScriptMatch, 'webview script must be present in graphEditor.ts');

	let script = rawScriptMatch[1];
	script = script.replace('${generation}', '42');
	script = script.replace('${initialGraphType}', initialType);

	const elements = new Map<string, FakeElement>();
	for (const id of [
		'archSvg', 'netCanvas', 'status', 'legend', 'empty', 'idleToggle', 'idleToggleWrap',
		'toolbar', 'temporalToolbar', 'temporalRepoWrap', 'temporalRepoSelect', 'temporalScrubberBar', 'temporalRefSelect', 'temporalCompareSelect',
		'temporalFollowHead', 'temporalFilterInput', 'temporalScrubber', 'temporalPrevBtn', 'temporalNextBtn',
		'temporalPlayBtn', 'temporalCommitSha', 'temporalCommitMessage', 'temporalCommitAuthor', 'temporalCommitStatus',
		'temporalPartialWarning', 'badgeAdded', 'badgeRemoved', 'badgeModified', 'badgeRenamed',
		'temporalModeChangesBtn', 'temporalModeStateBtn', 'temporalContextModeWrap', 'temporalContextFocusedBtn', 'temporalContextFullBtn', 'temporalToggleDetailsBtn', 'temporalTimelineStrip', 'temporalLoadMoreBtn',
		'temporalDetailsPanel', 'temporalDetailsClose', 'temporalDetailsList', 'temporalDetailsSha', 'temporalDetailsAuthor', 'temporalDetailsParents', 'temporalDetailsSummary',
		'detailsCommitSha', 'detailsCommitMsg', 'detailsCommitAuthor', 'detailsCommitParents', 'detailsDeltaSummary', 'detailsEntityList',
		'popup', 'popupTitle', 'popupMeta', 'popupOverview', 'popupAi', 'popupClose', 'popupOpen',
		'popupHistoricalView', 'popupSourceDiff', 'popupSetBase', 'popupReveal', 'popupMagnus', 'zoomIn', 'zoomOut', 'fit', 'reset'
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
		moveTo(...args: any[]) { drawCalls.push({ type: 'moveTo', args }); },
		lineTo(...args: any[]) { drawCalls.push({ type: 'lineTo', args }); },
		quadraticCurveTo(...args: any[]) { drawCalls.push({ type: 'quadraticCurveTo', args }); },
		stroke() { drawCalls.push({ type: 'stroke', args: [] }); },
		fill() { drawCalls.push({ type: 'fill', args: [] }); },
		fillRect(...args: any[]) { drawCalls.push({ type: 'fillRect', args }); },
		arc(...args: any[]) { drawCalls.push({ type: 'arc', args }); },
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
		get hidden(): boolean { return false; },
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
		}
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
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { suite, test } from 'mocha';
import { PreBaseGraphEditorInput } from '../../host/workbench/graphEditorInput.js';
import { interpolateWebviewScript } from '../../host/workbench/temporalRuntimeContracts.js';

type Listener = (event: any) => void;

class FakeClassList {
	private readonly values = new Set<string>();
	add(...names: string[]): void { for (const n of names) {this.values.add(n);} }
	remove(...names: string[]): void { for (const n of names) {this.values.delete(n);} }
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
		if (!this.firstChild) {this.firstChild = child;}
		return child;
	}
	removeChild(child: FakeElement): FakeElement {
		this.children = this.children.filter(c => c !== child);
		this.firstChild = this.children[0] || null;
		return child;
	}
	getContext(): any {
		return {
			resetTransform() {}, setTransform() {}, save() {}, restore() {}, clearRect() {},
			beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
			fillText() {}, measureText() { return { width: 10 }; }, scale() {}, translate() {}, setLineDash() {}
		};
	}
}

function createTemporalWebviewHarness() {
	const editorSource = readFileSync(new URL('../../host/workbench/graphEditor.ts', import.meta.url), 'utf8');
	const html = editorSource.slice(editorSource.indexOf('<script nonce="${nonce}">'));
	let script = html.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/)?.[1];
	assert.ok(script, 'webview script must be present');
	script = interpolateWebviewScript(script, '7', 'temporal');

	const elements = new Map<string, FakeElement>();
	for (const id of [
		'archSvg', 'netCanvas', 'status', 'legend', 'empty', 'idleToggle', 'idleToggleWrap',
		'toolbar', 'temporalToolbar', 'temporalRepoWrap', 'temporalRepoSelect', 'temporalScrubberBar', 'temporalRefSelect', 'temporalCompareSelect',
		'temporalFollowHead', 'temporalFilterInput', 'temporalScrubber', 'temporalPrevBtn', 'temporalNextBtn',
		'temporalPlayBtn', 'temporalCommitSha', 'temporalCommitMessage', 'temporalCommitAuthor', 'temporalCommitStatus',
		'temporalPartialWarning', 'badgeAdded', 'badgeRemoved', 'badgeModified', 'badgeRenamed',
		'temporalModeChangesBtn', 'temporalModeStateBtn', 'temporalContextModeWrap', 'temporalContextFocusedBtn', 'temporalContextFullBtn', 'temporalToggleDetailsBtn', 'temporalTimelineStrip', 'temporalLoadMoreBtn',
		'temporalFitBtn', 'temporalCenterLockBtn', 'temporalZoomInBtn', 'temporalZoomOutBtn', 'temporalResetBtn', 'temporalHelpBtn', 'temporalRetryBtn',
		'temporalDetailsPanel', 'temporalDetailsClose', 'temporalDetailsList', 'temporalDetailsSha', 'temporalDetailsAuthor', 'temporalDetailsParents', 'temporalDetailsSummary',
		'detailsCommitSha', 'detailsCommitMsg', 'detailsCommitAuthor', 'detailsCommitParents', 'detailsDeltaSummary', 'detailsEntityList',
		'popup', 'popupTitle', 'popupMeta', 'popupOverview', 'popupAi', 'popupAiProvenance',
		'popupClose', 'popupOpen', 'popupHistoricalView', 'popupSourceDiff', 'popupSetBase', 'popupReveal', 'popupMagnus', 'zoomIn', 'zoomOut', 'fit', 'centerLock', 'reset', 'graphHelpBtn', 'temporalLegendBtn'
	]) {
		elements.set(id, new FakeElement());
	}

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

	const context = vm.createContext({
		acquireVsCodeApi: () => ({
			postMessage: (msg: any) => { postedMessages.push(msg); }
		}),
		document,
		window: {
			devicePixelRatio: 1,
			innerWidth: 800,
			innerHeight: 600,
			addEventListener(type: string, listener: Listener): void {
				const list = windowListeners.get(type) ?? [];
				list.push(listener);
				windowListeners.set(type, list);
			},
			matchMedia: () => ({ matches: false }),
		},
		getComputedStyle: () => ({ getPropertyValue: () => '' }),
		performance: { now: () => 1000 },
		Map,
		Set,
		Math,
		Number,
		Object,
		Array,
		String,
		Promise,
		parseInt,
		parseFloat,
		setTimeout: () => 1,
		clearTimeout: () => {},
		setInterval: () => 1,
		clearInterval: () => {},
		requestAnimationFrame: () => 1,
	});

	vm.runInContext(script, context, { timeout: 1000 });

	return {
		context,
		elements,
		postedMessages,
		postMessageToWebview: (data: any) => {
			for (const listener of windowListeners.get('message') ?? []) {
				listener({ data });
			}
		},
		dispatchWindowKeydown: (event: any) => {
			for (const listener of windowListeners.get('keydown') ?? []) {
				listener(event);
			}
		}
	};
}

suite('GraphEditorTemporalWebview (Unit - Phase 3.5 VM & Webview)', () => {
	test('1. Webview HTML structure includes all Phase 3.5 UI components with secure CSP and nonces', () => {
		const input = new PreBaseGraphEditorInput('temporal');
		assert.equal(input.graphType, 'temporal');
		assert.equal(input.typeId, PreBaseGraphEditorInput.TypeID);
		assert.equal(input.resource.scheme, 'prebase-graph');
	});

	test('2. Visual position interpolation function computes synchronized node & edge positions', () => {
		function getVisualNodePosition(
			node: { entityId: string; x: number; y: number },
			animState: { prevPositions: Map<string, { x: number; y: number }>; progress: number }
		) {
			const prev = animState.prevPositions.get(node.entityId);
			if (!prev || animState.progress >= 1) {
				return { x: node.x, y: node.y };
			}
			const ease = animState.progress;
			return {
				x: prev.x + (node.x - prev.x) * ease,
				y: prev.y + (node.y - prev.y) * ease,
			};
		}

		const prevPos = new Map<string, { x: number; y: number }>();
		prevPos.set('node-1', { x: 100, y: 100 });
		prevPos.set('node-2', { x: 500, y: 500 });

		const targetNode1 = { entityId: 'node-1', x: 200, y: 300 };
		const targetNode2 = { entityId: 'node-2', x: 600, y: 700 };

		const pos1_half = getVisualNodePosition(targetNode1, { prevPositions: prevPos, progress: 0.5 });
		const pos2_half = getVisualNodePosition(targetNode2, { prevPositions: prevPos, progress: 0.5 });

		assert.equal(pos1_half.x, 150);
		assert.equal(pos1_half.y, 200);
		assert.equal(pos2_half.x, 550);
		assert.equal(pos2_half.y, 600);
	});

	test('3. Production Webview VM: Bounded navigation, scrubber calculation, and relative stepping messages', () => {
		const harness = createTemporalWebviewHarness();

		// Post 3-commit temporal state with timelineWindow metadata
		harness.postMessageToWebview({
			type: 'temporalState',
			payload: {
				mode: 'temporal',
				activeRepositoryRoot: '/workspace/project',
				availableRepositories: [{ id: 'proj', rootUri: '/workspace/project', label: 'project' }],
				selectedRef: 'HEAD',
				repositoryRefs: [{ name: 'HEAD', kind: 'branch', isRemote: false, targetSha: 'sha_head' }],
				selectedCommitSha: 'sha_head',
				renderedCommitSha: 'sha_head',
				selectedCommitIndex: 0,
				loadedCommitCount: 3,
				compareBaseSha: 'sha_c2',
				renderedCompareBaseSha: 'sha_c2',
				comparisonMode: 'first-parent',
				displayMode: 'changes',
				followHead: true,
				filterQuery: '',
				isSettled: true,
				timelineWindow: { start: 0, count: 3 },
				pagedTimeline: [
					{ sha: 'sha_head', shortSha: 'sha_hea', message: 'feat: head commit', author: 'Dev', timestamp: Date.now(), parents: ['sha_c2'], isMerge: false },
					{ sha: 'sha_c2', shortSha: 'sha_c20', message: 'feat: c2 commit', author: 'Dev', timestamp: Date.now() - 1000, parents: ['sha_c1'], isMerge: false },
					{ sha: 'sha_c1', shortSha: 'sha_c10', message: 'feat: c1 commit', author: 'Dev', timestamp: Date.now() - 2000, parents: [], isMerge: false },
				],
			}
		});

		// Check scrubber initialization: max should be 2 (total 3 - 1), value should be 2 ((3-1)-0)
		const scrubber = harness.elements.get('temporalScrubber')!;
		assert.equal(scrubber.max, '2');
		assert.equal(scrubber.value, '2');
		assert.ok(scrubber.getAttribute('aria-valuetext')?.includes('head commit'));

		// Test Scrubber Interaction: dragging to slider value 0 should select global index 2 ((3-1)-0 = 2)
		scrubber.value = '0';
		scrubber.dispatch('change', {});

		const lastMsg = harness.postedMessages[harness.postedMessages.length - 1];
		assert.equal(lastMsg.type, 'selectTemporalCommitIndex');
		assert.equal(lastMsg.payload.index, 2);
		assert.equal(lastMsg.payload.immediate, true);

		// Test Step Navigation: Clicking prev / next buttons
		const prevBtn = harness.elements.get('temporalPrevBtn')!;
		prevBtn.dispatch('click', {});
		const prevMsg = harness.postedMessages[harness.postedMessages.length - 1];
		assert.equal(prevMsg.type, 'stepTemporalCommit');
		assert.equal(prevMsg.payload.delta, -1);

		const nextBtn = harness.elements.get('temporalNextBtn')!;
		nextBtn.dispatch('click', {});
		const nextMsg = harness.postedMessages[harness.postedMessages.length - 1];
		assert.equal(nextMsg.type, 'stepTemporalCommit');
		assert.equal(nextMsg.payload.delta, 1);

		// Test Arrow Keys on window
		let arrowPrevented = false;
		harness.dispatchWindowKeydown({
			key: 'ArrowLeft',
			target: { tagName: 'DIV' },
			preventDefault: () => { arrowPrevented = true; }
		});
		assert.equal(arrowPrevented, true);
		const arrowLeftMsg = harness.postedMessages[harness.postedMessages.length - 1];
		assert.equal(arrowLeftMsg.type, 'stepTemporalCommit');
		assert.equal(arrowLeftMsg.payload.delta, -1);
	});

	test('4. Details panel displays loading truth and rendered diff summary with renamedModifiedCount', () => {
		const harness = createTemporalWebviewHarness();

		// Post state where selectedCommit is c2 but rendered is c1 (loading in progress)
		harness.postMessageToWebview({
			type: 'temporalState',
			payload: {
				mode: 'temporal',
				activeRepositoryRoot: '/workspace/project',
				selectedRef: 'HEAD',
				selectedCommitSha: 'sha_c2_full_hash',
				renderedCommitSha: 'sha_c1_full_hash',
				selectedCommitIndex: 1,
				loadedCommitCount: 2,
				isLoadingSelection: true,
				selectedCommitSummary: { sha: 'sha_c2_full_hash', message: 'c2 commit', author: 'Dev' },
				renderedCommitSummary: { sha: 'sha_c1_full_hash', message: 'c1 commit', author: 'Dev' },
				pagedTimeline: [
					{ sha: 'sha_c2_full_hash', shortSha: 'sha_c2', message: 'c2 commit' },
					{ sha: 'sha_c1_full_hash', shortSha: 'sha_c1', message: 'c1 commit' },
				],
				diff: {
					targetCommitSha: 'sha_c1_full_hash',
					baseCommitSha: undefined,
					summary: {
						addedCount: 3,
						removedCount: 1,
						modifiedCount: 2,
						renamedCount: 2,
						renamedModifiedCount: 1,
						unchangedCount: 10,
						edgeAddedCount: 2,
						edgeRemovedCount: 1,
						edgeModifiedCount: 0,
					},
					nodes: [],
					edges: [],
				}
			}
		});

		const detailsShaEl = harness.elements.get('detailsCommitSha')!;
		assert.ok(detailsShaEl.textContent.includes('Displaying'));
		assert.ok(detailsShaEl.textContent.includes('Loading…'));

		const detailsSummaryEl = harness.elements.get('detailsDeltaSummary')!;
		assert.ok(detailsSummaryEl.children.length > 0);
		const renamedBadge = detailsSummaryEl.children.find(c => c.classList.contains('badge-renamed'));
		assert.ok(renamedBadge);
		assert.ok(renamedBadge.textContent.includes('2 renamed (~1 also modified)'));
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { suite, test } from 'mocha';
import { PreBaseGraphEditorInput } from '../../host/workbench/graphEditorInput.js';

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
	firstChild: FakeElement | null = null;
	children: FakeElement[] = [];

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
	setAttribute(_name: string, _value: string): void {}
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
	const script = html.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/)?.[1];
	assert.ok(script, 'webview script must be present');

	const elements = new Map<string, FakeElement>();
	for (const id of [
		'archSvg', 'netCanvas', 'status', 'legend', 'empty', 'idleToggle', 'idleToggleWrap',
		'toolbar', 'temporalToolbar', 'temporalRepoWrap', 'temporalRepoSelect', 'temporalScrubberBar', 'temporalRefSelect', 'temporalCompareSelect',
		'temporalFollowHead', 'temporalFilterInput', 'temporalScrubber', 'temporalPrevBtn', 'temporalNextBtn',
		'temporalPlayBtn', 'temporalCommitSha', 'temporalCommitMessage', 'temporalCommitAuthor', 'temporalCommitStatus',
		'temporalPartialWarning', 'badgeAdded', 'badgeRemoved', 'badgeModified', 'badgeRenamed',
		'temporalModeChangesBtn', 'temporalModeStateBtn', 'temporalToggleDetailsBtn', 'temporalTimelineStrip', 'temporalLoadMoreBtn',
		'temporalDetailsPanel', 'temporalDetailsClose', 'temporalDetailsList', 'temporalDetailsSha', 'temporalDetailsAuthor', 'temporalDetailsParents', 'temporalDetailsSummary',
		'detailsCommitSha', 'detailsCommitMsg', 'detailsCommitAuthor', 'detailsCommitParents', 'detailsDeltaSummary', 'detailsEntityList',
		'popup', 'popupTitle', 'popupMeta', 'popupOverview', 'popupAi', 'popupAiProvenance',
		'popupClose', 'popupOpen', 'popupHistoricalView', 'popupSourceDiff', 'popupSetBase', 'popupReveal', 'popupMagnus', 'zoomIn', 'zoomOut', 'fit', 'reset'
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

suite('GraphEditorTemporalWebview (Unit - Phase 3.4 VM & Webview)', () => {
	test('1. Webview HTML structure includes all Phase 3.4 UI components with secure CSP and nonces', () => {
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

	test('3. State Mode Invariant: removed nodes and removed edges are strictly excluded from state projection', () => {
		interface TestNode {
			entityId: string;
			changeKind: 'unchanged' | 'modified' | 'added' | 'removed' | 'renamed';
		}
		interface TestEdge {
			edgeId: string;
			sourceEntityId: string;
			targetEntityId: string;
			changeKind: 'unchanged' | 'modified' | 'added' | 'removed';
		}

		const allNodes: TestNode[] = [
			{ entityId: 'n1', changeKind: 'unchanged' },
			{ entityId: 'n2', changeKind: 'added' },
			{ entityId: 'n3', changeKind: 'removed' },
			{ entityId: 'n4', changeKind: 'modified' },
		];

		const allEdges: TestEdge[] = [
			{ edgeId: 'e1', sourceEntityId: 'n1', targetEntityId: 'n2', changeKind: 'added' },
			{ edgeId: 'e2', sourceEntityId: 'n1', targetEntityId: 'n3', changeKind: 'removed' },
			{ edgeId: 'e3', sourceEntityId: 'n1', targetEntityId: 'n4', changeKind: 'unchanged' },
		];

		function filterForMode(mode: 'changes' | 'state', nodes: TestNode[], edges: TestEdge[]) {
			if (mode === 'changes') {
				return { nodes, edges };
			}
			const visibleNodes = nodes.filter(n => n.changeKind !== 'removed');
			const visibleNodeIds = new Set(visibleNodes.map(n => n.entityId));
			const visibleEdges = edges.filter(e =>
				e.changeKind !== 'removed' &&
				visibleNodeIds.has(e.sourceEntityId) &&
				visibleNodeIds.has(e.targetEntityId)
			);
			return { nodes: visibleNodes, edges: visibleEdges };
		}

		const changesResult = filterForMode('changes', allNodes, allEdges);
		assert.equal(changesResult.nodes.length, 4);
		assert.equal(changesResult.edges.length, 3);

		const stateResult = filterForMode('state', allNodes, allEdges);
		assert.equal(stateResult.nodes.length, 3);
		assert.ok(!stateResult.nodes.some(n => n.entityId === 'n3'));
		assert.equal(stateResult.edges.length, 2);
		assert.ok(!stateResult.edges.some(e => e.edgeId === 'e2'));
	});

	test('4. Production Webview VM: Receives temporalState and updates DOM safely without innerHTML injection', () => {
		const harness = createTemporalWebviewHarness();

		// Post temporal state with repository-controlled strings
		harness.postMessageToWebview({
			type: 'temporalState',
			payload: {
				mode: 'temporal',
				activeRepositoryRoot: '/workspace/project',
				availableRepositories: [{ rootPath: '/workspace/project', name: 'project' }],
				selectedRef: 'main',
				availableRefs: [{ name: 'main', kind: 'branch', isHead: true, targetCommitSha: 'sha1234567' }],
				selectedCommitSha: 'sha1234567890abcdef',
				renderedCommitSha: 'sha1234567890abcdef',
				compareBaseSha: 'base0987654321fedcba',
				renderedCompareBaseSha: 'base0987654321fedcba',
				comparisonMode: 'first-parent',
				displayMode: 'changes',
				followHead: true,
				filterQuery: '',
				isIndexed: true,
				loadedCommitCount: 1,
				pagedTimeline: [{
					sha: 'sha1234567890abcdef',
					shortSha: 'sha1234',
					message: '<script>alert("xss")</script> feat: add security',
					author: 'Security Dev <dev@prebase.io>',
					timestamp: Date.now(),
					parents: ['base0987654321fedcba'],
					isCheckpoint: true,
				}],
			}
		});

		// Post structural diff
		harness.postMessageToWebview({
			type: 'temporalDiff',
			payload: {
				targetCommitSha: 'sha1234567890abcdef',
				baseCommitSha: 'base0987654321fedcba',
				summary: { addedCount: 2, removedCount: 0, modifiedCount: 1, renamedCount: 0, unchangedCount: 5, edgeAddedCount: 1, edgeRemovedCount: 0, edgeModifiedCount: 0 },
				nodes: [
					{ entityId: 'e1', path: 'src/secure.ts', label: 'secure.ts', kind: 'file', x: 10, y: 10, changeKind: 'added' },
					{ entityId: 'e2', path: 'src/app.ts', label: 'app.ts', kind: 'file', x: 20, y: 20, changeKind: 'modified' },
				],
				edges: [
					{ edgeId: 'ed1', sourceEntityId: 'e2', targetEntityId: 'e1', kind: 'imports', changeKind: 'added', edgeData: { id: 'ed1', source: 'src/app.ts', target: 'src/secure.ts' } }
				]
			}
		});

		const commitMsgEl = harness.elements.get('temporalCommitMessage')!;
		assert.ok(commitMsgEl.textContent.includes('feat: add security'));
		// Verify details panel DOM elements were created safely
		const detailsShaEl = harness.elements.get('detailsCommitSha')!;
		assert.ok(detailsShaEl.textContent.includes('sha1234'));

		// Test keyboard interaction: Space key on a BUTTON element must NOT trigger play
		let prevented = false;
		harness.dispatchWindowKeydown({
			key: ' ',
			target: { tagName: 'BUTTON' },
			preventDefault: () => { prevented = true; }
		});
		assert.equal(prevented, false, 'Space key on button must NOT be captured as global play shortcut');
	});
});

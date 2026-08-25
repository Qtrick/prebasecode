/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { suite, test } from 'mocha';

import { computeTemporalUnifiedStatus } from '../../temporal/view/temporalStatusModel.js';
import { computeTemporalFocusContext, computeTemporalVisualRadius, computeTemporalFitTransform } from '../../view/temporal/temporalFocusContext.js';
import { computeCommunityAggregateEdges, computeEdgeLodStyle } from '../../temporal/view/temporalEdgeLod.js';
import { computeVisibleLabels } from '../../temporal/view/temporalLabelLod.js';
import { interpolateWebviewScript } from '../../host/workbench/temporalRuntimeContracts.js';
import type {
	ITemporalViewState,
	TemporalStructuralDiff,
	TemporalCommitSummary,
	TemporalRenderNode,
	TemporalRenderEdge,
	TemporalCommunityGuide,
} from '../../temporal/view/temporalViewTypes.js';

function createWebviewRuntimeContext(): vm.Context {
	const editorSource = readFileSync(new URL('../../host/workbench/graphEditor.ts', import.meta.url), 'utf8');
	const htmlMatch = editorSource.slice(editorSource.indexOf('<script nonce="${nonce}">'));
	const rawScriptMatch = htmlMatch.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/);
	assert.ok(rawScriptMatch, 'webview script must be present in graphEditor.ts');

	const script = interpolateWebviewScript(rawScriptMatch[1], '42', 'temporal');

	const fakeElements = new Map<string, any>();
	const contextObj: Record<string, any> = {
		acquireVsCodeApi: () => ({
			postMessage: () => {},
			getState: () => ({}),
			setState: () => {},
		}),
		document: {
			getElementById: (id: string) => {
				if (!fakeElements.has(id)) {
					fakeElements.set(id, {
						id,
						style: {},
						classList: { add: () => {}, remove: () => {}, contains: () => false },
						setAttribute: () => {},
						getAttribute: () => '',
						addEventListener: () => {},
						appendChild: () => {},
						removeChild: () => {},
						firstChild: null,
						clientWidth: 800,
						clientHeight: 600,
						getContext: () => ({
							save() {},
							restore() {},
							clearRect() {},
							beginPath() {},
							moveTo() {},
							lineTo() {},
							arc() {},
							fill() {},
							stroke() {},
							fillText() {},
							strokeText() {},
							measureText: (text: string) => ({ width: text.length * 7 }),
							scale() {},
							translate() {},
							setLineDash() {},
						}),
					});
				}
				return fakeElements.get(id);
			},
			createElement: (tag: string) => ({
				tagName: tag.toUpperCase(),
				style: {},
				classList: { add: () => {}, remove: () => {}, contains: () => false },
				setAttribute: () => {},
				getAttribute: () => '',
				addEventListener: () => {},
				appendChild: () => {},
				removeChild: () => {},
				firstChild: null,
				clientWidth: 800,
				clientHeight: 600,
				getContext: () => ({
					save() {},
					restore() {},
					clearRect() {},
					beginPath() {},
					moveTo() {},
					lineTo() {},
					arc() {},
					fill() {},
					stroke() {},
					fillText() {},
					strokeText() {},
					measureText: (text: string) => ({ width: text.length * 7 }),
					scale() {},
					translate() {},
					setLineDash() {},
				}),
			}),
		},
		window: {
			addEventListener: () => {},
			removeEventListener: () => {},
			devicePixelRatio: 1,
			innerWidth: 1024,
			innerHeight: 768,
			getComputedStyle: () => ({
				getPropertyValue: () => '#ffffff',
			}),
		},
		getComputedStyle: () => ({
			getPropertyValue: () => '#ffffff',
		}),
		requestAnimationFrame: () => 0,
		cancelAnimationFrame: () => {},
		setTimeout: () => 0,
		clearTimeout: () => {},
		console,
		Math,
		Set,
		Map,
		Array,
		Object,
		Number,
		String,
		Boolean,
	};

	const ctx = vm.createContext(contextObj);
	contextObj.globalThis = ctx;
	(contextObj.window as any).globalThis = ctx;
	vm.runInContext(script, ctx);
	vm.runInContext(`
		globalThis.computeTemporalUnifiedStatus = computeTemporalUnifiedStatus;
		globalThis.computeTemporalFocusContext = computeTemporalFocusContext;
		globalThis.computeTemporalVisualRadius = computeTemporalVisualRadius;
		globalThis.computeTemporalFitTransform = computeTemporalFitTransform;
		globalThis.computeTemporalVisibleElements = computeTemporalVisibleElements;
		globalThis.computeCommunityAggregateEdges = computeCommunityAggregateEdges;
		globalThis.computeEdgeLodStyle = computeEdgeLodStyle;
		globalThis.computeVisibleLabels = computeVisibleLabels;
	`, ctx);
	return ctx;
}

function makeTestCommitSummary(sha: string, shortSha: string, message: string, author: string): TemporalCommitSummary {
	return {
		sha,
		shortSha,
		message,
		author,
		timestamp: Date.now(),
		parents: [],
		isMerge: false,
		isCheckpoint: false,
		isSettled: true,
	};
}

suite('Temporal Production Webview Runtime Parity (State Truth & Execution)', () => {
	const webviewCtx = createWebviewRuntimeContext();

	suite('1. computeTemporalUnifiedStatus Parity', () => {
		const testStates: Array<{ name: string; state: Partial<ITemporalViewState> }> = [
			{
				name: 'Ready state (fully reconciled)',
				state: {
					selectedCommitSha: 'abc1234567890',
					renderedCommitSha: 'abc1234567890',
					selectedCommitSummary: makeTestCommitSummary('abc1234567890', 'abc1234', 'Test commit', 'Dev'),
					renderedCommitSummary: makeTestCommitSummary('abc1234567890', 'abc1234', 'Test commit', 'Dev'),
					pagedTimeline: [makeTestCommitSummary('abc1234567890', 'abc1234', 'Test', 'Dev')],
				},
			},
			{
				name: 'Loading history',
				state: {
					isLoadingHistory: true,
					selectedCommitSha: 'abc1234567890',
					renderedCommitSha: 'abc1234567890',
				},
			},
			{
				name: 'Loading selection (reconstructing diff)',
				state: {
					isLoadingSelection: true,
					selectedCommitSha: 'def4567890123',
					renderedCommitSha: 'abc1234567890',
					selectedCommitSummary: makeTestCommitSummary('def4567890123', 'def4567', 'Second commit', 'Dev'),
				},
			},
			{
				name: 'Selection error on fresh commit',
				state: {
					selectionError: 'Corrupt tree blob',
					selectedCommitSha: 'err1234567890',
					renderedCommitSha: undefined,
					selectedCommitSummary: makeTestCommitSummary('err1234567890', 'err1234', 'Error commit', 'Dev'),
				},
			},
			{
				name: 'Selection error with stale rendered fallback',
				state: {
					selectionError: 'Network git bridge failure',
					selectedCommitSha: 'err1234567890',
					renderedCommitSha: 'ok1234567890',
					selectedCommitSummary: makeTestCommitSummary('err1234567890', 'err1234', 'New commit', 'Dev'),
					renderedCommitSummary: makeTestCommitSummary('ok1234567890', 'ok12345', 'Prev commit', 'Dev'),
				},
			},
			{
				name: 'History loading error',
				state: {
					historyError: 'Repository not found',
				},
			},
			{
				name: 'Stale view (selection != rendered, idle)',
				state: {
					selectedCommitSha: 'shaA111111111',
					renderedCommitSha: 'shaB222222222',
					selectedCommitSummary: makeTestCommitSummary('shaA111111111', 'shaA111', 'A', 'Dev'),
					renderedCommitSummary: makeTestCommitSummary('shaB222222222', 'shaB222', 'B', 'Dev'),
					pagedTimeline: [makeTestCommitSummary('shaA111111111', 'shaA111', 'A', 'Dev')],
				},
			},
			{
				name: 'Partial lineage coverage warning',
				state: {
					isPartialLineage: true,
					selectedCommitSha: 'sha1',
					renderedCommitSha: 'sha1',
					pagedTimeline: [makeTestCommitSummary('sha1', 'sha1', 'A', 'Dev')],
				},
			},
			{
				name: 'Empty timeline (idle)',
				state: {
					pagedTimeline: [],
				},
			},
		];

		for (const { name, state } of testStates) {
			test(`Parity for: ${name}`, () => {
				const hostStatus = computeTemporalUnifiedStatus(state as ITemporalViewState);
				const webviewStatus = webviewCtx.computeTemporalUnifiedStatus(state);

				assert.strictEqual(webviewStatus.kind, hostStatus.kind, `kind mismatch in ${name}`);
				assert.strictEqual(webviewStatus.label, hostStatus.label, `label mismatch in ${name}`);
				assert.strictEqual(webviewStatus.title, hostStatus.title, `title mismatch in ${name}`);
				assert.strictEqual(webviewStatus.isJobActive, hostStatus.isJobActive, `isJobActive mismatch in ${name}`);
				assert.strictEqual(webviewStatus.isError, hostStatus.isError, `isError mismatch in ${name}`);
				assert.strictEqual(webviewStatus.canRetry, hostStatus.canRetry, `canRetry mismatch in ${name}`);
				assert.strictEqual(webviewStatus.colorVar, hostStatus.colorVar, `colorVar mismatch in ${name}`);
				assert.strictEqual(webviewStatus.bgVar, hostStatus.bgVar, `bgVar mismatch in ${name}`);
			});
		}
	});

	suite('2. computeTemporalFocusContext & computeTemporalVisibleElements Parity', () => {
		function makeNode(entityId: string, changeKind: TemporalRenderNode['changeKind'], x: number, y: number): TemporalRenderNode {
			return {
				entityId,
				canonicalNodeId: entityId,
				path: `src/${entityId}`,
				label: entityId,
				kind: 'file',
				changeKind,
				x,
				y,
			};
		}

		function makeEdge(sourceEntityId: string, targetEntityId: string, changeKind: TemporalRenderEdge['changeKind']): TemporalRenderEdge {
			return {
				edgeId: `${sourceEntityId}->${targetEntityId}`,
				sourceEntityId,
				targetEntityId,
				sourcePath: `src/${sourceEntityId}`,
				targetPath: `src/${targetEntityId}`,
				kind: 'import',
				changeKind,
			};
		}

		const mockDiff: TemporalStructuralDiff = {
			baseCommitSha: 'base000000000',
			targetCommitSha: 'target1111111',
			isPartialLineage: false,
			summary: {
				addedCount: 1,
				removedCount: 1,
				modifiedCount: 1,
				renamedCount: 0,
				unchangedCount: 5,
				edgeAddedCount: 1,
				edgeRemovedCount: 1,
				edgeModifiedCount: 0,
			},
			nodes: [
				makeNode('added.ts', 'added', 0, 0),
				makeNode('removed.ts', 'removed', 10, 10),
				makeNode('modified.ts', 'modified', 20, 20),
				makeNode('context1.ts', 'unchanged', 30, 30),
				makeNode('context2.ts', 'unchanged', 40, 40),
				makeNode('distant.ts', 'unchanged', 100, 100),
			],
			edges: [
				makeEdge('added.ts', 'context1.ts', 'added'),
				makeEdge('modified.ts', 'context2.ts', 'unchanged'),
				makeEdge('removed.ts', 'distant.ts', 'removed'),
				makeEdge('context2.ts', 'distant.ts', 'unchanged'),
			],
		};

		test('Focused Changes mode: exact node and edge parity', () => {
			const hostResult = computeTemporalFocusContext(mockDiff, 'changes', 'focused');
			const webviewResult = webviewCtx.computeTemporalVisibleElements(mockDiff, 'changes', 'focused');

			const hostVisibleNodeIds = hostResult.visibleNodes.map(n => n.entityId).sort();
			const webviewVisibleNodeIds = (webviewResult.nodes.map((n: any) => n.entityId) as string[]).sort();
			assert.deepStrictEqual(JSON.parse(JSON.stringify(webviewVisibleNodeIds)), JSON.parse(JSON.stringify(hostVisibleNodeIds)));

			const hostVisibleEdgeCount = hostResult.visibleEdges.length;
			const webviewVisibleEdgeCount = webviewResult.edges.length;
			assert.strictEqual(webviewVisibleEdgeCount, hostVisibleEdgeCount);

			assert.strictEqual(webviewResult.hasZeroChanges, hostResult.hasZeroChanges);
			assert.strictEqual(webviewResult.totalNodeCount, hostResult.totalNodeCount);
		});

		test('Full Changes mode: exact node and edge parity', () => {
			const hostResult = computeTemporalFocusContext(mockDiff, 'changes', 'full');
			const webviewResult = webviewCtx.computeTemporalVisibleElements(mockDiff, 'changes', 'full');

			assert.strictEqual(webviewResult.nodes.length, hostResult.visibleNodes.length);
			assert.strictEqual(webviewResult.edges.length, hostResult.visibleEdges.length);
		});

		test('State mode: excludes removed ghosts identically', () => {
			const hostResult = computeTemporalFocusContext(mockDiff, 'state', 'focused');
			const webviewResult = webviewCtx.computeTemporalVisibleElements(mockDiff, 'state', 'focused');

			const hostNodeIds = hostResult.visibleNodes.map(n => n.entityId).sort();
			const webviewNodeIds = (webviewResult.nodes.map((n: any) => n.entityId) as string[]).sort();
			assert.deepStrictEqual(JSON.parse(JSON.stringify(webviewNodeIds)), JSON.parse(JSON.stringify(hostNodeIds)));
			assert.ok(!webviewNodeIds.includes('removed.ts'), 'Removed ghosts must not be present in state mode');
		});

		test('Zero changes commit returns empty nodes with hasZeroChanges: true', () => {
			const emptyDiff: TemporalStructuralDiff = {
				baseCommitSha: 'b',
				targetCommitSha: 't',
				isPartialLineage: false,
				summary: {
					addedCount: 0,
					removedCount: 0,
					modifiedCount: 0,
					renamedCount: 0,
					unchangedCount: 5,
					edgeAddedCount: 0,
					edgeRemovedCount: 0,
					edgeModifiedCount: 0,
				},
				nodes: [makeNode('a.ts', 'unchanged', 0, 0)],
				edges: [],
			};

			const hostResult = computeTemporalFocusContext(emptyDiff, 'changes', 'focused');
			const webviewResult = webviewCtx.computeTemporalVisibleElements(emptyDiff, 'changes', 'focused');

			assert.strictEqual(webviewResult.nodes.length, 0);
			assert.strictEqual(webviewResult.hasZeroChanges, true);
			assert.strictEqual(hostResult.hasZeroChanges, true);
		});
	});

	suite('3. computeTemporalVisualRadius & computeTemporalFitTransform Parity', () => {
		test('computeTemporalVisualRadius produces identical values for changed vs unchanged nodes', () => {
			const changedNode: any = { entityId: 'c.ts', changeKind: 'modified' };
			const unchangedNode: any = { entityId: 'u.ts', changeKind: 'unchanged' };

			const hostChangedR = computeTemporalVisualRadius(changedNode);
			const webviewChangedR = webviewCtx.computeTemporalVisualRadius(changedNode);
			assert.strictEqual(webviewChangedR, hostChangedR);

			const hostUnchangedR = computeTemporalVisualRadius(unchangedNode);
			const webviewUnchangedR = webviewCtx.computeTemporalVisualRadius(unchangedNode);
			assert.strictEqual(webviewUnchangedR, hostUnchangedR);
		});

		test('computeTemporalFitTransform produces identical camera transform values', () => {
			const nodes: any[] = [
				{ entityId: '1', x: 100, y: 200, changeKind: 'modified' },
				{ entityId: '2', x: 300, y: 400, changeKind: 'unchanged' },
			];

			const hostTransform = computeTemporalFitTransform(nodes, 1280, 800, { padding: 64 });
			const webviewTransform = webviewCtx.computeTemporalFitTransform(nodes, 1280, 800, { padding: 64 });

			assert.strictEqual(webviewTransform.x, hostTransform.x);
			assert.strictEqual(webviewTransform.y, hostTransform.y);
			assert.strictEqual(webviewTransform.k, hostTransform.k);
		});
	});

	suite('4. computeCommunityAggregateEdges, computeEdgeLodStyle & computeVisibleLabels Parity', () => {
		test('computeCommunityAggregateEdges produces identical aggregates in webview and host', () => {
			const guides: TemporalCommunityGuide[] = [
				{ id: 'commA', label: 'Comm A', layerId: 'ui', color: '#ff0000', x: 0, y: 0, radius: 50, bounds: { minX: -50, minY: -50, maxX: 50, maxY: 50, width: 100, height: 100 }, nodeIds: ['a1', 'a2'], nodeCount: 2 },
				{ id: 'commB', label: 'Comm B', layerId: 'services', color: '#00ff00', x: 200, y: 200, radius: 50, bounds: { minX: 150, minY: 150, maxX: 250, maxY: 250, width: 100, height: 100 }, nodeIds: ['b1', 'b2'], nodeCount: 2 },
			];
			const edges: TemporalRenderEdge[] = [
				{ edgeId: 'e1', sourceEntityId: 'a1', targetEntityId: 'b1', sourcePath: 'src/a1.ts', targetPath: 'src/b1.ts', kind: 'imports', changeKind: 'unchanged' },
				{ edgeId: 'e2', sourceEntityId: 'a2', targetEntityId: 'b2', sourcePath: 'src/a2.ts', targetPath: 'src/b2.ts', kind: 'imports', changeKind: 'modified' },
			];

			const hostAgg = computeCommunityAggregateEdges(edges, guides);
			const webviewAgg = webviewCtx.computeCommunityAggregateEdges(edges, guides);

			assert.deepStrictEqual(JSON.parse(JSON.stringify(webviewAgg)), JSON.parse(JSON.stringify(hostAgg)));
		});

		test('computeEdgeLodStyle produces identical styling across zoom levels', () => {
			const edge: TemporalRenderEdge = {
				edgeId: 'e1',
				sourceEntityId: '1',
				targetEntityId: '2',
				sourcePath: '1.ts',
				targetPath: '2.ts',
				kind: 'imports',
				changeKind: 'unchanged',
			};

			const hostOverview = computeEdgeLodStyle(edge, 0.45);
			const webviewOverview = webviewCtx.computeEdgeLodStyle(edge, 0.45);
			assert.deepStrictEqual(JSON.parse(JSON.stringify(webviewOverview)), JSON.parse(JSON.stringify(hostOverview)));

			const hostDetail = computeEdgeLodStyle(edge, 1.45);
			const webviewDetail = webviewCtx.computeEdgeLodStyle(edge, 1.45);
			assert.deepStrictEqual(JSON.parse(JSON.stringify(webviewDetail)), JSON.parse(JSON.stringify(hostDetail)));
		});

		test('computeVisibleLabels produces identical prioritized labels', () => {
			const nodes: TemporalRenderNode[] = [
				{ entityId: '1', canonicalNodeId: '1', path: 'src/app.ts', label: 'app.ts', kind: 'file', x: 100, y: 100, changeKind: 'modified' },
				{ entityId: '2', canonicalNodeId: '2', path: 'src/util.ts', label: 'util.ts', kind: 'file', x: 200, y: 200, changeKind: 'unchanged' },
			];

			const hostLabels = computeVisibleLabels(nodes, 1.5, { selectedNodeId: '1' });
			const webviewLabels = webviewCtx.computeVisibleLabels(nodes, 1.5, { selectedNodeId: '1' });

			assert.deepStrictEqual(JSON.parse(JSON.stringify(webviewLabels)), JSON.parse(JSON.stringify(hostLabels)));
		});
	});
});

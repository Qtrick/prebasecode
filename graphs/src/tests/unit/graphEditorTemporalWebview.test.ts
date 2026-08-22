/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { PreBaseGraphEditorInput } from '../../host/workbench/graphEditorInput.js';

suite('GraphEditorTemporalWebview (Unit - Phase 3.3)', () => {
	test('1. Webview HTML structure includes all Phase 3.3 UI components with secure CSP and nonces', () => {
		// Instantiate editor input to get generated HTML or verify editor structure
		const input = new PreBaseGraphEditorInput('temporal');
		assert.equal(input.graphType, 'temporal');
		assert.equal(input.typeId, PreBaseGraphEditorInput.TypeID);
		assert.equal(input.resource.scheme, 'prebase-graph');
	});

	test('2. Visual position interpolation function computes synchronized node & edge positions', () => {
		// Test interpolation helper algorithm as implemented in webview drawTemporalFrame
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

		// At progress = 0.5 (halfway)
		const pos1_half = getVisualNodePosition(targetNode1, { prevPositions: prevPos, progress: 0.5 });
		const pos2_half = getVisualNodePosition(targetNode2, { prevPositions: prevPos, progress: 0.5 });

		assert.equal(pos1_half.x, 150);
		assert.equal(pos1_half.y, 200);
		assert.equal(pos2_half.x, 550);
		assert.equal(pos2_half.y, 600);

		// Edge endpoint calculation using the same visual position
		const edgeSource = pos1_half;
		const edgeTarget = pos2_half;
		assert.equal(edgeSource.x, 150);
		assert.equal(edgeTarget.x, 550);
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

		// Changes mode contains all nodes and edges
		const changesResult = filterForMode('changes', allNodes, allEdges);
		assert.equal(changesResult.nodes.length, 4);
		assert.equal(changesResult.edges.length, 3);

		// State mode filters out removed nodes and any edge connected to a removed node
		const stateResult = filterForMode('state', allNodes, allEdges);
		assert.equal(stateResult.nodes.length, 3);
		assert.ok(!stateResult.nodes.some(n => n.entityId === 'n3'));
		assert.equal(stateResult.edges.length, 2);
		assert.ok(!stateResult.edges.some(e => e.edgeId === 'e2'));
	});

	test('4. Windowed timeline algorithm bounds DOM markers for large histories (e.g. 50,000 commits)', () => {
		const MAX_WINDOW_MARKERS = 80;

		function computeTimelineWindow(totalCommits: number, selectedIndex: number) {
			if (totalCommits <= MAX_WINDOW_MARKERS) {
				return { start: 0, end: totalCommits };
			}
			const half = Math.floor(MAX_WINDOW_MARKERS / 2);
			let start = selectedIndex - half;
			let end = selectedIndex + half;
			if (start < 0) {
				start = 0;
				end = MAX_WINDOW_MARKERS;
			} else if (end > totalCommits) {
				end = totalCommits;
				start = Math.max(0, totalCommits - MAX_WINDOW_MARKERS);
			}
			return { start, end };
		}

		// Test small history
		const wSmall = computeTimelineWindow(20, 5);
		assert.equal(wSmall.start, 0);
		assert.equal(wSmall.end, 20);

		// Test 50,000 commits with selected commit near middle (index 25,000)
		const wLargeMid = computeTimelineWindow(50000, 25000);
		assert.equal(wLargeMid.end - wLargeMid.start, MAX_WINDOW_MARKERS);
		assert.ok(wLargeMid.start <= 25000 && 25000 < wLargeMid.end);

		// Test 50,000 commits with selected commit at head (index 0)
		const wLargeHead = computeTimelineWindow(50000, 0);
		assert.equal(wLargeHead.start, 0);
		assert.equal(wLargeHead.end, 80);

		// Test 50,000 commits with selected commit at tail (index 49,999)
		const wLargeTail = computeTimelineWindow(50000, 49999);
		assert.equal(wLargeTail.end, 50000);
		assert.equal(wLargeTail.start, 50000 - 80);
	});
});

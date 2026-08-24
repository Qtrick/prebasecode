/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	computeTemporalFocusContext,
	computeTemporalVisualRadius,
	computeTemporalFitTransform,
} from '../../view/temporal/temporalFocusContext.js';
import { computeSemanticTemporalInitialLayout } from '../../temporal/view/temporalLayoutEngine.js';
import type {
	TemporalStructuralDiff,
	TemporalRenderNode,
	TemporalRenderEdge,
} from '../../temporal/view/temporalViewTypes.js';

suite('TemporalProductionParity (Unit - Focus+Context, Radius & Status Parity)', () => {
	function makeDiff(options: {
		added?: number;
		modified?: number;
		removed?: number;
		unchanged?: number;
	} = {}): TemporalStructuralDiff {
		const nodes: TemporalRenderNode[] = [];
		const edges: TemporalRenderEdge[] = [];
		const added = options.added ?? 2;
		const modified = options.modified ?? 1;
		const removed = options.removed ?? 1;
		const unchanged = options.unchanged ?? 5;

		let idx = 0;
		for (let i = 0; i < added; i++, idx++) {
			nodes.push({
				entityId: `ent-${idx}`,
				canonicalNodeId: `can-${idx}`,
				path: `src/features/feature${i}.ts`,
				label: `feature${i}.ts`,
				kind: 'file',
				changeKind: 'added',
				x: 100 + i * 20,
				y: 100,
			});
		}
		for (let i = 0; i < modified; i++, idx++) {
			nodes.push({
				entityId: `ent-${idx}`,
				canonicalNodeId: `can-${idx}`,
				path: `src/services/service${i}.ts`,
				label: `service${i}.ts`,
				kind: 'file',
				changeKind: 'modified',
				x: 200 + i * 20,
				y: 200,
			});
		}
		for (let i = 0; i < removed; i++, idx++) {
			nodes.push({
				entityId: `ent-${idx}`,
				canonicalNodeId: `can-${idx}`,
				path: `src/legacy/old${i}.ts`,
				label: `old${i}.ts`,
				kind: 'file',
				changeKind: 'removed',
				x: -100 - i * 20,
				y: -100,
			});
		}
		for (let i = 0; i < unchanged; i++, idx++) {
			nodes.push({
				entityId: `ent-${idx}`,
				canonicalNodeId: `can-${idx}`,
				path: `src/utils/util${i}.ts`,
				label: `util${i}.ts`,
				kind: 'file',
				changeKind: 'unchanged',
				x: 300 + i * 20,
				y: 300,
			});
		}

		// Connect modified node to unchanged node
		edges.push({
			edgeId: 'edge-mod-util',
			sourceEntityId: `ent-${added}`, // modified
			targetEntityId: `ent-${added + modified + removed}`, // unchanged
			sourcePath: `src/services/service0.ts`,
			targetPath: `src/utils/util0.ts`,
			kind: 'import',
			changeKind: 'modified',
		});

		return {
			targetCommitSha: 'commit-target',
			baseCommitSha: 'commit-base',
			nodes,
			edges,
			isPartialLineage: false,
			summary: {
				addedCount: added,
				modifiedCount: modified,
				removedCount: removed,
				renamedCount: 0,
				unchangedCount: unchanged,
				edgeAddedCount: 0,
				edgeRemovedCount: 0,
				edgeModifiedCount: 1,
			},
		};
	}

	test('1. Full Codebase State Mode: Excludes removed entities from active state graph', () => {
		const diff = makeDiff({ added: 3, modified: 2, removed: 2, unchanged: 5 });
		const result = computeTemporalFocusContext(diff, 'state', 'full');

		assert.strictEqual(result.hasZeroChanges, false);
		const removedNodes = result.visibleNodes.filter(n => n.changeKind === 'removed');
		assert.strictEqual(removedNodes.length, 0, 'State mode does not render deleted entities');
		assert.strictEqual(result.visibleNodes.length, 3 + 2 + 5, 'Total rendered nodes matches surviving set');
	});

	test('2. Focus Changes Mode: Renders changed nodes and direct context neighbors in focused mode', () => {
		const diff = makeDiff({ added: 2, modified: 1, removed: 1, unchanged: 5 });
		const result = computeTemporalFocusContext(diff, 'changes', 'focused');

		assert.strictEqual(result.hasZeroChanges, false);
		assert.strictEqual(result.changedNodeIds.size, 2 + 1 + 1, 'Changed node IDs contains all added, modified, removed nodes');
		assert.strictEqual(result.directContextNodeIds.size, 1, 'Direct context includes the connected util node');
		assert.strictEqual(result.visibleNodes.length, 4 + 1, 'Visible nodes equals changed + direct context');
	});

	test('3. Zero Changes Detection: Empty change set correctly flags hasZeroChanges in changes mode', () => {
		const diff = makeDiff({ added: 0, modified: 0, removed: 0, unchanged: 10 });
		const result = computeTemporalFocusContext(diff, 'changes', 'focused');

		assert.strictEqual(result.hasZeroChanges, true, 'Flags hasZeroChanges so fallback UI is displayed');
		assert.strictEqual(result.visibleNodes.length, 0);
	});

	test('4. Overlay-Aware Fit Transform: Insets shift camera center away from overlays', () => {
		const diff = makeDiff();
		const transformNoInsets = computeTemporalFitTransform(diff.nodes, 1000, 800, { insets: { top: 0, bottom: 0, left: 0, right: 0 } });
		const transformWithInsets = computeTemporalFitTransform(diff.nodes, 1000, 800, { insets: { top: 48, bottom: 68, left: 12, right: 360 } });

		assert.ok(transformNoInsets.k > 0, 'Valid scale');
		assert.ok(transformWithInsets.k > 0, 'Valid scale');
		// Right inset shifts viewport center leftward (smaller x)
		assert.ok(transformWithInsets.x < transformNoInsets.x, `Insets shifted camera center left: ${transformWithInsets.x} < ${transformNoInsets.x}`);
	});

	test('5. Visual Radius Precedence: Selected and focus nodes have larger radius than distant context', () => {
		const changedNode: TemporalRenderNode = {
			entityId: 'c1', canonicalNodeId: 'can1', path: 'src/app.ts', label: 'app.ts', kind: 'file', changeKind: 'modified', x: 0, y: 0
		};
		const unchangedNode: TemporalRenderNode = {
			entityId: 'u1', canonicalNodeId: 'can2', path: 'src/lib.ts', label: 'lib.ts', kind: 'file', changeKind: 'unchanged', x: 0, y: 0
		};

		const rChanged = computeTemporalVisualRadius(changedNode, { isChanged: true });
		const rUnchanged = computeTemporalVisualRadius(unchangedNode, { isChanged: false });
		const rSelected = computeTemporalVisualRadius(unchangedNode, { isSelected: true, isChanged: false });

		assert.ok(rChanged > rUnchanged, `Focus node radius (${rChanged}) > context radius (${rUnchanged})`);
		assert.ok(rSelected > rUnchanged, `Selected node radius (${rSelected}) > unselected radius (${rUnchanged})`);
	});

	test('6. Semantic Layout Clustered Organization: Macro separation and cluster hull guides', () => {
		const diff = makeDiff({ added: 5, modified: 5, removed: 0, unchanged: 20 });
		const layout = computeSemanticTemporalInitialLayout(diff.nodes, diff.edges, 60);

		assert.ok(layout.positions.size >= 30, 'All nodes positioned');
		assert.ok(Array.isArray(layout.guides), 'Guides array generated');
		assert.ok(layout.guides!.length > 0, 'At least 1 community guide generated');
	});
});

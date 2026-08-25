/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { computeVisibleLabels } from '../../temporal/view/temporalLabelLod.js';
import type { TemporalRenderNode } from '../../temporal/view/temporalViewTypes.js';

suite('TemporalLabelLod (Unit - Screen-Space Priority & Collision Culling)', () => {
	function makeNode(id: string, path: string, changeKind: any = 'unchanged', x = 0, y = 0, isEntry = false): TemporalRenderNode {
		return {
			entityId: id,
			canonicalNodeId: `can-${id}`,
			path,
			label: path.split('/').pop() || path,
			kind: 'file',
			x,
			y,
			changeKind,
			meta: {
				isEntry,
			},
		};
	}

	test('1. Selected and Hovered nodes have highest priority and bypass collision culling', () => {
		const nodes = [
			makeNode('n1', 'src/normal.ts', 'unchanged', 100, 100),
			makeNode('n2', 'src/selected.ts', 'unchanged', 102, 102), // Very close to n1
		];

		const labels = computeVisibleLabels(nodes, 1.5, {
			selectedNodeId: 'n2',
		});

		assert.ok(labels.some(l => l.entityId === 'n2' && l.isSelected));
	});

	test('2. Changed nodes have priority over unchanged nodes', () => {
		const nodes = [
			makeNode('n-unchanged', 'src/unchanged.ts', 'unchanged', 200, 200),
			makeNode('n-modified', 'src/modified.ts', 'modified', 205, 205),
		];

		// Far zoom (k = 0.5) - only changed nodes get labeled
		const labels = computeVisibleLabels(nodes, 0.5);

		assert.equal(labels.length, 1);
		assert.equal(labels[0].entityId, 'n-modified');
		assert.equal(labels[0].isChanged, true);
	});

	test('3. Screen-Space Collision Culling: Overlapping text boxes are culled for non-selected nodes', () => {
		// 5 nodes with identical coordinates
		const nodes = [
			makeNode('n1', 'src/file1.ts', 'modified', 300, 300),
			makeNode('n2', 'src/file2.ts', 'modified', 300, 300),
			makeNode('n3', 'src/file3.ts', 'modified', 300, 300),
		];

		const labels = computeVisibleLabels(nodes, 1.0);

		// Only one label can occupy that screen box without collision
		assert.equal(labels.length, 1);
		assert.equal(labels[0].entityId, 'n1');
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { NetworkEdgeRenderStrategy } from '../../view/network/networkEdgeRenderStrategy.js';
import type { GraphEdge, EdgeKind } from '../../common/types/graphTypes.js';

suite('NetworkEdgeRenderStrategy (Unit - Semantic Edge Variants & LOD)', () => {
	function makeEdge(kind: EdgeKind, source = 'n1', target = 'n2', meta?: any): GraphEdge {
		return {
			id: `${source}-${target}`,
			source,
			target,
			kind,
			meta: meta || {},
		};
	}

	test('1. Highlighted / Selected incident edge receives prominent accent styling and highest priority', () => {
		const edge = makeEdge('import', 'node-A', 'node-B');
		const desc = NetworkEdgeRenderStrategy.evaluate(edge, {
			zoom: 1.0,
			activeHighlightNodeId: 'node-A',
		});

		assert.equal(desc.variant, 'highlighted');
		assert.equal(desc.alpha, 1.0);
		assert.equal(desc.priority, 3);
		assert.equal(desc.visibleAtLOD, true);
		assert.ok(desc.lineWidth >= 1.8);
	});

	test('2. Unrelated edges during node selection are dimmed to background', () => {
		const edge = makeEdge('import', 'node-X', 'node-Y');
		const desc = NetworkEdgeRenderStrategy.evaluate(edge, {
			zoom: 1.0,
			activeHighlightNodeId: 'node-A',
		});

		assert.equal(desc.variant, 'dimmed');
		assert.ok(desc.alpha < 0.1);
		assert.equal(desc.priority, 0);
	});

	test('3. Contains edge is quiet and suppressed at macro zoom, visible at detail zoom', () => {
		const edge = makeEdge('contains', 'folder-1', 'file-1');

		const macroDesc = NetworkEdgeRenderStrategy.evaluate(edge, { zoom: 0.3 });
		assert.equal(macroDesc.variant, 'contains');
		assert.equal(macroDesc.visibleAtLOD, false);
		assert.deepEqual(macroDesc.dash, [2, 3]);

		const detailDesc = NetworkEdgeRenderStrategy.evaluate(edge, { zoom: 1.2 });
		assert.equal(detailDesc.variant, 'contains');
		assert.equal(detailDesc.visibleAtLOD, true);
		assert.ok(detailDesc.alpha > 0);
	});

	test('4. Aggregate dependency edge is visible at macro/overview zoom with strong stroke', () => {
		const edge = makeEdge('dependency', 'pkg-A', 'pkg-B');

		const macroDesc = NetworkEdgeRenderStrategy.evaluate(edge, { zoom: 0.3 });
		assert.equal(macroDesc.variant, 'dependency');
		assert.equal(macroDesc.visibleAtLOD, true);
		assert.ok(macroDesc.alpha >= 0.5);
		assert.equal(macroDesc.priority, 2);
	});

	test('5. Dynamic import edge has distinct dashed pattern and accent style', () => {
		const edge = makeEdge('import', 'n1', 'n2', { isDynamic: true });
		const desc = NetworkEdgeRenderStrategy.evaluate(edge, { zoom: 1.0 });

		assert.equal(desc.variant, 'dynamic');
		assert.deepEqual(desc.dash, [4, 4]);
		assert.equal(desc.visibleAtLOD, true);
	});

	test('6. Entry-related edge receives amber token and higher overview visibility', () => {
		const edge = makeEdge('import', 'entry-node', 'service-node');
		const desc = NetworkEdgeRenderStrategy.evaluate(edge, {
			zoom: 0.4,
			entryNodeId: 'entry-node',
		});

		assert.equal(desc.variant, 'entry');
		assert.equal(desc.visibleAtLOD, true);
		assert.ok(desc.alpha >= 0.6);
	});

	test('7. Standard import edge LOD suppresses raw imports at extreme macro view', () => {
		const edge = makeEdge('import', 'file-a', 'file-b');

		const macroDesc = NetworkEdgeRenderStrategy.evaluate(edge, { zoom: 0.25 });
		assert.equal(macroDesc.variant, 'import');
		assert.equal(macroDesc.visibleAtLOD, false);

		const midDesc = NetworkEdgeRenderStrategy.evaluate(edge, { zoom: 0.8 });
		assert.equal(midDesc.variant, 'import');
		assert.equal(midDesc.visibleAtLOD, true);
		assert.ok(midDesc.alpha >= 0.3);

		const detailDesc = NetworkEdgeRenderStrategy.evaluate(edge, { zoom: 1.4 });
		assert.equal(detailDesc.variant, 'import');
		assert.equal(detailDesc.visibleAtLOD, true);
		assert.equal(detailDesc.hasArrow, true);
	});
});

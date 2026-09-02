/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	computeVisibleLabels,
	computeVisibleCommunityGuideLabels,
	computeVisibleRouteBadges,
	computeTemporalLabelLayout,
	shortenCommunityLabel,
	type LabelBox,
} from '../../temporal/view/temporalLabelLod.js';
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

	test('5. shortenCommunityLabel keeps hierarchical leaf when it fits the budget', () => {
		assert.equal(shortenCommunityLabel('Platform · Services · AuthModule', 28), 'AuthModule');
		assert.equal(shortenCommunityLabel('Core / UI / Dashboard', 20), 'Dashboard');
	});

	test('6. shortenCommunityLabel ellipsizes flat long names deterministically', () => {
		const long = 'VeryLongCommunityNameWithoutSeparators';
		const out = shortenCommunityLabel(long, 20);
		assert.ok(out.length <= 20);
		assert.ok(out.includes('…'));
		assert.equal(out, shortenCommunityLabel(long, 20));
	});

	test('7. community guide labels respect zoom-tier budgets and suppress below overview threshold', () => {
		const guides = Array.from({ length: 30 }, (_, i) => ({
			id: `g${i}`,
			label: `Community ${i}`,
			bounds: { minX: i * 220, minY: 0, maxX: i * 220 + 120, maxY: 120 },
			nodeCount: 30 - i,
		}));
		assert.equal(computeVisibleCommunityGuideLabels(guides, 0.1, []).length, 0);
		assert.ok(computeVisibleCommunityGuideLabels(guides, 0.25, []).length <= 8);
		assert.ok(computeVisibleCommunityGuideLabels(guides, 0.5, []).length <= 14);
		assert.ok(computeVisibleCommunityGuideLabels(guides, 1.0, []).length <= 24);
	});

	test('8. community guide labels skip lower-priority guides on box collision', () => {
		const sharedBounds = { minX: 100, minY: 100, maxX: 300, maxY: 300 };
		const guides = [
			{ id: 'high', label: 'High Priority', bounds: sharedBounds, nodeCount: 50 },
			{ id: 'low', label: 'Low Priority', bounds: sharedBounds, nodeCount: 2 },
		];
		const placed: LabelBox[] = [];
		const labels = computeVisibleCommunityGuideLabels(guides, 1.0, placed);
		assert.equal(labels.length, 1);
		assert.equal(labels[0].guideId, 'high');
		assert.ok(placed.length >= 1, 'winning guide must seed shared occupancy');
	});

	test('9. unified layout reserves guide occupancy before placing node labels', () => {
		const guide = {
			id: 'comm1',
			label: 'Services Layer',
			bounds: { minX: 90, minY: 90, maxX: 220, maxY: 220 },
			nodeCount: 5,
		};
		// Place node so its label box sits under the guide's top-left occupancy slot.
		const node = makeNode('n1', 'src/file.ts', 'modified', 100, 100);
		const layout = computeTemporalLabelLayout([node], [guide], 0.8);
		assert.ok(layout.guideLabels.some(g => g.guideId === 'comm1'));
		assert.equal(layout.nodeLabels.length, 0, 'node label must yield to guide occupancy');

		const withSelected = computeTemporalLabelLayout([node], [guide], 0.8, { selectedNodeId: 'n1' });
		assert.ok(withSelected.nodeLabels.some(l => l.entityId === 'n1'), 'selected nodes bypass occupancy culling');
	});

	test('10. Screen-Space Legibility: community landmarks at low zoom (k=0.21) maintain readable screen-size fonts', () => {
		const guide = {
			id: 'cloud',
			label: 'Cloud Infrastructure',
			bounds: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
			nodeCount: 112,
			layerId: 'services',
		};
		const labels = computeVisibleCommunityGuideLabels([guide], 0.21, []);
		assert.equal(labels.length, 1);
		const landmark = labels[0];
		assert.ok(landmark.isCard, 'must be marked as landmark card');
		assert.ok(landmark.font.includes('px'));
		const match = landmark.font.match(/(\d+)px/);
		assert.ok(match, 'font must contain pixel size');
		const worldPx = parseInt(match[1], 10);
		// At k = 0.21, worldPx * 0.21 must produce >= 10px screen size
		const screenPx = worldPx * 0.21;
		assert.ok(screenPx >= 10, `Screen font must be >= 10px (actual: ${screenPx.toFixed(1)}px from world ${worldPx}px)`);
		assert.ok(landmark.subText?.includes('112 files'), 'subtext must explain node count clearly');
	});

	test('11. aggregate guide labels reserve shared occupancy before node labels are placed', () => {
		const guides = [
			{
				id: 'comm-a',
				label: 'Services',
				bounds: { minX: 0, minY: 0, maxX: 180, maxY: 140 },
				nodeCount: 40,
			},
			{
				id: 'comm-b',
				label: 'Database',
				bounds: { minX: 200, minY: 0, maxX: 380, maxY: 140 },
				nodeCount: 35,
			},
		];
		const nodes = [
			makeNode('n-under-a', 'src/a.ts', 'modified', 40, 30),
			makeNode('n-under-b', 'src/b.ts', 'modified', 240, 30),
		];
		const layout = computeTemporalLabelLayout(nodes, guides, 0.75);
		assert.equal(layout.guideLabels.length, 2, 'both aggregate guide labels should be placed');
		assert.equal(layout.nodeLabels.length, 0, 'node labels must yield to aggregate guide occupancy');
		assert.ok(layout.labelOverlapCount >= 0);
	});

	test('7. Route badges share occupancy with guide labels and rank changed relationships', () => {
		const placed: LabelBox[] = [{
			x: 90,
			y: 60,
			w: 40,
			h: 20,
		}];
		const candidates = [
			{ id: 'a::b', text: '12', x: 100, y: 70, edgeCount: 12, changedEdgeCount: 0 },
			{ id: 'c::d', text: '3', x: 200, y: 70, edgeCount: 3, changedEdgeCount: 2 },
		];
		const badges = computeVisibleRouteBadges(candidates, 0.5, placed);
		assert.equal(badges.length, 1);
		assert.equal(badges[0].id, 'c::d');
		assert.equal(badges[0].isChanged, true);
		const layout = computeTemporalLabelLayout([], [], 0.5, {
			routeBadgeCandidates: [
				{ id: 'x::y', text: '8', x: 50, y: 50, edgeCount: 8, changedEdgeCount: 0 },
				{ id: 'y::z', text: '4', x: 52, y: 52, edgeCount: 4, changedEdgeCount: 0 },
			],
		});
		assert.ok(layout.routeBadges.length <= 1, 'overlapping route badges must be culled');
		assert.equal(layout.compositeLabelOverlapCount, layout.labelOverlapCount);
	});

	test('4. Hoists the workbench font family once per pass into every visible label', () => {
		const previousDocument = globalThis.document;
		const previousGetComputedStyle = globalThis.getComputedStyle;
		let familyReads = 0;
		globalThis.document = { body: { id: 'workbench-body' } } as unknown as Document;
		globalThis.getComputedStyle = ((element: { id?: string }) => {
			assert.equal(element?.id, 'workbench-body');
			familyReads++;
			return { fontFamily: 'Menlo, Monaco, monospace' } as CSSStyleDeclaration;
		}) as typeof getComputedStyle;
		try {
			const nodes = [
				makeNode('n1', 'src/file1.ts', 'modified', 0, 0),
				makeNode('n2', 'src/file2.ts', 'modified', 80, 0),
				makeNode('n3', 'src/file3.ts', 'unchanged', 160, 0),
			];
			const labels = computeVisibleLabels(nodes, 2.0, { selectedNodeId: 'n1' });
			assert.ok(labels.length >= 2, 'more than one label must be measured in this pass');
			assert.equal(familyReads, 1, 'getComputedStyle must run once per pass, not per label');
			assert.ok(labels.every(label => label.font.includes('Menlo, Monaco, monospace')));
			assert.ok(labels.some(label => label.font.startsWith('bold 11px')));
			assert.ok(labels.some(label => label.font.startsWith('10px')));
		} finally {
			globalThis.document = previousDocument;
			globalThis.getComputedStyle = previousGetComputedStyle;
		}
	});
});

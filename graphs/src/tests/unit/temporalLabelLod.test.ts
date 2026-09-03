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

	test('1. Selected and Hovered nodes have highest priority (rank wins occupancy; no collision bypass)', () => {
		const nodes = [
			makeNode('n1', 'src/normal.ts', 'unchanged', 100, 100),
			makeNode('n2', 'src/selected.ts', 'unchanged', 102, 102), // Very close to n1
		];

		const labels = computeVisibleLabels(nodes, 1.5, {
			selectedNodeId: 'n2',
		});

		assert.ok(labels.some(l => l.entityId === 'n2' && l.isSelected));
		assert.equal(labels.length, 1, 'overlapping lower-ranked label must be culled');
	});

	test('1b. Selected cannot bypass seeded occupancy (forceEmphasis collision bypass removed)', () => {
		const nodes = [makeNode('n-selected', 'src/selected.ts', 'unchanged', 100, 100)];
		const seed: LabelBox[] = [{ x: 50, y: 100, w: 120, h: 20 }];
		const labels = computeVisibleLabels(nodes, 1.5, {
			selectedNodeId: 'n-selected',
			occupancySeed: seed,
		});
		assert.equal(labels.length, 0, 'selected must respect occupancy seed — no forceEmphasis bypass');
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

	test('2b. Changed nodes outrank entry nodes at the same screen slot', () => {
		const nodes = [
			makeNode('n-modified', 'src/modified.ts', 'modified', 300, 300),
			makeNode('n-entry', 'src/index.ts', 'unchanged', 300, 300, true),
		];
		const labels = computeVisibleLabels(nodes, 1.0);
		assert.equal(labels.length, 1);
		assert.equal(labels[0].entityId, 'n-modified');
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

	test('7b. unified layout keeps community landmarks at Fit minZoom (0.15)', () => {
		const guides = Array.from({ length: 8 }, (_, i) => ({
			id: `g${i}`,
			label: `Module ${i}`,
			bounds: { minX: i * 400, minY: 0, maxX: i * 400 + 180, maxY: 160 },
			nodeCount: 40 - i,
			nodeIds: [`n${i}`],
		}));
		const represented = new Set(guides.map(g => g.id));
		const atMinZoom = computeTemporalLabelLayout([], guides, 0.15, {
			representedGuideIds: represented,
		});
		assert.ok(atMinZoom.guideLabels.length >= 1, `Fit minZoom must draw community landmarks (got ${atMinZoom.guideLabels.length})`);
		const belowMin = computeTemporalLabelLayout([], guides, 0.149, {
			representedGuideIds: represented,
		});
		assert.equal(belowMin.guideLabels.length, 0, 'below MIN_ZOOM must still suppress landmarks');
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

	test('9. unified ranking: guide (350) beats ordinary; selected (1000) beats guide; zero overlap', () => {
		const guide = {
			id: 'comm1',
			label: 'Services Layer',
			bounds: { minX: 90, minY: 90, maxX: 220, maxY: 220 },
			nodeCount: 5,
		};
		const ordinary = makeNode('n-ordinary', 'src/plain.ts', 'unchanged', 100, 100);
		const ordinaryLayout = computeTemporalLabelLayout([ordinary], [guide], 0.8);
		assert.ok(ordinaryLayout.guideLabels.some(g => g.guideId === 'comm1'), 'guide landmark must place');
		assert.equal(ordinaryLayout.nodeLabels.length, 0, 'ordinary node (rank 100) must yield to guide (rank 350)');
		assert.equal(ordinaryLayout.renderedLabelOverlapCount, 0);

		const selected = makeNode('n-selected', 'src/selected.ts', 'unchanged', 100, 100);
		const selectedLayout = computeTemporalLabelLayout([selected], [guide], 0.8, { selectedNodeId: 'n-selected' });
		assert.ok(selectedLayout.nodeLabels.some(l => l.entityId === 'n-selected'), 'selected (rank 1000) must beat guide (rank 350)');
		assert.equal(selectedLayout.guideLabels.length, 0, 'guide must yield to selected at the same slot');
		assert.equal(selectedLayout.renderedLabelOverlapCount, 0, 'selected vs guide must never visibly overlap');
		assert.ok(selectedLayout.labelCollisionCullCount >= 1);

		const changed = makeNode('n-changed', 'src/changed.ts', 'modified', 100, 100);
		const changedLayout = computeTemporalLabelLayout([changed], [guide], 0.8);
		assert.ok(changedLayout.nodeLabels.some(l => l.entityId === 'n-changed'), 'changed (rank 600) outranks guide (350)');
		assert.equal(changedLayout.guideLabels.length, 0, 'guide yields to changed file at shared occupancy');
		assert.equal(changedLayout.renderedLabelOverlapCount, 0);
	});

	test('9b. global label budget caps guide+node+badge density', () => {
		const guides = Array.from({ length: 20 }, (_, i) => ({
			id: `g${i}`,
			label: `Community ${i}`,
			bounds: { minX: i * 400, minY: 0, maxX: i * 400 + 160, maxY: 140 },
			nodeCount: 40 - i,
		}));
		const nodes = Array.from({ length: 40 }, (_, i) =>
			makeNode(`n${i}`, `src/file${i}.ts`, 'modified', i * 80, 300),
		);
		const badges = Array.from({ length: 20 }, (_, i) => ({
			id: `a${i}::b${i}`,
			text: String(i + 1),
			x: i * 90,
			y: 500,
			edgeCount: 10 + i,
			changedEdgeCount: 0,
		}));
		const layout = computeTemporalLabelLayout(nodes, guides, 0.5, {
			routeBadgeCandidates: badges,
			maxTotalLabels: 12,
			maxGuideLabels: 24,
			maxNodeLabels: 150,
			maxRouteBadges: 32,
		});
		const total = layout.nodeLabels.length + layout.guideLabels.length + layout.routeBadges.length;
		assert.ok(total <= 12, `global budget must cap total labels (got ${total})`);
		assert.ok(layout.labelCollisionCullCount >= 1, 'budget overflow must increment cull counter');
		assert.equal(layout.renderedLabelOverlapCount, 0);
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

	test('11. aggregate guide labels beat ordinary node labels at shared occupancy', () => {
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
		// Ordinary (unchanged) nodes — rank 100 yields to guide rank 350.
		// Changed/selected would outrank guides; that is covered in test 9.
		const nodes = [
			makeNode('n-under-a', 'src/a.ts', 'unchanged', 40, 30),
			makeNode('n-under-b', 'src/b.ts', 'unchanged', 240, 30),
		];
		const layout = computeTemporalLabelLayout(nodes, guides, 0.75);
		assert.equal(layout.guideLabels.length, 2, 'both aggregate guide labels should be placed');
		assert.equal(layout.nodeLabels.length, 0, 'ordinary node labels must yield to aggregate guide occupancy');
		assert.equal(layout.renderedLabelOverlapCount, 0, 'guides and nodes must not visibly overlap');
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
		assert.equal(layout.compositeLabelOverlapCount, layout.labelCollisionCullCount + layout.renderedLabelOverlapCount);
	});

	test('12. labelCollisionCullCount counts each rejected label candidate during layout', () => {
		const nodes = [
			makeNode('n1', 'src/file1.ts', 'modified', 300, 300),
			makeNode('n2', 'src/file2.ts', 'modified', 300, 300),
			makeNode('n3', 'src/file3.ts', 'modified', 300, 300),
		];
		const layout = computeTemporalLabelLayout(nodes, [], 1.0);
		assert.equal(layout.nodeLabels.length, 1, 'only one modified label can occupy the shared slot');
		assert.equal(layout.labelCollisionCullCount, 2, 'each rejected candidate must increment the cull counter');
		assert.equal(layout.renderedLabelOverlapCount, 0, 'rendered set must remain non-overlapping for culled candidates');
	});

	test('13. selected wins occupancy; hovered yields — zero visible overlap', () => {
		const nodes = [
			makeNode('n-selected', 'src/selected.ts', 'unchanged', 100, 100),
			makeNode('n-hovered', 'src/hovered.ts', 'unchanged', 102, 102),
		];
		const layout = computeTemporalLabelLayout(nodes, [], 1.5, {
			selectedNodeId: 'n-selected',
			hoveredNodeId: 'n-hovered',
		});
		assert.equal(layout.nodeLabels.length, 1, 'overlapping selected+hovered must place only the higher-ranked label');
		assert.equal(layout.nodeLabels[0].entityId, 'n-selected');
		assert.equal(layout.renderedLabelOverlapCount, 0, 'visible rendered overlap must remain zero');
		assert.ok(layout.labelCollisionCullCount >= 1, 'lower-ranked hover label must be culled');
		assert.equal(layout.compositeLabelOverlapCount, layout.labelCollisionCullCount + layout.renderedLabelOverlapCount);
	});

	test('14. selected and hovered node labels beat route badge occupancy at the same slot', () => {
		const shared = { x: 120, y: 130 };
		const selectedNode = makeNode('n-selected', 'src/selected.ts', 'unchanged', shared.x, shared.y);
		const hoveredNode = makeNode('n-hovered', 'src/hovered.ts', 'modified', shared.x + 200, shared.y);
		const badgeAtSelected = {
			id: 'sel::peer',
			text: '6',
			x: shared.x,
			y: shared.y + 12,
			edgeCount: 6,
			changedEdgeCount: 0,
		};
		const selectedLayout = computeTemporalLabelLayout([selectedNode], [], 0.8, {
			selectedNodeId: 'n-selected',
			routeBadgeCandidates: [badgeAtSelected],
		});
		assert.equal(selectedLayout.routeBadges.length, 0, 'route badge must yield to selected node label');
		assert.ok(
			selectedLayout.nodeLabels.some(l => l.entityId === 'n-selected'),
			'selected node label must beat route badge occupancy',
		);
		assert.ok(selectedLayout.labelCollisionCullCount >= 1, 'yielding route badge must be recorded as culled');

		const badgeAtHovered = {
			id: 'hov::peer',
			text: '4',
			x: shared.x + 200,
			y: shared.y + 12,
			edgeCount: 4,
			changedEdgeCount: 0,
		};
		const hoveredLayout = computeTemporalLabelLayout([hoveredNode], [], 0.8, {
			hoveredNodeId: 'n-hovered',
			routeBadgeCandidates: [badgeAtHovered],
		});
		assert.equal(hoveredLayout.routeBadges.length, 0, 'route badge must yield to hovered node label');
		assert.ok(hoveredLayout.nodeLabels.some(l => l.entityId === 'n-hovered'), 'hovered node label must beat route badge occupancy');
		assert.ok(hoveredLayout.labelCollisionCullCount >= 1, 'yielding route badge must be recorded as culled');
	});

	test('15. changed node labels outrank entry and unchanged before route badges consume occupancy', () => {
		const nodes = [
			makeNode('n-plain', 'src/plain.ts', 'unchanged', 400, 400),
			makeNode('n-changed', 'src/changed.ts', 'modified', 400, 400),
		];
		const withoutBadge = computeVisibleLabels(nodes, 1.0);
		assert.equal(withoutBadge.length, 1);
		assert.equal(withoutBadge[0].entityId, 'n-changed');

		const entryNode = makeNode('n-entry', 'src/index.ts', 'unchanged', 400, 400, true);
		const withEntry = computeVisibleLabels([...nodes, entryNode], 1.0);
		assert.equal(withEntry.length, 1);
		assert.equal(withEntry[0].entityId, 'n-changed', 'changed outranks entry/plain at the shared slot');
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

	test('16. Search result query match outranks ordinary route badges at the same screen position', () => {
		const shared = { x: 250, y: 250 };
		// Unchanged node that matches the search query "Module_42"
		const searchedNode = makeNode('n-mod42', 'src/core/Module_42.ts', 'unchanged', shared.x, shared.y);
		const badge = {
			id: 'comm-a::comm-b',
			text: '14',
			x: shared.x,
			y: shared.y + 12,
			edgeCount: 14,
			changedEdgeCount: 0,
		};

		const layout = computeTemporalLabelLayout([searchedNode], [], 0.8, {
			filterQuery: 'Module_42',
			routeBadgeCandidates: [badge],
		});

		// Search result must be rendered
		assert.ok(layout.nodeLabels.some(l => l.entityId === 'n-mod42'), 'search query match must have its label rendered');
		// The ordinary route badge must have yielded (culled) because the search result claimed the space
		assert.equal(layout.routeBadges.length, 0, 'ordinary route badge must yield to search result');
		assert.ok(layout.labelCollisionCullCount >= 1, 'route badge must be recorded as culled');
		assert.equal(layout.renderedLabelOverlapCount, 0, 'no visible rendered overlap between search result and route badge');
	});

	test('17. Current editor file explicitly outranks ordinary route badges at the same screen position', () => {
		const shared = { x: 320, y: 180 };
		// Unchanged node representing the user's currently active editor document
		const activeDocNode = makeNode('n-active-doc', 'src/view/editor.ts', 'unchanged', shared.x, shared.y);
		const badge = {
			id: 'comm-x::comm-y',
			text: '8',
			x: shared.x,
			y: shared.y + 12,
			edgeCount: 8,
			changedEdgeCount: 0,
		};

		const layout = computeTemporalLabelLayout([activeDocNode], [], 0.8, {
			currentFileEntityId: 'n-active-doc',
			routeBadgeCandidates: [badge],
		});

		assert.ok(layout.nodeLabels.some(l => l.entityId === 'n-active-doc'), 'current editor file must be rendered');
		assert.equal(layout.routeBadges.length, 0, 'ordinary route badge must yield to current editor file');
		assert.ok(layout.labelCollisionCullCount >= 1, 'route badge must be recorded as culled');
	});

	test('18. Changed files outrank ordinary route badges in Focus Changes / temporal mode', () => {
		const shared = { x: 180, y: 220 };
		const changedNode = makeNode('n-changed-feature', 'src/feature.ts', 'modified', shared.x, shared.y);
		const badge = {
			id: 'comm-1::comm-2',
			text: '5',
			x: shared.x,
			y: shared.y + 12,
			edgeCount: 5,
			changedEdgeCount: 0,
		};

		const layout = computeTemporalLabelLayout([changedNode], [], 0.8, {
			routeBadgeCandidates: [badge],
		});

		assert.ok(layout.nodeLabels.some(l => l.entityId === 'n-changed-feature'), 'changed file must be rendered');
		assert.equal(layout.routeBadges.length, 0, 'ordinary route badge must yield to changed file');
		assert.ok(layout.labelCollisionCullCount >= 1, 'route badge must be recorded as culled');
	});

	test('19. Community landmark labels are clamped within guide bounds', () => {
		const narrowGuide = {
			id: 'comm-edge',
			label: 'Edge Services & External Gateway Controller',
			bounds: { minX: 10, minY: 20, maxX: 100, maxY: 120 },
			nodeCount: 8,
		};
		const labels = computeVisibleCommunityGuideLabels([narrowGuide], 1.0, []);
		assert.equal(labels.length, 1);
		const card = labels[0];
		// Card x must be >= bounds.minX and card x + badgeWidth must be <= bounds.maxX (or clamped at bounds.minX + pad)
		assert.ok(card.x >= narrowGuide.bounds.minX, `card.x (${card.x}) must be >= minX (${narrowGuide.bounds.minX})`);
		assert.ok(card.badgeWidth > 0);
	});

	test('20. Landmark yields when conflicting with higher-priority semantic label (search match or active file)', () => {
		const guide = {
			id: 'comm-conflicting',
			label: 'Database Infrastructure',
			bounds: { minX: 150, minY: 150, maxX: 350, maxY: 350 },
			nodeCount: 15,
		};
		const searchNode = makeNode('n-search-target', 'src/db/connection.ts', 'unchanged', 160, 160);

		// With filterQuery matching the node, the search match (rank 800) outranks the guide landmark (rank 350)
		const layout = computeTemporalLabelLayout([searchNode], [guide], 0.8, {
			filterQuery: 'connection',
		});

		assert.ok(layout.nodeLabels.some(l => l.entityId === 'n-search-target'), 'search match must be rendered');
		assert.equal(layout.guideLabels.length, 0, 'conflicting landmark must yield to search match');
		assert.ok(layout.labelCollisionCullCount >= 1, 'yielding landmark must be culled');
	});

	test('21. Ordinary labels yield to all important content (route badges and landmarks)', () => {
		const shared = { x: 500, y: 500 };
		const ordinaryNode = makeNode('n-plain-bg', 'src/plain.ts', 'unchanged', shared.x, shared.y);
		const badge = {
			id: 'badge::important',
			text: '20',
			x: shared.x,
			y: shared.y + 12,
			edgeCount: 20,
			changedEdgeCount: 0,
		};

		const layout = computeTemporalLabelLayout([ordinaryNode], [], 0.8, {
			routeBadgeCandidates: [badge],
		});

		assert.equal(layout.routeBadges.length, 1, 'route badge must be placed over ordinary background node');
		assert.equal(layout.nodeLabels.length, 0, 'ordinary background node must yield to route badge');
		assert.ok(layout.labelCollisionCullCount >= 1, 'yielding ordinary node must be culled');
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { layoutTemporalGraph, computeSemanticTemporalInitialLayout } from '../../temporal/view/temporalLayoutEngine.js';
import { computeTemporalStructuralDiff } from '../../temporal/view/temporalStructuralDiff.js';
import { projectTemporalVisibleSet } from '../../view/temporal/temporalProjection.js';
import { measureLayoutQuality } from '../../temporal/view/temporalLayoutQuality.js';
import { computeTemporalLabelLayout } from '../../temporal/view/temporalLabelLod.js';
import type { TemporalEntitySnapshot, TemporalEdgeSnapshot } from '../../temporal/common/temporalTypes.js';

suite('TemporalScale97k (Unit & Performance - Canonical ~9.7k Node Scale Acceptance)', () => {
	const COMMUNITY_COUNT = 55;
	const NODES_PER_COMMUNITY = 176; // 55 * 176 = 9,680 nodes (~9.7k)
	const TOTAL_NODES = COMMUNITY_COUNT * NODES_PER_COMMUNITY;

	const LAYERS = ['frontend', 'ui', 'components', 'services', 'backend', 'api', 'database', 'utils', 'config', 'tests'];

	function generate97kFixture(commitSha: string, options?: {
		readonly mutate?: boolean;
	}): {
		entities: TemporalEntitySnapshot[];
		edges: TemporalEdgeSnapshot[];
	} {
		const entities: TemporalEntitySnapshot[] = [];
		const edges: TemporalEdgeSnapshot[] = [];

		let globalIndex = 0;
		for (let c = 0; c < COMMUNITY_COUNT; c++) {
			const commName = `module_${c.toString().padStart(2, '0')}`;

			for (let i = 0; i < NODES_PER_COMMUNITY; i++) {
				const id = `ent-c${c}-n${i}`;
				const isRemoved = options?.mutate && c === 5 && i < 10;
				if (isRemoved) {
					continue;
				}
				const isMutated = options?.mutate && (c === 3 || c === 7) && (i < 8);
				const isRenamed = options?.mutate && c === 4 && i === 1;
				const path = isRenamed
					? `src/${commName}/renamed_file_${i}.ts`
					: `src/${commName}/file_${i}.ts`;
				const canonicalNodeId = isMutated ? `can-${id}-v2` : `can-${id}`;

				entities.push({
					entityId: id,
					commitSha,
					path,
					blobOid: isMutated ? `blob-${id}-v2` : `blob-${id}`,
					nodeData: {
						id: canonicalNodeId,
						kind: 'file',
						label: `file_${i}.ts`,
						path,
						layer: LAYERS[c % LAYERS.length],
					} as any,
				});

				// Intra-community linear dependency
				if (i > 0) {
					const prevId = `ent-c${c}-n${i - 1}`;
					edges.push({
						edgeId: `e-intra-c${c}-${i}`,
						commitSha,
						sourceEntityId: prevId,
						targetEntityId: id,
						kind: 'imports',
						edgeData: {
							id: `e-intra-c${c}-${i}`,
							source: prevId,
							target: id,
							kind: 'imports',
						} as any,
					});
				}

				// Intra-community cross-links
				if (i % 2 === 0 && i >= 2) {
					const targetHop = `ent-c${c}-n${i - 1}`;
					edges.push({
						edgeId: `e-hop2-c${c}-${i}`,
						commitSha,
						sourceEntityId: targetHop,
						targetEntityId: id,
						kind: 'imports',
						edgeData: {
							id: `e-hop2-c${c}-${i}`,
							source: targetHop,
							target: id,
							kind: 'imports',
						} as any,
					});
				}
				if (i % 3 === 0 && i >= 3) {
					const targetHop = `ent-c${c}-n${i - 2}`;
					edges.push({
						edgeId: `e-hop3-c${c}-${i}`,
						commitSha,
						sourceEntityId: targetHop,
						targetEntityId: id,
						kind: 'imports',
						edgeData: {
							id: `e-hop3-c${c}-${i}`,
							source: targetHop,
							target: id,
							kind: 'imports',
						} as any,
					});
				}

				globalIndex++;
			}

			// Inter-community links between neighboring modules
			if (c > 0) {
				const srcId = `ent-c${c - 1}-n0`;
				const tgtId = `ent-c${c}-n0`;
				edges.push({
					edgeId: `e-inter-${c - 1}-${c}`,
					commitSha,
					sourceEntityId: srcId,
					targetEntityId: tgtId,
					kind: 'imports',
					edgeData: {
						id: `e-inter-${c - 1}-${c}`,
						source: srcId,
						target: tgtId,
						kind: 'imports',
					} as any,
				});
			}
		}

		// If mutate requested, add 20 fresh nodes; removals are applied by caller via filter
		if (options?.mutate) {
			for (let a = 0; a < 20; a++) {
				const newId = `ent-new-${a}`;
				entities.push({
					entityId: newId,
					commitSha,
					path: `src/module_00/new_feature_${a}.ts`,
					nodeData: {
						id: `can-${newId}`,
						kind: 'file',
						label: `new_feature_${a}.ts`,
						path: `src/module_00/new_feature_${a}.ts`,
					} as any,
				});
				edges.push({
					edgeId: `e-new-${a}`,
					commitSha,
					sourceEntityId: `ent-c0-n0`,
					targetEntityId: newId,
					kind: 'imports',
					edgeData: {
						id: `e-new-${a}`,
						source: `ent-c0-n0`,
						target: newId,
						kind: 'imports',
					} as any,
				});
			}
		}

		return { entities, edges };
	}

	test('1. 9.7k Initial Layout: Computes initial semantic layout on 9,680 nodes within performance budget', () => {
		const fixture = generate97kFixture('commit-base');
		assert.equal(fixture.entities.length, TOTAL_NODES, 'Must generate exactly 9,680 nodes');
		assert.ok(fixture.edges.length >= 15000, `Must generate >= 15,000 edges (actual: ${fixture.edges.length})`);

		const start = performance.now();
		const diff = computeTemporalStructuralDiff('commit-base', fixture.entities, fixture.edges, undefined, undefined, undefined);
		const initialLayout = computeSemanticTemporalInitialLayout(diff.nodes, diff.edges, 48, { width: 1920, height: 1080 });
		const duration = performance.now() - start;

		assert.equal(initialLayout.nodes.length, TOTAL_NODES);
		assert.equal(initialLayout.positions.size, TOTAL_NODES);
		assert.ok(initialLayout.guides && initialLayout.guides.length >= 40, `Must identify >= 40 communities (actual: ${initialLayout.guides?.length})`);
		assert.ok(duration < 3000, `9.7k initial layout must complete in < 3000ms (actual: ${duration.toFixed(2)}ms)`);

		// Quality report on 9.7k layout
		const quality = measureLayoutQuality(initialLayout, diff, { width: 1920, height: 1080 });
		assert.equal(quality.totalNodes, TOTAL_NODES);
		assert.equal(quality.nodeOverlapCount, 0, 'Initial 9.7k layout must produce ZERO pairwise node collisions');
		assert.ok(quality.screenUtilization > 0, 'Screen utilization must be positive');
	});

	test('2. 9.7k Incremental Commit: Preserves mental map and unchanged stability across adjacent commits', () => {
		const baseFixture = generate97kFixture('commit-1');
		const diff1 = computeTemporalStructuralDiff('commit-1', baseFixture.entities, baseFixture.edges, undefined, undefined, undefined);
		const baseLayout = computeSemanticTemporalInitialLayout(diff1.nodes, diff1.edges, 48);

		// Target commit with modifications, additions, renames, and 10 removals
		const targetFixture = generate97kFixture('commit-2', { mutate: true });
		assert.equal(targetFixture.entities.length, TOTAL_NODES + 20 - 10, 'Mutated fixture must add 20 nodes and remove 10');
		const diff2 = computeTemporalStructuralDiff('commit-2', targetFixture.entities, targetFixture.edges, 'commit-1', baseFixture.entities, baseFixture.edges);

		assert.equal(diff2.summary.modifiedCount, 16, 'communities 3 and 7 must contribute 16 modified nodes');
		assert.equal(diff2.summary.removedCount, 10, 'fixture must remove exactly 10 entities');
		assert.equal(diff2.summary.addedCount, 20, 'fixture must add exactly 20 entities');
		assert.equal(diff2.summary.renamedCount, 1, 'community 4 must contribute one rename');
		assert.ok(diff2.summary.edgeAddedCount >= 20, 'added nodes must introduce new edges');
		assert.ok(diff2.summary.edgeRemovedCount >= 10, 'removed nodes must drop incident edges');

		const modifiedNodes = diff2.nodes.filter(n => n.changeKind === 'modified');
		assert.equal(modifiedNodes.length, 16);
		for (const node of modifiedNodes) {
			const baseEntity = baseFixture.entities.find(e => e.entityId === node.entityId);
			const targetEntity = targetFixture.entities.find(e => e.entityId === node.entityId);
			assert.ok(baseEntity && targetEntity, `modified node ${node.entityId} must exist in both commits`);
			assert.notEqual(targetEntity.blobOid, baseEntity.blobOid, `modified node ${node.entityId} must change blobOid`);
		}

		const start = performance.now();
		const targetLayout = layoutTemporalGraph(diff2, baseLayout.positions);
		const duration = performance.now() - start;

		assert.equal(targetLayout.nodes.filter(n => n.changeKind !== 'removed').length, TOTAL_NODES + 20 - 10, 'Target layout must contain surviving nodes plus additions minus removals');
		assert.equal(targetLayout.nodes.filter(n => n.changeKind === 'removed').length, 10, 'Removed entities must remain visible for mental-map continuity');
		assert.ok(duration < 3000, `9.7k incremental layout must complete in < 3000ms (actual: ${duration.toFixed(2)}ms)`);

		// Measure displacement across surviving unchanged nodes
		const unchangedDisplacements: number[] = [];
		for (const node of targetLayout.nodes) {
			if (node.changeKind === 'unchanged') {
				const prev = baseLayout.positions.get(node.entityId);
				const cur = targetLayout.positions.get(node.entityId);
				if (prev && cur) {
					unchangedDisplacements.push(Math.hypot(cur.x - prev.x, cur.y - prev.y));
				}
			}
		}

		assert.ok(unchangedDisplacements.length >= 9000, 'Must have measured >= 9000 unchanged nodes');
		unchangedDisplacements.sort((a, b) => a - b);
		const median = unchangedDisplacements[Math.floor(unchangedDisplacements.length / 2)];
		const p95 = unchangedDisplacements[Math.floor(unchangedDisplacements.length * 0.95)];

		assert.equal(median, 0, 'Median unchanged displacement must be exactly 0');
		assert.ok(p95 <= 13, `p95 unchanged displacement must be <= 13px (actual: ${p95.toFixed(2)}px)`);
	});

	test('3. 9.7k Multi-Tier Projection: overview/medium/detail tiers project mutated 9.7k graph within duration budget', () => {
		const baseFixture = generate97kFixture('commit-1');
		const targetFixture = generate97kFixture('commit-2', { mutate: true });
		const diff = computeTemporalStructuralDiff('commit-2', targetFixture.entities, targetFixture.edges, 'commit-1', baseFixture.entities, baseFixture.edges);

		const projectionStart = performance.now();
		const layout = computeSemanticTemporalInitialLayout(diff.nodes, diff.edges, 48);

		// Overview zoom (Fit View k = 0.21 on ~9.7k nodes)
		const overviewProj = projectTemporalVisibleSet(layout.nodes, layout.guides ?? [], {
			zoom: 0.21,
			displayMode: 'state',
		});

		assert.equal(overviewProj.tier, 'overview');
		assert.ok(overviewProj.aggregateNodesDrawn >= 40, `Overview must draw >= 40 community aggregates (actual: ${overviewProj.aggregateNodesDrawn})`);
		// Changed nodes pierce, but dense unchanged leaves are culled into aggregates
		assert.ok(overviewProj.leafNodesDrawn <= 50, `Overview must cull dense unchanged leaves (drawn: ${overviewProj.leafNodesDrawn})`);

		// Community Landmark Labels at k = 0.21
		const visibleNodes = overviewProj.items
			.filter((it): it is { kind: 'leaf'; entityId: string; node: any; x: number; y: number } => it.kind === 'leaf')
			.map(it => it.node);
		const labelLayout = computeTemporalLabelLayout(visibleNodes, layout.guides ?? [], 0.21);
		assert.ok(labelLayout.guideLabels.length >= 6, `Must provide >= 6 major landmark labels at overview (actual: ${labelLayout.guideLabels.length})`);
		// Landmark labels must have screen-space readable fonts
		for (const gl of labelLayout.guideLabels) {
			assert.ok(gl.font.includes('px'));
			const fontPx = parseInt(gl.font.match(/(\d+)px/)![1], 10);
			assert.ok(fontPx * 0.21 >= 10, `Screen size must be >= 10px (actual: ${(fontPx * 0.21).toFixed(1)}px)`);
		}

		// Medium zoom (k = 0.60)
		const mediumProj = projectTemporalVisibleSet(layout.nodes, layout.guides ?? [], {
			zoom: 0.60,
			displayMode: 'state',
		});
		assert.equal(mediumProj.tier, 'medium');

		// Detail zoom (k = 1.20)
		const detailProj = projectTemporalVisibleSet(layout.nodes, layout.guides, {
			zoom: 1.20,
			displayMode: 'state',
		});
		assert.equal(detailProj.tier, 'detail');
		assert.equal(detailProj.aggregateNodesDrawn, 0, 'Detail tier must not draw aggregate disc overlays');

		const projectionDuration = performance.now() - projectionStart;
		assert.ok(projectionDuration < 1500, `multi-tier projection must complete in < 1500ms (actual: ${projectionDuration.toFixed(2)}ms)`);
	});
});

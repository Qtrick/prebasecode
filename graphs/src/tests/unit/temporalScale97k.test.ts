/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { layoutTemporalGraph } from '../../temporal/view/temporalLayoutEngine.js';
import { computeTemporalStructuralDiff } from '../../temporal/view/temporalStructuralDiff.js';
import type { TemporalEntitySnapshot, TemporalEdgeSnapshot } from '../../temporal/common/temporalTypes.js';

const TARGET_NODE_COUNT = 9_700;
const INITIAL_LAYOUT_BUDGET_MS = 4_000;
const INCREMENTAL_LAYOUT_BUDGET_MS = 5_000;

suite('TemporalLayoutEngine (Campaign XI/XII — 9.7k scale)', () => {
	function makeEntity(entityId: string, path: string): TemporalEntitySnapshot {
		return {
			entityId,
			commitSha: 'commit-scale',
			path,
			nodeData: {
				id: `can-${entityId}`,
				kind: 'file',
				label: path.split('/').pop() || path,
				path,
			} as TemporalEntitySnapshot['nodeData'],
		};
	}

	function makeEdge(edgeId: string, sourceEntityId: string, targetEntityId: string): TemporalEdgeSnapshot {
		return {
			edgeId,
			commitSha: 'commit-scale',
			sourceEntityId,
			targetEntityId,
			kind: 'imports',
			edgeData: {
				id: edgeId,
				source: sourceEntityId,
				target: targetEntityId,
				kind: 'imports',
			} as TemporalEdgeSnapshot['edgeData'],
			...({ sourcePath: `src/${sourceEntityId}.ts`, targetPath: `src/${targetEntityId}.ts` } as Partial<TemporalEdgeSnapshot>),
		};
	}

	function buildScaleFixture(nodeCount: number): { entities: TemporalEntitySnapshot[]; edges: TemporalEdgeSnapshot[] } {
		const entities: TemporalEntitySnapshot[] = [];
		const edges: TemporalEdgeSnapshot[] = [];
		const communities = 48;
		const perCommunity = Math.ceil(nodeCount / communities);
		for (let i = 0; i < nodeCount; i++) {
			const pkg = i % communities;
			entities.push(makeEntity(`ent-${i}`, `src/pkg_${pkg}/module_${Math.floor(i / communities)}.ts`));
		}
		// Star topology per community (hub -> spokes) avoids deep SCC recursion on a 9.7k chain.
		for (let pkg = 0; pkg < communities; pkg++) {
			const hub = `ent-${pkg}`;
			for (let spoke = 1; spoke < perCommunity; spoke++) {
				const id = pkg + spoke * communities;
				if (id >= nodeCount) {
					break;
				}
				edges.push(makeEdge(`e-${hub}-${id}`, hub, `ent-${id}`));
			}
		}
		return { entities, edges };
	}

	test(`initial layout for ${TARGET_NODE_COUNT} nodes completes within ${INITIAL_LAYOUT_BUDGET_MS}ms with finite coordinates`, () => {
		const { entities, edges } = buildScaleFixture(TARGET_NODE_COUNT);
		const diff = computeTemporalStructuralDiff('commit-root', entities, edges, undefined, undefined, undefined);

		const started = performance.now();
		const layout = layoutTemporalGraph(diff, new Map(), { width: 1600, height: 900, nodeSpacing: 44 });
		const duration = performance.now() - started;

		assert.equal(layout.nodes.length, TARGET_NODE_COUNT, 'layout must cover every entity');
		assert.equal(layout.positions.size, TARGET_NODE_COUNT);
		assert.ok(duration < INITIAL_LAYOUT_BUDGET_MS, `9.7k layout must finish under ${INITIAL_LAYOUT_BUDGET_MS}ms (actual ${duration.toFixed(1)}ms)`);

		let finite = 0;
		for (const pos of layout.positions.values()) {
			if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
				finite++;
			}
		}
		assert.equal(finite, TARGET_NODE_COUNT, 'every node must receive finite coordinates at 9.7k scale');
		assert.ok((layout.guides?.length ?? 0) >= 8, 'large repo must emit multiple community guides');
	});

	test('incremental step on 9.7k baseline preserves mental map for distant unchanged nodes', () => {
		const { entities: baseEntities, edges: baseEdges } = buildScaleFixture(TARGET_NODE_COUNT);
		const baseDiff = computeTemporalStructuralDiff('commit-base', baseEntities, baseEdges, undefined, undefined, undefined);
		const baseline = layoutTemporalGraph(baseDiff, new Map(), { width: 1600, height: 900 });

		const targetEntities = [...baseEntities, makeEntity('ent-new', 'src/pkg_new/feature.ts')];
		const targetEdges = [...baseEdges, makeEdge('e-new', 'ent-0', 'ent-new')];
		const stepDiff = computeTemporalStructuralDiff('commit-next', targetEntities, targetEdges, 'commit-base', baseEntities, baseEdges);

		const started = performance.now();
		const stepped = layoutTemporalGraph(stepDiff, baseline.positions, { width: 1600, height: 900 });
		const duration = performance.now() - started;

		assert.ok(duration < INCREMENTAL_LAYOUT_BUDGET_MS, `incremental 9.7k+1 step must stay under ${INCREMENTAL_LAYOUT_BUDGET_MS}ms (actual ${duration.toFixed(1)}ms)`);

		for (const id of ['ent-5000', 'ent-6000', 'ent-8000']) {
			const before = baseline.positions.get(id);
			const after = stepped.positions.get(id);
			assert.deepEqual(after, before, `${id} must experience zero displacement on localized add`);
		}

		const added = stepped.positions.get('ent-new');
		assert.ok(added && Number.isFinite(added.x) && Number.isFinite(added.y), 'added node must receive a finite position');
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	computeSemanticTemporalInitialLayout,
	layoutTemporalGraph,
} from '../../temporal/view/temporalLayoutEngine.js';
import { measureLayoutQuality } from '../../temporal/view/temporalLayoutQuality.js';
import { computeTemporalStructuralDiff } from '../../temporal/view/temporalStructuralDiff.js';
import type {
	TemporalEntitySnapshot,
	TemporalEdgeSnapshot,
} from '../../temporal/common/temporalTypes.js';
import type {
	TemporalRenderNode,
	TemporalRenderEdge,
	TemporalCommunityGuide,
} from '../../temporal/view/temporalViewTypes.js';

suite('TemporalLayoutQuality (Unit - Mathematical Layout Metrics & Guide Enclosure)', () => {
	function makeEntity(entityId: string, path: string, isEntry = false): TemporalEntitySnapshot {
		return {
			entityId,
			commitSha: 'c-test',
			path,
			nodeData: {
				id: `can-${entityId}`,
				kind: 'file',
				label: path.split('/').pop() || path,
				path,
				meta: { isEntry },
			} as any,
		};
	}

	function makeEdge(edgeId: string, src: string, tgt: string): TemporalEdgeSnapshot {
		return {
			edgeId,
			commitSha: 'c-test',
			sourceEntityId: src,
			targetEntityId: tgt,
			kind: 'imports',
			edgeData: {
				id: edgeId,
				source: src,
				target: tgt,
				kind: 'imports',
			} as any,
			...({ sourcePath: `src/${src}.ts`, targetPath: `src/${tgt}.ts` } as any),
		};
	}

	test('1. Realistic 280-Node Repository Layout: Zero node collisions, high community separation, and bounded coordinates', () => {
		const nodes: TemporalRenderNode[] = [];
		const edges: TemporalRenderEdge[] = [];

		const subsystems = [
			'src/vs/workbench/contrib/chat',
			'src/vs/workbench/services/files',
			'src/vs/workbench/browser/parts/editor',
			'src/vs/platform/configuration',
			'src/vs/platform/workspace',
			'graphs/src/core/analysis',
			'graphs/src/temporal/view',
			'graphs/src/host/workbench',
		];

		let nodeIdx = 0;
		for (let s = 0; s < subsystems.length; s++) {
			const sub = subsystems[s];
			const count = 35; // 8 * 35 = 280 nodes
			const subNodes: string[] = [];
			for (let i = 0; i < count; i++) {
				const id = `node-${nodeIdx++}`;
				subNodes.push(id);
				nodes.push({
					entityId: id,
					canonicalNodeId: `can-${id}`,
					path: `${sub}/file_${i}.ts`,
					label: `file_${i}.ts`,
					kind: 'file',
					x: 0,
					y: 0,
					changeKind: 'unchanged',
					meta: {
						isEntry: i === 0 && s === 0,
					},
				});
			}

			// Add intra-subsystem edges
			for (let i = 1; i < count; i++) {
				edges.push({
					edgeId: `e-intra-${sub}-${i}`,
					sourceEntityId: subNodes[0],
					targetEntityId: subNodes[i],
					sourcePath: `${sub}/file_0.ts`,
					targetPath: `${sub}/file_${i}.ts`,
					kind: 'imports',
					changeKind: 'unchanged',
				});
			}

			// Add inter-subsystem edges
			if (s > 0) {
				edges.push({
					edgeId: `e-inter-${s}`,
					sourceEntityId: `node-0`,
					targetEntityId: subNodes[0],
					sourcePath: `${subsystems[0]}/file_0.ts`,
					targetPath: `${sub}/file_0.ts`,
					kind: 'imports',
					changeKind: 'unchanged',
				});
			}
		}

		const layout = computeSemanticTemporalInitialLayout(nodes, edges, 48);
		const quality = measureLayoutQuality(layout, {
			targetCommitSha: 'sha1',
			nodes,
			edges,
			summary: { addedCount: 0, removedCount: 0, modifiedCount: 0, renamedCount: 0, unchangedCount: 280, edgeAddedCount: 0, edgeRemovedCount: 0, edgeModifiedCount: 0 },
			isPartialLineage: false,
		});

		// 1. Zero node collisions
		assert.equal(quality.nodeOverlapCount, 0, `Layout must have 0 node collisions (observed: ${quality.nodeOverlapCount})`);
		assert.ok(quality.minNodeSpacing >= 30, `Minimum node spacing (${quality.minNodeSpacing}px) must be >= 30px`);

		// 2. High community separation
		assert.ok(quality.communitySeparationRatio >= 1.5, `Community separation ratio (${quality.communitySeparationRatio.toFixed(2)}) must be >= 1.5`);

		// 3. Screen utilization and bounds
		assert.ok(quality.boundingBox.width < 2500, `Width (${quality.boundingBox.width}px) must be < 2500px`);
		assert.ok(quality.boundingBox.height < 2500, `Height (${quality.boundingBox.height}px) must be < 2500px`);

		// 4. Post-collision guide enclosure: 100% of member nodes must be strictly enclosed within guide radius and bounds
		const guides = (layout.guides || []) as readonly TemporalCommunityGuide[];
		assert.ok(guides.length >= 4, 'Must produce distinct community guides');

		for (let g = 0; g < guides.length; g++) {
			const guide = guides[g];
			for (let m = 0; m < guide.nodeIds.length; m++) {
				const pos = layout.positions.get(guide.nodeIds[m]);
				assert.ok(pos, `Member node ${guide.nodeIds[m]} must have a position`);

				const distFromCenter = Math.hypot(pos.x - guide.x, pos.y - guide.y);
				assert.ok(
					distFromCenter <= guide.radius + 0.1,
					`Node ${guide.nodeIds[m]} (dist ${distFromCenter.toFixed(1)}) must be strictly inside guide radius ${guide.radius}`,
				);

				assert.ok(pos.x >= guide.bounds.minX && pos.x <= guide.bounds.maxX, 'Node X must be within guide bounds');
				assert.ok(pos.y >= guide.bounds.minY && pos.y <= guide.bounds.maxY, 'Node Y must be within guide bounds');
			}
		}
	});

	test('2. Guide Persistence Across Multi-Commit Transitions: Guides present on every commit and strictly enclose final positions', () => {
		const entities1: TemporalEntitySnapshot[] = [];
		const edges1: TemporalEdgeSnapshot[] = [];
		for (let i = 0; i < 40; i++) {
			entities1.push(makeEntity(`e-${i}`, `src/pkg_${i % 4}/file_${i}.ts`, i === 0));
			if (i > 0) {
				edges1.push(makeEdge(`edge-${i}`, `e-${(i % 4) * 10}`, `e-${i}`));
			}
		}

		// Initial commit layout
		const diff1 = computeTemporalStructuralDiff('commit-1', entities1, edges1, undefined, undefined, undefined);
		const result1 = layoutTemporalGraph(diff1, new Map());

		assert.ok(result1.guides && result1.guides.length > 0, 'Guides must be present on initial render');
		const initialGuideCount = result1.guides.length;

		// Second commit (incremental: 2 nodes added, 3 modified)
		const entities2 = entities1.map((e, idx) => {
			if (idx === 1 || idx === 2) return makeEntity(e.entityId, e.path + '-v2');
			return e;
		});
		entities2.push(makeEntity('e-new-1', 'src/pkg_0/file_new1.ts'));
		entities2.push(makeEntity('e-new-2', 'src/pkg_1/file_new2.ts'));
		const edges2 = [...edges1, makeEdge('e-new-edge-1', 'e-0', 'e-new-1')];

		const diff2 = computeTemporalStructuralDiff('commit-2', entities2, edges2, 'commit-1', entities1, edges1);
		const result2 = layoutTemporalGraph(diff2, result1.positions);

		// Assert guides PERSIST on incremental step!
		assert.ok(result2.guides, 'Guides MUST persist on incremental layout (no disappearance bug)');
		assert.ok(result2.guides.length >= initialGuideCount, 'Guides count must be preserved across incremental transitions');

		// Assert guide enclosure on incremental step
		for (let g = 0; g < result2.guides.length; g++) {
			const guide = result2.guides[g] as TemporalCommunityGuide;
			for (let m = 0; m < guide.nodeIds.length; m++) {
				const pos = result2.positions.get(guide.nodeIds[m]);
				if (pos) {
					const dist = Math.hypot(pos.x - guide.x, pos.y - guide.y);
					assert.ok(dist <= guide.radius + 0.1, `Incremental node ${guide.nodeIds[m]} must be enclosed in guide`);
				}
			}
		}
	});

	test('3. Permutation Invariance: Shuffled input nodes and edges produce identical layout coordinates', () => {
		const nodes: TemporalRenderNode[] = [];
		const edges: TemporalRenderEdge[] = [];

		for (let i = 0; i < 30; i++) {
			nodes.push({
				entityId: `node-${i}`,
				canonicalNodeId: `can-${i}`,
				path: `src/module_${i % 3}/file_${i}.ts`,
				label: `file_${i}.ts`,
				kind: 'file',
				x: 0,
				y: 0,
				changeKind: 'unchanged',
				meta: { isEntry: i === 0 },
			});
			if (i > 0) {
				edges.push({
					edgeId: `e-${i}`,
					sourceEntityId: `node-${(i % 3) * 10}`,
					targetEntityId: `node-${i}`,
					sourcePath: `src/module_${i % 3}/file_${(i % 3) * 10}.ts`,
					targetPath: `src/module_${i % 3}/file_${i}.ts`,
					kind: 'imports',
					changeKind: 'unchanged',
				});
			}
		}

		const layout1 = computeSemanticTemporalInitialLayout(nodes, edges);

		// Shuffle nodes and edges
		const shuffledNodes = [...nodes].reverse();
		const shuffledEdges = [...edges].reverse();
		const layout2 = computeSemanticTemporalInitialLayout(shuffledNodes, shuffledEdges);

		assert.equal(layout1.positions.size, layout2.positions.size);
		for (const [id, pos1] of layout1.positions) {
			const pos2 = layout2.positions.get(id);
			assert.ok(pos2, `Position for ${id} must exist in layout2`);
			assert.equal(pos1.x, pos2.x, `X coordinate mismatch under permutation for ${id}`);
			assert.equal(pos1.y, pos2.y, `Y coordinate mismatch under permutation for ${id}`);
		}
	});
});

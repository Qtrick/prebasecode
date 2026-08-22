/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { computeTemporalStructuralDiff } from '../../temporal/view/temporalStructuralDiff.js';
import type { TemporalEntitySnapshot, TemporalEdgeSnapshot, TemporalEdgeKind } from '../../temporal/common/temporalTypes.js';

suite('TemporalStructuralDiff (Unit - Phase 3.1)', () => {
	function makeEntity(entityId: string, path: string, canonicalNodeId: string, meta?: any): TemporalEntitySnapshot {
		return {
			entityId,
			commitSha: 'commit-test',
			path,
			nodeData: {
				id: canonicalNodeId,
				kind: 'file',
				label: path.split('/').pop() || path,
				path,
				meta: meta || {},
			} as any,
		};
	}

	function makeEdge(edgeId: string, sourceEntityId: string, targetEntityId: string, sourcePath: string, targetPath: string, kind: TemporalEdgeKind = 'imports'): TemporalEdgeSnapshot {
		return {
			edgeId,
			commitSha: 'commit-test',
			sourceEntityId,
			targetEntityId,
			kind,
			edgeData: {
				id: edgeId,
				source: sourceEntityId,
				target: targetEntityId,
				kind,
			} as any,
			...({ sourcePath, targetPath } as any),
		};
	}

	test('1. Root commit (base undefined): all entities and edges are added', () => {
		const targetEntities = [
			makeEntity('ent-1', 'src/app.ts', 'can-1'),
			makeEntity('ent-2', 'src/utils.ts', 'can-2'),
		];
		const targetEdges = [
			makeEdge('edge-1', 'ent-1', 'ent-2', 'src/app.ts', 'src/utils.ts'),
		];

		const diff = computeTemporalStructuralDiff('commit-root', targetEntities, targetEdges, undefined, undefined, undefined);

		assert.equal(diff.targetCommitSha, 'commit-root');
		assert.equal(diff.baseCommitSha, undefined);
		assert.equal(diff.nodes.length, 2);
		assert.equal(diff.edges.length, 1);
		assert.equal(diff.summary.addedCount, 2);
		assert.equal(diff.summary.removedCount, 0);
		assert.equal(diff.summary.modifiedCount, 0);
		assert.equal(diff.summary.renamedCount, 0);
		assert.equal(diff.summary.unchangedCount, 0);
		assert.equal(diff.summary.edgeAddedCount, 1);
		assert.equal(diff.summary.edgeRemovedCount, 0);
		assert.equal(diff.isPartialLineage, false);

		assert.ok(diff.nodes.every(n => n.changeKind === 'added'));
		assert.ok(diff.edges.every(e => e.changeKind === 'added'));
	});

	test('2. Unchanged commit: all entities and edges preserve unchanged status', () => {
		const baseEntities = [
			makeEntity('ent-1', 'src/app.ts', 'can-1'),
			makeEntity('ent-2', 'src/utils.ts', 'can-2'),
		];
		const baseEdges = [
			makeEdge('edge-1', 'ent-1', 'ent-2', 'src/app.ts', 'src/utils.ts'),
		];
		const targetEntities = [
			makeEntity('ent-1', 'src/app.ts', 'can-1'),
			makeEntity('ent-2', 'src/utils.ts', 'can-2'),
		];
		const targetEdges = [
			makeEdge('edge-1', 'ent-1', 'ent-2', 'src/app.ts', 'src/utils.ts'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, targetEdges, 'commit-1', baseEntities, baseEdges);

		assert.equal(diff.summary.unchangedCount, 2);
		assert.equal(diff.summary.addedCount, 0);
		assert.equal(diff.summary.modifiedCount, 0);
		assert.equal(diff.summary.removedCount, 0);
		assert.equal(diff.summary.renamedCount, 0);
		assert.equal(diff.summary.edgeAddedCount, 0);
		assert.equal(diff.summary.edgeRemovedCount, 0);
		assert.ok(diff.nodes.every(n => n.changeKind === 'unchanged'));
		assert.ok(diff.edges.every(e => e.changeKind === 'unchanged'));
	});

	test('3. File modification in place: same entityId, changed canonicalNodeId -> modified', () => {
		const baseEntities = [
			makeEntity('ent-1', 'src/app.ts', 'can-1-v1'),
		];
		const targetEntities = [
			makeEntity('ent-1', 'src/app.ts', 'can-1-v2'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, [], 'commit-1', baseEntities, []);

		assert.equal(diff.summary.modifiedCount, 1);
		assert.equal(diff.summary.unchangedCount, 0);
		assert.equal(diff.nodes[0].changeKind, 'modified');
		assert.equal(diff.nodes[0].entityId, 'ent-1');
		assert.equal(diff.nodes[0].canonicalNodeId, 'can-1-v2');
	});

	test('4. File rename (exact and with edits): same entityId, changed path -> renamed with oldPath', () => {
		const baseEntities = [
			makeEntity('ent-1', 'src/oldRouter.ts', 'can-1-v1'),
			makeEntity('ent-2', 'src/service.ts', 'can-2-v1'),
		];
		const targetEntities = [
			// Exact rename
			makeEntity('ent-1', 'src/newRouter.ts', 'can-1-v1'),
			// Rename + edit
			makeEntity('ent-2', 'src/core/service.ts', 'can-2-v2'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, [], 'commit-1', baseEntities, []);

		assert.equal(diff.summary.renamedCount, 2);
		assert.equal(diff.summary.addedCount, 0);
		assert.equal(diff.summary.removedCount, 0);

		const n1 = diff.nodes.find(n => n.entityId === 'ent-1');
		assert.ok(n1);
		assert.equal(n1.changeKind, 'renamed');
		assert.equal(n1.path, 'src/newRouter.ts');
		assert.equal(n1.oldPath, 'src/oldRouter.ts');

		const n2 = diff.nodes.find(n => n.entityId === 'ent-2');
		assert.ok(n2);
		assert.equal(n2.changeKind, 'renamed');
		assert.equal(n2.path, 'src/core/service.ts');
		assert.equal(n2.oldPath, 'src/service.ts');
	});

	test('5. File deletion and recreation at same path: old entity removed, new entity added', () => {
		const baseEntities = [
			makeEntity('ent-old', 'src/feature.ts', 'can-old'),
		];
		const targetEntities = [
			makeEntity('ent-new', 'src/feature.ts', 'can-new'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, [], 'commit-1', baseEntities, []);

		assert.equal(diff.summary.addedCount, 1);
		assert.equal(diff.summary.removedCount, 1);

		const removedNode = diff.nodes.find(n => n.entityId === 'ent-old');
		assert.ok(removedNode);
		assert.equal(removedNode.changeKind, 'removed');

		const addedNode = diff.nodes.find(n => n.entityId === 'ent-new');
		assert.ok(addedNode);
		assert.equal(addedNode.changeKind, 'added');
	});

	test('6. Path swapping (A -> B, B -> A): correctly follows entity continuity', () => {
		const baseEntities = [
			makeEntity('ent-A', 'src/a.ts', 'can-A'),
			makeEntity('ent-B', 'src/b.ts', 'can-B'),
		];
		const targetEntities = [
			makeEntity('ent-A', 'src/b.ts', 'can-A'),
			makeEntity('ent-B', 'src/a.ts', 'can-B'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, [], 'commit-1', baseEntities, []);

		assert.equal(diff.summary.renamedCount, 2);
		assert.equal(diff.summary.addedCount, 0);
		assert.equal(diff.summary.removedCount, 0);

		const nodeA = diff.nodes.find(n => n.entityId === 'ent-A');
		assert.equal(nodeA?.path, 'src/b.ts');
		assert.equal(nodeA?.oldPath, 'src/a.ts');

		const nodeB = diff.nodes.find(n => n.entityId === 'ent-B');
		assert.equal(nodeB?.path, 'src/a.ts');
		assert.equal(nodeB?.oldPath, 'src/b.ts');
	});

	test('7. Edge lifecycle: additions and removals across structural snapshot diff', () => {
		const baseEntities = [
			makeEntity('ent-1', 'src/a.ts', 'can-1'),
			makeEntity('ent-2', 'src/b.ts', 'can-2'),
			makeEntity('ent-3', 'src/c.ts', 'can-3'),
		];
		const baseEdges = [
			makeEdge('edge-1-2', 'ent-1', 'ent-2', 'src/a.ts', 'src/b.ts'),
			makeEdge('edge-2-3', 'ent-2', 'ent-3', 'src/b.ts', 'src/c.ts'),
		];

		const targetEntities = [
			makeEntity('ent-1', 'src/a.ts', 'can-1'),
			makeEntity('ent-2', 'src/b.ts', 'can-2'),
			makeEntity('ent-3', 'src/c.ts', 'can-3'),
		];
		const targetEdges = [
			// edge-1-2 kept (unchanged)
			makeEdge('edge-1-2', 'ent-1', 'ent-2', 'src/a.ts', 'src/b.ts'),
			// edge-2-3 deleted (removed)
			// edge-1-3 added
			makeEdge('edge-1-3', 'ent-1', 'ent-3', 'src/a.ts', 'src/c.ts'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, targetEdges, 'commit-1', baseEntities, baseEdges);

		assert.equal(diff.summary.edgeAddedCount, 1);
		assert.equal(diff.summary.edgeRemovedCount, 1);
		assert.equal(diff.edges.length, 3); // 1 unchanged + 1 added + 1 removed

		const addedEdge = diff.edges.find(e => e.sourceEntityId === 'ent-1' && e.targetEntityId === 'ent-3');
		assert.ok(addedEdge);
		assert.equal(addedEdge.changeKind, 'added');

		const removedEdge = diff.edges.find(e => e.sourceEntityId === 'ent-2' && e.targetEntityId === 'ent-3');
		assert.ok(removedEdge);
		assert.equal(removedEdge.changeKind, 'removed');

		const unchangedEdge = diff.edges.find(e => e.sourceEntityId === 'ent-1' && e.targetEntityId === 'ent-2');
		assert.ok(unchangedEdge);
		assert.equal(unchangedEdge.changeKind, 'unchanged');
	});

	test('8. Partial lineage warning annotation', () => {
		const targetEntities = [makeEntity('ent-1', 'src/a.ts', 'can-1')];
		const diff = computeTemporalStructuralDiff('commit-partial', targetEntities, [], undefined, undefined, undefined, {
			isPartialLineage: true,
			partialLineageReason: 'Indexing in progress',
		});

		assert.equal(diff.isPartialLineage, true);
		assert.equal(diff.partialLineageReason, 'Indexing in progress');
	});
});

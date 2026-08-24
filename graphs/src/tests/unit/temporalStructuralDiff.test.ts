/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { computeTemporalStructuralDiff } from '../../temporal/view/temporalStructuralDiff.js';
import type { TemporalEntitySnapshot, TemporalEdgeSnapshot, TemporalEdgeKind } from '../../temporal/common/temporalTypes.js';

suite('TemporalStructuralDiff (Unit - Phase 3.1 & 3.2)', () => {
	function makeEntity(entityId: string, path: string, canonicalNodeId: string, meta?: any, blobOid?: string): TemporalEntitySnapshot {
		return {
			entityId,
			commitSha: 'commit-test',
			path,
			blobOid,
			nodeData: {
				id: canonicalNodeId,
				kind: 'file',
				label: path.split('/').pop() || path,
				path,
				meta: meta || {},
			} as any,
		};
	}

	function makeEdge(edgeId: string, sourceEntityId: string, targetEntityId: string, sourcePath: string, targetPath: string, kind: TemporalEdgeKind = 'imports', metaOrData?: any): TemporalEdgeSnapshot {
		const meta = metaOrData && typeof metaOrData === 'object' && 'meta' in metaOrData ? metaOrData.meta : metaOrData;
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
				meta: meta || {},
			},
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
		assert.equal(diff.summary.edgeModifiedCount, 0);
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
		assert.equal(diff.summary.renamedCount, 0);
		assert.equal(diff.summary.edgeAddedCount, 0);
		assert.equal(diff.summary.edgeRemovedCount, 0);
		assert.equal(diff.summary.edgeModifiedCount, 0);
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
		assert.equal(diff.nodes[0].isModified, true);
		assert.equal(diff.nodes[0].entityId, 'ent-1');
		assert.equal(diff.nodes[0].canonicalNodeId, 'can-1-v2');
	});

	test('4. File rename with modification: detects renamed and sets isRenamedAndModified', () => {
		const baseEntities = [
			makeEntity('ent-1', 'src/oldRouter.ts', 'can-1-v1', {}, 'blob-1'),
			makeEntity('ent-2', 'src/service.ts', 'can-2-v1', {}, 'blob-2'),
		];
		const targetEntities = [
			// Exact rename (same content)
			makeEntity('ent-1', 'src/newRouter.ts', 'can-1-v1', {}, 'blob-1'),
			// Rename + edit (different content)
			makeEntity('ent-2', 'src/core/service.ts', 'can-2-v2', {}, 'blob-3'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, [], 'commit-1', baseEntities, []);

		assert.equal(diff.summary.renamedCount, 2);
		assert.equal(diff.summary.addedCount, 0);
		assert.equal(diff.summary.removedCount, 0);

		const n1 = diff.nodes.find(n => n.entityId === 'ent-1');
		assert.ok(n1);
		assert.equal(n1.changeKind, 'renamed');
		assert.equal(n1.isModified, false);
		assert.equal(n1.meta?.isRenamedAndModified, false);
		assert.equal(n1.path, 'src/newRouter.ts');
		assert.equal(n1.oldPath, 'src/oldRouter.ts');

		const n2 = diff.nodes.find(n => n.entityId === 'ent-2');
		assert.ok(n2);
		assert.equal(n2.changeKind, 'renamed');
		assert.equal(n2.isModified, true);
		assert.equal(n2.meta?.isRenamedAndModified, true);
		assert.equal(n2.path, 'src/core/service.ts');
		assert.equal(n2.oldPath, 'src/service.ts');
	});

	test('5. Cross-anchor entity ID difference at same path: reconciled as modified without false add/remove', () => {
		const baseEntities = [
			makeEntity('ent-old', 'src/feature.ts', 'can-old'),
		];
		const targetEntities = [
			makeEntity('ent-new', 'src/feature.ts', 'can-new'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, [], 'commit-1', baseEntities, []);

		assert.equal(diff.summary.addedCount, 0);
		assert.equal(diff.summary.removedCount, 0);
		assert.equal(diff.summary.modifiedCount, 1);

		const node = diff.nodes.find(n => n.path === 'src/feature.ts');
		assert.ok(node);
		assert.equal(node.changeKind, 'modified');
		assert.equal(node.isModified, true);
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

	test('7. Edge modification detection: metadata change triggers edgeModifiedCount', () => {
		const baseEntities = [
			makeEntity('ent-1', 'src/a.ts', 'can-1'),
			makeEntity('ent-2', 'src/b.ts', 'can-2'),
		];
		const baseEdges = [
			makeEdge('edge-1-2', 'ent-1', 'ent-2', 'src/a.ts', 'src/b.ts', 'imports', { specifiers: ['foo'] }),
		];
		const targetEntities = [
			makeEntity('ent-1', 'src/a.ts', 'can-1'),
			makeEntity('ent-2', 'src/b.ts', 'can-2'),
		];
		const targetEdges = [
			makeEdge('edge-1-2', 'ent-1', 'ent-2', 'src/a.ts', 'src/b.ts', 'imports', { specifiers: ['foo', 'bar'] }),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, targetEdges, 'commit-1', baseEntities, baseEdges);

		assert.equal(diff.summary.edgeModifiedCount, 1);
		assert.equal(diff.summary.edgeAddedCount, 0);
		assert.equal(diff.summary.edgeRemovedCount, 0);
		assert.equal(diff.edges[0].changeKind, 'modified');
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

	test('9. Pure rename: path and canonicalNodeId change, but blobOid/contentIdentity unchanged -> isModified is FALSE', () => {
		const baseEntities = [
			makeEntity('ent-1', 'src/oldPath.ts', 'file:src/oldPath.ts', { exports: ['foo'] }, 'blob-same-sha'),
		];
		const targetEntities = [
			makeEntity('ent-1', 'src/newPath.ts', 'file:src/newPath.ts', { exports: ['foo'] }, 'blob-same-sha'),
		];

		const diff = computeTemporalStructuralDiff('commit-2', targetEntities, [], 'commit-1', baseEntities, []);

		assert.equal(diff.summary.renamedCount, 1);
		assert.equal(diff.summary.modifiedCount, 0);
		assert.equal(diff.nodes[0].changeKind, 'renamed');
		assert.equal(diff.nodes[0].isModified, false);
		assert.equal(diff.nodes[0].meta?.isRenamedAndModified, false);
	});

	test('10. GraphEdge production comparison: specifier order independence and meta fields', () => {
		const baseEntities = [
			makeEntity('ent-1', 'src/a.ts', 'can-1'),
			makeEntity('ent-2', 'src/b.ts', 'can-2'),
		];
		const targetEntities = [
			makeEntity('ent-1', 'src/a.ts', 'can-1'),
			makeEntity('ent-2', 'src/b.ts', 'can-2'),
		];

		// Case A: reordered specifiers ['alpha', 'beta'] vs ['beta', 'alpha'] -> unchanged
		const baseEdgesReorder = [
			makeEdge('edge-1', 'ent-1', 'ent-2', 'src/a.ts', 'src/b.ts', 'imports', {
				meta: { specifiers: ['alpha', 'beta'], isDefault: false, isDynamic: false }
			}),
		];
		const targetEdgesReorder = [
			makeEdge('edge-1', 'ent-1', 'ent-2', 'src/a.ts', 'src/b.ts', 'imports', {
				meta: { specifiers: ['beta', 'alpha'], isDefault: false, isDynamic: false }
			}),
		];

		const diffReorder = computeTemporalStructuralDiff('c2', targetEntities, targetEdgesReorder, 'c1', baseEntities, baseEdgesReorder);
		assert.equal(diffReorder.summary.edgeModifiedCount, 0);
		assert.equal(diffReorder.edges[0].changeKind, 'unchanged');

		// Case B: added specifier ['alpha'] -> ['alpha', 'gamma'] -> modified
		const targetEdgesModified = [
			makeEdge('edge-1', 'ent-1', 'ent-2', 'src/a.ts', 'src/b.ts', 'imports', {
				meta: { specifiers: ['alpha', 'gamma'], isDefault: false, isDynamic: false }
			}),
		];

		const diffModified = computeTemporalStructuralDiff('c2', targetEntities, targetEdgesModified, 'c1', baseEntities, baseEdgesReorder);
		assert.equal(diffModified.summary.edgeModifiedCount, 1);
		assert.equal(diffModified.edges[0].changeKind, 'modified');

		// Case C: isDynamic flag changed from false to true -> modified
		const targetEdgesDynamic = [
			makeEdge('edge-1', 'ent-1', 'ent-2', 'src/a.ts', 'src/b.ts', 'imports', {
				meta: { specifiers: ['alpha', 'beta'], isDefault: false, isDynamic: true }
			}),
		];

		const diffDynamic = computeTemporalStructuralDiff('c2', targetEntities, targetEdgesDynamic, 'c1', baseEntities, baseEdgesReorder);
		assert.equal(diffDynamic.summary.edgeModifiedCount, 1);
		assert.equal(diffDynamic.edges[0].changeKind, 'modified');
	});
});

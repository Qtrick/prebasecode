/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import type { CanonicalGraphSnapshot } from '../../common/types/canonicalTypes.js';
import type { GraphNode, GraphEdge } from '../../common/types/graphTypes.js';
import { computeCanonicalGraphDiff } from '../../core/canonical/canonicalGraphDiff.js';
import { computeCanonicalGraphDigest } from '../../core/canonical/canonicalGraphDigest.js';
import { createCurrentVersionMetadata } from '../../core/canonical/versioning.js';

function buildTestSnapshot(nodes: GraphNode[], edges: GraphEdge[]): CanonicalGraphSnapshot {
	const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
	const sortedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));
	const digest = computeCanonicalGraphDigest({ nodes: sortedNodes, edges: sortedEdges, entryNodeId: sortedNodes[0]?.id ?? null });

	return {
		nodes: sortedNodes,
		edges: sortedEdges,
		projectPath: '/test-repo',
		projectName: 'test-repo',
		entryNodeId: sortedNodes[0]?.id ?? null,
		analyzedAt: 1700000000000,
		sourceIdentity: 'test',
		digest,
		versions: createCurrentVersionMetadata(),
		completeness: {
			isComplete: true,
			analyzedFileCount: sortedNodes.length,
			excludedFileCount: 0,
			exclusionReasons: {},
		}
	};
}

suite('CanonicalGraphDiff Unit Tests', () => {
	test('returns zero structural change when graphs are identical', () => {
		const nodes: GraphNode[] = [
			{ id: 'file:src/a.ts', kind: 'file', label: 'a.ts', path: 'src/a.ts' },
			{ id: 'file:src/b.ts', kind: 'file', label: 'b.ts', path: 'src/b.ts' },
		];
		const edges: GraphEdge[] = [
			{ id: 'import:file:src/a.ts->file:src/b.ts:./b', source: 'file:src/a.ts', target: 'file:src/b.ts', kind: 'import' }
		];

		const snapA = buildTestSnapshot(nodes, edges);
		const snapB = buildTestSnapshot(nodes, edges);

		const diff = computeCanonicalGraphDiff(snapA, snapB);
		assert.strictEqual(diff.isIdentical, true);
		assert.strictEqual(diff.addedNodes.length, 0);
		assert.strictEqual(diff.removedNodeIds.length, 0);
		assert.strictEqual(diff.updatedNodes.length, 0);
		assert.strictEqual(diff.addedEdges.length, 0);
		assert.strictEqual(diff.removedEdgeIds.length, 0);
		assert.strictEqual(diff.updatedEdges.length, 0);
		assert.strictEqual(diff.oldDigest, diff.newDigest);
	});

	test('detects added and removed nodes and edges accurately', () => {
		const snapA = buildTestSnapshot([
			{ id: 'file:src/a.ts', kind: 'file', label: 'a.ts', path: 'src/a.ts' },
			{ id: 'file:src/b.ts', kind: 'file', label: 'b.ts', path: 'src/b.ts' },
		], [
			{ id: 'import:file:src/a.ts->file:src/b.ts:./b', source: 'file:src/a.ts', target: 'file:src/b.ts', kind: 'import' }
		]);

		const snapB = buildTestSnapshot([
			{ id: 'file:src/a.ts', kind: 'file', label: 'a.ts', path: 'src/a.ts' },
			{ id: 'file:src/c.ts', kind: 'file', label: 'c.ts', path: 'src/c.ts' },
		], [
			{ id: 'import:file:src/a.ts->file:src/c.ts:./c', source: 'file:src/a.ts', target: 'file:src/c.ts', kind: 'import' }
		]);

		const diff = computeCanonicalGraphDiff(snapA, snapB);
		assert.strictEqual(diff.isIdentical, false);

		assert.strictEqual(diff.removedNodeIds.length, 1);
		assert.strictEqual(diff.removedNodeIds[0], 'file:src/b.ts');

		assert.strictEqual(diff.addedNodes.length, 1);
		assert.strictEqual(diff.addedNodes[0].id, 'file:src/c.ts');

		assert.strictEqual(diff.removedEdgeIds.length, 1);
		assert.strictEqual(diff.removedEdgeIds[0], 'import:file:src/a.ts->file:src/b.ts:./b');

		assert.strictEqual(diff.addedEdges.length, 1);
		assert.strictEqual(diff.addedEdges[0].id, 'import:file:src/a.ts->file:src/c.ts:./c');
	});

	test('detects updated node metadata and updated edge metadata without recreating nodes/edges', () => {
		const snapA = buildTestSnapshot([
			{
				id: 'file:src/a.ts',
				kind: 'file',
				label: 'a.ts',
				path: 'src/a.ts',
				meta: { architectureLayer: 'utils', imports: ['./b'], exports: ['fnA'] }
			},
		], [
			{
				id: 'import:file:src/a.ts->file:src/b.ts:./b',
				source: 'file:src/a.ts',
				target: 'file:src/b.ts',
				kind: 'import',
				meta: { importSource: './b', specifiers: ['oldHelper'] }
			}
		]);

		const snapB = buildTestSnapshot([
			{
				id: 'file:src/a.ts',
				kind: 'file',
				label: 'a.ts',
				path: 'src/a.ts',
				meta: { architectureLayer: 'services', imports: ['./b'], exports: ['fnA', 'fnA2'] }
			},
		], [
			{
				id: 'import:file:src/a.ts->file:src/b.ts:./b',
				source: 'file:src/a.ts',
				target: 'file:src/b.ts',
				kind: 'import',
				meta: { importSource: './b', specifiers: ['newHelper'] }
			}
		]);

		const diff = computeCanonicalGraphDiff(snapA, snapB);
		assert.strictEqual(diff.isIdentical, false);
		assert.strictEqual(diff.addedNodes.length, 0);
		assert.strictEqual(diff.removedNodeIds.length, 0);
		assert.strictEqual(diff.updatedNodes.length, 1);
		assert.strictEqual(diff.updatedNodes[0].meta?.architectureLayer, 'services');

		assert.strictEqual(diff.addedEdges.length, 0);
		assert.strictEqual(diff.removedEdgeIds.length, 0);
		assert.strictEqual(diff.updatedEdges.length, 1);
		assert.deepStrictEqual(diff.updatedEdges[0].meta?.specifiers, ['newHelper']);
	});
});

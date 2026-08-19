/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { computeCanonicalGraphDiff } from '../../core/canonical/canonicalGraphDiff.js';
import { createCurrentVersionMetadata } from '../../core/canonical/versioning.js';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';

suite('CanonicalGraphDiff Unit Tests', () => {
	test('computes added, removed, and updated nodes and edges accurately', () => {
		const oldNodes: GraphNode[] = [
			{ id: 'file:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts', meta: { exports: ['a'] } },
			{ id: 'file:src/removed.ts', kind: 'file', label: 'removed.ts', path: 'src/removed.ts' },
		];
		const oldEdges: GraphEdge[] = [
			{ id: 'e1', source: 'file:src/index.ts', target: 'file:src/removed.ts', kind: 'import' },
		];

		const newNodes: GraphNode[] = [
			{ id: 'file:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts', meta: { exports: ['a', 'b'] } }, // updated exports
			{ id: 'file:src/added.ts', kind: 'file', label: 'added.ts', path: 'src/added.ts' }, // added
		];
		const newEdges: GraphEdge[] = [
			{ id: 'e2', source: 'file:src/index.ts', target: 'file:src/added.ts', kind: 'import' },
		];

		const versions = createCurrentVersionMetadata();
		const diff = computeCanonicalGraphDiff(
			{ nodes: oldNodes, edges: oldEdges, digest: 'digest1', versions },
			{ nodes: newNodes, edges: newEdges, digest: 'digest2', versions }
		);

		assert.strictEqual(diff.kind, 'diff');
		assert.strictEqual(diff.isIdentical, false);
		assert.strictEqual(diff.isIncompatible, false);
		assert.strictEqual(diff.addedNodes.length, 1);
		assert.strictEqual(diff.addedNodes[0].id, 'file:src/added.ts');
		assert.strictEqual(diff.removedNodeIds.length, 1);
		assert.strictEqual(diff.removedNodeIds[0], 'file:src/removed.ts');
		assert.strictEqual(diff.updatedNodes.length, 1);
		assert.strictEqual(diff.updatedNodes[0].id, 'file:src/index.ts');

		assert.strictEqual(diff.addedEdges.length, 1);
		assert.strictEqual(diff.addedEdges[0].id, 'e2');
		assert.strictEqual(diff.removedEdgeIds.length, 1);
		assert.strictEqual(diff.removedEdgeIds[0], 'e1');
	});

	test('returns identical for snapshots with identical structural properties', () => {
		const nodes: GraphNode[] = [
			{ id: 'file:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' },
		];
		const edges: GraphEdge[] = [];

		const versions = createCurrentVersionMetadata();
		const diff = computeCanonicalGraphDiff(
			{ nodes, edges, digest: 'digest_same', versions },
			{ nodes, edges, digest: 'digest_same', versions }
		);

		assert.strictEqual(diff.kind, 'identical');
		assert.strictEqual(diff.isIdentical, true);
		assert.strictEqual(diff.isIncompatible, false);
		assert.strictEqual(diff.addedNodes.length, 0);
		assert.strictEqual(diff.removedNodeIds.length, 0);
	});

	test('handles incompatible schema versions gracefully with isIncompatible flag', () => {
		const nodes: GraphNode[] = [
			{ id: 'file:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' },
		];
		const edges: GraphEdge[] = [];

		const diff = computeCanonicalGraphDiff(
			{ nodes, edges, digest: 'd1', versions: { graphSchemaVersion: 1, analyzerVersion: 1, identityVersion: 1, layoutVersion: 1, analysisProfileVersion: 1 } },
			{ nodes, edges, digest: 'd2', versions: { graphSchemaVersion: 999, analyzerVersion: 1, identityVersion: 1, layoutVersion: 1, analysisProfileVersion: 1 } }
		);

		assert.strictEqual(diff.kind, 'incompatible');
		assert.strictEqual(diff.isIdentical, false);
		assert.strictEqual(diff.isIncompatible, true);
		assert.ok(diff.incompatibilityReason);
	});

	test('fails closed when version metadata is missing', () => {
		const nodes: GraphNode[] = [
			{ id: 'file:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' },
		];
		const edges: GraphEdge[] = [];

		const diff = computeCanonicalGraphDiff(
			{ nodes, edges, digest: 'd1' },
			{ nodes, edges, digest: 'd2' }
		);

		assert.strictEqual(diff.kind, 'incompatible');
		assert.strictEqual(diff.isIdentical, false);
		assert.strictEqual(diff.isIncompatible, true);
	});
});

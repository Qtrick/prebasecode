/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { projectNetworkGraph, pickLayoutEdges, pickLayoutNodes, computeImportanceByNode } from '../../core/projection/graphProjection.js';
import type { CanonicalGraphSnapshot } from '../../common/types/canonicalTypes.js';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';
import { createCurrentVersionMetadata } from '../../core/canonical/versioning.js';

suite('CanonicalProjection Unit Tests', () => {
	test('projects canonical snapshot to 2D and 3D network coordinates respecting budget', () => {
		const nodes: GraphNode[] = [
			{ id: 'file:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts', isEntry: true },
			{ id: 'file:src/a.ts', kind: 'file', label: 'a.ts', path: 'src/a.ts' },
			{ id: 'file:src/b.ts', kind: 'file', label: 'b.ts', path: 'src/b.ts' },
		];
		const edges: GraphEdge[] = [
			{ id: 'e1', source: 'file:src/index.ts', target: 'file:src/a.ts', kind: 'import' },
			{ id: 'e2', source: 'file:src/a.ts', target: 'file:src/b.ts', kind: 'import' },
		];

		const canonical: CanonicalGraphSnapshot = {
			nodes,
			edges,
			projectPath: '/workspace',
			projectName: 'test',
			entryNodeId: 'file:src/index.ts',
			analyzedAt: 12345,
			sourceIdentity: 'test',
			digest: 'digest1',
			versions: createCurrentVersionMetadata(),
			coverage: {
				completeWithinProfile: true,
				isComplete: true,
				discoveredCount: 3,
				analyzedCount: 3,
				analyzedFileCount: 3,
				excludedCount: 0,
				excludedFileCount: 0,
				failedCount: 0,
				truncated: false,
				exclusionBreakdown: {
					'oversized-file': 0,
					'binary-file': 0,
					'unsupported-language': 0,
					'parse-error': 0,
					'permission-denied': 0,
					'ignored-pattern': 0,
					'policy-excluded': 0,
					'other': 0,
				},
				exclusionReasons: {},
			},
			completeness: {
				completeWithinProfile: true,
				isComplete: true,
				discoveredCount: 3,
				analyzedCount: 3,
				analyzedFileCount: 3,
				excludedCount: 0,
				excludedFileCount: 0,
				failedCount: 0,
				truncated: false,
				exclusionBreakdown: {
					'oversized-file': 0,
					'binary-file': 0,
					'unsupported-language': 0,
					'parse-error': 0,
					'permission-denied': 0,
					'ignored-pattern': 0,
					'policy-excluded': 0,
					'other': 0,
				},
				exclusionReasons: {},
			},
		};

		const projection = projectNetworkGraph(canonical, {
			maxRenderedNodes: 280,
			maxRenderedEdges: 420,
		});

		assert.strictEqual(projection.nodes.length, 3);
		assert.strictEqual(projection.edges.length, 2);
		assert.ok(projection.positions['file:src/index.ts']);
		assert.ok(projection.positions3d?.['file:src/index.ts']);
	});

	test('prioritizes entry node and high degree nodes when capping large graph', () => {
		const nodes: GraphNode[] = [];
		const edges: GraphEdge[] = [];

		nodes.push({ id: 'file:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts', isEntry: true });
		for (let i = 1; i <= 350; i++) {
			nodes.push({ id: `file:src/node${i}.ts`, kind: 'file', label: `node${i}.ts`, path: `src/node${i}.ts` });
			if (i <= 10) {
				// Highly connected backbone nodes
				edges.push({ id: `e_entry_${i}`, source: 'file:src/index.ts', target: `file:src/node${i}.ts`, kind: 'import' });
			}
		}

		const importance = computeImportanceByNode(edges);
		const picked = pickLayoutNodes(nodes, 'file:src/index.ts', 280, importance);

		assert.strictEqual(picked.length, 280);
		// Entry node MUST be included
		assert.ok(picked.some(n => n.id === 'file:src/index.ts'));
		// Highly connected nodes MUST be included
		for (let i = 1; i <= 10; i++) {
			assert.ok(picked.some(n => n.id === `file:src/node${i}.ts`));
		}
	});

	test('prioritizes entry-connected edges and high-importance connections over arbitrary slicing', () => {
		const edges: GraphEdge[] = [
			{ id: 'edge_leaf_1', source: 'file:leafA.ts', target: 'file:leafB.ts', kind: 'import' },
			{ id: 'edge_entry_conn', source: 'file:src/index.ts', target: 'file:core.ts', kind: 'import' },
			{ id: 'edge_leaf_2', source: 'file:leafC.ts', target: 'file:leafD.ts', kind: 'import' },
		];

		const importance = computeImportanceByNode(edges);
		const pickedEdges = pickLayoutEdges(edges, 'file:src/index.ts', 1, importance);

		assert.strictEqual(pickedEdges.length, 1);
		assert.strictEqual(pickedEdges[0].id, 'edge_entry_conn');
	});
});

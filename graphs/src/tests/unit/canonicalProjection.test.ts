/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import type { CanonicalGraphSnapshot } from '../../common/types/canonicalTypes.js';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';
import { projectNetworkGraph } from '../../core/projection/graphProjection.js';
import { createCurrentVersionMetadata } from '../../core/canonical/versioning.js';

function createMockCanonicalSnapshot(nodeCount: number, edgeCount: number): CanonicalGraphSnapshot {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];

	for (let i = 0; i < nodeCount; i++) {
		nodes.push({
			id: `file:src/file${i}.ts`,
			kind: i === 0 ? 'component' : 'file',
			label: `file${i}.ts`,
			path: `src/file${i}.ts`,
			isEntry: i === 0,
			meta: {
				language: 'typescript',
				architectureLayer: i === 0 ? 'entry' : (i % 2 === 0 ? 'services' : 'utils'),
				imports: [],
				exports: [`f${i}`],
			}
		});
	}

	for (let i = 0; i < edgeCount; i++) {
		const sourceIdx = i % nodeCount;
		const targetIdx = (i * 3 + 1) % nodeCount;
		if (sourceIdx !== targetIdx) {
			edges.push({
				id: `import:file:src/file${sourceIdx}.ts->file:src/file${targetIdx}.ts:./file${targetIdx}`,
				source: `file:src/file${sourceIdx}.ts`,
				target: `file:src/file${targetIdx}.ts`,
				kind: 'import',
				meta: {
					importSource: `./file${targetIdx}`,
					specifiers: [`f${targetIdx}`],
				}
			});
		}
	}

	return {
		nodes,
		edges,
		projectPath: '/test-repo',
		projectName: 'test-repo',
		entryNodeId: 'file:src/file0.ts',
		analyzedAt: 1700000000000,
		sourceIdentity: 'test-source:/test-repo',
		digest: 'mock-digest-1234567890',
		versions: createCurrentVersionMetadata(),
		completeness: {
			isComplete: true,
			analyzedFileCount: nodeCount,
			excludedFileCount: 0,
			exclusionReasons: {},
		}
	};
}

suite('CanonicalProjection Unit Tests', () => {
	test('projects large canonical graph (1,000 nodes) down to configured render limits', () => {
		const canonical = createMockCanonicalSnapshot(1000, 1500);

		const projection = projectNetworkGraph(canonical, {
			maxRenderedNodes: 280,
			maxRenderedEdges: 420,
			networkLayoutMode: 'organic',
		});

		assert.strictEqual(projection.nodes.length, 280);
		assert.strictEqual(projection.edges.length <= 420, true);

		// Entry node must always be preserved
		const hasEntry = projection.nodes.some(n => n.id === 'file:src/file0.ts');
		assert.strictEqual(hasEntry, true);

		// Every projected node must exist in canonical snapshot
		const canonicalIds = new Set(canonical.nodes.map(n => n.id));
		for (const node of projection.nodes) {
			assert.strictEqual(canonicalIds.has(node.id), true);
		}

		// Every edge in projection must connect nodes within projection
		const projectedIds = new Set(projection.nodes.map(n => n.id));
		for (const edge of projection.edges) {
			assert.strictEqual(projectedIds.has(edge.source), true);
			assert.strictEqual(projectedIds.has(edge.target), true);
		}

		// Coordinates generated
		assert.strictEqual(Object.keys(projection.positions).length, 280);
		assert.strictEqual(Object.keys(projection.positions3d || {}).length, 280);
	});

	test('projection is deterministic across repeated executions', () => {
		const canonical = createMockCanonicalSnapshot(500, 800);

		const p1 = projectNetworkGraph(canonical, { maxRenderedNodes: 150, networkLayoutMode: 'sphere' });
		const p2 = projectNetworkGraph(canonical, { maxRenderedNodes: 150, networkLayoutMode: 'sphere' });

		assert.deepStrictEqual(
			p1.nodes.map(n => n.id),
			p2.nodes.map(n => n.id)
		);
		assert.deepStrictEqual(
			p1.edges.map(e => e.id),
			p2.edges.map(e => e.id)
		);
	});

	test('preserves small canonical graph completely when below render limits', () => {
		const canonical = createMockCanonicalSnapshot(25, 40);

		const projection = projectNetworkGraph(canonical, {
			maxRenderedNodes: 280,
			maxRenderedEdges: 420,
			networkLayoutMode: 'radial',
		});

		assert.strictEqual(projection.nodes.length, 25);
		assert.strictEqual(projection.edges.length, canonical.edges.length);
	});
});

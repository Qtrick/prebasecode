/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { CanonicalQueryIndex } from '../../core/query/canonicalQueryIndex.js';
import type { CanonicalGraphSnapshot } from '../../common/types/canonicalTypes.js';
import { createCurrentVersionMetadata } from '../../core/canonical/versioning.js';
import { projectNetworkGraph } from '../../core/projection/graphProjection.js';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';

suite('CanonicalQueryIndex Unit Tests', () => {
	const snapshot: CanonicalGraphSnapshot = {
		nodes: [
			{ id: 'file:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts', isEntry: true, meta: { architectureLayer: 'entry', language: 'typescript' } },
			{ id: 'file:src/components/App.tsx', kind: 'component', label: 'App.tsx', path: 'src/components/App.tsx', meta: { architectureLayer: 'components', language: 'typescriptreact' } },
			{ id: 'file:src/services/api.ts', kind: 'file', label: 'api.ts', path: 'src/services/api.ts', meta: { architectureLayer: 'services', language: 'typescript' } },
			{ id: 'file:src/utils/math.ts', kind: 'file', label: 'math.ts', path: 'src/utils/math.ts', meta: { architectureLayer: 'utils', language: 'typescript' } },
		],
		edges: [
			{ id: 'e1', source: 'file:src/index.ts', target: 'file:src/components/App.tsx', kind: 'import' },
			{ id: 'e2', source: 'file:src/components/App.tsx', target: 'file:src/services/api.ts', kind: 'import' },
			{ id: 'e3', source: 'file:src/services/api.ts', target: 'file:src/utils/math.ts', kind: 'import' },
		],
		projectPath: '/workspace',
		projectName: 'test-app',
		entryNodeId: 'file:src/index.ts',
		analyzedAt: 12345678,
		sourceIdentity: 'test',
		digest: 'abc123sha256',
		versions: createCurrentVersionMetadata(),
		coverage: {
			completeWithinProfile: true,
			isComplete: true,
			discoveredCount: 4,
			analyzedCount: 4,
			analyzedFileCount: 4,
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
			discoveredCount: 4,
			analyzedCount: 4,
			analyzedFileCount: 4,
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

	test('indexes nodes by ID and by relative and file: paths', () => {
		const index = new CanonicalQueryIndex(snapshot);

		assert.strictEqual(index.findNode('file:src/index.ts')?.label, 'index.ts');
		assert.strictEqual(index.findNode('src/index.ts')?.label, 'index.ts');
		assert.strictEqual(index.findNode('src/components/App.tsx')?.kind, 'component');
		assert.strictEqual(index.findNode('nonexistent'), undefined);
	});

	test('indexes incoming and outgoing edges for instant traversal', () => {
		const index = new CanonicalQueryIndex(snapshot);

		const appIncoming = index.incomingEdges.get('file:src/components/App.tsx');
		const appOutgoing = index.outgoingEdges.get('file:src/components/App.tsx');

		assert.strictEqual(appIncoming?.length, 1);
		assert.strictEqual(appIncoming?.[0].source, 'file:src/index.ts');
		assert.strictEqual(appOutgoing?.length, 1);
		assert.strictEqual(appOutgoing?.[0].target, 'file:src/services/api.ts');

		assert.strictEqual(index.nodeDegree.get('file:src/components/App.tsx'), 2);
	});

	test('indexes nodes by architecture layer and collects unique languages', () => {
		const index = new CanonicalQueryIndex(snapshot);

		const components = index.nodesByLayer.get('components');
		assert.strictEqual(components?.length, 1);
		assert.strictEqual(components?.[0].label, 'App.tsx');

		assert.deepStrictEqual(index.languages, ['typescript', 'typescriptreact']);
	});

	test('allows Magnus to discover canonical nodes omitted from the 280-node render projection', () => {
		// Generate 350 nodes
		const largeNodes: GraphNode[] = [];
		const largeEdges: GraphEdge[] = [];

		largeNodes.push({
			id: 'file:src/entry.ts',
			label: 'entry.ts',
			path: 'src/entry.ts',
			kind: 'file',
			isEntry: true,
			meta: { architectureLayer: 'entry', language: 'typescript', importance: 1.0 }
		});

		for (let i = 1; i <= 349; i++) {
			const id = `file:src/module_${i}.ts`;
			const isHiddenLeaf = i > 300; // Nodes 301-349 will be low importance leaves
			largeNodes.push({
				id,
				label: `module_${i}.ts`,
				path: `src/module_${i}.ts`,
				kind: isHiddenLeaf ? 'file' : 'component',
				meta: {
					importance: isHiddenLeaf ? 0.05 : 0.8,
					architectureLayer: isHiddenLeaf ? 'utils' : 'components',
					language: 'typescript',
				}
			});
			if (i <= 290) {
				largeEdges.push({
					id: `e_${i}`,
					source: 'file:src/entry.ts',
					target: id,
					kind: 'import',
				});
			}
		}

		const largeSnapshot: CanonicalGraphSnapshot = {
			...snapshot,
			nodes: largeNodes,
			edges: largeEdges,
			entryNodeId: 'file:src/entry.ts',
		};

		// Project to visual Network graph (capped at 280 nodes)
		const projection = projectNetworkGraph(largeSnapshot, {
			maxRenderedNodes: 280,
			maxRenderedEdges: 420,
		});

		assert.strictEqual(projection.nodes.length, 280, 'Visual projection must be capped at 280 nodes');
		assert.ok(largeSnapshot.nodes.length === 350, 'Canonical snapshot retains all 350 nodes');

		// Verify that node 340 is omitted from visual projection
		const renderedTarget = projection.nodes.find(n => n.id === 'file:src/module_340.ts');
		assert.strictEqual(renderedTarget, undefined, 'Low importance node 340 should be omitted from 280-node render projection');

		// Query index backed by canonical snapshot MUST find the omitted node for Magnus
		const index = new CanonicalQueryIndex(largeSnapshot);
		const canonicalTarget = index.findNode('src/module_340.ts');
		assert.ok(canonicalTarget, 'Canonical query index must find the non-rendered node');
		assert.strictEqual(canonicalTarget?.label, 'module_340.ts');

		// Search for Magnus also finds it
		const searchResults = index.searchNodes('module_340', 10);
		assert.strictEqual(searchResults.length, 1);
		assert.strictEqual(searchResults[0].node.id, 'file:src/module_340.ts');
	});
});

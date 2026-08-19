/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { CanonicalQueryIndex } from '../../core/query/canonicalQueryIndex.js';
import type { CanonicalGraphSnapshot } from '../../common/types/canonicalTypes.js';
import { createCurrentVersionMetadata } from '../../core/canonical/versioning.js';

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
});

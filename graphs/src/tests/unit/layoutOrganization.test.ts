/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';
import { computeOrganizationLayers } from '../../layouts/shared/layoutOrganization.js';

suite('PreBase layoutOrganization', () => {
	function node(id: string, path: string, kind: GraphNode['kind'] = 'file'): GraphNode {
		return { id, kind, label: id, path };
	}

	function importEdge(source: string, target: string): GraphEdge {
		return { id: `import:${source}->${target}`, source, target, kind: 'import' };
	}

	test('ranks inbound imports above equivalent outbound imports and ignores non-import edges', () => {
		const nodes = [
			node('entry', 'src/main.ts'),
			node('inbound', 'src/inbound.ts'),
			node('outbound', 'src/outbound.ts'),
			node('isolated', 'src/isolated.ts'),
			...Array.from({ length: 6 }, (_, index) => node(`blank-${index}`, `src/blank-${index}.ts`)),
			node('folder', 'src', 'folder'),
		];
		const edges: GraphEdge[] = [
			...Array.from({ length: 5 }, (_, index) => importEdge(`source-${index}`, 'inbound')),
			...Array.from({ length: 5 }, (_, index) => importEdge('outbound', `missing-${index}`)),
			{ id: 'dependency:isolated->inbound', source: 'isolated', target: 'inbound', kind: 'dependency' },
			{ id: 'contains:folder->inbound', source: 'folder', target: 'inbound', kind: 'contains' },
		];

		const result = computeOrganizationLayers(nodes, edges, 'entry', 'import-importance');

		assert.strictEqual(result.ranks.get('entry'), 0);
		assert.ok(result.ranks.get('inbound')! < result.ranks.get('outbound')!);
		assert.ok(result.ranks.get('outbound')! < result.ranks.get('isolated')!);
		assert.strictEqual(result.ranks.has('folder'), false);
	});

	test('groups directory depth relative to the entry across POSIX and Windows paths', () => {
		const nodes = [
			node('entry', 'main.ts'),
			node('posix', 'src/feature/file.ts'),
			node('windows', 'src\\feature\\file.ts'),
			node('deep', 'src/feature/detail/more/file.ts'),
			node('deepest', 'src/feature/detail/more/even/deeper/file.ts'),
			node('folder', 'src/feature', 'folder'),
		];

		const result = computeOrganizationLayers(nodes, [], 'entry', 'directory-proximity');

		assert.strictEqual(result.ranks.get('entry'), 0);
		assert.strictEqual(result.ranks.get('posix'), result.ranks.get('windows'));
		assert.ok(result.ranks.get('posix')! <= result.ranks.get('deep')!);
		assert.ok(result.ranks.get('deep')! <= result.ranks.get('deepest')!);
		assert.strictEqual(result.ranks.has('folder'), false);
	});

	test('does not let non-import topology change import-importance organization', () => {
		const nodes = [node('entry', 'main.ts'), node('one', 'one.ts'), node('two', 'two.ts')];
		const result = computeOrganizationLayers(nodes, [
			{ id: 'contains:entry->one', source: 'entry', target: 'one', kind: 'contains' },
			{ id: 'dependency:two->one', source: 'two', target: 'one', kind: 'dependency' },
		], 'entry', 'import-importance');

		assert.deepStrictEqual(Object.fromEntries(result.ranks), { entry: 0, one: 1, two: 1 });
	});
});

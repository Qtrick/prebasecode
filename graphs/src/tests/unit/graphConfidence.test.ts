/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { GraphGenerator } from '../../core/generation/graphGenerator.js';
import type { ParseResult } from '../../common/types/graphTypes.js';

suite('PreBase graph confidence / provenance', () => {
	test('import and contains edges are EXTRACTED with source line; cross-folder deps are INFERRED', () => {
		const results: ParseResult[] = [
			{
				filePath: '/proj/src/a.ts',
				relativePath: 'src/a.ts',
				imports: [{ source: '../lib/b', specifiers: ['b'], line: 4 }],
				exports: [],
				functions: [],
				components: [],
				isComponentFile: false,
			},
			{
				filePath: '/proj/lib/b.ts',
				relativePath: 'lib/b.ts',
				imports: [],
				exports: [{ name: 'b' }],
				functions: [],
				components: [],
				isComponentFile: false,
			},
		];
		const snapshot = new GraphGenerator({ includeFolders: true, includeFunctions: false }).buildFromParseResults(
			'/proj',
			'proj',
			results
		);
		assert.strictEqual(snapshot.schemaVersion, 2);
		const importEdge = snapshot.edges.find((e) => e.kind === 'import');
		assert.ok(importEdge);
		assert.strictEqual(importEdge!.meta?.confidence, 'EXTRACTED');
		assert.strictEqual(importEdge!.meta?.sourceFile, 'src/a.ts');
		assert.strictEqual(importEdge!.meta?.sourceLine, 4);
		assert.strictEqual(importEdge!.meta?.line, 4);
		const contains = snapshot.edges.filter((e) => e.kind === 'contains');
		assert.ok(contains.length > 0);
		assert.ok(contains.every((e) => e.meta?.confidence === 'EXTRACTED'));
		const folderDep = snapshot.edges.find((e) => e.kind === 'dependency');
		assert.ok(folderDep, 'cross-folder import must produce an INFERRED folder dependency');
		assert.strictEqual(folderDep!.meta?.confidence, 'INFERRED');
		assert.ok(folderDep!.meta?.reason);
	});

	test('dynamic import edges are AMBIGUOUS', () => {
		const results: ParseResult[] = [
			{
				filePath: '/proj/src/a.ts',
				relativePath: 'src/a.ts',
				imports: [{ source: './b', specifiers: [], isDynamic: true, line: 2 }],
				exports: [],
				functions: [],
				components: [],
				isComponentFile: false,
			},
			{
				filePath: '/proj/src/b.ts',
				relativePath: 'src/b.ts',
				imports: [],
				exports: [],
				functions: [],
				components: [],
				isComponentFile: false,
			},
		];
		const snapshot = new GraphGenerator({ includeFolders: false, includeFunctions: false }).buildFromParseResults(
			'/proj',
			'proj',
			results
		);
		const importEdge = snapshot.edges.find((e) => e.kind === 'import');
		assert.ok(importEdge);
		assert.strictEqual(importEdge!.meta?.isDynamic, true);
		assert.strictEqual(importEdge!.meta?.confidence, 'AMBIGUOUS');
	});

	test('static import named dynamic stays EXTRACTED (not a dynamic import)', () => {
		const results: ParseResult[] = [
			{
				filePath: '/proj/src/a.ts',
				relativePath: 'src/a.ts',
				imports: [{ source: './b', specifiers: ['dynamic'], line: 1 }],
				exports: [],
				functions: [],
				components: [],
				isComponentFile: false,
			},
			{
				filePath: '/proj/src/b.ts',
				relativePath: 'src/b.ts',
				imports: [],
				exports: [],
				functions: [],
				components: [],
				isComponentFile: false,
			},
		];
		const snapshot = new GraphGenerator({ includeFolders: false, includeFunctions: false }).buildFromParseResults(
			'/proj',
			'proj',
			results
		);
		const importEdge = snapshot.edges.find((e) => e.kind === 'import');
		assert.ok(importEdge);
		assert.strictEqual(importEdge!.meta?.isDynamic, false);
		assert.strictEqual(importEdge!.meta?.confidence, 'EXTRACTED');
	});

	test('duplicate identical imports collapse to one edge', () => {
		const results: ParseResult[] = [
			{
				filePath: '/proj/src/a.ts',
				relativePath: 'src/a.ts',
				imports: [
					{ source: './b', specifiers: ['b'], line: 1 },
					{ source: './b', specifiers: ['b'], line: 2 },
				],
				exports: [],
				functions: [],
				components: [],
				isComponentFile: false,
			},
			{
				filePath: '/proj/src/b.ts',
				relativePath: 'src/b.ts',
				imports: [],
				exports: [],
				functions: [],
				components: [],
				isComponentFile: false,
			},
		];
		const snapshot = new GraphGenerator({ includeFolders: false, includeFunctions: false }).buildFromParseResults(
			'/proj',
			'proj',
			results
		);
		const imports = snapshot.edges.filter((e) => e.kind === 'import');
		assert.strictEqual(imports.length, 1);
	});
});

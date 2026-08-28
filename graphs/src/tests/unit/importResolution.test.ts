/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert'
import { GraphGenerator } from '../../core/generation/graphGenerator.js'
import {
	buildImportResolutionContext,
	resolveImportWithContext
} from '../../core/resolution/importResolution.js'
import { basename, fileStem, normalizePath } from '../../core/resolution/paths.js'
import type { ParseResult } from '../../common/types/graphTypes.js'

function parse(relativePath: string, imports: string[]): ParseResult {
	return {
		filePath: `/workspace/${relativePath}`,
		relativePath,
		imports: imports.map(source => ({ source, specifiers: [] })),
		exports: [],
		functions: [],
		components: [],
		isComponentFile: false
	}
}

suite('Import resolution CPU-safe fuzzy match', () => {
	test('basename does not allocate a split array for posix paths', () => {
		assert.strictEqual(basename('src/components/App.tsx'), 'App.tsx')
		assert.strictEqual(basename('App.tsx'), 'App.tsx')
		assert.strictEqual(fileStem('src/components/App.tsx'), 'App')
		assert.strictEqual(normalizePath('src/components/App.tsx'), 'src/components/App.tsx')
		assert.strictEqual(normalizePath('src\\components\\App.tsx'), 'src/components/App.tsx')
	})

	test('resolves relative and unique stem imports without scanning every path', () => {
		const results = [
			parse('src/index.ts', ['./app', 'react']),
			parse('src/app.ts', ['Button']),
			parse('src/components/Button.tsx', [])
		]
		const ctx = buildImportResolutionContext('/workspace', results)
		assert.strictEqual(
			resolveImportWithContext('/workspace', 'src/index.ts', './app', {}, ctx),
			'src/app.ts'
		)
		assert.strictEqual(
			resolveImportWithContext('/workspace', 'src/app.ts', 'Button', {}, ctx),
			'src/components/Button.tsx'
		)
		assert.strictEqual(
			resolveImportWithContext('/workspace', 'src/index.ts', 'react', {}, ctx),
			null
		)
		assert.strictEqual(
			resolveImportWithContext('/workspace', 'src/app.ts', 'src/components/Button.tsx', {}, ctx),
			'src/components/Button.tsx'
		)
		assert.strictEqual(
			resolveImportWithContext('/workspace', 'src/other.ts', 'com.example.Button', {}, ctx),
			'src/components/Button.tsx'
		)
	})

	test('ambiguous stems do not invent an edge', () => {
		const results = [
			parse('src/a/Util.ts', []),
			parse('src/b/Util.ts', []),
			parse('src/app.ts', ['Util'])
		]
		const ctx = buildImportResolutionContext('/workspace', results)
		assert.strictEqual(
			resolveImportWithContext('/workspace', 'src/app.ts', 'Util', {}, ctx),
			null
		)
	})

	test('unresolved package imports stay cheap on a large file set', () => {
		const results: ParseResult[] = []
		for (let i = 0; i < 2500; i++) {
			results.push(parse(`src/f${i}.ts`, ['react', 'vscode', 'lodash', `./f${(i + 1) % 2500}`]))
		}
		const started = Date.now()
		const snapshot = new GraphGenerator({ includeFolders: false }).buildFromParseResults(
			'/workspace',
			'bench',
			results
		)
		const elapsed = Date.now() - started
		assert.ok(snapshot.nodes.length >= 2500)
		assert.ok(elapsed < 1500, `expected graph build under 1.5s, took ${elapsed}ms`)
	})
})

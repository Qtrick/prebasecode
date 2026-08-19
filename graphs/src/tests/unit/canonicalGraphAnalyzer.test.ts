/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { CanonicalGraphAnalyzer } from '../../core/canonical/canonicalGraphAnalyzer.js';
import type { IRepositoryContentSource, CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type { ScannedFile } from '../../common/types/graphTypes.js';
import { computeCanonicalGraphDigest } from '../../core/canonical/canonicalGraphDigest.js';

class InMemoryContentSource implements IRepositoryContentSource {
	readonly kind = 'working-tree';
	readonly identity: string;
	readonly rootPath: string;
	readonly projectName: string;
	private readonly _files: Map<string, string>;

	constructor(rootPath: string, files: Record<string, string>, projectName = 'test-project') {
		this.rootPath = rootPath;
		this.projectName = projectName;
		this.identity = `test-source:${rootPath}`;
		this._files = new Map(Object.entries(files));
	}

	async listFiles(token?: CancellationTokenLike): Promise<ScannedFile[]> {
		const result: ScannedFile[] = [];
		for (const relativePath of this._files.keys()) {
			if (token?.isCancellationRequested) break;
			const name = relativePath.split('/').pop() || relativePath;
			const ext = name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
			result.push({
				absolutePath: `${this.rootPath}/${relativePath}`,
				relativePath,
				extension: ext,
			});
		}
		return result;
	}

	async readFile(relativePath: string, token?: CancellationTokenLike): Promise<string | undefined> {
		if (token?.isCancellationRequested) return undefined;
		return this._files.get(relativePath);
	}

	async getFileSize(relativePath: string): Promise<number | undefined> {
		const content = this._files.get(relativePath);
		return content ? content.length : undefined;
	}

	async getContentIdentity(relativePath: string): Promise<string | undefined> {
		return `oid:${relativePath}`;
	}

	async readPackageMain(): Promise<string | null> {
		const pkg = this._files.get('package.json');
		if (!pkg) return null;
		try {
			const parsed = JSON.parse(pkg);
			return parsed.main || parsed.module || null;
		} catch {
			return null;
		}
	}
}

suite('CanonicalGraphAnalyzer Unit Tests', () => {
	test('analyzes full repository with ParserEngine AST parity, manifest, and deterministic digest', async () => {
		const source = new InMemoryContentSource('/workspace', {
			'package.json': JSON.stringify({ name: 'my-app', main: 'src/index.ts' }),
			'src/index.ts': `import { helper } from './utils/helper'; export const main = () => helper();`,
			'src/utils/helper.ts': `import { config } from '../config/appConfig'; export function helper() { return config; }`,
			'src/config/appConfig.ts': `export const config = { port: 3000 };`,
			'src/components/Header.tsx': `import React from 'react'; export function Header() { return <div>Header</div>; }`,
		});

		const analyzer = new CanonicalGraphAnalyzer();
		const snapshot = await analyzer.analyze(source);

		assert.ok(snapshot);
		assert.strictEqual(snapshot.projectName, 'test-project');
		assert.strictEqual(snapshot.projectPath, '/workspace');
		assert.strictEqual(snapshot.versions.graphSchemaVersion, 1);
		assert.strictEqual(snapshot.versions.analyzerVersion, 1);

		// Truthful coverage check
		assert.strictEqual(snapshot.coverage.completeWithinProfile, true);
		assert.strictEqual(snapshot.coverage.analyzedCount, 5);
		assert.strictEqual(snapshot.coverage.excludedCount, 0);
		assert.strictEqual(snapshot.coverage.truncated, false);

		// Architecture layers
		const headerNode = snapshot.nodes.find(n => n.path === 'src/components/Header.tsx');
		assert.ok(headerNode);
		assert.strictEqual(headerNode.meta?.architectureLayer, 'components');
		assert.strictEqual(headerNode.kind, 'component');

		const configNode = snapshot.nodes.find(n => n.path === 'src/config/appConfig.ts');
		assert.ok(configNode);
		assert.strictEqual(configNode.meta?.architectureLayer, 'config');

		// Entry node detection
		assert.strictEqual(snapshot.entryNodeId, 'file:src/index.ts');

		// Analysis manifest
		assert.ok(snapshot.manifest);
		assert.strictEqual(snapshot.manifest.entries.length, 5);
		const headerManifest = snapshot.manifest.entries.find(e => e.path === 'src/components/Header.tsx');
		assert.ok(headerManifest);
		assert.strictEqual(headerManifest.isComponent, true);
		assert.strictEqual(headerManifest.contentIdentity, 'oid:src/components/Header.tsx');

		// Digest determinism
		const digest1 = snapshot.digest;
		assert.strictEqual(typeof digest1, 'string');
		assert.strictEqual(digest1.length, 64); // SHA-256

		const snapshot2 = await analyzer.analyze(source);
		assert.strictEqual(snapshot2?.digest, digest1);
	});

	test('ParserEngine strips code-like comments and strings, preventing false structural history', async () => {
		const source1 = new InMemoryContentSource('/workspace', {
			'src/api.ts': `
				// export const FakeDeprecatedExport = 42;
				/* export function oldLegacyFunction() {} */
				const message = "export const FakeInString = true";
				export function realApi() { return message; }
			`,
		});

		const source2 = new InMemoryContentSource('/workspace', {
			'src/api.ts': `
				// modified comment that was changed in commit B
				/* another comment */
				const message = "export const FakeInString = true";
				export function realApi() { return message; }
			`,
		});

		const analyzer = new CanonicalGraphAnalyzer();
		const snap1 = await analyzer.analyze(source1);
		const snap2 = await analyzer.analyze(source2);

		assert.ok(snap1);
		assert.ok(snap2);

		const node1 = snap1.nodes.find(n => n.path === 'src/api.ts');
		const node2 = snap2.nodes.find(n => n.path === 'src/api.ts');
		assert.ok(node1);
		assert.ok(node2);

		// Only realApi should be an export; commented exports must NOT exist
		assert.deepStrictEqual(node1.meta?.exports, ['realApi']);
		assert.deepStrictEqual(node2.meta?.exports, ['realApi']);

		// Digest must match identically because comment change is NOT a structural change!
		assert.strictEqual(snap1.digest, snap2.digest);
	});

	test('classifies Vue and Svelte files as components via ParserEngine fallback', async () => {
		const source = new InMemoryContentSource('/workspace', {
			'src/App.vue': `<template><div>Vue</div></template><script>import Header from './Header.vue'; export default {};</script>`,
			'src/Button.svelte': `<script>export let label = '';</script><button>{label}</button>`,
		});

		const analyzer = new CanonicalGraphAnalyzer();
		const snapshot = await analyzer.analyze(source);

		assert.ok(snapshot);
		const vueNode = snapshot.nodes.find(n => n.path === 'src/App.vue');
		const svelteNode = snapshot.nodes.find(n => n.path === 'src/Button.svelte');

		assert.ok(vueNode);
		assert.ok(svelteNode);
		assert.strictEqual(vueNode.kind, 'component');
		assert.strictEqual(svelteNode.kind, 'component');
	});

	test('explicitly marks truncation and incomplete coverage when exceeding maxCanonicalFiles', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 50; i++) {
			files[`src/file${i}.ts`] = `export const f${i} = ${i};`;
		}

		const source = new InMemoryContentSource('/workspace', files);
		const analyzer = new CanonicalGraphAnalyzer({ maxCanonicalFiles: 20 });
		const snapshot = await analyzer.analyze(source);

		assert.ok(snapshot);
		assert.strictEqual(snapshot.coverage.discoveredCount, 50);
		assert.strictEqual(snapshot.coverage.analyzedCount, 20);
		assert.strictEqual(snapshot.coverage.truncated, true);
		assert.strictEqual(snapshot.coverage.completeWithinProfile, false);
		assert.ok(snapshot.coverage.truncationReason?.includes('20'));
	});

	test('safely excludes oversized and binary files with typed exclusion breakdown', async () => {
		const binaryBuffer = String.fromCharCode(0, 1, 2, 3, 0, 4, 5);
		const oversizedContent = 'export const big = 1;\n'.repeat(30_000); // > 500KB

		const source = new InMemoryContentSource('/mixed-workspace', {
			'src/normal.ts': `export const ok = true;`,
			'src/binary.bin.ts': `export const bin = "${binaryBuffer}";`,
			'src/oversized.ts': oversizedContent,
		});

		const analyzer = new CanonicalGraphAnalyzer({ maxFileSizeBytes: 100_000 });
		const snapshot = await analyzer.analyze(source);

		assert.ok(snapshot);
		assert.strictEqual(snapshot.coverage.completeWithinProfile, true);
		assert.strictEqual(snapshot.coverage.analyzedCount, 1);
		assert.strictEqual(snapshot.coverage.excludedCount, 2);
		assert.strictEqual(snapshot.coverage.exclusionBreakdown['oversized-file'], 1);
		assert.strictEqual(snapshot.coverage.exclusionBreakdown['binary-file'], 1);
	});

	test('respects cancellation cleanly without publishing corrupted partial graph', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 200; i++) {
			files[`src/file${i}.ts`] = `export const v${i} = ${i};`;
		}

		const source = new InMemoryContentSource('/workspace', files);
		const analyzer = new CanonicalGraphAnalyzer();

		let cancelRequested = false;
		const token: CancellationTokenLike = {
			get isCancellationRequested() {
				return cancelRequested;
			}
		};

		cancelRequested = true;
		const result = await analyzer.analyze(source, token);
		assert.strictEqual(result, undefined);
	});

	test('structural digest is invariant to node and edge ordering in input', async () => {
		const nodes1 = [
			{ id: 'file:b.ts', kind: 'file' as const, label: 'b.ts', path: 'src/b.ts' },
			{ id: 'file:a.ts', kind: 'file' as const, label: 'a.ts', path: 'src/a.ts' },
		];
		const edges1 = [
			{ id: 'import:file:a.ts->file:b.ts:./b', source: 'file:a.ts', target: 'file:b.ts', kind: 'import' as const },
		];

		const nodes2 = [
			{ id: 'file:a.ts', kind: 'file' as const, label: 'a.ts', path: 'src/a.ts' },
			{ id: 'file:b.ts', kind: 'file' as const, label: 'b.ts', path: 'src/b.ts' },
		];
		const edges2 = [
			{ id: 'import:file:a.ts->file:b.ts:./b', source: 'file:a.ts', target: 'file:b.ts', kind: 'import' as const },
		];

		const digest1 = computeCanonicalGraphDigest({ nodes: nodes1, edges: edges1, entryNodeId: 'file:a.ts' });
		const digest2 = computeCanonicalGraphDigest({ nodes: nodes2, edges: edges2, entryNodeId: 'file:a.ts' });

		assert.strictEqual(digest1, digest2);
	});
});

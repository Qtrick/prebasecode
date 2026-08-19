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
		return `hash:${relativePath}`;
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
	test('analyzes full repository into CanonicalGraphSnapshot with deterministic digest and versions', async () => {
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

		// Completeness check
		assert.strictEqual(snapshot.completeness.isComplete, true);
		assert.strictEqual(snapshot.completeness.analyzedFileCount, 5);
		assert.strictEqual(snapshot.completeness.excludedFileCount, 0);

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

		// Digest determinism
		const digest1 = snapshot.digest;
		assert.strictEqual(typeof digest1, 'string');
		assert.strictEqual(digest1.length, 64); // SHA-256

		const snapshot2 = await analyzer.analyze(source);
		assert.strictEqual(snapshot2?.digest, digest1);
	});

	test('handles large synthetic repository (1,500 files) without truncation in canonical model', async () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'huge-app', main: 'src/file0.ts' }),
		};

		for (let i = 0; i < 1500; i++) {
			const target = (i + 1) % 1500;
			files[`src/file${i}.ts`] = `import { f${target} } from './file${target}'; export const f${i} = ${i};`;
		}

		const source = new InMemoryContentSource('/huge-workspace', files);
		const analyzer = new CanonicalGraphAnalyzer({ maxCanonicalFiles: 5000 });
		const snapshot = await analyzer.analyze(source);

		assert.ok(snapshot);
		assert.strictEqual(snapshot.completeness.analyzedFileCount, 1501);
		assert.strictEqual(snapshot.nodes.length >= 1500, true);
		assert.strictEqual(snapshot.edges.length >= 1500, true);
		assert.strictEqual(snapshot.completeness.isComplete, true);
	});

	test('safely excludes oversized files, binary files, and parse errors with explicit completeness report', async () => {
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
		assert.strictEqual(snapshot.completeness.isComplete, false);
		assert.strictEqual(snapshot.completeness.analyzedFileCount, 1);
		assert.strictEqual(snapshot.completeness.excludedFileCount, 2);
		assert.ok(snapshot.completeness.exclusionReasons['oversized-file'] >= 1);
		assert.ok(snapshot.completeness.exclusionReasons['binary-file'] >= 1);

		const normalNode = snapshot.nodes.find(n => n.path === 'src/normal.ts');
		assert.ok(normalNode);
		const oversizedNode = snapshot.nodes.find(n => n.path === 'src/oversized.ts');
		assert.strictEqual(oversizedNode, undefined);
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

		// Cancel immediately
		cancelRequested = true;
		const result = await analyzer.analyze(source, token);
		assert.strictEqual(result, undefined);
	});

	test('structural digest is invariant to node ordering in input', async () => {
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

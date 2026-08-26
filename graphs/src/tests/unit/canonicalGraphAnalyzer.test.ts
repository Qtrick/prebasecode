/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { CanonicalGraphAnalyzer } from '../../core/canonical/canonicalGraphAnalyzer.js';
import type { IRepositoryContentSource, CancellationTokenLike, ScannedFileInventory } from '../../core/canonical/contentSource.js';
import type { ScannedFile } from '../../common/types/graphTypes.js';
import type { CanonicalAnalysisOptions } from '../../common/types/canonicalTypes.js';
import { computeCanonicalGraphDigest } from '../../core/canonical/canonicalGraphDigest.js';
import { CanonicalParseServiceError, type CanonicalParseRequest, type ICanonicalParseService } from '../../core/canonical/canonicalParseService.js';
import { extractBlobParseArtifact, type BlobParseArtifact } from '../../core/canonical/parseArtifactCache.js';
import { ParserEngine } from '../../core/parsing/parserEngine.js';
import { NodeCanonicalParseService } from '../../node/canonicalParseService.js';

function createCanonicalAnalyzer(options: CanonicalAnalysisOptions = {}): CanonicalGraphAnalyzer {
	return new CanonicalGraphAnalyzer({ ...options, parseService: new NodeCanonicalParseService() });
}

class CountingNodeParseService implements ICanonicalParseService {
	private readonly _nodeService = new NodeCanonicalParseService();
	parseCalls = 0;

	async parse(request: CanonicalParseRequest, token?: CancellationTokenLike): Promise<BlobParseArtifact | undefined> {
		this.parseCalls++;
		return this._nodeService.parse(request, token);
	}
}

class InMemoryContentSource implements IRepositoryContentSource {
	readonly kind = 'working-tree';
	readonly identity: string;
	readonly rootPath: string;
	readonly projectName: string;
	private readonly _files: Map<string, string>;
	private readonly _forceTruncated: boolean;
	private readonly _forceDiscoveredCount?: number;

	constructor(
		rootPath: string,
		files: Record<string, string>,
		projectName = 'test-project',
		forceTruncated = false,
		forceDiscoveredCount?: number
	) {
		this.rootPath = rootPath;
		this.projectName = projectName;
		this.identity = `test-source:${rootPath}`;
		this._files = new Map(Object.entries(files));
		this._forceTruncated = forceTruncated;
		this._forceDiscoveredCount = forceDiscoveredCount;
	}

	async listFiles(token?: CancellationTokenLike): Promise<ScannedFileInventory> {
		const result: ScannedFile[] = [];
		for (const relativePath of this._files.keys()) {
			if (token?.isCancellationRequested) {
				break;
			}
			const name = relativePath.split('/').pop() || relativePath;
			const ext = name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
			result.push({
				absolutePath: `${this.rootPath}/${relativePath}`,
				relativePath,
				extension: ext,
			});
		}
		return {
			files: result,
			isTruncated: this._forceTruncated,
			discoveredCount: this._forceDiscoveredCount ?? result.length,
			eligibleCount: result.length,
			truncationReason: this._forceTruncated ? 'Content source reached limit' : undefined,
		};
	}

	async readFile(relativePath: string, token?: CancellationTokenLike): Promise<string | undefined> {
		if (token?.isCancellationRequested) {
			return undefined;
		}
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
		if (!pkg) {
			return null;
		}
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

		const analyzer = createCanonicalAnalyzer();
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
		assert.strictEqual(headerManifest.architectureLayer, 'components');

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

		const analyzer = createCanonicalAnalyzer();
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

		const analyzer = createCanonicalAnalyzer();
		const snapshot = await analyzer.analyze(source);

		assert.ok(snapshot);
		const vueNode = snapshot.nodes.find(n => n.path === 'src/App.vue');
		const svelteNode = snapshot.nodes.find(n => n.path === 'src/Button.svelte');

		assert.ok(vueNode);
		assert.ok(svelteNode);
		assert.strictEqual(vueNode.kind, 'component');
		assert.strictEqual(svelteNode.kind, 'component');
	});

	test('preserves direct ParserEngine artifact parity across supported source formats', async () => {
		const parserEngine = new ParserEngine();
		const parseService = new NodeCanonicalParseService();
		const cases = [
			['src/module.ts', 'export const typed: number = 1;'],
			['src/View.tsx', 'export const View = () => <main />;'],
			['src/module.js', 'export async function load() { return import("./lazy.js"); }'],
			['src/View.jsx', 'export const View = () => <main />;'],
			['src/App.vue', '<script>import View from "./View.vue"; export default View;</script>'],
			['src/App.svelte', '<script>export let label = "";</script><button>{label}</button>'],
			['package.json', '{"name":"fixture","main":"src/module.ts"}'],
			['src/commonjs.cjs', 'const value = require("./value"); module.exports = value;'],
		] as const;

		for (const [relativePath, content] of cases) {
			const file: ScannedFile = {
				absolutePath: `/parser-parity/${relativePath}`,
				relativePath,
				extension: relativePath.includes('.') ? `.${relativePath.split('.').pop()!}` : '',
			};
			const direct = await parserEngine.parseFile(file, content);
			const throughService = await parseService.parse({ file, content });

			assert.ok(direct, relativePath);
			assert.deepStrictEqual(throughService, extractBlobParseArtifact(direct), relativePath);
		}
	});

	test('parseBatchSize does not change the canonical digest', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 12; i++) {
			files[`src/file${i}.ts`] = `export const f${i} = ${i};\nimport { f0 } from './file0';\n`;
		}
		const source = new InMemoryContentSource('/workspace', files);
		const a = await createCanonicalAnalyzer({ parseBatchSize: 1 }).analyze(source);
		const b = await createCanonicalAnalyzer({ parseBatchSize: 32 }).analyze(source);
		assert.ok(a && b);
		assert.strictEqual(a.digest, b.digest);
		assert.strictEqual(a.nodes.length, b.nodes.length);
		assert.strictEqual(a.edges.length, b.edges.length);
	});

	test('explicitly marks truncation and incomplete coverage when exceeding maxCanonicalFiles', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 50; i++) {
			files[`src/file${i}.ts`] = `export const f${i} = ${i};`;
		}

		const source = new InMemoryContentSource('/workspace', files);
		const analyzer = createCanonicalAnalyzer({ maxCanonicalFiles: 20 });
		const snapshot = await analyzer.analyze(source);

		assert.ok(snapshot);
		assert.strictEqual(snapshot.coverage.discoveredCount, 50);
		assert.strictEqual(snapshot.coverage.analyzedCount, 20);
		assert.strictEqual(snapshot.coverage.truncated, true);
		assert.strictEqual(snapshot.coverage.completeWithinProfile, false);
		assert.ok(snapshot.coverage.truncationReason?.includes('20'));
	});

	test('truthfully propagates truncation when content source pre-truncates inventory', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 10; i++) {
			files[`src/file${i}.ts`] = `export const f${i} = ${i};`;
		}

		// Content source returns 10 files but reports discoveredCount=15000 and isTruncated=true
		const source = new InMemoryContentSource('/workspace', files, 'test-project', true, 15_000);
		const analyzer = createCanonicalAnalyzer({ maxCanonicalFiles: 10_000 });
		const snapshot = await analyzer.analyze(source);

		assert.ok(snapshot);
		assert.strictEqual(snapshot.coverage.discoveredCount, 15_000);
		assert.strictEqual(snapshot.coverage.analyzedCount, 10);
		assert.strictEqual(snapshot.coverage.truncated, true, 'Must reflect source inventory truncation');
		assert.strictEqual(snapshot.coverage.completeWithinProfile, false, 'Pre-truncated source cannot be completeWithinProfile');
		assert.ok(snapshot.coverage.truncationReason?.includes('Content source reached limit'));
	});

	test('safely excludes oversized and binary files with typed exclusion breakdown', async () => {
		const binaryBuffer = String.fromCharCode(0, 1, 2, 3, 0, 4, 5);
		const oversizedContent = 'export const big = 1;\n'.repeat(30_000); // > 500KB

		const source = new InMemoryContentSource('/mixed-workspace', {
			'src/normal.ts': `export const ok = true;`,
			'src/binary.bin.ts': `export const bin = "${binaryBuffer}";`,
			'src/oversized.ts': oversizedContent,
		});

		const analyzer = createCanonicalAnalyzer({ maxFileSizeBytes: 100_000 });
		const snapshot = await analyzer.analyze(source);

		assert.ok(snapshot);
		assert.strictEqual(snapshot.coverage.completeWithinProfile, false);
		assert.strictEqual(snapshot.coverage.analyzedCount, 1);
		assert.strictEqual(snapshot.coverage.excludedCount, 2);
		assert.strictEqual(snapshot.coverage.exclusionBreakdown['oversized-file'], 1);
		assert.strictEqual(snapshot.coverage.exclusionBreakdown['binary-file'], 1);
	});

	test('measures uncached Unicode source by UTF-8 bytes rather than UTF-16 code units', async () => {
		const content = 'export const emoji = "😀";';
		const file: ScannedFile = {
			absolutePath: '/unicode-workspace/src/emoji.ts',
			relativePath: 'src/emoji.ts',
			extension: '.ts',
		};
		const source: IRepositoryContentSource = {
			kind: 'working-tree',
			rootPath: '/unicode-workspace',
			identity: 'unicode-size-fixture',
			async listFiles(): Promise<ScannedFileInventory> {
				return {
					files: [file],
					isTruncated: false,
					discoveredCount: 1,
					eligibleCount: 1,
				};
			},
			async readFile(): Promise<string> {
				return content;
			},
		};

		const snapshot = await createCanonicalAnalyzer({ maxFileSizeBytes: content.length }).analyze(source);

		assert.ok(snapshot);
		assert.ok(new TextEncoder().encode(content).byteLength > content.length);
		assert.deepStrictEqual({
			analyzed: snapshot.coverage.analyzedCount,
			excluded: snapshot.coverage.exclusionBreakdown['oversized-file'],
			complete: snapshot.coverage.completeWithinProfile,
		}, {
			analyzed: 0,
			excluded: 1,
			complete: false,
		});
	});

	test('reuses a cached parse artifact without invoking the parser service again', async () => {
		const source = new InMemoryContentSource('/cache-workspace', {
			'src/shared.ts': 'export const shared = 42;',
		});
		const parseService = new CountingNodeParseService();
		const artifacts = new Map<string, BlobParseArtifact>();
		const parseArtifactCache = {
			get(blobOid: string): BlobParseArtifact | undefined {
				return artifacts.get(blobOid);
			},
			set(blobOid: string, _extension: string, artifact: BlobParseArtifact): void {
				artifacts.set(blobOid, artifact);
			},
		};
		const analyzer = new CanonicalGraphAnalyzer({ parseService, parseArtifactCache });

		const [first, second] = [await analyzer.analyze(source), await analyzer.analyze(source)];

		assert.ok(first);
		assert.ok(second);
		assert.deepStrictEqual({
			parseCalls: parseService.parseCalls,
			cachedArtifacts: artifacts.size,
			digestMatches: first.digest === second.digest,
		}, {
			parseCalls: 1,
			cachedArtifacts: 1,
			digestMatches: true,
		});
	});

	test('propagates a systemic parser-service failure instead of publishing a fake partial graph', async () => {
		const source = new InMemoryContentSource('/unavailable-parser', {
			'src/main.ts': 'export const main = true;',
		});

		await assert.rejects(new CanonicalGraphAnalyzer().analyze(source), error => {
			return error instanceof CanonicalParseServiceError && error.code === 'service-unavailable';
		});
	});

	test('forwards the analysis cancellation token into parseService.parse', async () => {
		const token: CancellationTokenLike = { isCancellationRequested: false };
		let received: CancellationTokenLike | undefined;
		const parseService: ICanonicalParseService = {
			parse: async (request, parseToken) => {
				received = parseToken;
				return new NodeCanonicalParseService().parse(request, parseToken);
			},
		};
		const analyzer = new CanonicalGraphAnalyzer({ parseService });
		const result = await analyzer.analyze(new InMemoryContentSource('/workspace', {
			'src/a.ts': 'export const a = 1;',
		}), token);
		assert.ok(result);
		assert.strictEqual(received, token);
	});

	test('respects cancellation cleanly without publishing corrupted partial graph', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 200; i++) {
			files[`src/file${i}.ts`] = `export const v${i} = ${i};`;
		}

		const source = new InMemoryContentSource('/workspace', files);
		const analyzer = createCanonicalAnalyzer();

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

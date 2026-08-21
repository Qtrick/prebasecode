/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { suite, test } from 'mocha';
import { BlobAnalysisCache } from '../../temporal/analysis/blobAnalysisCache.js';
import { IncrementalGraphAnalyzer } from '../../temporal/analysis/incrementalGraphAnalyzer.js';
import { CanonicalGraphAnalyzer } from '../../core/canonical/canonicalGraphAnalyzer.js';
import { NodeCanonicalParseService } from '../../node/canonicalParseService.js';
import type { IRepositoryContentSource, ScannedFileInventory } from '../../core/canonical/contentSource.js';
import { isTemporalError } from '../../temporal/common/temporalErrors.js';
import { computeAnalysisCacheKey } from '../../temporal/common/temporalVersioning.js';

class MockContentSource implements IRepositoryContentSource {
	readonly kind = 'git-tree' as const;
	readonly rootPath: string = '/repo';
	readonly identity: string = 'mock-source';
	private readonly _files: Map<string, { content: string; blobOid: string }>;

	constructor(files: Record<string, { content: string; blobOid: string }>) {
		this._files = new Map(Object.entries(files));
	}

	async listFiles(): Promise<ScannedFileInventory> {
		const files = Array.from(this._files.entries()).map(([path, data]) => ({
			absolutePath: `/repo/${path}`,
			relativePath: path,
			extension: path.includes('.') ? `.${path.split('.').pop()}` : '',
			blobOid: data.blobOid,
		}));

		return {
			files,
			isTruncated: false,
			discoveredCount: files.length,
			eligibleCount: files.length,
		};
	}

	async readFile(relativePath: string): Promise<string | undefined> {
		const rel = relativePath.replace(/^\/+/, '').replace(/^repo\//, '');
		return this._files.get(rel)?.content;
	}
}

function createIncrementalAnalyzer(cache: BlobAnalysisCache): IncrementalGraphAnalyzer {
	return new IncrementalGraphAnalyzer({ parseService: new NodeCanonicalParseService() }, cache);
}

suite('BlobAnalysisCache & IncrementalGraphAnalyzer', () => {
	test('BlobAnalysisCache tracks hits, misses, and enforces capacity eviction', () => {
		const cache = new BlobAnalysisCache(2, 1, 1);

		cache.set('blob1', '.ts', {
			imports: [],
			exports: [{ name: 'a' }],
			functions: [],
			components: [],
			isComponentFile: false,
		});

		cache.set('blob2', '.ts', {
			imports: [],
			exports: [{ name: 'b' }],
			functions: [],
			components: [],
			isComponentFile: false,
		});

		assert.ok(cache.get('blob1', '.ts'));
		assert.strictEqual(cache.getStats().hits, 1);

		// Insert 3rd entry -> evicts blob2 because blob1 was recently accessed
		cache.set('blob3', '.ts', {
			imports: [],
			exports: [{ name: 'c' }],
			functions: [],
			components: [],
			isComponentFile: false,
		});

		assert.ok(cache.get('blob1', '.ts')); // Still present
		assert.strictEqual(cache.get('blob2', '.ts'), undefined); // Evicted
		assert.ok(cache.get('blob3', '.ts'));
	});

	test('computeAnalysisCacheKey fails closed on invalid versions', () => {
		assert.throws(() => {
			computeAnalysisCacheKey('blob1', 0, 1, 'ts');
		}, (err: any) => isTemporalError(err) && err.code === 'InvalidVersion');

		assert.throws(() => {
			computeAnalysisCacheKey('blob1', 1, -2, 'ts');
		}, (err: any) => isTemporalError(err) && err.code === 'InvalidVersion');
	});

	test('IncrementalGraphAnalyzer produces identical structural truth to CanonicalGraphAnalyzer', async () => {
		const cache = new BlobAnalysisCache();
		const analyzer = createIncrementalAnalyzer(cache);

		const source = new MockContentSource({
			'src/presentation/app.tsx': {
				content: 'import { UserService } from "../services/userService"; export function App() { return <div />; }',
				blobOid: 'blob_app',
			},
			'src/services/userService.ts': {
				content: 'export class UserService { getUser() { return { id: 1 }; } }',
				blobOid: 'blob_service',
			},
		});

		const directCanonicalAnalyzer = new CanonicalGraphAnalyzer({ parseService: new NodeCanonicalParseService() });
		const directCanonicalSnapshot = await directCanonicalAnalyzer.analyze(source);
		assert.ok(directCanonicalSnapshot);

		const incrementalOutput = await analyzer.analyzeCommit({
			commitSha: 'commit_1',
			contentSource: source,
		});

		assert.strictEqual(incrementalOutput.snapshot.graphData.nodes.length, directCanonicalSnapshot.nodes.length);
		assert.strictEqual(incrementalOutput.snapshot.graphData.edges.length, directCanonicalSnapshot.edges.length);
		assert.strictEqual(incrementalOutput.snapshot.digest, directCanonicalSnapshot.digest);
	});

	test('IncrementalGraphAnalyzer reuses blob cache and handles path-independent renames', async () => {
		const cache = new BlobAnalysisCache();
		const analyzer = createIncrementalAnalyzer(cache);

		// Commit 1
		const source1 = new MockContentSource({
			'src/shared.ts': { content: 'export const shared = 42;', blobOid: 'blob_shared' },
			'src/main.ts': { content: 'import { shared } from "./shared"; export const main = 1;', blobOid: 'blob_main1' },
		});

		const out1 = await analyzer.analyzeCommit({
			commitSha: 'c1',
			contentSource: source1,
		});

		assert.strictEqual(out1.snapshot.entityMap.size, 2);
		assert.strictEqual(cache.getStats().hits, 0);

		// Commit 2: shared.ts copied/renamed to util.ts with identical blob_shared
		const source2 = new MockContentSource({
			'src/util.ts': { content: 'export const shared = 42;', blobOid: 'blob_shared' },
			'src/main.ts': { content: 'import { shared } from "./util"; export const main = 2;', blobOid: 'blob_main2' },
		});

		const out2 = await analyzer.analyzeCommit({
			commitSha: 'c2',
			contentSource: source2,
			parentSnapshot: out1.snapshot,
		});

		// Blob shared was a cache hit, and materialized with path src/util.ts!
		assert.ok(cache.getStats().hits >= 1);
		const utilNode = out2.snapshot.graphData.nodes.find(n => n.path === 'src/util.ts');
		assert.ok(utilNode);
		assert.strictEqual(utilNode.path, 'src/util.ts');
	});

	test('Identical structural state detection on comment-only change', async () => {
		const cache = new BlobAnalysisCache();
		const analyzer = createIncrementalAnalyzer(cache);

		const source1 = new MockContentSource({
			'src/a.ts': { content: 'export const a = 1;', blobOid: 'blob_a1' },
		});

		const out1 = await analyzer.analyzeCommit({
			commitSha: 'c1',
			contentSource: source1,
		});

		// Commit 2: only comments added, AST is structurally equivalent
		const source2 = new MockContentSource({
			'src/a.ts': { content: '// Documentation comment\nexport const a = 1;', blobOid: 'blob_a2' },
		});

		const out2 = await analyzer.analyzeCommit({
			commitSha: 'c2',
			contentSource: source2,
			parentSnapshot: out1.snapshot,
		});

		assert.strictEqual(out2.isIdenticalToParent, true);
		assert.strictEqual(out1.snapshot.digest, out2.snapshot.digest);
	});
});

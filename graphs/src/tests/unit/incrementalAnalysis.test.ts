/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { suite, test } from 'mocha';
import { BlobAnalysisCache } from '../../temporal/analysis/blobAnalysisCache.js';
import { IncrementalGraphAnalyzer } from '../../temporal/analysis/incrementalGraphAnalyzer.js';
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

suite('BlobAnalysisCache & IncrementalGraphAnalyzer', () => {
	test('BlobAnalysisCache tracks hits, misses, and enforces capacity eviction', () => {
		const cache = new BlobAnalysisCache(2);

		cache.set({
			blobOid: 'blob1',
			analyzerVersion: 1,
			profileVersion: 1,
			language: 'ts',
			nodeData: { id: '1', kind: 'file', label: '1', path: '1.ts' },
			outgoingEdges: [],
			analyzedAt: 1,
		});

		cache.set({
			blobOid: 'blob2',
			analyzerVersion: 1,
			profileVersion: 1,
			language: 'ts',
			nodeData: { id: '2', kind: 'file', label: '2', path: '2.ts' },
			outgoingEdges: [],
			analyzedAt: 2,
		});

		assert.ok(cache.get('blob1', 1, 1, 'ts'));
		assert.strictEqual(cache.getStats().hits, 1);

		// Insert 3rd entry -> evicts blob2 because blob1 was recently read
		cache.set({
			blobOid: 'blob3',
			analyzerVersion: 1,
			profileVersion: 1,
			language: 'ts',
			nodeData: { id: '3', kind: 'file', label: '3', path: '3.ts' },
			outgoingEdges: [],
			analyzedAt: 3,
		});

		assert.ok(cache.get('blob1', 1, 1, 'ts')); // Still present
		assert.strictEqual(cache.get('blob2', 1, 1, 'ts'), undefined); // Evicted
		assert.ok(cache.get('blob3', 1, 1, 'ts'));
	});

	test('computeAnalysisCacheKey fails closed on invalid versions', () => {
		assert.throws(() => {
			computeAnalysisCacheKey('blob1', 0, 1, 'ts');
		}, (err: any) => isTemporalError(err) && err.code === 'InvalidVersion');

		assert.throws(() => {
			computeAnalysisCacheKey('blob1', 1, -2, 'ts');
		}, (err: any) => isTemporalError(err) && err.code === 'InvalidVersion');
	});

	test('IncrementalGraphAnalyzer reuses blob cache on commit transitions', async () => {
		const cache = new BlobAnalysisCache();
		const analyzer = new IncrementalGraphAnalyzer({}, cache);

		// Commit 1: files A and B
		const source1 = new MockContentSource({
			'src/a.ts': { content: 'import { b } from "./b"; export const a = 1;', blobOid: 'oid_a1' },
			'src/b.ts': { content: 'export const b = 2;', blobOid: 'oid_b1' },
		});

		const out1 = await analyzer.analyzeCommit({
			commitSha: 'c1',
			contentSource: source1,
		});

		assert.strictEqual(out1.snapshot.entityMap.size, 2);
		assert.strictEqual(out1.snapshot.edgeMap.size, 1);
		assert.strictEqual(cache.getStats().hits, 0);
		assert.strictEqual(cache.getStats().misses, 2);

		// Commit 2: file A unchanged (oid_a1), file B modified (oid_b2), file C added (oid_c1)
		const source2 = new MockContentSource({
			'src/a.ts': { content: 'import { b } from "./b"; export const a = 1;', blobOid: 'oid_a1' },
			'src/b.ts': { content: 'export const b = 3; export const bExtra = 4;', blobOid: 'oid_b2' },
			'src/c.ts': { content: 'export const c = 5;', blobOid: 'oid_c1' },
		});

		const out2 = await analyzer.analyzeCommit({
			commitSha: 'c2',
			contentSource: source2,
			parentSnapshot: out1.snapshot,
		});

		assert.strictEqual(out2.snapshot.entityMap.size, 3);
		// File A was a cache hit!
		assert.ok(cache.getStats().hits >= 1);
		assert.ok(out2.delta);
		assert.strictEqual(out2.delta!.entitiesAdded.length, 1);
		assert.strictEqual(out2.delta!.entitiesModified.length, 1);
	});
});

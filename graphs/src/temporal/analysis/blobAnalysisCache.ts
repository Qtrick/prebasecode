/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { computeAnalysisCacheKey } from '../common/temporalVersioning.js';
import type { BlobAnalysisRecord } from '../common/temporalTypes.js';

export interface BlobCacheStats {
	readonly hits: number;
	readonly misses: number;
	readonly size: number;
	readonly capacity: number;
}

export class BlobAnalysisCache {
	private readonly _cache = new Map<string, BlobAnalysisRecord>();
	private readonly _capacity: number;
	private _hits = 0;
	private _misses = 0;

	constructor(capacity: number = 10_000) {
		this._capacity = Math.max(1, capacity);
	}

	get(blobOid: string, analyzerVersion: number, profileVersion: number, language: string): BlobAnalysisRecord | undefined {
		const key = computeAnalysisCacheKey(blobOid, analyzerVersion, profileVersion, language);
		const record = this._cache.get(key);
		if (record) {
			this._hits++;
			// Re-insert to mark as recently used (LRU)
			this._cache.delete(key);
			this._cache.set(key, record);
			return record;
		}
		this._misses++;
		return undefined;
	}

	set(record: BlobAnalysisRecord): void {
		const key = computeAnalysisCacheKey(
			record.blobOid,
			record.analyzerVersion,
			record.profileVersion,
			record.language
		);

		if (this._cache.has(key)) {
			this._cache.delete(key);
		} else if (this._cache.size >= this._capacity) {
			// Evict oldest entry
			const firstKey = this._cache.keys().next().value;
			if (firstKey !== undefined) {
				this._cache.delete(firstKey);
			}
		}

		this._cache.set(key, record);
	}

	has(blobOid: string, analyzerVersion: number, profileVersion: number, language: string): boolean {
		const key = computeAnalysisCacheKey(blobOid, analyzerVersion, profileVersion, language);
		return this._cache.has(key);
	}

	clear(): void {
		this._cache.clear();
		this._hits = 0;
		this._misses = 0;
	}

	getStats(): BlobCacheStats {
		return {
			hits: this._hits,
			misses: this._misses,
			size: this._cache.size,
			capacity: this._capacity,
		};
	}
}

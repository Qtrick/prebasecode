/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { computeAnalysisCacheKey } from '../common/temporalVersioning.js';
import type { BlobParseArtifact, ICanonicalParseArtifactCache } from '../../core/canonical/parseArtifactCache.js';
import type { ITemporalStore } from '../persistence/common/temporalStore.js';

export interface BlobCacheStats {
	readonly hits: number;
	readonly misses: number;
	readonly size: number;
	readonly capacity: number;
}

export class BlobAnalysisCache implements ICanonicalParseArtifactCache {
	private readonly _cache = new Map<string, BlobParseArtifact>();
	private readonly _capacity: number;
	private readonly _analyzerVersion: number;
	private readonly _profileVersion: number;
	private _hits = 0;
	private _misses = 0;

	constructor(
		capacity: number = 10_000,
		analyzerVersion: number = 1,
		profileVersion: number = 1,
	) {
		this._capacity = Math.max(1, capacity);
		this._analyzerVersion = analyzerVersion;
		this._profileVersion = profileVersion;
	}

	get(blobOid: string, extension: string): BlobParseArtifact | undefined {
		const key = computeAnalysisCacheKey(blobOid, this._analyzerVersion, this._profileVersion, extension);
		const artifact = this._cache.get(key);
		if (artifact) {
			this._hits++;
			this._cache.delete(key);
			this._cache.set(key, artifact);
			return artifact;
		}
		this._misses++;
		return undefined;
	}

	set(blobOid: string, extension: string, artifact: BlobParseArtifact): void {
		const key = computeAnalysisCacheKey(blobOid, this._analyzerVersion, this._profileVersion, extension);
		if (this._cache.has(key)) {
			this._cache.delete(key);
		} else if (this._cache.size >= this._capacity) {
			const firstKey = this._cache.keys().next().value;
			if (firstKey !== undefined) {
				this._cache.delete(firstKey);
			}
		}
		this._cache.set(key, artifact);
	}

	has(blobOid: string, extension: string): boolean {
		const key = computeAnalysisCacheKey(blobOid, this._analyzerVersion, this._profileVersion, extension);
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

/**
 * Two-tier cache coordinating L1 memory LRU and L2 persistent SQLite storage.
 */
export class TwoTierParseArtifactCache implements ICanonicalParseArtifactCache {
	private readonly _l1: BlobAnalysisCache;
	private readonly _l2?: ITemporalStore;
	private readonly _analyzerVersion: number;
	private readonly _profileVersion: number;

	constructor(
		l1: BlobAnalysisCache,
		l2?: ITemporalStore,
		analyzerVersion: number = 1,
		profileVersion: number = 1,
	) {
		this._l1 = l1;
		this._l2 = l2;
		this._analyzerVersion = analyzerVersion;
		this._profileVersion = profileVersion;
	}

	async get(blobOid: string, extension: string): Promise<BlobParseArtifact | undefined> {
		// 1. Check L1 Memory LRU
		const memoryHit = this._l1.get(blobOid, extension);
		if (memoryHit) {
			return memoryHit;
		}

		// 2. Check L2 Persistent SQLite
		if (this._l2) {
			try {
				const record = await this._l2.getBlobAnalysis(blobOid, this._analyzerVersion, this._profileVersion, extension);
				if (record?.artifact) {
					// Populate L1 cache on L2 hit
					this._l1.set(blobOid, extension, record.artifact);
					return record.artifact;
				}
			} catch {
				// Non-fatal L2 read failure
			}
		}

		return undefined;
	}

	async set(blobOid: string, extension: string, artifact: BlobParseArtifact): Promise<void> {
		// 1. Populate L1 Memory
		this._l1.set(blobOid, extension, artifact);

		// 2. Populate L2 Persistent SQLite
		if (this._l2) {
			try {
				await this._l2.saveBlobAnalysis({
					blobOid,
					analyzerVersion: this._analyzerVersion,
					profileVersion: this._profileVersion,
					language: extension,
					artifact,
					analyzedAt: Date.now(),
				});
			} catch {
				// Non-fatal L2 write failure
			}
		}
	}

	getStats(): BlobCacheStats {
		return this._l1.getStats();
	}
}
